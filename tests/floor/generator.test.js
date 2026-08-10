import { describe, it, expect } from 'vitest';
import { generateFloor } from '../../src/floor/generator.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { validateFloor } from '../../src/floor/validator.js';
import { enemyCountScale } from '../../src/rules/scaling.js';
import { ARCHETYPES, GRID_W, GRID_H } from '../../src/floor/archetypes.js';
import { loadData } from '../helpers/data.js';

const themesData = loadData('themes');
const SEEDS = [1, 42, 999];
const FLOORS = [1, 5, 10];
const ARCH_KEYS = Object.keys(ARCHETYPES);
const THEME_IDS = themesData.themes.map(t => t.id);

function gen(seed, floor) {
  return generateFloor(seed, floor, createRNGCursorForRun(seed), themesData);
}

describe('generateFloor — structural invariants', () => {
  for (const seed of SEEDS) {
    for (const floor of FLOORS) {
      it(`seed ${seed} floor ${floor}: structure valid`, () => {
        const f = gen(seed, floor);
        expect(f).toHaveProperty('cells');
        expect(f).toHaveProperty('descentPoint');
        expect(f).toHaveProperty('containers');
        expect(f).toHaveProperty('enemySpawns');
        expect(f).toHaveProperty('themeId');
        expect(f).toHaveProperty('archetypeId');
        expect(f).toHaveProperty('modifiers');

        expect(f.cells.length).toBe(GRID_H);
        for (const row of f.cells) expect(row.length).toBe(GRID_W);

        let descentCount = 0;
        for (const row of f.cells) {
          for (const cell of row) {
            expect([0, 1, 2, 3]).toContain(cell);
            if (cell === 3) descentCount++;
          }
        }
        expect(descentCount).toBe(1);

        const dp = f.descentPoint;
        expect(f.cells[dp.y][dp.x]).toBe(3);

        for (const c of f.containers) {
          expect(f.cells[c.y][c.x]).toBe(2);
        }
        const containerPositions = new Set(f.containers.map(c => `${c.x},${c.y}`));
        expect(containerPositions.size).toBe(f.containers.length);
        expect(f.containers.map((c, i) => c.id === i).every(Boolean)).toBe(true);
        expect(f.containers.length).toBeGreaterThanOrEqual(1);

        for (const e of f.enemySpawns) {
          expect([1, 2, 3]).toContain(f.cells[e.y][e.x]);
        }
        const theme = themesData.themes.find(t => t.id === f.themeId);
        const enemyKeys = Object.keys(theme.enemyMixWeights);
        for (const e of f.enemySpawns) {
          expect(enemyKeys).toContain(e.archetypeId);
        }
        const baseEnemyCount = 2 + Math.floor(floor / 3);
        expect(f.enemySpawns.length).toBeLessThanOrEqual(enemyCountScale(baseEnemyCount, floor));

        expect(THEME_IDS).toContain(f.themeId);
        expect(ARCH_KEYS).toContain(f.archetypeId);
      });
    }
  }
});

describe('generateFloor — determinism & seeding domains', () => {
  it('full determinism: same (seed, floor) → deep-equal floors and identical gen cursor', () => {
    const c1 = createRNGCursorForRun(42);
    const c2 = createRNGCursorForRun(42);
    const f1 = generateFloor(42, 5, c1, themesData);
    const f2 = generateFloor(42, 5, c2, themesData);
    expect(f1).toEqual(f2);
    expect(c1.getCursor('gen')).toBe(c2.getCursor('gen'));
  });

  it('theme cursor-independence: burning 17 gen draws → same themeId', () => {
    const c1 = createRNGCursorForRun(42);
    const f1 = generateFloor(42, 5, c1, themesData);

    const c2 = createRNGCursorForRun(42);
    for (let i = 0; i < 17; i++) c2.next('gen');
    const f2 = generateFloor(42, 5, c2, themesData);

    expect(f2.themeId).toBe(f1.themeId);
  });

  it('different floorNumber (1 vs 2) → different floor', () => {
    const f1 = gen(42, 1);
    const f2 = gen(42, 2);
    expect(f1).not.toEqual(f2);
  });

  it('combat stream untouched: getCursor("combat") === 0 after generation', () => {
    const c = createRNGCursorForRun(42);
    generateFloor(42, 5, c, themesData);
    expect(c.getCursor('combat')).toBe(0);
  });
});

describe('generateFloor — degenerate-input tolerance', () => {
  it('single-theme with minimal fields → floor still structurally valid', () => {
    const minimal = {
      themes: [{
        id: 'test_theme',
        lootBias: {},
      }],
    };
    const cursor = createRNGCursorForRun(42);
    const f = generateFloor(42, 1, cursor, minimal);
    expect(f.cells.length).toBe(GRID_H);
    expect(f.cells[0].length).toBe(GRID_W);
    expect(f.themeId).toBe('test_theme');
    expect(ARCH_KEYS).toContain(f.archetypeId);
    expect(f.containers.length).toBeGreaterThanOrEqual(1);
  });

  it('theme without enemyMixWeights → spawns are all drones', () => {
    const noEnemyMix = {
      themes: [{
        id: 'no_mix',
        lootBias: {},
      }],
    };
    const cursor = createRNGCursorForRun(42);
    const f = generateFloor(42, 1, cursor, noEnemyMix);
    for (const e of f.enemySpawns) {
      expect(e.archetypeId).toBe('drone');
    }
  });

  it('containerDensity 3 → containers.length ≤ 9 and ≥ 1', () => {
    const highDensity = {
      themes: [{
        id: 'dense_loot',
        lootBias: { containerDensity: 3 },
      }],
    };
    const cursor = createRNGCursorForRun(42);
    const f = generateFloor(42, 1, cursor, highDensity);
    expect(f.containers.length).toBeLessThanOrEqual(9);
    expect(f.containers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('generateFloor — fallback & validity', () => {
  it('pressure test: heavy dangerous + sparse archetype still returns valid structure', () => {
    const pressure = {
      themes: [{
        id: 'pressure',
        archetypeWeights: { organic: 1 },
        modifierWeights: { dangerous: 1 },
        enemyMixWeights: { drone: 1 },
        lootBias: { containerDensity: 1 },
      }],
    };
    const cursor = createRNGCursorForRun(42);
    const f = generateFloor(42, 1, cursor, pressure);
    expect(f.cells.length).toBe(GRID_H);
    expect(f.cells[0].length).toBe(GRID_W);
    expect(f.containers.length).toBeGreaterThanOrEqual(1);
  });

  it('ultimate all-floor fallback signature never appears in normal runs', () => {
    for (const seed of SEEDS) {
      for (const floor of FLOORS) {
        const f = gen(seed, floor);
        const isFallback = f.containers.length === 0 &&
          f.themeId === 'cold_storage' &&
          f.archetypeId === 'chambers';
        expect(isFallback).toBe(false);
      }
    }
  });

  it('≥ 80% valid across the 9-run sweep', () => {
    let validCount = 0;
    for (const seed of SEEDS) {
      for (const floor of FLOORS) {
        const f = gen(seed, floor);
        if (validateFloor(f).valid) validCount++;
      }
    }
    expect(validCount / 9).toBeGreaterThanOrEqual(0.8);
  });
});