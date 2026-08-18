// Ordered migration chain for saved RunState objects.
// Each step transforms a deserialized state from one RUN_SCHEMA_VERSION to
// the next. Migrations run in order (from → from+1 → … → to) and the runner
// fails 'no_migration_path' if any hop is missing. Empty chain = identity —
// which is the state SESSION-01 leaves the runner in; SESSION-02 registers
// the first real hop (v3 → v4) once RUN_SCHEMA_VERSION advances.
//
// Registration for the shipped hops happens at module load below. The
// try/catch is idempotent: SESSION-02's save-schema.js also registers the
// identity v3 → v4 step (as a self-contained safety net for its codec
// bump); whichever loader wins races, the loser's registerMigration call
// short-circuits on duplicate_migration and the chain stays intact.

import { v3ToV4 } from './migrations/v3-to-v4.js';

const STEPS = [];

function fail(code) {
  const error = new RangeError(code);
  error.code = code;
  throw error;
}

export function registerMigration({ from, to, migrate }) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to !== from + 1 || typeof migrate !== 'function') fail('invalid_migration');
  if (STEPS.some((step) => step.from === from)) fail('duplicate_migration');
  STEPS.push({ from, to, migrate });
  STEPS.sort((a, b) => a.from - b.from);
}

export function resetMigrationsForTests() {
  STEPS.length = 0;
}

export function listMigrations() {
  return STEPS.map((step) => ({ from: step.from, to: step.to }));
}

export function migrateState(state, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) fail('invalid_migration_range');
  let current = state;
  let version = from;
  while (version < to) {
    const step = STEPS.find((entry) => entry.from === version);
    if (!step) fail('no_migration_path');
    current = step.migrate(current);
    version = step.to;
  }
  return { state: current, from, to };
}

try {
  registerMigration(v3ToV4);
} catch (error) {
  if (error?.code !== 'duplicate_migration') throw error;
}
