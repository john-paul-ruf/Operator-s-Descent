import { modifier } from './attributes.js';

export function applyConsumable(target, consumableData, context) {
  if (!consumableData) return { success: false, reason: 'invalid-consumable' };
  if (consumableData.combatOnly && !context.inCombat) {
    return { success: false, reason: 'combat-only' };
  }

  const e = consumableData.effectData || {};
  const result = { success: true, effect: consumableData.effect };

  if (e.type === 'heal') {
    const dieBase = parseInt(e.die?.slice(1) || '6', 10);
    const count = dieBase * (e.multiplier || 1);
    let healed = 0;
    for (let i = 0; i < count; i++) {
      healed += Math.floor(context.rngCursor.nextInt('combat', 6)) + 1;
    }
    target.hp = Math.min((target.hpMax || target.hp + healed), target.hp + healed);
    result.healed = healed;
  } else if (e.type === 'charge_restore') {
    const resVal = target.attributes?.res || 3;
    const amount = Math.max(e.minRestore || 2, Math.floor(resVal / 2));
    target.charge = Math.min((target.chargeMax || target.charge + amount), target.charge + amount);
    result.chargeRestored = amount;
  } else if (e.type === 'charge_restore_full') {
    const max = target.chargeMax || target.charge;
    const restored = max - target.charge;
    target.charge = max;
    result.chargeRestored = restored;
  } else if (e.type === 'remove_condition') {
    if (target.conditions && target.conditions.length > 0) {
      target.conditions.shift();
      result.conditionRemoved = true;
    }
  } else if (e.type === 'apply_condition' && e.condition) {
    if (!target.conditions) target.conditions = [];
    target.conditions.push({ id: e.condition, duration: 3, stacks: 1 });
    result.conditionApplied = e.condition;
  } else if (e.type === 'ap_restore') {
    if (context.activeCharacter) {
      context.activeCharacter.ap = (context.activeCharacter.ap || 0) + (e.amount || 1);
    }
    result.apRestored = e.amount || 1;
  }

  return result;
}