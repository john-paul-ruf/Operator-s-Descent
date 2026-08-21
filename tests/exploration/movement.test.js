import { describe, expect, it } from 'vitest';
import {
  findExplorationPath,
  moveParty,
  tickDangerClock,
  resetDangerClock,
  signalMovementDamage,
  stepHunters,
  pruneEmptyCaches,
  HUNT_ACTIVATION_RANGE
} from '../../src/exploration/movement.js';
import { createLattice } from '../../src/exploration/lattice.js';
import { createRunState } from '../../src/state/run-state.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { GRID_W, GRID_H } from '../../src/floor/archetypes.js';
import { makeParty, makeCharacter } from '../helpers/fixtures.js';
import { makeGrid, carve } from '../helpers/grids.js';

const CELLS = GRID_W * GRID_H;

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
  const dirs = {
    n: { dx: 0, dy: -1 }, ne: { dx: 1, dy: -1 }, e: { dx: 1, dy: 0 },
    se: { dx: 1, dy: 1 }, s: { dx: 0, dy: 1 }, sw: { dx: -1, dy: 1 },
    w: { dx: -1, dy: 0 }, nw: { dx: -1, dy: -1 },
  };

  for (const [name, { dx, dy }] of Object.entries(dirs)) {
    it(`direction "${name}" moves (${dx}, ${dy})`, () => {
      const floor = makeFloor();
      const lat = createLattice(floor);
      const rs = makeRunState();
      const cursor = createRNGCursorForRun(1);
      lat.setPartyPosition(10, 15);
      const fog = new Uint8Array(CELLS);
      const result = moveParty(lat, fog, name, cursor, rs);
      expect(result.moved).toBe(true);
      expect(lat.getPartyPosition()).toEqual({ x: 10 + dx, y: 15 + dy });
    });
  }

  it('unknown direction → {moved: false, interruptType: "invalid-direction"}', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    lat.setPartyPosition(10, 15);
    const fog = new Uint8Array(CELLS);
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
    const fog = new Uint8Array(CELLS);
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
    const fog = new Uint8Array(CELLS);
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
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'ne', cursor, rs);
    expect(result.moved).toBe(true);
    expect(lat.getPartyPosition()).toEqual({ x: 6, y: 4 });
  });
});

describe('moveParty — successful move transaction', () => {
  it('returns complete transaction object with all fields', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.moved).toBe(true);
    expect(result.position).toEqual({ x: 11, y: 15 });
    expect(result.visibleCells).toBeInstanceOf(Set);
    expect(result.visibleCells.has('11,15')).toBe(true);
    expect(result.discoveries).toBeInstanceOf(Array);
    expect(result.interruptType).toBeDefined();
    expect(result.danger).toBeDefined();
    expect(result.danger.progress).toBeDefined();
    expect(result.proximity).toBeDefined();
    expect(result.stateDelta).toBeDefined();
    const idx = 15 * GRID_W + 11;
    expect(fog[idx]).toBe(2);
  });

  it('runState.partyPosition updated to match lattice', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    moveParty(lat, fog, 'e', cursor, rs);
    expect(rs.partyPosition).toEqual({ x: 11, y: 15 });
  });
});

describe('moveParty — LOS radius', () => {
  it('options.losRadius: 2 honored', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
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
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.visibleCells.size).toBeGreaterThan(10);
  });

  it('party empty → default 8', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = createRunState(42, []);
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.visibleCells.size).toBeGreaterThan(5);
  });
});

