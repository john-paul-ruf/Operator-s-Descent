import { describe, it, expect } from 'vitest';
import { createLattice } from '../../src/exploration/lattice.js';
import { makeGrid, carve } from '../helpers/grids.js';

describe('createLattice — party spawn', () => {
  it('grid with 3 at (x, y) → party at (x, y−1)', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 18, 30, 1);
    grid[10][5] = 3;
    const lat = createLattice({ cells: grid });
    expect(lat.getPartyPosition()).toEqual({ x: 5, y: 9 });
  });

  it('3 at row 0 → clamps to y 0', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 0, 18, 30, 1);
    grid[0][10] = 3;
    const lat = createLattice({ cells: grid });
    expect(lat.getPartyPosition()).toEqual({ x: 10, y: 0 });
  });

  it('no 3 anywhere → (floor(w/2), 0)', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 18, 30, 1);
    const lat = createLattice({ cells: grid });
    expect(lat.getPartyPosition()).toEqual({ x: 10, y: 0 });
  });

  it('floor.grid accepted as alias for floor.cells', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ grid });
    expect(lat.getWidth()).toBe(10);
    expect(lat.getHeight()).toBe(10);
  });

  it('floor.startX / startY override defaults', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 18, 30, 1);
    const lat = createLattice({ cells: grid, startX: 3, startY: 5 });
    expect(lat.getPartyPosition()).toEqual({ x: 3, y: 5 });
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

  it('getDescentPoint default null', () => {
    const grid = makeGrid(10, 10, 1);
    const lat = createLattice({ cells: grid });
    expect(lat.getDescentPoint()).toBeNull();
  });

  it('getWidth/getHeight from grid shape', () => {
    const grid = makeGrid(15, 25, 0);
    const lat = createLattice({ cells: grid });
    expect(lat.getWidth()).toBe(15);
    expect(lat.getHeight()).toBe(25);
  });
});