// v6 → v7 forward migration (Custom Rule 13).
//
// v7 is a WIRE-FORMAT + CAP bump. Wire changes (CP2):
//   - calibration `optionId` symbolized against an inline 24-entry enum
//     (CALIBRATION_OPTION_IDS in save-codecs.js)
//   - combat actor `x`/`y` packed to 3+4 bits (matches the fixed 8×16
//     combat window in src/rules/encounters.js)
//   - newly-generated loot ids shrink to ≤9 chars (legacy long ids
//     remain valid — the codec's 96-char cap is unchanged)
//
// Cap changes (CP3): every v7 cap is a budget-model output, tightened so
// the reachable apex encodes ≤ SAVE_BUDGET(1900) - 190 without the trim
// ladder firing. Old v6 saves can legitimately exceed the new caps, so
// this hop clamps them per D2 policy (STATE.md):
//
//   inventory     100 → 40:  sort non-junk-then-junk by salvageValue desc,
//                             keep up to INVENTORY_CAP units (trim stack
//                             counts for a partial fit); overflow is
//                             SALVAGED — total scrap credited to
//                             scrapCounter, nothing silently vanishes.
//   corrupt ledger 118 → 32: still-held ids first (present in inventory
//                             or equipment), then newest tail entries;
//                             truncate to MAX_CORRUPT_IMPLANTS.
//   events         64 → 24:  keep newest MAX_EVENTS entries.
//   combat        12288 → 4096: activeCombat set to null if the snapshot
//                             either exceeds MAX_COMBAT_BYTES post-serialize
//                             or carries actor coords outside the 8×16
//                             window (early v3/v4 fixtures with 5-bit
//                             coords may have actor.x up to 10). The
//                             danger clock re-engages on contact.
//
// Up to two `system`-typed chronicle events are appended so the player
// sees the compaction:
//   PACK COMPACTED TO NEW LIMIT — OVERFLOW SALVAGED TO SCRAP
//   COMBAT SNAPSHOT RELEASED ON UPGRADE   (only when combat dropped)
// Non-red per Custom Rule 14 — `system` type carries no colour semantics.
//
// The migration MUTATES the state in place: it receives a live RunState
// (from deserializeRunState in the frozen reader), and callers rely on
// its class methods (serialize, setActiveCombat, etc.) after the hop
// returns. Spread would strip the methods.

import { getSalvageValue } from '../../rules/inventory.js';

// CP2 constant — kept for the initial "does combat fit the 8×16 window?"
// check. CP3's byte-size ceiling below runs on top of this.
function combatFitsV7Window(activeCombat) {
  if (!activeCombat || !Array.isArray(activeCombat.actors)) return true;
  for (const actor of activeCombat.actors) {
    if (!Number.isInteger(actor?.x) || actor.x < 0 || actor.x > 7) return false;
    if (!Number.isInteger(actor?.y) || actor.y < 0 || actor.y > 15) return false;
  }
  return true;
}

const V7_INVENTORY_CAP = 40;
const V7_MAX_CORRUPT_IMPLANTS = 32;
const V7_MAX_EVENTS = 24;
const V7_MAX_COMBAT_BYTES = 4096;
const V7_MAX_SCRAP = 1_000_000_000;
const V7_MAX_MESSAGE = 72;

function unitCount(item) {
  return Number.isInteger(item?.count) ? item.count : 1;
}

function totalUnits(inventory) {
  return inventory.reduce((total, item) => total + unitCount(item), 0);
}

// Ordering: non-junk before junk, then salvageValue descending, then
// original relative order (stable). D2 keeps the "worth keeping" ahead of
// the trash so the trash falls out first.
function keepPriority(a, b, aIndex, bIndex) {
  const aJunk = a.junkTagged ? 1 : 0;
  const bJunk = b.junkTagged ? 1 : 0;
  if (aJunk !== bJunk) return aJunk - bJunk;
  const bSalvage = (Number(b.salvageValue) || 0);
  const aSalvage = (Number(a.salvageValue) || 0);
  if (bSalvage !== aSalvage) return bSalvage - aSalvage;
  return aIndex - bIndex;
}

function compactInventory(inventory, cap) {
  const withIndex = inventory.map((item, index) => ({ item, index }));
  withIndex.sort((a, b) => keepPriority(a.item, b.item, a.index, b.index));
  const kept = [];
  const dropped = [];
  let unitsRemaining = cap;
  for (const { item, index } of withIndex) {
    const units = unitCount(item);
    if (unitsRemaining <= 0) {
      dropped.push({ item, keptUnits: 0, droppedUnits: units, index });
      continue;
    }
    if (units <= unitsRemaining) {
      kept.push({ item, index });
      unitsRemaining -= units;
      continue;
    }
    // Partial-fit: keep the head of the stack, drop the tail.
    const partial = { ...item, count: unitsRemaining };
    kept.push({ item: partial, index });
    dropped.push({ item, keptUnits: unitsRemaining, droppedUnits: units - unitsRemaining, index });
    unitsRemaining = 0;
  }
  // Restore original order for the survivors so unrelated code that
  // depends on insertion order (rare) still sees a stable-ish shape.
  kept.sort((a, b) => a.index - b.index);
  const salvagedScrap = dropped.reduce((total, entry) => {
    if (entry.droppedUnits <= 0) return total;
    // getSalvageValue multiplies by units; construct a temporary item
    // whose count === droppedUnits so the math stays in one place.
    const proxy = { ...entry.item, count: entry.droppedUnits };
    return total + getSalvageValue(proxy);
  }, 0);
  return { inventory: kept.map((k) => k.item), salvagedScrap, droppedCount: dropped.length };
}

