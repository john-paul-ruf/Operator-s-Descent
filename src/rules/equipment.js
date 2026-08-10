const DIE_STEPS = ['d4', 'd6', 'd8', 'd10', 'd12'];

function upgradeDie(die) {
  const index = DIE_STEPS.indexOf(die);
  return index < 0 ? die : DIE_STEPS[Math.min(DIE_STEPS.length - 1, index + 1)];
}

function resolveAffixes(affixes, affixesData) {
  return (affixes || []).map((affix) => typeof affix === 'string' ? { id: affix, ...(affixesData?.affixes?.[affix] || {}) } : affix).filter((affix) => affix?.id);
}

export function resolveWeaponStats(baseWeapon = {}, affixes = [], affixesData) {
  const resolvedAffixes = resolveAffixes(affixes, affixesData);
  const stats = {
    id: baseWeapon.id,
    damageDie: baseWeapon.damageDie ?? null,
    rangeBand: baseWeapon.rangeBand ?? null,
    minRange: baseWeapon.minRange ?? 1,
    maxRange: baseWeapon.maxRange ?? 0,
    accuracyBonus: baseWeapon.accuracyBonus ?? 0,
    defenseBonus: baseWeapon.defenseBonus ?? 0,
    affixes: resolvedAffixes.map((affix) => affix.id),
    effects: {}
  };
  for (const affix of resolvedAffixes) {
    const effect = affix.effectData || {};
    if (effect.dieUpgrade) stats.damageDie = upgradeDie(stats.damageDie);
    stats.accuracyBonus += effect.accuracyBonus || effect.weaponAccuracyBonus || 0;
    stats.maxRange += effect.rangeBonus || 0;
    stats.defenseBonus += effect.defenseBonus || 0;
    for (const [key, value] of Object.entries(effect)) {
      if (!['dieUpgrade', 'accuracyBonus', 'weaponAccuracyBonus', 'rangeBonus', 'defenseBonus'].includes(key)) stats.effects[key] = value;
    }
  }
  return stats;
}

export function resolveArmorStats(baseArmor = {}, affixes = [], affixesData) {
  const resolvedAffixes = resolveAffixes(affixes, affixesData);
  const stats = {
    id: baseArmor.id,
    defenseBonus: baseArmor.defenseBonus ?? 0,
    finPenalty: baseArmor.finPenalty ?? 0,
    chargeBonus: 0,
    chargeRegenBonus: 0,
    ignoreFinPenalty: false,
    affixes: resolvedAffixes.map((affix) => affix.id),
    effects: {}
  };
  for (const affix of resolvedAffixes) {
    const effect = affix.effectData || {};
    stats.defenseBonus += effect.defenseBonus || effect.armorDefenseBonus || 0;
    stats.chargeBonus += effect.chargeBonus || 0;
    stats.chargeRegenBonus += effect.chargeRegenBonus || 0;
    stats.finPenalty = Math.min(0, stats.finPenalty + (effect.finPenaltyReduction || 0));
    stats.ignoreFinPenalty ||= effect.ignoreFinPenalty === true;
    for (const [key, value] of Object.entries(effect)) {
      if (!['defenseBonus', 'armorDefenseBonus', 'chargeBonus', 'chargeRegenBonus', 'finPenaltyReduction', 'ignoreFinPenalty', 'minFinPenalty'].includes(key)) stats.effects[key] = value;
    }
  }
  return stats;
}

function equipped(character, key, catalog, affixesData) {
  const source = character?.equipment?.[key] ?? character?.[key];
  const item = typeof source === 'string' && catalog?.[source] ? { id: source, ...catalog[source] } : source;
  if (!item) return null;
  const affixes = item.affixes || character?.equipment?.[`${key}Affixes`] || [];
  return key === 'armor' ? resolveArmorStats(item, affixes, affixesData) : resolveWeaponStats(item, affixes, affixesData);
}

export function resolveLoadout(character, equipmentData, affixesData) {
  const weapon = equipped(character, 'weapon', equipmentData?.weapons, affixesData);
  const armor = equipped(character, 'armor', equipmentData?.armor, affixesData);
  const offhand = equipped(character, 'offhand', equipmentData?.weapons, affixesData);
  return { weapon, armor, offhand, defenseBonus: (armor?.defenseBonus || 0) + (offhand?.defenseBonus || 0) };
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
  for (let index = 1; index < steps; index++) {
    const x = Math.round(attackerX + sx * (dx / steps) * index);
    const y = Math.round(attackerY + sy * (dy / steps) * index);
    if (lattice[y] && lattice[y][x] === 'wall') coverCells++;
  }
  return coverCells >= 2 ? 4 : coverCells === 1 ? 2 : 0;
}

export function getSalvageValue(item) {
  return item?.salvageValue || 0;
}
