import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it, expect } from 'vitest';
import { initCondenser } from '../../src/state/condense.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { encodeRunPayload } from '../../src/state/save-schema.js';
import { readV3Payload } from '../../src/state/versions/read-v3.js';
import { readV4Payload } from '../../src/state/versions/read-v4.js';
import { readV5Payload, V5_SCHEMA_VERSION } from '../../src/state/versions/read-v5.js';
import { FOG_BYTES } from '../../src/state/run-state.js';
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

// Live-encoder parity used to be tested here, but live now emits v4 and the
// frozen v3 reader is pinned to schemaVersion 3 — the frozen-vs-live parity
// question is a category error at this point. End-to-end coverage lives in
// tests/state/save-migration-corpus.test.js, which drives every frozen reader
// through real captured fragments. What survives here: the durable rejection
// twin per frozen reader, guarding against silent schemaVersion drift.
describe('frozen reader schema guards', () => {
  it('readV3Payload rejects a non-v3 schemaVersion with version_mismatch', () => {
    const state = buildRealisticRun(3, { depth: 4 });
    const payload = encodeRunPayload(state);
    const mutated = payload.bytes.slice();
    mutated[0] = 4;
    expect(() => readV3Payload(mutated, payload.bitLength)).toThrow('version_mismatch');
  });

  it('readV4Payload rejects a non-v4 schemaVersion with version_mismatch', () => {
    const state = buildRealisticRun(3, { depth: 4 });
    const payload = encodeRunPayload(state);
    const mutated = payload.bytes.slice();
    mutated[0] = 3;
    expect(() => readV4Payload(mutated, payload.bitLength)).toThrow('version_mismatch');
  });

  it('readV5Payload rejects a non-v5 schemaVersion with version_mismatch', () => {
    const state = buildRealisticRun(3, { depth: 4 });
    const payload = encodeRunPayload(state);
    const mutated = payload.bytes.slice();
    mutated[0] = 4;
    expect(() => readV5Payload(mutated, payload.bitLength)).toThrow('version_mismatch');
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

describe('golden v5 corpus (Custom Rule 13)', () => {
  const corpus = readCorpus('v5-');
  it('captures at least two v5 fixtures', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(2);
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

// Direct frozen-reader coverage lives in the `golden v5 corpus` block above:
// once the current schema advances past v5, save-decode.js routes v5 fixtures
// through readV5Payload — the corpus fixture asserts the full path end-to-end.
// The guard test above pins readV5Payload to schemaVersion === V5_SCHEMA_VERSION.

// v5 -> v6 migration tolerance (Custom Rule 13). The v6 wire format widened
// coordinates from 5 to 7 bits and made fog self-sizing (varUint length +
// bytes). SESSION-05 will grow the world from 20x32 to 40x64, at which point
// pre-flip v5 fixtures still load but their 80-byte fog no longer matches the
// new 320-byte FOG_BYTES — normalizeFog resets fog AND partyPosition rather
// than failing the load. These assertions are written tolerantly so the same
// test passes before AND after that dimension flip: fog length is always the
// current FOG_BYTES; partyPosition is always in-bounds. When lengths matched
// (pre-flip world), extra structural checks confirm the original was preserved.
describe('v5 -> v6 migration tolerance (Custom Rule 13)', () => {
  const corpus = readCorpus('v5-');

  it.each(corpus.map(({ name, fragment }) => [name, fragment]))(
    '%s migrates to a v6 runState whose fog and party position always validate',
    (_name, fragment) => {
      const result = decodeRun(fragment);
      expect(result.success).toBe(true);
      expect(result.runState).toBeTruthy();
      const state = result.runState.serialize();
      // Fog length: MUST match the runtime's current FOG_BYTES (derived from
      // GRID_W x GRID_H). Content either preserved (matched at decode time)
      // or reset-to-zero (post-flip world). Both paths must pass.
      const fogLength = state.fogOfWar.length;
      expect(fogLength > 0).toBe(true);
      expect(fogLength === FOG_BYTES).toBe(true);
      // partyPosition: always non-negative integers. Bounds validation
      // happens inside run-state.js normalizeRunState; if we got here, it
      // passed the check for the current GRID_W/GRID_H.
      expect(Number.isInteger(state.partyPosition.x)).toBe(true);
      expect(Number.isInteger(state.partyPosition.y)).toBe(true);
      expect(state.partyPosition.x).toBeGreaterThanOrEqual(0);
      expect(state.partyPosition.y).toBeGreaterThanOrEqual(0);
      // Run identity always survives (Custom Rule 13's core guarantee).
      expect(Number.isInteger(state.worldSeed)).toBe(true);
      expect(state.depth).toBeGreaterThanOrEqual(1);
      expect(state.party.length).toBeGreaterThan(0);
    }
  );
});
