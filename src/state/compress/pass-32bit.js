export function compress(data) {
  if (data.length < 8) return null;

  const freq = new Map();
  for (let i = 0; i < data.length - 3; i++) {
    const dword = (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3];
    freq.set(dword, (freq.get(dword) || 0) + 1);
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (sorted.length === 0) return null;

  const dict = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const [word] = sorted[i] || [0];
    dict[i * 4] = (word >> 24) & 0xFF;
    dict[i * 4 + 1] = (word >> 16) & 0xFF;
    dict[i * 4 + 2] = (word >> 8) & 0xFF;
    dict[i * 4 + 3] = word & 0xFF;
  }

  const reverseDict = new Map();
  sorted.forEach(([word], idx) => reverseDict.set(word, idx));

  const out = [];
  let i = 0;
  while (i < data.length) {
    if (i < data.length - 3) {
      const dword = (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3];
      const code = reverseDict.get(dword);
      if (code !== undefined && code < 8) {
        out.push(0xC0 | code);
        i += 4;
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
    if ((b & 0xC0) === 0xC0) {
      const code = b & 0x07;
      out.push(dictBytes[code * 4], dictBytes[code * 4 + 1], dictBytes[code * 4 + 2], dictBytes[code * 4 + 3]);
    } else {
      out.push(b);
    }
  }
  return new Uint8Array(out);
}