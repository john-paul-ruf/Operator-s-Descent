import { createPRNG } from './prng.js';

export function createRNGCursor(genPRNG, combatPRNG) {
  const cursors = new Map();
  const prngs = new Map();

  prngs.set('gen', genPRNG);
  prngs.set('combat', combatPRNG);
  cursors.set('gen', 0);
  cursors.set('combat', 0);

  function next(stream) {
    const prng = prngs.get(stream);
    cursors.set(stream, cursors.get(stream) + 1);
    return prng.next();
  }

  function nextInt(stream, max) {
    const prng = prngs.get(stream);
    cursors.set(stream, cursors.get(stream) + 1);
    return prng.nextInt(max);
  }

  function getCursor(stream) {
    return cursors.get(stream) || 0;
  }

  function syncTo(stream, cursor, prngState) {
    const prng = prngs.get(stream);
    if (prngState) {
      prng.setState(prngState);
      cursors.set(stream, cursor);
    } else {
      const current = cursors.get(stream) || 0;
      for (let i = current; i < cursor; i++) {
        prng.next();
      }
      cursors.set(stream, cursor);
    }
  }

  function getState() {
    const state = {};
    for (const [stream, cursor] of cursors) {
      state[stream] = {
        cursor,
        prngState: prngs.get(stream).getState()
      };
    }
    return state;
  }

  return { next, nextInt, getCursor, syncTo, getState };
}

export function createRNGCursorForRun(worldSeed, rngState = null) {
  const genPRNG = createPRNG(worldSeed);
  const combatPRNG = createPRNG((worldSeed ^ 0xC0FFEE) >>> 0);
  const cursor = createRNGCursor(genPRNG, combatPRNG);

  if (rngState) {
    cursor.syncTo('gen', rngState.gen?.cursor || 0, rngState.gen?.prngState);
    cursor.syncTo('combat', rngState.combat?.cursor || 0, rngState.combat?.prngState);
  }

  return cursor;
}
