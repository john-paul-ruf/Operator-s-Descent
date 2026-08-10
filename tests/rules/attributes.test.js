import { describe, it, expect } from 'vitest';
import { attributeCost, attributeStepCost, deriveStats, modifier, overclockTarget, protocolSaveDC } from '../../src/rules/attributes.js';
import { makeCharacter, makeClassData } from '../helpers/fixtures.js';

describe('modifier', () => {
  it('(5) === 0', () => { expect(modifier(5)).toBe(0); });
  it('(1) === -4', () => { expect(modifier(1)).toBe(-4); });
  it('(10) === 5', () => { expect(modifier(10)).toBe(5); });
  it('(3) === -2', () => { expect(modifier(3)).toBe(-2); });
});

describe('deriveStats — all-5, hitDieBase 10, chargeBase 4, calib 0', () => {
  const char = makeCharacter({ calibrationCount: 0 });
  const cd = makeClassData({ hitDieBase: 10, chargeBase: 4 });
  const stats = deriveStats(char, cd);

  it('hpMax === 30', () => { expect(stats.hpMax).toBe(30); });
  it('chargeMax === 19', () => { expect(stats.chargeMax).toBe(19); });
  it('chargeRegen === 1', () => { expect(stats.chargeRegen).toBe(1); });
  it('defenseBase === 10', () => { expect(stats.defenseBase).toBe(10); });
  it('protocolDefenseBase === 10', () => { expect(stats.protocolDefenseBase).toBe(10); });
  it('initiativeMod === 0', () => { expect(stats.initiativeMod).toBe(0); });
  it('meleeAccuracy === 0', () => { expect(stats.meleeAccuracy).toBe(0); });
  it('rangedAccuracy === 0', () => { expect(stats.rangedAccuracy).toBe(0); });
  it('protocolAccuracy === 0', () => { expect(stats.protocolAccuracy).toBe(0); });
  it('detectionRadius === 10', () => { expect(stats.detectionRadius).toBe(10); });
});

describe('deriveStats — calibration growth', () => {
  it('calibCount 3, hitDieBase 10 -> hpMax 45 (growth 5)', () => {
    const char = makeCharacter({ calibrationCount: 3 });
    const cd = makeClassData({ hitDieBase: 10, chargeBase: 4 });
    expect(deriveStats(char, cd).hpMax).toBe(45);
  });
  it('calibCount 3, hitDieBase 3 -> hpMax 29 (growth clamps to 2)', () => {
    const char = makeCharacter({ calibrationCount: 3 });
    const cd = makeClassData({ hitDieBase: 3, chargeBase: 4 });
    expect(deriveStats(char, cd).hpMax).toBe(29);
  });
});

describe('deriveStats — asymmetric attributes', () => {
  it('fin 8 -> defenseBase 13, initiativeMod 3', () => {
    const char = makeCharacter({ attributes: { mgt: 5, fin: 8, vit: 5, res: 5, foc: 5, sig: 5 } });
    const cd = makeClassData({ hitDieBase: 10, chargeBase: 4 });
    const stats = deriveStats(char, cd);
    expect(stats.defenseBase).toBe(13);
    expect(stats.initiativeMod).toBe(3);
  });
  it('vit 2 drops hpMax', () => {
    const char = makeCharacter({ attributes: { mgt: 5, fin: 5, vit: 2, res: 5, foc: 5, sig: 5 } });
    const cd = makeClassData({ hitDieBase: 10, chargeBase: 4 });
    expect(deriveStats(char, cd).hpMax).toBe(18);
  });
});

describe('attributeCost', () => {
  it('(5, 5) === 0', () => { expect(attributeCost(5, 5)).toBe(0); });
  it('(6, 5) === 0 (never negative)', () => { expect(attributeCost(6, 5)).toBe(0); });
  it('(5, 6) === 1', () => { expect(attributeCost(5, 6)).toBe(1); });
  it('(5, 7) === 3', () => { expect(attributeCost(5, 7)).toBe(3); });
  it('(5, 8) === 5', () => { expect(attributeCost(5, 8)).toBe(5); });
  it('(5, 9) === 8', () => { expect(attributeCost(5, 9)).toBe(8); });
  it('(5, 10) === 11', () => { expect(attributeCost(5, 10)).toBe(11); });
  it('(1, 10) === 15', () => { expect(attributeCost(1, 10)).toBe(15); });
});

describe('authoritative formula helpers', () => {
  it('uses rank three as the creation-cost baseline', () => {
    expect(attributeStepCost(3, 6)).toBe(3);
    expect(attributeStepCost(3, 8)).toBe(7);
    expect(attributeStepCost(3, 10)).toBe(13);
  });

  it('derives protocol DC and overclock targets from the defined formulas', () => {
    expect(protocolSaveDC(makeCharacter({ attributes: { mgt: 3, fin: 3, vit: 3, res: 3, foc: 8, sig: 3 } }), 4)).toBe(17);
    expect(overclockTarget(1)).toBe(13);
    expect(overclockTarget(5)).toBe(21);
  });

  it('applies armor and shield stats without mutating the character', () => {
    const character = makeCharacter({ classId: 'ghost', attributes: { mgt: 5, fin: 6, vit: 5, res: 5, foc: 5, sig: 5 } });
    const stats = deriveStats(character, makeClassData({ id: 'ghost' }), { armor: { finPenalty: -1, defenseBonus: 3 }, offhand: { defenseBonus: 2 } });
    expect(stats).toMatchObject({ defenseBase: 15, initiativeMod: 0, rangedAccuracy: 0, finPenalty: -1 });
    expect(character.attributes.fin).toBe(6);
  });

  it('lets Breacher and Anchor ignore medium armor FIN penalties only', () => {
    const character = makeCharacter({ attributes: { mgt: 5, fin: 6, vit: 5, res: 5, foc: 5, sig: 5 } });
    expect(deriveStats(character, makeClassData({ id: 'breacher' }), { armor: { id: 'medium', finPenalty: -1, defenseBonus: 3 } }).initiativeMod).toBe(1);
    expect(deriveStats(character, makeClassData({ id: 'operator' }), { armor: { id: 'medium', finPenalty: -1, defenseBonus: 3 } }).initiativeMod).toBe(0);
  });
});
