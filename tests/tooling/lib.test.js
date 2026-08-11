import { describe, expect, it } from 'vitest';
import { parseRootTokens, parseClassSelectors, parseBacktickTableRows, assertCount, fileExists, readText } from '../../scripts/design-scan/lib.js';

describe('design-scan lib helpers', () => {
  it('parseRootTokens reads :root custom properties from plain CSS', () => {
    const tokens = parseRootTokens(':root { --accent: #7ec8e3; --bg-base: #0a0612; }\n.other { color: red; }');
    expect(tokens).toEqual({ '--accent': '#7ec8e3', '--bg-base': '#0a0612' });
  });

  it('parseRootTokens reads :root from an HTML <style> block', () => {
    const html = '<html><head><style>:root { --accent: #7ec8e3; }</style></head></html>';
    expect(parseRootTokens(html)).toEqual({ '--accent': '#7ec8e3' });
  });

  it('parseClassSelectors collects every class token from rule subjects, ignoring @-rules', () => {
    const css = '.item-card.corrupt { color: red; }\n.mode-tab:hover { color: blue; }\n@keyframes spin { from { opacity: 0; } }';
    const classes = parseClassSelectors(css);
    expect([...classes].sort()).toEqual(['corrupt', 'item-card', 'mode-tab']);
  });

  it('parseBacktickTableRows extracts token/value pairs within a bounded section', () => {
    const md = '### A\n| `--x` | `1` | note |\n### B\n| `--y` | `2` | note |';
    expect(parseBacktickTableRows(md, { startMarker: '### A', endMarker: '### B' })).toEqual([['--x', '1']]);
  });

  it('assertCount throws when the extracted count does not match', () => {
    expect(() => assertCount([1, 2], 3, 'widgets')).toThrow(/expected 3 extracted, found 2/);
    expect(assertCount([1, 2], 2, 'widgets')).toEqual([1, 2]);
  });

  it('fileExists and readText resolve relative to the repo root', () => {
    expect(fileExists('package.json')).toBe(true);
    expect(fileExists('does/not/exist.json')).toBe(false);
    expect(readText('package.json')).toContain('"name"');
  });
});