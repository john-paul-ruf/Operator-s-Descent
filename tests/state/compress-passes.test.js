import { describe, expect, it } from 'vitest';
import * as pass1 from '../../src/state/compress/pass-1bit.js';
import * as pass4 from '../../src/state/compress/pass-4bit.js';
import * as pass16 from '../../src/state/compress/pass-16bit.js';
import * as pass32 from '../../src/state/compress/pass-32bit.js';

const passes = [pass1, pass4, pass16, pass32];
const bytes = values => Uint8Array.from(values);

function verify(pass, input) {
  const result = pass.compress(input);
  if (!result) return;
  expect(result.encodedSize).toBe(result.data.length + result.metadata.length);
  expect(result.encodedSize).toBeLessThan(input.length);
  expect([...pass.decompress(result.data, result.metadata, { expectedLength: input.length })]).toEqual([...input]);
}

describe('lossless synchronous passes', () => {
  it('round-trip every byte value, marker-heavy runs, odd lengths, and incompressible data', () => {
    const allBytes = bytes(Array.from({ length: 256 }, (_, index) => index));
    const markerHeavy = bytes(Array.from({ length: 1025 }, (_, index) => index % 3 === 0 ? 255 : index % 256));
    const repeats = bytes(Array.from({ length: 801 }, (_, index) => [0, 0, 255, 255, 17][index % 5]));
    for (const pass of passes) for (const input of [new Uint8Array(), allBytes, markerHeavy, repeats, repeats.slice(0, -1)]) verify(pass, input);
  });

  it('engages each applicable pass on its native pattern without losing marker bytes', () => {
    const inputs = [
      [pass1, bytes(Array.from({ length: 768 }, (_, index) => index < 512 ? 255 : 0))],
      [pass4, bytes(new Array(768).fill(0x11))],
      [pass16, bytes(Array.from({ length: 768 }, (_, index) => [255, 128, 255, 128, 17][index % 5]))],
      [pass32, bytes(Array.from({ length: 1024 }, (_, index) => [255, 144, 128, 17, 255, 144, 128, 17, 3][index % 9]))],
    ];
    for (const [pass, input] of inputs) {
      const result = pass.compress(input);
      expect(result).not.toBeNull();
      expect([...pass.decompress(result.data, result.metadata, { expectedLength: input.length })]).toEqual([...input]);
    }
  });

  it('uses strict malformed and expansion bounds', () => {
    expect(() => pass1.decompress(bytes([1]), new Uint8Array())).toThrow('malformed_compression');
    expect(() => pass16.decompress(bytes([255]), bytes([1, 2]))).toThrow();
    expect(() => pass32.decompress(bytes([255, 9]), bytes([1, 2, 3, 4]))).toThrow('malformed_compression');
    expect(() => pass1.decompress(bytes([255, 1]), new Uint8Array(), { maxOutput: 10 })).toThrow('compression_limit');
  });
});
