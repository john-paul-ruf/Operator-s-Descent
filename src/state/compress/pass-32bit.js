function fail(code) { const error = new RangeError(code); error.code = code; throw error; }
function dword(bytes, index) { return `${bytes[index]},${bytes[index + 1]},${bytes[index + 2]},${bytes[index + 3]}`; }

export function compress(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
  const frequencies = new Map();
  for (let index = 0; index + 3 < bytes.length; index++) { const value = dword(bytes, index); frequencies.set(value, (frequencies.get(value) || 0) + 1); }
  const dictionary = [...frequencies].filter(([, count]) => count > 1).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8).map(([value]) => value.split(',').map(Number));
  if (!dictionary.length) return null;
  const codes = new Map(dictionary.map((value, index) => [value.join(','), index]));
  const data = [];
  for (let index = 0; index < bytes.length;) {
    const code = index + 3 < bytes.length ? codes.get(dword(bytes, index)) : undefined;
    if (code !== undefined) { data.push(128 + code); index += 4; }
    else { if (bytes[index] >= 128) data.push(144, bytes[index]); else data.push(bytes[index]); index++; }
  }
  const metadata = Uint8Array.from(dictionary.flat());
  const compressed = Uint8Array.from(data);
  return compressed.length + metadata.length < bytes.length ? { data: compressed, metadata, encodedSize: compressed.length + metadata.length } : null;
}

export function decompress(data, metadata = new Uint8Array(), { maxOutput = 1_000_000, expectedLength } = {}) {
  if (!(data instanceof Uint8Array) || !(metadata instanceof Uint8Array)) fail('malformed_compression');
  if (metadata.length === 0) { const length = data[0]; metadata = data.slice(1, 1 + length); data = data.slice(1 + length); }
  if (!metadata.length || metadata.length % 4 || metadata.length > 32) fail('malformed_compression');
  const output = [];
  for (let index = 0; index < data.length; index++) {
    if (data[index] < 128) output.push(data[index]);
    else if (data[index] < 136) {
      const offset = (data[index] - 128) * 4;
      if (offset + 3 >= metadata.length) fail('malformed_compression');
      output.push(...metadata.slice(offset, offset + 4));
    }
    else if (data[index] === 144) { if (++index >= data.length) fail('truncated'); output.push(data[index]); }
    else fail('malformed_compression');
    if (output.length > maxOutput) fail('compression_limit');
  }
  if (expectedLength !== undefined && output.length !== expectedLength) fail('invalid_compression_length');
  return Uint8Array.from(output);
}
