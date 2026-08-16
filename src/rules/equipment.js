import { deserializeRunState } from '../state/run-state.js';

const DIE_STEPS = ['d4', 'd6', 'd8', 'd10', 'd12'];

function upgradeDie(die) {
  const index = DIE_STEPS.indexOf(die);
  return index < 0 ? die : DIE_STEPS[Math.min(DIE_STEPS.length - 1, index + 1)];
}

function resolveAffixes(affixes, affixesData) {
  return (affixes ?? []).map((affix) => typeof affix === 'string' ? { id: affix, ...(affixesData?.affixes?.[affix] ?? {}) } : affix).filter((affix) => affix?.id && affix.effectData);
}

export function getAffixHooks(affixes = [], affixesData) {
  const hooks = {
    attack: { accuracyBonus: 0, ignoreCover: false },
    damage: { dieUpgrades: 0, protocolBonus: 0 },
    onHit: { healing: 0, conditions: [] },
    floorEntry: { shielded: false },
    charge: { maxBonus: 0, regenBonus: 0 },
    defense: { bonus: 0, finPenaltyReduction: 0, ignoreFinPenalty: false },
    reroll: { perFloor: 0 }
  };
  for (const affix of resolveAffixes(affixes, affixesData)) {
    const effect = affix.effectData;
    hooks.attack.accuracyBonus += effect.accuracyBonus ?? effect.weaponAccuracyBonus ?? 0;
    hooks.attack.ignoreCover ||= effect.ignoreCover === true;
    hooks.damage.dieUpgrades += effect.dieUpgrade ? 1 : 0;
    hooks.damage.protocolBonus += effect.protocolDamageBonus ?? 0;
    hooks.onHit.healing += effect.healOnHit ?? 0;
    if (effect.conditionOnCrit) hooks.onHit.conditions.push({ conditionId: effect.conditionOnCrit, trigger: 'critical' });
    if (effect.conditionOnHit) hooks.onHit.conditions.push({ conditionId: effect.conditionOnHit, trigger: 'hit', chance: effect.conditionChance ?? 1, save: effect.save ?? null });
    hooks.floorEntry.shielded ||= effect.shieldOnFloorEntry === true;
    hooks.charge.maxBonus += effect.chargeBonus ?? 0;
    hooks.charge.regenBonus += effect.chargeRegenBonus ?? 0;
    hooks.defense.bonus += effect.defenseBonus ?? effect.armorDefenseBonus ?? 0;
    hooks.defense.finPenaltyReduction += effect.finPenaltyReduction ?? 0;
    hooks.defense.ignoreFinPenalty ||= effect.ignoreFinPenalty === true;
    hooks.reroll.perFloor += effect.rerollPerFloor ?? 0;
  }
  return hooks;
}

export function resolveWeaponStats(baseWeapon = {}, affixes = [], affixesData) {
  const hooks = getAffixHooks(affixes, affixesData);
  let damageDie = baseWeapon.damageDie ?? null;
  for (let index = 0; index < hooks.damage.dieUpgrades; index++) damageDie = upgradeDie(damageDie);
  return {
    id: baseWeapon.id,
    damageDie,
    rangeBand: baseWeapon.rangeBand ?? null,
    minRange: baseWeapon.minRange ?? 1,
    maxRange: (baseWeapon.maxRange ?? 0) + resolveAffixes(affixes, affixesData).reduce((sum, affix) => sum + (affix.effectData.rangeBonus ?? 0), 0),
    accuracyBonus: (baseWeapon.accuracyBonus ?? 0) + hooks.attack.accuracyBonus,
    defenseBonus: (baseWeapon.defenseBonus ?? 0) + hooks.defense.bonus,
    affixes: resolveAffixes(affixes, affixesData).map((affix) => affix.id),
    effects: hooks
  };
}

export function resolveArmorStats(baseArmor = {}, affixes = [], affixesData) {
  const hooks = getAffixHooks(affixes, affixesData);
  return {
    id: baseArmor.id,
    defenseBonus: (baseArmor.defenseBonus ?? 0) + hooks.defense.bonus,
    finPenalty: hooks.defense.ignoreFinPenalty ? 0 : Math.min(0, (baseArmor.finPenalty ?? 0) + hooks.defense.finPenaltyReduction),
    chargeBonus: hooks.charge.maxBonus,
    chargeRegenBonus: hooks.charge.regenBonus,
    ignoreFinPenalty: hooks.defense.ignoreFinPenalty,
    affixes: resolveAffixes(affixes, affixesData).map((affix) => affix.id),
    effects: hooks
  };
}

function equipped(character, key, catalog, affixesData) {
  const source = character?.equipment?.[key] ?? character?.[key];
  const item = typeof source === 'string' && catalog?.[source] ? { id: source, ...catalog[source] } : source;
  if (!item) return null;
  const affixes = item.affixes ?? character?.equipment?.[`${key}Affixes`] ?? [];
  return key === 'armor' ? resolveArmorStats(item, affixes, affixesData) : resolveWeaponStats(item, affixes, affixesData);
}

