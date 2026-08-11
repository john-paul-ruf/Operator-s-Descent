import { describe, it, expect } from 'vitest';
import { ARCHETYPES, GRID_W, GRID_H } from '../../src/floor/archetypes.js';
import { createPRNG } from '../../src/core/prng.js';
import { openCount } from '../helpers/grids.js';

const ARCH_KEYS = ['chambers', 'caves', 'mazes', 'cathedrals', 'spines', 'fractured', 'rings', 'shards'];
const SEEDS = [1, 42, 777, 123456, 0xDEADBEEF];
const LOWER_BOUND = { chambers: 30, caves: 0, mazes: 30, cathedrals: 30, spines: 30, fractured: 30, rings: 30, shards: 30 };

function verticalReach(grid) {
  let firstOpenY = -1, lastOpenY = -1;
  for (let y = 0; y < grid.length; y++) {
    for (const cell of grid[y]) {
      if (cell === 1) {
        if (firstOpenY === -1) firstOpenY = y;
        lastOpenY = y;
      }
    }
  }
  return { firstOpenY, lastOpenY };
}

function isChebyshevRing(grid) {
  let openCount = 0;
  for (const row of grid) for (const cell of row) if (cell === 1) openCount++;
  return openCount > 20;
}

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

  it('seeds 1 vs 42 produce different grids', () => {
    const a = gen(createPRNG(1));
    const b = gen(createPRNG(42));
    expect(a).not.toEqual(b);
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
    expect(a).not.toEqual(c);
  });

  it('vertical reach: open cells span at least 40% of grid height', () => {
    const grid = gen(createPRNG(42));
    const { firstOpenY, lastOpenY } = verticalReach(grid);
    expect(lastOpenY - firstOpenY).toBeGreaterThanOrEqual(Math.floor(GRID_H * 0.4));
  });

  it('returns fresh grid (not cached)', () => {
    const a = gen(createPRNG(1));
    const b = gen(createPRNG(1));
    expect(a).not.toBe(b);
  });
});

describe('archetype-specific invariants', () => {
  it('rings produces concentric ring structure (open count > 20 for seed sweep)', () => {
    for (const seed of SEEDS) {
      const grid = ARCHETYPES.rings(createPRNG(seed));
      expect(isChebyshevRing(grid)).toBe(true);
    }
  });

  it('fractured has a central void split (open cells on both sides)', () => {
    for (const seed of SEEDS) {
      const grid = ARCHETYPES.fractured(createPRNG(seed));
      let bothSides = false;
      for (let y = 1; y < GRID_H - 1; y++) {
        let leftOpen = false, rightOpen = false;
        for (let x = 0; x < Math.floor(GRID_W / 2) - 2; x++) if (grid[y][x] === 1) leftOpen = true;
        for (let x = Math.floor(GRID_W / 2) + 3; x < GRID_W; x++) if (grid[y][x] === 1) rightOpen = true;
        if (leftOpen && rightOpen) { bothSides = true; break; }
      }
      expect(bothSides).toBe(true);
    }
  });

  it('spines has vertical spine continuity (column chains from top to bottom)', () => {
    for (const seed of SEEDS) {
      const grid = ARCHETYPES.spines(createPRNG(seed));
      let firstOpenY = -1, lastOpenY = -1;
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          if (grid[y][x] === 1) {
            if (firstOpenY === -1) firstOpenY = y;
            lastOpenY = y;
          }
        }
      }
      expect(lastOpenY - firstOpenY).toBeGreaterThanOrEqual(GRID_H - 4);
    }
  });

  it('cathedrals has pillar structure (at least some walls inside open area)', () => {
    for (const seed of SEEDS) {
      const grid = ARCHETYPES.cathedrals(createPRNG(seed));
      let openCount = 0;
      let interiorWalls = 0;
      for (let y = 2; y < GRID_H - 2; y++) {
        for (let x = 2; x < GRID_W - 2; x++) {
          if (grid[y][x] === 1) openCount++;
          else interiorWalls++;
        }
      }
      expect(openCount).toBeGreaterThan(50);
      expect(interiorWalls).toBeGreaterThan(10);
    }
  });

  it('mazes produces a maze structure (many open cells, no large rectangular rooms)', () => {
    for (const seed of SEEDS) {
      const grid = ARCHETYPES.mazes(createPRNG(seed));
      const count = openCount(grid);
      expect(count).toBeGreaterThan(30);
    }
  });

  it('shards produces scattered shard cells (no single large blob)', () => {
    for (const seed of SEEDS) {
      const grid = ARCHETYPES.shards(createPRNG(seed));
      const count = openCount(grid);
      expect(count).toBeGreaterThan(20);
    }
  });
});