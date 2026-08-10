import { expand } from './condense.js';
import { decompressSync } from './compress/progressive.js';
import { decrypt } from './encrypt.js';
import { deserializeRunState } from './run-state.js';
import { SAVE_VERSION, crc32 } from './save-encode.js';

const B64URL_REV = {};
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
for (let i = 0; i < B64URL.length; i++) B64URL_REV[B64URL[i]] = i;

function base64urlDecode(str) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    const remaining = str.length - i;
    const c1 = B64URL_REV[str[i]] || 0;
    const c2 = b64val(str, i + 1);
    const c3 = b64val(str, i + 2);
    const c4 = b64val(str, i + 3);

    if (remaining >= 2) out.push(((c1 << 2) | (c2 >> 4)) & 0xFF);
    if (remaining >= 3) out.push(((c2 << 4) | (c3 >> 2)) & 0xFF);
    if (remaining >= 4) out.push(((c3 << 6) | c4) & 0xFF);
    i += 4;
  }
  return new Uint8Array(out);
}

function b64val(str, idx) {
  if (idx >= str.length || str[idx] === '=') return 0;
  return B64URL_REV[str[idx]] || 0;
}

export function decodeRun(fragment) {
  try {
    const bytes = base64urlDecode(fragment);
    if (bytes.length < 6) return { success: false, error: 'truncated' };

    const version = bytes[0];
    if (version !== SAVE_VERSION) return { success: false, error: 'version_mismatch' };

    const layerCount = bytes[1];
    const layers = [];
    let offset = 2;
    for (let i = 0; i < layerCount; i++) {
      layers.push({ pass: bytes[offset], dict: new Uint8Array(0) });
      offset++;
    }

    const checksum = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    offset += 4;

    const payload = bytes.slice(offset);
    if (crc32(payload) !== checksum) return { success: false, error: 'checksum_failed' };

    const decrypted = decrypt(payload, version);
    const decompressed = decompressSync(decrypted, layers);
    const expanded = expand(decompressed, version);
    const runState = deserializeRunState(expanded);

    return { success: true, runState };
  } catch {
    return { success: false, error: 'malformed' };
  }
}

export function decodeSeed(fragment) {
  try {
    const bytes = base64urlDecode(fragment);
    if (bytes.length < 5) return { success: false, error: 'truncated' };

    const version = bytes[0];
    if (version !== SAVE_VERSION) return { success: false, error: 'version_mismatch' };

    const seed = ((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0;
    return { success: true, seed };
  } catch {
    return { success: false, error: 'malformed' };
  }
}