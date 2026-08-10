import { describe, it, expect } from 'vitest';
import { hash } from '../../src/core/hash.js';

describe('hash — empty', () => {
  it('no arguments returns FNV offset basis', () => {
    expect(hash()).toBe(0x811C9DC5);
  });
});

describe('hash — stability', () => {
  it('same args produce same value across calls', () => {
    expect(hash(42)).toBe(hash(42));
    expect(hash('theme')).toBe(hash('theme'));
  });

  it('hard-coded known values', () => {
    expect(hash(42)).toBe(0x72D84DDF);
    expect(hash('theme')).toBe(0xA8F277F2);
  });
});

describe('hash — order sensitivity', () => {
  it('hash(1, 2) !== hash(2, 1)', () => {
    expect(hash(1, 2)).not.toBe(hash(2, 1));
  });

  it('hash("ab") === hash("a", "b") — string folds char-by-char', () => {
    expect(hash('ab')).toBe(hash('a', 'b'));
  });
});

describe('hash — type paths', () => {
  it('number vs string differ', () => {
    expect(hash(1)).not.toBe(hash('1'));
  });

  it('bigint path: hash(1n) is stable', () => {
    expect(hash(1n)).toBe(hash(1n));
  });

  it('bigint path: hash(2n**40n) folds hi/lo words and differs from hash(0n)', () => {
    expect(hash(2n ** 40n)).not.toBe(hash(0n));
  });

  it('unsupported types ignored — returns offset basis', () => {
    expect(hash(null, undefined, {}, [])).toBe(0x811C9DC5);
  });
});

describe('hash — 32-bit output', () => {
  it('always returns an unsigned integer <= 0xFFFFFFFF', () => {
    const inputs = [
      0, 1, 42, 255, 256, 65535, 65536, 0xFFFFFFFF, -1, 2 ** 31,
      'a', 'hello', '', 'theme',
      1n, 0n, 2n ** 40n, 2n ** 128n,
      'x', 10, 'y', -100,
    ];
    for (const v of inputs) {
      const h = hash(v);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
    }
  });
});