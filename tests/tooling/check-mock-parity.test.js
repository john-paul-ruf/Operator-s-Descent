import { describe, expect, it } from 'vitest';
import { checkMockTokens } from '../../scripts/design-scan/check-mock-tokens.js';
import { checkMockClasses } from '../../scripts/design-scan/check-mock-classes.js';

describe('check-mock-parity', () => {
  it('reports no token mismatches across all 14 mocks', () => {
    expect(checkMockTokens()).toEqual([]);
  });

  // SESSION-06 — deploy-p and deploy-e are now defined in styles/components.css
  // (with player-accent / hostile-danger semantics) so every mock class has a
  // production home. Zero findings means every mock class is legitimately
  // matched by a production stylesheet.
  it('reports zero mock-class parity findings after SESSION-06', () => {
    expect(checkMockClasses()).toEqual([]);
  });
});
