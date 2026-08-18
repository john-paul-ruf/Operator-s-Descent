import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it, expect } from 'vitest';
import { initCondenser } from '../../src/state/condense.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { decodeRunPayload, encodeRunPayload } from '../../src/state/save-schema.js';
import { readV3Payload } from '../../src/state/versions/read-v3.js';
import { loadData } from '../helpers/data.js';
import { buildRealisticRun } from '../helpers/run-builder.js';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/save-versions/', import.meta.url));

beforeAll(() => initCondenser(loadData('symbol-table')));

function readCorpus(prefix) {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.txt'))
    .sort()
    .map((name) => ({ name, fragment: readFileSync(`${FIXTURES_DIR}${name}`, 'utf8').trim() }));
}

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

describe('golden v3 corpus (Custom Rule 13)', () => {
  const corpus = readCorpus('v3-');
  it('captures at least three v3 fixtures', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(3);
  });
  it.each(corpus.map(({ name, fragment }) => [name, fragment]))('%s decodes to a valid, playable runState', (_name, fragment) => {
    const result = decodeRun(fragment);
    expect(result.success).toBe(true);
    expect(result.runState).toBeTruthy();
    expect(Number.isInteger(result.runState.worldSeed)).toBe(true);
    expect(result.runState.party.length).toBeGreaterThan(0);
    expect(result.runState.party.some((character) => (character.currentHP ?? character.hp ?? 0) > 0)).toBe(true);
  });
});
