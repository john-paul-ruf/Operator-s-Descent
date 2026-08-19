import { describe, it, expect } from 'vitest';
import { validateFloor, countOneWideCorridors, MAX_ONE_WIDE_CORRIDOR } from '../../src/floor/validator.js';
import { makeGrid, carve } from '../helpers/grids.js';

describe('validator — return shape', () => {
  it('returns {valid, failures, metrics} for a valid floor', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 4, 4, 1);
    carve(grid, 8, 1, 4, 4, 1);
    carve(grid, 1, 7, 4, 4, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 2, y: 2 }, containers: [] });
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('failures');
    expect(result).toHaveProperty('metrics');
    expect(result.metrics).toHaveProperty('openCells');
    expect(result.metrics).toHaveProperty('connectedCells');
    expect(result.metrics).toHaveProperty('loops');
    expect(result.metrics).toHaveProperty('maxRegion');
  });
});

describe('validator — no-floor-cells', () => {
  it('all walls → {valid: false, failures: ["no-floor-cells"]}', () => {
    const grid = makeGrid(20, 32, 0);
    const result = validateFloor({ cells: grid, descentPoint: null, containers: [] });
    expect(result.valid).toBe(false);
    expect(result.failures).toContain('no-floor-cells');
  });
});

describe('validator — connectivity', () => {
  it('two open rooms separated by full wall column → failures include connectivity', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 8, 30, 1);
    carve(grid, 11, 1, 8, 30, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 5, y: 5 }, containers: [] });
    expect(result.failures).toContain('connectivity');
  });
});

describe('validator — loop-density', () => {
  it('serpentine corridor with > 50 open cells and < 3 junctions → includes loop-density', () => {
    const grid = makeGrid(20, 32, 0);
    let y = 1;
    let leftToRight = true;
    while (y < 31) {
      const startX = leftToRight ? 1 : 18;
      const endX = leftToRight ? 18 : 1;
      const step = leftToRight ? 1 : -1;
      for (let x = startX; leftToRight ? x <= endX : x >= endX; x += step) {
        grid[y][x] = 1;
      }
      grid[y + 1][leftToRight ? 18 : 1] = 1;
      y += 2;
      leftToRight = !leftToRight;
    }
    const result = validateFloor({ cells: grid, descentPoint: { x: 1, y: 1 }, containers: [] });
    expect(result.failures).toContain('loop-density');
  });

  it('same shape with < 50 open cells → does NOT include loop-density', () => {
    const grid = makeGrid(10, 10, 0);
    let y = 1;
    let leftToRight = true;
    while (y < 9) {
      const startX = leftToRight ? 1 : 8;
      const endX = leftToRight ? 8 : 1;
      const step = leftToRight ? 1 : -1;
      for (let x = startX; leftToRight ? x <= endX : x >= endX; x += step) {
        grid[y][x] = 1;
      }
      if (y + 1 < 9) grid[y + 1][leftToRight ? 8 : 1] = 1;
      y += 2;
      leftToRight = !leftToRight;
    }
    const result = validateFloor({ cells: grid, descentPoint: { x: 1, y: 1 }, containers: [] });
    expect(result.failures).not.toContain('loop-density');
  });
});

describe('validator — open-cell-bounds', () => {
  it('one open blob > 200 cells → includes open-cell-bounds', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 18, 20, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 5, y: 5 }, containers: [] });
    expect(result.failures).toContain('open-cell-bounds');
  });
});

describe('validator — descent-reachability', () => {
  it('descentPoint missing → includes descent-reachability', () => {
    const grid = makeGrid(10, 10, 0);
    carve(grid, 1, 1, 8, 8, 1);
    const result = validateFloor({ cells: grid, descentPoint: null, containers: [] });
    expect(result.failures).toContain('descent-reachability');
  });

  it('descentPoint on a wall cell → includes descent-reachability', () => {
    const grid = makeGrid(10, 10, 0);
    carve(grid, 1, 1, 8, 8, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 0, y: 0 }, containers: [] });
    expect(result.failures).toContain('descent-reachability');
  });

  it('descentPoint inside unreachable second component → includes descent-reachability', () => {
    const grid = makeGrid(20, 10, 0);
    carve(grid, 1, 1, 8, 8, 1);
    carve(grid, 11, 1, 8, 8, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 15, y: 5 }, containers: [] });
    expect(result.failures).toContain('descent-reachability');
  });
});

describe('validator — container-accessibility', () => {
  it('container on a wall → includes container-accessibility', () => {
    const grid = makeGrid(10, 10, 0);
    carve(grid, 1, 1, 8, 8, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 5, y: 5 }, containers: [{ x: 0, y: 0 }] });
    expect(result.failures).toContain('container-accessibility');
  });

  it('container out of bounds → includes container-accessibility', () => {
    const grid = makeGrid(10, 10, 0);
    carve(grid, 1, 1, 8, 8, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 5, y: 5 }, containers: [{ x: 50, y: 50 }] });
    expect(result.failures).toContain('container-accessibility');
  });

  it('two bad containers → single failure entry (breaks after first)', () => {
    const grid = makeGrid(10, 10, 0);
    carve(grid, 1, 1, 8, 8, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 5, y: 5 }, containers: [{ x: 0, y: 0 }, { x: 0, y: 9 }] });
    expect(result.failures.filter(f => f === 'container-accessibility')).toHaveLength(1);
  });
});

