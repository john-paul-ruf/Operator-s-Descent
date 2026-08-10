import { describe, it, expect } from 'vitest';
import { moveParty, tickDangerClock } from '../../src/exploration/movement.js';
import { createLattice } from '../../src/exploration/lattice.js';
import { createRunState } from '../../src/state/run-state.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { makeParty, makeCharacter } from '../helpers/fixtures.js';
import { makeGrid, carve } from '../helpers/grids.js';

function makeFloor(overrides = {}) {
  const grid = makeGrid(20, 32, 0);
  carve(grid, 1, 1, 18, 30, 1);
  return {
    cells: grid,
    containers: [],
    enemySpawns: [],
    descentPoint: { x: 10, y: 30 },
    ...overrides,
  };
}

function makeRunState(sig = 5) {
  const party = [makeCharacter({ id: 'a', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig } })];
  return createRunState(42, party);
}

describe('moveParty — direction table', () => {
  const floor = makeFloor();
  const lat = createLattice(floor);
  const dirs = {
    n: { dx: 0, dy: -1 }, ne: { dx: 1, dy: -1 }, e: { dx: 1, dy: 0 },
    se: { dx: 1, dy: 1 }, s: { dx: 0, dy: 1 }, sw: { dx: -1, dy: 1 },
    w: { dx: -1, dy: 0 }, nw: { dx: -1, dy: -1 },
  };
  const rs = makeRunState();
  const cursor = createRNGCursorForRun(1);

  for (const [name, { dx, dy }] of Object.entries(dirs)) {
    it(`direction "${name}" moves (${dx}, ${dy})`, () => {
      lat.setPartyPosition(10, 15);
      const fog = new Uint8Array(640);
      const result = moveParty(lat, fog, name, cursor, rs);
      expect(result.moved).toBe(true);
      const pos = lat.getPartyPosition();
      expect(pos).toEqual({ x: 10 + dx, y: 15 + dy });
    });
  }

  it('unknown direction → {moved: false, interruptType: "invalid-direction"}', () => {
    lat.setPartyPosition(10, 15);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'xyz', cursor, rs);
    expect(result).toEqual({ moved: false, interruptType: 'invalid-direction' });
  });
});

describe('moveParty — blocking', () => {
  it('cardinal into wall → blocked, position unchanged, danger clock NOT ticked', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(1, 1);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const before = rs.dangerClockProgress;
    moveParty(lat, fog, 'w', cursor, rs);
    expect(lat.getPartyPosition()).toEqual({ x: 1, y: 1 });
    expect(rs.dangerClockProgress).toBe(before);
  });
});

describe('moveParty — corner rule', () => {
  it('diagonal with both orthogonals walled → blocked', () => {
    const grid = makeGrid(10, 10, 0);
    grid[5][5] = 1;
    grid[4][5] = 1;
    grid[5][6] = 1;
    const lat = createLattice({ cells: grid });
    lat.setPartyPosition(5, 5);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'ne', cursor, rs);
    expect(result.moved).toBe(false);
    expect(result.interruptType).toBe('blocked');
  });

  it('diagonal with exactly one orthogonal open → allowed', () => {
    const grid = makeGrid(10, 10, 0);
    grid[5][5] = 1;
    grid[4][5] = 0;
    grid[5][6] = 1;
    grid[4][6] = 1;
    const lat = createLattice({ cells: grid });
    lat.setPartyPosition(5, 5);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'ne', cursor, rs);
    expect(result.moved).toBe(true);
    expect(lat.getPartyPosition()).toEqual({ x: 6, y: 4 });
  });
});

describe('moveParty — successful move effects', () => {
  it('position updated, markCellVisited called, fog updated, visibleCells returned', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.moved).toBe(true);
    expect(lat.getPartyPosition()).toEqual({ x: 11, y: 15 });
    expect(result.visibleCells).toBeInstanceOf(Set);
    expect(result.visibleCells.has('11,15')).toBe(true);
    const idx = 15 * 20 + 11;
    expect(fog[idx]).toBe(2);
  });
});

describe('moveParty — LOS radius', () => {
  it('options.losRadius: 2 honored', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'e', cursor, rs, { losRadius: 2 });
    for (const key of result.visibleCells) {
      const [x, y] = key.split(',').map(Number);
      const dist = Math.sqrt((x - 11) ** 2 + (y - 15) ** 2);
      expect(dist).toBeLessThanOrEqual(4);
    }
  });

  it('without option, radius = sig * 2 (sig 5 → 10)', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState(5);
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.visibleCells.size).toBeGreaterThan(10);
  });

  it('party empty → default 8', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = createRunState(42, []);
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.visibleCells.size).toBeGreaterThan(5);
  });
});

describe('moveParty — interrupts', () => {
  it('hostile > container > descent priority', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
      containers: [{ id: 0, x: 11, y: 16 }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('hostile');
  });

  it('after enemy defeated → container interrupt', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
      containers: [{ id: 0, x: 11, y: 16 }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.markEnemyDefeated(0);
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('container');
  });

  it('after container opened → descent interrupt', () => {
    const floor = makeFloor({
      containers: [{ id: 0, x: 11, y: 16 }],
      descentPoint: { x: 12, y: 15 },
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.markContainerOpened(0);
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('descent');
  });

  it('nothing special visible → interruptType null', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBeNull();
  });
});

describe('tickDangerClock', () => {
  it('null runState → {huntTriggered: false}', () => {
    expect(tickDangerClock(null, 1)).toEqual({ huntTriggered: false });
  });

  it('bare runState (no getDangerClockRate) → {huntTriggered: false}', () => {
    expect(tickDangerClock({}, 1)).toEqual({ huntTriggered: false });
  });

  it('rate math at depth 1', () => {
    const rs = makeRunState();
    rs.depth = 1;
    const rate = rs.getDangerClockRate();
    const scaledRate = rate * (1 + 1 * 0.05);
    rs.dangerClockProgress = 0;
    tickDangerClock(rs, 1);
    expect(rs.dangerClockProgress).toBeCloseTo(scaledRate, 5);
  });

  it('rate math at depth 10', () => {
    const rs = makeRunState();
    rs.depth = 10;
    const rate = rs.getDangerClockRate();
    const scaledRate = rate * (1 + 10 * 0.05);
    rs.dangerClockProgress = 0;
    tickDangerClock(rs, 1);
    expect(rs.dangerClockProgress).toBeCloseTo(scaledRate, 5);
  });

  it('accumulate past 1.0 → hunt triggered, progress resets to 0', () => {
    const rs = makeRunState();
    rs.depth = 100;
    const result = tickDangerClock(rs, 1000);
    expect(result.huntTriggered).toBe(true);
    expect(result.huntData).toEqual({ type: 'hunt', depth: 100 });
    expect(rs.dangerClockProgress).toBe(0);
  });

  it('each successful moveParty advances progress by one tick', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    const rs = makeRunState();
    rs.depth = 1;
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    lat.setPartyPosition(10, 15);
    rs.dangerClockProgress = 0;
    moveParty(lat, fog, 'e', cursor, rs);
    const rate = rs.getDangerClockRate();
    const scaledRate = rate * (1 + 1 * 0.05);
    expect(rs.dangerClockProgress).toBeCloseTo(scaledRate, 5);
  });
});