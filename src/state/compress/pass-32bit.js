function fail(code) { const error = new RangeError(code); error.code = code; throw error; }
function key(bytes, index) { return (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2]; }

export function compress(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
  const positions = new Map();
  const data = [];
  for (let index = 0; index < bytes.length;) {
    let length = 0;
    let distance = 0;
    if (index + 2 < bytes.length) {
      const candidates = positions.get(key(bytes, index)) ?? [];
      for (let candidate = candidates.length - 1, checked = 0; candidate >= 0 && checked < 64; candidate--, checked++) {
        const start = candidates[candidate];
        const candidateDistance = index - start;
        if (candidateDistance > 0xffff) continue;
        let candidateLength = 0;
        while (candidateLength < 18 && index + candidateLength < bytes.length && bytes[start + candidateLength] === bytes[index + candidateLength]) candidateLength++;
        if (candidateLength > length) { length = candidateLength; distance = candidateDistance; }
      }
    }
    const consumed = length >= 4 ? length : 1;
    if (consumed > 1) data.push(128 + consumed - 3, distance & 255, distance >>> 8);
    else if (bytes[index] >= 128) data.push(144, bytes[index]);
    else data.push(bytes[index]);
    for (let offset = 0; offset < consumed; offset++) {
      const position = index + offset;
      if (position + 2 >= bytes.length) continue;
      const hash = key(bytes, position);
      const candidates = positions.get(hash) ?? [];
      candidates.push(position);
      if (candidates.length > 128) candidates.shift();
      positions.set(hash, candidates);
    }
    index += consumed;
  }
  const compressed = Uint8Array.from(data);
  return compressed.length < bytes.length ? { data: compressed, metadata: new Uint8Array(), encodedSize: compressed.length } : null;
}

export function decompress(data, metadata = new Uint8Array(), { maxOutput = 1_000_000, expectedLength } = {}) {
  if (!(data instanceof Uint8Array) || !(metadata instanceof Uint8Array) || metadata.length) fail('malformed_compression');
  const output = [];
  for (let index = 0; index < data.length; index++) {
    if (data[index] < 128) output.push(data[index]);
    else if (data[index] < 144) {
      if (index + 2 >= data.length) fail('truncated');
      const length = data[index] - 125;
      const distance = data[++index] | (data[++index] << 8);
      if (!distance || distance > output.length || output.length + length > maxOutput) fail('malformed_compression');
      for (let offset = 0; offset < length; offset++) output.push(output[output.length - distance]);
    }
    else if (data[index] === 144) { if (++index >= data.length) fail('truncated'); output.push(data[index]); }
    else fail('malformed_compression');
    if (output.length > maxOutput) fail('compression_limit');
  }
  if (expectedLength !== undefined && output.length !== expectedLength) fail('invalid_compression_length');
  return Uint8Array.from(output);
}
