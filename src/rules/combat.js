import { modifier } from './attributes.js';
import { tickConditions, hasCondition, getConditionEffects, applyCondition } from './conditions.js';
import { enemyAI, scaleEnemyStat } from './enemies.js';
import { castProtocol, overclockProtocol } from './protocols.js';
import { applyConsumable } from './consumables.js';
import { evaluateRange } from './equipment.js';
import { getSignatureCapabilities, applySignatureModifier } from './classes.js';
import { distanceCells, getEdgeCoverBonus, isFlanked, getOpportunityAttackers, FLANK_ATTACK_BONUS, findApproachPath } from './combat-geometry.js';

const AP_PER_TURN = 2;
export const MOVE_RANGE = 5;
const UNARMED_WEAPON = { damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 1, accuracyBonus: 0 };

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

// Single-step legality from an arbitrary `from` cell for `actorId` — same rules the rules engine
// applies inside a path walk (walls, diagonal corner rule, no landing on a living occupant). The
// UI uses this to gate incremental path-stepping without duplicating the rules internals.
export function isLegalMoveStep(combatState, actorId, from, direction) {
  const actor = combatState?.combatants?.get?.(actorId);
  const delta = DIRECTIONS[direction];
  if (!actor || !delta || !combatState.window || !from) return false;
  if (!legalStep(combatState.window, from, delta)) return false;
  const nx = from.x + delta.dx;
  const ny = from.y + delta.dy;
  return !cellOccupied(combatState.combatants, nx, ny, actor.id);
}

// BFS from actor's position over the 8 movement directions, capped at `maxSteps`. Each expansion
// obeys `legalStep` (walls + diagonal corner rule) and rejects destinations occupied by any living
// actor. Returns Map<'x,y', {x, y, steps, path}> — `path` is the shortest ordered direction list
// from the origin. Origin cell is intentionally excluded.
export function reachableMoveCells(combatState, actorId, maxSteps = MOVE_RANGE) {
  const reachable = new Map();
  const actor = combatState?.combatants?.get?.(actorId);
  if (!actor || !actor.position || !combatState.window) return reachable;
  const origin = { x: actor.position.x, y: actor.position.y };
  const visited = new Set([`${origin.x},${origin.y}`]);
  const queue = [{ x: origin.x, y: origin.y, steps: 0, path: [] }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.steps >= maxSteps) continue;
    for (const name of DIRECTION_ORDER) {
      const delta = DIRECTIONS[name];
      if (!legalStep(combatState.window, current, delta)) continue;
      const nx = current.x + delta.dx;
      const ny = current.y + delta.dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (cellOccupied(combatState.combatants, nx, ny, actor.id)) continue;
      visited.add(key);
      const path = [...current.path, name];
      const entry = { x: nx, y: ny, steps: current.steps + 1, path };
      reachable.set(key, entry);
      queue.push({ x: nx, y: ny, steps: current.steps + 1, path });
    }
  }
  return reachable;
}

