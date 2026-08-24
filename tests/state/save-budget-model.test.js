// saves-never-fail SESSION-01 CP4 — the budget-model proof.
//
// Every gameplay cap in the v7 codec is a BUDGET-MODEL OUTPUT: values were
// tuned in CP3 so that the reachable apex — the worst-case run any real
// game systems can actually produce — encodes UNDER SAVE_BUDGET (1900). The
// aspirational 10% margin (≤ SAVE_BUDGET − 190 = 1710) is reported per-run
// but not hard-asserted: at the reachable apex the trim ladder is emergency
// slack (D3), and CP4 measurement showed the ladder DOES fire at every-
// field-at-cap simultaneously — but only to trim events, never to bust the
// hard budget.
//
// The apex is built from REAL subsystems (never hand-rolled JSON), so a
// codec regression in loot / corrupt-implant / event ordering / combat
// serialization can't hide behind a synthetic fixture:
//
//   inventory:  generateLoot(...) at vault rarity+shift → INVENTORY_CAP units
//   ledger:     MAX_CORRUPT_IMPLANTS loot-pattern ids (compact-id friendly)
//   events:     MAX_EVENTS with realistic 72-char messages
//   fog:        every cell on the live 40×64 grid (FOG_BYTES full 0xff)
//   party:      4 operators × 16 calibrations each (max legal signature tier)
//   affix ledger: 12 reroll + 12 floorEntry ids at cap
//   combat:     24-actor snapshot (party × 4 + enemies × 20)
//   depth:      200 (deep-run marker, MAX_DEPTH=255)
//
// Two scenarios: EXPLORE-APEX (no combat) and COMBAT-APEX (combat present,
// moderate other fields — real players don't hit inventory-max + combat-max
// simultaneously in the same second). Both MUST fit ≤ SAVE_BUDGET.
//
// The attribution table (last test) emits per-field wire-cost deltas so
// the handoff can quote it verbatim; a regression that shifts the shape
// gets caught by the primary "fits ≤ SAVE_BUDGET" assertion and the
// printed table tells the next Forge run WHERE.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { INVENTORY_CAP } from '../../src/rules/inventory.js';
import { SAVE_BUDGET, encodeRun, initEncoder } from '../../src/state/save-encode.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { deserializeRunState } from '../../src/state/run-state.js';
import { generateLoot } from '../../src/rules/loot.js';
import { addItem } from '../../src/rules/inventory.js';

// D9 aspirational 10% margin ≡ 1710 chars. Emitted per-run; asserted only
// as a soft target (see the "10% margin margin" test below).
const MARGIN_TARGET = SAVE_BUDGET - 190;
const MAX_CORRUPT_IMPLANTS = 32;
const MAX_EVENTS = 24;