export function resolveLoadout(character, equipmentData, affixesData) {
  const weapon = equipped(character, 'weapon', equipmentData?.weapons, affixesData);
  const armor = equipped(character, 'armor', equipmentData?.armor, affixesData);
  const offhand = equipped(character, 'offhand', equipmentData?.weapons, affixesData);
  return { weapon, armor, offhand, defenseBonus: (armor?.defenseBonus ?? 0) + (offhand?.defenseBonus ?? 0) };
}

export function evaluateRange(weaponStats, distance) {
  if (!Number.isInteger(distance) || distance < 1) return { legal: false, band: null, accuracyModifier: 0, reason: 'invalid_distance' };
  if (!weaponStats?.rangeBand || weaponStats.maxRange < 1) return { legal: false, band: null, accuracyModifier: 0, reason: 'not_a_weapon' };
  if (distance > weaponStats.maxRange) return { legal: false, band: weaponStats.rangeBand, accuracyModifier: 0, reason: 'beyond_maximum' };
  const isSniper = weaponStats.rangeBand === 'long' && weaponStats.minRange > 1;
  const accuracyModifier = weaponStats.accuracyBonus + (isSniper && distance >= weaponStats.minRange ? 2 : 0);
  return { legal: true, band: weaponStats.rangeBand, accuracyModifier, reason: isSniper && distance < weaponStats.minRange ? 'minimum_range_penalty' : 'in_range' };
}

export function getRangeBand(weapon, distance) {
  const range = evaluateRange(weapon, distance);
  if (!range.legal) return range.reason === 'invalid_distance' || range.reason === 'beyond_maximum' ? 'out-of-range' : range.reason;
  if (distance <= 1 && weapon.minRange === 0) return 'point-blank';
  return range.reason === 'minimum_range_penalty' ? 'too-close' : range.band;
}

export function getCoverBonus(lattice, targetX, targetY, attackerX, attackerY) {
  const dx = Math.abs(targetX - attackerX);
  const dy = Math.abs(targetY - attackerY);
  const sx = Math.sign(targetX - attackerX);
  const sy = Math.sign(targetY - attackerY);
  const steps = Math.max(dx, dy);
  if (steps <= 1) return 0;
  let coverCells = 0;
  for (let index = 1; index < steps; index++) if (lattice[Math.round(attackerY + sy * (dy / steps) * index)]?.[Math.round(attackerX + sx * (dx / steps) * index)] === 'wall') coverCells++;
  return coverCells >= 2 ? 4 : coverCells === 1 ? 2 : 0;
}

function cloneState(runState) {
  const state = deserializeRunState(typeof runState?.serialize === 'function' ? runState.serialize() : runState);
  return state ?? null;
}

function inventoryUnits(inventory) {
  return inventory.reduce((total, item) => total + (item.count ?? 1), 0);
}

function itemForEquip(state, item) {
  return typeof item === 'string' ? state.inventory.find((entry) => entry.id === item) : item;
}

export function equipItem(runState, characterId, slot, item) {
  const state = cloneState(runState);
  const character = state?.party.find((entry) => entry.id === characterId);
  const selected = itemForEquip(state, item);
  if (!state || !character || !['weapon', 'armor', 'offhand'].includes(slot) || !selected || (slot === 'armor' ? selected.category !== 'armor' : selected.category !== 'weapon')) return { success: false, reason: 'invalid_equip', runState };
  const isNewImplant = selected.corrupt && !state.appliedCorruptItemIds.includes(selected.id);
  if (isNewImplant && !state.applyCorruptImplant(selected.id, selected.corruptionValue)) return { success: false, reason: 'invalid_corrupt_item', runState };
  const inventoryIndex = state.inventory.findIndex((entry) => entry.id === selected.id);
  if (inventoryIndex >= 0) state.inventory.splice(inventoryIndex, 1);
  const replaced = character.equipment[slot];
  character.equipment[slot] = structuredClone(selected);
  if (replaced) state.inventory.push(replaced);
  state.stats.corruptItemsEquipped += isNewImplant ? 1 : 0;
  return { success: true, runState: state, corruptionAdded: isNewImplant ? selected.corruptionValue : 0, replacedItem: replaced ?? null };
}

export function unequipItem(runState, characterId, slot) {
  const state = cloneState(runState);
  const character = state?.party.find((entry) => entry.id === characterId);
  const item = character?.equipment?.[slot];
  if (!state || !character || !['weapon', 'armor', 'offhand'].includes(slot) || !item) return { success: false, reason: 'invalid_unequip', runState };
  if (inventoryUnits(state.inventory) + (item.count ?? 1) > 100) return { success: false, reason: 'inventory_full', runState };
  character.equipment[slot] = null;
  state.inventory.push(structuredClone(item));
  return { success: true, runState: state, item: structuredClone(item) };
}

