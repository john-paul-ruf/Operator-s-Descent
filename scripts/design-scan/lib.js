import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function readText(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

export function fileExists(relPath) {
  return existsSync(join(ROOT, relPath));
}

export function listFiles(relDir, extension) {
  const base = join(ROOT, relDir);
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort();
}

export function parseBacktickTableRows(markdown, { startMarker, endMarker }) {
  const start = markdown.indexOf(startMarker);
  if (start === -1) throw new Error(`parseBacktickTableRows: startMarker not found: ${startMarker}`);
  const end = markdown.indexOf(endMarker, start);
  const section = markdown.slice(start, end === -1 ? undefined : end);
  const rowPattern = /\|\s*`([^`]+)`[^|]*\|\s*`([^`]+)`[^|]*\|/g;
  return [...section.matchAll(rowPattern)].map((match) => [match[1], match[2]]);
}

export function assertCount(items, expected, label) {
  if (items.length !== expected) {
    throw new Error(`${label}: expected ${expected} extracted, found ${items.length} — spec text may have changed shape`);
  }
  return items;
}

export function parseRootTokens(text) {
  const rootBlock = text.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || '';
  const tokens = {};
  for (const match of rootBlock.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[`--${match[1]}`] = match[2].trim();
  }
  return tokens;
}

export function parseClassSelectors(css) {
  const classes = new Set();
  for (const ruleOpen of css.matchAll(/^[^{}]+\{/gm)) {
    const selectorList = ruleOpen[0].slice(0, -1);
    if (selectorList.trim().startsWith('@')) continue;
    for (const match of selectorList.matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(match[1]);
  }
  return classes;
}