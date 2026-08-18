import { describe, expect, it } from 'vitest';
import { ENEMY_STAT_SIGIL_POOLS } from '../../src/state/save-codecs.js';
import { loadData } from '../helpers/data.js';

// v4 combat-snapshot codec encodes known archetype+sigil combos as a 2-bit
// variant index (writeEnemyStats in save-codecs.js). The pool table is a
// hardcoded mirror of data/enemies.json.archetypes[id].sigilCodepoints — if
// those two ever drift, encoded saves silently corrupt the sigil column on
// decode (wrong codepoint or invalid_actor). Any legitimate change to the
// pools MUST bump RUN_SCHEMA_VERSION alongside the enemies-data edit, and
// this test lights up first so nobody quietly forks them.

const enemiesData = loadData('enemies');

describe('ENEMY_STAT_SIGIL_POOLS drift guard (Issue 3)', () => {
  it('has an entry for every enemies-data archetype (echo excluded — no pool)', () => {
    const archetypeIds = Object.keys(enemiesData.archetypes).sort();
    const poolIds = Object.keys(ENEMY_STAT_SIGIL_POOLS).sort();
    expect(poolIds).toEqual(archetypeIds);
  });

  it.each(Object.keys(ENEMY_STAT_SIGIL_POOLS))(
    'pool for %s matches archetypes[%s].sigilCodepoints exactly',
    (archetypeId) => {
      const dataCodepoints = enemiesData.archetypes[archetypeId]?.sigilCodepoints;
      expect(Array.isArray(dataCodepoints)).toBe(true);
      expect(ENEMY_STAT_SIGIL_POOLS[archetypeId]).toEqual(dataCodepoints);
    }
  );

  it('every pool has exactly 3 codepoints (the 2-bit variant index encodes 0..3)', () => {
    for (const [archetypeId, pool] of Object.entries(ENEMY_STAT_SIGIL_POOLS)) {
      expect(pool.length, `${archetypeId} pool length`).toBe(3);
    }
  });
});
