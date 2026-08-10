import { beforeAll, describe, it, expect } from 'vitest';
import {
  SAVE_VERSION,
  base64urlEncode,
  crc32,
  encodeRun,
  encodeSeed,
  initEncoder,
} from '../../src/state/save-encode.js';
import {
  decodeRun,
  decodeSeed,
} from '../../src/state/save-decode.js';
import { createRunState } from '../../src/state/run-state.js';
import { compressLegacySync } from '../../src/state/compress/progressive.js';
import { condense } from '../../src/state/condense.js';
import { encrypt } from '../../src/state/encrypt.js';
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

function craftFragment(bytes) {
  return base64urlEncode(new Uint8Array(bytes));
}

function encodeV1(state) {
  const compressed = compressLegacySync(condense(state.serialize()).data);
  const encrypted = encrypt(compressed.data, 1);
  const frame = new Uint8Array(2 + compressed.layers.length + 4 + encrypted.length);
  frame[0] = 1;
  frame[1] = compressed.layers.length;
  compressed.layers.forEach((layer, index) => { frame[2 + index] = layer.pass; });
  new DataView(frame.buffer).setUint32(2 + compressed.layers.length, crc32(encrypted), false);
  frame.set(encrypted, 6 + compressed.layers.length);
  return base64urlEncode(frame);
}

describe('decodeSeed', () => {
  it('decodeSeed(encodeSeed(s)) round-trips for seeds {0, 1, 0xDEADBEEF, 0xFFFFFFFF}', () => {
    for (const s of [0, 1, 0xDEADBEEF, 0xFFFFFFFF]) {
      expect(decodeSeed(encodeSeed(s))).toEqual({ success: true, seed: s });
    }
  });

  it('truncated: "AA" (< 5 bytes) → truncated', () => {
    expect(decodeSeed('AA')).toEqual({ success: false, error: 'truncated' });
  });

  it('version-flipped 5-byte craft → version_mismatch', () => {
    const bytes = [9, 0, 0, 0, 42];
    expect(decodeSeed(craftFragment(bytes))).toEqual({ success: false, error: 'version_mismatch' });
  });
});

describe('decodeRun — error paths', () => {
  it('empty string → truncated', () => {
    expect(decodeRun('')).toEqual({ success: false, error: 'truncated' });
  });

  it('short fragment "AB" (< 6 bytes) → truncated', () => {
    expect(decodeRun('AB')).toEqual({ success: false, error: 'truncated' });
  });

  it('version 9 → version_mismatch', () => {
    const bytes = [0x4f, 0x44, 9];
    expect(decodeRun(craftFragment(bytes))).toEqual({ success: false, error: 'version_mismatch' });
  });

  it('valid version + layer count 0 + wrong checksum → checksum_failed', () => {
    const encoded = encodeRun(makeState());
    const corrupted = encoded.fragment.slice(0, -1) + (encoded.fragment.at(-1) === 'A' ? 'B' : 'A');
    expect(decodeRun(corrupted)).toEqual({ success: false, error: 'checksum_failed' });
  });

  it('rejects an invalid base64url alphabet as malformed', () => {
    expect(decodeRun('not+a-fragment')).toEqual({ success: false, error: 'malformed' });
  });

  it('corrupt a genuine fragment (flip payload char) → checksum_failed', () => {
    const result = encodeRun(makeState());
    const frag = result.fragment;
    const payloadStart = 8;
    const corrupted = frag.slice(0, payloadStart) +
      (frag[payloadStart] === 'A' ? 'B' : 'A') +
      frag.slice(payloadStart + 1);
    expect(decodeRun(corrupted).success).toBe(false);
    expect(decodeRun(corrupted).error).toBe('checksum_failed');
  });
});

describe('decodeRun — golden path round-trip', () => {
  it('decodeRun(encodeRun(state)).runState.serialize() deep-equals original', () => {
    const state = makeState();
    const original = state.serialize();
    const encoded = encodeRun(state);
    expect(encoded.success).toBe(true);
    const decoded = decodeRun(encoded.fragment);
    expect(decoded.success).toBe(true);
    expect(decoded.runState.serialize()).toEqual(original);
  });

  it('migrates a valid v1 condensed save', () => {
    const state = makeState();
    const decoded = decodeRun(encodeV1(state));
    expect(decoded.success).toBe(true);
    expect(decoded.runState.serialize()).toEqual(state.serialize());
  });
});
