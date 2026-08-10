import { beforeAll, describe, it, expect } from 'vitest';
import {
  SAVE_VERSION,
  base64urlEncode,
  crc32,
  encodeRun,
  encodeSeed,
  initEncoder,
} from '../../src/state/save-encode.js';
import { decodeSeed } from '../../src/state/save-decode.js';
import { createRunState } from '../../src/state/run-state.js';
import { compressSync } from '../../src/state/compress/progressive.js';
import { condense } from '../../src/state/condense.js';
import { makeParty } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

beforeAll(() => {
  initEncoder(loadData('symbol-table'));
});

function makeState() {
  const state = createRunState(42, makeParty(2));
  state.creationTimestamp = 1_000_000;
  return state;
}

describe('save-encode constants', () => {
  it('SAVE_VERSION === 1', () => {
    expect(SAVE_VERSION).toBe(1);
  });
});

describe('base64urlEncode', () => {
  it('empty array → empty string', () => {
    expect(base64urlEncode(new Uint8Array(0))).toBe('');
  });

  it('[0] → "AA"', () => {
    expect(base64urlEncode(new Uint8Array([0]))).toBe('AA');
  });

  it('[255,255,255] → "____"', () => {
    expect(base64urlEncode(new Uint8Array([255, 255, 255]))).toBe('____');
  });

  for (let len = 0; len <= 20; len++) {
    it(`matches Node base64url for length ${len}`, () => {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      expect(base64urlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    });
  }
});

describe('crc32', () => {
  it('empty input → 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('"123456789" → 0xCBF43926 (standard check value)', () => {
    const bytes = new Uint8Array(Array.from('123456789', c => c.charCodeAt(0)));
    expect(crc32(bytes)).toBe(0xCBF43926);
  });

  it('stability: same input → same output', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(crc32(bytes)).toBe(crc32(bytes));
  });

  it('sensitivity: single-bit flip changes result', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(crc32(a)).not.toBe(crc32(b));
  });
});

describe('encodeSeed', () => {
  it('fragment length is 7 (5 bytes → 7 base64url chars)', () => {
    expect(encodeSeed(42).length).toBe(7);
  });

  it('decodeSeed restores seed 0', () => {
    expect(decodeSeed(encodeSeed(0))).toEqual({ success: true, seed: 0 });
  });

  it('decodeSeed restores seed 1', () => {
    expect(decodeSeed(encodeSeed(1))).toEqual({ success: true, seed: 1 });
  });

  it('decodeSeed restores seed 0xDEADBEEF', () => {
    expect(decodeSeed(encodeSeed(0xDEADBEEF))).toEqual({ success: true, seed: 0xDEADBEEF });
  });

  it('decodeSeed restores seed 0xFFFFFFFF', () => {
    expect(decodeSeed(encodeSeed(0xFFFFFFFF))).toEqual({ success: true, seed: 0xFFFFFFFF });
  });
});

describe('encodeRun', () => {
  it('returns {success: true, fragment, length}', () => {
    const result = encodeRun(makeState());
    expect(result.success).toBe(true);
    expect(typeof result.fragment).toBe('string');
    expect(typeof result.length).toBe('number');
  });

  it('length === fragment.length < 1500', () => {
    const result = encodeRun(makeState());
    expect(result.length).toBe(result.fragment.length);
    expect(result.length).toBeLessThan(1500);
  });

  it('charset ⊆ [A-Za-z0-9_-]', () => {
    const result = encodeRun(makeState());
    expect(result.fragment).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('deterministic: same state twice → identical fragment', () => {
    const a = encodeRun(makeState());
    const b = encodeRun(makeState());
    expect(a.fragment).toBe(b.fragment);
  });

  it('save_too_large when budget exceeded by 100 verbose items', () => {
    const state = makeState();
    for (let i = 0; i < 100; i++) {
      state.inventory.push({
        id: `item_${String(i).padStart(3, '0')}`,
        name: `Item_${i}_${(i * 7919 * 13).toString(16).repeat(10)}`,
        baseType: 'weapon',
        category: 'sidearm',
        rarity: 'common',
        corrupt: false,
        tier: i % 4,
        salvageValue: i,
        conditions: [],
        affixes: [{ id: `affix_${i}`, tier: 1, category: 'prefix' }],
      });
    }
    const result = encodeRun(state);
    expect(result.success).toBe(false);
    expect(result.error).toBe('save_too_large');
    expect(result.length).toBeGreaterThanOrEqual(1500);
  });
});

describe('dict-loss probe (encode side)', () => {
  it('16/32-bit passes either engage or layers ⊆ {0} on real payloads', () => {
    const state = makeState();
    for (let i = 0; i < 50; i++) {
      state.inventory.push({
        id: `item_${i}`,
        name: 'Identical_Item_Name',
        baseType: 'weapon',
        category: 'sidearm',
        rarity: 'common',
        corrupt: false,
        tier: 1,
        salvageValue: 5,
        conditions: [],
        affixes: []
      });
    }
    const condensed = condense(state.serialize());
    const compressed = compressSync(condensed.data);
    const layerPasses = compressed.layers.map(l => l.pass);
    const hasDictPasses = layerPasses.some(p => p === 3 || p === 4);
    if (!hasDictPasses) {
      expect(layerPasses.every(p => p === 0)).toBe(true);
    }
  });
});