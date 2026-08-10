import { describe, it, expect } from 'vitest';
import {
  protocolChargeCost,
  deckSlotCost,
  deckSlotCapacity,
  castProtocol,
  overclockProtocol,
} from '../../src/rules/protocols.js';
import { modifier } from '../../src/rules/attributes.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

const protocolsData = loadData('protocols');
const conditionsData = loadData('conditions').conditions;

describe('protocolChargeCost', () => {
  it('(1, false) === 2', () => { expect(protocolChargeCost(1, false)).toBe(2); });
  it('(3, false) === 6', () => { expect(protocolChargeCost(3, false)).toBe(6); });
  it('(1, true) === 4', () => { expect(protocolChargeCost(1, true)).toBe(4); });
  it('(3, true) === 12', () => { expect(protocolChargeCost(3, true)).toBe(12); });
});

describe('deckSlotCost', () => {
  it('=== tier for 1-3', () => {
    expect(deckSlotCost(1)).toBe(1);
    expect(deckSlotCost(2)).toBe(2);
    expect(deckSlotCost(3)).toBe(3);
  });
});

describe('deckSlotCapacity', () => {
  it('(4) === 2', () => { expect(deckSlotCapacity(4)).toBe(2); });
  it('(5) === 3', () => { expect(deckSlotCapacity(5)).toBe(3); });
  it('(1) === 1', () => { expect(deckSlotCapacity(1)).toBe(1); });
});

describe('castProtocol — invalid school/tier', () => {
  it('invalid school → {success: false, reason: "invalid-school"}', () => {
    const caster = makeCharacter({ charge: 20 });
    const cursor = createRNGCursorForRun(1);
    expect(castProtocol(caster, 'nonexistent', 1, null, protocolsData, conditionsData, cursor))
      .toEqual({ success: false, reason: 'invalid-school' });
  });
  it('tier beyond school tiers → invalid-tier', () => {
    const caster = makeCharacter({ charge: 20 });
    const cursor = createRNGCursorForRun(1);
    expect(castProtocol(caster, 'disrupt', 99, null, protocolsData, conditionsData, cursor))
      .toEqual({ success: false, reason: 'invalid-tier' });
  });
});

describe('castProtocol — insufficient charge', () => {
  it('returns insufficient-charge and charge unchanged', () => {
    const caster = makeCharacter({ charge: 1, attributes: { res: 5, foc: 5 } });
    const cursor = createRNGCursorForRun(1);
    const result = castProtocol(caster, 'disrupt', 1, null, protocolsData, conditionsData, cursor);
    expect(result).toEqual({ success: false, reason: 'insufficient-charge' });
    expect(caster.charge).toBe(1);
  });
});

describe('castProtocol — successful cast deducts tier*2 charge', () => {
  it('charge reduced by exactly 2 for tier 1', () => {
    const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
    const target = { id: 'enemy', hp: 100 };
    const cursor = createRNGCursorForRun(1);
    castProtocol(caster, 'disrupt', 1, target, protocolsData, conditionsData, cursor);
    expect(caster.charge).toBe(18);
  });
});

describe('castProtocol — damage type', () => {
  it('damage === rolledDice + resMod, target hp reduced', () => {
    const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
    const target = { id: 'enemy', hp: 100 };
    const cursor = createRNGCursorForRun(1);
    const result = castProtocol(caster, 'disrupt', 1, target, protocolsData, conditionsData, cursor);
    const resMod = modifier(5);
    expect(result.success).toBe(true);
    expect(result.result.damage).toBeGreaterThan(0);
    expect(target.hp).toBe(100 - result.result.damage);
    expect(result.result.damage).toBeGreaterThanOrEqual(6 + resMod);
    expect(result.result.damage).toBeLessThanOrEqual(36 + resMod);
  });
  it('damage bounds: 6+resMod <= damage <= 36+resMod over 20 seeds', () => {
    const resMod = modifier(5);
    for (let seed = 0; seed < 20; seed++) {
      const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
      const target = { id: 'enemy', hp: 1000 };
      const cursor = createRNGCursorForRun(seed);
      const result = castProtocol(caster, 'disrupt', 1, target, protocolsData, conditionsData, cursor);
      expect(result.result.damage).toBeGreaterThanOrEqual(6 + resMod);
      expect(result.result.damage).toBeLessThanOrEqual(36 + resMod);
    }
  });
  it('null target on damage → no throw, no hp change', () => {
    const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
    const cursor = createRNGCursorForRun(1);
    expect(() => castProtocol(caster, 'disrupt', 1, null, protocolsData, conditionsData, cursor)).not.toThrow();
  });
});