describe('moveParty — discoveries', () => {
  it('hostile entering LOS → discovered, hostile interrupt fires', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 13, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    const hostileDiscoveries = result.discoveries.filter(d => d.type === 'hostile');
    expect(hostileDiscoveries.length).toBeGreaterThan(0);
    expect(hostileDiscoveries[0].newlyDiscovered).toBe(true);
    expect(result.interruptType).toBe('hostile');
  });

  it('already-visible hostile → not newly discovered, no interrupt', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const firstResult = moveParty(lat, fog, 'e', cursor, rs);
    const hostileDiscoveries = firstResult.discoveries.filter(d => d.type === 'hostile');
    expect(hostileDiscoveries.length).toBeGreaterThan(0);
    expect(hostileDiscoveries[0].newlyDiscovered).toBe(true);
    moveParty(lat, fog, 'w', cursor, rs);
    const secondResult = moveParty(lat, fog, 'e', cursor, rs);
    const reSeen = secondResult.discoveries.filter(d => d.type === 'hostile');
    if (reSeen.length > 0) {
      expect(reSeen[0].newlyDiscovered).toBe(false);
    }
    expect(secondResult.interruptType).not.toBe('hostile');
  });

  it('container discovered → container interrupt', () => {
    const floor = makeFloor({
      containers: [{ id: 0, x: 13, y: 15 }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    const containerDiscoveries = result.discoveries.filter(d => d.type === 'container');
    expect(containerDiscoveries.length).toBeGreaterThan(0);
    expect(containerDiscoveries[0].newlyDiscovered).toBe(true);
    expect(result.interruptType).toBe('container');
  });

  it('descent discovered → descent interrupt', () => {
    const floor = makeFloor({
      descentPoint: { x: 13, y: 15 },
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    const descentDiscoveries = result.discoveries.filter(d => d.type === 'descent');
    expect(descentDiscoveries.length).toBeGreaterThan(0);
    expect(descentDiscoveries[0].newlyDiscovered).toBe(true);
    expect(result.interruptType).toBe('descent');
  });

  it('descent only discovered, not triggered — descent requires moving onto cell + confirm', () => {
    const floor = makeFloor({
      descentPoint: { x: 13, y: 15 },
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('descent');
    expect(result.discoveredEntity).toEqual({ x: 13, y: 15 });
  });

  it('nothing special visible → interruptType null', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBeNull();
  });
});

describe('moveParty — interrupt priority', () => {
  it('hostile > container > descent priority', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
      containers: [{ id: 0, x: 11, y: 16 }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
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
    const fog = new Uint8Array(CELLS);
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
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('descent');
  });
});

describe('moveParty — quick-toggle auto-stop', () => {
  it('container auto-stop disabled → no container interrupt', () => {
    const floor = makeFloor({
      containers: [{ id: 0, x: 13, y: 15 }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs, { autoStopToggles: { container: false } });
    expect(result.interruptType).not.toBe('container');
  });

  it('descent auto-stop disabled → no descent interrupt', () => {
    const floor = makeFloor({
      descentPoint: { x: 13, y: 15 },
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs, { autoStopToggles: { descent: false } });
    expect(result.interruptType).not.toBe('descent');
  });

  it('hostile auto-stop cannot be disabled', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs, { autoStopToggles: { hostile: false } });
    expect(result.interruptType).toBe('hostile');
  });
});

describe('moveParty — damage interrupt', () => {
  it('signalMovementDamage before move → damage interrupt', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    signalMovementDamage();
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('damage');
  });

  it('damage flag cleared after move', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    signalMovementDamage();
    moveParty(lat, fog, 'e', cursor, rs);
    lat.setPartyPosition(10, 15);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).not.toBe('damage');
  });
});

describe('moveParty — proximity', () => {
  it('nearest hostile distance computed', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 13, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.proximity.nearestHostile).not.toBeNull();
    expect(typeof result.proximity.nearestHostile).toBe('number');
  });

  it('nearest container distance computed', () => {
    const floor = makeFloor({
      containers: [{ id: 0, x: 13, y: 15 }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.proximity.nearestContainer).not.toBeNull();
    expect(typeof result.proximity.nearestContainer).toBe('number');
  });

  it('no hostiles/containers → null proximity', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.proximity.nearestHostile).toBeNull();
    expect(result.proximity.nearestContainer).toBeNull();
  });

  it('defeated enemies excluded from proximity', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.markEnemyDefeated(0);
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.proximity.nearestHostile).toBeNull();
  });

  it('opened containers excluded from proximity', () => {
    const floor = makeFloor({
      containers: [{ id: 0, x: 12, y: 15 }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.markContainerOpened(0);
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.proximity.nearestContainer).toBeNull();
  });
});

