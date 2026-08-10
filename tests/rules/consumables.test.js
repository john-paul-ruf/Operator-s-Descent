import { describe, expect, it } from 'vitest';
import { applyConsumable } from '../../src/rules/consumables.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

const data = loadData('consumables').consumables;
const cursor = (...rolls) => ({ nextInt: () => rolls.shift() ?? 0 });
const stack = (count = 2) => [{ id: 'patches', category: 'consumable', baseType: 'repair_patch', count, affixes: [], stats: {}, salvageValue: 1, junkTagged: false }];

describe('seven consumables', () => {
  it('uses the die count rather than die sides and clamps HP', () => {
    const target = makeCharacter({ hp: 25, hpMax: 30 });
    expect(applyConsumable(target, data.repair_patch, { rngCursor: cursor(5) })).toMatchObject({ success: true, healed: 6 });
    expect(target.hp).toBe(30);
    const med = makeCharacter({ hp: 1, hpMax: 100 });
    expect(applyConsumable(med, data.med_kit, { rngCursor: cursor(0, 5) }).healed).toBe(7);
  });

  it('restores bounded charge, chosen conditions, SHIELDED, and combat AP', () => {
    const target = makeCharacter({ charge: 19, chargeMax: 20, attributes: { res: 8 }, conditions: [{ id: 'jammed', duration: 2 }] });
    expect(applyConsumable(target, data.charge_cell).chargeRestored).toBe(4);
    expect(target.charge).toBe(20);
    expect(applyConsumable(target, data.purge_spike, { conditionId: 'jammed' }).conditionRemoved).toBe('jammed');
    expect(applyConsumable(target, data.shield_capacitor, { conditionsData: loadData('conditions') }).conditionApplied).toBe('shielded');
    const activeCharacter = makeCharacter({ ap: 1 });
    expect(applyConsumable(target, data.adrenal_injector, { inCombat: true, activeCharacter }).apRestored).toBe(1);
    expect(activeCharacter.ap).toBe(2);
  });

  it('enforces combat-only use and consumes exactly one stack unit on success', () => {
    const target = makeCharacter({ hp: 1, hpMax: 30 });
    expect(applyConsumable(target, data.adrenal_injector, { inCombat: false })).toEqual({ success: false, reason: 'combat_only' });
    const result = applyConsumable(target, data.repair_patch, { rngCursor: cursor(0), inventory: stack(), itemId: 'patches' });
    expect(result).toMatchObject({ success: true, consumedUnits: 1, inventory: [expect.objectContaining({ id: 'patches', count: 1 })] });
  });
});