function compactLedger(appliedCorruptItemIds, heldItemIds, cap) {
  if (!Array.isArray(appliedCorruptItemIds) || appliedCorruptItemIds.length <= cap) return appliedCorruptItemIds;
  const held = [];
  const missing = [];
  for (const id of appliedCorruptItemIds) {
    if (heldItemIds.has(id)) held.push(id);
    else missing.push(id);
  }
  // Keep still-held first (never lose evidence of what's currently
  // equipped/carried), then the newest tail of missing entries.
  const combined = [...held, ...missing.slice(-Math.max(0, cap - held.length))];
  return combined.slice(0, cap);
}

function collectHeldItemIds(state) {
  const ids = new Set();
  for (const item of state.inventory ?? []) if (typeof item?.id === 'string') ids.add(item.id);
  for (const character of state.party ?? []) {
    const equipment = character?.equipment ?? {};
    for (const slot of ['weapon', 'armor', 'offhand']) {
      const item = equipment[slot];
      if (item && typeof item.id === 'string') ids.add(item.id);
    }
  }
  return ids;
}

function appendChronicle(state, message) {
  const entry = { type: 'system', message: message.slice(0, V7_MAX_MESSAGE) };
  if (typeof state.recordEvent === 'function') {
    state.recordEvent(entry);
    return;
  }
  if (!Array.isArray(state.recentEvents)) state.recentEvents = [];
  state.recentEvents.push(entry);
  if (state.recentEvents.length > V7_MAX_EVENTS) {
    state.recentEvents.splice(0, state.recentEvents.length - V7_MAX_EVENTS);
  }
}

function combatByteSize(activeCombat) {
  try {
    const json = JSON.stringify(activeCombat);
    return typeof json === 'string' ? new TextEncoder().encode(json).length : Infinity;
  } catch {
    return Infinity;
  }
}

export const v6ToV7 = {
  from: 6,
  to: 7,
  migrate: (state) => {
    if (!state || typeof state !== 'object') return state;

    let compactionHappened = false;

    // Inventory clamp (units-based) → salvage overflow into scrapCounter.
    if (Array.isArray(state.inventory) && totalUnits(state.inventory) > V7_INVENTORY_CAP) {
      const { inventory, salvagedScrap } = compactInventory(state.inventory, V7_INVENTORY_CAP);
      state.inventory = inventory;
      if (Number.isFinite(salvagedScrap) && salvagedScrap > 0) {
        const before = Number.isFinite(state.scrapCounter) ? state.scrapCounter : 0;
        state.scrapCounter = Math.min(V7_MAX_SCRAP, before + Math.round(salvagedScrap));
      }
      compactionHappened = true;
    }

    // Ledger clamp — still-held-first, then newest tail.
    if (Array.isArray(state.appliedCorruptItemIds) && state.appliedCorruptItemIds.length > V7_MAX_CORRUPT_IMPLANTS) {
      const heldIds = collectHeldItemIds(state);
      state.appliedCorruptItemIds = compactLedger(state.appliedCorruptItemIds, heldIds, V7_MAX_CORRUPT_IMPLANTS);
      compactionHappened = true;
    }

    // Persisted events — keep newest MAX_EVENTS.
    if (Array.isArray(state.recentEvents) && state.recentEvents.length > V7_MAX_EVENTS) {
      state.recentEvents = state.recentEvents.slice(state.recentEvents.length - V7_MAX_EVENTS);
      compactionHappened = true;
    }

    // Combat drop: coord-out-of-window OR oversized snapshot.
    let combatDropped = false;
    if (state.activeCombat) {
      const windowFits = combatFitsV7Window(state.activeCombat);
      const bytesFit = combatByteSize(state.activeCombat) <= V7_MAX_COMBAT_BYTES;
      if (!windowFits || !bytesFit) {
        if (typeof state.setActiveCombat === 'function') state.setActiveCombat(null);
        else state.activeCombat = null;
        combatDropped = true;
      }
    }

    if (compactionHappened) appendChronicle(state, 'PACK COMPACTED TO NEW LIMIT — OVERFLOW SALVAGED TO SCRAP');
    if (combatDropped) appendChronicle(state, 'COMBAT SNAPSHOT RELEASED ON UPGRADE');

    return state;
  }
};
