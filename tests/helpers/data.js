import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function loadData(name) {
  return JSON.parse(readFileSync(`${ROOT}data/${name}.json`, 'utf8'));
}