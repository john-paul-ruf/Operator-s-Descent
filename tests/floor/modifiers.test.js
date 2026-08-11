import { describe, it, expect } from 'vitest';
import { applyModifiers } from '../../src/floor/modifiers.js';
import { createPRNG } from '../../src/core/prng.js';
import { ARCHETYPES } from '../../src/floor/archetypes.js';
import { openCount } from '../helpers/grids.js';

function baseGrid() {
  return ARCHETYPES.chambers(createPRNG(1));
}

describe('applyModifiers — no-op branches', () => {
  it('{none: 1} weights → grid returned unchanged, modifierIds empty', () => {
    const grid = baseGrid();
    const result = applyModifiers(grid, createPRNG(0), { none: 1 });
    expect(result.grid).toBe(grid);
    expect(result.modifierIds).toEqual([]);
  });

  it('{} weights → unchanged, modifierIds empty', () => {
    const grid = baseGrid();
    const result = applyModifiers(grid, createPRNG(0), {});
    expect(result.grid).toBe(grid);
    expect(result.modifierIds).toEqual([]);
  });

  it('all-none weights → unchanged, modifierIds empty', () => {
    const grid = baseGrid();
    const result = applyModifiers(grid, createPRNG(0), { none: 1, none2: 1 });
    expect(result.grid).toBe(grid);
    expect(result.modifierIds).toEqual([]);
  });
});

describe('applyModifiers — branch forcing', () => {
  it('numMods 0 (seed 0) → grid unchanged', () => {
    const before = baseGrid();
    const snapshot = JSON.parse(JSON.stringify(before));
    const result = applyModifiers(before, createPRNG(0), { dense: 1 });
    expect(result.grid).toEqual(snapshot);
    expect(result.modifierIds).toEqual([]);
  });

  it('dense forced (seed 5) → open count ≤ before, modifierIds has dense', () => {
    const before = baseGrid();
    const beforeCount = openCount(before);
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { dense: 1 });
    expect(openCount(result.grid)).toBeLessThanOrEqual(beforeCount);
    expect(result.modifierIds).toContain('dense');
  });

  it('dense only turns floor→wall (no wall→floor)', () => {
    const before = baseGrid();
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { dense: 1 });
    for (let y = 0; y < result.grid.length; y++) {
      for (let x = 0; x < result.grid[0].length; x++) {
        if (before[y][x] === 0 && result.grid[y][x] === 1) {
          fail('dense turned a wall into floor');
        }
      }
    }
  });

  it('sparse forced (seed 5) → open count ≥ before, modifierIds has sparse', () => {
    const before = baseGrid();
    const beforeCount = openCount(before);
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { sparse: 1 });
    expect(openCount(result.grid)).toBeGreaterThanOrEqual(beforeCount);
    expect(result.modifierIds).toContain('sparse');
  });

  it('dangerous forced (seed 5) → open count ≤ before, modifierIds has dangerous', () => {
    const before = baseGrid();
    const beforeCount = openCount(before);
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { dangerous: 1 });
    expect(openCount(result.grid)).toBeLessThanOrEqual(beforeCount);
    expect(result.modifierIds).toContain('dangerous');
  });

  it('unknown modifier {fog:1} forced (seed 5) → grid unchanged, modifierIds empty', () => {
    const before = baseGrid();
    const snapshot = JSON.parse(JSON.stringify(before));
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { fog: 1 });
    expect(result.grid).toEqual(snapshot);
    expect(result.modifierIds).toEqual([]);
  });

  it('unknown modifier still consumes PRNG draws (twin PRNG check)', () => {
    const pA = createPRNG(5);
    applyModifiers(baseGrid(), pA, { fog: 1 });
    const pB = createPRNG(5);
    pB.next(); pB.next(); pB.nextInt(1);
    expect(pA.getState()).toEqual(pB.getState());
  });
});

describe('applyModifiers — dedupe and uniqueness', () => {
  it('double-roll of dense (seed 24) applies once — modifierIds has at most 1 entry', () => {
    const before = baseGrid();
    const result = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(24), { dense: 1 });
    let walls = 0;
    for (let y = 0; y < before.length; y++) {
      for (let x = 0; x < before[0].length; x++) {
        if (before[y][x] === 1 && result.grid[y][x] === 0) walls++;
      }
    }
    expect(walls).toBeLessThanOrEqual(25);
    expect(new Set(result.modifierIds).size).toBe(result.modifierIds.length);
  });
});

describe('applyModifiers — result shape and determinism', () => {
  it('always returns {grid, modifierIds} object', () => {
    const grid = baseGrid();
    const result = applyModifiers(grid, createPRNG(0), { none: 1 });
    expect(result).toHaveProperty('grid');
    expect(result).toHaveProperty('modifierIds');
    expect(Array.isArray(result.modifierIds)).toBe(true);
  });

  it('determinism: same seed + same weights → same result', () => {
    const before = baseGrid();
    const a = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { dense: 1, sparse: 1, dangerous: 1 });
    const b = applyModifiers(JSON.parse(JSON.stringify(before)), createPRNG(5), { dense: 1, sparse: 1, dangerous: 1 });
    expect(a.grid).toEqual(b.grid);
    expect(a.modifierIds).toEqual(b.modifierIds);
  });

  it('modifierIds ⊆ {dense, sparse, dangerous}', () => {
    const valid = new Set(['dense', 'sparse', 'dangerous']);
    for (const seed of [0, 5, 13, 24, 42, 77]) {
      const result = applyModifiers(baseGrid(), createPRNG(seed), { dense: 1, sparse: 1, dangerous: 1 });
      for (const id of result.modifierIds) {
        expect(valid.has(id)).toBe(true);
      }
    }
  });

  it('numMods never exceeds 2', () => {
    for (const seed of [0, 5, 13, 24, 42, 77, 99, 100, 200]) {
      const result = applyModifiers(baseGrid(), createPRNG(seed), { dense: 1, sparse: 1, dangerous: 1 });
      expect(result.modifierIds.length).toBeLessThanOrEqual(2);
    }
  });
});