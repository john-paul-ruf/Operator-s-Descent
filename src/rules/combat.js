import { modifier } from './attributes.js';
import { tickConditions, hasCondition, getConditionEffects } from './conditions.js';
import { enemyAI } from './enemies.js';
import { castProtocol, overclockProtocol } from './protocols.js';
import { applyConsumable } from './consumables.js';

const AP_PER_TURN = 2;

export function initiateCombat(party, enemies, rngCursor) {
  const combatants = new Map();

  for (const c of party) {
    combatants.set(c.id, { ...c, side: 'party', ap: 2, conditions: c.conditions ? [...c.conditions] : [] });
  }
  for (const e of enemies) {
    combatants.set(e.id, { ...e, side: 'enemy', ap: 2, conditions: e.conditions ? [...e.conditions] : [] });
  }

  const initiatives = [];
  for (const [id, c] of combatants) {
    const initRoll = rngCursor.nextInt('combat', 20) + 1;
    const initMod = c.attributes && c.attributes.fin ? modifier(c.attributes.fin) : 0;
    c.initiative = initRoll + initMod;
    initiatives.push({ id, initiative: c.initiative });
  }

  initiatives.sort((a, b) => b.initiative - a.initiative);
  const turnOrder = initiatives.map(i => i.id);

  return {
    round: 1,
    currentTurn: 0,
    turnOrder,
    combatants,
    log: [],
    ended: false,
    result: null,
    turnStarted: false
  };
}

export function executeAction(combatState, action, rngCursor, context = {}) {
  const { type, actorId, targetId, school, tier, consumableId } = action || {};
  const actor = combatState.combatants.get(actorId);
  if (!actor || actor.hp <= 0) return { success: false, reason: 'invalid-actor' };
  if (combatState.turnOrder[combatState.currentTurn] !== actorId) {
    return { success: false, reason: 'invalid-turn' };
  }
  prepareTurn(combatState, actor, context, rngCursor);
  if (actor.hp <= 0) return { success: false, reason: 'invalid-actor' };
  if (actor.ap <= 0) return { success: false, reason: 'no-ap' };
  if (hasCondition(actor, 'jammed') && (type === 'cast' || type === 'overclock')) {
    return { success: false, reason: 'jammed' };
  }
  if (hasCondition(actor, 'panicked') && type === 'attack') {
    return { success: false, reason: 'panicked' };
  }

  switch (type) {
    case 'attack':
      return executeAttack(combatState, actor, targetId, rngCursor, context);
    case 'cast':
      return executeProtocol(combatState, actor, school, tier, targetId, false, rngCursor, context);
    case 'overclock':
      return executeProtocol(combatState, actor, school, tier, targetId, true, rngCursor, context);
    case 'item':
      return executeItem(combatState, actor, targetId, consumableId, rngCursor, context);
    case 'retreat': {
      const roll = rngCursor.nextInt('combat', 20) + 1;
      const success = roll >= 15;
      combatState.log.push({ type: 'retreat', actorId, targetId, roll, success });
      actor.ap = 0;
      return { success, retreated: success };
    }
    case 'wait':
      actor.ap = 0;
      combatState.log.push({ type: 'wait', actorId });
      return { success: true };
    default:
      return { success: false, reason: 'invalid-action' };
  }
}

function executeAttack(combatState, actor, targetId, rngCursor, context) {
  const target = combatState.combatants.get(targetId);
  if (!target || target.hp <= 0) return { success: false, reason: 'invalid-target' };

  const roll = rngCursor.nextInt('combat', 20) + 1;
  const isMelee = !actor.weapon || actor.weapon?.rangeBand === 'adjacent';
  const attrMod = isMelee ? modifier(actor.attributes?.mgt || 3) : modifier(actor.attributes?.fin || 3);
  const weaponBonus = actor.weapon?.accuracyBonus || 0;
  const coverBonus = context?.lattice && actor.position && target.position
    ? 0
    : 0;
  const markedBonus = hasCondition(target, 'marked') ? 2 : 0;
  const total = roll + attrMod + weaponBonus + markedBonus;

  const conditionEffects = getConditionEffects(target, context.conditionsData?.conditions || context.conditionsData);
  const defense = Math.max(conditionEffects.defenseFloor, (target.defense || 10) + getCoverBonus(target) + conditionEffects.defenseBonus + conditionEffects.defensePenalty);

  const isCrit = roll === 20;
  const isFumble = roll === 1;
  const hit = !isFumble && (isCrit || total >= defense);

  let damage = 0;
  if (hit) {
    const dieSize = parseInt(actor.weapon?.damageDie?.slice(1) || '6', 10);
    const dieCount = isCrit ? 2 : 1;
    damage = rollDice(rngCursor, dieCount, dieSize);
    if (isMelee) damage += modifier(actor.attributes?.mgt || 3);
    if (hasCondition(target, 'overloaded')) damage = Math.floor(damage * 1.5);
    target.hp -= damage;
    if (target.hp <= 0) {
      target.hp = 0;
      combatState.log.push({ type: 'death', actorId: actor.id, targetId });
    }
  }

  combatState.log.push({ type: 'attack', actorId: actor.id, targetId, roll: total, naturalRoll: roll, hit, damage, crit: isCrit, fumble: isFumble });
  actor.ap--;
  return { success: true, hit, damage, crit: isCrit, fumble: isFumble };
}

