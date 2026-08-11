import { describe, it, expect } from 'vitest';
import { generateFloor, GENERATION_VERSION } from '../../src/floor/generator.js';
import { validateFloor } from '../../src/floor/validator.js';
import { enemyCountScale, thresholdFloor } from '../../src/rules/scaling.js';
import { ARCHETYPES, GRID_W, GRID_H } from '../../src/floor/archetypes.js';
import { loadData } from '../helpers/data.js';

const themesData = loadData('themes');
const SEEDS = [1, 42, 999];
const FLOORS = [1, 5, 10];
const ARCH_KEYS = Object.keys(ARCHETYPES);
const THEME_IDS = themesData.themes.map(t => t.id);

function gen(seed, floor) {
  return generateFloor(seed, floor, {}, themesData);
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
        expect(f).toHaveProperty('entryPoint');
        expect(f).toHaveProperty('floorSubSeed');

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
        const maxEnemies = enemyCountScale(baseEnemyCount, floor) + (thresholdFloor(floor) ? 1 : 0);
        expect(f.enemySpawns.length).toBeLessThanOrEqual(maxEnemies);

        expect(THEME_IDS).toContain(f.themeId);
        expect(ARCH_KEYS).toContain(f.archetypeId);
        expect(typeof f.floorSubSeed).toBe('number');
      });
    }
  }
});

describe('generateFloor — determinism & cursor isolation', () => {
  it('full determinism: same (seed, floor) → deep-equal floors', () => {
    const f1 = generateFloor(42, 5, {}, themesData);
    const f2 = generateFloor(42, 5, {}, themesData);
    expect(f1).toEqual(f2);
  });

  it('different floorNumber (1 vs 2) → different floor', () => {
    const f1 = gen(42, 1);
    const f2 = gen(42, 2);
    expect(f1).not.toEqual(f2);
  });

  it('generation does not depend on external cursor state', () => {
    const f1 = generateFloor(42, 5, {}, themesData);
    const f2 = generateFloor(42, 5, {}, themesData);
    expect(f1).toEqual(f2);
  });

  it('floorSubSeed replay: same seed + floor + subSeed → same floor', () => {
    const f1 = gen(42, 5);
    const f2 = generateFloor(42, 5, { floorSubSeed: f1.floorSubSeed }, themesData);
    expect(f1).toEqual(f2);
  });
});

describe('generateFloor — all floors are valid', () => {
  it('every floor in a 9-run sweep passes validation', () => {
    for (const seed of SEEDS) {
      for (const floor of FLOORS) {
        const f = gen(seed, floor);
        const result = validateFloor(f);
        expect(result.valid).toBe(true);
        expect(result.failures).toEqual([]);
      }
    }
  });

  it('every floor in a 150-run sweep passes validation', () => {
    const sweepSeeds = Array.from({ length: 30 }, (_, i) => i + 1);
    const sweepFloors = [1, 3, 7, 10, 15];
    for (const seed of sweepSeeds) {
      for (const floor of sweepFloors) {
        const f = gen(seed, floor);
        const result = validateFloor(f);
        expect(result.valid).toBe(true);
        expect(result.failures).toEqual([]);
      }
    }
  });
});

