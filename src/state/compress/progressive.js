import * as pass1bit from './pass-1bit.js';
import * as pass4bit from './pass-4bit.js';
import * as pass8bit from './pass-8bit.js';
import * as pass16bit from './pass-16bit.js';
import * as pass32bit from './pass-32bit.js';

const PASSES = [pass1bit, pass4bit, pass8bit, pass16bit, pass32bit];
const MAX_LAYERS = PASSES.length;
const MAX_LAYER_BYTES = 1_000_000;
function fail(code) { const error = new RangeError(code); error.code = code; throw error; }
function isAsync(pass) { return pass.compress.constructor.name === 'AsyncFunction'; }

function frameLayer(pass, originalLength, metadata, data) {
  if (!(metadata instanceof Uint8Array) || !(data instanceof Uint8Array) || metadata.length > 0xffff || data.length > MAX_LAYER_BYTES) fail('malformed_compression');
  const frame = new Uint8Array(1 + 4 + 2 + 4 + metadata.length + data.length);
  const view = new DataView(frame.buffer);
  frame[0] = pass;
  view.setUint32(1, originalLength, true);
  view.setUint16(5, metadata.length, true);
  view.setUint32(7, data.length, true);
  frame.set(metadata, 11);
  frame.set(data, 11 + metadata.length);
  return Object.assign(frame, { pass, dict: metadata });
}

function parseLayer(frame, limits) {
  if (!(frame instanceof Uint8Array) || frame.length < 11) fail('truncated');
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const pass = frame[0], originalLength = view.getUint32(1, true), metadataLength = view.getUint16(5, true), dataLength = view.getUint32(7, true);
  if (!PASSES[pass] || originalLength > limits.maxOutput || dataLength > limits.maxInput || frame.length !== 11 + metadataLength + dataLength) fail('malformed_compression');
  return { pass, originalLength, metadata: frame.slice(11, 11 + metadataLength), data: frame.slice(11 + metadataLength) };
}

function runSync(data, budgetCheck) {
  const layers = [];
  let current = data;
  for (let pass = 0; pass < PASSES.length; pass++) {
    if (isAsync(PASSES[pass])) continue;
    const result = PASSES[pass].compress(current);
    if (!result || result.encodedSize >= current.length) continue;
    const frame = frameLayer(pass, current.length, result.metadata, result.data);
    if (frame.length >= current.length) continue;
    layers.push(frame);
    current = result.data;
    if (budgetCheck?.(current, layers)) break;
  }
  return { data: current, layers };
}

export function compressSync(data, budgetCheck) { return runSync(data, budgetCheck); }

export function compressLegacySync(data, budgetCheck) {
  const layers = [];
  let current = data;
  for (let pass = 0; pass < PASSES.length; pass++) {
    if (isAsync(PASSES[pass])) continue;
    const result = PASSES[pass].compress(current);
    if (!result || result.encodedSize >= current.length) continue;
    const packed = result.metadata.length
      ? Uint8Array.from([result.metadata.length, ...result.metadata, ...result.data])
      : result.data;
    if (packed.length >= current.length) continue;
    layers.push({ pass });
    current = packed;
    if (budgetCheck?.(current, layers)) break;
  }
  return { data: current, layers };
}

export async function compress(data, budgetCheck) {
  const layers = [];
  let current = data;
  for (let pass = 0; pass < PASSES.length; pass++) {
    let result;
    try { result = await PASSES[pass].compress(current); } catch { continue; }
    if (!result || result.encodedSize >= current.length) continue;
    const frame = frameLayer(pass, current.length, result.metadata, result.data);
    if (frame.length >= current.length) continue;
    layers.push(frame);
    current = result.data;
    if (budgetCheck?.(current, layers)) break;
  }
  return { data: current, layers };
}

function decodeSync(data, layers, limits = {}) {
  const options = { maxOutput: limits.maxOutput ?? MAX_LAYER_BYTES, maxInput: limits.maxInput ?? MAX_LAYER_BYTES };
  if (!Array.isArray(layers) || layers.length > MAX_LAYERS) fail('malformed_compression');
  let current = data;
  for (let index = layers.length - 1; index >= 0; index--) {
    if (!(layers[index] instanceof Uint8Array)) {
      const pass = PASSES[layers[index]?.pass];
      if (!pass || isAsync(pass)) fail('malformed_compression');
      current = pass.decompress(current, layers[index].metadata ?? layers[index].dict ?? new Uint8Array(), { maxOutput: options.maxOutput });
      continue;
    }
    const layer = parseLayer(layers[index], options);
    if (isAsync(PASSES[layer.pass])) fail('unsupported_compression');
    if (current.length !== layer.data.length || current.some((byte, offset) => byte !== layer.data[offset])) fail('malformed_compression');
    current = PASSES[layer.pass].decompress(layer.data, layer.metadata, { maxOutput: options.maxOutput, expectedLength: layer.originalLength });
  }
  return current;
}

export function decompressSync(data, layers, limits) { return decodeSync(data, layers, limits); }
export async function decompress(data, layers, limits = {}) {
  const options = { maxOutput: limits.maxOutput ?? MAX_LAYER_BYTES, maxInput: limits.maxInput ?? MAX_LAYER_BYTES };
  if (!Array.isArray(layers) || layers.length > MAX_LAYERS) fail('malformed_compression');
  let current = data;
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = parseLayer(layers[index], options);
    if (current.length !== layer.data.length || current.some((byte, offset) => byte !== layer.data[offset])) fail('malformed_compression');
    current = await PASSES[layer.pass].decompress(layer.data, layer.metadata, { maxOutput: options.maxOutput, expectedLength: layer.originalLength });
  }
  return current;
}
