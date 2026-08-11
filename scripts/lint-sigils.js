#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPROVED_LITERAL_PATHS = new Set([
  'data/sigils.json',
  'font-src/glyphs.json',
  'font-src/review-notes.md',
  'docs/sigil-contact-sheet.html',
  'docs/sigil-contact-sheet.css',
  'tests/data/sigil-lint.test.js',
  'font-src/review-notes.md',
]);
const ALLOWED_FONT_FILES = new Set([
  'styles/base.css',
  'styles/components.css',
  'src/ui/components.js',
  'src/ui/playfield.js',
  'docs/sigil-contact-sheet.html',
  'docs/sigil-contact-sheet.css',
  'scripts/lint-sigils.js',
  'font-src/review-notes.md',
]);
const SIZE_CLASSES = new Set(['sigil-34', 'sigil-72', 'sigil-108', 'sigil-220']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'assets', 'program', 'specs', 'mocks']);

export function getSigilBanks(sigils) {
  const player = Object.values(sigils.playerBank.families).flatMap(({ codepoints }) => codepoints);
  const bestiary = Object.values(sigils.bestiaryBank.archetypes).flatMap(({ codepoints }) => codepoints);
  const safe = Object.values(sigils.safeSubstitutionPool).flat();
  return { player, bestiary, safe, reserved: [...player, ...bestiary] };
}

export function validateSigilData(sigils) {
  const { player, bestiary, safe, reserved } = getSigilBanks(sigils);
  const errors = [];
  if (player.length !== 48 || new Set(player).size !== 48) errors.push('player bank must contain 48 unique codepoints');
  if (bestiary.length !== 24 || new Set(bestiary).size !== 24) errors.push('bestiary bank must contain 24 unique codepoints');
  if (new Set(reserved).size !== 72) errors.push('player and bestiary banks must not overlap');
  if (safe.some((codepoint) => reserved.includes(codepoint))) errors.push('safe substitution pool intersects reserved sigil bank');
  return errors;
}

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(file, out);
    else out.push(file);
  }
  return out;
}

export function lintSigils(root = ROOT) {
  const sigils = JSON.parse(fs.readFileSync(path.join(root, 'data/sigils.json'), 'utf8'));
  const { reserved } = getSigilBanks(sigils);
  const errors = validateSigilData(sigils);
  const reservedChars = new Set(reserved.map((codepoint) => String.fromCodePoint(codepoint)));

  for (const file of listFiles(root)) {
    const rel = path.relative(root, file).replaceAll(path.sep, '/');
    if (!/\.(js|css|html|md|json)$/.test(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!APPROVED_LITERAL_PATHS.has(rel)) {
      for (const char of reservedChars) {
        if (text.includes(char)) errors.push(`${rel}: raw reserved sigil character outside approved context`);
      }
    }
    if (text.includes('DESCENT SIGIL') && !ALLOWED_FONT_FILES.has(rel)) {
      errors.push(`${rel}: direct DESCENT SIGIL font usage outside rendering boundary`);
    }
    for (const match of text.matchAll(/sigil-(\d+)/g)) {
      if (!SIZE_CLASSES.has(match[0])) errors.push(`${rel}: unsupported sigil size class ${match[0]}`);
    }
  }

  const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  for (const forbidden of ['./font-src/', './tools/', './docs/sigil-contact-sheet.html', './docs/sigil-contact-sheet.css']) {
    if (sw.includes(forbidden)) errors.push(`service-worker.js: tooling/contact-sheet asset cached: ${forbidden}`);
  }
  if (!sw.includes('./assets/descent-sigil.woff2')) errors.push('service-worker.js: production sigil WOFF2 missing from cache manifest');
  return errors;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const errors = lintSigils();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('sigil lint passed');
}
