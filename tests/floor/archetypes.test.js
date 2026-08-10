import { describe, it, expect } from 'vitest';
import { ARCHETYPES, GRID_W, GRID_H } from '../../src/floor/archetypes.js';
import { createPRNG } from '../../src/core/prng.js';
import { openCount } from '../helpers/grids.js';

const ARCH_KEYS = ['chambers', 'caves', 'maze', 'open', 'organic', 'bastion', 'lattice', 'ruin'];
const SEEDS = [1, 42, 777, 123456, 0xDEADBEEF];
const LOWER_BOUND = { chambers: 30, caves: 0, maze: 30, open: 30, organic: 30, bastion: 30, lattice: 30, ruin: 30 };

describe('archetype registry', () => {
  it('ARCHETYPES has exactly 8 keys', () => {
    expect(Object.keys(ARCHETYPES).sort()).toEqual([...ARCH_KEYS].sort());
  });

  it('all values are functions', () => {
    for (const key of ARCH_KEYS) {
      expect(typeof ARCHETYPES[key]).toBe('function');
    }
  });

  it('GRID_W === 20 and GRID_H === 32', () => {
    expect(GRID_W).toBe(20);
    expect(GRID_H).toBe(32);
  });
});

describe.each(ARCH_KEYS)('archetype: %s', (name) => {
  const gen = ARCHETYPES[name];

  it.each(SEEDS)('seed %d: 32 rows × 20 cols, cells ∈ {0,1}', (seed) => {
    const grid = gen(createPRNG(seed));
    expect(grid.length).toBe(GRID_H);
    for (const row of grid) {
      expect(row.length).toBe(GRID_W);
      for (const cell of row) {
        expect(cell === 0 || cell === 1).toBe(true);
      }
    }
  });

  it.each(SEEDS)('seed %d: determinism — same seed → same grid', (seed) => {
    const a = gen(createPRNG(seed));
    const b = gen(createPRNG(seed));
    expect(a).toEqual(b);
  });

  it('seeds 1 vs 42 produce different grids (or same for PRNG-independent archetypes)', () => {
    const a = gen(createPRNG(1));
    const b = gen(createPRNG(42));
    if (name === 'lattice') {
      expect(a).toEqual(b);
    } else {
      expect(a).not.toEqual(b);
    }
  });

  it.each(SEEDS)('seed %d: openCount within bounds', (seed) => {
    const grid = gen(createPRNG(seed));
    const count = openCount(grid);
    expect(count).toBeGreaterThanOrEqual(LOWER_BOUND[name]);
    expect(count).toBeLessThan(GRID_W * GRID_H);
  });

  it('no shared state mutation: two fresh-PRNG calls are independent', () => {
    const a = gen(createPRNG(1));
    const b = gen(createPRNG(1));
    const c = gen(createPRNG(42));
    expect(a).toEqual(b);
    if (name === 'lattice') {
      expect(a).toEqual(c);
    } else {
      expect(a).not.toEqual(c);
    }
  });
});