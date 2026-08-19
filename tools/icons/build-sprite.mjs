// Reads tools/icons/subset.json and lucide's ESM icon modules, emits ONE
// static SVG sprite (`assets/icons.svg`) as a collection of <symbol> nodes.
// Runtime consumes the sprite via `<use href="assets/icons.svg#id"/>`.
//
// lucide v0.400 stores each icon as `[tag, defaultAttributes, children]` where
// each child is `[tag, attrs]`. This script imports each icon module, drops the
// outer `svg` wrapper (kept on the <symbol> as viewBox), and serializes the
// children as SVG source. Stroke attributes are preserved on the <symbol> so
// callers can recolor via `currentColor` in styles/icons.css.
//
// Fails hard with a non-zero exit code if any requested id is missing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const subsetPath = path.join(here, 'subset.json');
const iconsDir = path.join(projectRoot, 'node_modules', 'lucide', 'dist', 'esm', 'icons');
const outputPath = path.join(projectRoot, 'assets', 'icons.svg');

function flattenSubset(subset) {
  const seen = new Set();
  const ids = [];
  for (const group of Object.values(subset)) {
    if (!Array.isArray(group)) continue;
    for (const id of group) {
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderAttrs(attrs) {
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(' ');
}

function renderChild([tag, attrs]) {
  const rendered = renderAttrs(attrs);
  return rendered.length > 0 ? `<${tag} ${rendered}/>` : `<${tag}/>`;
}

function toCamel(id) {
  return id
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

async function loadIcon(id) {
  const file = path.join(iconsDir, `${id}.js`);
  if (!fs.existsSync(file)) return null;
  const module = await import(pathToFileURL(file).href);
  const icon = module.default ?? module[toCamel(id)];
  if (!Array.isArray(icon) || icon.length < 3) return null;
  const [, attrs, children] = icon;
  if (!Array.isArray(children)) return null;
  return { attrs, children };
}

function renderSymbol(id, { attrs, children }) {
  const strokeAttrs = {};
  for (const key of ['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']) {
    if (attrs[key] != null) strokeAttrs[key] = attrs[key];
  }
  const strokeSource = renderAttrs(strokeAttrs);
  const body = children.map(renderChild).join('');
  return `<symbol id="${escapeAttr(id)}" ${strokeSource}>${body}</symbol>`;
}

async function build() {
  const subset = JSON.parse(fs.readFileSync(subsetPath, 'utf8'));
  const ids = flattenSubset(subset);
  const missing = [];
  const symbols = [];
  for (const id of ids) {
    const icon = await loadIcon(id);
    if (!icon) {
      missing.push(id);
      continue;
    }
    symbols.push(renderSymbol(id, icon));
  }
  if (missing.length > 0) {
    console.error('Missing lucide icons:', missing.join(', '));
    process.exit(1);
  }
  const sprite =
    `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">` +
    symbols.join('') +
    `</svg>\n`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, sprite, 'utf8');
  console.log(`Wrote ${outputPath} (${symbols.length} symbols)`);
}

build().catch((error) => {
  console.error('sprite build failed:', error);
  process.exit(1);
});