describe('generateFloor — degenerate-input tolerance', () => {
  it('single-theme with minimal fields → floor still valid', () => {
    const minimal = {
      themes: [{ id: 'test_theme', lootBias: {} }],
    };
    const f = generateFloor(42, 1, {}, minimal);
    expect(f.cells.length).toBe(GRID_H);
    expect(f.cells[0].length).toBe(GRID_W);
    expect(f.themeId).toBe('test_theme');
    expect(ARCH_KEYS).toContain(f.archetypeId);
    expect(f.containers.length).toBeGreaterThanOrEqual(1);
    expect(validateFloor(f).valid).toBe(true);
  });

  it('theme without enemyMixWeights → spawns are all drones', () => {
    const noEnemyMix = {
      themes: [{ id: 'no_mix', lootBias: {} }],
    };
    const f = generateFloor(42, 1, {}, noEnemyMix);
    for (const e of f.enemySpawns) {
      expect(e.archetypeId).toBe('drone');
    }
  });

  it('containerDensity 3 → containers.length ≤ 9 and ≥ 1', () => {
    const highDensity = {
      themes: [{ id: 'dense_loot', lootBias: { containerDensity: 3 } }],
    };
    const f = generateFloor(42, 1, {}, highDensity);
    expect(f.containers.length).toBeLessThanOrEqual(9);
    expect(f.containers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('generateFloor — no invalid fallback', () => {
  it('pressure test: heavy dangerous modifier still returns valid floor', () => {
    const pressure = {
      themes: [{
        id: 'pressure',
        archetypeWeights: { caves: 1 },
        modifierWeights: { dangerous: 1 },
        enemyMixWeights: { drone: 1 },
        lootBias: { containerDensity: 1 },
      }],
    };
    const f = generateFloor(42, 1, {}, pressure);
    expect(f.cells.length).toBe(GRID_H);
    expect(f.cells[0].length).toBe(GRID_W);
    expect(f.containers.length).toBeGreaterThanOrEqual(1);
    expect(validateFloor(f).valid).toBe(true);
  });

  it('ultimate all-floor fallback never appears: all floors have containers', () => {
    for (const seed of SEEDS) {
      for (const floor of FLOORS) {
        const f = gen(seed, floor);
        expect(f.containers.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('generateFloor — cloned grid independence', () => {
  it('mutating returned grid does not affect subsequent calls', () => {
    const f1 = gen(42, 5);
    f1.cells[0][0] = 9;
    const f2 = gen(42, 5);
    expect(f2.cells[0][0]).not.toBe(9);
  });
});

describe('generateFloor — generation version', () => {
  it('GENERATION_VERSION is 2', () => {
    expect(GENERATION_VERSION).toBe(2);
  });
});

describe('generateFloor — threshold floor guarantees', () => {
  const THRESHOLD_FLOORS = [10, 20, 30];

  for (const floor of THRESHOLD_FLOORS) {
    it(`floor ${floor}: has threshold flag`, () => {
      const f = gen(42, floor);
      expect(f.threshold).toBe(true);
    });

    it(`floor ${floor}: has at least one vault container`, () => {
      const f = gen(42, floor);
      const vaults = f.containers.filter(c => c.kind === 'vault');
      expect(vaults.length).toBeGreaterThanOrEqual(1);
    });

    it(`floor ${floor}: has at least one elite/apex enemy`, () => {
      const f = gen(42, floor);
      const elites = f.enemySpawns.filter(e => e.elite || e.archetypeId === 'apex');
      expect(elites.length).toBeGreaterThanOrEqual(1);
    });

    it(`floor ${floor}: still passes validation`, () => {
      const f = gen(42, floor);
      const result = validateFloor(f);
      expect(result.valid).toBe(true);
      expect(result.failures).toEqual([]);
    });
  }

  it('non-threshold floor 5: no threshold flag', () => {
    const f = gen(42, 5);
    expect(f.threshold).toBe(false);
  });

  it('non-threshold floor 5: no vault containers', () => {
    const f = gen(42, 5);
    const vaults = f.containers.filter(c => c.kind === 'vault');
    expect(vaults.length).toBe(0);
  });

  it('threshold floor with all themes seen: falls back to normal weighting', () => {
    const allThemes = themesData.themes.map(t => t.id);
    const f = generateFloor(42, 10, { themesSeen: allThemes }, themesData);
    expect(f.threshold).toBe(true);
    expect(THEME_IDS).toContain(f.themeId);
    expect(validateFloor(f).valid).toBe(true);
  });

  it('threshold floor with some themes unseen: selects unseen theme', () => {
    const seenThemes = themesData.themes.slice(0, 6).map(t => t.id);
    for (let attempt = 0; attempt < 10; attempt++) {
      const f = generateFloor(42 + attempt, 10, { themesSeen: seenThemes }, themesData);
      expect(seenThemes).not.toContain(f.themeId);
    }
  });
});