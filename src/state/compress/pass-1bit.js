function fail(code) { const error = new RangeError(code); error.code = code; throw error; }

export function compress(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;
  const output = [];
  for (let index = 0; index < bytes.length;) {
    let count = 1;
    while (count < 255 && index + count < bytes.length && bytes[index + count] === bytes[index]) count++;
    output.push(count, bytes[index]);
    index += count;
  }
  const data = Uint8Array.from(output);
  return data.length < bytes.length ? { data, metadata: new Uint8Array(), encodedSize: data.length } : null;
}

export function decompress(data, metadata = new Uint8Array(), { maxOutput = 1_000_000, expectedLength } = {}) {
  if (!(data instanceof Uint8Array) || !(metadata instanceof Uint8Array) || metadata.length || data.length % 2) fail('malformed_compression');
  const output = [];
  for (let index = 0; index < data.length; index += 2) {
    const count = data[index];
    if (!count || output.length + count > maxOutput) fail('compression_limit');
    output.push(...Array(count).fill(data[index + 1]));
  }
  if (expectedLength !== undefined && output.length !== expectedLength) fail('invalid_compression_length');
  return Uint8Array.from(output);
}
