import * as pass1bit from './pass-1bit.js';
import * as pass4bit from './pass-4bit.js';
import * as pass8bit from './pass-8bit.js';
import * as pass16bit from './pass-16bit.js';
import * as pass32bit from './pass-32bit.js';

const PASSES = [pass1bit, pass4bit, pass8bit, pass16bit, pass32bit];

export function compressSync(data, budgetCheck) {
  const layers = [];
  let current = data;

  for (let i = 0; i < PASSES.length; i++) {
    if (PASSES[i].compress.constructor.name === 'AsyncFunction') continue;
    const result = PASSES[i].compress(current);
    if (!result) continue;
    if (result.data.length >= current.length) continue;

    layers.push({ pass: i, dict: result.dict });
    current = result.data;

    if (budgetCheck && budgetCheck(current)) break;
  }

  return { data: current, layers };
}

export async function compress(data, budgetCheck) {
  const layers = [];
  let current = data;

  for (let i = 0; i < PASSES.length; i++) {
    const pass = PASSES[i];
    let result;
    try {
      result = await pass.compress(current);
    } catch {
      continue;
    }
    if (!result) continue;
    if (result.data.length >= current.length) continue;

    layers.push({ pass: i, dict: result.dict });
    current = result.data;

    if (budgetCheck && budgetCheck(current)) break;
  }

  return { data: current, layers };
}

export async function decompress(data, layers) {
  let current = data;
  for (let i = layers.length - 1; i >= 0; i--) {
    const pass = PASSES[layers[i].pass];
    current = await pass.decompress(current, layers[i].dict);
  }
  return current;
}

export function decompressSync(data, layers) {
  let current = data;
  for (let i = layers.length - 1; i >= 0; i--) {
    const pass = PASSES[layers[i].pass];
    current = pass.decompress(current, layers[i].dict);
  }
  return current;
}