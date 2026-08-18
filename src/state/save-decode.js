import { expand } from './condense.js';
import { decompressSync } from './compress/progressive.js';
import { decrypt } from './encrypt.js';
import { deserializeRunState } from './run-state.js';
import { RUN_SCHEMA_VERSION, decodeRunPayload } from './save-schema.js';
import { migrateState } from './save-migrate.js';
import { SAVE_VERSION, base64urlEncode, crc32 } from './save-encode.js';
import { V3_SCHEMA_VERSION, readV3Payload } from './versions/read-v3.js';

const MAGIC = [0x4f, 0x44];
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUES = Object.fromEntries([...B64URL].map((char, index) => [char, index]));
const MAX_LAYERS = 5;
const MAX_PAYLOAD_BYTES = 20000;

// Frozen per-version payload readers (Custom Rule 13). Each entry is pinned
// to its schemaVersion forever: v3 saves ALWAYS route through readV3Payload,
// no matter how far RUN_SCHEMA_VERSION advances. The current reader path
// (schemaVersion === RUN_SCHEMA_VERSION) uses the live decodeRunPayload.
const FROZEN_READERS = new Map([
  [V3_SCHEMA_VERSION, readV3Payload]
]);

function fail(code) { const error = new RangeError(code); error.code = code; throw error; }
function readUint32(bytes, offset) { return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true); }

function base64urlDecode(fragment) {
  if (typeof fragment !== 'string' || !/^[A-Za-z0-9_-]*$/.test(fragment) || fragment.length % 4 === 1) fail('malformed');
  const output = [];
  for (let index = 0; index < fragment.length; index += 4) {
    const remaining = fragment.length - index;
    if (remaining < 2) fail('malformed');
    const first = VALUES[fragment[index]], second = VALUES[fragment[index + 1]], third = remaining > 2 ? VALUES[fragment[index + 2]] : 0, fourth = remaining > 3 ? VALUES[fragment[index + 3]] : 0;
    output.push((first << 2) | (second >>> 4));
    if (remaining > 2) output.push(((second & 15) << 4) | (third >>> 2));
    if (remaining > 3) output.push(((third & 3) << 6) | fourth);
  }
  return Uint8Array.from(output);
}

function decodeV1(bytes) {
  if (bytes.length < 6) return { success: false, error: 'truncated' };
  try {
    const layerCount = bytes[1];
    let offset = 2;
    if (layerCount > MAX_LAYERS || offset + layerCount + 4 > bytes.length) return { success: false, error: 'truncated' };
    const layers = Array.from({ length: layerCount }, () => ({ pass: bytes[offset++] }));
    const checksum = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false); offset += 4;
    const encrypted = bytes.slice(offset);
    if (crc32(encrypted) !== checksum) return { success: false, error: 'checksum_failed' };
    const runState = deserializeRunState(expand(decompressSync(decrypt(encrypted, 1), layers), 1), { sourceVersion: 1 });
    return runState ? { success: true, runState } : { success: false, error: 'malformed' };
  } catch { return { success: false, error: 'malformed' }; }
}

function decodeWithFrozenReader(reader, payload, bitLength, worldSeed, schemaVersion) {
  const decoded = reader(payload, bitLength);
  if (decoded.worldSeed !== worldSeed) return { success: false, error: 'malformed', recoveredSeed: worldSeed };
  const migrated = migrateState(decoded.runState, schemaVersion, RUN_SCHEMA_VERSION);
  return { success: true, runState: migrated.state, recoveredSeed: worldSeed };
}