export function useAffixReroll(runState, itemId, affixesData) {
  const state = cloneState(runState);
  const item = state?.party.flatMap((character) => Object.values(character.equipment)).find((entry) => entry?.id === itemId);
  if (!state || !item || getAffixHooks(item.affixes, affixesData).reroll.perFloor < 1) return { success: false, reason: 'no_reroll', runState };
  const claim = state.claimAffixUse('reroll', itemId);
  return claim.claimed ? { success: true, runState: state } : { success: false, reason: claim.reason, runState };
}

export function applyFloorEntryAffixes(runState, affixesData) {
  const state = cloneState(runState);
  if (!state) return { success: false, reason: 'invalid_run_state', runState };
  const applied = [];
  for (const character of state.party) {
    for (const item of Object.values(character.equipment)) {
      if (!item || !getAffixHooks(item.affixes, affixesData).floorEntry.shielded) continue;
      if (!state.claimAffixUse('floor_entry', item.id).claimed) continue;
      const existing = character.conditions.find((condition) => condition.conditionId === 'shielded');
      if (existing) existing.duration = Math.max(existing.duration, 3);
      else character.conditions.push({ conditionId: 'shielded', duration: 3 });
      applied.push({ characterId: character.id, itemId: item.id, conditionId: 'shielded' });
    }
  }
  return { success: true, runState: state, applied };
}

export function getSalvageValue(item) {
  return item?.salvageValue || 0;
}

function prettifyBaseType(value) {
  return String(value).split(/[_-]/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function inferredBaseType(item) {
  if (item?.baseType) return item.baseType;
  if (typeof item?.id !== 'string') return null;
  const trailing = item.id.split('-').pop();
  return trailing || null;
}

function catalogFor(category, data) {
  if (category === 'weapon') return data?.equipment?.weapons || null;
  if (category === 'armor') return data?.equipment?.armor || null;
  if (category === 'consumable') return data?.consumables?.consumables || null;
  return null;
}

export function itemDisplayName(item, data) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.name === 'string' && item.name) return item.name;
  const baseType = inferredBaseType(item);
  const catalog = catalogFor(item.category, data);
  const catalogName = baseType ? catalog?.[baseType]?.name : null;
  if (catalogName) return catalogName;
  if (baseType) return prettifyBaseType(baseType);
  return item.id || '';
}

function formatAcc(bonus) {
  return `${bonus >= 0 ? '+' : ''}${bonus} acc`;
}

function weaponDetails(base) {
  const pieces = [];
  if (base?.damageDie) pieces.push(`${base.damageDie} dmg`);
  if (base?.rangeBand) pieces.push(`${base.rangeBand} range`);
  if (Number.isFinite(base?.accuracyBonus)) pieces.push(formatAcc(base.accuracyBonus));
  return pieces;
}

function armorDetails(base) {
  const pieces = [];
  if (Number.isFinite(base?.defenseBonus)) pieces.push(`+${base.defenseBonus} DEF`);
  if (Number.isFinite(base?.finPenalty) && base.finPenalty !== 0) pieces.push(`FIN ${base.finPenalty}`);
  return pieces;
}

function affixDetails(affixes, data) {
  const pieces = [];
  for (const affix of affixes || []) {
    if (!affix) continue;
    if (typeof affix === 'string') {
      const entry = data?.affixes?.affixes?.[affix];
      const name = entry?.name || affix;
      pieces.push(entry?.effect ? `${name}: ${entry.effect}` : name);
    } else {
      const entry = affix.id ? data?.affixes?.affixes?.[affix.id] : null;
      const name = affix.name || entry?.name || affix.id;
      const effect = affix.effect || entry?.effect;
      if (!name) continue;
      pieces.push(effect ? `${name}: ${effect}` : name);
    }
  }
  return pieces;
}

export function describeItem(item, data) {
  if (!item || typeof item !== 'object') return '';
  const baseType = inferredBaseType(item);
  const category = item.category;
  const catalog = catalogFor(category, data);
  const base = baseType ? catalog?.[baseType] : null;
  const pieces = [];
  if (category === 'weapon') pieces.push(...weaponDetails(base));
  else if (category === 'armor') pieces.push(...armorDetails(base));
  else if (category === 'consumable' && base?.effect) pieces.push(base.effect);
  pieces.push(...affixDetails(item.affixes, data));
  if (item.corrupt) pieces.push(`CORRUPT +${Number(item.corruptionValue || 0).toFixed(2)}`);
  const salvage = getSalvageValue(item);
  if (salvage > 0) pieces.push(`scrap ${salvage}`);
  return pieces.join(' · ');
}
