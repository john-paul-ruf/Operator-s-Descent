import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { validateGameData } from '../src/data-loader.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA_FILES = [
  ['sigils', 'sigils.json'],
  ['themes', 'themes.json'],
  ['classes', 'classes.json'],
  ['protocols', 'protocols.json'],
  ['enemies', 'enemies.json'],
  ['equipment', 'equipment.json'],
  ['affixes', 'affixes.json'],
  ['conditions', 'conditions.json'],
  ['consumables', 'consumables.json'],
  ['symbolTable', 'symbol-table.json'],
  ['manual', 'manual.json']
];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'data', file), 'utf8'));
  } catch (error) {
    return { __loadError: error?.message || String(error) };
  }
}

const registry = Object.fromEntries(DATA_FILES.map(([key, file]) => [key, readJson(file)]));
const result = validateGameData(registry);

if (!result.valid) {
  for (const error of result.errors) console.error(`${error.file}: ${error.code} — ${error.details}`);
  process.exitCode = 1;
} else {
  console.log(`data validation passed: ${DATA_FILES.length} files`);
}
