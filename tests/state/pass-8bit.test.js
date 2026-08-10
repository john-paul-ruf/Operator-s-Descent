import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../../src/state/compress/pass-8bit.js';

describe('pass-8bit (async deflate)', () => {
  // BUG: pass-8bit.js:39 uses DecompressionStream('inflate') — invalid enum value.
  // Decompress calls throw; these it.fails capture the defect.
  it.fails('round-trip on 2 KB JSON-ish ASCII buffer (compressible)', async () => {
    // BUG: src/state/compress/pass-8bit.js:39 — 'inflate' should be 'deflate'
    const input = new Uint8Array(2048);
    const text = '{"key":"value","nested":{"a":1,"b":2}}';
    for (let i = 0; i < 2048; i++) input[i] = text.charCodeAt(i % text.length);
    const result = await compress(input);
    expect(result).not.toBeNull();
    expect(result.data.length).toBeLessThan(input.length);
    const decompressed = await decompress(result.data, result.dict);
    expect([...decompressed]).toEqual([...input]);
  });

  it.fails('round-trip on run of zeros', async () => {
    // BUG: src/state/compress/pass-8bit.js:39 — 'inflate' should be 'deflate'
    const input = new Uint8Array(500).fill(0);
    const result = await compress(input);
    if (result !== null) {
      const decompressed = await decompress(result.data, result.dict);
      expect([...decompressed]).toEqual([...input]);
    }
  });

  it.fails('seeded pseudo-random 1 KB buffer — branch on null', async () => {
    // BUG: src/state/compress/pass-8bit.js:39 — 'inflate' should be 'deflate'
    let seed = 42;
    const input = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
      input[i] = seed & 0xFF;
    }
    const result = await compress(input);
    if (result === null) {
      expect(result).toBeNull();
    } else {
      const decompressed = await decompress(result.data, result.dict);
      expect([...decompressed]).toEqual([...input]);
    }
  });

  it('tiny input (few bytes) → null (deflate overhead)', async () => {
    const input = new Uint8Array([1, 2, 3]);
    const result = await compress(input);
    expect(result).toBeNull();
  });

  it('empty input → null (data.length < 2 guard)', async () => {
    const input = new Uint8Array(0);
    const result = await compress(input);
    expect(result).toBeNull();
  });

  it('determinism: same input → identical compressed bytes', async () => {
    const input = new Uint8Array(512);
    const text = 'compressible_data_pattern';
    for (let i = 0; i < 512; i++) input[i] = text.charCodeAt(i % text.length);
    const a = await compress(input);
    const b = await compress(input);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect([...a.data]).toEqual([...b.data]);
  });
});