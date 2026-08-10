import { hash } from '../core/hash.js';
import { createPRNG } from '../core/prng.js';
import { lootRarityShift } from './scaling.js';

const RARITIES = ['stock', 'tuned', 'custom', 'prototype', 'corrupt'];

function rollRarity(prng, rarityShift, themeLootBias) {
  let baseRoll = prng.nextInt(100);
  baseRoll += (rarityShift * 10) + (themeLootBias?.rarityShift || 0) * 10;
  if (baseRoll >= 90) return 4;
  if (baseRoll >= 70) return 3;
  if (baseRoll >= 40) return 2;
  if (baseRoll >= 15) return 1;
  return 0;
}

function rollCategory(prng) {
  const r = prng.nextInt(100);
  if (r < 50) return 'weapon';
  if (r < 70) return 'armor';
  return 'consumable';
}

function getAffixesForRarity(rarity, prng, affixesData, category) {
  if (rarity === 0) return [];

  const allAffixes = Object.entries(affixesData.affixes).map(([id, a]) => ({ id, ...a }));
  const usable = allAffixes.filter(a =>
    a.category === 'universal' || a.category === category
  );

  const minor = usable.filter(a => a.class === 'minor');
  const major = usable.filter(a => a.class === 'major');

  const result = [];
  const pick = (pool) => pool.length > 0 ? pool[prng.nextInt(pool.length)] : null;

  if (rarity === 1) {
    const a = pick(minor);
    if (a) result.push({ id: a.id, name: a.name, effect: a.effect, effectData: a.effectData });
  } else if (rarity === 2) {
    const maj = pick(major);
    const min = pick(minor.filter(a => !result.find(r => r.id === maj?.id)));
    if (maj) result.push({ id: maj.id, name: maj.name, effect: maj.effect, effectData: maj.effectData });
    if (min) result.push({ id: min.id, name: min.name, effect: min.effect, effectData: min.effectData });
  } else if (rarity === 3) {
    for (let i = 0; i < 2; i++) {
      const m = pick(major.filter(a => !result.find(r => r.id === a.id)));
      if (m) result.push({ id: m.id, name: m.name, effect: m.effect, effectData: m.effectData });
    }
    const mi = pick(minor.filter(a => !result.find(r => r.id === a.id)));
    if (mi) result.push({ id: mi.id, name: mi.name, effect: mi.effect, effectData: mi.effectData });
  } else if (rarity === 4) {
    for (let i = 0; i < 3; i++) {
      const m = pick(major.filter(a => !result.find(r => r.id === a.id)));
      if (m) result.push({ id: m.id, name: m.name, effect: m.effect, effectData: m.effectData });
    }
  }
  return result;
}

export function generateLoot(worldSeed, depth, floorId, containerId, themeLootBias, equipmentData, affixesData, consumablesData) {
  const seed = hash(worldSeed, depth, floorId, containerId);
  const prng = createPRNG(seed);
  const rarityShift = lootRarityShift(depth);

  const densityMult = themeLootBias?.containerDensity || 1.0;
  const count = Math.max(1, Math.floor((1 + prng.nextInt(3)) * densityMult));

  const items = [];
  for (let i = 0; i < count; i++) {
    const rarity = rollRarity(prng, rarityShift, themeLootBias);
    const category = rollCategory(prng);
    const corrupt = rarity === 4;

    let baseType = null;
    let salvageValue = 1;

    if (category === 'weapon') {
      const weaponIds = Object.keys(equipmentData.weapons).filter(w => w !== 'shield');
      baseType = weaponIds[prng.nextInt(weaponIds.length)];
      salvageValue = equipmentData.weapons[baseType]?.salvageValue || 1;
    } else if (category === 'armor') {
      const armorIds = Object.keys(equipmentData.armor).filter(a => a !== 'none');
      baseType = armorIds[prng.nextInt(armorIds.length)];
      salvageValue = equipmentData.armor[baseType]?.salvageValue || 1;
    } else {
      const consumableIds = Object.keys(consumablesData.consumables);
      baseType = consumableIds[prng.nextInt(consumableIds.length)];
      salvageValue = consumablesData.consumables[baseType]?.salvageValue || 1;
    }

    const affixes = category !== 'consumable' ? getAffixesForRarity(rarity, prng, affixesData, category) : [];

    items.push({
      id: `${containerId}_item_${i}`,
      category,
      baseType,
      rarity: RARITIES[rarity],
      rarityTier: rarity,
      affixes,
      corrupt,
      salvageValue
    });
  }
  return items;
}