describe('tickDangerClock', () => {
  it('null runState → {huntTriggered: false}', () => {
    expect(tickDangerClock(null, 1)).toEqual({ huntTriggered: false });
  });

  it('bare runState (no getDangerClockRate) → {huntTriggered: false}', () => {
    expect(tickDangerClock({}, 1)).toEqual({ huntTriggered: false });
  });

  it('rate math at depth 1 — no double scaling', () => {
    const rs = makeRunState();
    rs.depth = 1;
    const rate = rs.getDangerClockRate();
    rs.dangerClockProgress = 0;
    tickDangerClock(rs, 1);
    expect(rs.dangerClockProgress).toBeCloseTo(rate, 5);
  });

  it('rate math at depth 10 — no double scaling', () => {
    const rs = makeRunState();
    rs.depth = 10;
    const rate = rs.getDangerClockRate();
    rs.dangerClockProgress = 0;
    tickDangerClock(rs, 1);
    expect(rs.dangerClockProgress).toBeCloseTo(rate, 5);
  });

  it('accumulate to 1.0 → hunt triggered, progress stays at trigger level (not zero)', () => {
    const rs = makeRunState();
    rs.depth = 100;
    const result = tickDangerClock(rs, 1000);
    expect(result.huntTriggered).toBe(true);
    expect(result.huntData).toEqual({ type: 'hunt', depth: 100 });
    expect(rs.dangerClockProgress).toBeGreaterThanOrEqual(1.0);
  });

  it('each successful moveParty advances progress by one tick', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    const rs = makeRunState();
    rs.depth = 1;
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    lat.setPartyPosition(10, 15);
    rs.dangerClockProgress = 0;
    moveParty(lat, fog, 'e', cursor, rs);
    const rate = rs.getDangerClockRate();
    expect(rs.dangerClockProgress).toBeCloseTo(rate, 5);
  });

  it('combatActive context → no hunt triggered, pendingHunt if at threshold', () => {
    const rs = makeRunState();
    rs.depth = 100;
    rs.dangerClockProgress = 0.99;
    const result = tickDangerClock(rs, 1000, { combatActive: true });
    expect(result.huntTriggered).toBe(false);
    expect(result.pendingHunt).toBe(true);
  });

  it('combatActive context, below threshold → no pendingHunt', () => {
    const rs = makeRunState();
    rs.depth = 1;
    rs.dangerClockProgress = 0;
    const result = tickDangerClock(rs, 1, { combatActive: true });
    expect(result.huntTriggered).toBe(false);
    expect(result.pendingHunt).toBe(false);
  });
});

describe('resetDangerClock', () => {
  it('resets progress to 0', () => {
    const rs = makeRunState();
    rs.dangerClockProgress = 0.5;
    resetDangerClock(rs);
    expect(rs.dangerClockProgress).toBe(0);
  });

  it('null runState → no-op', () => {
    expect(() => resetDangerClock(null)).not.toThrow();
  });
});

describe('moveParty — danger clock does not tick on blocked move', () => {
  it('blocked move does not advance danger clock', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(1, 1);
    const rs = makeRunState();
    rs.depth = 1;
    rs.dangerClockProgress = 0;
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    moveParty(lat, fog, 'w', cursor, rs);
    expect(rs.dangerClockProgress).toBe(0);
  });
});

describe('moveParty — combatActive option', () => {
  it('combatActive → danger clock does not tick (per FR-14)', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.depth = 1;
    rs.dangerClockProgress = 0;
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs, { combatActive: true });
    expect(rs.dangerClockProgress).toBe(0);
    expect(result.danger.pendingHunt).toBe(false);
  });

  it('combatActive at threshold → pendingHunt true, no hunt triggered', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.depth = 100;
    rs.dangerClockProgress = 1.0;
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs, { combatActive: true });
    expect(result.danger.pendingHunt).toBe(true);
    expect(result.interruptType).not.toBe('hunt');
  });
});

