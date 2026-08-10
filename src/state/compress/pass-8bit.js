export async function compress(data) {
  if (typeof CompressionStream === 'undefined') return null;
  if (data.length < 2) return null;

  try {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();

    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    let totalLen = 0;
    for (const chunk of chunks) totalLen += chunk.length;
    if (totalLen >= data.length) return null;

    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }

    return { data: out, dict: new Uint8Array(0) };
  } catch {
    return null;
  }
}

export async function decompress(data, dict) {
  if (typeof DecompressionStream === 'undefined') return data;

  const ds = new DecompressionStream('inflate');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  let totalLen = 0;
  for (const chunk of chunks) totalLen += chunk.length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}