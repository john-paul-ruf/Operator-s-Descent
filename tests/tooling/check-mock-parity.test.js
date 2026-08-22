import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkMockTokens } from '../../scripts/design-scan/check-mock-tokens.js';
import { checkMockClasses } from '../../scripts/design-scan/check-mock-classes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCANNER_SRC = readFileSync(resolve(HERE, '../../scripts/design-scan/check-mock-classes.js'), 'utf8');

describe('check-mock-parity', () => {
  it('reports no token mismatches across all 14 mocks', () => {
    expect(checkMockTokens()).toEqual([]);
  });

  // SESSION-06 — deploy-p and deploy-e are now defined in styles/components.css
  // (with player-accent / hostile-danger semantics) so every mock class has a
  // production home. SESSION-03 adds styles/icons.css to the file list so that
  // .icon / .icon-<size> / .icon-<tone> classes emitted by mock <svg use> markup
  // resolve. Zero findings means every mock class is legitimately matched by a
  // production stylesheet.
  it('reports zero mock-class parity findings after SESSION-03', () => {
    expect(checkMockClasses()).toEqual([]);
  });

  it('scans styles/icons.css so mock icon classes resolve', () => {
    expect(SCANNER_SRC).toContain("'styles/icons.css'");
  });
});
