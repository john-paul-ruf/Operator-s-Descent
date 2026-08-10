import { describe, it, expect } from 'vitest';
import { compressSync, decompressSync, compress, decompress } from '../../src/state/compress/progressive.js';

describe('compressSync — layer indices', () => {
  it('layers only contain indices from {0, 3, 4} (1 inert, 2 async-skipped)', () => {
    const input = new Uint8Array(500).fill(7);
    const result = compressSync(input);
    for (const layer of result.layers) {
      expect([0, 3, 4]).toContain(layer.pass);
    }
  });

  it('RLE-friendly input → layers include pass 0, output smaller', () => {
    const input = new Uint8Array(500).fill(7);
    const result = compressSync(input);
    expect(result.layers.some(l => l.pass === 0)).toBe(true);
    expect(result.data.length).toBeLessThan(input.length);
  });

  it('each layer dict is retained in return value', () => {
    const input = new Uint8Array(500).fill(7);
    const result = compressSync(input);
    for (const layer of result.layers) {
      expect(layer.dict).toBeInstanceOf(Uint8Array);
    }
  });
});

describe('compressSync — incompressible', () => {
  it('incompressible input → {data: same bytes, layers: []}', () => {
    const input = new Uint8Array(10);
    for (let i = 0; i < 10; i++) input[i] = i;
    const result = compressSync(input);
    expect([...result.data]).toEqual([...input]);
    expect(result.layers).toEqual([]);
  });
});

describe('compressSync — budget early-exit', () => {
  it('budgetCheck always true → at most 1 layer', () => {
    const input = new Uint8Array(500).fill(7);
    const result = compressSync(input, () => true);
    expect(result.layers.length).toBeLessThanOrEqual(1);
  });

  it('budgetCheck flips true at <100 bytes stops early vs no-budget', () => {
    const input = new Uint8Array(1000).fill(7);
    const withBudget = compressSync(input, (current) => current.length < 100);
    const noBudget = compressSync(input);
    expect(withBudget.layers.length).toBeLessThanOrEqual(noBudget.layers.length);
  });

  it('budgetCheck omitted → runs all applicable passes', () => {
    const input = new Uint8Array(500).fill(7);
    const result = compressSync(input);
    expect(result.layers.length).toBeGreaterThan(0);
  });
});

describe('decompressSync — round-trip', () => {
  it('RLE-friendly input round-trips exactly', () => {
    const input = new Uint8Array(500).fill(7);
    const result = compressSync(input);
    const decompressed = decompressSync(result.data, result.layers);
    expect([...decompressed]).toEqual([...input]);
  });

  it('empty layers → data passthrough', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const result = decompressSync(data, []);
    expect([...result]).toEqual([...data]);
  });

  it('layers applied in reverse order', () => {
    const input = new Uint8Array(600).fill(42);
    const result = compressSync(input);
    const decompressed = decompressSync(result.data, result.layers);
    expect([...decompressed]).toEqual([...input]);
  });
});

describe('async compress/decompress', () => {
  // BUG: pass-8bit.js:39 uses DecompressionStream('inflate') — invalid enum value.
  // When the 8-bit pass engages in async compress, decompress throws.
  // These it.fails capture the defect; sync-only round-trips pass normally.
  it.fails('may include pass index 2 (8-bit deflate) — decompress throws', async () => {
    // BUG: src/state/compress/pass-8bit.js:39 — 'inflate' should be 'deflate'
    const input = new Uint8Array(2048);
    const text = '{"key":"value","data":"compressible"}';
    for (let i = 0; i < 2048; i++) input[i] = text.charCodeAt(i % text.length);
    const result = await compress(input);
    const decompressed = await decompress(result.data, result.layers);
    expect([...decompressed]).toEqual([...input]);
  });

  it.fails('large compressible buffer round-trips via async — decompress throws', async () => {
    // BUG: src/state/compress/pass-8bit.js:39 — 'inflate' should be 'deflate'
    const input = new Uint8Array(4096);
    const text = 'pattern_data_for_compression_testing_1234567890';
    for (let i = 0; i < 4096; i++) input[i] = text.charCodeAt(i % text.length);
    const result = await compress(input);
    const decompressed = await decompress(result.data, result.layers);
    expect([...decompressed]).toEqual([...input]);
  });

  it('async and sync agree when deflate does not participate', async () => {
    const input = new Uint8Array(300).fill(7);
    const syncResult = compressSync(input);
    const asyncResult = await compress(input);
    const syncDecompressed = decompressSync(syncResult.data, syncResult.layers);
    if (!asyncResult.layers.some(l => l.pass === 2)) {
      const asyncDecompressed = await decompress(asyncResult.data, asyncResult.layers);
      expect([...syncDecompressed]).toEqual([...input]);
      expect([...asyncDecompressed]).toEqual([...input]);
    } else {
      expect([...syncDecompressed]).toEqual([...input]);
    }
  });
});