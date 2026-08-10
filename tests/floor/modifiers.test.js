import { describe, it, expect, fail } from 'vitest';
import { applyModifiers } from '../../src/floor/modifiers.js';
import { createPRNG } from '../../src/core/prng.js';
import { ARCHETYPES } from '../../src/floor/archetypes.js';
import { openCount } from '../helpers/grids.js';

function baseGrid() {
  return ARCHETYPES.chambers(createPRNG(1));
}

describe('applyModifiers — no-op branches', () => {
  it('{none: 1} weights → grid returned unchanged (same reference)', () => {
    const grid = baseGrid();
    const result = applyModifiers(grid, createPRNG(0), { none: 1 });
    expect(result).toBe(grid);
  });

  it('{} weights → unchanged (same reference)', () => {
    const grid = baseGrid();
    const result = applyModifiers(grid, createPRNG(0), {});
    expect(result).toBe(grid);
  });

  it('all-none weights → unchanged (same reference)', () => {
    const grid = baseGrid();
    const result = applyModifiers(grid, createPRNG(0), { none: 1, none2: 1 });
    expect(result).toBe(grid);
  });
});

describe('applyModifiers — branch forcing', () => {
  it('numMods 0 (seed 0: d1≥0.3, d2≥0.2) → grid unchanged', () => {
    const before = baseGrid();
    const snapshot = JSON.parse(JSON.stringify(before));
    const result = applyModifiers(before, createPRNG(0), { dense: 1 });
    expect(result).toEqual(snapshot);
  });

  it('dense forced (seed 5: numMods 1) → open count ≤ before', () => {
    const before = baseGrid();
    const beforeCount = openCount(before);
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { dense: 1 });
    expect(openCount(result)).toBeLessThanOrEqual(beforeCount);
  });

  it('dense only turns floor→wall (no wall→floor)', () => {
    const before = baseGrid();
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { dense: 1 });
    for (let y = 0; y < result.length; y++) {
      for (let x = 0; x < result[0].length; x++) {
        if (before[y][x] === 0 && result[y][x] === 1) {
          fail('dense turned a wall into floor');
        }
      }
    }
  });

  it('sparse forced (seed 5: numMods 1) → open count ≥ before', () => {
    const before = baseGrid();
    const beforeCount = openCount(before);
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { sparse: 1 });
    expect(openCount(result)).toBeGreaterThanOrEqual(beforeCount);
  });

  it('dangerous forced (seed 5: numMods 1) → open count ≤ before', () => {
    const before = baseGrid();
    const beforeCount = openCount(before);
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { dangerous: 1 });
    expect(openCount(result)).toBeLessThanOrEqual(beforeCount);
  });

  it('unknown modifier {fog:1} forced (seed 5) → grid unchanged', () => {
    const before = baseGrid();
    const snapshot = JSON.parse(JSON.stringify(before));
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { fog: 1 });
    expect(result).toEqual(snapshot);
  });

  it('unknown modifier still consumes PRNG draws (twin PRNG check)', () => {
    const pA = createPRNG(5);
    applyModifiers(baseGrid(), pA, { fog: 1 });
    const pB = createPRNG(5);
    pB.next(); pB.next(); pB.nextInt(1);
    expect(pA.getState()).toEqual(pB.getState());
  });
});

describe('applyModifiers — dedupe', () => {
  it('double-roll of dense (seed 24: numMods 2) applies once — walls ≤ 25', () => {
    const before = baseGrid();
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(24), { dense: 1 });
    let walls = 0;
    for (let y = 0; y < before.length; y++) {
      for (let x = 0; x < before[0].length; x++) {
        if (before[y][x] === 1 && result[y][x] === 0) walls++;
      }
    }
    expect(walls).toBeLessThanOrEqual(25);
  });
});