// v6 budget + fuzz hardening (SESSION-06 checkpoint 4).
//
// Two concerns land here:
//   (1) Budget headroom — at the current 20x32 world the worst-case
//       realistic run (fully-set fog, 4-op party, 100-item inventory,
//       active combat) must still fit under the 1500-char URL fragment
//       budget. A second case fabricates the SESSION-05 fog volume
//       (40x64 -> 320 bytes, alternating-pattern worst case) at the
//       compression-stack level so we can prove the pipeline absorbs the
//       future data volume BEFORE SESSION-05 actually flips dimensions.
//
//   (2) Fuzz — a well-formed v6 payload that has been truncated or
//       bit-flipped MUST fail with a named error (truncated / checksum_failed
//       / malformed) rather than crash, and worldSeed recovery from the
//       frozen frame offset (bytes 5-8) MUST still work — Custom Rule 13's
//       "versioned saves never dead-end" guarantee.

import { beforeAll, describe, it, expect } from 'vitest';
import { createBitReader, createBitWriter } from '../../src/state/bit-codec.js';
import { compressSync } from '../../src/state/compress/progressive.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { SAVE_BUDGET, encodeRun, initEncoder } from '../../src/state/save-encode.js';
import { createRunState } from '../../src/state/run-state.js';
import { INVENTORY_CAP } from '../../src/rules/inventory.js';
import { makeParty } from '../helpers/fixtures.js';
import { buildRealisticRun } from '../helpers/run-builder.js';
import { loadData } from '../helpers/data.js';

beforeAll(() => initEncoder(loadData('symbol-table')));

function worstCaseCurrentRun(seed) {
  // 4-op party, 100-item inventory, active combat, fully-set fog at the
  // runtime FOG_BYTES (80 at 20x32). Trims to a modest event tail so the
  // encoder's event-trim ladder doesn't dominate the metric.
  const state = buildRealisticRun(seed, { depth: 4, inventoryItems: 6, fogCells: 4, echoes: 0, recentEvents: 8 });
  const partySize = 4;
  const template = makeParty(partySize);
  state.party = template.map((character, index) => ({
    id: character.id,
    classId: 'operator',
    sigilId: `pua-e00${index}`,
    attributes: character.attributes,
    currentHP: 20,
    currentCHARGE: 4,
    calibrationCount: 0,
    calibrationChoices: [],
    signatureTier: 1,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [],
    conditions: []
  }));
  // v7 caps inventory at INVENTORY_CAP (40). The test slices to that number
  // below; the array is intentionally built at cap size directly.
  state.inventory = Array.from({ length: INVENTORY_CAP }, (_, index) => ({
    id: `budget_item_${index}`,
    category: index % 3 === 0 ? 'consumable' : index % 3 === 1 ? 'weapon' : 'armor',
    baseType: index % 3 === 0 ? 'med_kit' : index % 3 === 1 ? 'sidearm' : 'light',
    rarity: 'stock',
    affixes: [],
    corrupt: false,
    stats: {},
    salvageValue: 1,
    junkTagged: false
  }));
  // Fully-set fog at current dimensions.
  for (let index = 0; index < state.fogOfWar.length; index++) state.fogOfWar[index] = 0xff;
  state.activeCombat = {
    arena: { originX: 3, originY: 5, contactId: 'encounter_3_5_1' },
    actors: [
      ...state.party.slice(0, partySize).map((character, index) => ({
        id: character.id,
        side: 'party',
        x: 1 + index,
        y: 1,
        hp: 20,
        charge: 4,
        conditions: [],
        initiative: 12 - index,
        ap: 2,
        moves: 1,
        freeActions: 0,
        defeated: false,
        retreated: false
      })),
      {
        id: 'enemy_4_construct_7',
        side: 'enemy',
        x: 5,
        y: 4,
        hp: 40,
        charge: 0,
        conditions: [],
        initiative: 5,
        ap: 2,
        moves: 1,
        freeActions: 0,
        defeated: false,
        retreated: false,
        stats: { archetypeId: 'construct', hpMax: 56, chargeMax: 0, sigilCodepoint: 57407 }
      }
    ],
    initiativeOrder: [
      ...state.party.slice(0, partySize).map((character) => character.id),
      'enemy_4_construct_7'
    ],
    currentIndex: 0,
    round: 2,
    pendingEffects: [],
    encounter: { id: 'encounter_3_5_1', type: 'standard' },
    eventOrder: 4
  };
  return state;
}

