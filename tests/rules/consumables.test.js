import { describe, it, expect } from 'vitest';
import { applyConsumable } from '../../src/rules/consumables.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

const consumablesData = loadData('consumables').consumables;

describe('applyConsumable — invalid consumable', () => {
  it('falsy data → {success: false, reason: "invalid-consumable"}', () => {
    const target = makeCharacter();
    expect(applyConsumable(target, null, {})).toEqual({ success: false, reason: 'invalid-consumable' });
    expect(applyConsumable(target, undefined, {})).toEqual({ success: false, reason: 'invalid-consumable' });
  });
});

describe('applyConsumable — combatOnly guard', () => {
  it('combatOnly true with inCombat false → combat-only', () => {
    const target = makeCharacter();
    const result = applyConsumable(target, consumablesData.adrenal_injector, { inCombat: false });
    expect(result).toEqual({ success: false, reason: 'combat-only' });
  });
  it('combatOnly true with inCombat true proceeds', () => {
    const target = makeCharacter({ ap: 2 });
    const cursor = createRNGCursorForRun(1);
    const activeChar = makeCharacter({ ap: 1 });
    const result = applyConsumable(target, consumablesData.adrenal_injector, {
      inCombat: true, rngCursor: cursor, activeCharacter: activeChar,
    });
    expect(result.success).toBe(true);
  });
});

describe('applyConsumable — heal', () => {
  it('hp clamps at hpMax', () => {
    const target = makeCharacter({ hp: 29, hpMax: 30 });
    const cursor = createRNGCursorForRun(1);
    const result = applyConsumable(target, consumablesData.repair_patch, { rngCursor: cursor });
    expect(result.success).toBe(true);
    expect(result.healed).toBeGreaterThan(0);
    expect(target.hp).toBe(30);
  });
  it('result.healed in [count, count*6]', () => {
    const target = makeCharacter({ hp: 1, hpMax: 1000 });
    const cursor = createRNGCursorForRun(1);
    const result = applyConsumable(target, consumablesData.repair_patch, { rngCursor: cursor });
    expect(result.healed).toBeGreaterThanOrEqual(6);
    expect(result.healed).toBeLessThanOrEqual(36);
  });
  it('target without hpMax uses hp + healed fallback (full heal applies)', () => {
    const target = makeCharacter({ hp: 10 });
    delete target.hpMax;
    const cursor = createRNGCursorForRun(1);
    const result = applyConsumable(target, consumablesData.repair_patch, { rngCursor: cursor });
    expect(target.hp).toBe(10 + result.healed);
  });
});

describe('applyConsumable — charge_restore', () => {
  it('res 3 → 2 (minRestore floor)', () => {
    const target = makeCharacter({ charge: 0, chargeMax: 20, attributes: { res: 3 } });
    const result = applyConsumable(target, consumablesData.charge_cell, {});
    expect(result.chargeRestored).toBe(2);
    expect(target.charge).toBe(2);
  });
  it('res 8 → 4', () => {
    const target = makeCharacter({ charge: 0, chargeMax: 20, attributes: { res: 8 } });
    const result = applyConsumable(target, consumablesData.charge_cell, {});
    expect(result.chargeRestored).toBe(4);
    expect(target.charge).toBe(4);
  });
  it('clamps at chargeMax', () => {
    const target = makeCharacter({ charge: 19, chargeMax: 20, attributes: { res: 8 } });
    applyConsumable(target, consumablesData.charge_cell, {});
    expect(target.charge).toBe(20);
  });
});

describe('applyConsumable — charge_restore_full', () => {
  it('sets to chargeMax, reports missing amount', () => {
    const target = makeCharacter({ charge: 5, chargeMax: 20 });
    const result = applyConsumable(target, consumablesData.boost_cell, {});
    expect(target.charge).toBe(20);
    expect(result.chargeRestored).toBe(15);
  });
  it('already-full target → 0 restored', () => {
    const target = makeCharacter({ charge: 20, chargeMax: 20 });
    const result = applyConsumable(target, consumablesData.boost_cell, {});
    expect(result.chargeRestored).toBe(0);
  });
});

describe('applyConsumable — remove_condition', () => {
  it('removes the first condition, conditionRemoved: true', () => {
    const target = makeCharacter({ conditions: [
      { id: 'jammed', duration: 2, stacks: 1 },
      { id: 'marked', duration: 3, stacks: 1 },
    ] });
    const result = applyConsumable(target, consumablesData.purge_spike, {});
    expect(result.conditionRemoved).toBe(true);
    expect(target.conditions).toHaveLength(1);
    expect(target.conditions[0].id).toBe('marked');
  });
  it('empty/absent list → no flag, still success', () => {
    const target = makeCharacter({ conditions: [] });
    const result = applyConsumable(target, consumablesData.purge_spike, {});
    expect(result.success).toBe(true);
    expect(result.conditionRemoved).toBeUndefined();
  });
});

describe('applyConsumable — apply_condition', () => {
  it('pushes {id, duration: 3, stacks: 1} regardless of data duration', () => {
    const target = makeCharacter();
    const result = applyConsumable(target, consumablesData.shield_capacitor, {});
    expect(result.conditionApplied).toBe('shielded');
    expect(target.conditions).toHaveLength(1);
    expect(target.conditions[0].duration).toBe(3);
    expect(target.conditions[0].stacks).toBe(1);
  });
});

describe('applyConsumable — ap_restore', () => {
  it('adds amount to context.activeCharacter.ap (not the target)', () => {
    const target = makeCharacter({ ap: 2 });
    const activeChar = makeCharacter({ ap: 1 });
    const cursor = createRNGCursorForRun(1);
    const result = applyConsumable(target, consumablesData.adrenal_injector, {
      inCombat: true, rngCursor: cursor, activeCharacter: activeChar,
    });
    expect(activeChar.ap).toBe(2);
    expect(target.ap).toBe(2);
    expect(result.apRestored).toBe(1);
  });
  it('missing activeCharacter → no throw, apRestored still reported', () => {
    const target = makeCharacter({ ap: 2 });
    const cursor = createRNGCursorForRun(1);
    const result = applyConsumable(target, consumablesData.adrenal_injector, {
      inCombat: true, rngCursor: cursor,
    });
    expect(result.apRestored).toBe(1);
    expect(target.ap).toBe(2);
  });
});

describe('applyConsumable — unknown effectData.type', () => {
  it('returns {success: true} with no mutation', () => {
    const target = makeCharacter({ hp: 15, charge: 5 });
    const result = applyConsumable(target, { effectData: { type: 'unknown' }, effect: 'test' }, {});
    expect(result.success).toBe(true);
    expect(result.effect).toBe('test');
    expect(target.hp).toBe(15);
    expect(target.charge).toBe(5);
  });
});