function nearestHostile(combatState, actor) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const other of combatState.combatants.values()) {
    if (other.id === actor.id || other.hp <= 0 || other.side === actor.side || !other.position || !actor.position) continue;
    const distance = distanceCells(actor.position, other.position);
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
    const score = distanceCells(dest, hostile.position);
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

// Delegates to findApproachPath (BFS shortest, RNG-free) so enemies can hunt around walls
// instead of wedging at a local minimum. The BFS result is truncated to `maxSteps` — a
// truncated path that makes progress but does not reach `desiredRange` is still returned
// (that IS hunting). Returns null when no forward progress is possible from the origin
// (already within range, unreachable, missing window/target/positions), matching the legacy
// contract so the targetId fallback in `executeMove` still routes to `invalid-direction`.
export function pathToward(combatState, actor, targetId, maxSteps, desiredRange) {
  const target = combatState.combatants.get(targetId);
  if (!target?.position || !actor?.position || !combatState?.window) return null;
  const isOccupied = (x, y) => cellOccupied(combatState.combatants, x, y, actor.id);
  const path = findApproachPath(combatState.window, isOccupied, actor.position, target.position, desiredRange);
  if (!path || path.length === 0) return null;
  const capped = path.slice(0, Math.max(0, Math.floor(maxSteps)));
  return capped.length ? capped : null;
}

// True when at least one living side-mate sits Chebyshev-1 from `actor`. The rules-level
// executeSwap already rejects the bad case with `not-adjacent`, but the UI reads this list
// to enable/disable the SWAP button — advertising a swap that can't complete confused players.
// AUDIT-6 fix: gate the legal-action list on real adjacency before the button ever renders.
function hasAdjacentSwapPartner(combatState, actor) {
  if (!actor?.position) return false;
  for (const other of combatState.combatants.values()) {
    if (other.id === actor.id || other.side !== actor.side || other.hp <= 0 || !other.position) continue;
    if (distanceCells(actor.position, other.position) === 1) return true;
  }
  return false;
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
  // AUDIT-6: only offer swap when a legal partner is actually adjacent.
  if (isTurn && actor.swapAvailable && hasAdjacentSwapPartner(combatState, actor)) actions.push('swap');
  // AUDIT-4: retreat costs 1 AP; do not advertise it when the actor has none left. The
  // rules-level guard at combat.js:243 already returns `no-ap` for the execution path, but
  // the UI reads this list to enable/disable the RETREAT button.
  if (isTurn && actor.ap > 0) actions.push('retreat');
  if (isTurn) actions.push('wait', 'end-turn');
  return { canAct: isTurn, actions, legalMoveDirections: isTurn ? legalDirectionsFrom(combatState, actor) : [], moveRange: MOVE_RANGE };
}

export function executeAction(combatState, action, rngCursor, context = {}) {
  const { type, actorId, targetId, school, tier, consumableId, direction, path, desiredRange } = action || {};
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
      return executeMove(combatState, actor, { direction, path, targetId, desiredRange }, rngCursor, context);
    case 'swap':
      return executeSwap(combatState, actor, targetId);
    case 'condition':
      return executeCondition(combatState, actor, action, rngCursor, context);
    case 'end-turn':
      pushLog(combatState, { type: 'end-turn', actorId });
      actor.ap = 0;
      return { success: true };
    case 'retreat': {
      const roll = rngCursor.nextInt('combat', 20) + 1;
      const success = roll >= 15;
      pushLog(combatState, { type: 'retreat', actorId, targetId, roll, success });
      actor.ap = 0;
      if (success) {
        combatState.ended = true;
        combatState.result = 'retreat';
        combatState.retreatPayload = buildRetreatPayload(combatState, actorId);
      }
      return { success, retreated: success, retreatPayload: success ? combatState.retreatPayload : null };
    }
    case 'wait':
      actor.ap = 0;
      pushLog(combatState, { type: 'wait', actorId });
      return { success: true };
    default:
      return { success: false, reason: 'invalid-action' };
  }
}

export function endTurn(combatState, actorId, context = {}) {
  const actor = combatState.combatants.get(actorId);
  if (!actor || actor.hp <= 0) return { success: false, reason: 'invalid-actor' };
  if (combatState.turnOrder[combatState.currentTurn] !== actorId) return { success: false, reason: 'invalid-turn' };
  pushLog(combatState, { type: 'end-turn', actorId });
  actor.ap = 0;
  return { success: true };
}