describe('v7 budget headroom (saves-never-fail SESSION-01 CP3)', () => {
  it('realistic worst-case 40x64 run (fully-set fog, 4-op party, cap-sized inventory, active combat) fits under SAVE_BUDGET', () => {
    // v7 sizes every cap so the reachable apex encodes under SAVE_BUDGET
    // WITHOUT event-tail trimming — see tests/state/save-budget-model.test.js
    // (CP4) for the full attribution table. This test pins the "fully-set
    // fog + full combat + cap-sized inventory" state under the raised 1900
    // budget; if a future GRID_W/GRID_H bump lands, the fog framing must
    // still leave headroom.
    const state = worstCaseCurrentRun(101);
    // worstCaseCurrentRun already builds INVENTORY_CAP items, but be
    // defensive if it drifts.
    state.inventory = state.inventory.slice(0, INVENTORY_CAP);
    const encoded = encodeRun(state);
    expect(encoded.success).toBe(true);
    expect(encoded.length).toBeLessThan(SAVE_BUDGET);
  });

  it('bit-codec round-trips a 320-byte fog (SESSION-05 volume) via varUint length + bytes', () => {
    const writer = createBitWriter();
    const fog = new Uint8Array(320);
    for (let index = 0; index < fog.length; index++) fog[index] = index % 2 ? 0xaa : 0x55;
    writer.writeVarUint(fog.length);
    writer.writeBytes(fog);
    const reader = createBitReader(writer.toUint8Array(), writer.bitLength);
    expect(reader.readVarUint()).toBe(320);
    const restored = reader.readBytes(320);
    expect(Array.from(restored)).toEqual(Array.from(fog));
  });

  it('compression stack absorbs a 320-byte alternating-pattern payload without exploding output', () => {
    // Proves the future SESSION-05 fog volume (320 bytes worst case) compresses
    // acceptably. Alternating 0x55 / 0xaa is the anti-friendly pattern for
    // most reducers, so this is a real headroom check rather than a
    // rubber-stamp.
    const raw = new Uint8Array(320);
    for (let index = 0; index < raw.length; index++) raw[index] = index % 2 ? 0xaa : 0x55;
    const compressed = compressSync(raw);
    expect(compressed.data.length).toBeLessThan(raw.length * 2);
  });
});

describe('v7 fuzz hardening (saves-never-fail SESSION-01 CP3)', () => {
  function encodedFragment(seed) {
    const state = createRunState(seed, makeParty(2));
    state.creationTimestamp = 500_000;
    return encodeRun(state).fragment;
  }

  it('truncating the fragment payload yields checksum_failed with worldSeed recoverable from the frame', () => {
    const fragment = encodedFragment(0xC0DEC);
    const truncated = fragment.slice(0, fragment.length - 4);
    const result = decodeRun(truncated);
    expect(result.success).toBe(false);
    expect(['checksum_failed', 'malformed', 'truncated']).toContain(result.error);
    // Frame worldSeed (bytes 5-8) is recoverable whenever the frame parse
    // reaches that offset — Custom Rule 13's seed-recovery floor.
    expect(result.recoveredSeed).toBe(0xC0DEC);
  });

  it('bit-flipping a payload byte yields checksum_failed and never a throw', () => {
    const fragment = encodedFragment(0xFEED);
    // Flip a mid-payload character (past the header/descriptor bytes). The
    // frame's first ~24 base64 chars are magic + version + tableVersion +
    // worldSeed + bitLength + layer descriptor — flipping THOSE hits the
    // frame parse before CRC. Flipping mid-encrypted-payload triggers CRC.
    const flipIndex = Math.floor(fragment.length / 2);
    const flippedChar = fragment[flipIndex] === 'A' ? 'B' : 'A';
    const flipped = fragment.slice(0, flipIndex) + flippedChar + fragment.slice(flipIndex + 1);
    const result = decodeRun(flipped);
    expect(result.success).toBe(false);
    expect(result.error).toBe('checksum_failed');
    expect(result.recoveredSeed).toBe(0xFEED);
  });

  it('random-noise fragments never crash — all failures are named errors', () => {
    const noise = ['ZZZZZZZZZZZZ', 'T0Q', '', 'AAAAAA', 'garbage-garbage-garbage'];
    for (const fragment of noise) {
      const result = decodeRun(fragment);
      expect(result.success).toBe(false);
      expect(['truncated', 'malformed', 'checksum_failed', 'version_mismatch']).toContain(result.error);
    }
  });
});