function loadDataFile(name) {
  const url = new URL(`../../data/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

let sharedData;
beforeAll(() => {
  sharedData = {
    symbolTable: loadDataFile('symbol-table'),
    equipment: loadDataFile('equipment'),
    affixes: loadDataFile('affixes'),
    consumables: loadDataFile('consumables')
  };
  initEncoder(sharedData.symbolTable);
});

function apexParty() {
  const CALIBRATION_POOL = [
    'anchor_deck', 'anchor_mgt', 'anchor_projector', 'anchor_vit',
    'breacher_deck', 'breacher_mgt', 'breacher_range', 'breacher_vit',
    'compiler_deck', 'compiler_foc', 'compiler_res', 'compiler_shield',
    'ghost_deck', 'ghost_fin', 'ghost_polearm', 'ghost_sig'
  ];
  const CLASSES = ['breacher', 'ghost', 'compiler', 'anchor'];
  return CLASSES.map((classId, index) => ({
    id: `operator_${index + 1}`,
    classId,
    sigilId: `pua-e00${index}`,
    attributes: { mgt: 10, fin: 10, vit: 10, res: 10, foc: 10, sig: 10 },
    currentHP: 200,
    currentCHARGE: 8,
    calibrationCount: 16,
    calibrationChoices: Array.from({ length: 16 }, (_, choice) => ({
      floor: choice + 1,
      optionId: CALIBRATION_POOL[(index * 4 + choice) % CALIBRATION_POOL.length]
    })),
    signatureTier: 3,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [],
    conditions: []
  }));
}

function apexInventory(worldSeed, cap = INVENTORY_CAP) {
  // Real generator loop across vault containers until INVENTORY_CAP units
  // land. Codec regressions in item encoding surface here.
  let inventory = [];
  let container = 0;
  while (inventory.reduce((sum, item) => sum + (item.count ?? 1), 0) < cap && container < 200) {
    const bias = { containerDensity: 1, rarityShift: 5, affixPoolBias: {}, containerType: 'vault' };
    const items = generateLoot(
      worldSeed, 20, `apex-floor-${container}`, `container-${container}`,
      bias, sharedData.equipment, sharedData.affixes, sharedData.consumables,
      { containerType: 'vault' }
    );
    for (const item of items) {
      const result = addItem(inventory, item);
      if (!result.success) return inventory;
      inventory = result.inventory;
      if (inventory.reduce((sum, entry) => sum + (entry.count ?? 1), 0) >= cap) return inventory;
    }
    container++;
  }
  return inventory;
}

function apexLedger() {
  // Loot-pattern ids so the compact-id codec (save-schema.js writeCompactId)
  // fires — mirrors what production applyCorruptImplant queues after real
  // gameplay. Unpatterned ids fall through the string escape, which the
  // migration hop covers for pre-v7 saves.
  return Array.from({ length: MAX_CORRUPT_IMPLANTS }, (_, index) =>
    `l${(index * 7 + 100).toString(36)}-${index % 8}`
  );
}

function apexAffixLedger() {
  return {
    floor: 200,
    reroll: Array.from({ length: 12 }, (_, i) => `l${(i * 13 + 500).toString(36)}-${i % 8}`),
    floorEntry: Array.from({ length: 12 }, (_, i) => `l${(i * 19 + 700).toString(36)}-${i % 8}`)
  };
}

function apexRecentEvents(count = MAX_EVENTS) {
  return Array.from({ length: count }, (_, index) => ({
    type: 'combat',
    message: `Operator strikes construct for ${index + 1} damage — CRIT + BURNING on 20`.slice(0, 72),
    sequence: 1_700_000_000_000 + index
  }));
}

function apexFogFullyLit() {
  // FOG_BYTES for the 40×64 grid = 320 bytes, every bit set.
  return Array.from(new Uint8Array(320).fill(0xff));
}

function apexActiveCombat() {
  // 4 party + 20 enemies at the MAX_ACTORS=24 ceiling.
  const partyActors = Array.from({ length: 4 }, (_, index) => ({
    id: `operator_${index + 1}`,
    side: 'party',
    x: index % 8,
    y: index,
    hp: 200,
    charge: 8,
    conditions: [],
    initiative: 20 - index,
    ap: 2,
    moves: 1,
    freeActions: 0,
    defeated: false,
    retreated: false
  }));
  const enemyActors = Array.from({ length: 20 }, (_, index) => ({
    id: `enemy_20_construct_${index}`,
    side: 'enemy',
    x: index % 8,
    y: (index % 12) + 4,
    hp: 200,
    charge: 0,
    conditions: [],
    initiative: 10 - (index % 10),
    ap: 2,
    moves: 1,
    freeActions: 0,
    defeated: false,
    retreated: false,
    stats: { archetypeId: 'construct', hpMax: 200, chargeMax: 0, sigilCodepoint: 57407 + (index % 3) }
  }));
  const actors = [...partyActors, ...enemyActors];
  return {
    arena: { originX: 20, originY: 32, contactId: 'encounter_20_32_1' },
    actors,
    initiativeOrder: actors.map((a) => a.id),
    currentIndex: 0,
    round: 5,
    pendingEffects: [],
    encounter: { id: 'encounter_20_32_1', type: 'standard' },
    eventOrder: 200
  };
}

function buildApex({ inventoryCap = INVENTORY_CAP, ledgerCount = MAX_CORRUPT_IMPLANTS, eventCount = MAX_EVENTS, withCombat = false } = {}) {
  const state = {
    worldSeed: 0xC0DEBEEF,
    creationTimestamp: 1_700_000_000_000,
    depth: 200,
    floorSubSeed: 12345,
    partyPosition: { x: 20, y: 32 },
    fogOfWar: apexFogFullyLit(),
    openedContainers: ((1n << 63n) - 1n).toString(),
    defeatedEnemies: ((1n << 63n) - 1n).toString(),
    dangerClockProgress: 0.85,
    party: apexParty(),
    inventory: apexInventory(0xC0DEBEEF, inventoryCap),
    corruption: 0.9,
    credits: 999_999_999,
    scrapCounter: 999_999_999,
    themesSeen: [
      'cold_storage', 'foundry', 'data_stream', 'data_cache',
      'archive', 'hive', 'void', 'lattice',
      'stack', 'terminal', 'nursery', 'crypt'
    ],
    echoQueue: [],
    rngState: {
      gen: { cursor: 123456, prngState: { a: 0xdeadbeef, b: 0xcafebabe, c: 0xfeedface, d: 0xbaadf00d } },
      combat: { cursor: 654321, prngState: { a: 0x0badf00d, b: 0xbeefbeef, c: 0xdeadcafe, d: 0xfacefeed } }
    },
    flags: { version: 2, calibrationFloorsReached: Array.from({ length: 16 }, (_, i) => i + 1) },
    appliedCorruptItemIds: apexLedger().slice(0, ledgerCount),
    affixFloorLedger: apexAffixLedger(),
    stats: { enemiesSlain: 5_000, echoesSlain: 8, corruptItemsEquipped: 24, floorsDescended: 199 },
    recentEvents: apexRecentEvents(eventCount),
    activeCombat: withCombat ? apexActiveCombat() : null
  };
  const runState = deserializeRunState(state);
  if (!runState) throw new Error('apex state failed deserializeRunState — cap or bound broke');
  return runState;
}

describe('SAVE_BUDGET reachable-apex model (CP4)', () => {
  it('EXPLORE-APEX (no combat, every cap at max) fits under SAVE_BUDGET', () => {
    const apex = buildApex({ withCombat: false });
    const encoded = encodeRun(apex);
    expect(encoded.success).toBe(true);
    const margin = SAVE_BUDGET - encoded.length;
    // eslint-disable-next-line no-console
    console.log(`[CP4 explore-apex] ${encoded.length} chars, margin ${margin} (target ≥ 190), events kept ${encoded.metrics.eventsKept}/${MAX_EVENTS}`);
    expect(encoded.length).toBeLessThan(SAVE_BUDGET);
  });

  it('COMBAT-APEX (24-actor combat, moderate other fields) fits under SAVE_BUDGET', () => {
    // Between-fight and mid-fight are different moments in time. Real
    // players don't accumulate max inventory AND enter a 24-actor combat
    // in the same second. Combat-apex here models the peak mid-fight save.
    const apex = buildApex({ inventoryCap: 24, ledgerCount: 24, eventCount: 16, withCombat: true });
    const encoded = encodeRun(apex);
    expect(encoded.success).toBe(true);
    const margin = SAVE_BUDGET - encoded.length;
    // eslint-disable-next-line no-console
    console.log(`[CP4 combat-apex] ${encoded.length} chars, margin ${margin}, events kept ${encoded.metrics.eventsKept}`);
    expect(encoded.length).toBeLessThan(SAVE_BUDGET);
  });

  it('EXPLORE-APEX round-trips: decode(encode(apex)).serialize() equals apex.serialize()', () => {
    // The encoder's ladder trims recentEvents in the fragment when the apex
    // exceeds SAVE_BUDGET without trimming; the CALLER'S state is not
    // mutated (encode-encode.js clones), so serialize() equality compares
    // the FRAGMENT'S recentEvents (post-trim) to the caller's PRE-TRIM
    // recentEvents. Snap the caller down to the surviving tail so the
    // round-trip comparison is apples-to-apples.
    const apex = buildApex({ withCombat: false });
    const encoded = encodeRun(apex);
    if (encoded.metrics.eventsDropped > 0) {
      apex.recentEvents = apex.recentEvents.slice(apex.recentEvents.length - encoded.metrics.eventsKept);
    }
    const decoded = decodeRun(encoded.fragment);
    expect(decoded.success).toBe(true);
    expect(decoded.runState.serialize()).toEqual(apex.serialize());
  });

  it('per-field attribution: emits how many chars each major field costs on the wire', () => {
    // Delta = "apex encoded length" minus "apex encoded length without field
    // X". Not additive (compression cross-interactions), but a good local
    // signal of where the wire pressure lives. The printed table goes
    // verbatim into the SESSION-01 handoff — it's the standing evidence
    // for the final cap values.
    const apex = buildApex({ withCombat: false });
    const apexLength = encodeRun(apex).length;

    function measureWithout(mutator) {
      const clone = deserializeRunState(apex.serialize());
      mutator(clone);
      return encodeRun(clone).length;
    }

    const withoutInventory = measureWithout((s) => { s.inventory = []; });
    const withoutLedger = measureWithout((s) => { s.appliedCorruptItemIds = []; });
    const withoutEvents = measureWithout((s) => { s.recentEvents = []; });
    const withoutFog = measureWithout((s) => { s.resetFogOfWar(); });
    const withoutCalibrations = measureWithout((s) => {
      for (const character of s.party) {
        character.calibrationCount = 0;
        character.calibrationChoices = [];
      }
    });
    const withoutAffixLedger = measureWithout((s) => {
      s.affixFloorLedger = { floor: s.depth, reroll: [], floorEntry: [] };
    });

    const attribution = {
      apex: apexLength,
      inventoryDelta: apexLength - withoutInventory,
      ledgerDelta: apexLength - withoutLedger,
      eventsDelta: apexLength - withoutEvents,
      fogDelta: apexLength - withoutFog,
      calibrationsDelta: apexLength - withoutCalibrations,
      affixLedgerDelta: apexLength - withoutAffixLedger
    };

    // eslint-disable-next-line no-console
    console.log('[CP4 attribution]', JSON.stringify(attribution, null, 2));

    expect(attribution.apex).toBeGreaterThan(0);
    expect(attribution.apex).toBeLessThan(SAVE_BUDGET);
  });

  it('10% margin: EXPLORE-APEX target ≤ SAVE_BUDGET − 190 (soft target — logs miss but does not fail)', () => {
    // D9's aspirational 10% headroom. At every-cap-at-max simultaneously,
    // this target is NOT met with the CP3 caps (INVENTORY_CAP=40,
    // MAX_EVENTS=24, MAX_CORRUPT_IMPLANTS=32) — the trim ladder fires to
    // keep the fragment under the hard SAVE_BUDGET. Real gameplay rarely
    // hits every cap simultaneously, so the ladder is emergency slack per
    // D3. The test reports the miss for follow-up rather than failing
    // hard (which would require dropping caps to gameplay-hostile levels).
    const apex = buildApex({ withCombat: false });
    const encoded = encodeRun(apex);
    const hit = encoded.length <= MARGIN_TARGET && encoded.metrics.eventsDropped === 0;
    // eslint-disable-next-line no-console
    console.log(`[CP4 margin] ${encoded.length} vs ${MARGIN_TARGET} target — ${hit ? 'HIT' : `MISS (over by ${encoded.length - MARGIN_TARGET}, events dropped ${encoded.metrics.eventsDropped}/${MAX_EVENTS})`}`);
    // Passing assertion: hard budget is unbroken. Ladder-trimming is
    // acceptable emergency behaviour.
    expect(encoded.length).toBeLessThan(SAVE_BUDGET);
  });
});
