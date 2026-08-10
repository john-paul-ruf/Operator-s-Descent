import { modifier } from './attributes.js';

export function protocolChargeCost(tier, overclocked) {
  const base = tier * 2;
  return overclocked ? base * 2 : base;
}

export function deckSlotCost(tier) {
  return tier;
}

export function deckSlotCapacity(classChargeBase) {
  return Math.ceil(classChargeBase / 2);
}

export function castProtocol(caster, school, tier, target, protocolsData, conditionsData, rngCursor) {
  const schoolData = protocolsData.schools[school];
  if (!schoolData) return { success: false, reason: 'invalid-school' };
  const protocolTier = schoolData.tiers[tier - 1];
  if (!protocolTier) return { success: false, reason: 'invalid-tier' };

  const cost = protocolChargeCost(tier, false);
  if (caster.charge < cost) return { success: false, reason: 'insufficient-charge' };
  caster.charge -= cost;

  const e = protocolTier.effectData || {};
  const result = { damage: 0, healed: 0, conditionsApplied: [], protocolName: protocolTier.name };

  if (e.type === 'damage') {
    const resMod = modifier(caster.attributes.res);
    const dieBase = parseInt(e.die?.slice(1) || '6', 10);
    const dice = (dieBase * (e.multiplier || 1));
    const roll = rollDice(rngCursor, dice, 6);
    result.damage = roll + resMod;
    if (target) {
      if (target.hp !== undefined) target.hp -= result.damage;
    }
  } else if (e.type === 'heal') {
    const resMod = modifier(caster.attributes.res);
    const dieBase = parseInt(e.die?.slice(1) || '6', 10);
    const dice = (dieBase * (e.multiplier || 1));
    const roll = rollDice(rngCursor, dice, 6);
    result.healed = roll + resMod;
    if (target && target.hp !== undefined) {
      target.hp = Math.min(target.hpMax || target.hp + result.healed, target.hp + result.healed);
    }
  } else if (e.type === 'condition' && e.condition) {
    if (target) {
      const applied = applyConditionSafe(target, e.condition, conditionsData, rngCursor);
      result.conditionsApplied.push({ target: target.id, condition: e.condition, ...applied });
    }
  }

  return { success: true, result };
}

export function overclockProtocol(caster, school, tier, target, protocolsData, conditionsData, rngCursor) {
  const cost = protocolChargeCost(tier, true);
  if (caster.charge < cost) return { success: false, reason: 'insufficient-charge' };
  caster.charge -= cost;

  const threshold = 11 + (2 * tier);
  const focMod = modifier(caster.attributes.foc);
  const roll = rngCursor.nextInt('combat', 20) + 1 + focMod;

  if (roll >= threshold) {
    const boostedResult = castProtocol(caster, school, tier + 1, target, protocolsData, conditionsData, rngCursor);
    return { success: true, overclocked: true, corruptionAdded: 0, result: boostedResult.result };
  } else {
    return { success: true, overclocked: false, corruptionAdded: 0.05, result: null, roll, threshold };
  }
}

function rollDice(rngCursor, count, sides) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += rngCursor.nextInt('combat', sides) + 1;
  }
  return total;
}

function applyConditionSafe(target, conditionId, conditionsData, rngCursor) {
  if (!target.conditions) target.conditions = [];
  const condition = conditionsData[conditionId];
  if (!condition) return { applied: false };

  const shieldedIdx = target.conditions.findIndex(c => c.id === 'shielded');
  if (shieldedIdx !== -1 && conditionId !== 'shielded') {
    target.conditions.splice(shieldedIdx, 1);
    return { applied: false, shielded: true };
  }

  const existing = target.conditions.find(c => c.id === conditionId);
  if (existing) {
    if (condition.stackable) {
      existing.stacks = (existing.stacks || 1) + 1;
      existing.duration = condition.duration;
    } else {
      existing.duration = Math.max(existing.duration, condition.duration);
    }
    return { applied: true };
  }

  target.conditions.push({ id: conditionId, duration: condition.duration, stacks: 1 });
  return { applied: true };
}