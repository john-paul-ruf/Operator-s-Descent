import { describe, it, expect } from 'vitest';
import { generateLoot } from '../../src/rules/loot.js';
import { lootRarityShift } from '../../src/rules/scaling.js';
import { loadData } from '../helpers/data.js';

const equipmentData = loadData('equipment');
const affixesData = loadData('affixes');
const consumablesData = loadData('consumables');
const RARITIES = ['stock', 'tuned', 'custom', 'prototype', 'corrupt'];
const noBias = { containerDensity: 1, rarityShift: 0, affixPoolBias: {} };

describe('generateLoot — determinism', () => {
  it('same args twice → deep equal', () => {
    const a = generateLoot(42, 1, 'floor_1', 'container_0', noBias, equipmentData, affixesData, consumablesData);
    const b = generateLoot(42, 1, 'floor_1', 'container_0', noBias, equipmentData, affixesData, consumablesData);
    expect(a).toEqual(b);
  });
  it('varying worldSeed changes result', () => {
    const a = generateLoot(42, 1, 'floor_1', 'container_0', noBias, equipmentData, affixesData, consumablesData);
    const b = generateLoot(99, 1, 'floor_1', 'container_0', noBias, equipmentData, affixesData, consumablesData);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
  it('varying depth changes result', () => {
    const a = generateLoot(42, 1, 'floor_1', 'container_0', noBias, equipmentData, affixesData, consumablesData);
    const b = generateLoot(42, 5, 'floor_1', 'container_0', noBias, equipmentData, affixesData, consumablesData);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
  it('varying containerId changes result', () => {
    const a = generateLoot(42, 1, 'floor_1', 'container_0', noBias, equipmentData, affixesData, consumablesData);
    const b = generateLoot(42, 1, 'floor_1', 'container_1', noBias, equipmentData, affixesData, consumablesData);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('generateLoot — structure', () => {
  const items = generateLoot(42, 1, 'floor_1', 'container_0', noBias, equipmentData, affixesData, consumablesData);
  it('count >= 1', () => {
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
  it('every item has correct id pattern', () => {
    for (let i = 0; i < items.length; i++) {
      expect(items[i].id).toBe(`container_0_item_${i}`);
    }
  });
  it('every item category is weapon/armor/consumable', () => {
    for (const item of items) {
      expect(['weapon', 'armor', 'consumable']).toContain(item.category);
    }
  });
  it('rarity string matches rarityTier via RARITIES', () => {
    for (const item of items) {
      expect(item.rarity).toBe(RARITIES[item.rarityTier]);
    }
  });
  it('corrupt === (rarityTier === 4)', () => {
    for (const item of items) {
      expect(item.corrupt).toBe(item.rarityTier === 4);
    }
  });
  it('salvageValue >= 1', () => {
    for (const item of items) {
      expect(item.salvageValue).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('generateLoot — baseType referential integrity', () => {
  function gatherItems(depth, count) {
    const all = [];
    for (let c = 0; c < count; c++) {
      all.push(...generateLoot(42, depth, `f_${depth}`, `c_${c}`, noBias, equipmentData, affixesData, consumablesData));
    }
    return all;
  }
  const allItems = gatherItems(1, 20);
  const weaponIds = Object.keys(equipmentData.weapons);
  const armorIds = Object.keys(equipmentData.armor);
  const consumableIds = Object.keys(consumablesData.consumables);

  it('weapon baseType in weapon ids and never shield', () => {
    for (const item of allItems.filter(i => i.category === 'weapon')) {
      expect(weaponIds).toContain(item.baseType);
      expect(item.baseType).not.toBe('shield');
    }
  });
  it('armor baseType never none', () => {
    for (const item of allItems.filter(i => i.category === 'armor')) {
      expect(armorIds).toContain(item.baseType);
      expect(item.baseType).not.toBe('none');
    }
  });
  it('consumable baseType in consumable ids', () => {
    for (const item of allItems.filter(i => i.category === 'consumable')) {
      expect(consumableIds).toContain(item.baseType);
    }
  });
});

describe('generateLoot — affixes', () => {
  function gatherManyItems() {
    const all = [];
    for (let depth = 1; depth <= 10; depth++) {
      for (let c = 0; c < 30; c++) {
        all.push(...generateLoot(42, depth, `f_${depth}`, `c_${c}`, noBias, equipmentData, affixesData, consumablesData));
      }
    }
    return all;
  }
  const allItems = gatherManyItems();

  it('consumable items always have empty affixes', () => {
    for (const item of allItems.filter(i => i.category === 'consumable')) {
      expect(item.affixes).toEqual([]);
    }
  });
  it('tier 0 items have 0 affixes', () => {
    for (const item of allItems.filter(i => i.rarityTier === 0)) {
      expect(item.affixes).toHaveLength(0);
    }
  });
  it('tier 1 items have exactly 1 minor affix', () => {
    for (const item of allItems.filter(i => i.rarityTier === 1 && i.category !== 'consumable')) {
      expect(item.affixes).toHaveLength(1);
    }
  });
  it('tier 2 items have <= 2 affixes', () => {
    for (const item of allItems.filter(i => i.rarityTier === 2 && i.category !== 'consumable')) {
      expect(item.affixes.length).toBeLessThanOrEqual(2);
    }
  });
  it('tier 3 items have <= 3 affixes', () => {
    for (const item of allItems.filter(i => i.rarityTier === 3 && i.category !== 'consumable')) {
      expect(item.affixes.length).toBeLessThanOrEqual(3);
    }
  });
  it('tier 4 items have <= 3 all-major affixes', () => {
    for (const item of allItems.filter(i => i.rarityTier === 4 && i.category !== 'consumable')) {
      expect(item.affixes.length).toBeLessThanOrEqual(3);
      for (const a of item.affixes) {
        const full = affixesData.affixes[a.id];
        expect(full.class).toBe('major');
      }
    }
  });
  it('no duplicate affix ids within one item', () => {
    for (const item of allItems) {
      const ids = item.affixes.map(a => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('every affix category is universal or matches item category', () => {
    for (const item of allItems) {
      for (const a of item.affixes) {
        const full = affixesData.affixes[a.id];
        expect(['universal', item.category]).toContain(full.category);
      }
    }
  });
});

describe('generateLoot — rarity shift saturation', () => {
  it('at depth 45, every item is corrupt (rarityTier === 4)', () => {
    expect(lootRarityShift(45)).toBe(9);
    for (let c = 0; c < 10; c++) {
      const items = generateLoot(42, 45, 'f_45', `c_${c}`, noBias, equipmentData, affixesData, consumablesData);
      for (const item of items) {
        expect(item.rarityTier).toBe(4);
        expect(item.corrupt).toBe(true);
      }
    }
  });
  it('themeLootBias rarityShift 9 at depth 1 → all corrupt', () => {
    const bias = { containerDensity: 1, rarityShift: 9, affixPoolBias: {} };
    for (let c = 0; c < 10; c++) {
      const items = generateLoot(42, 1, 'f_1', `c_${c}`, bias, equipmentData, affixesData, consumablesData);
      for (const item of items) {
        expect(item.rarityTier).toBe(4);
      }
    }
  });
});

describe('generateLoot — density', () => {
  it('density 3 → count in [3, 9]', () => {
    const bias = { containerDensity: 3, rarityShift: 0, affixPoolBias: {} };
    for (let c = 0; c < 20; c++) {
      const items = generateLoot(42, 1, 'f_1', `c_${c}`, bias, equipmentData, affixesData, consumablesData);
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeLessThanOrEqual(9);
    }
  });
  it('density 0.1 → clamps to >= 1', () => {
    const bias = { containerDensity: 0.1, rarityShift: 0, affixPoolBias: {} };
    for (let c = 0; c < 20; c++) {
      const items = generateLoot(42, 1, 'f_1', `c_${c}`, bias, equipmentData, affixesData, consumablesData);
      expect(items.length).toBeGreaterThanOrEqual(1);
    }
  });
});