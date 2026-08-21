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
  it('reports zero errors AND zero warnings against the current repo (SESSION-06)', () => {
    // SESSION-06 raised every touch-capable row to the 96px floor and moved the
    // wide-mode 48px densification into a fine-pointer / hover-only scope in
    // styles/wide.css. The scanner reads styles/components.css so its findings
    // must now be empty on both axes — no more "advisory" warnings for rows
    // below the touch floor.
    const findings = checkTouchTargets();
    expect(findings.filter((f) => f.level === 'error')).toEqual([]);
    expect(findings.filter((f) => f.level === 'warning')).toEqual([]);
  });
});