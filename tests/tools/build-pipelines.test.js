import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const tailwindPath = resolve(projectRoot, 'styles', 'tailwind.css');
const spritePath = resolve(projectRoot, 'assets', 'icons.svg');
const subsetPath = resolve(projectRoot, 'tools', 'icons', 'subset.json');

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

describe('tailwind build output', () => {
  test('styles/tailwind.css exists and is non-empty', () => {
    const stats = statSync(tailwindPath);
    expect(stats.size).toBeGreaterThan(100);
  });

  test('generated CSS contains a utility class we depend on', () => {
    const css = readFileSync(tailwindPath, 'utf8');
    expect(css).toMatch(/\.flex\b/);
  });
});

describe('icon sprite build output', () => {
  const sprite = readFileSync(spritePath, 'utf8');
  const subset = JSON.parse(readFileSync(subsetPath, 'utf8'));
  const subsetIds = flattenSubset(subset);
  const symbolIds = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]);

  test('sprite is non-empty and holds at least 40 symbols', () => {
    const stats = statSync(spritePath);
    expect(stats.size).toBeGreaterThan(100);
    expect(symbolIds.length).toBeGreaterThanOrEqual(40);
  });

  test('every id in subset.json appears exactly once as a <symbol>', () => {
    for (const id of subsetIds) {
      const occurrences = symbolIds.filter((candidate) => candidate === id).length;
      expect(occurrences, `symbol count for '${id}'`).toBe(1);
    }
  });

  test('no orphan symbols beyond subset.json', () => {
    const subsetSet = new Set(subsetIds);
    for (const id of symbolIds) {
      expect(subsetSet.has(id), `orphan symbol '${id}'`).toBe(true);
    }
  });

  // icon-first-ui-density SESSION-02: pin the two new ids ordered by
  // SESSION-01's followUp so the sprite pipeline stops re-shipping without
  // them if the subset is rebuilt from an older revision.
  test('SESSION-02 additions ship in both subset.json and the sprite', () => {
    const subsetSet = new Set(subsetIds);
    const symbolSet = new Set(symbolIds);
    for (const id of ['chevron-down', 'hash']) {
      expect(subsetSet.has(id), `subset.json missing '${id}'`).toBe(true);
      expect(symbolSet.has(id), `assets/icons.svg missing '${id}'`).toBe(true);
    }
  });
});
