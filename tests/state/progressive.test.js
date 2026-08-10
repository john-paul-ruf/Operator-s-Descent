import { describe, expect, it } from 'vitest';
import { compress, compressSync, decompress, decompressSync } from '../../src/state/compress/progressive.js';

const input = new Uint8Array(1000).fill(0).map((_, index) => [0, 0, 255, 255, 17][index % 5]);

describe('progressive framed compression', () => {
  it('records self-describing layers and reverses synchronous streams exactly', () => {
    const result = compressSync(input);
    expect(result.layers.length).toBeGreaterThan(0);
    for (const layer of result.layers) expect(layer).toBeInstanceOf(Uint8Array);
    const dictionaryLayer = result.layers.find(layer => layer[0] === 3);
    expect(new DataView(dictionaryLayer.buffer, dictionaryLayer.byteOffset, dictionaryLayer.byteLength).getUint16(5, true)).toBeGreaterThan(0);
    expect([...decompressSync(result.data, result.layers, { maxOutput: input.length })]).toEqual([...input]);
  });

  it('rejects malformed, truncated, and trailing layer frames', () => {
    const result = compressSync(input);
    expect(() => decompressSync(result.data, [result.layers[0].slice(0, -1)])).toThrow();
    const trailing = new Uint8Array(result.layers[0].length + 1);
    trailing.set(result.layers[0]);
    expect(() => decompressSync(result.data, [trailing])).toThrow('malformed_compression');
  });

  it('reverses async layers when the native pass is available', async () => {
    const result = await compress(input);
    expect([...await decompress(result.data, result.layers, { maxOutput: input.length })]).toEqual([...input]);
  });
});