// Move up to MOVE_RANGE cells along an ordered `path` of direction names. Callers may pass
// `path` (array, length 1..MOVE_RANGE), a lone `direction` (wrapped to `[direction]`, back-compat
// with pre-path AI), or a `targetId` fallback (`pathToward` → BFS shortest path up to
// MOVE_RANGE steps, stopping when within Chebyshev `desiredRange` of the target;
// `desiredRange` defaults to 1 = adjacent when the action doesn't declare one). Panicked always overrides with a single
// fleeDirection step. The whole path is pre-validated (walls, corner rule, occupancy); a single
// illegal step rejects the entire request without moving. On success the walk executes
// step-by-step, resolving opportunity attacks per threatened departure; a lethal OA stops the
// walk on the last cell actually reached.
function executeMove(combatState, actor, { direction, path, targetId, desiredRange }, rngCursor, context) {
  if (!actor.moveAvailable) return { success: false, reason: 'no-move' };
  if (hasCondition(actor, 'immobilized')) return { success: false, reason: 'immobilized' };
  if (!combatState.window) return { success: false, reason: 'no-window' };

  let effectivePath;
  if (hasCondition(actor, 'panicked')) {
    const flee = fleeDirection(combatState, actor);
    if (!flee) return { success: false, reason: 'invalid-direction' };
    effectivePath = [flee];
  } else if (Array.isArray(path) && path.length > 0) {
    effectivePath = path;
  } else if (direction) {
    effectivePath = [direction];
  } else if (targetId) {
    const range = Number.isFinite(desiredRange) && desiredRange >= 1 ? Math.floor(desiredRange) : 1;
    const walk = pathToward(combatState, actor, targetId, MOVE_RANGE, range);
    if (!walk) return { success: false, reason: 'invalid-direction' };
    effectivePath = walk;
  } else {
    return { success: false, reason: 'invalid-direction' };
  }

  if (effectivePath.length > MOVE_RANGE) return { success: false, reason: 'illegal-cell' };

  // Pre-validate the whole path first — a single bad step rejects with no movement or logs.
  const origin = { ...actor.position };
  let sim = { x: origin.x, y: origin.y };
  for (const name of effectivePath) {
    const delta = DIRECTIONS[name];
    if (!delta) return { success: false, reason: 'invalid-direction' };
    if (!legalStep(combatState.window, sim, delta)) return { success: false, reason: 'illegal-cell' };
    const dest = { x: sim.x + delta.dx, y: sim.y + delta.dy };
    if (cellOccupied(combatState.combatants, dest.x, dest.y, actor.id)) return { success: false, reason: 'illegal-cell' };
    sim = dest;
  }

  const phasing = signatureEffectsFor(actor, 'move', context).some(effect => effect.parameters?.ignoreOpportunityAttacks);
  const triggeredAttacks = [];
  const walked = [];
  let died = false;
  for (const name of effectivePath) {
    if (actor.hp <= 0) { died = true; break; }
    const delta = DIRECTIONS[name];
    const stepFrom = { ...actor.position };
    const stepTo = { x: stepFrom.x + delta.dx, y: stepFrom.y + delta.dy };
    const reactors = phasing ? [] : getOpportunityAttackers(actor, stepFrom, stepTo, combatState);
    for (const reactor of reactors) {
      if (actor.hp <= 0) break;
      triggeredAttacks.push(performAttackRoll(combatState, reactor, actor, rngCursor, context, { allowReactions: false, trigger: 'opportunity' }).sequence);
    }
    if (actor.hp <= 0) { died = true; break; }
    actor.position = stepTo;
    walked.push(name);
  }

  if (died) {
    pushLog(combatState, {
      type: 'move', actorId: actor.id, direction: effectivePath[0], path: walked,
      steps: walked.length, from: origin, to: null, cancelled: true, triggeredAttacks
    });
    return { success: false, reason: 'dead', triggeredAttacks };
  }

  actor.moveAvailable = false;
  pushLog(combatState, {
    type: 'move', actorId: actor.id, direction: effectivePath[0], path: [...effectivePath],
    steps: effectivePath.length, from: origin, to: { ...actor.position }, triggeredAttacks
  });
  return { success: true, position: { ...actor.position }, triggeredAttacks };
}

