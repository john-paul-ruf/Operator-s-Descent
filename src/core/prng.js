export function createPRNG(seed) {
  let state = { a: 0, b: 0, c: 0, d: 0 };

  let s = (seed >>> 0) || 0xDEADBEEF;
  state.a = (s = (s + 0x9E3779B9) >>> 0);
  state.b = (s = (s + 0x9E3779B9) >>> 0);
  state.c = (s = (s + 0x9E3779B9) >>> 0);
  state.d = (s = (s + 0x9E3779B9) >>> 0);

  for (let i = 0; i < 4; i++) {
    nextRaw();
  }

  function nextRaw() {
    const s0 = state.a;
    let s1 = state.b;
    state.b = s0;
    s1 ^= (s1 << 23) >>> 0;
    s1 ^= (s1 >>> 17);
    s1 ^= (s1 >>> 26);
    state.a = s1 >>> 0;
    return (state.a + s0) >>> 0;
  }

  function next() {
    return nextRaw() / 4294967296;
  }

  function nextInt(max) {
    return Math.floor(nextRaw() / 4294967296 * max);
  }

  function getState() {
    return { a: state.a, b: state.b, c: state.c, d: state.d };
  }

  function setState(newState) {
    state = { a: newState.a >>> 0, b: newState.b >>> 0, c: newState.c >>> 0, d: newState.d >>> 0 };
  }

  function hash(...args) {
    let h = 0x811C9DC5;
    for (const v of args) {
      if (typeof v === 'number') {
        h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0;
        h = Math.imul(h ^ ((v >>> 8) & 0xFF), 0x01000193) >>> 0;
        h = Math.imul(h ^ ((v >>> 16) & 0xFF), 0x01000193) >>> 0;
        h = Math.imul(h ^ ((v >>> 24) & 0xFF), 0x01000193) >>> 0;
      } else if (typeof v === 'string') {
        for (let i = 0; i < v.length; i++) {
          h = Math.imul(h ^ v.charCodeAt(i), 0x01000193) >>> 0;
        }
      }
    }
    return h >>> 0;
  }

  return { next, nextInt, getState, setState, hash };
}