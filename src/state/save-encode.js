import { getTableVersion, initCondenser } from './condense.js';
import { compressSync } from './compress/progressive.js';
import { encrypt } from './encrypt.js';
import { encodeRunPayload } from './save-schema.js';

export const SAVE_VERSION = 2;
const MAGIC = [0x4f, 0x44];
const BUDGET = 1500;
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function initEncoder(symbolTableData) { initCondenser(symbolTableData); }

export function base64urlEncode(bytes) {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += B64URL[first >>> 2] + B64URL[((first & 3) << 4) | ((second ?? 0) >>> 4)];
    if (second !== undefined) result += B64URL[((second & 15) << 2) | ((third ?? 0) >>> 6)];
    if (third !== undefined) result += B64URL[third & 63];
  }
  return result;
}

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(bytes, offset, value) { new DataView(bytes.buffer).setUint32(offset, value, true); }

function describeLayers(layers) {
  return layers.map((layer) => {
    const view = new DataView(layer.buffer, layer.byteOffset, layer.byteLength);
    const metadataLength = view.getUint16(5, true);
    return { pass: layer[0], originalLength: view.getUint32(1, true), metadata: layer.slice(11, 11 + metadataLength), dataLength: view.getUint32(7, true) };
  });
}

export function encodeRun(runState) {
  const payload = encodeRunPayload(runState);
  const compressed = compressSync(payload.bytes);
  const layers = describeLayers(compressed.layers);
  const descriptorsLength = layers.reduce((length, layer) => length + 11 + layer.metadata.length, 0);
  const headerLength = 14 + descriptorsLength;
  const frame = new Uint8Array(headerLength + compressed.data.length + 4);
  frame.set(MAGIC);
  frame[2] = SAVE_VERSION;
  new DataView(frame.buffer).setUint16(3, payload.tableVersion, true);
  writeUint32(frame, 5, payload.worldSeed);
  writeUint32(frame, 9, payload.bitLength);
  frame[13] = layers.length;
  let offset = 14;
  for (const layer of layers) {
    frame[offset++] = layer.pass;
    writeUint32(frame, offset, layer.originalLength); offset += 4;
    new DataView(frame.buffer).setUint16(offset, layer.metadata.length, true); offset += 2;
    writeUint32(frame, offset, layer.dataLength); offset += 4;
    frame.set(layer.metadata, offset); offset += layer.metadata.length;
  }
  frame.set(encrypt(compressed.data, SAVE_VERSION), offset);
  writeUint32(frame, frame.length - 4, crc32(frame.slice(0, -4)));
  const fragment = base64urlEncode(frame);
  if (fragment.length >= BUDGET) throw new RangeError('save_budget_exceeded');
  return { success: true, fragment, length: fragment.length, metrics: { rawBytes: payload.bytes.length, compressedBytes: compressed.data.length, layers: layers.length } };
}

export function encodeSeed(worldSeed) {
  const bytes = new Uint8Array(5);
  bytes[0] = 1;
  new DataView(bytes.buffer).setUint32(1, worldSeed, false);
  return base64urlEncode(bytes);
}

export { getTableVersion };
