function fail(code) { const error = new RangeError(code); error.code = code; throw error; }

export function compress(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 0x7fffffff) return null;
  const nibbles = Array.from(bytes, byte => [byte & 15, byte >>> 4]).flat();
  const output = [];
  for (let index = 0; index < nibbles.length;) {
    let count = 1;
    while (count < 16 && index + count < nibbles.length && nibbles[index + count] === nibbles[index]) count++;
    output.push(((count - 1) << 4) | nibbles[index]);
    index += count;
  }
  const metadata = new Uint8Array(4);
  new DataView(metadata.buffer).setUint32(0, bytes.length, true);
  const data = Uint8Array.from(output);
  return data.length + metadata.length < bytes.length ? { data, metadata, encodedSize: data.length + metadata.length } : null;
}

export function decompress(data, metadata = new Uint8Array(), { maxOutput = 1_000_000, expectedLength } = {}) {
  if (!(data instanceof Uint8Array) || !(metadata instanceof Uint8Array)) fail('malformed_compression');
  if (metadata.length === 0) { const length = data[0]; metadata = data.slice(1, 1 + length); data = data.slice(1 + length); }
  if (metadata.length !== 4) fail('malformed_compression');
  const length = new DataView(metadata.buffer, metadata.byteOffset, 4).getUint32(0, true);
  if (length > maxOutput || (expectedLength !== undefined && length !== expectedLength)) fail('compression_limit');
  const nibbles = [];
  for (const token of data) {
    const count = (token >>> 4) + 1;
    if (nibbles.length + count > length * 2) fail('invalid_compression_length');
    nibbles.push(...Array(count).fill(token & 15));
  }
  if (nibbles.length !== length * 2) fail('invalid_compression_length');
  return Uint8Array.from({ length }, (_, index) => nibbles[index * 2] | (nibbles[index * 2 + 1] << 4));
}
