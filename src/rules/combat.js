import { modifier } from './attributes.js';
import { tickConditions, hasCondition, getConditionEffects } from './conditions.js';
import { enemyAI } from './enemies.js';
import { castProtocol, overclockProtocol } from './protocols.js';
import { applyConsumable } from './consumables.js';

const AP_PER_TURN = 2;

const DIRECTIONS = {
  n: { dx: 0, dy: -1 },
  ne: { dx: 1, dy: -1 },
  e: { dx: 1, dy: 0 },
  se: { dx: 1, dy: 1 },
  s: { dx: 0, dy: 1 },
  sw: { dx: -1, dy: 1 },
  w: { dx: -1, dy: 0 },
  nw: { dx: -1, dy: -1 }
};
const DIRECTION_ORDER = Object.keys(DIRECTIONS);

function buildCombatants(party, enemies) {
  const combatants = new Map();
  for (const c of party) combatants.set(c.id, { ...c, side: 'party', ap: 2, moveAvailable: true, swapAvailable: true, conditions: c.conditions ? [...c.conditions] : [] });
  for (const e of enemies) combatants.set(e.id, { ...e, side: 'enemy', ap: 2, moveAvailable: true, swapAvailable: true, conditions: e.conditions ? [...e.conditions] : [] });
  return combatants;
}

function buildTurnOrder(combatants, rngCursor) {
  const initiatives = [];
  for (const [id, c] of combatants) {
    const initRoll = rngCursor.nextInt('combat', 20) + 1;
    const initMod = c.attributes && c.attributes.fin ? modifier(c.attributes.fin) : 0;
    c.initiative = initRoll + initMod;
    initiatives.push({ id, initiative: c.initiative });
  }
  initiatives.sort((a, b) => b.initiative - a.initiative || String(a.id).localeCompare(String(b.id)));
  let order = initiatives.map(entry => entry.id);
  // Apex actors act twice per round; the second slot is spaced roughly opposite the first.
  for (const c of combatants.values()) {
    if (c.actionSlotsPerRound !== 2) continue;
    const firstIndex = order.indexOf(c.id);
    if (firstIndex < 0) continue;
    const insertAt = Math.min(order.length, firstIndex + Math.max(1, Math.floor(order.length / 2)));
    order = [...order.slice(0, insertAt), c.id, ...order.slice(insertAt)];
  }
  return order;
}

// Accepts either the SESSION-19 encounter contract initiateCombat(encounter, rngCursor, context)
// or the legacy roster contract initiateCombat(party, enemies, rngCursor) used before deployment existed.
export function initiateCombat(first, second, third) {
  const isEncounter = Boolean(first) && !Array.isArray(first) && Array.isArray(first.actors);
  let party, enemies, rngCursor, window, meta;
  if (isEncounter) {
    party = first.actors.filter(actor => actor.side === 'party');
    enemies = first.actors.filter(actor => actor.side === 'enemy');
    rngCursor = second;
    window = first.window || null;
    meta = { id: first.id ?? null, kind: first.kind ?? 'standard', forfeitableLoot: first.forfeitableLoot || [] };
  } else {
    party = first;
    enemies = second;
    rngCursor = third;
    window = null;
    meta = { id: null, kind: 'legacy', forfeitableLoot: [] };
  }

  const combatants = buildCombatants(party, enemies);
  const turnOrder = buildTurnOrder(combatants, rngCursor);

  return {
    ...meta,
    window,
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

function isOpenCell(window, x, y) {
  if (!window) return false;
  if (x < 0 || y < 0 || x >= window.width || y >= window.height) return false;
  return window.cells[y][x] !== 0;
}

function legalStep(window, from, delta) {
  if (!window || !from) return false;
  if (delta.dx !== 0 && delta.dy !== 0) {
    const hOpen = isOpenCell(window, from.x + delta.dx, from.y);
    const vOpen = isOpenCell(window, from.x, from.y + delta.dy);
    if (!hOpen && !vOpen) return false;
  }
  return isOpenCell(window, from.x + delta.dx, from.y + delta.dy);
}

function cellOccupied(combatants, x, y, excludeId) {
  for (const actor of combatants.values()) {
    if (actor.id !== excludeId && actor.hp > 0 && actor.position && actor.position.x === x && actor.position.y === y) return true;
  }
  return false;
}

function legalDirectionsFrom(combatState, actor) {
  if (!actor.position || !combatState.window) return [];
  return DIRECTION_ORDER.filter(name => {
    const delta = DIRECTIONS[name];
    if (!legalStep(combatState.window, actor.position, delta)) return false;
    const dest = { x: actor.position.x + delta.dx, y: actor.position.y + delta.dy };
    return !cellOccupied(combatState.combatants, dest.x, dest.y, actor.id);
  });
}

function chebyshevPos(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function nearestHostile(combatState, actor) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const other of combatState.combatants.values()) {
    if (other.id === actor.id || other.hp <= 0 || other.side === actor.side || !other.position || !actor.position) continue;
    const distance = chebyshevPos(actor.position, other.position);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = other;
    }
  }
  return nearest;
}

