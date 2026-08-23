// console-submenu-density-and-scroll SESSION-04 — deterministic browser
// fixtures for the density/scroll acceptance battery. Composes the existing
// game-fixture.js primitives (never forks them) to produce two importable
// `#r=` fragments:
//   - an exploration run with a multi-member party, full protocol decks,
//     several real inventory items, a handful of real event-log entries, and
//     the party positioned on an unopened container so LOOT is genuinely
//     available after import.
//   - a standard combat encounter (multiple enemies) so COMBAT is genuinely
//     available and its action/target lists carry real density.
// Every value here is bounded by the same save-budget rule real runs face
// (Custom Rule 6, <1500 chars) — encodeRun auto-trims recentEvents to fit, so
// the "logCount" requested below is a ceiling, not a guarantee. Tests that
// need more rows than a mode's real state can supply within budget fall back
// to the session-authorized "append a live sentinel list after mount" path;
// this module supplies only genuine, rules-generated content.
import { createGameHarness, walkTo, roundTripRunState, startStandardCombat } from './game-fixture.js';
import { generateLoot } from '../../src/rules/loot.js';
import { addItem, getInventoryCount } from '../../src/rules/inventory.js';
import { deckSlotCapacity, deckSlotCost } from '../../src/rules/protocols.js';

function classDataFor(data, character) {
  return data?.classes?.classes?.find((entry) => entry.id === character?.classId) || null;
}

// Fill a character's protocolDeck to its class's real slot capacity, cycling
// the class's legal schools across ascending tiers (bounded by the class's
// maxTier) so every entry passes validateProtocolDeck without duplicating a
// school+tier pair whenever the class has more than one legal school.
function fillProtocolDeck(character, classData) {
  const capacity = deckSlotCapacity(classData?.chargeBase, 0);
  const schools = classData?.protocolGates?.schools?.length ? classData.protocolGates.schools : ['disrupt'];
  const maxTier = classData?.protocolGates?.maxTier || 1;
  const deck = [];
  let used = 0;
  for (let tier = 1; tier <= maxTier && used < capacity; tier++) {
    const cost = deckSlotCost(tier);
    if (used + cost > capacity) break;
    for (const school of schools) {
      if (used + cost > capacity) break;
      deck.push({ school, tier });
      used += cost;
    }
  }
  character.protocolDeck = deck;
  return deck;
}

// Push real, rules-generated items (generateLoot + addItem — the same
// pipeline lootFirstContainer in game-fixture.js drives for a single
// container) into the shared inventory across synthetic container ids until
// targetCount is reached or the guard trips.
function fillInventoryWithLoot(harness, targetCount) {
  const { runState, data } = harness;
  let containerId = 5000;
  let guard = 0;
  while (getInventoryCount(runState.inventory) < targetCount && guard < 200) {
    guard += 1;
    const items = generateLoot(runState.worldSeed, runState.depth, `density:${containerId}`, containerId, {}, data.equipment, data.affixes, data.consumables, { kind: 'standard' });
    for (const item of items) {
      if (getInventoryCount(runState.inventory) >= targetCount) break;
      const result = addItem(runState.inventory, item);
      if (!result.success) continue;
      runState.inventory = result.inventory;
    }
    containerId += 1;
  }
}

function fillEventLog(runState, count) {
  runState.recentEvents = runState.recentEvents || [];
  const start = runState.recentEvents.length;
  const types = ['discovery', 'move', 'loot'];
  for (let index = 0; index < count; index++) {
    const sequence = start + index + 1;
    runState.recentEvents.push({ type: types[index % types.length], message: `Density log entry ${sequence}`, sequence });
  }
}

// createExplorationDensityFixture — a stable, encoded exploration run
// covering MOVE, PARTY, GEAR, TECH, and LOOT with real data. LOG receives
// whatever real events survive the save-budget trim (see module doc); the
// acceptance spec supplies a live sentinel fallback where that is not enough
// to exceed a phone viewport.
export function createExplorationDensityFixture({ seed = 900301, partySize = 3, inventoryTarget = 6, logCount = 30 } = {}) {
  const harness = createGameHarness({ seed, partySize, depth: 1 });
  for (const character of harness.runState.party) fillProtocolDeck(character, classDataFor(harness.data, character));
  fillInventoryWithLoot(harness, inventoryTarget);
  fillEventLog(harness.runState, logCount);
  const container = harness.floor.containers?.[0];
  if (!container) throw new Error('density fixture: floor has no containers');
  const walk = walkTo(harness, container);
  if (!walk.reached) throw new Error('density fixture: container unreachable');
  const encoded = roundTripRunState(harness.runState).encoded;
  return {
    fragment: encoded.fragment,
    seed,
    partySize,
    containerId: container.id,
    partyPosition: harness.lattice.getPartyPosition()
  };
}

// createCombatDensityFixture — a standard encounter (several enemies) so
// COMBAT is genuinely available with real action/target-list density.
// partyOverrides mirrors the existing touch-flow.spec.js / combat-touch.spec.js
// recipe (short-range weapon, high accuracy) so at least one attack stays
// legal without altering combat behavior.
export function createCombatDensityFixture({ seed = 900302, enemyCount = 3, enemyHP = 20 } = {}) {
  const harness = createGameHarness({ seed, partySize: 1, depth: 1 });
  fillProtocolDeck(harness.runState.party[0], classDataFor(harness.data, harness.runState.party[0]));
  const combat = startStandardCombat(harness, {
    enemyCount,
    enemyHP,
    partyOverrides: [{ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }]
  });
  const party = [...combat.combatState.combatants.values()].find((actor) => actor.side === 'party');
  const encoded = roundTripRunState(harness.runState).encoded;
  return {
    fragment: encoded.fragment,
    partyPos: party.position,
    windowW: combat.combatState.window.width,
    windowH: combat.combatState.window.height
  };
}
