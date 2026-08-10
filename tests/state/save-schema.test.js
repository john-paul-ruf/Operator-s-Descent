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
    expect(RUN_SCHEMA_VERSION).toBe(2);
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

  it('round-trips bounded CORRUPT and per-floor affix ledgers without a schema bump', () => {
    const state = buildRealisticRun(42);
    state.appliedCorruptItemIds = ['corrupt-item'];
    state.affixFloorLedger = { floor: state.depth, reroll: ['lucky-item'], floorEntry: ['shield-item'] };
    roundTrip(state);
  });

  it('rejects incompatible versions, duplicate IDs, impossible counts, and non-zero trailing data', () => {
    const payload = encodeRunPayload(buildRealisticRun(4));
    const wrongVersion = payload.bytes.slice();
    wrongVersion[0] = 3;
    expect(() => decodeRunPayload(wrongVersion, payload.bitLength)).toThrow('version_mismatch');

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