describe('castProtocol — heal type', () => {
  it('heals clamp at hpMax', () => {
    const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
    const target = { id: 'ally', hp: 29, hpMax: 30 };
    const cursor = createRNGCursorForRun(1);
    const result = castProtocol(caster, 'ward', 1, target, protocolsData, conditionsData, cursor);
    expect(result.result.healed).toBeGreaterThan(0);
    expect(target.hp).toBe(30);
  });
  it('result.healed reports un-clamped roll+mod', () => {
    const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
    const target = { id: 'ally', hp: 29, hpMax: 30 };
    const cursor = createRNGCursorForRun(1);
    const result = castProtocol(caster, 'ward', 1, target, protocolsData, conditionsData, cursor);
    const resMod = modifier(5);
    expect(result.result.healed).toBeGreaterThanOrEqual(6 + resMod);
    expect(result.result.healed).toBeLessThanOrEqual(36 + resMod);
  });
  it('null target on heal → no throw', () => {
    const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
    const cursor = createRNGCursorForRun(1);
    expect(() => castProtocol(caster, 'ward', 1, null, protocolsData, conditionsData, cursor)).not.toThrow();
  });
});

describe('castProtocol — condition type', () => {
  it('fresh target gains the condition', () => {
    const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
    const target = makeCharacter({ id: 'enemy' });
    const cursor = createRNGCursorForRun(1);
    const result = castProtocol(caster, 'scry', 2, target, protocolsData, conditionsData, cursor);
    expect(result.success).toBe(true);
    expect(result.result.conditionsApplied).toHaveLength(1);
    expect(result.result.conditionsApplied[0].condition).toBe('marked');
    expect(target.conditions.some(c => c.id === 'marked')).toBe(true);
  });
  it('shielded target absorbs condition', () => {
    const caster = makeCharacter({ charge: 20, attributes: { res: 5, foc: 5 } });
    const target = makeCharacter({ id: 'enemy', conditions: [{ id: 'shielded', duration: 3, stacks: 1 }] });
    const cursor = createRNGCursorForRun(1);
    const result = castProtocol(caster, 'scry', 2, target, protocolsData, conditionsData, cursor);
    expect(result.result.conditionsApplied[0].applied).toBe(false);
    expect(result.result.conditionsApplied[0].shielded).toBe(true);
    expect(target.conditions.some(c => c.id === 'marked')).toBe(false);
    expect(target.conditions.some(c => c.id === 'shielded')).toBe(false);
  });
});

describe('overclockProtocol — insufficient charge', () => {
  it('returns insufficient-charge for doubled cost', () => {
    const caster = makeCharacter({ charge: 3, attributes: { res: 5, foc: 5 } });
    const cursor = createRNGCursorForRun(1);
    const result = overclockProtocol(caster, 'disrupt', 1, null, protocolsData, conditionsData, cursor);
    expect(result).toEqual({ success: false, reason: 'insufficient-charge' });
    expect(caster.charge).toBe(3);
  });
});

describe('overclockProtocol — success branch (tier 1, seed 4)', () => {
  it('returns overclocked:true, casts tier+1, double charge deduction', () => {
    const caster = makeCharacter({ charge: 100, attributes: { res: 5, foc: 5 } });
    const target = { id: 'enemy', hp: 100 };
    const cursor = createRNGCursorForRun(4);
    const result = overclockProtocol(caster, 'disrupt', 1, target, protocolsData, conditionsData, cursor);
    expect(result.success).toBe(true);
    expect(result.overclocked).toBe(true);
    expect(result.corruptionAdded).toBe(0);
    expect(result.result.protocolName).toBe('SURGE');
    // BUG: overclock double-deduction — overclock cost (tier*4=4) AND nested cast cost ((tier+1)*2=4) both apply
    expect(caster.charge).toBe(100 - 4 - 4);
  });
});

describe('overclockProtocol — failure branch (tier 1, seed 0)', () => {
  it('returns overclocked:false, corruption 0.05, only tier*4 charge spent', () => {
    const caster = makeCharacter({ charge: 100, attributes: { res: 5, foc: 5 } });
    const cursor = createRNGCursorForRun(0);
    const result = overclockProtocol(caster, 'disrupt', 1, null, protocolsData, conditionsData, cursor);
    expect(result.success).toBe(true);
    expect(result.overclocked).toBe(false);
    expect(result.corruptionAdded).toBe(0.05);
    expect(result.result).toBeNull();
    expect(result.roll).toBeDefined();
    expect(result.threshold).toBe(13);
    expect(caster.charge).toBe(96);
  });
});

describe('overclockProtocol — top tier (tier 5) success', () => {
  it('nested cast returns invalid-tier, result.result is undefined', () => {
    const caster = makeCharacter({ charge: 100, attributes: { res: 5, foc: 6 } });
    const target = { id: 'enemy', hp: 100 };
    const cursor = createRNGCursorForRun(18);
    const result = overclockProtocol(caster, 'disrupt', 5, target, protocolsData, conditionsData, cursor);
    expect(result.success).toBe(true);
    expect(result.overclocked).toBe(true);
    expect(result.corruptionAdded).toBe(0);
    expect(result.result).toBeUndefined();
    expect(caster.charge).toBe(80);
  });
});