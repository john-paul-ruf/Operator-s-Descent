import { applyCondition } from './conditions.js';
import { removeItem } from './inventory.js';

function value(target, canonical, legacy) { return target?.[canonical] ?? target?.[legacy] ?? 0; }
function setValue(target, canonical, legacy, next) { target[canonical in target ? canonical : legacy] = next; }
function rollDice(rngCursor, count, sides) { return rngCursor?.nextInt ? Array.from({ length: count }, () => rngCursor.nextInt('combat', sides) + 1) : null; }

export function applyConsumable(target, consumableData, context = {}) {
  if (!consumableData || !target) return { success: false, reason: 'invalid_consumable' };
  if (consumableData.combatOnly && !context.inCombat) return { success: false, reason: 'combat_only' };
  const effect = consumableData.effectData ?? {};
  const result = { success: true, effect: consumableData.effect, events: [] };
  if (effect.type === 'heal') {
    const rolls = rollDice(context.rngCursor, effect.multiplier ?? 1, Number(effect.die?.slice(1)) || 6);
    if (!rolls) return { success: false, reason: 'invalid_rng' };
    const healed = rolls.reduce((sum, die) => sum + die, 0);
    setValue(target, 'currentHP', 'hp', Math.min(target.hpMax ?? Infinity, value(target, 'currentHP', 'hp') + healed));
    result.healed = healed;
  } else if (effect.type === 'charge_restore' || effect.type === 'charge_restore_full') {
    const current = value(target, 'currentCHARGE', 'charge');
    const maximum = target.chargeMax ?? current;
    const amount = effect.type === 'charge_restore_full' ? maximum - current : Math.max(effect.minRestore ?? 2, Math.floor((target.attributes?.res ?? 3) / 2));
    setValue(target, 'currentCHARGE', 'charge', Math.min(maximum, current + amount));
    result.chargeRestored = Math.max(0, amount);
  } else if (effect.type === 'remove_condition') {
    const index = target.conditions?.findIndex(entry => (entry.conditionId ?? entry.id) === context.conditionId) ?? -1;
    if (index < 0) return { success: false, reason: 'invalid_condition' };
    result.conditionRemoved = target.conditions[index].conditionId ?? target.conditions[index].id;
    target.conditions.splice(index, 1);
  } else if (effect.type === 'apply_condition') {
    const applied = applyCondition(target, effect.condition, { noSave: true }, context.rngCursor, context.conditionsData);
    if (!applied.applied) return { success: false, reason: applied.reason ?? 'condition_blocked', condition: applied };
    result.conditionApplied = effect.condition;
  } else if (effect.type === 'ap_restore') {
    if (!context.activeCharacter) return { success: false, reason: 'missing_active_character' };
    context.activeCharacter.ap = Math.min(2, (context.activeCharacter.ap ?? 0) + (effect.amount ?? 1));
    result.apRestored = effect.amount ?? 1;
  } else return { success: false, reason: 'invalid_effect' };
  if (context.inventory && context.itemId) {
    const removed = removeItem(context.inventory, context.itemId);
    if (!removed.success) return { success: false, reason: removed.reason };
    result.inventory = removed.inventory;
    result.consumedUnits = 1;
  }
  return result;
}
