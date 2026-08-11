import { describe, it, expect } from 'vitest';
import { generateFloor } from '../../src/floor/generator.js';
import { validateFloor } from '../../src/floor/validator.js';
import { createLattice } from '../../src/exploration/lattice.js';
import { ARCHETYPES } from '../../src/floor/archetypes.js';
import { reachable } from '../helpers/grids.js';
import { loadData } from '../helpers/data.js';
import { createRunState } from '../../src/state/run-state.js';
import { beginFloorTransition, completeFloorTransition } from '../../src/rules/progression.js';

const themesData = loadData('themes');
const THEME_IDS = themesData.themes.map(t => t.id);
const ARCH_KEYS = Object.keys(ARCHETYPES);

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const FLOORS = [1, 3, 7, 10, 15];

const records = [];
for (const seed of SEEDS) {
  for (const floor of FLOORS) {
    const f = generateFloor(seed, floor, {}, themesData);
    const validation = validateFloor(f);
    records.push({ seed, floorNumber: floor, floor: f, valid: validation.valid, failures: validation.failures, metrics: validation.metrics });
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
      expect(f).toHaveProperty('entryPoint');
      expect(f).toHaveProperty('floorSubSeed');
    });
  }
});

describe('floor pipeline — all 150 floors pass validation', () => {
  for (const rec of records) {
    it(`seed ${rec.seed} floor ${rec.floorNumber}: valid (no failures)`, () => {
      expect(rec.valid).toBe(true);
      expect(rec.failures).toEqual([]);
    });
  }
});

describe('floor pipeline — reachability (all floors)', () => {
  for (const rec of records) {
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
      it(`seed ${seed} floor ${floor}: fresh call reproduces deep-equal floor`, () => {
        const f1 = generateFloor(seed, floor, {}, themesData);
        const f2 = generateFloor(seed, floor, {}, themesData);
        expect(f1).toEqual(f2);
      });
    }
  }

  it('sequential generation is reproducible (two sequential runs → pairwise deep-equal)', () => {
    const seed = 42;
    const run1 = [];
    const run2 = [];
    for (const floor of [1, 2, 3, 4, 5]) {
      run1.push(generateFloor(seed, floor, {}, themesData));
    }
    for (const floor of [1, 2, 3, 4, 5]) {
      run2.push(generateFloor(seed, floor, {}, themesData));
    }
    for (let i = 0; i < 5; i++) {
      expect(run1[i]).toEqual(run2[i]);
    }
  });

  it('theme stability: themeId for (seed, floor) identical across calls', () => {
    const seed = 7;
    for (const floor of [1, 3, 7, 10, 15]) {
      const f1 = generateFloor(seed, floor, {}, themesData);
      const f2 = generateFloor(seed, floor, {}, themesData);
      expect(f2.themeId).toBe(f1.themeId);
    }
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

function makeTCharacter(id) {
  return {
    id, classId: 'breacher', sigilId: 'pua-e000',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    currentHP: 30, currentCHARGE: 4,
    calibrationCount: 0, calibrationChoices: [], signatureTier: 1,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [], conditions: []
  };
}

describe('floor pipeline — multi-floor transition', () => {
  it('5 sequential transitions produce valid floors with correct depth and theme tracking', () => {
    const classData = loadData('classes');
    const state = createRunState(42, [makeTCharacter('a')], { depth: 1, creationTimestamp: 1 });

    for (let i = 2; i <= 6; i++) {
      const begin = beginFloorTransition(state, { classes: classData });
      expect(begin.error).toBeUndefined();
      const result = completeFloorTransition(state, begin.transitionToken, {},
        { data: { classes: classData }, themesData });
      expect(result.error).toBeUndefined();
      expect(result.runState.depth).toBe(i);
      expect(result.floor.cells).toBeDefined();
      expect(result.floor.descentPoint).toBeDefined();
      expect(result.floor.entryPoint).toBeDefined();

      const v = validateFloor(result.floor);
      expect(v.valid).toBe(true);

      expect(result.runState.themesSeen.has(result.floor.themeId)).toBe(true);

      state.depth = result.runState.depth;
      state.fogOfWar = result.runState.fogOfWar;
      state.openedContainers = result.runState.openedContainers;
      state.defeatedEnemies = result.runState.defeatedEnemies;
      state.dangerClockProgress = result.runState.dangerClockProgress;
      state.partyPosition = result.runState.partyPosition;
      state.themesSeen = result.runState.themesSeen;
      state.party = result.runState.party;
      state.flags = result.runState.flags;
      state.affixFloorLedger = result.runState.affixFloorLedger;
    }
  });

  it('transition to floor 3 triggers calibration and applies selection', () => {
    const classData = loadData('classes');
    const state = createRunState(42, [makeTCharacter('a'), makeTCharacter('b')], { depth: 2, creationTimestamp: 1 });
    const begin = beginFloorTransition(state, { classes: classData });
    expect(begin.calibrationRequired).toBe(true);
    expect(begin.offers.length).toBe(2);

    const selections = {};
    for (const offer of begin.offers) {
      selections[offer.characterId] = offer.options[0].id;
    }
    const result = completeFloorTransition(state, begin.transitionToken, selections,
      { data: { classes: classData }, themesData });
    expect(result.error).toBeUndefined();
    expect(result.runState.depth).toBe(3);
    expect(result.runState.party[0].calibrationCount).toBe(1);
    expect(result.runState.party[1].calibrationCount).toBe(1);
  });

  it('repeated transition from same state is deterministic', () => {
    const classData = loadData('classes');
    const state = createRunState(42, [makeTCharacter('a')], { depth: 1, creationTimestamp: 1 });
    const begin1 = beginFloorTransition(state, { classes: classData });
    const r1 = completeFloorTransition(state, begin1.transitionToken, {},
      { data: { classes: classData }, themesData });

    const begin2 = beginFloorTransition(state, { classes: classData });
    const r2 = completeFloorTransition(state, begin2.transitionToken, {},
      { data: { classes: classData }, themesData });
    expect(r1.floor).toEqual(r2.floor);
    expect(r1.runState.partyPosition).toEqual(r2.runState.partyPosition);
  });
});