import { describe, it, expect } from 'vitest';
import {
  getSignatureTier,
  getSignature,
  canEquipWeapon,
  canEquipArmor,
  canCastSchool,
  maxProtocolTier,
  autoUpgradeSignature,
  primaryAttributeCostReduction,
  getCalibrationOptions,
  getSignatureCapabilities,
  applySignatureModifier,
  canEquip,
  canPrepareProtocol,
} from '../../src/rules/classes.js';
import { makeClassData, findSeed } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

describe('getSignatureTier', () => {
  it('(0) === 1', () => { expect(getSignatureTier(0)).toBe(1); });
  it('(1) === 1', () => { expect(getSignatureTier(1)).toBe(1); });
  it('(2) === 2', () => { expect(getSignatureTier(2)).toBe(2); });
  it('(3) === 2', () => { expect(getSignatureTier(3)).toBe(2); });
  it('(4) === 3', () => { expect(getSignatureTier(4)).toBe(3); });
  it('(99) === 3', () => { expect(getSignatureTier(99)).toBe(3); });
});

describe('getSignature', () => {
  it('returns tiers[tier-1] object identity for n = 0, 2, 4', () => {
    const cd = makeClassData();
    expect(getSignature(cd, 0)).toBe(cd.signature.tiers[0]);
    expect(getSignature(cd, 2)).toBe(cd.signature.tiers[1]);
    expect(getSignature(cd, 4)).toBe(cd.signature.tiers[2]);
  });
});

describe('gates with makeClassData', () => {
  const cd = makeClassData();
  it('canEquipWeapon true for sidearm, false for sniper', () => {
    expect(canEquipWeapon(cd, 'sidearm')).toBe(true);
    expect(canEquipWeapon(cd, 'sniper')).toBe(false);
  });
  it('canEquipArmor true for light, false for heavy', () => {
    expect(canEquipArmor(cd, 'light')).toBe(true);
    expect(canEquipArmor(cd, 'heavy')).toBe(false);
  });
  it('canCastSchool true for disrupt, false for ward', () => {
    expect(canCastSchool(cd, 'disrupt')).toBe(true);
    expect(canCastSchool(cd, 'ward')).toBe(false);
  });
  it('maxProtocolTier === 2', () => {
    expect(maxProtocolTier(cd)).toBe(2);
  });
});

describe('autoUpgradeSignature', () => {
  it('true for 2 and 4', () => {
    expect(autoUpgradeSignature(2)).toBe(true);
    expect(autoUpgradeSignature(4)).toBe(true);
  });
  it('false for 0, 1, 3, 5, 6', () => {
    expect(autoUpgradeSignature(0)).toBe(false);
    expect(autoUpgradeSignature(1)).toBe(false);
    expect(autoUpgradeSignature(3)).toBe(false);
    expect(autoUpgradeSignature(5)).toBe(false);
    expect(autoUpgradeSignature(6)).toBe(false);
  });
});

describe('primaryAttributeCostReduction', () => {
  const cd = makeClassData({ primaryAttribute: 'mgt' });
  it('1 for primary attribute', () => {
    expect(primaryAttributeCostReduction(cd, 'mgt')).toBe(1);
  });
  it('0 for non-primary', () => {
    expect(primaryAttributeCostReduction(cd, 'fin')).toBe(0);
  });
});

describe('getCalibrationOptions', () => {
  it('missing pool returns []', () => {
    const cd = makeClassData({ calibrationOptions: {} });
    expect(getCalibrationOptions(cd, 1, 'char_a', 3)).toEqual([]);
  });
  it('missing floor key returns []', () => {
    const cd = makeClassData({ calibrationOptions: { '6': ['a', 'b'] } });
    expect(getCalibrationOptions(cd, 1, 'char_a', 3)).toEqual([]);
  });
  it('empty floor array returns []', () => {
    const cd = makeClassData({ calibrationOptions: { '3': [] } });
    expect(getCalibrationOptions(cd, 1, 'char_a', 3)).toEqual([]);
  });
  it('deterministic — two calls deep-equal', () => {
    const cd = makeClassData({ calibrationOptions: { '3': ['a', 'b', 'c', 'd', 'e'] } });
    const a = getCalibrationOptions(cd, 42, 'char_a', 3);
    const b = getCalibrationOptions(cd, 42, 'char_a', 3);
    expect(a).toEqual(b);
  });
  it('length <= 3', () => {
    const cd = makeClassData({ calibrationOptions: { '3': ['a', 'b', 'c', 'd', 'e'] } });
    const result = getCalibrationOptions(cd, 42, 'char_a', 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });
  it('no duplicate entries', () => {
    const cd = makeClassData({ calibrationOptions: { '3': ['a', 'b', 'c', 'd', 'e'] } });
    const result = getCalibrationOptions(cd, 42, 'char_a', 3);
    expect(new Set(result).size).toBe(result.length);
  });
  it('pool smaller than 3 returns length <= 2', () => {
    const cd = makeClassData({ calibrationOptions: { '3': ['a', 'b'] } });
    const result = getCalibrationOptions(cd, 42, 'char_a', 3);
    expect(result.length).toBeLessThanOrEqual(2);
  });
  it('different worldSeed can produce different selection', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const cd = makeClassData({ calibrationOptions: { '3': pool } });
    const seedA = findSeed(s => {
      const r = getCalibrationOptions(cd, s, 'char_a', 3);
      return r.length > 0;
    });
    const resultA = getCalibrationOptions(cd, seedA, 'char_a', 3);
    let foundDiff = false;
    for (let s = 0; s < 10000; s++) {
      if (s === seedA) continue;
      const r = getCalibrationOptions(cd, s, 'char_a', 3);
      if (JSON.stringify(r) !== JSON.stringify(resultA)) {
        foundDiff = true;
        break;
      }
    }
    expect(foundDiff).toBe(true);
  });
});

