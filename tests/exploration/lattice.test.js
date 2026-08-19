import { describe, it, expect } from 'vitest';
import { createLattice, CELL } from '../../src/exploration/lattice.js';
import { makeGrid, carve } from '../helpers/grids.js';

describe('createLattice — party spawn', () => {
  it('grid with entryPoint → party at entryPoint', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 18, 30, 1);
    const lat = createLattice({ cells: grid, entryPoint: { x: 5, y: 5 } });
    expect(lat.getPartyPosition()).toEqual({ x: 5, y: 5 });
  });

  it('entryPoint on wall → fallback to first open cell', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 18, 30, 1);
    const lat = createLattice({ cells: grid, entryPoint: { x: 0, y: 0 } });
    expect(lat.getPartyPosition()).toEqual({ x: 1, y: 1 });
  });

  it('no entryPoint and default (w/2,0) is wall → fallback to first open cell', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 18, 30, 1);
    const lat = createLattice({ cells: grid });
    expect(lat.getPartyPosition()).toEqual({ x: 1, y: 1 });
  });

  it('grid alias accepted', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ grid });
    expect(lat.getWidth()).toBe(10);
    expect(lat.getHeight()).toBe(10);
  });
});

describe('createLattice — saved diff restoration', () => {
  it('saved partyPosition on valid cell → restored', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const lat = createLattice({ cells: grid, entryPoint: { x: 10, y: 0 } }, {
      partyPosition: { x: 5, y: 10 }
    });
    expect(lat.getPartyPosition()).toEqual({ x: 5, y: 10 });
  });

  it('saved partyPosition on wall → fallback to entryPoint', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const lat = createLattice({ cells: grid, entryPoint: { x: 10, y: 0 } }, {
      partyPosition: { x: 0, y: 0 }
    });
    expect(lat.getPartyPosition()).toEqual({ x: 10, y: 0 });
  });

  it('saved partyPosition out of bounds → fallback to entryPoint', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const lat = createLattice({ cells: grid, entryPoint: { x: 10, y: 0 } }, {
      partyPosition: { x: -1, y: 0 }
    });
    expect(lat.getPartyPosition()).toEqual({ x: 10, y: 0 });
  });

  it('no savedDiff → entryPoint', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const lat = createLattice({ cells: grid, entryPoint: { x: 3, y: 0 } });
    expect(lat.getPartyPosition()).toEqual({ x: 3, y: 0 });
  });

  it('opened containers filtered from getActiveContainers', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const lat = createLattice({
      cells: grid,
      containers: [{ id: 0, x: 3, y: 3 }, { id: 1, x: 5, y: 5 }]
    }, { openedContainers: 1n });
    const active = lat.getActiveContainers();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(1);
    expect(lat.getContainers().length).toBe(2);
  });

  it('defeated enemies filtered from getActiveEnemySpawns', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const lat = createLattice({
      cells: grid,
      enemySpawns: [{ id: 0, x: 3, y: 3 }, { id: 1, x: 5, y: 5 }]
    }, { defeatedEnemies: 1n });
    const active = lat.getActiveEnemySpawns();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(1);
    expect(lat.getEnemySpawns().length).toBe(2);
  });

  it('isContainerOpened and isEnemyDefeated work with bitfield', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const lat = createLattice({
      cells: grid,
      containers: [{ id: 0, x: 3, y: 3 }, { id: 1, x: 5, y: 5 }],
      enemySpawns: [{ id: 0, x: 4, y: 4 }, { id: 1, x: 6, y: 6 }]
    }, { openedContainers: 1n, defeatedEnemies: 2n });
    expect(lat.isContainerOpened(0)).toBe(true);
    expect(lat.isContainerOpened(1)).toBe(false);
    expect(lat.isEnemyDefeated(0)).toBe(false);
    expect(lat.isEnemyDefeated(1)).toBe(true);
  });

  // Regression (ui-clarity-polish HOTFIX-03): opened containers used to be
  // snapshotted at createLattice() time, so mutating runState.openedContainers
  // after construction left opened containers rendering on the map forever.
  // The map (playfield.getActiveContainers) MUST reflect the live runState
  // without re-creating the lattice.
  it('getActiveContainers reflects savedDiff.openedContainers mutations without re-invoking createLattice', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const runState = { openedContainers: 0n, defeatedEnemies: 0n };
    const lat = createLattice({
      cells: grid,
      containers: [{ id: 0, x: 3, y: 3 }, { id: 1, x: 5, y: 5 }]
    }, runState);
    expect(lat.getActiveContainers().length).toBe(2);
    expect(lat.isContainerOpened(0)).toBe(false);
    // Simulate the loot flow: runState is mutated in place.
    runState.openedContainers |= 1n << 0n;
    const active = lat.getActiveContainers();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(1);
    expect(lat.isContainerOpened(0)).toBe(true);
  });

  it('getActiveEnemySpawns reflects savedDiff.defeatedEnemies mutations without re-invoking createLattice', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    const runState = { openedContainers: 0n, defeatedEnemies: 0n };
    const lat = createLattice({
      cells: grid,
      enemySpawns: [{ id: 0, x: 3, y: 3 }, { id: 1, x: 5, y: 5 }]
    }, runState);
    expect(lat.getActiveEnemySpawns().length).toBe(2);
    expect(lat.isEnemyDefeated(1)).toBe(false);
    runState.defeatedEnemies |= 1n << 1n;
    const active = lat.getActiveEnemySpawns();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(0);
    expect(lat.isEnemyDefeated(1)).toBe(true);
  });
});

