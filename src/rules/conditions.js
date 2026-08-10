import { modifier } from './attributes.js';

export function applyCondition(target, conditionId, conditionsData, rngCursor) {
  const condition = conditionsData[conditionId];
  if (!condition) return { applied: false };

  const shieldedIndex = (target.conditions || []).findIndex(c => c.id === 'shielded');
  if (shieldedIndex !== -1 && conditionId !== 'shielded') {
    (target.conditions).splice(shieldedIndex, 1);
    return { applied: false, shielded: true };
  }

  const existing = (target.conditions || []).find(c => c.id === conditionId);
  if (existing) {
    if (condition.stackable) {
      existing.stacks = (existing.stacks || 1) + 1;
      existing.duration = condition.duration;
    } else {
      existing.duration = Math.max(existing.duration, condition.duration);
    }
    return { applied: true, shielded: false };
  }

  if (!target.conditions) target.conditions = [];
  target.conditions.push({
    id: conditionId,
    duration: condition.duration,
    stacks: 1
  });
  return { applied: true, shielded: false };
}

export function tickConditions(target, conditionsData) {
  const results = [];
  if (!target.conditions) return results;

  for (let i = target.conditions.length - 1; i >= 0; i--) {
    const cond = target.conditions[i];

    if (cond.id === 'burning') {
      const stacks = cond.stacks || 1;
      results.push({
        type: 'damage',
        target: target.id,
        amount: stacks,
        source: 'burning'
      });
    }

    cond.duration--;
    if (cond.duration <= 0) {
      results.push({ type: 'expired', target: target.id, condition: cond.id });
      target.conditions.splice(i, 1);
    }
  }
  return results;
}

export function clearAllConditions(target) {
  target.conditions = [];
}

export function getConditionBonus(target, bonusType) {
  if (!target.conditions) return 0;
  let bonus = 0;
  for (const cond of target.conditions) {
    if (cond.id === 'shielded' && bonusType === 'defense') bonus += 4;
    if (cond.id === 'corroded' && bonusType === 'defense') bonus -= 2 * (cond.stacks || 1);
    if (cond.id === 'marked' && bonusType === 'attack-against') bonus += 2;
  }
  return bonus;
}

export function hasCondition(target, conditionId) {
  if (!target.conditions) return false;
  return target.conditions.some(c => c.id === conditionId);
}