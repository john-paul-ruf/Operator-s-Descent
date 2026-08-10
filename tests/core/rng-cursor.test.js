import { describe, it, expect } from 'vitest';
import { createPRNG } from '../../src/core/prng.js';
import { createRNGCursor, createRNGCursorForRun } from '../../src/core/rng-cursor.js';

describe('createRNGCursor — counting', () => {
  it('fresh cursor has getCursor("gen") === 0', () => {
    const cursor = createRNGCursor(createPRNG(1), createPRNG(2));
    expect(cursor.getCursor('gen')).toBe(0);
    expect(cursor.getCursor('combat')).toBe(0);
  });

  it('each next("gen") increments only the gen stream', () => {
    const cursor = createRNGCursor(createPRNG(1), createPRNG(2));
    cursor.next('gen');
    cursor.next('gen');
    expect(cursor.getCursor('gen')).toBe(2);
    expect(cursor.getCursor('combat')).toBe(0);
  });

  it('each nextInt("combat", n) increments only the combat stream', () => {
    const cursor = createRNGCursor(createPRNG(1), createPRNG(2));
    cursor.nextInt('combat', 10);
    expect(cursor.getCursor('combat')).toBe(1);
    expect(cursor.getCursor('gen')).toBe(0);
  });

  it('unknown stream getCursor returns 0', () => {
    const cursor = createRNGCursor(createPRNG(1), createPRNG(2));
    expect(cursor.getCursor('nope')).toBe(0);
  });
});

describe('createRNGCursor — stream independence', () => {
  it('interleaved gen/combat draws match standalone PRNGs', () => {
    const genPRNG = createPRNG(100);
    const combatPRNG = createPRNG(200);
    const cursor = createRNGCursor(createPRNG(100), createPRNG(200));

    expect(cursor.next('gen')).toBe(genPRNG.next());
    expect(cursor.next('combat')).toBe(combatPRNG.next());
    expect(cursor.nextInt('gen', 20)).toBe(genPRNG.nextInt(20));
    expect(cursor.nextInt('combat', 20)).toBe(combatPRNG.nextInt(20));
    expect(cursor.next('gen')).toBe(genPRNG.next());
    expect(cursor.next('combat')).toBe(combatPRNG.next());
  });
});

describe('createRNGCursor — syncTo fast-forward', () => {
  it('cursor A advances 7 draws; cursor B syncTo("gen", 7) then matches', () => {
    const seedA = 50;
    const a = createRNGCursor(createPRNG(seedA), createPRNG(999));
    for (let i = 0; i < 7; i++) a.next('gen');
    const aVals = [a.next('gen'), a.next('gen'), a.next('gen')];

    const b = createRNGCursor(createPRNG(seedA), createPRNG(999));
    b.syncTo('gen', 7);
    expect(b.getCursor('gen')).toBe(7);
    expect(b.next('gen')).toBe(aVals[0]);
    expect(b.next('gen')).toBe(aVals[1]);
    expect(b.next('gen')).toBe(aVals[2]);
  });
});

describe('createRNGCursor — syncTo with state', () => {
  it('syncTo with prngState sets state directly without burning draws', () => {
    const prng = createPRNG(33);
    for (let i = 0; i < 100; i++) prng.next();
    const savedState = prng.getState();
    const expected = [prng.next(), prng.next(), prng.next()];

    const cursor = createRNGCursor(createPRNG(33), createPRNG(44));
    cursor.syncTo('gen', 100, savedState);
    expect(cursor.getCursor('gen')).toBe(100);
    expect(cursor.next('gen')).toBe(expected[0]);
    expect(cursor.next('gen')).toBe(expected[1]);
    expect(cursor.next('gen')).toBe(expected[2]);
  });
});

describe('createRNGCursor — getState shape', () => {
  it('returns { gen: { cursor, prngState: {a,b,c,d} }, combat: {...} }', () => {
    const cursor = createRNGCursor(createPRNG(1), createPRNG(2));
    cursor.next('gen');
    const state = cursor.getState();
    expect(state).toHaveProperty('gen');
    expect(state).toHaveProperty('combat');
    expect(state.gen).toHaveProperty('cursor');
    expect(state.gen).toHaveProperty('prngState');
    expect(state.gen.cursor).toBe(1);
    expect(state.gen.prngState).toHaveProperty('a');
    expect(state.gen.prngState).toHaveProperty('b');
    expect(state.gen.prngState).toHaveProperty('c');
    expect(state.gen.prngState).toHaveProperty('d');
    expect(state.combat.cursor).toBe(0);
  });
});

describe('createRNGCursorForRun — combat seed', () => {
  it('combat stream seeded with (worldSeed ^ 0xC0FFEE) >>> 0', () => {
    const worldSeed = 12345;
    const cursor = createRNGCursorForRun(worldSeed);
    const combatPRNG = createPRNG((worldSeed ^ 0xC0FFEE) >>> 0);
    expect(cursor.nextInt('combat', 100)).toBe(combatPRNG.nextInt(100));
    expect(cursor.next('combat')).toBe(combatPRNG.next());
  });
});

describe('createRNGCursorForRun — rngState restore', () => {
  it('passing saved rngState restores both streams mid-sequence', () => {
    const worldSeed = 777;
    const original = createRNGCursorForRun(worldSeed);
    for (let i = 0; i < 10; i++) original.next('gen');
    for (let i = 0; i < 5; i++) original.nextInt('combat', 20);
    const rngState = original.getState();

    const restored = createRNGCursorForRun(worldSeed, rngState);
    expect(restored.next('gen')).toBe(original.next('gen'));
    expect(restored.nextInt('combat', 20)).toBe(original.nextInt('combat', 20));
  });

  it('rngState with missing streams ({}) is tolerated', () => {
    const cursor = createRNGCursorForRun(42, {});
    expect(cursor.getCursor('gen')).toBe(0);
    expect(cursor.getCursor('combat')).toBe(0);
  });
});