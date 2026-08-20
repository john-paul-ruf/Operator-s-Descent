import { describe, expect, it, beforeAll } from 'vitest';
import { createBitWriter } from '../../src/state/bit-codec.js';
import { initCondenser } from '../../src/state/condense.js';
import { decodeRunPayload, encodeRunPayload, RUN_SCHEMA_FIELDS, RUN_SCHEMA_VERSION } from '../../src/state/save-schema.js';
import { loadData } from '../helpers/data.js';
import { buildMaximumRun, buildRealisticRun } from '../helpers/run-builder.js';

beforeAll(() => initCondenser(loadData('symbol-table')));

function roundTrip(state) {
  const payload = encodeRunPayload(state);
  const decoded = decodeRunPayload(payload.bytes, payload.bitLength);
  expect(decoded.worldSeed).toBe(state.worldSeed);
  expect(decoded.runState.serialize()).toEqual(state.serialize());
  return payload;
}

describe('RunState v2 binary schema', () => {
  it('defines a fixed ordered schema and round-trips a property sweep', () => {
    expect(RUN_SCHEMA_VERSION).toBe(6);
    expect(RUN_SCHEMA_FIELDS).toEqual([
      'schemaVersion', 'tableVersion', 'worldSeed', 'creationTimestamp', 'depth', 'floorSubSeed',
      'partyPosition', 'fogOfWar', 'openedContainers', 'defeatedEnemies', 'dangerClockProgress',
      'party', 'inventory', 'corruption', 'credits', 'scrapCounter', 'themesSeen', 'echoQueue',
      'rngState', 'calibrationFloorsReached', 'appliedCorruptItemIds', 'affixFloorLedger', 'stats', 'recentEvents', 'extensions', 'activeCombat'
    ]);
    for (let seed = 1; seed <= 25; seed++) {
      const state = buildRealisticRun(seed, { depth: (seed % 20) + 1, inventoryItems: seed % 12, fogCells: seed * 7, echoes: seed % 3 });
      state.recordEvent({ seed, type: 'move' });
      roundTrip(state);
    }
  });

  it('round-trips the valid maximum state including active combat', () => {
    const state = buildMaximumRun(42);
    const payload = roundTrip(state);
    expect(payload.bytes.length).toBeGreaterThan(0);
    expect(payload.bitLength).toBeLessThanOrEqual(payload.bytes.length * 8);
  });

  it('round-trips an active combat snapshot with the v4 slim enemy stat block', () => {
    // v4 wire format: standard-archetype enemies only carry the per-instance
    // fields (archetypeId, hpMax, chargeMax, sigilCodepoint). Runtime
    // re-derives attributes/defense/behavior/protocolAccess from
    // (archetypeId, depth) via deriveEnemyStats — see
    // tests/integration/combat-snapshot-stats.test.js for the derivation path.
    const state = buildRealisticRun(11, { depth: 4 });
    state.activeCombat = {
      arena: { originX: 3, originY: 5, contactId: 'encounter_3_5_1' },
      actors: [
        { id: 'operator_1', side: 'party', x: 1, y: 1, hp: 22, charge: 4, conditions: [], initiative: 12, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false },
        {
          id: 'enemy_4_construct_7',
          side: 'enemy',
          x: 3,
          y: 4,
          hp: 48,
          charge: 0,
          conditions: [],
          initiative: 7,
          ap: 2,
          moves: 1,
          freeActions: 0,
          defeated: false,
          retreated: false,
          stats: { archetypeId: 'construct', hpMax: 56, chargeMax: 0, sigilCodepoint: 57407 }
        }
      ],
      initiativeOrder: ['operator_1', 'enemy_4_construct_7'],
      currentIndex: 0,
      round: 1,
      pendingEffects: [],
      encounter: { id: 'encounter_3_5_1', type: 'standard' },
      eventOrder: 0
    };
    const payload = roundTrip(state);
    const decoded = decodeRunPayload(payload.bytes, payload.bitLength);
    const restoredEnemy = decoded.runState.activeCombat.actors.find((actor) => actor.side === 'enemy');
    expect(restoredEnemy.stats).toEqual({ archetypeId: 'construct', hpMax: 56, chargeMax: 0, sigilCodepoint: 57407 });
  });

  it('round-trips a choir enemy stat block (chargeMax > 0, sigil in pool)', () => {
    // Choir carries chargeMax > 0 (caster) and its protocolAccess object
    // is re-derived on restore rather than persisted — this test only
    // pins the wire round-trip for the slim block.
    const state = buildRealisticRun(13, { depth: 6 });
    state.activeCombat = {
      arena: { originX: 2, originY: 2, contactId: 'encounter_2_2_1' },
      actors: [
        { id: 'operator_1', side: 'party', x: 0, y: 0, hp: 20, charge: 3, conditions: [], initiative: 15, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false },
        {
          id: 'enemy_6_choir_9',
          side: 'enemy',
          x: 4,
          y: 5,
          hp: 12,
          charge: 6,
          conditions: [],
          initiative: 8,
          ap: 2,
          moves: 1,
          freeActions: 0,
          defeated: false,
          retreated: false,
          stats: { archetypeId: 'choir', hpMax: 12, chargeMax: 20, sigilCodepoint: 57401 }
        }
      ],
      initiativeOrder: ['operator_1', 'enemy_6_choir_9'],
      currentIndex: 0,
      round: 2,
      pendingEffects: [],
      encounter: { id: 'encounter_2_2_1', type: 'hunt' },
      eventOrder: 4
    };
    const payload = roundTrip(state);
    const decoded = decodeRunPayload(payload.bytes, payload.bitLength);
    const restoredEnemy = decoded.runState.activeCombat.actors.find((actor) => actor.side === 'enemy');
    expect(restoredEnemy.stats).toEqual({ archetypeId: 'choir', hpMax: 12, chargeMax: 20, sigilCodepoint: 57401 });
  });

  it('round-trips an echo actor with the full inline template (echoes are not archetype-derivable)', () => {
    // Echoes carry party-character attributes that cannot be derived from
    // an archetype id, so the v4 codec still writes the full template
    // inline when archetypeId === 'echo'. sigilCodepoint falls outside
    // ENEMY_STAT_SIGIL_POOLS['echo'] (there is no echo pool) and always
    // encodes as a 21-bit raw codepoint.
    const state = buildRealisticRun(17, { depth: 5 });
    const echoStats = {
      archetypeId: 'echo',
      attributes: { mgt: 8, fin: 6, vit: 7, res: 4, foc: 5, sig: 3 },
      defense: 14,
      protocolDefense: 11,
      hpMax: 32,
      chargeMax: 4,
      behavior: 'echo',
      retreats: false,
      sigilCodepoint: 57351,
      protocolAccess: null
    };
    state.activeCombat = {
      arena: { originX: 1, originY: 1, contactId: 'encounter_1_1_1' },
      actors: [
        { id: 'operator_1', side: 'party', x: 0, y: 0, hp: 18, charge: 2, conditions: [], initiative: 10, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false },
        {
          id: 'echo_operator_1_5',
          side: 'echo',
          x: 3,
          y: 3,
          hp: 32,
          charge: 4,
          conditions: [],
          initiative: 6,
          ap: 2,
          moves: 1,
          freeActions: 0,
          defeated: false,
          retreated: false,
          stats: echoStats
        }
      ],
      initiativeOrder: ['operator_1', 'echo_operator_1_5'],
      currentIndex: 0,
      round: 1,
      pendingEffects: [],
      encounter: { id: 'encounter_1_1_1', type: 'standard' },
      eventOrder: 0
    };
    const payload = roundTrip(state);
    const decoded = decodeRunPayload(payload.bytes, payload.bitLength);
    const restoredEcho = decoded.runState.activeCombat.actors.find((actor) => actor.side !== 'party');
    expect(restoredEcho.stats).toEqual(echoStats);
  });

  it('round-trips bounded CORRUPT and per-floor affix ledgers without a schema bump', () => {
    const state = buildRealisticRun(42);
    state.appliedCorruptItemIds = ['corrupt-item'];
    state.affixFloorLedger = { floor: state.depth, reroll: ['lucky-item'], floorEntry: ['shield-item'] };
    roundTrip(state);
  });

  it('rejects incompatible versions, duplicate IDs, impossible counts, and non-zero trailing data', () => {
    const payload = encodeRunPayload(buildRealisticRun(4));
    const wrongVersion = payload.bytes.slice();
    wrongVersion[0] = RUN_SCHEMA_VERSION + 1;
    expect(() => decodeRunPayload(wrongVersion, payload.bitLength)).toThrow('version_mismatch');
    const priorVersion = payload.bytes.slice();
    priorVersion[0] = RUN_SCHEMA_VERSION - 1;
    expect(() => decodeRunPayload(priorVersion, payload.bitLength)).toThrow('version_mismatch');

    const duplicate = buildRealisticRun(5, { inventoryItems: 2 });
    duplicate.inventory[1].id = duplicate.inventory[0].id;
    expect(() => encodeRunPayload(duplicate)).toThrow('duplicate_item');

    const impossibleParty = createBitWriter();
    impossibleParty.writeUint(RUN_SCHEMA_VERSION, 8);
    impossibleParty.writeUint(1, 16);
    impossibleParty.writeUint(1, 32);
    impossibleParty.writeVarUint(1);
    impossibleParty.writeUint(1, 8);
    impossibleParty.writeUint(0, 32);
    impossibleParty.writeUint(0, 5);
    impossibleParty.writeUint(0, 5);
    impossibleParty.writeBytes(new Uint8Array(80));
    impossibleParty.writeUint(0, 32);
    impossibleParty.writeUint(0, 32);
    impossibleParty.writeUint(0, 32);
    impossibleParty.writeUint(0, 32);
    impossibleParty.writeBytes(new Uint8Array(8));
    impossibleParty.writeUint(0, 7);
    impossibleParty.writeUint(1, 8);
    impossibleParty.writeUint(0, 4);
    impossibleParty.writeUint(0, 4);
    impossibleParty.writeUint(0, 3);
    expect(() => decodeRunPayload(impossibleParty.toUint8Array(), impossibleParty.bitLength)).toThrow('invalid_party');
    const readerPayload = encodeRunPayload(buildRealisticRun(6));
    const inflated = new Uint8Array(readerPayload.bytes.length + 1);
    inflated.set(readerPayload.bytes);
    inflated[inflated.length - 1] = 1;
    expect(() => decodeRunPayload(inflated, readerPayload.bitLength + 8)).toThrow('trailing_data');
  });
});
