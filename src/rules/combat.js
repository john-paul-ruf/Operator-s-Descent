import { modifier } from './attributes.js';
import { tickConditions, hasCondition, getConditionBonus } from './conditions.js';
import { enemyAI } from './enemies.js';
import { castProtocol, overclockProtocol } from './protocols.js';
import { applyConsumable } from './consumables.js';

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
    result: null
  };
}

export function executeAction(combatState, action, rngCursor, context) {
  const { type, actorId, targetId, school, tier, consumableId } = action;
  const actor = combatState.combatants.get(actorId);
  if (!actor || actor.hp <= 0) return { success: false, reason: 'invalid-actor' };
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

  const defense = (target.defense || 10) + getCoverBonus(target) - (hasCondition(target, 'blinded') ? 4 : 0);

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
  const target = targetId ? combatState.combatants.get(targetId) : null;
  const result = overclock
    ? overclockProtocol(actor, school, tier, target, context.protocolsData, context.conditionsData, rngCursor)
    : castProtocol(actor, school, tier, target, context.protocolsData, context.conditionsData, rngCursor);
  if (result.success && result.result) {
    combatState.log.push({ type: 'protocol', actorId: actor.id, targetId, school, tier, overclocked: overclock, result: result.result });
  }
  actor.ap--;
  return result;
}

function executeItem(combatState, actor, targetId, consumableId, rngCursor, context) {
  const target = combatState.combatants.get(targetId) || actor;
  const result = applyConsumable(target, context.consumablesData?.consumables?.[consumableId], { inCombat: true, rngCursor, activeCharacter: actor });
  if (result.success) {
    combatState.log.push({ type: 'item', actorId: actor.id, targetId, consumableId, result });
  }
  actor.ap--;
  return result;
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

export function resolveTurn(combatState, rngCursor, context) {
  const actorId = combatState.turnOrder[combatState.currentTurn];
  const actor = combatState.combatants.get(actorId);

  if (actor && actor.hp > 0) {
    const tickResults = tickConditions(actor, context.conditionsData);
    if (tickResults.length > 0) {
      for (const r of tickResults) {
        if (r.type === 'damage' && r.amount > 0) {
          actor.hp -= r.amount;
          combatState.log.push({ type: 'condition-damage', actorId, source: r.source, amount: r.amount });
          if (actor.hp <= 0) {
            actor.hp = 0;
            combatState.log.push({ type: 'death', actorId, cause: 'condition' });
          }
        }
      }
    }

    if (actor.hp > 0) {
      actor.ap = actor.archetypeId === 'apex' ? 2 : 2;

      if (actor.side === 'enemy') {
        while (actor.ap > 0 && actor.hp > 0 && !combatState.ended) {
          const action = enemyAI(actor, combatState, rngCursor);
          executeAction(combatState, action, rngCursor, context);
          const end = checkCombatEnd(combatState);
          if (end.ended) break;
        }
      }
    }
  }

  combatState.currentTurn++;
  if (combatState.currentTurn >= combatState.turnOrder.length) {
    combatState.currentTurn = 0;
    combatState.round++;
  }

  return checkCombatEnd(combatState);
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