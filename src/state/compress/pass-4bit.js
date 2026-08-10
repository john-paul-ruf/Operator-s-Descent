export function compress(data) {
  const freq = new Map();
  for (let i = 0; i < data.length; i++) {
    const nib = data[i] & 0x0F;
    freq.set(nib, (freq.get(nib) || 0) + 1);
    const nib2 = (data[i] >> 4) & 0x0F;
    freq.set(nib2, (freq.get(nib2) || 0) + 1);
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);

  if (sorted.length === 0) return null;

  const dict = new Uint8Array(16);
  for (let i = 0; i < 16; i++) dict[i] = sorted[i]?.[0] ?? 0;

  const reverseDict = new Map();
  sorted.forEach(([val], idx) => reverseDict.set(val, idx));

  const out = [];
  for (let i = 0; i < data.length; i++) {
    const lo = data[i] & 0x0F;
    const hi = (data[i] >> 4) & 0x0F;
    out.push((reverseDict.get(lo) || 0) | ((reverseDict.get(hi) || 0) << 4));
  }

  const out8 = new Uint8Array(out);
  if (out8.length >= data.length) return null;

  return { data: out8, dict };
}

export function decompress(data, dict) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const lo = dict[data[i] & 0x0F];
    const hi = dict[(data[i] >> 4) & 0x0F];
    out[i] = lo | (hi << 4);
  }
  return out;
}