import { describe, expect, it } from 'vitest';
import { applyFloorEntryAffixes, describeItem, describeItemStats, equipItem, evaluateRange, getCoverBonus, getRangeBand, getAffixHooks, getSalvageValue, itemDisplayName, resolveArmorStats, resolveLoadout, resolveWeaponStats, unequipItem, useAffixReroll } from '../../src/rules/equipment.js';
import { createRunState, deserializeRunState } from '../../src/state/run-state.js';
import { loadData } from '../helpers/data.js';

const affixesData = loadData('affixes');
const equipmentData = loadData('equipment');
const consumablesData = loadData('consumables');
const fullData = { equipment: equipmentData, affixes: affixesData, consumables: consumablesData };

function character() {
  return {
    id: 'operator', classId: 'operator', sigilId: 'pua-e000',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, currentHP: 20, currentCHARGE: 10,
    calibrationCount: 0, calibrationChoices: [], signatureTier: 1, equipment: { weapon: null, armor: null, offhand: null }, protocolDeck: [], conditions: []
  };
}

function state(inventory = []) {
  return createRunState(42, [character()], { creationTimestamp: 1, inventory });
}

describe('affix runtime hooks', () => {
  it('exposes every affix behavior as structured combat, floor, charge, defense, and reroll hooks', () => {
    const hooks = getAffixHooks(Object.keys(affixesData.affixes), affixesData);
    expect(hooks).toMatchObject({
      attack: { accuracyBonus: 2, ignoreCover: true },
      damage: { dieUpgrades: 1, protocolBonus: 1 },
      onHit: { healing: 1, conditions: expect.arrayContaining([{ conditionId: 'burning', trigger: 'critical' }, { conditionId: 'corroded', trigger: 'hit', chance: 1, save: 'vit' }, { conditionId: 'jammed', trigger: 'hit', chance: 0.25, save: 'foc' }]) },
      floorEntry: { shielded: true }, charge: { maxBonus: 2, regenBonus: 1 }, defense: { bonus: 3, finPenaltyReduction: 1, ignoreFinPenalty: true }, reroll: { perFloor: 1 }
    });
  });

  it('materializes all numeric weapon and armor modifiers exactly once', () => {
    const weapon = resolveWeaponStats({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 1 }, ['reinforced', 'edged', 'precise', 'extended', 'conducting', 'vampiric', 'phasing'], affixesData);
    const armor = resolveArmorStats({ defenseBonus: 3, finPenalty: -2 }, ['reinforced', 'overcharged', 'lightweight', 'fortified', 'resonant', 'phasing', 'shielding', 'lucky'], affixesData);
    expect(weapon).toMatchObject({ damageDie: 'd8', maxRange: 6, accuracyBonus: 3, effects: { attack: { ignoreCover: true }, damage: { protocolBonus: 1 }, onHit: { healing: 1 } } });
    expect(armor).toMatchObject({ defenseBonus: 6, finPenalty: 0, chargeBonus: 2, chargeRegenBonus: 1, ignoreFinPenalty: true, effects: { floorEntry: { shielded: true }, reroll: { perFloor: 1 } } });
  });

  it('retains die caps, explicit range outcomes, and cover geometry', () => {
    expect(resolveWeaponStats({ damageDie: 'd12' }, [{ id: 'edged', effectData: { dieUpgrade: true } }]).damageDie).toBe('d12');
    expect(evaluateRange({ rangeBand: 'long', minRange: 3, maxRange: 16, accuracyBonus: -1 }, 2)).toMatchObject({ legal: true, reason: 'minimum_range_penalty' });
    expect(getRangeBand({ rangeBand: 'short', minRange: 0, maxRange: 4 }, 5)).toBe('out-of-range');
    const lattice = Array.from({ length: 8 }, () => Array(8).fill('floor'));
    lattice[3][3] = 'wall';
    lattice[5][5] = 'wall';
    expect(getCoverBonus(lattice, 6, 6, 1, 1)).toBe(4);
    expect(getSalvageValue({ salvageValue: 3 })).toBe(3);
  });

  it('resolves an object-form equipped item via its baseType against the catalog', () => {
    // Object-form is what materializeItem/normalizeItem actually produce — no baseline
    // damageDie/rangeBand/maxRange on the item itself. Before this fix equipped() ignored
    // object sources, resolveWeaponStats saw `{}`, and evaluateRange fell through with
    // reason:'not_a_weapon' → every armed party attack missed 100% of the time.
    const character = { equipment: { weapon: { id: 'op-w-sidearm', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false } } };
    const { weapon } = resolveLoadout(character, equipmentData, affixesData);
    expect(weapon).toMatchObject({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, accuracyBonus: 1 });
    expect(evaluateRange(weapon, 1).legal).toBe(true);
  });
});

