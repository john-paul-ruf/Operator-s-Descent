import { describe, expect, it } from 'vitest';
import { compress, decompress } from '../../src/state/compress/pass-8bit.js';

describe('native deflate pass', () => {
  it('round-trips compressible data when native streams are available', async () => {
    const input = new Uint8Array(2048).fill(0).map((_, index) => 'save-state-pattern'[index % 18].charCodeAt(0));
    const result = await compress(input);
    if (!result) return;
    expect(result.encodedSize).toBeLessThan(input.length);
    expect([...await decompress(result.data, result.metadata, { expectedLength: input.length })]).toEqual([...input]);
  });

  it('returns null for empty input and never fabricates an unavailable decode', async () => {
    expect(await compress(new Uint8Array())).toBeNull();
    if (typeof DecompressionStream === 'undefined') await expect(decompress(new Uint8Array(), new Uint8Array())).rejects.toThrow('unsupported_compression');
  });
});
