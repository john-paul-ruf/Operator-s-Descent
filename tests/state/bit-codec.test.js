import { describe, expect, it } from 'vitest';
import { createBitReader, createBitWriter } from '../../src/state/bit-codec.js';

function expectCode(action, code) {
  expect(action).toThrow(expect.objectContaining({ code }));
}

describe('bit codec', () => {
  it('writes least-significant bit first and preserves exact bit lengths', () => {
    const writer = createBitWriter();
    writer.writeBits(0b101, 3);
    expect(writer.toUint8Array()).toEqual(new Uint8Array([0b00000101]));
    expect(writer.bitLength).toBe(3);
    const reader = createBitReader(writer.toUint8Array(), 3);
    expect(reader.readBits(3)).toBe(0b101);
    reader.assertEOF();
  });

  it('round-trips every width through uint32 boundaries', () => {
    for (let width = 1; width <= 32; width++) {
      const maximum = width === 32 ? 0xffffffff : (2 ** width) - 1;
      for (const value of [0, 1, Math.floor(maximum / 2), maximum]) {
        const writer = createBitWriter();
        writer.writeUint(value, width);
        const reader = createBitReader(writer.toUint8Array(), writer.bitLength);
        expect(reader.readUint(width)).toBe(value);
      }
    }
  });

  it('round-trips safe varints and zig-zag signed values', () => {
    for (const value of [0, 1, 127, 128, 16384, 0xffffffff, Number.MAX_SAFE_INTEGER]) {
      const writer = createBitWriter();
      writer.writeVarUint(value);
      expect(createBitReader(writer.toUint8Array(), writer.bitLength).readVarUint()).toBe(value);
    }
    for (const value of [-(2 ** 52 - 1), -2, -1, 0, 1, 2, 2 ** 52 - 1]) {
      const writer = createBitWriter();
      writer.writeVarInt(value);
      expect(createBitReader(writer.toUint8Array(), writer.bitLength).readVarInt()).toBe(value);
    }
  });

  it('round-trips unaligned bytes and zero padding', () => {
    const writer = createBitWriter();
    writer.writeBool(true);
    writer.writeBytes(new Uint8Array([0, 255, 17]));
    writer.alignToByte();
    const reader = createBitReader(writer.toUint8Array(), writer.bitLength);
    expect(reader.readBool()).toBe(true);
    expect(reader.readBytes(3)).toEqual(new Uint8Array([0, 255, 17]));
    reader.alignToByte();
    reader.assertEOF();
  });

  it('round-trips deterministic byte and bit sweeps', () => {
    let seed = 0x12345678;
    const next = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0);
    for (let length = 0; length < 64; length++) {
      const input = Uint8Array.from({ length }, () => next() & 0xff);
      const writer = createBitWriter();
      writer.writeBits(next() & 7, 3);
      writer.writeBytes(input);
      const reader = createBitReader(writer.toUint8Array(), writer.bitLength);
      reader.readBits(3);
      expect(reader.readBytes(length)).toEqual(input);
      reader.assertEOF();
    }
  });

  it('rejects malformed bounds with stable codes', () => {
    const writer = createBitWriter();
    expectCode(() => writer.writeBits(-1, 1), 'invalid_bits');
    expectCode(() => writer.writeBits(4, 2), 'invalid_bits');
    expectCode(() => writer.writeVarUint(-1), 'invalid_varuint');
    const reader = createBitReader(new Uint8Array([0x80]), 8);
    expectCode(() => reader.readVarUint(), 'truncated');
    expectCode(() => createBitReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])).readVarUint(), 'varint_overflow');
    expectCode(() => createBitReader(new Uint8Array([1]), 1).readBits(2), 'truncated');
    expectCode(() => createBitReader(new Uint8Array([1])).assertEOF(), 'trailing_data');
  });
});
