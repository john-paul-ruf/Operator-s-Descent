import { describe, expect, it } from 'vitest';
import { generateLoot } from '../../src/rules/loot.js';
import { loadData } from '../helpers/data.js';

const equipmentData = loadData('equipment');
const affixesData = loadData('affixes');
const consumablesData = loadData('consumables');
const noBias = { containerDensity: 1, rarityShift: 0, affixPoolBias: {} };

// v7 strips `rarityTier` from the emitted item shape (added ~30 chars per
// item on the wire — see src/rules/loot.js). Consumers derive it locally
// from `rarity`; the helper below keeps every test that predicated on
// rarityTier(item) working without a per-assertion rewrite.
const RARITY_ORDER = ['stock', 'tuned', 'custom', 'prototype', 'corrupt'];
const rarityTier = (item) => RARITY_ORDER.indexOf(item.rarity);

function loot(depth, seed = 42, options = {}) {
  return generateLoot(seed, depth, `floor-${depth}`, `container-${seed}`, noBias, equipmentData, affixesData, consumablesData, options);
}

function gather(depth, options = {}) {
  return Array.from({ length: 300 }, (_, seed) => loot(depth, seed + 1, options)).flat();
}

describe('generateLoot', () => {
  it('is deterministic and gives every item a stable ID derived from every location input', () => {
    const first = generateLoot(42, 10, 'floor-a', 'container-a', noBias, equipmentData, affixesData, consumablesData);
    expect(first).toEqual(generateLoot(42, 10, 'floor-a', 'container-a', noBias, equipmentData, affixesData, consumablesData));
    expect(first.map((item) => item.id)).not.toEqual(generateLoot(42, 10, 'floor-b', 'container-a', noBias, equipmentData, affixesData, consumablesData).map((item) => item.id));
    // v7 short id: `l<hash-base36>-<idx%8>` ≤ 9 chars (was `loot-<hash>-<idx>`).
    // See src/rules/loot.js — determinism inputs unchanged, only the string
    // form shrank. Legacy long ids remain valid at the codec (≤96 char bound).
    expect(first.every((item) => /^l[a-z0-9]+-\d$/.test(item.id))).toBe(true);
  });

  it('enforces standard and vault rarity gates without allowing theme bias to bypass them', () => {
    expect(gather(4).some((item) => rarityTier(item) > 1)).toBe(false);
    expect(gather(9).filter((item) => item.category !== 'consumable').some((item) => rarityTier(item) === 2)).toBe(true);
    expect(gather(9).some((item) => rarityTier(item) >= 3)).toBe(false);
    expect(gather(19).some((item) => rarityTier(item) === 4)).toBe(false);
    expect(gather(10, { containerType: 'vault' }).some((item) => rarityTier(item) === 4)).toBe(true);
    const overwhelmingBias = { containerDensity: 1, rarityShift: 99, affixPoolBias: {} };
    const shallow = generateLoot(42, 1, 'floor-1', 'container-1', overwhelmingBias, equipmentData, affixesData, consumablesData);
    expect(shallow.every((item) => rarityTier(item) <= 1)).toBe(true);
  });

  it('creates exact affix counts, IDs only, and three unique major affixes for CORRUPT equipment', () => {
    for (const item of [...gather(10), ...gather(25)]) {
      if (item.category === 'consumable') continue;
      const affixes = item.affixes.map((id) => affixesData.affixes[id]);
      expect(affixes.every((affix) => affix && (affix.category === 'universal' || affix.category === item.category))).toBe(true);
      expect(new Set(item.affixes).size).toBe(item.affixes.length);
      const expected = { 0: [0, 0], 1: [0, 1], 2: [1, 1], 3: [2, 1], 4: [3, 0] }[rarityTier(item)];
      expect([affixes.filter((affix) => affix.class === 'major').length, affixes.filter((affix) => affix.class === 'minor').length]).toEqual(expected);
      if (item.corrupt) {
        expect(item).toMatchObject({ rarity: 'corrupt', corruptionValue: 0.1 });
        expect(item.affixes).toHaveLength(3);
      }
    }
  });

  it('honors consumable minimum depth and keeps consumables unmodified and supplementary', () => {
    const shallow = gather(1);
    const deep = gather(10);
    const shallowConsumables = shallow.filter((item) => item.category === 'consumable');
    expect(shallowConsumables.every((item) => ['repair_patch', 'charge_cell'].includes(item.baseType) && item.rarity === 'stock' && item.affixes.length === 0 && !item.corrupt)).toBe(true);
    expect(deep.some((item) => item.baseType === 'boost_cell')).toBe(true);
    expect(shallowConsumables.length).toBeLessThan(shallow.filter((item) => item.category !== 'consumable').length);
  });

  it('applies deterministic theme density, category, rarity, and affix weighting', () => {
    const bias = { containerDensity: 3, rarityShift: 0, categoryWeights: { weapon: 0, armor: 1, consumable: 0 }, affixPoolBias: { fortified: 100 } };
    const items = generateLoot(99, 10, 'floor', 'container', bias, equipmentData, affixesData, consumablesData);
    expect(items).toHaveLength(6);
    expect(items.every((item) => item.category === 'armor')).toBe(true);
    expect(items.filter((item) => item.affixes.includes('fortified')).length).toBeGreaterThan(0);
  });
});
