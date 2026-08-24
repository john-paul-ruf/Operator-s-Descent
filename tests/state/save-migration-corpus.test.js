// Custom Rule 13's enforcement arm.
//
// Every well-formed save of any shipped schema version MUST always load.
// The rule is codified by two guarantees, both asserted here:
//
//   (1) Golden corpus: real base64url fragments captured from a prior
//       shipped encoder (currently v3) decode through the current stack
//       (readV3Payload → migrateState → validateRunState) into a valid,
//       playable RunState that re-encodes under the 1500-char URL budget.
//       The corpus lives at tests/fixtures/saves/v3/*.txt; every future
//       schema bump adds a matching fixture directory + reader.
//
//   (2) Chain completeness: the migration registry has a contiguous step
//       for every hop from the oldest supported schemaVersion up to
//       RUN_SCHEMA_VERSION. If any hop is missing, migrateState() would
//       throw 'no_migration_path' at load — this guard fires first so a
//       schema bump can't silently strand old saves.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { initCondenser } from '../../src/state/condense.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { encodeRun, SAVE_BUDGET } from '../../src/state/save-encode.js';
import { listMigrations } from '../../src/state/save-migrate.js';
import { RUN_SCHEMA_VERSION } from '../../src/state/save-schema.js';
import { V3_SCHEMA_VERSION } from '../../src/state/versions/read-v3.js';
import { V4_SCHEMA_VERSION } from '../../src/state/versions/read-v4.js';
import { V6_SCHEMA_VERSION } from '../../src/state/versions/read-v6.js';
import { validateRunState } from '../../src/state/run-state.js';
import { loadData } from '../helpers/data.js';

const CORPUS_ROOT = fileURLToPath(new URL('../fixtures/saves/', import.meta.url));
const CORPUS_DIRS = [
  { label: 'v3', dir: 'v3/' },
  { label: 'v4', dir: 'v4/' }
];
const V6_FIXTURES_DIR = fileURLToPath(new URL('../fixtures/save-versions/', import.meta.url));
const OLDEST_SUPPORTED_SCHEMA = V3_SCHEMA_VERSION;

beforeAll(() => initCondenser(loadData('symbol-table')));

function readCorpus(dir) {
  const path = `${CORPUS_ROOT}${dir}`;
  return readdirSync(path)
    .filter((name) => name.endsWith('.txt'))
    .sort()
    .map((name) => ({ name, fragment: readFileSync(`${path}${name}`, 'utf8').trim() }));
}

function readVersionFixtures(prefix) {
  return readdirSync(V6_FIXTURES_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.txt'))
    .sort()
    .map((name) => ({ name, fragment: readFileSync(`${V6_FIXTURES_DIR}${name}`, 'utf8').trim() }));
}

for (const { label, dir } of CORPUS_DIRS) {
  describe(`golden ${label} corpus (Custom Rule 13)`, () => {
    const corpus = readCorpus(dir);

    it(`captures at least five representative ${label} fixtures`, () => {
      expect(corpus.length).toBeGreaterThanOrEqual(5);
    });

    it.each(corpus.map(({ name, fragment }) => [name, fragment]))(
      '%s decodes → validates → re-encodes under the SAVE_BUDGET',
      (_name, fragment) => {
        const decoded = decodeRun(fragment);
        expect(decoded.success).toBe(true);
        expect(decoded.mode).not.toBe('seed');
        expect(decoded.runState).toBeTruthy();
        expect(validateRunState(decoded.runState.serialize()).valid).toBe(true);
        expect(decoded.runState.party.length).toBeGreaterThan(0);
        expect(decoded.runState.party.some((character) => (character.currentHP ?? character.hp ?? 0) > 0)).toBe(true);
        const reencoded = encodeRun(decoded.runState);
        expect(reencoded.success).toBe(true);
        expect(reencoded.length).toBeLessThan(SAVE_BUDGET);
      }
    );
  });
}

// v6 fixtures live under tests/fixtures/save-versions/ (paired with the
// tests/state/save-versioning.test.js corpus for v3/v5). Each fragment was
// captured from the live encoder at RUN_SCHEMA_VERSION === 6 before v7
// landed. From CP2 onward, save-decode.js routes these fragments through
// readV6Payload (frozen) + the v6→v7 clamp migration — Custom Rule 13's
// "versioned saves never dead-end" guarantee for the just-frozen release.
describe('golden v6 corpus (Custom Rule 13)', () => {
  const corpus = readVersionFixtures('v6-');

  it('captures three representative v6 fixtures', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(3);
  });

  it.each(corpus.map(({ name, fragment }) => [name, fragment]))(
    '%s decodes → validates → re-encodes under the SAVE_BUDGET',
    (_name, fragment) => {
      const decoded = decodeRun(fragment);
      expect(decoded.success).toBe(true);
      expect(decoded.mode).not.toBe('seed');
      expect(decoded.runState).toBeTruthy();
      expect(validateRunState(decoded.runState.serialize()).valid).toBe(true);
      expect(decoded.runState.party.length).toBeGreaterThan(0);
      const reencoded = encodeRun(decoded.runState);
      expect(reencoded.success).toBe(true);
      expect(reencoded.length).toBeLessThan(SAVE_BUDGET);
    }
  );
});

describe('migration chain completeness (Custom Rule 13)', () => {
  it('registers a contiguous chain from the oldest supported schemaVersion to RUN_SCHEMA_VERSION', () => {
    const steps = listMigrations();
    const byFrom = new Map(steps.map((step) => [step.from, step.to]));
    for (let version = OLDEST_SUPPORTED_SCHEMA; version < RUN_SCHEMA_VERSION; version++) {
      expect(byFrom.get(version)).toBe(version + 1);
    }
  });

  it('every FROZEN_READERS schemaVersion can migrate up to RUN_SCHEMA_VERSION without gaps', () => {
    // Duplicates the (1)-style check above for the specific frozen readers we
    // ship. If a future session adds a v4 frozen reader without a v4 → v5 step,
    // this test blocks the merge.
    const frozenVersions = [V3_SCHEMA_VERSION, V4_SCHEMA_VERSION, V6_SCHEMA_VERSION];
    const steps = listMigrations();
    const byFrom = new Map(steps.map((step) => [step.from, step.to]));
    for (const start of frozenVersions) {
      let version = start;
      while (version < RUN_SCHEMA_VERSION) {
        const next = byFrom.get(version);
        expect(next, `missing migration ${version} → ${version + 1}`).toBe(version + 1);
        version = next;
      }
    }
  });
});