describe('findExplorationPath', () => {
  const DIRECTION_SET = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
  function revealedFog(w = GRID_W, h = GRID_H) {
    return new Uint8Array(w * h).fill(2);
  }

  it('straight run east returns a shortest path (Chebyshev-length 5) ending at the target', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    const fog = revealedFog();
    const result = findExplorationPath(lat, fog, { x: 10, y: 15 }, { x: 15, y: 15 });
    expect(result).not.toBeNull();
    expect(result.path).toHaveLength(5);
    expect(result.cells).toHaveLength(5);
    expect(result.cells.at(-1)).toEqual({ x: 15, y: 15 });
    for (const dir of result.path) expect(DIRECTION_SET.has(dir)).toBe(true);
  });

  it('routes around a wall column between origin and target', () => {
    // Wall spans x=12 for y=0..27, leaving the only crossing at y ≥ 28.
    const grid = makeGrid(20, 32, 1);
    for (let y = 0; y < 28; y++) grid[y][12] = 0;
    const lat = createLattice({ cells: grid });
    const fog = revealedFog();
    const result = findExplorationPath(lat, fog, { x: 10, y: 15 }, { x: 15, y: 15 });
    expect(result).not.toBeNull();
    expect(result.cells.at(-1)).toEqual({ x: 15, y: 15 });
    // BFS must go around the barrier, so path length ≫ Chebyshev distance (5).
    expect(result.path.length).toBeGreaterThan(5);
    // No path cell may be inside the walled column region.
    for (const cell of result.cells) {
      const inWall = cell.x === 12 && cell.y < 28;
      expect(inWall).toBe(false);
    }
    // The detour must dip below the wall (y >= 28).
    expect(result.cells.some((cell) => cell.y >= 28)).toBe(true);
  });

  it('closed-corner diagonal detours instead of stepping directly', () => {
    const grid = makeGrid(10, 10, 1);
    grid[5][6] = 0;
    grid[4][5] = 0;
    const lat = createLattice({ cells: grid });
    const fog = new Uint8Array(100).fill(2);
    const result = findExplorationPath(lat, fog, { x: 5, y: 5 }, { x: 6, y: 4 });
    expect(result).not.toBeNull();
    // The direct NE step (5,5)→(6,4) is forbidden — the first move must land somewhere else.
    expect(result.cells[0]).not.toEqual({ x: 6, y: 4 });
    expect(result.cells.at(-1)).toEqual({ x: 6, y: 4 });
    expect(result.path.length).toBeGreaterThan(1);
  });

  it('target on an unrevealed cell → null', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    const fog = new Uint8Array(CELLS);
    fog[15 * GRID_W + 10] = 2;
    fog[15 * GRID_W + 11] = 2;
    const result = findExplorationPath(lat, fog, { x: 10, y: 15 }, { x: 15, y: 15 });
    expect(result).toBeNull();
  });

  it('target on a wall → null', () => {
    const grid = makeGrid(20, 32, 1);
    grid[15][11] = 0;
    const lat = createLattice({ cells: grid });
    const fog = revealedFog();
    const result = findExplorationPath(lat, fog, { x: 10, y: 15 }, { x: 11, y: 15 });
    expect(result).toBeNull();
  });

  it('target beyond maxSteps → null', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    const fog = revealedFog();
    const result = findExplorationPath(lat, fog, { x: 1, y: 1 }, { x: 18, y: 30 }, { maxSteps: 3 });
    expect(result).toBeNull();
  });

  it('from === to → null', () => {
    const floor = makeFloor();
    const lat = createLattice(floor);
    const fog = revealedFog();
    const result = findExplorationPath(lat, fog, { x: 10, y: 15 }, { x: 10, y: 15 });
    expect(result).toBeNull();
  });
});

