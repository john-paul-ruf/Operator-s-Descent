import { describe, expect, it } from 'vitest';
import { checkMockTokens } from '../../scripts/design-scan/check-mock-tokens.js';
import { checkMockClasses } from '../../scripts/design-scan/check-mock-classes.js';

describe('check-mock-parity', () => {
  it('reports no token mismatches across all 14 mocks', () => {
    expect(checkMockTokens()).toEqual([]);
  });

  it('runs the mock-class parity check without throwing and returns warning-level findings only', () => {
    const findings = checkMockClasses();
    expect(Array.isArray(findings)).toBe(true);
    for (const finding of findings) expect(finding.level).toBe('warning');
  });
});