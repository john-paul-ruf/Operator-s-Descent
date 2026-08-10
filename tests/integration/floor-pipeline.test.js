import { describe, it, expect } from 'vitest';
import { generateFloor } from '../../src/floor/generator.js';
import { validateFloor } from '../../src/floor/validator.js';
import { createLattice } from '../../src/exploration/lattice.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { ARCHETYPES } from '../../src/floor/archetypes.js';
import { reachable } from '../helpers/grids.js';
import { loadData } from '../helpers/data.js';

const themesData = loadData('themes');
const THEME_IDS = themesData.themes.map(t => t.id);
const ARCH_KEYS = Object.keys(ARCHETYPES);

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const FLOORS = [1, 3, 7, 10, 15];

const records = [];
for (const seed of SEEDS) {
  for (const floor of FLOORS) {
    const cursor = createRNGCursorForRun(seed);
    const f = generateFloor(seed, floor, cursor, themesData);
    const validation = validateFloor(f);
    records.push({ seed, floorNumber: floor, floor: f, valid: validation.valid, failures: validation.failures });
  }
}

describe('floor pipeline — structural invariants (every floor)', () => {
  for (const rec of records) {
    it(`seed ${rec.seed} floor ${rec.floorNumber}: shape, cell values, positions distinct`, () => {
      const f = rec.floor;
      expect(f.cells.length).toBe(32);
      for (const row of f.cells) expect(row.length).toBe(20);

      let descentCells = 0;
      let containerCells = 0;
      for (const row of f.cells) {
        for (const cell of row) {
          expect([0, 1, 2, 3]).toContain(cell);
          if (cell === 3) descentCells++;
          if (cell === 2) containerCells++;
        }
      }
      expect(descentCells).toBe(1);
      expect(containerCells).toBe(f.containers.length);

      expect(f.cells[f.descentPoint.y][f.descentPoint.x]).toBe(3);
      for (const c of f.containers) {
        expect(f.cells[c.y][c.x]).toBe(2);
      }
      for (const e of f.enemySpawns) {
        expect([1, 2, 3]).toContain(f.cells[e.y][e.x]);
      }

      const positions = new Set();
      positions.add(`${f.descentPoint.x},${f.descentPoint.y}`);
      for (const c of f.containers) {
        const key = `${c.x},${c.y}`;
        expect(positions.has(key)).toBe(false);
        positions.add(key);
      }
      for (const e of f.enemySpawns) {
        const key = `${e.x},${e.y}`;
        expect(positions.has(key)).toBe(false);
        positions.add(key);
      }

      expect(THEME_IDS).toContain(f.themeId);
      expect(ARCH_KEYS).toContain(f.archetypeId);
    });
  }
});

describe('floor pipeline — reachability (valid floors only)', () => {
  const validRecords = records.filter(r => r.valid);
  for (const rec of validRecords) {
    it(`seed ${rec.seed} floor ${rec.floorNumber}: descent + containers reachable from first open cell`, () => {
      const f = rec.floor;
      const lattice = createLattice(f);
      const spawn = lattice.getPartyPosition();

      const reach = reachable(f.cells, spawn.x, spawn.y);
      expect(reach.has(`${f.descentPoint.x},${f.descentPoint.y}`)).toBe(true);

      for (const c of f.containers) {
        expect(reach.has(`${c.x},${c.y}`)).toBe(true);
      }
    });
  }
});

describe('floor pipeline — determinism at scale', () => {
  const checkSeeds = [1, 7, 13, 19, 25];
  const checkFloors = [3, 10];

  for (const seed of checkSeeds) {
    for (const floor of checkFloors) {
      it(`seed ${seed} floor ${floor}: fresh cursor reproduces deep-equal floor`, () => {
        const c1 = createRNGCursorForRun(seed);
        const f1 = generateFloor(seed, floor, c1, themesData);
        const c2 = createRNGCursorForRun(seed);
        const f2 = generateFloor(seed, floor, c2, themesData);
        expect(f1).toEqual(f2);
      });
    }
  }

  it('sequential generation on one cursor is reproducible (two sequential runs → pairwise deep-equal)', () => {
    const seed = 42;
    const run1 = [];
    const c1 = createRNGCursorForRun(seed);
    for (const floor of [1, 2, 3, 4, 5]) {
      run1.push(generateFloor(seed, floor, c1, themesData));
    }
    const run2 = [];
    const c2 = createRNGCursorForRun(seed);
    for (const floor of [1, 2, 3, 4, 5]) {
      run2.push(generateFloor(seed, floor, c2, themesData));
    }
    for (let i = 0; i < 5; i++) {
      expect(run1[i]).toEqual(run2[i]);
    }
  });

  it('theme stability: themeId for (seed, floor) identical across runs', () => {
    const seed = 7;
    for (const floor of [1, 3, 7, 10, 15]) {
      const c1 = createRNGCursorForRun(seed);
      const f1 = generateFloor(seed, floor, c1, themesData);
      const c2 = createRNGCursorForRun(seed);
      for (let i = 0; i < 17; i++) c2.next('gen');
      const f2 = generateFloor(seed, floor, c2, themesData);
      expect(f2.themeId).toBe(f1.themeId);
    }
  });
});

// 84 of 150 floors valid — retry-exhaustion escapes are a design signal
describe('floor pipeline — validation rate', () => {
  it('≥ 80 of 150 floors valid', () => {
    let validCount = 0;
    const failures = [];
    for (const rec of records) {
      if (rec.valid) validCount++;
      else failures.push({ seed: rec.seed, floor: rec.floorNumber, failures: rec.failures });
    }
    expect(validCount).toBeGreaterThanOrEqual(80);
  });
});

describe('floor pipeline — distribution sanity', () => {
  it('≥ 4 distinct archetypeIds across 150 floors', () => {
    const archetypes = new Set(records.map(r => r.floor.archetypeId));
    expect(archetypes.size).toBeGreaterThanOrEqual(4);
    for (const a of archetypes) {
      expect(ARCH_KEYS).toContain(a);
    }
  });

  it('≥ 6 distinct themeIds across 150 floors', () => {
    const themes = new Set(records.map(r => r.floor.themeId));
    expect(themes.size).toBeGreaterThanOrEqual(6);
    for (const t of themes) {
      expect(THEME_IDS).toContain(t);
    }
  });

  it('enemy spawn counts scale: mean at floor 15 > mean at floor 1', () => {
    const floor1Counts = records.filter(r => r.floorNumber === 1).map(r => r.floor.enemySpawns.length);
    const floor15Counts = records.filter(r => r.floorNumber === 15).map(r => r.floor.enemySpawns.length);
    const mean1 = floor1Counts.reduce((a, b) => a + b, 0) / floor1Counts.length;
    const mean15 = floor15Counts.reduce((a, b) => a + b, 0) / floor15Counts.length;
    expect(mean15).toBeGreaterThan(mean1);
  });
});