describe('real class data pass', () => {
  const classes = loadData('classes');
  for (const entry of classes.classes) {
    it(`getSignature(${entry.id}, 0) returns defined tier-1 object`, () => {
      const sig = getSignature(entry, 0);
      expect(sig).toBeDefined();
    });
  }
});

describe('structured signatures', () => {
  const classes = loadData('classes').classes;
  const expectedHooks = {
    breacher: ['attack', 'attack', 'after_move'],
    ghost: ['move', 'initiative', 'move'],
    compiler: ['overclock', 'overclock', 'overclock'],
    anchor: ['defense_aura', 'defense_aura', 'signature_action'],
    oracle: ['detection', 'reroll', 'floor_entry'],
    operator: ['signature_action', 'signature_action', 'signature_action'],
  };

  for (const classData of classes) {
    it(`${classData.id} exposes each tier's capability hooks`, () => {
      for (const [calibrations, count] of [[0, 1], [2, 2], [4, 3]]) {
        const capabilities = getSignatureCapabilities({ calibrationCount: calibrations }, classData);
        expect(capabilities.tier).toBe(count);
        expect(capabilities.effects.map(effect => effect.hook)).toEqual(expectedHooks[classData.id].slice(0, count));
      }
    });
  }

  it('tracks limited signature actions without mutating the source ledger', () => {
    const operator = classes.find(entry => entry.id === 'operator');
    const capabilities = getSignatureCapabilities({ calibrationCount: 4 }, operator);
    const first = applySignatureModifier('signature_action', { consume: true, effectId: 'overlay_attack', usageLedger: {} }, capabilities);
    const second = applySignatureModifier('signature_action', { consume: true, effectId: 'overlay_attack', usageLedger: first.context.usageLedger }, capabilities);
    expect(first.effects).toHaveLength(1);
    expect(second.effects).toEqual([]);
    expect(first.context.usageLedger).toEqual({ 'overlay:overlay_attack': 1 });
  });

  it('merges hooks into a mechanics-ready parameter set', () => {
    const breacher = classes.find(entry => entry.id === 'breacher');
    const result = applySignatureModifier('attack', {}, getSignatureCapabilities({ calibrationCount: 2 }, breacher));
    expect(result.context.signatureParameters).toEqual({ ignoreCover: true, ignoreShielded: true });
  });
});

describe('generalized gates', () => {
  const classes = loadData('classes').classes;
  const breacher = classes.find(entry => entry.id === 'breacher');
  const ghost = classes.find(entry => entry.id === 'ghost');

  it('enforces Breacher and Ghost exclusions while allowing earned proficiencies', () => {
    expect(canEquip(breacher, { baseType: 'light_ranged', category: 'weapon' })).toBe(false);
    expect(canEquip(ghost, { baseType: 'light_ranged', category: 'weapon' })).toBe(false);
    expect(canEquip(breacher, { baseType: 'light_ranged', category: 'weapon' }, ['light_ranged'])).toBe(true);
  });

  it('enforces protocol gate tiers and optional earned preparation', () => {
    expect(canPrepareProtocol(breacher, { school: 'disrupt', tier: 3 })).toBe(false);
    expect(canPrepareProtocol(breacher, { school: 'ward', tier: 1 })).toBe(false);
    expect(canPrepareProtocol(breacher, { school: 'ward', tier: 1 }, ['protocol:ward'])).toBe(true);
  });
});
