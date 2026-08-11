import { describe, expect, it } from 'vitest';
import sigils from '../../data/sigils.json' assert { type: 'json' };
import { getSigilBanks, lintSigils, validateSigilData } from '../../scripts/lint-sigils.js';
import { validateSigilToken } from '../../src/ui/components.js';

describe('reserved sigil lint', () => {
  it('accepts the repository sigil bank contract', () => {
    expect(validateSigilData(sigils)).toEqual([]);
    expect(lintSigils()).toEqual([]);
  });

  it('rejects safe-pool overlap with reserved banks', () => {
    const invalid = structuredClone(sigils);
    invalid.safeSubstitutionPool.latin.push(invalid.playerBank.families.breacher.codepoints[0]);
    expect(validateSigilData(invalid)).toContain('safe substitution pool intersects reserved sigil bank');
  });

  it('enforces role and size at the rendering boundary', () => {
    const banks = getSigilBanks(sigils);
    expect(validateSigilToken(banks.player[0], 34, 'player')).toEqual({ valid: true });
    expect(validateSigilToken(banks.player[0], 72, 'echo')).toEqual({ valid: true });
    expect(validateSigilToken(banks.bestiary[0], 72, 'enemy')).toEqual({ valid: true });
    expect(validateSigilToken(banks.bestiary[0], 34, 'player').valid).toBe(false);
    expect(validateSigilToken(banks.player[0], 34, 'enemy').valid).toBe(false);
    expect(validateSigilToken(banks.player[0], 48, 'player').valid).toBe(false);
  });
});
