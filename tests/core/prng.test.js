import { describe, it, expect } from 'vitest';
import { createPRNG } from '../../src/core/prng.js';
import { hash } from '../../src/core/hash.js';

describe('createPRNG — determinism', () => {
  it('two instances with the same seed produce identical first 100 values', () => {
    const a = createPRNG(42);
    const b = createPRNG(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds diverge within 100 draws', () => {
    const a = createPRNG(1);
    const b = createPRNG(2);
    let diverged = false;
    for (let i = 0; i < 100; i++) {
      if (a.next() !== b.next()) { diverged = true; break; }
    }
    expect(diverged).toBe(true);
  });
});

describe('createPRNG — seed coercion', () => {
  it('2^32 wraps to 0 (seed >>> 0)', () => {
    const a = createPRNG(2 ** 32);
    const b = createPRNG(0);
    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('seed 0 falls back to 0xDEADBEEF', () => {
    const a = createPRNG(0);
    const b = createPRNG(0xDEADBEEF);
    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('negative seed -1 coerces to 0xFFFFFFFF', () => {
    const a = createPRNG(-1);
    const b = createPRNG(0xFFFFFFFF);
    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });
});

describe('createPRNG — ranges', () => {
  it('next() is always in [0, 1) across 1000 draws', () => {
    const prng = createPRNG(99);
    for (let i = 0; i < 1000; i++) {
      const v = prng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(10) is always an integer in [0, 10) across 1000 draws', () => {
    const prng = createPRNG(99);
    for (let i = 0; i < 1000; i++) {
      const v = prng.nextInt(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('nextInt(1) always returns 0', () => {
    const prng = createPRNG(99);
    for (let i = 0; i < 100; i++) {
      expect(prng.nextInt(1)).toBe(0);
    }
  });
});

describe('createPRNG — distribution sanity', () => {
  it('nextInt(10) hits all 10 buckets across 1000 draws', () => {
    const prng = createPRNG(7);
    const buckets = new Set();
    for (let i = 0; i < 1000; i++) {
      buckets.add(prng.nextInt(10));
    }
    expect(buckets.size).toBe(10);
  });
});

describe('createPRNG — state round-trip', () => {
  it('saved state restores the sequence', () => {
    const prng = createPRNG(7);
    for (let i = 0; i < 5; i++) prng.next();
    const saved = prng.getState();
    const after = [prng.next(), prng.next(), prng.next(), prng.next(), prng.next()];
    prng.setState(saved);
    expect(prng.next()).toBe(after[0]);
    expect(prng.next()).toBe(after[1]);
    expect(prng.next()).toBe(after[2]);
    expect(prng.next()).toBe(after[3]);
    expect(prng.next()).toBe(after[4]);
  });

  it('getState() returns a copy — mutating it does not affect the generator', () => {
    const prng = createPRNG(7);
    prng.next();
    const state = prng.getState();
    state.a = 999;
    const prng2 = createPRNG(7);
    prng2.next();
    expect(prng.next()).toBe(prng2.next());
    expect(prng.next()).toBe(prng2.next());
  });
});

describe('createPRNG — instance hash', () => {
  it('matches hash() from src/core/hash.js for number inputs', () => {
    const prng = createPRNG(1);
    expect(prng.hash(42)).toBe(hash(42));
  });

  it('matches hash() from src/core/hash.js for string inputs', () => {
    const prng = createPRNG(1);
    expect(prng.hash('theme')).toBe(hash('theme'));
  });

  it('matches hash() for mixed inputs', () => {
    const prng = createPRNG(1);
    expect(prng.hash(1, 'a', 2)).toBe(hash(1, 'a', 2));
  });
});