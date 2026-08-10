export function modifier(rank) {
  return rank - 5;
}

export function deriveStats(character, classData) {
  const a = character.attributes;
  const calibCount = character.calibrationCount || 0;
  const calibHPGrowth = Math.max(2, Math.floor(classData.hitDieBase / 2));
  return {
    hpMax: (a.vit * 4) + classData.hitDieBase + calibCount * calibHPGrowth,
    chargeMax: (a.res * 3) + classData.chargeBase,
    chargeRegen: Math.floor(a.res / 3),
    defenseBase: 10 + modifier(a.fin),
    protocolDefenseBase: 10 + modifier(a.foc),
    initiativeMod: modifier(a.fin),
    meleeAccuracy: modifier(a.mgt),
    rangedAccuracy: modifier(a.fin),
    protocolAccuracy: modifier(a.foc),
    detectionRadius: a.sig * 2
  };
}

export function attributeCost(currentRank, targetRank) {
  let cost = 0;
  for (let r = currentRank + 1; r <= targetRank; r++) {
    if (r <= 6) cost += 1;
    else if (r <= 8) cost += 2;
    else cost += 3;
  }
  return Math.max(0, cost);
}