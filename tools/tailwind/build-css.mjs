// Compiles Tailwind utilities to styles/tailwind.css at dev time.
// Runtime never loads Tailwind directly; the generated CSS is committed and
// listed in the service worker's PRODUCTION_ASSETS so first-load offline works.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, 'tailwind.config.mjs');
const inputPath = resolve(here, 'input.css');
const outputPath = resolve(here, '..', '..', 'styles', 'tailwind.css');
const projectRoot = resolve(here, '..', '..');

const result = spawnSync(
  'npx',
  ['tailwindcss', '-c', configPath, '-i', inputPath, '-o', outputPath, '--minify'],
  { stdio: 'inherit', cwd: projectRoot }
);

if (result.error) {
  console.error('tailwindcss build failed:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