// PANICKED overrides any requested direction/target with the step that maximizes distance from the nearest hostile.
function fleeDirection(combatState, actor) {
  const hostile = nearestHostile(combatState, actor);
  if (!hostile || !actor.position) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const name of DIRECTION_ORDER) {
    const delta = DIRECTIONS[name];
    if (!legalStep(combatState.window, actor.position, delta)) continue;
    const dest = { x: actor.position.x + delta.dx, y: actor.position.y + delta.dy };
    if (cellOccupied(combatState.combatants, dest.x, dest.y, actor.id)) continue;
    const score = chebyshevPos(dest, hostile.position);
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

// AI convenience: greedily steps toward a target instead of requiring an explicit direction.
function stepToward(combatState, actor, targetId) {
  const target = combatState.combatants.get(targetId);
  if (!target || !target.position || !actor.position) return null;
  let best = null;
  let bestDistance = chebyshevPos(actor.position, target.position);
  for (const name of DIRECTION_ORDER) {
    const delta = DIRECTIONS[name];
    if (!legalStep(combatState.window, actor.position, delta)) continue;
    const dest = { x: actor.position.x + delta.dx, y: actor.position.y + delta.dy };
    if (cellOccupied(combatState.combatants, dest.x, dest.y, actor.id)) continue;
    const distance = chebyshevPos(dest, target.position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

export function getLegalActions(combatState, actorId, context = {}) {
  const actor = combatState.combatants.get(actorId);
  if (!actor || actor.hp <= 0) return { canAct: false, actions: [], legalMoveDirections: [] };
  const isTurn = combatState.turnOrder[combatState.currentTurn] === actorId;
  const actions = [];
  if (isTurn && actor.ap > 0) {
    if (!hasCondition(actor, 'panicked')) actions.push('attack');
    if (!hasCondition(actor, 'jammed')) actions.push('cast', 'overclock');
    actions.push('item');
  }
  if (isTurn && actor.moveAvailable && !hasCondition(actor, 'immobilized')) actions.push('move');
  if (isTurn && actor.swapAvailable) actions.push('swap');
  if (isTurn) actions.push('retreat', 'wait', 'end-turn');
  return { canAct: isTurn, actions, legalMoveDirections: isTurn ? legalDirectionsFrom(combatState, actor) : [] };
}

export function executeAction(combatState, action, rngCursor, context = {}) {
  const { type, actorId, targetId, school, tier, consumableId, direction } = action || {};
  const actor = combatState.combatants.get(actorId);
  if (!actor || actor.hp <= 0) return { success: false, reason: 'invalid-actor' };
  if (combatState.turnOrder[combatState.currentTurn] !== actorId) {
    return { success: false, reason: 'invalid-turn' };
  }
  prepareTurn(combatState, actor, context, rngCursor);
  if (actor.hp <= 0) return { success: false, reason: 'invalid-actor' };
  if (type !== 'move' && type !== 'swap' && type !== 'end-turn' && actor.ap <= 0) return { success: false, reason: 'no-ap' };
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
    case 'move':
      return executeMove(combatState, actor, { direction, targetId });
    case 'swap':
      return executeSwap(combatState, actor, targetId);
    case 'end-turn':
      combatState.log.push({ type: 'end-turn', actorId });
      actor.ap = 0;
      return { success: true };
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

export function endTurn(combatState, actorId, context = {}) {
  const actor = combatState.combatants.get(actorId);
  if (!actor || actor.hp <= 0) return { success: false, reason: 'invalid-actor' };
  if (combatState.turnOrder[combatState.currentTurn] !== actorId) return { success: false, reason: 'invalid-turn' };
  combatState.log.push({ type: 'end-turn', actorId });
  actor.ap = 0;
  return { success: true };
}

function executeMove(combatState, actor, { direction, targetId }) {
  if (!actor.moveAvailable) return { success: false, reason: 'no-move' };
  if (hasCondition(actor, 'immobilized')) return { success: false, reason: 'immobilized' };
  if (!combatState.window) return { success: false, reason: 'no-window' };

  let chosenDirection = hasCondition(actor, 'panicked') ? fleeDirection(combatState, actor) : direction;
  if (!chosenDirection && targetId) chosenDirection = stepToward(combatState, actor, targetId);
  const delta = DIRECTIONS[chosenDirection];
  if (!delta) return { success: false, reason: 'invalid-direction' };
  if (!legalStep(combatState.window, actor.position, delta)) return { success: false, reason: 'illegal-cell' };

  const dest = { x: actor.position.x + delta.dx, y: actor.position.y + delta.dy };
  if (cellOccupied(combatState.combatants, dest.x, dest.y, actor.id)) return { success: false, reason: 'illegal-cell' };

  actor.position = dest;
  actor.moveAvailable = false;
  combatState.log.push({ type: 'move', actorId: actor.id, direction: chosenDirection, to: { ...dest } });
  return { success: true, position: { ...dest } };
}

function executeSwap(combatState, actor, targetId) {
  if (!actor.swapAvailable) return { success: false, reason: 'no-swap' };
  const ally = combatState.combatants.get(targetId);
  if (!ally || ally.id === actor.id || ally.hp <= 0 || ally.side !== actor.side) return { success: false, reason: 'invalid-target' };
  if (!actor.position || !ally.position || chebyshevPos(actor.position, ally.position) !== 1) return { success: false, reason: 'not-adjacent' };

  const actorPosition = actor.position;
  actor.position = ally.position;
  ally.position = actorPosition;
  actor.swapAvailable = false;
  combatState.log.push({ type: 'swap', actorId: actor.id, withId: ally.id });
  return { success: true };
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

  const result = applyConsumable(target, context.consumablesData?.consumables?.[itemId], { inCombat: true, rngCursor, activeCharacter: actor, conditionsData: context.conditionsData, inventory, itemId: inventoryItem?.id });
  if (result.success) {
    combatState.log.push({ type: 'item', actorId: actor.id, targetId, consumableId: itemId, result });
    actor.ap--;
    if (inventory && result.inventory) {
      inventory.splice(0, inventory.length, ...result.inventory);
      context.runState.inventory = inventory;
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
        const action = enemyAI(actor, combatState, rngCursor, context);
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
  actor.moveAvailable = true;
  actor.swapAvailable = true;
  actor.signatureFreeActions = {};
  if (hasCondition(actor, 'immobilized')) actor.moveAvailable = false;

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
