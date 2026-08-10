import { createPRNG } from '../core/prng.js';

const APP_KEY = 0xDE5C3E07;

export function encrypt(data, versionByte) {
  const prng = createPRNG((APP_KEY ^ versionByte) >>> 0);
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ (Math.floor(prng.next() * 256) & 0xFF);
  }
  return result;
}

export function decrypt(data, versionByte) {
  return encrypt(data, versionByte);
}