function executeProtocol(combatState, actor, school, tier, targetId, overclock, rngCursor, context) {
  const protocolData = context.protocolsData?.schools?.[school]?.tiers?.[tier - 1];
  if (!protocolData || !canUseProtocol(actor, school, tier)) {
    return { success: false, reason: 'invalid-protocol' };
  }

  const target = targetId == null ? null : combatState.combatants.get(targetId);
  if (targetId != null && (!target || target.hp <= 0)) {
    return { success: false, reason: 'invalid-target' };
  }

  const conditionsData = context.conditionsData?.conditions || context.conditionsData;
  const result = overclock
    ? overclockProtocol(actor, school, tier, target, context.protocolsData, conditionsData, rngCursor)
    : castProtocol(actor, school, tier, target, context.protocolsData, conditionsData, rngCursor);
  if (result.success) {
    combatState.log.push({ type: 'protocol', actorId: actor.id, targetId, school, tier, overclocked: overclock, result: result.result });
    actor.ap--;
  }
  return result;
}

function executeItem(combatState, actor, targetId, consumableId, rngCursor, context) {
  const inventory = context.runState?.inventory;
  const inventoryItem = inventory?.find(item => item.id === consumableId || item.baseType === consumableId);
  if (inventory && !inventoryItem) return { success: false, reason: 'invalid-item' };

  const itemId = inventoryItem?.baseType || consumableId;
  const target = targetId == null ? actor : combatState.combatants.get(targetId);
  if (!target || target.hp <= 0) return { success: false, reason: 'invalid-target' };

  const result = applyConsumable(target, context.consumablesData?.consumables?.[itemId], { inCombat: true, rngCursor, activeCharacter: actor });
  if (result.success) {
    combatState.log.push({ type: 'item', actorId: actor.id, targetId, consumableId: itemId, result });
    actor.ap--;
    if (inventory && inventoryItem) {
      inventory.splice(inventory.indexOf(inventoryItem), 1);
    }
  }
  return result;
}

function canUseProtocol(actor, school, tier) {
  if (actor.side === 'enemy') {
    return actor.protocolAccess?.schools?.includes(school) && tier <= (actor.protocolAccess.maxTier || tier);
  }
  return actor.protocols?.some(protocol => protocol.school === school && protocol.tier === tier) || false;
}

function getCoverBonus(target) {
  return target.coverBonus || 0;
}

function rollDice(rngCursor, count, sides) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += rngCursor.nextInt('combat', sides) + 1;
  }
  return total;
}

export function resolveTurn(combatState, rngCursor, context = {}) {
  let safety = Math.max(1, combatState.turnOrder.length * 2 + 1);

  while (!combatState.ended && safety-- > 0) {
    const actor = getActiveActor(combatState);
    if (!actor || actor.hp <= 0) {
      advanceTurn(combatState);
      continue;
    }

    prepareTurn(combatState, actor, context, rngCursor);
    const afterConditions = checkCombatEnd(combatState);
    if (afterConditions.ended) return afterConditions;
    if (actor.hp <= 0) {
      advanceTurn(combatState);
      continue;
    }

    if (actor.side === 'enemy') {
      while (actor.ap > 0 && actor.hp > 0 && !combatState.ended) {
        const action = enemyAI(actor, combatState, rngCursor);
        const actionResult = executeAction(combatState, action, rngCursor, context);
        if (!actionResult.success) actor.ap = 0;
        const end = checkCombatEnd(combatState);
        if (end.ended) return end;
      }
      advanceTurn(combatState);
      continue;
    }

    if (actor.ap > 0) return checkCombatEnd(combatState);
    advanceTurn(combatState);
  }

  return checkCombatEnd(combatState);
}

function prepareTurn(combatState, actor, context, rngCursor) {
  if (combatState.turnStarted) return;
  combatState.turnStarted = true;
  actor.ap = AP_PER_TURN;

  const tickResults = tickConditions(actor, 'start_turn', rngCursor, context.conditionsData?.conditions || context.conditionsData);
  for (const result of tickResults) {
    if (result.type !== 'damage' || result.amount <= 0) continue;
    actor.hp -= result.amount;
    combatState.log.push({ type: 'condition-damage', actorId: actor.id, source: result.source, amount: result.amount });
    if (actor.hp <= 0) {
      actor.hp = 0;
      combatState.log.push({ type: 'death', actorId: actor.id, cause: 'condition' });
    }
  }
}

function getActiveActor(combatState) {
  const actorId = combatState.turnOrder[combatState.currentTurn];
  return combatState.combatants.get(actorId);
}

function advanceTurn(combatState) {
  combatState.currentTurn++;
  combatState.turnStarted = false;
  if (combatState.currentTurn >= combatState.turnOrder.length) {
    combatState.currentTurn = 0;
    combatState.round++;
  }
}

export function checkCombatEnd(combatState) {
  const partyAlive = [...combatState.combatants.values()].filter(c => c.side === 'party' && c.hp > 0).length;
  const enemiesAlive = [...combatState.combatants.values()].filter(c => c.side === 'enemy' && c.hp > 0).length;
  if (enemiesAlive === 0) {
    combatState.ended = true;
    combatState.result = 'victory';
  } else if (partyAlive === 0) {
    combatState.ended = true;
    combatState.result = 'wipe';
  }
  return { ended: combatState.ended, result: combatState.result };
}
