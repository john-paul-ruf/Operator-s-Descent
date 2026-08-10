function fail(code) { const error = new RangeError(code); error.code = code; throw error; }

async function stream(format, bytes, limit) {
  const transform = new format('deflate');
  const writer = transform.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  const chunks = [];
  let length = 0;
  const reader = transform.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) fail('compression_limit');
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export async function compress(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2 || typeof CompressionStream === 'undefined') return null;
  try {
    const data = await stream(CompressionStream, bytes, bytes.length - 1);
    return { data, metadata: new Uint8Array(), encodedSize: data.length };
  } catch { return null; }
}

export async function decompress(data, metadata = new Uint8Array(), { maxOutput = 1_000_000, expectedLength } = {}) {
  if (!(data instanceof Uint8Array) || !(metadata instanceof Uint8Array) || metadata.length) fail('malformed_compression');
  if (typeof DecompressionStream === 'undefined') fail('unsupported_compression');
  const output = await stream(DecompressionStream, data, maxOutput);
  if (expectedLength !== undefined && output.length !== expectedLength) fail('invalid_compression_length');
  return output;
}
