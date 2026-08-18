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
import { encodeRun } from '../../src/state/save-encode.js';
import { listMigrations } from '../../src/state/save-migrate.js';
import { RUN_SCHEMA_VERSION } from '../../src/state/save-schema.js';
import { V3_SCHEMA_VERSION } from '../../src/state/versions/read-v3.js';
import { validateRunState } from '../../src/state/run-state.js';
import { loadData } from '../helpers/data.js';

const CORPUS_DIR = fileURLToPath(new URL('../fixtures/saves/v3/', import.meta.url));
const BUDGET = 1500;
const OLDEST_SUPPORTED_SCHEMA = V3_SCHEMA_VERSION;

beforeAll(() => initCondenser(loadData('symbol-table')));

function readCorpus() {
  return readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith('.txt'))
    .sort()
    .map((name) => ({ name, fragment: readFileSync(`${CORPUS_DIR}${name}`, 'utf8').trim() }));
}

describe('golden v3 corpus (Custom Rule 13)', () => {
  const corpus = readCorpus();

  it('captures at least five representative v3 fixtures', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(5);
  });

  it.each(corpus.map(({ name, fragment }) => [name, fragment]))(
    '%s decodes → validates → re-encodes under the 1500-char URL budget',
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
      expect(reencoded.length).toBeLessThan(BUDGET);
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
    const frozenVersions = [V3_SCHEMA_VERSION];
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
