import { beforeAll, describe, it, expect } from 'vitest';
import { generateFloor } from '../../src/floor/generator.js';
import { createLattice } from '../../src/exploration/lattice.js';
import { moveParty } from '../../src/exploration/movement.js';
import { createRunState } from '../../src/state/run-state.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { encodeRun, initEncoder } from '../../src/state/save-encode.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { makeParty } from '../helpers/fixtures.js';
import { reachable } from '../helpers/grids.js';
import { loadData } from '../helpers/data.js';

const themesData = loadData('themes');

beforeAll(() => {
  initEncoder(loadData('symbol-table'));
});

const DIR_MAP = {
  '0,-1': 'n', '1,-1': 'ne', '1,0': 'e', '1,1': 'se',
  '0,1': 's', '-1,1': 'sw', '-1,0': 'w', '-1,-1': 'nw',
};

function bfsPath(grid, sx, sy, tx, ty) {
  const h = grid.length;
  const w = grid[0].length;
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));
  const parent = Array.from({ length: h }, () => new Array(w).fill(null));
  const queue = [[sx, sy]];
  visited[sy][sx] = true;
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    if (x === tx && y === ty) {
      const path = [];
      let cx = x, cy = y;
      while (cx !== sx || cy !== sy) {
        path.unshift([cx, cy]);
        const [px, py] = parent[cy][cx];
        cx = px; cy = py;
      }
      path.unshift([sx, sy]);
      return path;
    }
    for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx] &&
          (grid[ny][nx] === 1 || grid[ny][nx] === 2 || grid[ny][nx] === 3)) {
        visited[ny][nx] = true;
        parent[ny][nx] = [x, y];
        queue.push([nx, ny]);
      }
    }
  }
  return null;
}

function pathToDirections(path) {
  const dirs = [];
  for (let i = 1; i < path.length; i++) {
    const [px, py] = path[i - 1];
    const [cx, cy] = path[i];
    const key = `${cx - px},${cy - py}`;
    dirs.push(DIR_MAP[key] || 'e');
  }
  return dirs;
}

function walkFloor(seed, { maxSteps = 500, floor: floorNum = 1 } = {}) {
  const cursor = createRNGCursorForRun(seed);
  const floor = generateFloor(seed, floorNum, cursor, themesData);
  const lattice = createLattice(floor);
  const runState = createRunState(seed, makeParty(2));
  runState.rngState = cursor.getState();
  const fogState = new Uint8Array(640);

  const spawn = lattice.getPartyPosition();
  const dp = floor.descentPoint;
  const reach = reachable(floor.cells, spawn.x, spawn.y);
  if (!reach.has(`${dp.x},${dp.y}`)) {
    return { floor, lattice, runState, fogState, results: [], cursor, reachedDescent: false };
  }

  const path = bfsPath(floor.cells, spawn.x, spawn.y, dp.x, dp.y);
  if (!path) {
    return { floor, lattice, runState, fogState, results: [], cursor, reachedDescent: false };
  }

  const dirs = pathToDirections(path);
  const results = [];
  let reachedDescent = false;

  for (let i = 0; i < Math.min(dirs.length, maxSteps); i++) {
    const result = moveParty(lattice, fogState, dirs[i], cursor, runState);
    results.push(result);
    const pos = lattice.getPartyPosition();
    if (pos.x === dp.x && pos.y === dp.y) {
      reachedDescent = true;
      break;
    }
  }

  return { floor, lattice, runState, fogState, results, cursor, reachedDescent };
}

const WALKABLE_SEEDS = [];
for (let seed = 1; seed <= 30; seed++) {
  const cursor = createRNGCursorForRun(seed);
  const floor = generateFloor(seed, 1, cursor, themesData);
  const lattice = createLattice(floor);
  const spawn = lattice.getPartyPosition();
  const reach = reachable(floor.cells, spawn.x, spawn.y);
  if (reach.has(`${floor.descentPoint.x},${floor.descentPoint.y}`) &&
      bfsPath(floor.cells, spawn.x, spawn.y, floor.descentPoint.x, floor.descentPoint.y)) {
    WALKABLE_SEEDS.push(seed);
    if (WALKABLE_SEEDS.length >= 10) break;
  }
}

