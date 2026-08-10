import { describe, it, expect } from 'vitest';
import { computeLOS, updateFogOfWar } from '../../src/exploration/shadowcast.js';
import { createLattice } from '../../src/exploration/lattice.js';
import { makeGrid, carve } from '../helpers/grids.js';

describe('computeLOS — open room', () => {
  const grid = makeGrid(20, 20, 0);
  carve(grid, 1, 1, 18, 18, 1);
  const lat = createLattice({ cells: grid });

  it('origin visible', () => {
    const vis = computeLOS(lat, 10, 10, 4);
    expect(vis.has('10,10')).toBe(true);
  });

  it('all 4-adjacent cells visible', () => {
    const vis = computeLOS(lat, 10, 10, 4);
    expect(vis.has('10,9')).toBe(true);
    expect(vis.has('10,11')).toBe(true);
    expect(vis.has('9,10')).toBe(true);
    expect(vis.has('11,10')).toBe(true);
  });

  it('no visible cell farther than radius + 2 in Euclidean distance', () => {
    const vis = computeLOS(lat, 10, 10, 4);
    for (const key of vis) {
      const [x, y] = key.split(',').map(Number);
      const dist = Math.sqrt((x - 10) ** 2 + (y - 10) ** 2);
      expect(dist).toBeLessThanOrEqual(6);
    }
  });
});

describe('computeLOS — wall occlusion', () => {
  it('wall cell visible, cell behind it not', () => {
    const grid = makeGrid(20, 20, 0);
    carve(grid, 1, 1, 18, 18, 1);
    grid[10][12] = 0;
    const lat = createLattice({ cells: grid });
    const vis = computeLOS(lat, 10, 10, 8);
    expect(vis.has('12,10')).toBe(true);
    expect(vis.has('13,10')).toBe(false);
  });
});

describe('computeLOS — edge cases', () => {
  it('radius 0 → only origin', () => {
    const grid = makeGrid(20, 20, 1);
    const lat = createLattice({ cells: grid });
    const vis = computeLOS(lat, 10, 10, 0);
    expect(vis.size).toBe(1);
    expect(vis.has('10,10')).toBe(true);
  });

  it('radius 1 → ≤ 9 cells (origin + ring)', () => {
    const grid = makeGrid(20, 20, 1);
    const lat = createLattice({ cells: grid });
    const vis = computeLOS(lat, 10, 10, 1);
    expect(vis.size).toBeLessThanOrEqual(9);
  });

  it('origin near border → no throw, no OOB keys', () => {
    const grid = makeGrid(20, 20, 1);
    const lat = createLattice({ cells: grid });
    const vis = computeLOS(lat, 0, 0, 5);
    for (const key of vis) {
      const [x, y] = key.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(20);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(20);
    }
  });
});

describe('updateFogOfWar', () => {
  it('fog all zeros + visible set → those become 2', () => {
    const fog = new Uint8Array(640);
    const vis = new Set(['5,5', '6,5', '5,6']);
    updateFogOfWar(fog, vis);
    expect(fog[5 * 20 + 5]).toBe(2);
    expect(fog[5 * 20 + 6]).toBe(2);
    expect(fog[6 * 20 + 5]).toBe(2);
  });

  it('second call with shifted set → formerly-2 become 1, new become 2', () => {
    const fog = new Uint8Array(640);
    const vis1 = new Set(['5,5', '6,5']);
    updateFogOfWar(fog, vis1);
    const vis2 = new Set(['7,5', '8,5']);
    updateFogOfWar(fog, vis2);
    expect(fog[5 * 20 + 5]).toBe(1);
    expect(fog[5 * 20 + 6]).toBe(1);
    expect(fog[5 * 20 + 7]).toBe(2);
    expect(fog[5 * 20 + 8]).toBe(2);
  });

  it('re-seen 1 → 2', () => {
    const fog = new Uint8Array(640);
    const vis1 = new Set(['5,5']);
    updateFogOfWar(fog, vis1);
    const vis2 = new Set([]);
    updateFogOfWar(fog, vis2);
    expect(fog[5 * 20 + 5]).toBe(1);
    const vis3 = new Set(['5,5']);
    updateFogOfWar(fog, vis3);
    expect(fog[5 * 20 + 5]).toBe(2);
  });

  it('cells never regress 1→0', () => {
    const fog = new Uint8Array(640);
    fog[100] = 1;
    const vis = new Set([]);
    updateFogOfWar(fog, vis);
    expect(fog[100]).toBe(1);
  });

  it('visible keys outside 0–639 ignored', () => {
    const fog = new Uint8Array(640);
    const vis = new Set(['25,40']);
    expect(() => updateFogOfWar(fog, vis)).not.toThrow();
  });
});