describe('CORRUPT equipment transactions', () => {
  it('implants a CORRUPT item once, persists its ID/value, and never charges a re-equip twice', () => {
    const item = { id: 'corrupt-sidearm', category: 'weapon', baseType: 'sidearm', rarity: 'corrupt', affixes: ['lucky', 'phasing', 'edged'], corrupt: true, corruptionValue: 0.1, stats: {}, salvageValue: 1, junkTagged: false };
    const initial = state([item]);
    const equipped = equipItem(initial, 'operator', 'weapon', 'corrupt-sidearm');
    expect(equipped).toMatchObject({ success: true, corruptionAdded: 0.1 });
    expect(initial.corruption).toBe(0);
    expect(equipped.runState.serialize()).toMatchObject({ corruption: 0.1, appliedCorruptItemIds: ['corrupt-sidearm'] });
    const unequipped = unequipItem(equipped.runState, 'operator', 'weapon');
    const reequipped = equipItem(unequipped.runState, 'operator', 'weapon', 'corrupt-sidearm');
    expect(reequipped).toMatchObject({ success: true, corruptionAdded: 0 });
    expect(deserializeRunState(reequipped.runState.serialize()).serialize().appliedCorruptItemIds).toEqual(['corrupt-sidearm']);
  });

  it('uses reroll and floor-entry affixes at most once per floor, then resets on descent', () => {
    const lucky = { id: 'lucky-sidearm', category: 'weapon', baseType: 'sidearm', rarity: 'custom', affixes: ['lucky'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
    const shield = { id: 'shielding-armor', category: 'armor', baseType: 'light', rarity: 'custom', affixes: ['shielding'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
    let current = equipItem(state([lucky, shield]), 'operator', 'weapon', lucky.id).runState;
    current = equipItem(current, 'operator', 'armor', shield.id).runState;
    const reroll = useAffixReroll(current, lucky.id, affixesData);
    expect(reroll.success).toBe(true);
    expect(useAffixReroll(reroll.runState, lucky.id, affixesData)).toMatchObject({ success: false, reason: 'already_used' });
    const entered = applyFloorEntryAffixes(reroll.runState, affixesData);
    expect(entered.applied).toEqual([{ characterId: 'operator', itemId: shield.id, conditionId: 'shielded' }]);
    expect(applyFloorEntryAffixes(entered.runState, affixesData).applied).toEqual([]);
    entered.runState.advanceFloor();
    expect(applyFloorEntryAffixes(entered.runState, affixesData).applied).toHaveLength(1);
  });
});

describe('item display resolvers', () => {
  it('resolves explicit names, category catalog names, and prettified fallbacks', () => {
    expect(itemDisplayName({ name: 'Named' }, fullData)).toBe('Named');
    expect(itemDisplayName({ category: 'weapon', baseType: 'sidearm' }, fullData)).toBe('Sidearm');
    expect(itemDisplayName({ category: 'armor', baseType: 'medium' }, fullData)).toBe('Medium Armor');
    expect(itemDisplayName({ category: 'consumable', baseType: 'repair_patch' }, fullData)).toBe('Repair Patch');
    expect(itemDisplayName({ id: 'breacher-1-weapon-sidearm', category: 'weapon', baseType: 'sidearm' }, fullData)).toBe('Sidearm');
    expect(itemDisplayName({ category: 'weapon', baseType: 'heavy_melee' }, {})).toBe('Heavy Melee');
    expect(itemDisplayName({ category: 'weapon', baseType: 'phantom_thing' }, fullData)).toBe('Phantom Thing');
    expect(itemDisplayName({ id: 'loose-id' }, fullData)).toBe('Id');
    expect(itemDisplayName(null)).toBe('');
    expect(itemDisplayName({ category: 'weapon', baseType: 'sidearm' }, {})).toBe('Sidearm');
  });

  it('describes weapons, armor, consumables with affixes, corruption, and scrap', () => {
    expect(describeItem({ category: 'weapon', baseType: 'sidearm', salvageValue: 1 }, fullData)).toBe('d6 dmg · adjacent range · +1 acc · scrap 1');
    expect(describeItem({ category: 'armor', baseType: 'medium', salvageValue: 2 }, fullData)).toBe('+3 DEF · FIN -1 · scrap 2');
    expect(describeItem({ category: 'consumable', baseType: 'repair_patch', salvageValue: 1 }, fullData)).toBe('Restore d6 HP to one character. · scrap 1');
    expect(describeItem({ category: 'weapon', baseType: 'sidearm', affixes: ['reinforced'], salvageValue: 1 }, fullData)).toContain('Reinforced: +1 to core stat');
    expect(describeItem({ category: 'weapon', baseType: 'sidearm', affixes: [{ id: 'precise', name: 'Precise', effect: '+1 accuracy bonus' }], salvageValue: 1 }, fullData)).toContain('Precise: +1 accuracy bonus');
    expect(describeItem({ category: 'weapon', baseType: 'sidearm', corrupt: true, corruptionValue: 0.1, salvageValue: 1 }, fullData)).toContain('CORRUPT +0.10');
    expect(describeItem({ category: 'weapon', baseType: 'sidearm' }, {})).toBe('');
    expect(describeItem(null)).toBe('');
  });
});

describe('describeItemStats — render-time dice/stat chip resolver', () => {
  const ctx = { equipmentData, affixesData };

  it('resolves melee weapons with MGT attribute and no ↑ on a stock die', () => {
    expect(describeItemStats({ category: 'weapon', baseType: 'sidearm' }, ctx)).toEqual([
      'ATK d20+1+MGT',
      'DMG d6',
      'RANGE 1–1 · ADJACENT'
    ]);
    expect(describeItemStats({ category: 'weapon', baseType: 'heavy_melee' }, ctx)).toEqual([
      'ATK d20+MGT',
      'DMG d10',
      'RANGE 1–1 · ADJACENT'
    ]);
  });

  it('resolves ranged weapons with FIN attribute', () => {
    expect(describeItemStats({ category: 'weapon', baseType: 'light_ranged' }, ctx)).toEqual([
      'ATK d20+1+FIN',
      'DMG d6',
      'RANGE 1–4 · SHORT'
    ]);
    expect(describeItemStats({ category: 'weapon', baseType: 'heavy_ranged' }, ctx)).toEqual([
      'ATK d20+FIN',
      'DMG d10',
      'RANGE 1–8 · MEDIUM'
    ]);
  });

  it('marks affix die-upgrade with ↑ and shows the upgraded die', () => {
    const chips = describeItemStats({ category: 'weapon', baseType: 'sidearm', affixes: ['edged'] }, ctx);
    expect(chips).toContain('DMG d8↑');
    // Edged is die-upgrade only; accuracy chip stays unchanged.
    expect(chips[0]).toBe('ATK d20+1+MGT');
  });

  it('folds affix accuracy and extended range into the same chips', () => {
    const chips = describeItemStats({ category: 'weapon', baseType: 'light_ranged', affixes: ['precise', 'extended'] }, ctx);
    expect(chips).toEqual([
      'ATK d20+2+FIN',
      'DMG d6',
      'RANGE 1–6 · SHORT'
    ]);
  });

  it('renders sniper minimum-range phrasing with MIN suffix and negative accuracy', () => {
    expect(describeItemStats({ category: 'weapon', baseType: 'sniper' }, ctx)).toEqual([
      'ATK d20-1+FIN',
      'DMG d8',
      'RANGE 3–16 · LONG (MIN 3)'
    ]);
  });

  it('resolves armor DEF, FIN penalty, and CHG bonuses', () => {
    expect(describeItemStats({ category: 'armor', baseType: 'medium' }, ctx)).toEqual([
      'DEF +3',
      'FIN -1'
    ]);
    expect(describeItemStats({ category: 'armor', baseType: 'heavy', affixes: ['overcharged', 'resonant'] }, ctx)).toEqual([
      'DEF +5',
      'FIN -2',
      'CHG +2 MAX · +1 REGEN'
    ]);
  });

  it('omits the FIN chip when the phasing affix ignores the penalty', () => {
    const chips = describeItemStats({ category: 'armor', baseType: 'heavy', affixes: ['phasing'] }, ctx);
    expect(chips).toContain('DEF +5');
    expect(chips.some((chip) => chip.startsWith('FIN'))).toBe(false);
  });

  it('renders shields (weapons with no die but defense bonus) as DEF-only', () => {
    expect(describeItemStats({ category: 'weapon', baseType: 'shield' }, ctx)).toEqual(['DEF +2']);
  });

  it('returns [] for consumables, missing catalog entries, and malformed items', () => {
    expect(describeItemStats({ category: 'consumable', baseType: 'repair_patch' }, ctx)).toEqual([]);
    expect(describeItemStats({ category: 'weapon', baseType: 'phantom_thing' }, ctx)).toEqual([]);
    expect(describeItemStats({ category: 'weapon' }, ctx)).toEqual([]);
    expect(describeItemStats(null, ctx)).toEqual([]);
    expect(describeItemStats({ category: 'weapon', baseType: 'sidearm' }, {})).toEqual([]);
  });
});
