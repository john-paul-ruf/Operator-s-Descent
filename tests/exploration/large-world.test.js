import { describe, it, expect, beforeAll } from 'vitest';
import { generateFloor } from '../../src/floor/generator.js';
import { createLattice } from '../../src/exploration/lattice.js';
import { computeLOS } from '../../src/exploration/shadowcast.js';
import { GRID_W, GRID_H } from '../../src/floor/archetypes.js';
import { createRunState } from '../../src/state/run-state.js';
import { encodeRun, initEncoder } from '../../src/state/save-encode.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { loadData } from '../helpers/data.js';
import { makeParty } from '../helpers/fixtures.js';

const themesData = loadData('themes');

beforeAll(() => initEncoder(loadData('symbol-table')));

describe('40x64 world — dimension source of truth', () => {
  it('archetypes exports GRID_W=40 GRID_H=64 and generated floors match', () => {
    expect(GRID_W).toBe(40);
    expect(GRID_H).toBe(64);
    const floor = generateFloor(42, 1, {}, themesData);
    expect(floor.cells.length).toBe(GRID_H);
    for (const row of floor.cells) expect(row.length).toBe(GRID_W);
  });

  it('lattice reports width/height from the generated grid, not from any hardcoded default', () => {
    const floor = generateFloor(42, 1, {}, themesData);
    const lat = createLattice(floor);
    expect(lat.getWidth()).toBe(GRID_W);
    expect(lat.getHeight()).toBe(GRID_H);
  });
});

describe('40x64 save round-trip — party position with x > 31', () => {
  // Rule 13 belt-and-suspenders: schema v6 uses 7-bit coordinates so x,y up
  // to 127 encode losslessly. This test proves the flip does not silently
  // truncate coordinates back to the pre-flip 5-bit ceiling of 31.
  it('runState.partyPosition {x: 39, y: 63} encodes and decodes without loss', () => {
    const runState = createRunState(4711, makeParty(2));
    runState.partyPosition = { x: 39, y: 63 };
    runState.depth = 5;
    const encoded = encodeRun(runState);
    expect(encoded.success).toBe(true);
    expect(encoded.fragment.length).toBeGreaterThan(0);
    const decoded = decodeRun(encoded.fragment);
    expect(decoded.success).toBe(true);
    const serialized = decoded.runState.serialize();
    expect(serialized.partyPosition).toEqual({ x: 39, y: 63 });
    expect(serialized.worldSeed).toBe(4711);
    expect(serialized.depth).toBe(5);
  });

  it('runState.partyPosition {x: 32, y: 40} (both beyond the pre-flip ceilings) survives round-trip', () => {
    const runState = createRunState(2029, makeParty(2));
    runState.partyPosition = { x: 32, y: 40 };
    runState.depth = 3;
    const encoded = encodeRun(runState);
    expect(encoded.success).toBe(true);
    const decoded = decodeRun(encoded.fragment);
    expect(decoded.success).toBe(true);
    expect(decoded.runState.serialize().partyPosition).toEqual({ x: 32, y: 40 });
  });
});

describe('40x64 shadowcast — full-floor LOS performance smoke', () => {
  // Perf budget: a full-floor LOS recompute at 40x64 with radius 10 (the
  // production DEFAULT_LOS_RADIUS after combat-and-overworld-clarity-pass)
  // must stay well under the 25ms shadowcast p95 budget in
  // tests/performance/release-budgets.test.js. 8ms leaves plenty of headroom
  // for the frame budget on a 60Hz device (16.7ms).
  it('computeLOS from a mid-grid party cell at radius 10 → < 8ms averaged over 20 iters', () => {
    const floor = generateFloor(4711, 5, {}, themesData);
    const lat = createLattice(floor);
    const spawn = lat.getEntryPoint() || lat.getPartyPosition();
    // Warmup — pay JIT costs before measuring.
    for (let i = 0; i < 3; i++) computeLOS(lat, spawn.x, spawn.y, 10);
    const t0 = performance.now();
    const ITERS = 20;
    for (let i = 0; i < ITERS; i++) computeLOS(lat, spawn.x, spawn.y, 10);
    const elapsed = performance.now() - t0;
    const perIter = elapsed / ITERS;
    expect(perIter).toBeLessThan(8);
  });
});
