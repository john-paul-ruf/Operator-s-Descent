import { describe, expect, it } from 'vitest';
import { checkMockTokens } from '../../scripts/design-scan/check-mock-tokens.js';
import { checkMockClasses } from '../../scripts/design-scan/check-mock-classes.js';

describe('check-mock-parity', () => {
  it('reports no token mismatches across all 14 mocks', () => {
    expect(checkMockTokens()).toEqual([]);
  });

  it('ignores only mock-generated combat deployment markers', () => {
    const findings = checkMockClasses();
    expect(findings.map(({ mockFile, className }) => `${mockFile}:${className}`)).toEqual([
      'combat.html:deploy-p',
      'combat.html:deploy-e'
    ]);
    for (const finding of findings) expect(finding.level).toBe('warning');
  });
});
