export function hash(...values) {
  let h = 0x811C9DC5;
  for (const v of values) {
    if (typeof v === 'number') {
      h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0;
      h = Math.imul(h ^ ((v >>> 8) & 0xFF), 0x01000193) >>> 0;
      h = Math.imul(h ^ ((v >>> 16) & 0xFF), 0x01000193) >>> 0;
      h = Math.imul(h ^ ((v >>> 24) & 0xFF), 0x01000193) >>> 0;
    } else if (typeof v === 'string') {
      for (let i = 0; i < v.length; i++) {
        h = Math.imul(h ^ v.charCodeAt(i), 0x01000193) >>> 0;
      }
    } else if (typeof v === 'bigint') {
      const lo = Number(v & 0xFFFFFFFFn);
      const hi = Number((v >> 32n) & 0xFFFFFFFFn);
      h = Math.imul(h ^ (lo >>> 0), 0x01000193) >>> 0;
      h = Math.imul(h ^ (hi >>> 0), 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}