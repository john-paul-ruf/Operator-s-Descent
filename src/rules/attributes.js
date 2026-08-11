export const ATTRIBUTE_KEYS = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
export const ATTRIBUTE_MIN_RANK = 1;
export const ATTRIBUTE_BASELINE_RANK = 3;
export const ATTRIBUTE_MAX_RANK = 10;

export function isAttributeRank(value) {
  return Number.isInteger(value) && value >= ATTRIBUTE_MIN_RANK && value <= ATTRIBUTE_MAX_RANK;
}

export function normalizeAttributeRank(value, fallback = ATTRIBUTE_BASELINE_RANK) {
  const rank = Number.isInteger(value) ? value : fallback;
  return Math.max(ATTRIBUTE_MIN_RANK, Math.min(ATTRIBUTE_MAX_RANK, rank));
}

function rank(value) { return normalizeAttributeRank(value); }

export function modifier(value) {
  return rank(value) - 5;
}

export function attributeStepCost(fromRank, toRank) {
  const from = rank(fromRank);
  const to = rank(toRank);
  if (to <= from) return 0;
  let cost = 0;
  for (let next = from + 1; next <= to; next++) cost += next <= 6 ? 1 : next <= 8 ? 2 : 3;
  return cost;
}

export function attributeCost(currentRank, targetRank) {
  return attributeStepCost(currentRank, targetRank);
}

export function attributeCreationCost(targetRank) {
  return attributeStepCost(ATTRIBUTE_BASELINE_RANK, targetRank);
}

export function normalizeAttributes(attributes = {}, fallbackRank = ATTRIBUTE_BASELINE_RANK) {
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, normalizeAttributeRank(attributes[key], fallbackRank)]));
}

export function deriveStats(character, classData, equipment = {}) {
  const attributes = character?.attributes || {};
  const armor = equipment.armor || character?.armor || {};
  const offhand = equipment.offhand || character?.offhand || {};
  const classId = classData?.id || character?.classId;
  const armorId = armor.baseType ?? armor.id;
  const ignoresMediumPenalty = armorId === 'medium' && (classId === 'breacher' || classId === 'anchor');
  const finPenalty = armor.ignoreFinPenalty || ignoresMediumPenalty ? 0 : (armor.finPenalty || 0);
  const effectiveFin = rank(attributes.fin) + finPenalty;
  const calibrations = Math.max(0, Math.floor(character?.calibrationCount || 0));
  const hitDieBase = Math.max(0, Number(classData?.hitDieBase) || 0);
  const chargeBase = Math.max(0, Number(classData?.chargeBase) || 0);
  const hpGrowth = Math.max(2, Math.floor(hitDieBase / 2));
  return {
    hpMax: rank(attributes.vit) * 4 + hitDieBase + calibrations * hpGrowth,
    chargeMax: rank(attributes.res) * 3 + chargeBase + (armor.chargeBonus || 0) + (offhand.chargeBonus || 0),
    chargeRegen: Math.floor(rank(attributes.res) / 3) + (armor.chargeRegenBonus || 0) + (offhand.chargeRegenBonus || 0),
    defenseBase: 10 + modifier(effectiveFin) + (armor.defenseBonus || 0) + (offhand.defenseBonus || 0),
    protocolDefenseBase: 10 + modifier(attributes.foc),
    initiativeMod: modifier(effectiveFin),
    meleeAccuracy: modifier(attributes.mgt),
    rangedAccuracy: modifier(effectiveFin),
    protocolAccuracy: modifier(attributes.foc),
    detectionRadius: rank(attributes.sig) * 2,
    effectiveAttributes: { ...Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, rank(value)])), fin: effectiveFin },
    finPenalty
  };
}

export function protocolSaveDC(character, tier) {
  return 10 + modifier(character?.attributes?.foc) + Math.max(1, Math.min(5, Math.floor(tier || 1)));
}

export function overclockTarget(tier) {
  return 11 + 2 * Math.max(1, Math.min(5, Math.floor(tier || 1)));
}
