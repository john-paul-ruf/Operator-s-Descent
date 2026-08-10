const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_VARINT_BYTES = 8;

function fail(code) {
  const error = new RangeError(code);
  error.code = code;
  throw error;
}

function isUint(value, maximum = MAX_SAFE) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

export function createBitWriter() {
  const bytes = [];
  let bitLength = 0;

  function writeBits(value, width) {
    if (!isUint(width, 32) || width < 1 || !isUint(value) || (width < 32 && value >= 2 ** width) || (width === 32 && value > 0xffffffff)) fail('invalid_bits');
    for (let bit = 0; bit < width; bit++) {
      const byteIndex = Math.floor(bitLength / 8);
      const bitIndex = bitLength % 8;
      if (bitIndex === 0) bytes.push(0);
      if (bit < 32 ? ((value >>> bit) & 1) : Math.floor(value / 2 ** bit) % 2) bytes[byteIndex] |= 1 << bitIndex;
      bitLength += 1;
    }
  }

  function writeBool(value) {
    if (typeof value !== 'boolean') fail('invalid_bool');
    writeBits(value ? 1 : 0, 1);
  }

  function writeUint(value, width) {
    writeBits(value, width);
  }

  function writeVarUint(value) {
    if (!isUint(value)) fail('invalid_varuint');
    let remaining = value;
    do {
      const byte = remaining % 128;
      remaining = Math.floor(remaining / 128);
      writeBits(byte | (remaining ? 0x80 : 0), 8);
    } while (remaining);
  }

  function writeVarInt(value) {
    if (!Number.isSafeInteger(value)) fail('invalid_varint');
    writeVarUint(value >= 0 ? value * 2 : (-value * 2) - 1);
  }

  function alignToByte() {
    if (bitLength % 8) writeBits(0, 8 - (bitLength % 8));
  }

  function writeBytes(value) {
    if (!(value instanceof Uint8Array)) fail('invalid_bytes');
    for (const byte of value) writeBits(byte, 8);
  }

  function toUint8Array() {
    return Uint8Array.from(bytes);
  }

  return { writeBits, writeBool, writeUint, writeVarUint, writeVarInt, writeBytes, alignToByte, toUint8Array, get bitLength() { return bitLength; } };
}

export function createBitReader(bytes, bitLength = bytes?.length * 8) {
  if (!(bytes instanceof Uint8Array)) fail('invalid_bytes');
  if (!isUint(bitLength, bytes.length * 8)) fail('invalid_bit_length');
  let offset = 0;

  function readBits(width) {
    if (!isUint(width, 32) || width < 1) fail('invalid_bits');
    if (offset + width > bitLength) fail('truncated');
    let value = 0;
    for (let bit = 0; bit < width; bit++) {
      const sourceBit = offset + bit;
      const enabled = (bytes[Math.floor(sourceBit / 8)] >>> (sourceBit % 8)) & 1;
      if (enabled) value += 2 ** bit;
    }
    offset += width;
    return value;
  }

  function readBool() {
    return readBits(1) === 1;
  }

  function readUint(width) {
    return readBits(width);
  }

  function readVarUint() {
    let value = 0;
    let multiplier = 1;
    for (let count = 0; count < MAX_VARINT_BYTES; count++) {
      const byte = readBits(8);
      value += (byte & 0x7f) * multiplier;
      if (value > MAX_SAFE) fail('varint_overflow');
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    fail('varint_overflow');
  }

  function readVarInt() {
    const value = readVarUint();
    return value % 2 === 0 ? value / 2 : -((value + 1) / 2);
  }

  function alignToByte() {
    const padding = offset % 8;
    if (padding) readBits(8 - padding);
  }

  function readBytes(length) {
    if (!isUint(length, Math.floor((bitLength - offset) / 8))) fail('invalid_length');
    const output = new Uint8Array(length);
    for (let index = 0; index < length; index++) output[index] = readBits(8);
    return output;
  }

  function assertEOF() {
    if (bitLength - offset !== 0) fail('trailing_data');
  }

  return { readBits, readBool, readUint, readVarUint, readVarInt, readBytes, alignToByte, assertEOF, get remainingBits() { return bitLength - offset; } };
}