function executeSwap(combatState, actor, targetId) {
  if (!actor.swapAvailable) return { success: false, reason: 'no-swap' };
  const ally = combatState.combatants.get(targetId);
  if (!ally || ally.id === actor.id || ally.hp <= 0 || ally.side !== actor.side) return { success: false, reason: 'invalid-target' };
  if (!actor.position || !ally.position || distanceCells(actor.position, ally.position) !== 1) return { success: false, reason: 'not-adjacent' };

  const actorPosition = actor.position;
  actor.position = ally.position;
  ally.position = actorPosition;
  actor.swapAvailable = false;
  pushLog(combatState, { type: 'swap', actorId: actor.id, withId: ally.id });
  return { success: true };
}

function executeCondition(combatState, actor, action, rngCursor, context) {
  const target = combatState.combatants.get(action.targetId);
  if (!target || target.hp <= 0) return { success: false, reason: 'invalid-target' };
  const conditionsData = context.conditionsData?.conditions || context.conditionsData;
  const dc = Number.isFinite(action.dc) ? action.dc : 10 + modifier(actor.attributes?.foc ?? 5);
  const natural = rngCursor.nextInt('combat', 20) + 1;
  const saveModifier = modifier(target.attributes?.foc ?? 5);
  const total = natural + saveModifier;
  const saved = total >= dc;
  const attempt = { type: 'condition', actorId: actor.id, targetId: target.id, conditionId: action.conditionId, dc, save: { natural, modifier: saveModifier, total, attribute: 'foc', success: saved } };
  if (saved) {
    attempt.applied = false;
    pushLog(combatState, attempt);
    actor.ap -= 1;
    return { success: true, saved: true, applied: false };
  }
  const result = applyCondition(target, action.conditionId, { dc, noSave: action.conditionId === 'marked' }, rngCursor, conditionsData);
  attempt.applied = Boolean(result.applied);
  attempt.shielded = Boolean(result.shielded);
  attempt.events = result.events ?? [];
  pushLog(combatState, attempt);
  actor.ap -= 1;
  return { success: true, saved: false, applied: attempt.applied, shielded: attempt.shielded, events: attempt.events };
}

function pushLog(combatState, entry) {
  entry.sequence = combatState.log.length;
  combatState.log.push(entry);
  return entry;
}

function sideMates(combatState, actor) {
  return [...combatState.combatants.values()].filter(other => other.side === actor.side && other.hp > 0);
}

function classFor(actor, context) {
  return context?.classData ?? context?.classesData?.classes?.find(entry => entry.id === actor?.classId);
}

// Resolved, tier-gated class-signature effects for one hook (e.g. Breacher's BREACH ignoring
// cover on 'attack', Ghost's PHASE suppressing reactions on 'move'). Gracefully returns no
// effects when the caller doesn't supply class data — signature integration outside these two
// named hooks is out of this session's scope.
function signatureEffectsFor(actor, hook, context) {
  const capabilities = getSignatureCapabilities(actor, classFor(actor, context));
  return applySignatureModifier(hook, {}, capabilities).effects;
}

