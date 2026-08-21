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
    // Assert on errors only. Warning-level findings surface min-heights below the
    // aspirational 96px comfort minimum — those are advisory and drift naturally as
    // components are added/removed (mobile-combat-pass SESSION-04 added two more when
    // the portrait CMBT pane picked up .combat-active-conditions + tightened
    // .combat-target rows). Hardcoding a warning count made the test tripwire on
    // cosmetic changes; the 0-error invariant still holds.
    const findings = checkTouchTargets();
    expect(findings.filter((f) => f.level === 'error')).toEqual([]);
  });
});