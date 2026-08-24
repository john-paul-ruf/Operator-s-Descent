import { hash } from '../core/hash.js';
import { createPRNG } from '../core/prng.js';
import { lootRarityShift } from './scaling.js';

export const CORRUPT_IMPLANT_CORRUPTION = 0.1;

const RARITIES = ['stock', 'tuned', 'custom', 'prototype', 'corrupt'];
const CATEGORY_WEIGHTS = { weapon: 55, armor: 30, consumable: 15 };

function weightedPick(prng, entries) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return null;
  let roll = prng.next() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll < 0) return entry.value;
  }
  return entries.at(-1)?.value ?? null;
}

function maximumRarity(depth, isVault) {
  if (depth >= 20 || (isVault && depth >= 10)) return 4;
  if (depth >= 10) return 3;
  if (depth >= 5) return 2;
  return 1;
}

function rollRarity(prng, depth, bias, isVault) {
  const shift = lootRarityShift(depth) + Number(bias?.rarityShift ?? 0) + (isVault ? 1 : 0);
  const roll = prng.nextInt(100) + Math.floor(shift * 20);
  const rarity = roll >= 90 ? 4 : roll >= 70 ? 3 : roll >= 40 ? 2 : roll >= 15 ? 1 : 0;
  return Math.min(rarity, maximumRarity(depth, isVault));
}

function rollCategory(prng, bias) {
  const weights = bias?.categoryWeights ?? bias?.categoryBias ?? {};
  return weightedPick(prng, Object.entries(CATEGORY_WEIGHTS).map(([value, weight]) => ({ value, weight: weight * Math.max(0, Number(weights[value] ?? 1)) })));
}

function selectAffixes(rarity, prng, affixesData, category, bias) {
  const countByRarity = [[0, 0], [0, 1], [1, 1], [2, 1], [3, 0]];
  const [majorCount, minorCount] = countByRarity[rarity] ?? [0, 0];
  const eligible = Object.entries(affixesData?.affixes ?? {})
    .map(([id, affix]) => ({ id, ...affix }))
    .filter((affix) => affix.category === 'universal' || affix.category === category);
  const selected = [];
  const pick = (classification) => {
    const candidates = eligible
      .filter((affix) => affix.class === classification && !selected.includes(affix.id))
      .map((affix) => ({ value: affix.id, weight: Math.max(0, Number(bias?.affixPoolBias?.[affix.id] ?? 1)) }));
    const id = weightedPick(prng, candidates);
    if (id) selected.push(id);
  };
  for (let index = 0; index < majorCount; index++) pick('major');
  for (let index = 0; index < minorCount; index++) pick('minor');
  return selected;
}

function chooseBaseType(prng, category, depth, equipmentData, consumablesData) {
  if (category === 'weapon') return weightedPick(prng, Object.keys(equipmentData?.weapons ?? {}).filter((id) => id !== 'shield').map((value) => ({ value, weight: 1 })));
  if (category === 'armor') return weightedPick(prng, Object.keys(equipmentData?.armor ?? {}).filter((id) => id !== 'none').map((value) => ({ value, weight: 1 })));
  return weightedPick(prng, Object.entries(consumablesData?.consumables ?? {})
    .filter(([, consumable]) => depth >= consumable.minDepth)
    .map(([value]) => ({ value, weight: 1 })));
}

function salvageValue(category, baseType, equipmentData, consumablesData) {
  if (category === 'weapon') return equipmentData?.weapons?.[baseType]?.salvageValue ?? 0;
  if (category === 'armor') return equipmentData?.armor?.[baseType]?.salvageValue ?? 0;
  return consumablesData?.consumables?.[baseType]?.salvageValue ?? 0;
}

export function generateLoot(worldSeed, depth, floorId, containerId, themeLootBias, equipmentData, affixesData, consumablesData, options = {}) {
  const seed = hash(worldSeed, depth, floorId, containerId);
  const prng = createPRNG(seed);
  const isVault = options.containerType === 'vault' || options.kind === 'vault' || themeLootBias?.containerType === 'vault';
  const density = Math.max(0, Number(themeLootBias?.containerDensity ?? 1));
  const count = isVault
    ? Math.max(3, Math.floor((3 + prng.nextInt(3)) * Math.max(1, density)))
    : Math.max(1, Math.floor((1 + prng.nextInt(3)) * density));
  const items = [];
  for (let index = 0; index < count; index++) {
    const category = rollCategory(prng, themeLootBias);
    const baseType = chooseBaseType(prng, category, depth, equipmentData, consumablesData);
    if (!category || !baseType) continue;
    const isConsumable = category === 'consumable';
    const rarityTier = isConsumable ? 0 : rollRarity(prng, depth, themeLootBias, isVault);
    const corrupt = rarityTier === 4;
    items.push({
      // v7 short id: `l<hash-base36>-<i%8>` ≤ 9 chars. 31-bit hash truncation
      // yields at most 6 base36 chars (36^6 = 2.18B > 2^31 = 2.14B); the
      // index modulo 8 covers the typical container size while keeping the
      // suffix a single char. Same hash inputs as v6 — determinism preserved
      // (loot.test.js:23 asserts the /^l.../ shape). Legacy long ids (≤96
      // char bound in the codec) stay valid on the wire, so v6 saves
      // round-trip unchanged; only newly-generated loot shrinks.
      id: `l${(hash(worldSeed, depth, floorId, containerId, index) & 0x7fffffff).toString(36)}-${index % 8}`,
      category,
      baseType,
      rarity: RARITIES[rarityTier],
      // v7 no longer emits `rarityTier` as an item field — it is derivable
      // from `rarity` via RARITIES.indexOf(item.rarity). Persisting it
      // added ~30 chars per item on the wire (extensions.rarityTier key +
      // integer per item) because it flowed through normalizeItem into
      // extensions; consumers now derive on demand (tests updated in tree).
      affixes: isConsumable ? [] : selectAffixes(rarityTier, prng, affixesData, category, themeLootBias),
      corrupt,
      ...(corrupt ? { corruptionValue: CORRUPT_IMPLANT_CORRUPTION } : {}),
      salvageValue: salvageValue(category, baseType, equipmentData, consumablesData)
    });
  }
  return items;
}
