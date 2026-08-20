import { describe, it, expect } from 'vitest';
import { ARCHETYPES, GRID_W, GRID_H, carveCorridor, widenOneWideCorridors } from '../../src/floor/archetypes.js';
import { createPRNG } from '../../src/core/prng.js';
import { makeGrid, openCount } from '../helpers/grids.js';

function countOneWideCorridors(grid) {
  const h = grid.length;
  const w = grid[0].length;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!(grid[y][x] === 1 || grid[y][x] === 2 || grid[y][x] === 3)) continue;
      const openN = y - 1 >= 0 && [1, 2, 3].includes(grid[y - 1][x]);
      const openS = y + 1 < h && [1, 2, 3].includes(grid[y + 1][x]);
      const openW = x - 1 >= 0 && [1, 2, 3].includes(grid[y][x - 1]);
      const openE = x + 1 < w && [1, 2, 3].includes(grid[y][x + 1]);
      const count = (openN ? 1 : 0) + (openS ? 1 : 0) + (openW ? 1 : 0) + (openE ? 1 : 0);
      if (count === 2 && ((openN && openS) || (openE && openW))) n++;
    }
  }
  return n;
}

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

  it('GRID_W === 40 and GRID_H === 64', () => {
    expect(GRID_W).toBe(40);
    expect(GRID_H).toBe(64);
  });
});

describe.each(ARCH_KEYS)('archetype: %s', (name) => {
  const gen = ARCHETYPES[name];

  it.each(SEEDS)('seed %d: 64 rows × 40 cols, cells ∈ {0,1}', (seed) => {
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

describe('carveCorridor — width parameter', () => {
  it('width=2 default paints a 2-cell-tall X-walk (0,0)→(5,0) covering (0,0)-(5,0) AND (0,1)-(5,1)', () => {
    const grid = makeGrid(GRID_W, GRID_H, 0);
    carveCorridor(grid, 0, 0, 5, 0);
    for (let x = 0; x <= 5; x++) {
      expect(grid[0][x]).toBe(1);
      expect(grid[1][x]).toBe(1);
    }
  });

  it('width=1 (legacy) paints only the single-cell path', () => {
    const grid = makeGrid(GRID_W, GRID_H, 0);
    carveCorridor(grid, 0, 0, 5, 0, 1, 1);
    for (let x = 0; x <= 5; x++) {
      expect(grid[0][x]).toBe(1);
      expect(grid[1][x]).toBe(0);
    }
  });

  it('width=2 paints a 2-cell-wide Y-walk (0,0)→(0,5) covering (0,0)-(0,5) AND (1,0)-(1,5)', () => {
    const grid = makeGrid(GRID_W, GRID_H, 0);
    carveCorridor(grid, 0, 0, 0, 5);
    for (let y = 0; y <= 5; y++) {
      expect(grid[y][0]).toBe(1);
      expect(grid[y][1]).toBe(1);
    }
  });

  it('width=2 landing patch fills 2x2 at destination', () => {
    const grid = makeGrid(GRID_W, GRID_H, 0);
    carveCorridor(grid, 0, 0, 5, 5);
    expect(grid[5][5]).toBe(1);
    expect(grid[5][6]).toBe(1);
    expect(grid[6][5]).toBe(1);
    expect(grid[6][6]).toBe(1);
  });

  it('width=2 respects grid bounds (no overflow beyond edges)', () => {
    const grid = makeGrid(GRID_W, GRID_H, 0);
    // Walk terminates at the far edge: sibling+landing that would go OOB are silently dropped.
    carveCorridor(grid, 0, 0, GRID_W - 1, GRID_H - 1);
    expect(grid[GRID_H - 1][GRID_W - 1]).toBe(1);
  });

  it('width=2 does not overwrite already-placed feature values > value', () => {
    const grid = makeGrid(GRID_W, GRID_H, 0);
    grid[2][3] = 3;
    carveCorridor(grid, 0, 2, 5, 2);
    expect(grid[2][3]).toBe(3);
  });
});

describe('widenOneWideCorridors — dilation', () => {
  it('opens perpendicular neighbor of a hand-carved 1-wide vertical spine', () => {
    const grid = makeGrid(GRID_W, GRID_H, 0);
    for (let y = 1; y <= 6; y++) grid[y][5] = 1;
    const before = countOneWideCorridors(grid);
    expect(before).toBeGreaterThan(0);
    widenOneWideCorridors(grid);
    const after = countOneWideCorridors(grid);
    expect(after).toBeLessThan(before);
    // Interior cells (both N and S open) are 1-wide and get their west neighbor opened.
    // Endpoints (y=1 and y=6) have only one collinear neighbor so are not 1-wide.
    for (let y = 2; y <= 5; y++) expect(grid[y][4]).toBe(1);
  });

  it('leaves fully-wide corridors untouched', () => {
    const grid = makeGrid(GRID_W, GRID_H, 0);
    for (let y = 1; y <= 6; y++) {
      grid[y][5] = 1;
      grid[y][6] = 1;
    }
    const snapshot = JSON.parse(JSON.stringify(grid));
    widenOneWideCorridors(grid);
    expect(grid).toEqual(snapshot);
  });
});

describe('archetype widening — 1-wide corridor budget', () => {
  const gens = ['chambers', 'caves', 'mazes', 'cathedrals', 'spines', 'fractured', 'rings', 'shards'];
  it.each(gens)('archetype %s (seed 1): 1-wide corridor cell count < 20', (name) => {
    const grid = ARCHETYPES[name](createPRNG(1));
    expect(countOneWideCorridors(grid)).toBeLessThan(20);
  });
});