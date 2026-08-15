import { describe, expect, it } from 'vitest';
import { checkColorTokens, checkCornerRadius } from '../../scripts/design-scan/check-tokens.js';
import { checkTouchTargets } from '../../scripts/design-scan/check-touch-targets.js';

describe('check-tokens', () => {
  it('reports no color token mismatches against the current repo', () => {
    expect(checkColorTokens()).toEqual([]);
  });


  it('reports no corner-radius errors against the current repo', () => {
    const findings = checkCornerRadius();
    expect(findings.filter((f) => f.level === 'error')).toEqual([]);
    expect(findings.filter((f) => f.level === 'info').length).toBe(2);
  });
});

describe('check-touch-targets', () => {
  it('reports no touch-target errors against the current repo', () => {
    const findings = checkTouchTargets();
    expect(findings.filter((f) => f.level === 'error')).toEqual([]);
    expect(findings.filter((f) => f.level === 'warning').length).toBe(3);
  });
});