describe('validator — interior-cover', () => {
  it('four disconnected 1-wide corridors with > 100 open cells, each < 40, loops < 2 → includes interior-cover', () => {
    const grid = makeGrid(20, 32, 0);
    for (let i = 0; i < 4; i++) {
      for (let y = 1; y <= 30; y++) grid[y][1 + i * 5] = 1;
    }
    const result = validateFloor({ cells: grid, descentPoint: { x: 1, y: 1 }, containers: [] });
    expect(result.failures).toContain('interior-cover');
    expect(result.failures).toContain('connectivity');
  });
});

describe('validator — metrics', () => {
  it('metrics.openCells counts all walkable cells', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 10, 10, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 5, y: 5 }, containers: [] });
    expect(result.metrics.openCells).toBe(100);
  });

  it('metrics.maxRegion matches largest contiguous region', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 5, 5, 1);
    carve(grid, 10, 10, 8, 8, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 2, y: 2 }, containers: [] });
    expect(result.metrics.maxRegion).toBe(64);
  });

  it('metrics.loops counts junction points (≥3 open neighbors)', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 4, 4, 1);
    carve(grid, 8, 1, 4, 4, 1);
    carve(grid, 1, 7, 4, 4, 1);
    carve(grid, 8, 7, 4, 4, 1);
    grid[2][5] = 1; grid[2][6] = 1; grid[2][7] = 1;
    grid[8][5] = 1; grid[8][6] = 1; grid[8][7] = 1;
    grid[5][2] = 1; grid[6][2] = 1;
    grid[5][9] = 1; grid[6][9] = 1;
    const result = validateFloor({ cells: grid, descentPoint: { x: 2, y: 2 }, containers: [] });
    expect(result.metrics.loops).toBeGreaterThan(0);
  });
});

describe('validator — corridor-width', () => {
  it('MAX_ONE_WIDE_CORRIDOR is exported and > 0', () => {
    expect(typeof MAX_ONE_WIDE_CORRIDOR).toBe('number');
    expect(MAX_ONE_WIDE_CORRIDOR).toBeGreaterThan(0);
  });

  it('countOneWideCorridors counts collinear-neighbor open cells only', () => {
    const grid = makeGrid(20, 32, 0);
    // A 20-cell horizontal snake — every interior cell has E+W collinear open pair.
    for (let x = 1; x < 21; x++) grid[5][x] = 1;
    // Endpoints (x=1 and x=20) each have only one collinear open neighbor,
    // so are not counted; the 18 interior cells are.
    expect(countOneWideCorridors(grid)).toBe(18);
  });

  it('20-cell collinear snake fails corridor-width', () => {
    const grid = makeGrid(20, 32, 0);
    for (let x = 1; x < 20; x++) grid[5][x] = 1;
    const result = validateFloor({ cells: grid, descentPoint: { x: 1, y: 5 }, containers: [] });
    expect(result.failures).toContain('corridor-width');
  });

  it('4x4 room with a 2-wide 4-cell corridor passes corridor-width', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 2, 2, 4, 4, 1);
    carve(grid, 10, 2, 4, 4, 1);
    // 2-wide corridor connecting the two rooms
    for (let x = 6; x < 10; x++) {
      grid[3][x] = 1;
      grid[4][x] = 1;
    }
    const result = validateFloor({ cells: grid, descentPoint: { x: 3, y: 3 }, containers: [] });
    expect(result.failures).not.toContain('corridor-width');
  });

  it('metrics.oneWideCorridors is reported', () => {
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 5, 5, 1);
    const result = validateFloor({ cells: grid, descentPoint: { x: 2, y: 2 }, containers: [] });
    expect(typeof result.metrics.oneWideCorridors).toBe('number');
  });
});

describe('validator — fully valid floor', () => {
  it('chambers-like hand-grid with loops, all features reachable → {valid: true, failures: []}', () => {
    // Regenerated per Custom Rule 11 — the pre-widening fixture used 1-cell
    // connectors between rooms which now trip the corridor-width check.
    // 2-wide connectors keep the geometry chambers-like while respecting the
    // new baseline; multiple loops still exercise the loops metric.
    const grid = makeGrid(20, 32, 0);
    carve(grid, 1, 1, 4, 4, 1);
    carve(grid, 8, 1, 4, 4, 1);
    carve(grid, 14, 1, 4, 4, 1);
    carve(grid, 1, 7, 4, 4, 1);
    carve(grid, 8, 7, 4, 4, 1);
    carve(grid, 14, 7, 4, 4, 1);
    // Horizontal 2-wide connectors between neighbouring rooms.
    for (let x = 5; x < 8; x++) { grid[2][x] = 1; grid[3][x] = 1; }
    for (let x = 12; x < 14; x++) { grid[2][x] = 1; grid[3][x] = 1; }
    for (let x = 5; x < 8; x++) { grid[8][x] = 1; grid[9][x] = 1; }
    for (let x = 12; x < 14; x++) { grid[8][x] = 1; grid[9][x] = 1; }
    // Vertical 2-wide connectors between top-row and bottom-row rooms.
    for (let y = 5; y < 7; y++) { grid[y][2] = 1; grid[y][3] = 1; }
    for (let y = 5; y < 7; y++) { grid[y][9] = 1; grid[y][10] = 1; }
    for (let y = 5; y < 7; y++) { grid[y][15] = 1; grid[y][16] = 1; }
    const result = validateFloor({
      cells: grid,
      descentPoint: { x: 2, y: 2 },
      containers: [{ x: 9, y: 2 }],
    });
    expect(result.valid).toBe(true);
    expect(result.failures).toEqual([]);
  });
});