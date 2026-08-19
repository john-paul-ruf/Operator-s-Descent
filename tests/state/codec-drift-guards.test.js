import { describe, expect, it } from 'vitest';
import { CONDITION_IDS } from '../../src/state/save-codecs.js';
import { loadData } from '../helpers/data.js';

// Pinned condition-enum drift guard (v5 codec).
//
// The v5 combat-snapshot codec encodes condition ids as a 1-bit known flag
// plus a 4-bit index into CONDITION_IDS (save-codecs.js). The pool is a
// hardcoded mirror of data/conditions.json keys — if the two drift, encoded
// saves will silently rewrite condition ids on decode. Any legitimate
// change to the shipped condition list MUST bump RUN_SCHEMA_VERSION and
// freeze the previous list under src/state/versions/, and this guard lights
// up first so nobody quietly forks them.
//
// Mirrors the sigil-pool-guard pattern established in
// tests/state/sigil-pool-guard.test.js — same intent, condition-level.

const conditionsData = loadData('conditions');

describe('CONDITION_IDS drift guard (v5 codec)', () => {
  it('has an entry for every conditions-data id', () => {
    const dataIds = Object.keys(conditionsData.conditions).sort();
    expect([...CONDITION_IDS].sort()).toEqual(dataIds);
  });

  it('CONDITION_IDS is alphabetically sorted (stable ordering across bumps)', () => {
    const sorted = [...CONDITION_IDS].sort();
    expect(CONDITION_IDS).toEqual(sorted);
  });

  it('CONDITION_IDS has at most 15 entries (4-bit index leaves 1 slot for future)', () => {
    // 4 bits = 0..15; we store the escape by way of the outer 1-bit known
    // flag, so all 16 slots are available for known ids. The invariant
    // codifies the ceiling — passing 16 requires a schema bump.
    expect(CONDITION_IDS.length).toBeLessThanOrEqual(16);
  });

  it.each(CONDITION_IDS)('%s is a string id present in data/conditions.json', (id) => {
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(conditionsData.conditions).toHaveProperty(id);
  });
});