describe('createLattice — getCell', () => {
  const grid = makeGrid(10, 10, 0);
  carve(grid, 2, 2, 5, 5, 1);
  grid[3][3] = 2;
  grid[4][4] = 3;
  const lat = createLattice({ cells: grid });

  it('in-bounds returns {type, x, y}', () => {
    expect(lat.getCell(3, 3)).toEqual({ type: 2, x: 3, y: 3 });
    expect(lat.getCell(4, 4)).toEqual({ type: 3, x: 4, y: 4 });
    expect(lat.getCell(2, 2)).toEqual({ type: 1, x: 2, y: 2 });
    expect(lat.getCell(0, 0)).toEqual({ type: 0, x: 0, y: 0 });
  });

  it('out-of-bounds → {type: 0, x, y}', () => {
    expect(lat.getCell(-1, 0)).toEqual({ type: 0, x: -1, y: 0 });
    expect(lat.getCell(10, 10)).toEqual({ type: 0, x: 10, y: 10 });
  });
});

describe('createLattice — isWalkable / isWall', () => {
  const grid = makeGrid(10, 10, 0);
  grid[1][1] = 1;
  grid[2][2] = 2;
  grid[3][3] = 3;
  const lat = createLattice({ cells: grid });

  it('isWalkable: false OOB and on 0, true on 1/2/3', () => {
    expect(lat.isWalkable(-1, 0)).toBe(false);
    expect(lat.isWalkable(10, 10)).toBe(false);
    expect(lat.isWalkable(0, 0)).toBe(false);
    expect(lat.isWalkable(1, 1)).toBe(true);
    expect(lat.isWalkable(2, 2)).toBe(true);
    expect(lat.isWalkable(3, 3)).toBe(true);
  });

  it('isWall: true OOB, true on 0 only', () => {
    expect(lat.isWall(-1, 0)).toBe(true);
    expect(lat.isWall(10, 10)).toBe(true);
    expect(lat.isWall(0, 0)).toBe(true);
    expect(lat.isWall(1, 1)).toBe(false);
    expect(lat.isWall(2, 2)).toBe(false);
    expect(lat.isWall(3, 3)).toBe(false);
  });
});

describe('createLattice — position & accessors', () => {
  it('getPartyPosition returns a copy', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid });
    const pos = lat.getPartyPosition();
    pos.x = 999;
    expect(lat.getPartyPosition().x).not.toBe(999);
  });

  it('setPartyPosition updates position', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid });
    lat.setPartyPosition(3, 7);
    expect(lat.getPartyPosition()).toEqual({ x: 3, y: 7 });
  });

  it('getGrid returns live reference', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid });
    expect(lat.getGrid()).toBe(grid);
  });

  it('getContainers/getEnemySpawns default []', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid });
    expect(lat.getContainers()).toEqual([]);
    expect(lat.getEnemySpawns()).toEqual([]);
  });

  it('getActiveContainers/getActiveEnemySpawns default []', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid });
    expect(lat.getActiveContainers()).toEqual([]);
    expect(lat.getActiveEnemySpawns()).toEqual([]);
  });

  it('getDescentPoint default null', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid });
    expect(lat.getDescentPoint()).toBeNull();
  });

  it('getEntryPoint returns provided entry', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid, entryPoint: { x: 3, y: 2 } });
    expect(lat.getEntryPoint()).toEqual({ x: 3, y: 2 });
  });

  it('isOccupied: true for party position', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid, entryPoint: { x: 5, y: 5 } });
    expect(lat.isOccupied(5, 5)).toBe(true);
    expect(lat.isOccupied(3, 3)).toBe(false);
  });

  it('isOccupied: true for active enemy, false for defeated', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({
      cells: grid,
      enemySpawns: [{ id: 0, x: 3, y: 3 }, { id: 1, x: 4, y: 4 }]
    }, { defeatedEnemies: 2n });
    expect(lat.isOccupied(3, 3)).toBe(true);
    expect(lat.isOccupied(4, 4)).toBe(false);
  });

  it('isOpaque matches isWall', () => {
    const grid = makeGrid(10, 10, 0);
    grid[5][5] = 1;
    const lat = createLattice({ cells: grid });
    expect(lat.isOpaque(0, 0)).toBe(true);
    expect(lat.isOpaque(5, 5)).toBe(false);
  });

  it('getWidth/getHeight from grid shape', () => {
    const grid = makeGrid(15, 25, 0);
    const lat = createLattice({ cells: grid });
    expect(lat.getWidth()).toBe(15);
    expect(lat.getHeight()).toBe(25);
  });
});

