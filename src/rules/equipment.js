const DIE_STEPS = ['d4', 'd6', 'd8', 'd10', 'd12'];

function upgradeDie(die, steps) {
  const idx = DIE_STEPS.indexOf(die);
  if (idx === -1) return die;
  const newIdx = Math.min(DIE_STEPS.length - 1, idx + steps);
  return DIE_STEPS[newIdx];
}

function upgradeRange(baseRange, bonus) {
  return baseRange + bonus;
}

export function resolveWeaponStats(baseWeapon, affixes) {
  let stats = {
    damageDie: baseWeapon.damageDie,
    rangeBand: baseWeapon.rangeBand,
    maxRange: baseWeapon.maxRange || 0,
    minRange: baseWeapon.minRange || 0,
    accuracyBonus: baseWeapon.accuracyBonus || 0,
    affixes: (affixes || []).map(a => a.id),
    defenseBonus: baseWeapon.defenseBonus || 0
  };

  for (const affix of affixes || []) {
    const d = affix.effectData || {};
    if (affix.id === 'edged' && d.dieUpgrade) {
      stats.damageDie = upgradeDie(stats.damageDie, 1);
    }
    if (d.accuracyBonus) stats.accuracyBonus += d.accuracyBonus;
    if (d.rangeBonus) stats.maxRange = upgradeRange(stats.maxRange, d.rangeBonus);
    if (d.defenseBonus) stats.defenseBonus += d.defenseBonus;
  }
  return stats;
}

export function resolveArmorStats(baseArmor, affixes) {
  let stats = {
    defenseBonus: baseArmor.defenseBonus,
    finPenalty: baseArmor.finPenalty,
    affixes: (affixes || []).map(a => a.id)
  };

  for (const affix of affixes || []) {
    const d = affix.effectData || {};
    if (d.defenseBonus) stats.defenseBonus += d.defenseBonus;
    if (d.finPenaltyReduction) {
      stats.finPenalty = Math.min(0, stats.finPenalty + d.finPenaltyReduction);
    }
    if (affix.id === 'lightweight') {
      stats.finPenalty = Math.min(0, stats.finPenalty + 1);
    }
  }
  return stats;
}

export function getRangeBand(weapon, distance) {
  if (distance < 0) return 'out-of-range';
  const minRange = weapon.minRange || 0;
  const maxRange = weapon.maxRange || 0;
  if (distance > maxRange) return 'out-of-range';
  if (weapon.rangeBand === 'long' && distance < minRange) return 'too-close';
  if (distance <= 1) return 'point-blank';
  return weapon.rangeBand;
}

export function getCoverBonus(lattice, targetX, targetY, attackerX, attackerY) {
  const dx = Math.abs(targetX - attackerX);
  const dy = Math.abs(targetY - attackerY);
  const sx = Math.sign(targetX - attackerX);
  const sy = Math.sign(targetY - attackerY);
  const steps = Math.max(dx, dy);
  if (steps <= 1) return 0;

  let coverCells = 0;
  for (let i = 1; i < steps; i++) {
    const x = Math.round(attackerX + sx * (dx / steps) * i);
    const y = Math.round(attackerY + sy * (dy / steps) * i);
    if (lattice[y] && lattice[y][x] === 'wall') {
      coverCells++;
    }
  }
  if (coverCells >= 2) return 4;
  if (coverCells === 1) return 2;
  return 0;
}

export function getSalvageValue(item) {
  return item.salvageValue || 0;
}