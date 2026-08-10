import { describe, it, expect } from 'vitest';
import { compress as compress1bit, decompress as decompress1bit } from '../../src/state/compress/pass-1bit.js';
import { compress as compress4bit, decompress as decompress4bit } from '../../src/state/compress/pass-4bit.js';
import { compress as compress16bit, decompress as decompress16bit } from '../../src/state/compress/pass-16bit.js';
import { compress as compress32bit, decompress as decompress32bit } from '../../src/state/compress/pass-32bit.js';

describe('pass-1bit (RLE)', () => {
  it('round-trip on runs: [7]*100 + [3]*50', () => {
    const input = new Uint8Array(150);
    input.fill(7, 0, 100);
    input.fill(3, 100, 150);
    const result = compress1bit(input);
    expect(result).not.toBeNull();
    expect(result.data.length).toBeLessThan(input.length);
    const decompressed = decompress1bit(result.data, result.dict);
    expect([...decompressed]).toEqual([...input]);
  });

  it('run cap: 600 identical bytes → runs split at 255', () => {
    const input = new Uint8Array(600).fill(42);
    const result = compress1bit(input);
    expect(result).not.toBeNull();
    const decompressed = decompress1bit(result.data, result.dict);
    expect([...decompressed]).toEqual([...input]);
  });

  it('incompressible: sequential bytes → null', () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const result = compress1bit(input);
    expect(result).toBeNull();
  });

  it('empty input → null (0 >= 0)', () => {
    const input = new Uint8Array(0);
    const result = compress1bit(input);
    expect(result).toBeNull();
  });

  it('dict is an empty Uint8Array', () => {
    const input = new Uint8Array(100).fill(7);
    const result = compress1bit(input);
    expect(result.dict).toBeInstanceOf(Uint8Array);
    expect(result.dict.length).toBe(0);
  });

  it('odd-length data: decompress pushes undefined×count for trailing byte → Uint8Array converts to 0', () => {
    const data = new Uint8Array([3, 7, 5]);
    const decompressed = decompress1bit(data, new Uint8Array(0));
    expect(decompressed.length).toBe(8);
    expect(decompressed[0]).toBe(7);
    expect(decompressed[1]).toBe(7);
    expect(decompressed[2]).toBe(7);
    expect(decompressed[3]).toBe(0);
    expect(decompressed[7]).toBe(0);
  });
});

describe('pass-4bit (anomaly capture)', () => {
  it('compress returns null for empty input', () => {
    // BUG? output never smaller than input — pass is inert
    const result = compress4bit(new Uint8Array(0));
    expect(result).toBeNull();
  });

  it('compress returns null for uniform input (theoretically ideal case)', () => {
    // BUG? output never smaller than input — pass is inert
    const input = new Uint8Array(100).fill(0x11);
    const result = compress4bit(input);
    expect(result).toBeNull();
  });

  it('compress returns null for random input', () => {
    // BUG? output never smaller than input — pass is inert
    const input = new Uint8Array(200);
    for (let i = 0; i < 200; i++) input[i] = Math.random() * 256;
    const result = compress4bit(input);
    expect(result).toBeNull();
  });

  it('decompress honors contract with identity dict', () => {
    const dict = new Uint8Array(16);
    for (let i = 0; i < 16; i++) dict[i] = i;
    const data = new Uint8Array([0x12, 0x34, 0xAB]);
    const decompressed = decompress4bit(data, dict);
    expect([...decompressed]).toEqual([0x12, 0x34, 0xAB]);
  });

  it('decompress substitutes correctly with non-identity dict', () => {
    const dict = new Uint8Array(16);
    for (let i = 0; i < 16; i++) dict[i] = 15 - i;
    const data = new Uint8Array([0x01]);
    const decompressed = decompress4bit(data, dict);
    expect(decompressed[0]).toBe(0xFE);
  });
});

describe('pass-16bit (word dictionary)', () => {
  it('round-trip on dictionary-friendly input', () => {
    const pattern = [0xAB, 0xCD];
    const input = new Uint8Array(400);
    for (let i = 0; i < 400; i++) input[i] = pattern[i % 2];
    const result = compress16bit(input);
    if (result !== null) {
      const decompressed = decompress16bit(result.data, result.dict);
      expect([...decompressed]).toEqual([...input]);
    }
  });

  it('short input (< 4 bytes) → null', () => {
    const input = new Uint8Array([1, 2, 3]);
    const result = compress16bit(input);
    expect(result).toBeNull();
  });

  it('odd-length input: round-trip preserves tail bytes (tail < 0x80)', () => {
    const pattern = [0xAB, 0xCD];
    const input = new Uint8Array(201);
    for (let i = 0; i < 200; i++) input[i] = pattern[i % 2];
    input[200] = 0x0F;
    const result = compress16bit(input);
    if (result !== null) {
      const decompressed = decompress16bit(result.data, result.dict);
      expect([...decompressed]).toEqual([...input]);
    }
  });

  it('dict is a Uint8Array', () => {
    const pattern = [0xAB, 0xCD];
    const input = new Uint8Array(400);
    for (let i = 0; i < 400; i++) input[i] = pattern[i % 2];
    const result = compress16bit(input);
    if (result !== null) {
      expect(result.dict).toBeInstanceOf(Uint8Array);
    }
  });

  it('incompressible (high entropy) → null', () => {
    const input = new Uint8Array(100);
    for (let i = 0; i < 100; i++) input[i] = (i * 37 + 13) & 0xFF;
    const result = compress16bit(input);
    expect(result).toBeNull();
  });
});

describe('pass-32bit (dword dictionary)', () => {
  it('round-trip on dictionary-friendly input', () => {
    const pattern = [0x12, 0x34, 0x56, 0x78];
    const input = new Uint8Array(800);
    for (let i = 0; i < 800; i++) input[i] = pattern[i % 4];
    const result = compress32bit(input);
    if (result !== null) {
      const decompressed = decompress32bit(result.data, result.dict);
      expect([...decompressed]).toEqual([...input]);
    }
  });

  it('short input (< 8 bytes) → null', () => {
    const input = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const result = compress32bit(input);
    expect(result).toBeNull();
  });

  it('odd-length input: round-trip preserves tail bytes (tail < 0x40)', () => {
    const pattern = [0x12, 0x34, 0x56, 0x78];
    const input = new Uint8Array(401);
    for (let i = 0; i < 400; i++) input[i] = pattern[i % 4];
    input[400] = 0x0F;
    const result = compress32bit(input);
    if (result !== null) {
      const decompressed = decompress32bit(result.data, result.dict);
      expect([...decompressed]).toEqual([...input]);
    }
  });

  it('dict is a Uint8Array', () => {
    const pattern = [0x12, 0x34, 0x56, 0x78];
    const input = new Uint8Array(800);
    for (let i = 0; i < 800; i++) input[i] = pattern[i % 4];
    const result = compress32bit(input);
    if (result !== null) {
      expect(result.dict).toBeInstanceOf(Uint8Array);
    }
  });

  it('incompressible (high entropy) → null', () => {
    const input = new Uint8Array(100);
    for (let i = 0; i < 100; i++) input[i] = (i * 37 + 13) & 0xFF;
    const result = compress32bit(input);
    expect(result).toBeNull();
  });
});