describe('createLattice — hunter overrides (session-scoped)', () => {
  it('setHunterPosition changes what getActiveEnemySpawns reports without mutating base spawn', () => {
    const grid = makeGrid(20, 32, 1);
    const spawns = [{ id: 0, x: 3, y: 3, archetypeId: 'drone' }, { id: 1, x: 5, y: 5, archetypeId: 'drone' }];
    const lat = createLattice({ cells: grid, enemySpawns: spawns });
    expect(lat.setHunterPosition(0, { x: 4, y: 3 })).toBe(true);
    const active = lat.getActiveEnemySpawns();
    expect(active.find(e => e.id === 0)).toMatchObject({ id: 0, x: 4, y: 3, archetypeId: 'drone' });
    expect(active.find(e => e.id === 1)).toMatchObject({ id: 1, x: 5, y: 5 });
    // Base spawn is untouched — the caller's spawn objects must not mutate.
    expect(spawns[0]).toEqual({ id: 0, x: 3, y: 3, archetypeId: 'drone' });
    // getEnemySpawns still returns the raw list.
    expect(lat.getEnemySpawns()[0]).toEqual({ id: 0, x: 3, y: 3, archetypeId: 'drone' });
  });

  it('getHunterPosition returns null when no override is set and a copy when set', () => {
    const grid = makeGrid(20, 32, 1);
    const lat = createLattice({ cells: grid, enemySpawns: [{ id: 7, x: 2, y: 2, archetypeId: 'drone' }] });
    expect(lat.getHunterPosition(7)).toBeNull();
    lat.setHunterPosition(7, { x: 3, y: 2 });
    const pos = lat.getHunterPosition(7);
    expect(pos).toEqual({ x: 3, y: 2 });
    pos.x = 999;
    expect(lat.getHunterPosition(7)).toEqual({ x: 3, y: 2 });
  });

  it('setHunterPosition rejects invalid input', () => {
    const grid = makeGrid(20, 32, 1);
    const lat = createLattice({ cells: grid });
    expect(lat.setHunterPosition('not-an-id', { x: 1, y: 1 })).toBe(false);
    expect(lat.setHunterPosition(0, null)).toBe(false);
    expect(lat.setHunterPosition(0, { x: 'a', y: 1 })).toBe(false);
    expect(lat.setHunterPosition(0, { x: 1 })).toBe(false);
  });

  it('isOccupied honors the hunter override position, not the spawn cell', () => {
    const grid = makeGrid(20, 32, 1);
    const lat = createLattice({
      cells: grid,
      entryPoint: { x: 0, y: 0 },
      enemySpawns: [{ id: 0, x: 3, y: 3, archetypeId: 'drone' }]
    });
    expect(lat.isOccupied(3, 3)).toBe(true);
    expect(lat.isOccupied(4, 3)).toBe(false);
    lat.setHunterPosition(0, { x: 4, y: 3 });
    expect(lat.isOccupied(3, 3)).toBe(false);
    expect(lat.isOccupied(4, 3)).toBe(true);
  });
});

describe('createLattice — culling (session-scoped)', () => {
  it('markCulled("container", id) removes the container from getActiveContainers', () => {
    const grid = makeGrid(20, 32, 1);
    const containers = [{ id: 0, x: 3, y: 3 }, { id: 1, x: 5, y: 5 }];
    const lat = createLattice({ cells: grid, containers });
    expect(lat.getActiveContainers().length).toBe(2);
    expect(lat.markCulled('container', 0)).toBe(true);
    expect(lat.isCulled('container', 0)).toBe(true);
    expect(lat.isCulled('container', 1)).toBe(false);
    const active = lat.getActiveContainers();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(1);
    // Raw containers still exposed via getContainers.
    expect(lat.getContainers().length).toBe(2);
  });

  it('markCulled("enemy", id) removes the spawn from getActiveEnemySpawns', () => {
    const grid = makeGrid(20, 32, 1);
    const lat = createLattice({
      cells: grid,
      enemySpawns: [{ id: 0, x: 3, y: 3, archetypeId: 'drone' }, { id: 1, x: 5, y: 5, archetypeId: 'drone' }]
    });
    expect(lat.markCulled('enemy', 1)).toBe(true);
    expect(lat.isCulled('enemy', 1)).toBe(true);
    const active = lat.getActiveEnemySpawns();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(0);
  });

  it('markCulled with unknown kind returns false and no state changes', () => {
    const grid = makeGrid(20, 32, 1);
    const lat = createLattice({
      cells: grid,
      containers: [{ id: 0, x: 3, y: 3 }]
    });
    expect(lat.markCulled('mystery', 0)).toBe(false);
    expect(lat.getActiveContainers().length).toBe(1);
    expect(lat.isCulled('mystery', 0)).toBe(false);
  });
});