import { modifier } from './attributes.js';

function conditionId(entry) {
  return entry?.conditionId ?? entry?.id;
}

function registry(data) {
  return data?.conditions ?? data ?? {};
}

function entries(target) {
  if (!Array.isArray(target?.conditions)) target.conditions = [];
  return target.conditions;
}

function rollD20(rngCursor) {
  return rngCursor?.nextInt ? rngCursor.nextInt('combat', 20) + 1 : null;
}

function rollD6(rngCursor) {
  return rngCursor?.nextInt ? rngCursor.nextInt('combat', 6) + 1 : null;
}

function conditionData(conditionIdValue, source, data) {
  if (data !== undefined) return { source: source ?? {}, conditions: registry(data) };
  if (source?.conditions || source?.[conditionIdValue]?.effectData) return { source: {}, conditions: registry(source) };
  return { source: source ?? {}, conditions: {} };
}

export function consumeShield(target) {
  const conditions = entries(target);
  const index = conditions.findIndex(entry => conditionId(entry) === 'shielded');
  if (index < 0) return { consumed: false };
  conditions.splice(index, 1);
  return { consumed: true, event: { type: 'condition_consumed', conditionId: 'shielded', targetId: target?.id } };
}

export function applyCondition(target, conditionIdValue, source, rngCursor, data) {
  const resolved = conditionData(conditionIdValue, source, data);
  const condition = resolved.conditions[conditionIdValue];
  if (!target || !condition) return { applied: false, reason: 'invalid_condition', events: [] };
  if (conditionIdValue !== 'shielded') {
    const shield = consumeShield(target);
    if (shield.consumed) return { applied: false, shielded: true, events: [shield.event] };
  }
  const noSave = condition.saveAttribute === null || resolved.source.noSave === true;
  let roll = null;
  if (!noSave && resolved.source.dc !== undefined) {
    const natural = rollD20(rngCursor);
    if (natural === null) return { applied: false, reason: 'invalid_rng', events: [] };
    const saveModifier = modifier(target.attributes?.[condition.saveAttribute]);
    roll = { natural, modifier: saveModifier, total: natural + saveModifier, dc: resolved.source.dc, attribute: condition.saveAttribute, success: natural + saveModifier >= resolved.source.dc };
    if (roll.success) return { applied: false, saved: true, roll, events: [{ type: 'condition_saved', conditionId: conditionIdValue, targetId: target.id, roll }] };
  }
  const conditions = entries(target);
  const existing = conditions.find(entry => conditionId(entry) === conditionIdValue);
  if (existing) {
    existing.duration = Math.max(existing.duration, condition.duration);
    if (condition.stackable) existing.stacks = (existing.stacks ?? 1) + 1;
    return { applied: true, refreshed: true, roll, events: [{ type: 'condition_refreshed', conditionId: conditionIdValue, targetId: target.id }] };
  }
  conditions.push({ id: conditionIdValue, duration: condition.duration, stacks: 1, ...(conditionIdValue === 'corroded' ? { elapsedTurns: 0 } : {}) });
  return { applied: true, roll, events: [{ type: 'condition_applied', conditionId: conditionIdValue, targetId: target.id }] };
}

export function tickConditions(target, phase, rngCursor, data) {
  const legacy = typeof phase !== 'string';
  const conditionsData = registry(legacy ? phase : data);
  const activePhase = legacy ? 'start_turn' : phase;
  if (activePhase !== 'start_turn' || !Array.isArray(target?.conditions)) return [];
  const events = [];
  for (let index = target.conditions.length - 1; index >= 0; index--) {
    const entry = target.conditions[index];
    const id = conditionId(entry);
    const definition = conditionsData[id];
    if (!definition) continue;
    if (id === 'burning') {
      const rolls = Array.from({ length: entry.stacks ?? 1 }, () => rollD6(rngCursor));
      if (rolls.some(value => value === null)) return [...events, { type: 'invalid_rng', conditionId: id, targetId: target.id }];
      events.push({ type: 'damage', targetId: target.id, target: target.id, source: 'burning', conditionId: id, rolls, amount: rolls.reduce((sum, value) => sum + value, 0) });
    }
    if (id === 'corroded') {
      entry.elapsedTurns = (entry.elapsedTurns ?? 0) + 1;
      events.push({ type: 'condition_tick', conditionId: id, targetId: target.id, elapsedTurns: entry.elapsedTurns });
    }
    entry.duration -= 1;
    if (entry.duration <= 0) {
      target.conditions.splice(index, 1);
      events.push({ type: 'expired', condition: id, conditionId: id, targetId: target.id, target: target.id });
    }
  }
  return events;
}

export function getConditionEffects(target, data) {
  const effects = {
    defenseBonus: 0,
    defensePenalty: 0,
    defenseFloor: 2,
    damageMultiplier: 1,
    losRange: null,
    rangedPenalty: 0,
    attackBonusAgainst: 0,
    blockProtocols: false,
    blockMove: false,
    blockAttack: false,
    forcedRetreat: false,
    alwaysVisible: false
  };
  const conditionsData = registry(data);
  for (const entry of target?.conditions ?? []) {
    const id = conditionId(entry);
    const definition = conditionsData[id];
    if (!definition) continue;
    const values = definition.effectData ?? {};
    effects.defenseBonus += values.defenseBonus ?? 0;
    effects.damageMultiplier = Math.max(effects.damageMultiplier, values.damageMultiplier ?? 1);
    effects.losRange = values.losRange ?? effects.losRange;
    effects.rangedPenalty += values.rangedPenalty ?? 0;
    effects.attackBonusAgainst += values.attackBonusAgainst ?? 0;
    effects.blockProtocols ||= Boolean(values.blockProtocols);
    effects.blockMove ||= Boolean(values.blockMove);
    effects.blockAttack ||= Boolean(values.blockAttack);
    effects.forcedRetreat ||= Boolean(values.forcedRetreat);
    effects.alwaysVisible ||= Boolean(values.alwaysVisible);
    if (id === 'corroded') effects.defensePenalty -= (values.defenseLossPerTurn ?? 0) * (entry.elapsedTurns ?? 0);
  }
  return effects;
}

export function clearAllConditions(target) {
  const cleared = (target?.conditions ?? []).map(entry => conditionId(entry));
  if (target) target.conditions = [];
  return { cleared, events: cleared.map(conditionIdValue => ({ type: 'condition_cleared', conditionId: conditionIdValue, targetId: target?.id })) };
}

export function getConditionBonus(target, bonusType, data) {
  const effects = getConditionEffects(target, data);
  if (bonusType === 'defense') return effects.defenseBonus + effects.defensePenalty;
  if (bonusType === 'attack-against') return effects.attackBonusAgainst;
  return 0;
}

export function hasCondition(target, conditionIdValue) {
  return (target?.conditions ?? []).some(entry => conditionId(entry) === conditionIdValue);
}