// Shared by on-turn attacks and reactions (opportunity attacks, fumble counters) so both paths
// get identical range/cover/flank/crit resolution and logging. Never touches AP — callers that
// spend an action (executeAttack) decrement it themselves; reactions never do.
function performAttackRoll(combatState, attacker, target, rngCursor, context, options = {}) {
  const conditionsData = context.conditionsData?.conditions || context.conditionsData;
  const weapon = attacker.weapon || UNARMED_WEAPON;
  const isMelee = weapon.rangeBand === 'adjacent';
  const distance = distanceCells(attacker.position, target.position);
  const positioned = distance !== null;
  const ignoresCover = options.ignoreCover ?? signatureEffectsFor(attacker, 'attack', context).some(effect => effect.parameters?.ignoreCover);
  const range = positioned
    ? evaluateRange(weapon, distance)
    : { legal: true, band: weapon.rangeBand ?? null, accuracyModifier: weapon.accuracyBonus || 0, reason: 'unpositioned' };

  const roll = rngCursor.nextInt('combat', 20) + 1;
  const attribute = isMelee ? 'mgt' : 'fin';
  const attributeModifier = modifier(attacker.attributes?.[attribute] ?? 3);
  const attackerEffects = getConditionEffects(attacker, conditionsData);
  const blindedPenalty = !isMelee ? (attackerEffects.rangedPenalty || 0) : 0;
  const targetEffects = getConditionEffects(target, conditionsData);
  const markedBonus = targetEffects.attackBonusAgainst || 0;
  const coverBonus = positioned && !ignoresCover ? getEdgeCoverBonus(combatState.window, attacker, target) : 0;
  const flanked = positioned && isFlanked(target, sideMates(combatState, attacker), combatState.window);
  const flankBonus = flanked ? FLANK_ATTACK_BONUS : 0;

  const total = roll + attributeModifier + (range.accuracyModifier ?? 0) + markedBonus + blindedPenalty + flankBonus;
  const defense = Math.max(targetEffects.defenseFloor, (target.defense || 10) + coverBonus + targetEffects.defenseBonus + targetEffects.defensePenalty);

  const isCrit = roll === 20;
  const isFumble = roll === 1;
  const hit = range.legal && !isFumble && (isCrit || total >= defense);

  const dieSize = parseInt(weapon.damageDie?.slice(1) || '6', 10);
  let damage = 0;
  let damageRoll = null;
  if (hit) {
    if (isCrit) {
      damage = dieSize;
    } else {
      damageRoll = rollDice(rngCursor, 1, dieSize);
      damage = damageRoll;
    }
    if (isMelee) damage += attributeModifier;
    // A landed hit must matter. Low-MGT attackers (e.g. Drone, mgt 3 → mod −2) rolling low on a
    // d6 would otherwise floor to 0 damage on a successful hit; floor at 1 instead so any hit
    // registers. Applies to all successful hits — melee, ranged, protocol-driven — matching the
    // owner's rule "minimum 1 damage on a successful hit". Guarded by `if (hit)` above, so
    // misses and fumbles still deal 0 (they never reach this line).
    damage = Math.max(1, damage);
    if (targetEffects.damageMultiplier > 1) damage = Math.floor(damage * targetEffects.damageMultiplier);
    target.hp -= damage;
  }

  const triggeredAttacks = [];
  const entry = pushLog(combatState, {
    type: 'attack',
    actorId: attacker.id,
    targetId: target.id,
    die: 'd20',
    naturalRoll: roll,
    attribute,
    attributeModifier,
    weaponAccuracy: range.accuracyModifier ?? 0,
    markedBonus,
    blindedPenalty,
    flanked,
    flankBonus,
    coverBonus,
    range: { distance, band: range.band, legal: range.legal },
    roll: total,
    targetDefense: defense,
    hit,
    crit: isCrit,
    fumble: isFumble,
    damage,
    damageDie: weapon.damageDie ?? null,
    damageRoll,
    trigger: options.trigger ?? null,
    triggeredAttacks
  });

  if (hit) {
    for (const hook of weapon.effects?.onHit?.conditions ?? []) {
      if (hook.trigger === 'critical' && !isCrit) continue;
      if (hook.trigger !== 'critical' && hook.trigger !== 'hit') continue;
      if (hook.chance != null && hook.chance < 1
        && rngCursor.nextInt('combat', 100) >= Math.round(hook.chance * 100)) {
        entry.procs = entry.procs ?? [];
        entry.procs.push({ conditionId: hook.conditionId, trigger: hook.trigger, chanceFailed: true });
        continue;
      }
      let saveResult = null;
      if (hook.save) {
        const dc = 10 + (isMelee
          ? modifier(attacker.attributes?.mgt ?? 3)
          : modifier((attacker.effectiveAttributes ?? attacker.attributes)?.fin ?? 3));
        const natural = rngCursor.nextInt('combat', 20) + 1;
        const saveModifier = modifier(target.attributes?.[hook.save] ?? 5);
        saveResult = { natural, modifier: saveModifier, total: natural + saveModifier, dc, attribute: hook.save, success: natural + saveModifier >= dc };
      }
      entry.procs = entry.procs ?? [];
      if (saveResult?.success) { entry.procs.push({ conditionId: hook.conditionId, trigger: hook.trigger, save: saveResult, applied: false }); continue; }
      const result = applyCondition(target, hook.conditionId, {}, rngCursor, conditionsData);
      entry.procs.push({ conditionId: hook.conditionId, trigger: hook.trigger, save: saveResult, applied: Boolean(result.applied), shielded: Boolean(result.shielded) });
    }
  }

  if (target.hp <= 0) {
    target.hp = 0;
    pushLog(combatState, { type: 'death', actorId: attacker.id, targetId: target.id });
  }

  if (isFumble && options.allowReactions !== false) {
    for (const reactor of getOpportunityAttackers(attacker, attacker.position, null, combatState)) {
      if (attacker.hp <= 0) break;
      triggeredAttacks.push(performAttackRoll(combatState, reactor, attacker, rngCursor, context, { allowReactions: false, trigger: 'fumble' }).sequence);
    }
  }

  return entry;
}

