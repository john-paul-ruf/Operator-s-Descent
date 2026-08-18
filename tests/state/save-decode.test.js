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
import { createBitWriter } from '../../src/state/bit-codec.js';

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

// Crafts a well-formed v2 frame carrying a payload whose first byte is a
// future/unknown schemaVersion (no frozen reader). Frame version, CRC, and
// worldSeed are all valid so it exercises the payload-level seed-recovery
// path — not the frame-level version_mismatch corruption path.
function craftFutureSchemaFragment(worldSeed, futureSchemaVersion) {
  const writer = createBitWriter();
  writer.writeUint(futureSchemaVersion, 8);
  writer.writeUint(1, 16);
  writer.writeUint(worldSeed >>> 0, 32);
  writer.writeUint(0, 8);
  const payload = writer.toUint8Array();
  const bitLength = writer.bitLength;
  const encrypted = encrypt(payload, SAVE_VERSION);
  const frame = new Uint8Array(14 + encrypted.length + 4);
  frame[0] = 0x4f;
  frame[1] = 0x44;
  frame[2] = SAVE_VERSION;
  new DataView(frame.buffer).setUint16(3, 1, true);
  new DataView(frame.buffer).setUint32(5, worldSeed >>> 0, true);
  new DataView(frame.buffer).setUint32(9, bitLength, true);
  frame[13] = 0;
  frame.set(encrypted, 14);
  new DataView(frame.buffer).setUint32(frame.length - 4, crc32(frame.slice(0, -4)), true);
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
    expect(decodeRun(corrupted)).toEqual({ success: false, error: 'checksum_failed', recoveredSeed: 42 });
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

describe('decodeRun — never dead-end on version (Custom Rule 13)', () => {
  it('a well-formed frame carrying a future schemaVersion returns a seed-recovery result (no runState, no error)', () => {
    const fragment = craftFutureSchemaFragment(1234567, 99);
    const result = decodeRun(fragment);
    expect(result).toEqual({ success: true, mode: 'seed', recoveredSeed: 1234567, runState: null });
  });

  it('preserves checksum_failed for a future schemaVersion whose CRC is broken (corruption still beats seed-recovery)', () => {
    const fragment = craftFutureSchemaFragment(42, 99);
    // Flip the final char to invalidate CRC.
    const corrupted = fragment.slice(0, -1) + (fragment.at(-1) === 'A' ? 'B' : 'A');
    const result = decodeRun(corrupted);
    expect(result.success).toBe(false);
    expect(result.error).toBe('checksum_failed');
  });
});
