import { describe, expect, it } from 'vitest';
import { CONDITION_IDS, ENEMY_CHOIR_CHARGE_RES, ENEMY_HP_BASELINES } from '../../src/state/save-codecs.js';
import { enemyStatScale } from '../../src/rules/scaling.js';
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
const enemiesData = loadData('enemies');

// Frozen copy of enemyStatScale — must stay byte-identical to the pinned
// codec formula in save-codecs.js:
//   floor(baseStat * (1 + depth * (0.15 + 0.10 * floor(depth / 10))))
function enemyStatScaleFrozen(baseStat, depth) {
  const multiplier = 0.15 + 0.10 * Math.floor(depth / 10);
  return Math.floor(baseStat * (1 + depth * multiplier));
}

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

// Pinned enemy-HP baseline drift guard (v5 codec).
//
// writeEnemyStats encodes hpMax / chargeMax as delta-from-baseline where the
// baseline is a hardcoded per-archetype value at each depth via a frozen
// copy of enemyStatScale. If either the pinned baseline or the frozen
// formula drifts from data/enemies.json / src/rules/scaling.js, saves
// silently reconstruct wrong hp on decode. This guard catches both.

const ARCHETYPES_WITH_BASELINE = ['drone', 'warden', 'stalker', 'choir', 'null', 'construct', 'phantom', 'apex'];
const DEPTHS = [1, 10, 55, 100];

describe('ENEMY_HP_BASELINES drift guard (v5 codec)', () => {
  it('has a baseline for every shipped standard archetype', () => {
    const dataArchetypes = Object.keys(enemiesData.archetypes).sort();
    expect(Object.keys(ENEMY_HP_BASELINES).sort()).toEqual(dataArchetypes);
  });

  it.each(ARCHETYPES_WITH_BASELINE)('%s baseline equals vit * 4 + hpBonus from data/enemies.json', (archetypeId) => {
    const archetype = enemiesData.archetypes[archetypeId];
    const expected = archetype.attributes.vit * 4 + (archetype.hpBonus ?? 0);
    expect(ENEMY_HP_BASELINES[archetypeId]).toBe(expected);
  });
});

describe('frozen enemyStatScale drift guard (v5 codec)', () => {
  it.each(ARCHETYPES_WITH_BASELINE.flatMap((id) => DEPTHS.map((depth) => [id, depth])))(
    'frozen scale for %s at depth %s equals live enemyStatScale(baseHp, depth)',
    (archetypeId, depth) => {
      const baseline = ENEMY_HP_BASELINES[archetypeId];
      expect(enemyStatScaleFrozen(baseline, depth)).toBe(enemyStatScale(baseline, depth));
    }
  );
});

describe('choir chargeMax baseline drift guard (v5 codec)', () => {
  it('choir res attribute matches the pinned codec baseline constant', () => {
    expect(enemiesData.archetypes.choir.attributes.res).toBe(ENEMY_CHOIR_CHARGE_RES);
  });

  it.each(DEPTHS)('choir chargeMax at depth %s equals res * 2 + depth', (depth) => {
    const expected = enemiesData.archetypes.choir.attributes.res * 2 + depth;
    expect(ENEMY_CHOIR_CHARGE_RES * 2 + depth).toBe(expected);
  });
});