function executeAttack(combatState, actor, targetId, rngCursor, context) {
  const target = combatState.combatants.get(targetId);
  if (!target || target.hp <= 0) return { success: false, reason: 'invalid-target' };
  const entry = performAttackRoll(combatState, actor, target, rngCursor, context, {});
  actor.ap--;
  return { success: true, hit: entry.hit, damage: entry.damage, crit: entry.crit, fumble: entry.fumble };
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

  // AUDIT-2: honor a numeric protocol range when present. Every shipped protocol in
  // data/protocols.json today declares `range` as a human-readable string ("SIG×2",
  // "adjacent", "5 cells"), so `Number.isFinite` is false for every current data row and
  // this gate is a no-op for shipped content. When a future protocol adopts a numeric
  // range, this check enforces it. Skips when either side lacks placed geometry — same
  // rule performAttackRoll uses for the attack range gate.
  if (target && Number.isFinite(protocolData.range) && actor.position && target.position) {
    if (distanceCells(actor.position, target.position) > protocolData.range) {
      return { success: false, reason: 'out-of-range' };
    }
  }

  const conditionsData = context.conditionsData?.conditions || context.conditionsData;
  const result = overclock
    ? overclockProtocol(actor, school, tier, target, context.protocolsData, conditionsData, rngCursor)
    : castProtocol(actor, school, tier, target, context.protocolsData, conditionsData, rngCursor);
  if (result.success) {
    pushLog(combatState, { type: 'protocol', actorId: actor.id, targetId, school, tier, overclocked: overclock, result: result.result });
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
    pushLog(combatState, { type: 'item', actorId: actor.id, targetId, consumableId: itemId, result });
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
        if (!actionResult.success) {
          // A blocked AI intent (fully walled off, no legal target, etc.) used to silently
          // consume the turn — the LOG feed showed nothing while enemies just skipped their
          // action. Emit an explicit wait so the log reflects what happened; the standalone
          // `wait` action already logs itself, so we only synthesize one for a failure.
          pushLog(combatState, { type: 'wait', actorId: actor.id, reason: actionResult.reason });
          actor.ap = 0;
        }
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
  if (actor.archetypeId === 'choir' && Number.isFinite(actor.charge) && Number.isFinite(actor.chargeMax)) {
    actor.charge = Math.min(actor.chargeMax, actor.charge + 1);
  }

  const tickResults = tickConditions(actor, 'start_turn', rngCursor, context.conditionsData?.conditions || context.conditionsData);
  for (const result of tickResults) {
    if (result.type !== 'damage' || result.amount <= 0) continue;
    actor.hp -= result.amount;
    pushLog(combatState, { type: 'condition-damage', actorId: actor.id, source: result.source, amount: result.amount });
    if (actor.hp <= 0) {
      actor.hp = 0;
      pushLog(combatState, { type: 'death', actorId: actor.id, cause: 'condition' });
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
    if (!combatState.victoryPayload) combatState.victoryPayload = buildVictoryPayload(combatState);
  } else if (partyAlive === 0) {
    combatState.ended = true;
    combatState.result = 'wipe';
  }
  return { ended: combatState.ended, result: combatState.result };
}

function buildVictoryPayload(combatState) {
  const defeatedSpawnIds = [];
  const reclaimableGear = [];
  for (const actor of combatState.combatants.values()) {
    if (actor.side === 'enemy' && actor.hp <= 0) {
      defeatedSpawnIds.push(actor.id);
      if (actor.archetypeId === 'echo' && actor.equipment) {
        for (const slot of ['weapon', 'armor', 'offhand']) {
          if (actor.equipment[slot]) reclaimableGear.push(actor.equipment[slot]);
        }
      }
    }
  }
  return {
    defeatedSpawnIds,
    reclaimableGear,
    forfeitableLoot: combatState.forfeitableLoot || [],
    reason: 'combat-victory'
  };
}

function buildRetreatPayload(combatState, actorId) {
  return {
    retreated: true,
    actorId,
    forfeitableLoot: combatState.forfeitableLoot || [],
    reason: 'retreat'
  };
}

export function getCharacterDeaths(combatState) {
  const deaths = [];
  for (const actor of combatState.combatants.values()) {
    if (actor.side === 'party' && actor.hp <= 0 && !actor._deathRecorded) {
      actor._deathRecorded = true;
      const partyAlive = [...combatState.combatants.values()].filter(c => c.side === 'party' && c.hp > 0).length;
      if (partyAlive > 0) {
        deaths.push({ characterId: actor.id, character: { ...actor } });
      }
    }
  }
  return deaths;
}

const SNAPSHOT_ATTRIBUTE_KEYS = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
const NEVER_RETREAT = new Set(['drone', 'construct', 'apex']);
const ARMOR_FIN_PENALTY = -1;
const ARMOR_DEFENSE_BONUS = 3;

// Standard-archetype enemies are a pure function of (archetypeId, depth) via
// data/enemies.json — every field except the RNG-picked sigilCodepoint. The
// runtime uses this to re-derive attributes/defense/behavior/etc. on restore
// so the v4 combat-snapshot codec doesn't have to persist them. Must stay in
// lockstep with createEnemy in ./enemies.js (excluding sigil pick + id
// synthesis); the parity test in tests/integration/combat-snapshot-stats.test.js
// catches drift. Returns null for unknown or non-derivable archetypes (echoes
// inherit party-character attributes and stay persisted in the snapshot).
export function deriveEnemyStats(archetypeId, depth, enemiesData) {
  if (typeof archetypeId !== 'string' || archetypeId === 'echo') return null;
  const archetype = enemiesData?.archetypes?.[archetypeId];
  if (!archetype || !archetype.attributes) return null;
  const attributes = { ...archetype.attributes };
  const effectiveFin = attributes.fin + (archetype.armored ? ARMOR_FIN_PENALTY : 0);
  const baseHp = attributes.vit * 4 + (archetype.hpBonus || 0);
  const baseDefense = 10 + modifier(effectiveFin) + (archetype.armored ? ARMOR_DEFENSE_BONUS : 0);
  const baseProtocolDefense = 10 + modifier(attributes.foc);
  return {
    archetypeId,
    attributes,
    behavior: archetype.behavior,
    protocolAccess: archetype.protocolAccess ?? null,
    retreats: Boolean(archetype.retreats && !NEVER_RETREAT.has(archetypeId)),
    defense: scaleEnemyStat(baseDefense, depth),
    protocolDefense: scaleEnemyStat(baseProtocolDefense, depth),
    hpMax: scaleEnemyStat(baseHp, depth),
    chargeMax: archetypeId === 'choir' ? attributes.res * 2 + depth : 0,
    actionSlotsPerRound: archetypeId === 'apex' ? 2 : 1
  };
}

// v4 combat snapshot: standard archetypes carry only per-instance state
// (hpMax/chargeMax/sigilCodepoint) since the template is derivable; echoes
// still carry the full inline block because their attributes come from the
// dead party character, not from any archetype. `snapshotEnemyStats` mirrors
// that split so decode → snapshot → derive round-trips without loss.
function snapshotEnemyStats(actor) {
  const archetypeId = typeof actor.archetypeId === 'string' ? actor.archetypeId : 'other';
  const hpMax = Math.max(0, Math.min(1_000_000, Math.floor(actor.hpMax ?? actor.hp ?? 0)));
  const chargeMax = Math.max(0, Math.min(1_000_000, Math.floor(actor.chargeMax ?? actor.charge ?? 0)));
  const sigilCodepoint = Math.max(0, Math.min(0x10FFFF, Math.floor(actor.sigilCodepoint ?? 0xE030)));
  if (archetypeId !== 'echo') {
    return { archetypeId, hpMax, chargeMax, sigilCodepoint };
  }
  const source = actor.attributes || {};
  const attributes = {};
  for (const key of SNAPSHOT_ATTRIBUTE_KEYS) {
    const value = Math.floor(source[key] ?? 5);
    attributes[key] = Math.max(1, Math.min(255, value));
  }
  return {
    archetypeId,
    attributes,
    defense: Math.max(0, Math.min(65535, Math.floor(actor.defense ?? 10))),
    protocolDefense: Math.max(0, Math.min(65535, Math.floor(actor.protocolDefense ?? 10))),
    hpMax,
    chargeMax,
    behavior: typeof actor.behavior === 'string' ? actor.behavior : 'echo',
    retreats: Boolean(actor.retreats),
    protocolAccess: actor.protocolAccess ?? null,
    sigilCodepoint
  };
}

export function toCombatSnapshot(combatState) {
  if (!combatState || combatState.ended) return null;
  const actors = [];
  const initiativeOrder = [];
  // Apex actors (actionSlotsPerRound === 2) appear twice in turnOrder — the
  // second slot is inserted by buildTurnOrder. We keep BOTH slots in
  // initiativeOrder (the v5 codec accepts up to 2 references per actor) but
  // emit each unique actor exactly once in actors[]. Prior to v5 the double
  // slot tripped the codec's duplicate_actor check, blocking any real save
  // that contained an apex.
  const seenActorIds = new Set();
  for (const id of combatState.turnOrder) {
    const actor = combatState.combatants.get(id);
    if (!actor || actor.hp <= 0) continue;
    initiativeOrder.push(id);
    if (seenActorIds.has(actor.id)) continue;
    seenActorIds.add(actor.id);
    const entry = {
      id: actor.id,
      side: actor.side,
      x: actor.position?.x ?? 0,
      y: actor.position?.y ?? 0,
      hp: Math.max(0, Math.min(255, actor.hp)),
      charge: Math.max(0, Math.min(255, actor.charge ?? 0)),
      conditions: (actor.conditions || []).map(c => ({ id: c.id ?? c.conditionId, conditionId: c.id ?? c.conditionId, duration: c.duration ?? 0, stacks: c.stacks ?? 1 })),
      initiative: actor.initiative ?? 0,
      ap: Math.max(0, Math.min(7, actor.ap ?? 0)),
      moves: actor.moveAvailable ? 1 : 0,
      freeActions: 0,
      defeated: actor.hp <= 0,
      retreated: Boolean(actor.retreated)
    };
    if (actor.side !== 'party') entry.stats = snapshotEnemyStats(actor);
    actors.push(entry);
  }
  const window = combatState.window;
  return {
    arena: {
      originX: window?.originX ?? 0,
      originY: window?.originY ?? 0,
      contactId: combatState.id ?? 'combat'
    },
    actors,
    initiativeOrder,
    currentIndex: Math.max(0, Math.min(Math.max(0, initiativeOrder.length - 1), combatState.currentTurn)),
    round: Math.max(1, combatState.round ?? 1),
    pendingEffects: [],
    encounter: {
      id: combatState.id ?? 'encounter',
      type: combatState.kind ?? 'standard'
    },
    eventOrder: combatState.log.length
  };
}