export function decodeRun(fragment) {
  try {
    const bytes = base64urlDecode(fragment);
    if (!bytes.length) return { success: false, error: 'truncated' };
    if (bytes[0] === 1) return decodeV1(bytes);
    if (bytes.length < 3) return { success: false, error: 'truncated' };
    if (bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) return { success: false, error: 'malformed' };
    if (bytes[2] !== SAVE_VERSION) {
      const recoveredSeed = bytes.length >= 9 ? readUint32(bytes, 5) : null;
      return { success: false, error: 'version_mismatch', ...(Number.isInteger(recoveredSeed) ? { recoveredSeed } : {}) };
    }
    if (bytes.length < 18) return { success: false, error: 'truncated' };
    const tableVersion = new DataView(bytes.buffer, bytes.byteOffset + 3, 2).getUint16(0, true);
    const worldSeed = readUint32(bytes, 5);
    const bitLength = readUint32(bytes, 9);
    const layerCount = bytes[13];
    if (layerCount > MAX_LAYERS || bitLength > MAX_PAYLOAD_BYTES * 8) return { success: false, error: 'malformed', recoveredSeed: worldSeed };
    let offset = 14;
    const layers = [];
    for (let index = 0; index < layerCount; index++) {
      if (offset + 11 > bytes.length - 4) return { success: false, error: 'truncated', recoveredSeed: worldSeed };
      const pass = bytes[offset++], originalLength = readUint32(bytes, offset); offset += 4;
      const metadataLength = new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true); offset += 2;
      const dataLength = readUint32(bytes, offset); offset += 4;
      if (offset + metadataLength > bytes.length - 4 || originalLength > MAX_PAYLOAD_BYTES || dataLength > MAX_PAYLOAD_BYTES) return { success: false, error: 'malformed', recoveredSeed: worldSeed };
      layers.push({ pass, originalLength, dataLength, metadata: bytes.slice(offset, offset + metadataLength) });
      offset += metadataLength;
    }
    const encrypted = bytes.slice(offset, -4);
    if (encrypted.length > MAX_PAYLOAD_BYTES || crc32(bytes.slice(0, -4)) !== readUint32(bytes, bytes.length - 4)) return { success: false, error: 'checksum_failed', recoveredSeed: worldSeed };
    if ((layers.length && layers.at(-1).dataLength !== encrypted.length) || (!layers.length && Math.ceil(bitLength / 8) !== encrypted.length)) return { success: false, error: 'malformed', recoveredSeed: worldSeed };
    const payload = decompressSync(decrypt(encrypted, SAVE_VERSION), layers, { maxOutput: MAX_PAYLOAD_BYTES, maxInput: MAX_PAYLOAD_BYTES });
    if (payload.length !== Math.ceil(bitLength / 8)) return { success: false, error: 'malformed', recoveredSeed: worldSeed };
    // schemaVersion lives in the first 8 bits of the payload; bit-codec packs
    // bits 0..7 into byte 0 LSB-first, so payload[0] IS the schemaVersion byte.
    const schemaVersion = payload.length ? payload[0] : null;
    if (schemaVersion === RUN_SCHEMA_VERSION) {
      const decoded = decodeRunPayload(payload, bitLength, { tableVersion });
      if (decoded.worldSeed !== worldSeed) return { success: false, error: 'malformed', recoveredSeed: worldSeed };
      return { success: true, runState: decoded.runState, recoveredSeed: worldSeed };
    }
    const frozen = FROZEN_READERS.get(schemaVersion);
    if (!frozen) {
      // Known-good frame, unknown schemaVersion: fall through to seed-recovery
      // per Custom Rule 13 — versioned saves never dead-end.
      return { success: true, mode: 'seed', recoveredSeed: worldSeed, runState: null };
    }
    return decodeWithFrozenReader(frozen, payload, bitLength, worldSeed, schemaVersion);
  } catch (error) {
    return { success: false, error: error?.code === 'version_mismatch' ? 'version_mismatch' : 'malformed' };
  }
}

export function decodeSeed(fragment) {
  try {
    const bytes = base64urlDecode(fragment);
    if (bytes.length < 5) return { success: false, error: 'truncated' };
    if (bytes[0] !== 1) return { success: false, error: 'version_mismatch' };
    return { success: true, seed: new DataView(bytes.buffer, bytes.byteOffset + 1, 4).getUint32(0, false) };
  } catch { return { success: false, error: 'malformed' }; }
}

export { base64urlDecode };
