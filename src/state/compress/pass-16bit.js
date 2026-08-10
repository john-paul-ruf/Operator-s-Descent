export function compress(data) {
  if (data.length < 4) return null;

  const freq = new Map();
  for (let i = 0; i < data.length - 1; i++) {
    const word = (data[i] << 8) | data[i + 1];
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  if (sorted.length === 0) return null;

  const dict = new Uint8Array(32);
  for (let i = 0; i < 16; i++) {
    const [word] = sorted[i] || [0];
    dict[i * 2] = (word >> 8) & 0xFF;
    dict[i * 2 + 1] = word & 0xFF;
  }

  const reverseDict = new Map();
  sorted.forEach(([word], idx) => reverseDict.set(word, idx));

  const out = [];
  let i = 0;
  while (i < data.length) {
    if (i < data.length - 1) {
      const word = (data[i] << 8) | data[i + 1];
      const code = reverseDict.get(word);
      if (code !== undefined && code < 16) {
        out.push(0x80 | code);
        i += 2;
        continue;
      }
    }
    out.push(data[i]);
    i++;
  }

  const out8 = new Uint8Array(out);
  const dictSize = 32;
  if (out8.length + dictSize >= data.length) return null;

  const combined = new Uint8Array(1 + dictSize + out8.length);
  combined[0] = dictSize;
  combined.set(dict, 1);
  combined.set(out8, 1 + dictSize);
  return { data: combined, dict: new Uint8Array(0) };
}

export function decompress(data, dict) {
  const dictSize = data[0];
  const dictBytes = data.slice(1, 1 + dictSize);
  const payload = data.slice(1 + dictSize);

  const out = [];
  for (let i = 0; i < payload.length; i++) {
    const b = payload[i];
    if (b & 0x80) {
      const code = b & 0x0F;
      const hi = dictBytes[code * 2];
      const lo = dictBytes[code * 2 + 1];
      out.push(hi, lo);
    } else {
      out.push(b);
    }
  }
  return new Uint8Array(out);
}