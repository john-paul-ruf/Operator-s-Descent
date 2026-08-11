import { describe, expect, it } from 'vitest';
import sigils from '../../data/sigils.json' assert { type: 'json' };

const flatten = (groups) => Object.values(groups).flatMap(({ codepoints }) => codepoints);

describe('sigil banks', () => {
  it('declares the exact reserved player and bestiary banks', () => {
    const player = flatten(sigils.playerBank.families);
    const bestiary = flatten(sigils.bestiaryBank.archetypes);

    expect(player).toHaveLength(48);
    expect(new Set(player).size).toBe(48);
    expect(bestiary).toHaveLength(24);
    expect(new Set(bestiary).size).toBe(24);
    expect(new Set([...player, ...bestiary]).size).toBe(72);
  });

  it('keeps safe substitutions outside every reserved sigil codepoint', () => {
    const reserved = new Set([
      ...flatten(sigils.playerBank.families),
      ...flatten(sigils.bestiaryBank.archetypes),
    ]);
    const safe = Object.values(sigils.safeSubstitutionPool).flat();

    expect(safe.some((codepoint) => reserved.has(codepoint))).toBe(false);
  });
});
