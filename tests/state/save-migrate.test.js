import { afterEach, describe, expect, it } from 'vitest';
import {
  listMigrations,
  migrateState,
  registerMigration,
  resetMigrationsForTests
} from '../../src/state/save-migrate.js';

afterEach(() => resetMigrationsForTests());

describe('save-migrate', () => {
  it('is identity when from === to (no steps needed)', () => {
    const state = { hello: 'v3' };
    const result = migrateState(state, 3, 3);
    expect(result).toEqual({ state, from: 3, to: 3 });
    expect(result.state).toBe(state);
  });

  it('is identity when from === to even after unrelated steps are registered', () => {
    registerMigration({ from: 5, to: 6, migrate: (input) => ({ ...input, touched: 6 }) });
    const state = { hello: 'v3' };
    expect(migrateState(state, 3, 3).state).toBe(state);
  });

  it('applies a single step in order', () => {
    registerMigration({ from: 3, to: 4, migrate: (input) => ({ ...input, at: 4 }) });
    const result = migrateState({ hello: 'v3' }, 3, 4);
    expect(result.state).toEqual({ hello: 'v3', at: 4 });
    expect(result.from).toBe(3);
    expect(result.to).toBe(4);
  });

  it('composes a 2-step chain in order', () => {
    registerMigration({ from: 3, to: 4, migrate: (input) => ({ ...input, at4: true }) });
    registerMigration({ from: 4, to: 5, migrate: (input) => ({ ...input, at5: true }) });
    const result = migrateState({ start: true }, 3, 5);
    expect(result.state).toEqual({ start: true, at4: true, at5: true });
    expect(listMigrations()).toEqual([{ from: 3, to: 4 }, { from: 4, to: 5 }]);
  });

  it('fails no_migration_path when a hop is missing', () => {
    registerMigration({ from: 3, to: 4, migrate: (input) => input });
    // missing 4→5
    expect(() => migrateState({}, 3, 5)).toThrow('no_migration_path');
  });

  it('rejects malformed registrations', () => {
    expect(() => registerMigration({ from: 3, to: 5, migrate: () => ({}) })).toThrow('invalid_migration');
    expect(() => registerMigration({ from: 3, to: 4, migrate: 'not-a-function' })).toThrow('invalid_migration');
    registerMigration({ from: 3, to: 4, migrate: (input) => input });
    expect(() => registerMigration({ from: 3, to: 4, migrate: (input) => input })).toThrow('duplicate_migration');
  });

  it('rejects a from > to range', () => {
    expect(() => migrateState({}, 5, 3)).toThrow('invalid_migration_range');
  });
});
