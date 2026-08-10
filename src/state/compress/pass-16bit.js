function fail(code) { const error = new RangeError(code); error.code = code; throw error; }
function word(bytes, index) { return (bytes[index] << 8) | bytes[index + 1]; }

export function compress(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
  const frequencies = new Map();
  for (let index = 0; index + 1 < bytes.length; index++) frequencies.set(word(bytes, index), (frequencies.get(word(bytes, index)) || 0) + 1);
  const dictionary = [...frequencies].filter(([, count]) => count > 1).sort((left, right) => right[1] - left[1] || left[0] - right[0]).slice(0, 64).map(([value]) => value);
  if (!dictionary.length) return null;
  const codes = new Map(dictionary.map((value, index) => [value, index]));
  const data = [];
  for (let index = 0; index < bytes.length;) {
    const code = index + 1 < bytes.length ? codes.get(word(bytes, index)) : undefined;
    if (code !== undefined) { data.push(128 + code); index += 2; }
    else { if (bytes[index] >= 192) data.push(192, bytes[index]); else data.push(bytes[index]); index++; }
  }
  const metadata = Uint8Array.from(dictionary.flatMap(value => [value >>> 8, value & 255]));
  const compressed = Uint8Array.from(data);
  return compressed.length + metadata.length < bytes.length ? { data: compressed, metadata, encodedSize: compressed.length + metadata.length } : null;
}

export function decompress(data, metadata = new Uint8Array(), { maxOutput = 1_000_000, expectedLength } = {}) {
  if (!(data instanceof Uint8Array) || !(metadata instanceof Uint8Array)) fail('malformed_compression');
  if (metadata.length === 0) { const length = data[0]; metadata = data.slice(1, 1 + length); data = data.slice(1 + length); }
  if (!metadata.length || metadata.length % 2 || metadata.length > 128) fail('malformed_compression');
  const output = [];
  for (let index = 0; index < data.length; index++) {
    if (data[index] < 128) output.push(data[index]);
    else if (data[index] < 192) {
      const offset = (data[index] - 128) * 2;
      if (offset + 1 >= metadata.length) fail('malformed_compression');
      output.push(metadata[offset], metadata[offset + 1]);
    } else if (data[index] === 192) { if (++index >= data.length) fail('truncated'); output.push(data[index]); }
    else fail('malformed_compression');
    if (output.length > maxOutput) fail('compression_limit');
  }
  if (expectedLength !== undefined && output.length !== expectedLength) fail('invalid_compression_length');
  return Uint8Array.from(output);
}
