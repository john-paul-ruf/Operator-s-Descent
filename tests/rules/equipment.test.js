import { describe, it, expect } from 'vitest';
import {
  resolveWeaponStats,
  resolveArmorStats,
  getRangeBand,
  getCoverBonus,
  getSalvageValue,
} from '../../src/rules/equipment.js';

describe('resolveWeaponStats — passthrough', () => {
  it('no affixes returns defaults', () => {
    const base = { damageDie: 'd6', rangeBand: 'short', maxRange: 4, minRange: 0, accuracyBonus: 1 };
    const stats = resolveWeaponStats(base, []);
    expect(stats.damageDie).toBe('d6');
    expect(stats.rangeBand).toBe('short');
    expect(stats.maxRange).toBe(4);
    expect(stats.minRange).toBe(0);
    expect(stats.accuracyBonus).toBe(1);
    expect(stats.defenseBonus).toBe(0);
    expect(stats.affixes).toEqual([]);
  });
});

describe('resolveWeaponStats — affix stacking', () => {
  it('edged upgrades d6 → d8', () => {
    const base = { damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1 };
    const stats = resolveWeaponStats(base, [{ id: 'edged', effectData: { dieUpgrade: true } }]);
    expect(stats.damageDie).toBe('d8');
  });
  it('d12 stays d12 (capped)', () => {
    const base = { damageDie: 'd12', rangeBand: 'adjacent', maxRange: 1 };
    const stats = resolveWeaponStats(base, [{ id: 'edged', effectData: { dieUpgrade: true } }]);
    expect(stats.damageDie).toBe('d12');
  });
  it('unknown die string returned unchanged', () => {
    const base = { damageDie: 'd7', rangeBand: 'adjacent', maxRange: 1 };
    const stats = resolveWeaponStats(base, [{ id: 'edged', effectData: { dieUpgrade: true } }]);
    expect(stats.damageDie).toBe('d7');
  });
  it('multiple affixes accumulate accuracyBonus, rangeBonus, defenseBonus', () => {
    const base = { damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 1, defenseBonus: 0 };
    const stats = resolveWeaponStats(base, [
      { id: 'precise', effectData: { accuracyBonus: 1 } },
      { id: 'extended', effectData: { rangeBonus: 2 } },
      { id: 'shielding', effectData: { defenseBonus: 2 } },
    ]);
    expect(stats.accuracyBonus).toBe(2);
    expect(stats.maxRange).toBe(6);
    expect(stats.defenseBonus).toBe(2);
    expect(stats.affixes).toEqual(['precise', 'extended', 'shielding']);
  });
});

describe('resolveArmorStats', () => {
  it('defenseBonus adds from affixes', () => {
    const base = { defenseBonus: 3, finPenalty: -1 };
    const stats = resolveArmorStats(base, [{ id: 'fortified', effectData: { defenseBonus: 2 } }]);
    expect(stats.defenseBonus).toBe(5);
  });
  it('finPenaltyReduction raises penalty but clamps at 0', () => {
    const base = { defenseBonus: 0, finPenalty: -2 };
    const stats = resolveArmorStats(base, [{ id: 'test', effectData: { finPenaltyReduction: 5 } }]);
    expect(stats.finPenalty).toBe(0);
  });
  it('lightweight id adds +1 with same clamp', () => {
    const base = { defenseBonus: 0, finPenalty: -1 };
    const stats = resolveArmorStats(base, [{ id: 'lightweight', effectData: {} }]);
    expect(stats.finPenalty).toBe(0);
  });
  it('both finPenaltyReduction and lightweight together still ≤ 0', () => {
    const base = { defenseBonus: 0, finPenalty: -2 };
    const stats = resolveArmorStats(base, [
      { id: 'lightweight', effectData: { finPenaltyReduction: 1 } },
    ]);
    expect(stats.finPenalty).toBe(0);
  });
});

describe('getRangeBand', () => {
  it('distance < 0 → out-of-range', () => {
    expect(getRangeBand({ rangeBand: 'short', maxRange: 4, minRange: 0 }, -1)).toBe('out-of-range');
  });
  it('distance > maxRange → out-of-range', () => {
    expect(getRangeBand({ rangeBand: 'short', maxRange: 4, minRange: 0 }, 5)).toBe('out-of-range');
  });
  it('long band below minRange → too-close', () => {
    expect(getRangeBand({ rangeBand: 'long', maxRange: 16, minRange: 3 }, 2)).toBe('too-close');
  });
  it('distance <= 1 → point-blank (even for long weapon with minRange 0)', () => {
    expect(getRangeBand({ rangeBand: 'long', maxRange: 16, minRange: 0 }, 1)).toBe('point-blank');
  });
  it('distance exactly maxRange is in range (returns band)', () => {
    expect(getRangeBand({ rangeBand: 'short', maxRange: 4, minRange: 0 }, 4)).toBe('short');
  });
  it('returns weapon band for normal distance', () => {
    expect(getRangeBand({ rangeBand: 'medium', maxRange: 8, minRange: 0 }, 5)).toBe('medium');
  });
});

describe('getCoverBonus', () => {
  function makeGrid(w, h, walls) {
    const grid = [];
    for (let y = 0; y < h; y++) {
      grid.push(new Array(w).fill('floor'));
    }
    for (const [x, y] of walls) grid[y][x] = 'wall';
    return grid;
  }

  it('adjacent (steps <= 1) → 0', () => {
    const grid = makeGrid(10, 10, []);
    expect(getCoverBonus(grid, 5, 5, 5, 4)).toBe(0);
    expect(getCoverBonus(grid, 5, 5, 4, 5)).toBe(0);
  });
  it('one intervening wall → 2 (horizontal)', () => {
    const grid = makeGrid(10, 10, [[3, 5]]);
    expect(getCoverBonus(grid, 5, 5, 1, 5)).toBe(2);
  });
  it('two+ intervening walls → 4', () => {
    const grid = makeGrid(10, 10, [[2, 5], [4, 5]]);
    expect(getCoverBonus(grid, 6, 5, 1, 5)).toBe(4);
  });
  it('clear line → 0', () => {
    const grid = makeGrid(10, 10, []);
    expect(getCoverBonus(grid, 5, 5, 1, 5)).toBe(0);
  });
  it('works for vertical line', () => {
    const grid = makeGrid(10, 10, [[5, 3]]);
    expect(getCoverBonus(grid, 5, 5, 5, 1)).toBe(2);
  });
  it('works for diagonal line', () => {
    const grid = makeGrid(10, 10, [[2, 2]]);
    expect(getCoverBonus(grid, 4, 4, 0, 0)).toBe(2);
  });
});

describe('getSalvageValue', () => {
  it('{salvageValue: 3} → 3', () => {
    expect(getSalvageValue({ salvageValue: 3 })).toBe(3);
  });
  it('{} → 0', () => {
    expect(getSalvageValue({})).toBe(0);
  });
});