describe('moveParty — hunt triggering', () => {
  it('hunt triggered on exploring move when clock reaches threshold', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.depth = 100;
    rs.dangerClockProgress = 0.99;
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('hunt');
    expect(result.danger.huntTriggered).toBe(true);
    expect(result.danger.huntData).toEqual({ type: 'hunt', depth: 100 });
  });

  it('hunt deferred if non-hostile interrupt present', () => {
    const floor = makeFloor({
      containers: [{ id: 0, x: 13, y: 15 }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.depth = 100;
    rs.dangerClockProgress = 0.99;
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('container');
    expect(result.danger.pendingHunt).toBe(true);
    expect(result.danger.huntTriggered).toBe(false);
  });

  it('hunt fires alongside hostile discovery (hostile takes priority for interrupt, hunt overrides)', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.depth = 100;
    rs.dangerClockProgress = 0.99;
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('hunt');
  });
});

describe('moveParty — combat contact range', () => {
  it('hostile within 2 connected squares → combatContact true, contactEntity, hostileContactDistance', () => {
    // Party (10,15), enemy (13,15). Party moves E → (11,15). Hunter (SESSION-04)
    // steps enemy toward party (deterministic DIRECTION_ORDER tiebreak) so the
    // contactEntity's position reflects the post-step location, not the spawn cell.
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 13, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.combatContact).toBe(true);
    expect(result.contactEntity).toEqual(expect.objectContaining({ id: 0, archetypeId: 'drone' }));
    // Enemy is now adjacent to party (Chebyshev-1) after the hunter step.
    const partyPos = lat.getPartyPosition();
    const cheb = Math.max(Math.abs(result.contactEntity.x - partyPos.x), Math.abs(result.contactEntity.y - partyPos.y));
    expect(cheb).toBe(1);
    expect(result.hostileContactDistance).toBeLessThanOrEqual(2);
    expect(result.hostileContactDistance).toBeGreaterThan(0);
  });

  it('far sighting in open corridor → hostile interrupt (auto-stop) but combatContact false', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 16, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'e', cursor, rs);
    expect(result.interruptType).toBe('hostile');
    expect(result.visibleCells.has('16,15')).toBe(true);
    expect(result.combatContact).toBe(false);
    expect(result.contactEntity).toBeNull();
    expect(result.hostileContactDistance).toBeNull();
  });

  it('wall-detour crux: visible hostile at Chebyshev 2 but connected > 2 → combatContact false', () => {
    // Party at (10,15), hostile at (11,13) (Chebyshev = 2, dx=1 dy=-2).
    // Walls at (10,14) and (11,15) block direct N, direct E, and the direct
    // NE diagonal (closed-corner rule: both orthogonals walled). The shortest
    // BFS path detours through (9,14) → (10,13) → (11,13) at distance 3.
    // Neither wall lies in the NE octant, so LOS still reaches the hostile.
    const grid = makeGrid(20, 32, 1);
    grid[14][10] = 0;
    grid[15][11] = 0;
    const floor = {
      cells: grid,
      containers: [],
      enemySpawns: [{ id: 0, x: 11, y: 13, archetypeId: 'drone' }],
      descentPoint: { x: 10, y: 30 },
    };
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 16);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const result = moveParty(lat, fog, 'n', cursor, rs);
    expect(result.moved).toBe(true);
    expect(result.position).toEqual({ x: 10, y: 15 });
    expect(result.visibleCells.has('11,13')).toBe(true);
    expect(result.combatContact).toBe(false);
    expect(result.contactEntity).toBeNull();
    expect(result.hostileContactDistance).toBeNull();
  });

  it('approaching a known enemy: first sight far, later move within range → combatContact true on the later move', () => {
    // Party (10,15), enemy at (17,15). Party first sees the enemy on move 1 (LOS
    // radius 10) but is not within HOSTILE_CONTACT_RANGE=2. Under SESSION-04's
    // hunt, the enemy also closes each move; contact fires when the gap collapses.
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 17, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const first = moveParty(lat, fog, 'e', cursor, rs);
    expect(first.interruptType).toBe('hostile');
    expect(first.combatContact).toBe(false);
    // Keep stepping east until combat contact fires. Assert contact is reached
    // in bounded steps (not open-ended) and stays true for the same enemy id.
    let contactFired = false;
    let contactResult = null;
    for (let i = 0; i < 6 && !contactFired; i++) {
      const result = moveParty(lat, fog, 'e', cursor, rs);
      if (result.combatContact) {
        contactFired = true;
        contactResult = result;
      }
    }
    expect(contactFired).toBe(true);
    expect(contactResult.contactEntity).toEqual(expect.objectContaining({ id: 0, archetypeId: 'drone' }));
  });

  it('dedup: once contacted, a further in-range move for the same enemy → combatContact false', () => {
    const floor = makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }],
    });
    const lat = createLattice(floor);
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(CELLS);
    const first = moveParty(lat, fog, 'e', cursor, rs);
    expect(first.combatContact).toBe(true);
    const stepBack = moveParty(lat, fog, 'w', cursor, rs);
    expect(stepBack.combatContact).toBe(false);
    const reapproach = moveParty(lat, fog, 'e', cursor, rs);
    expect(reapproach.combatContact).toBe(false);
  });
});