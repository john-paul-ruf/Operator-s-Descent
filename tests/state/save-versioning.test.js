import { beforeAll, describe, it, expect } from 'vitest';
import { initCondenser } from '../../src/state/condense.js';
import { decodeRunPayload, encodeRunPayload } from '../../src/state/save-schema.js';
import { readV3Payload } from '../../src/state/versions/read-v3.js';
import { loadData } from '../helpers/data.js';
import { buildRealisticRun } from '../helpers/run-builder.js';

beforeAll(() => initCondenser(loadData('symbol-table')));

describe('frozen v3 reader parity', () => {
  it('readV3Payload decodes a live-encoded v3 payload identically to decodeRunPayload', () => {
    for (const seed of [1, 7, 42, 99]) {
      const state = buildRealisticRun(seed, { depth: (seed % 20) + 1, inventoryItems: seed % 5, echoes: seed % 3 });
      const payload = encodeRunPayload(state);
      const live = decodeRunPayload(payload.bytes, payload.bitLength);
      const frozen = readV3Payload(payload.bytes, payload.bitLength);
      expect(frozen.worldSeed).toBe(live.worldSeed);
      expect(frozen.tableVersion).toBe(live.tableVersion);
      expect(frozen.runState.serialize()).toEqual(live.runState.serialize());
    }
  });

  it('readV3Payload rejects a non-v3 schemaVersion with version_mismatch', () => {
    const state = buildRealisticRun(3, { depth: 4 });
    const payload = encodeRunPayload(state);
    const mutated = payload.bytes.slice();
    mutated[0] = 4;
    expect(() => readV3Payload(mutated, payload.bitLength)).toThrow('version_mismatch');
  });
});
