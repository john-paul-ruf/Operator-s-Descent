import { condense, initCondenser } from './condense.js';
import { compressSync, decompressSync } from './compress/progressive.js';
import { encrypt } from './encrypt.js';

const SAVE_VERSION = 1;
const BUDGET = 1500;

let initialized = false;

export function initEncoder(symbolTableData) {
  initCondenser(symbolTableData);
  initialized = true;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64urlEncode(bytes) {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i] || 0;
    const b2 = bytes[i + 1] || 0;
    const b3 = bytes[i + 2] || 0;

    result += B64URL[(b1 >> 2) & 0x3F];
    result += B64URL[((b1 << 4) | (b2 >> 4)) & 0x3F];

    if (i + 1 < bytes.length) {
      result += B64URL[((b2 << 2) | (b3 >> 6)) & 0x3F];
    }
    if (i + 2 < bytes.length) {
      result += B64URL[b3 & 0x3F];
    }
    i += 3;
  }
  return result;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function uint32ToBytes(val) {
  return [(val >>> 24) & 0xFF, (val >>> 16) & 0xFF, (val >>> 8) & 0xFF, val & 0xFF];
}

function buildHeader(version, layers, checksum) {
  const header = [version, layers.length];
  for (const layer of layers) {
    header.push(layer.pass & 0xFF);
  }
  header.push(...uint32ToBytes(checksum));
  return new Uint8Array(header);
}

export function encodeRun(runState) {
  const serialized = runState.serialize();
  const condensed = condense(serialized);
  const compressed = compressSync(condensed.data, (d) => base64urlEncode(d).length < BUDGET - 20);
  const encrypted = encrypt(compressed.data, SAVE_VERSION);

  const checksum = crc32(encrypted);
  const header = buildHeader(SAVE_VERSION, compressed.layers, checksum);
  const combined = new Uint8Array(header.length + encrypted.length);
  combined.set(header, 0);
  combined.set(encrypted, header.length);

  const str = base64urlEncode(combined);
  if (str.length > BUDGET) {
    return { success: false, error: 'save_too_large', length: str.length };
  }
  return { success: true, fragment: str, length: str.length };
}

export function encodeSeed(worldSeed) {
  const bytes = new Uint8Array(5);
  bytes[0] = SAVE_VERSION;
  const seedBytes = uint32ToBytes(worldSeed);
  for (let i = 0; i < 4; i++) bytes[1 + i] = seedBytes[i];
  return base64urlEncode(bytes);
}

export { base64urlEncode, crc32, SAVE_VERSION };