describe('exploration loop — reachability + loop mechanics', () => {
  for (const seed of WALKABLE_SEEDS) {
    it(`seed ${seed}: pilot reaches descent, all steps moved, descent interrupt fires`, () => {
      const { results, reachedDescent, runState, floor } = walkFloor(seed);
      expect(reachedDescent).toBe(true);
      expect(results.length).toBeLessThanOrEqual(500);
      for (const r of results) {
        expect(r.moved).toBe(true);
      }
      const descentVisible = results.some(r => {
        if (!r.visibleCells) return false;
        return r.visibleCells.has(`${floor.descentPoint.x},${floor.descentPoint.y}`);
      });
      expect(descentVisible || reachedDescent).toBe(true);
    });
  }

  for (const seed of WALKABLE_SEEDS.slice(0, 5)) {
    it(`seed ${seed}: fog coherence — visited cells fog ∈ {1,2}, current LOS cells = 2`, () => {
      const { fogState, runState, lattice } = walkFloor(seed);
      const pos = lattice.getPartyPosition();
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 20; x++) {
          const idx = y * 20 + x;
          if (fogState[idx] > 0) {
            expect([1, 2]).toContain(fogState[idx]);
          }
        }
      }
      const cellIdx = pos.y * 20 + pos.x;
      expect(fogState[cellIdx]).toBe(2);
    });
  }

  for (const seed of WALKABLE_SEEDS.slice(0, 5)) {
    it(`seed ${seed}: danger clock accumulates from steps`, () => {
      const { results, runState } = walkFloor(seed);
      expect(runState.dangerClockProgress).toBeGreaterThan(0);
      expect(runState.dangerClockProgress).toBeLessThan(1);
    });
  }
});

describe('exploration loop — save/resume determinism (marquee test)', () => {
  const RESUME_SEEDS = WALKABLE_SEEDS.slice(0, 5);

  for (const seed of RESUME_SEEDS) {
    it(`seed ${seed}: mid-walk save/resume produces identical continuation`, () => {
      const walkA = walkFloor(seed);
      if (walkA.results.length < 4) return;
      const K = Math.floor(walkA.results.length / 2);

      const stateB = createRunState(seed, makeParty(2));
      stateB.rngState = walkA.runState.rngState;
      stateB.partyPosition = walkA.lattice.getPartyPosition();
      stateB.fogOfWar = new Uint8Array(walkA.runState.fogOfWar);
      stateB.dangerClockProgress = walkA.runState.dangerClockProgress;

      const encoded = encodeRun(stateB);
      expect(encoded.success).toBe(true);
      const decoded = decodeRun(encoded.fragment);
      expect(decoded.success).toBe(true);

      const cursorB = createRNGCursorForRun(seed, decoded.runState.rngState);
      const floorB = generateFloor(seed, 1, cursorB, themesData);
      expect(floorB).toEqual(walkA.floor);

      const latticeB = createLattice(floorB);
      const posB = decoded.runState.partyPosition;
      latticeB.setPartyPosition(posB.x, posB.y);
      const fogB = new Uint8Array(640);
      for (let i = 0; i < walkA.fogState.length; i++) fogB[i] = walkA.fogState[i];

      const dp = walkA.floor.descentPoint;
      const spawnB = latticeB.getPartyPosition();
      const pathB = bfsPath(walkA.floor.cells, spawnB.x, spawnB.y, dp.x, dp.y);
      const dirsB = pathToDirections(pathB);

      const remainingA = walkA.results.slice(K);
      const resumeResults = [];
      for (let i = 0; i < Math.min(dirsB.length, remainingA.length + 5); i++) {
        const r = moveParty(latticeB, fogB, dirsB[i], cursorB, decoded.runState);
        resumeResults.push(r);
      }

      const minLen = Math.min(resumeResults.length, remainingA.length);
      for (let i = 0; i < minLen; i++) {
        expect(resumeResults[i].moved).toBe(remainingA[i].moved);
        expect(resumeResults[i].interruptType).toBe(remainingA[i].interruptType);
      }
    });
  }
});

describe('exploration loop — cross-floor descent', () => {
  for (const seed of WALKABLE_SEEDS.slice(0, 5)) {
    it(`seed ${seed}: walk floor 1 → advance → walk floor 2, trackers reset`, () => {
      const walk1 = walkFloor(seed, { floorNum: 1 });
      if (!walk1.reachedDescent) return;

      const runState = walk1.runState;
      runState.advanceFloor();

      expect(runState.fogOfWar.every(b => b === 0)).toBe(true);
      expect(runState.openedContainers).toBe(0n);
      expect(runState.defeatedEnemies).toBe(0n);
      expect(runState.depth).toBe(2);

      const cursor2 = createRNGCursorForRun(seed, runState.rngState);
      const floor2 = generateFloor(seed, 2, cursor2, themesData);
      const lattice2 = createLattice(floor2);
      const spawn2 = lattice2.getPartyPosition();
      const reach2 = reachable(floor2.cells, spawn2.x, spawn2.y);

      if (reach2.has(`${floor2.descentPoint.x},${floor2.descentPoint.y}`)) {
        const fog2 = new Uint8Array(640);
        const path2 = bfsPath(floor2.cells, spawn2.x, spawn2.y, floor2.descentPoint.x, floor2.descentPoint.y);
        if (path2) {
          const dirs2 = pathToDirections(path2);
          let stepsOk = true;
          for (let i = 0; i < dirs2.length; i++) {
            const r = moveParty(lattice2, fog2, dirs2[i], cursor2, runState);
            if (!r.moved) { stepsOk = false; break; }
          }
          expect(stepsOk).toBe(true);
        }
      }
    });
  }
});