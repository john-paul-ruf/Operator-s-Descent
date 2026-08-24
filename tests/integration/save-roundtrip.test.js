import { beforeAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { SAVE_BUDGET, encodeRun, initEncoder } from '../../src/state/save-encode.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { INVENTORY_CAP } from '../../src/rules/inventory.js';
import { saveRun, loadRun, deleteRunState } from '../../src/state/library.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { buildRealisticRun } from '../helpers/run-builder.js';
import { loadData } from '../helpers/data.js';

beforeAll(() => {
  initEncoder(loadData('symbol-table'));
});

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

describe('save round-trip — 25-seed property sweep', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: encode → decode → deep-equal serialize`, () => {
      const items = seed % 2;
      const state = buildRealisticRun(seed, {
        depth: (seed % 10) + 1,
        inventoryItems: items,
        fogCells: (seed * 3) % 80,
      });
      const original = state.serialize();
      const encoded = encodeRun(state);
      expect(encoded.success).toBe(true);

      const decoded = decodeRun(encoded.fragment);
      expect(decoded.success).toBe(true);
      expect(decoded.runState.serialize()).toEqual(original);
    });
  }
});

describe('save round-trip — budget suite (Custom Rule 6, v7)', () => {
  // v7 caps inventory at INVENTORY_CAP=40. Sizes above the cap are illegal
  // for a live save (validateRunState rejects them) — the migration hop
  // handles legacy oversized inventories at load. The size sweep here stops
  // at the cap; the depth-30-cap-inventory stress case covers the ceiling.
  const sizes = [0, 1, 2, 3, 5, 10, 25, INVENTORY_CAP];
  const lengths = {};
  for (const n of sizes) {
    it(`inventory ${n} items: fragment length recorded`, () => {
      const state = buildRealisticRun(42, { depth: 5, inventoryItems: n });
      const result = encodeRun(state);
      lengths[n] = result.length;
      expect(result.success).toBe(true);
      expect(result.length).toBeLessThan(SAVE_BUDGET);
      expect(result.fragment).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  }

  it(`stress state: depth 30, ${INVENTORY_CAP} items, all fog visited, 2 echoes`, () => {
    const state = buildRealisticRun(42, {
      depth: 30,
      inventoryItems: INVENTORY_CAP,
      fogCells: 640,
      echoes: 2,
    });
    for (let i = 0; i < 40; i++) {
      state.markContainerOpened(i);
      state.markEnemyDefeated(i);
    }
    const result = encodeRun(state);
    expect(result.success).toBe(true);
    expect(result.length).toBeLessThan(SAVE_BUDGET);
    expect(result.fragment).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('save round-trip — RNG continuity', () => {
  it('cursor state preserved through save/resume: next 10 draws match', () => {
    const seed = 42;
    const state = buildRealisticRun(seed, { depth: 1, inventoryItems: 0 });
    const cursor = createRNGCursorForRun(seed, state.rngState);
    const refGen = [];
    for (let i = 0; i < 10; i++) refGen.push(cursor.next('gen'));

    const encoded = encodeRun(state);
    expect(encoded.success).toBe(true);
    const decoded = decodeRun(encoded.fragment);
    expect(decoded.success).toBe(true);

    const resumed = createRNGCursorForRun(seed, decoded.runState.rngState);
    const resumedGen = [];
    for (let i = 0; i < 10; i++) resumedGen.push(resumed.next('gen'));
    expect(resumedGen).toEqual(refGen);

    const refCombat = [];
    for (let i = 0; i < 10; i++) refCombat.push(cursor.nextInt('combat', 20));
    const resumedCombat = [];
    for (let i = 0; i < 10; i++) resumedCombat.push(resumed.nextInt('combat', 20));
    expect(resumedCombat).toEqual(refCombat);
  });
});

describe('save round-trip — storage-backed loop', () => {
  let mock;
  beforeEach(() => { mock = installMockStorage(); });
  afterEach(() => { mock.uninstall(); });

  it('saveRun → loadRun → serialize-equality → delete → not_found', () => {
    const state = buildRealisticRun(7, { depth: 3, inventoryItems: 1, fogCells: 50 });
    const saved = saveRun(state);
    expect(saved.success).toBe(true);

    const loaded = loadRun(saved.key);
    expect(loaded.success).toBe(true);
    expect(loaded.runState.serialize()).toEqual(state.serialize());

    deleteRunState(saved.key);
    const afterDelete = loadRun(saved.key);
    expect(afterDelete).toEqual({ success: false, error: 'not_found' });
  });
});
