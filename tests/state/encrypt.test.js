import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/state/encrypt.js';
import { createPRNG } from '../../src/core/prng.js';

describe('encrypt — involution (decrypt = encrypt)', () => {
  it('empty array', () => {
    const data = new Uint8Array(0);
    const enc = encrypt(data, 1);
    const dec = decrypt(enc, 1);
    expect([...dec]).toEqual([...data]);
  });

  it('1 byte', () => {
    const data = new Uint8Array([42]);
    const enc = encrypt(data, 1);
    const dec = decrypt(enc, 1);
    expect([...dec]).toEqual([...data]);
  });

  it('256 sequential bytes', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    const enc = encrypt(data, 1);
    const dec = decrypt(enc, 1);
    expect([...dec]).toEqual([...data]);
  });

  it('1000 random-but-seeded bytes', () => {
    const prng = createPRNG(12345);
    const data = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = Math.floor(prng.next() * 256) & 0xFF;
    const enc = encrypt(data, 1);
    const dec = decrypt(enc, 1);
    expect([...dec]).toEqual([...data]);
  });
});

describe('encrypt — determinism', () => {
  it('same input + version → identical ciphertext', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const a = encrypt(data, 1);
    const b = encrypt(data, 1);
    expect([...a]).toEqual([...b]);
  });
});

describe('encrypt — ciphertext properties', () => {
  it('ciphertext differs from plaintext for non-degenerate input', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const enc = encrypt(data, 1);
    expect([...enc]).not.toEqual([...data]);
  });

  it('length is preserved', () => {
    const data = new Uint8Array(100);
    const enc = encrypt(data, 1);
    expect(enc.length).toBe(data.length);
  });
});

describe('encrypt — version byte matters', () => {
  it('same plaintext, different versions → different ciphertext', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50]);
    const v1 = encrypt(data, 1);
    const v2 = encrypt(data, 2);
    expect([...v1]).not.toEqual([...v2]);
  });

  it('decrypting with wrong version ≠ plaintext', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const enc = encrypt(data, 1);
    const wrongDec = decrypt(enc, 2);
    expect([...wrongDec]).not.toEqual([...data]);
  });
});

describe('encrypt — decrypt is literally encrypt', () => {
  it('double-encrypt returns plaintext', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const doubleEnc = encrypt(encrypt(data, 3), 3);
    expect([...doubleEnc]).toEqual([...data]);
  });
});