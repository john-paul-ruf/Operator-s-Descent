import { enemyStatScale } from './scaling.js';
import { modifier } from './attributes.js';
import { distanceCells, getEdgeCoverBonus, findApproachPath, flankStepCandidates, hasLineOfSight } from './combat-geometry.js';

const NEVER_RETREAT = new Set(['drone', 'construct', 'apex']);
const NULL_CONDITIONS = ['jammed', 'overloaded', 'immobilized', 'panicked', 'marked'];
const NULL_WEIGHTS = [3, 3, 1, 1, 1];
const NULL_WEIGHT_TOTAL = NULL_WEIGHTS.reduce((sum, w) => sum + w, 0);
const ARMOR_FIN_PENALTY = -1;
const ARMOR_DEFENSE_BONUS = 3;
const RETREAT_HP_RATIO = 0.25;
// Kept in lockstep with combat.js:MOVE_RANGE — the executor caps every move at 5 cells;
// AI paths beyond that either truncate or fall through to the targetId hunt fallback.
const MOVE_RANGE = 5;

export function scaleEnemyStat(baseStat, depth) {
  return enemyStatScale(baseStat, depth);
}

export function createEnemy(archetypeId, depth, rngCursor, enemiesData, options = {}) {
  const archetype = enemiesData.archetypes[archetypeId];
  if (!archetype) return null;

  const attributes = { ...archetype.attributes };
  const effectiveFin = attributes.fin + (archetype.armored ? ARMOR_FIN_PENALTY : 0);

  const baseHp = attributes.vit * 4 + archetype.hpBonus;
  const baseDefense = 10 + modifier(effectiveFin) + (archetype.armored ? ARMOR_DEFENSE_BONUS : 0);
  const baseProtocolDefense = 10 + modifier(attributes.foc);

  const enemy = {
    id: `enemy_${depth}_${archetypeId}_${rngCursor.getCursor('gen')}`,
    archetypeId,
    name: archetype.name,
    role: archetype.role,
    attributes,
    depth,
    armored: archetype.armored,
    behavior: archetype.behavior,
    conditions: [],
    protocolAccess: archetype.protocolAccess || null,
    retreats: archetype.retreats && !NEVER_RETREAT.has(archetypeId),
    side: 'enemy',
    ap: 2,
    actionSlotsPerRound: archetypeId === 'apex' ? 2 : 1,
    hpMax: scaleEnemyStat(baseHp, depth),
    defense: scaleEnemyStat(baseDefense, depth),
    protocolDefense: scaleEnemyStat(baseProtocolDefense, depth),
    meleeAttackBonus: scaleEnemyStat(modifier(attributes.mgt), depth),
    rangedAttackBonus: scaleEnemyStat(modifier(effectiveFin), depth),
    protocolAttackBonus: scaleEnemyStat(modifier(attributes.foc), depth),
    initiativeMod: modifier(effectiveFin)
  };
  enemy.hp = enemy.hpMax;
  enemy.chargeMax = archetypeId === 'choir' ? attributes.res * 2 + depth : 0;
  enemy.charge = enemy.chargeMax;

  const sigilIdx = rngCursor.nextInt('gen', 3);
  enemy.sigilCodepoint = archetype.sigilCodepoints[sigilIdx];

  if (options.position) enemy.position = { ...options.position };

  return enemy;
}

export function createEcho(deadCharacter, encounterDepth) {
  const attributes = { ...deadCharacter.attributes };
  const enemy = {
    id: `echo_${deadCharacter.id}_${encounterDepth}`,
    archetypeId: 'echo',
    name: 'Echo',
    attributes,
    depth: encounterDepth,
    armored: false,
    behavior: 'echo',
    conditions: [],
    side: 'enemy',
    ap: 2,
    classId: deadCharacter.classId,
    sigilCodepoint: deadCharacter.sigilCodepoint,
    equipment: deadCharacter.equipment ? { ...deadCharacter.equipment } : null,
    signatureTier: deadCharacter.signatureTier || 1,
    isEcho: true,
    retreats: false
  };

  enemy.hpMax = scaleEnemyStat(deadCharacter.hpMax || 20, encounterDepth);
  enemy.hp = enemy.hpMax;
  enemy.defense = scaleEnemyStat(deadCharacter.defense || 10, encounterDepth);
  enemy.protocolDefense = scaleEnemyStat(deadCharacter.protocolDefense || 10, encounterDepth);
  enemy.meleeAttackBonus = scaleEnemyStat(deadCharacter.meleeAccuracy ?? modifier(attributes.mgt), encounterDepth);
  enemy.rangedAttackBonus = scaleEnemyStat(deadCharacter.rangedAccuracy ?? modifier(attributes.fin), encounterDepth);
  enemy.protocolAttackBonus = scaleEnemyStat(deadCharacter.protocolAccuracy ?? modifier(attributes.foc), encounterDepth);
  enemy.initiativeMod = modifier(attributes.fin);
  enemy.chargeMax = scaleEnemyStat(deadCharacter.chargeMax || 0, encounterDepth);
  enemy.charge = enemy.chargeMax;

  return enemy;
}

// Chebyshev distance between two actors, or null when either lacks placed geometry
// (no tactical grid wired yet). Thin wrapper over distanceCells that unpacks positions.
function chebyshev(a, b) {
  return distanceCells(a?.position, b?.position);
}

// Treats unknown distance as maximally far for target-selection ordering only.
function orderedDistance(a, b) {
  const value = chebyshev(a, b);
  return value === null ? Infinity : value;
}

function nearestLowestHP(from, candidates) {
  return candidates.reduce((best, candidate) => {
    if (!best) return candidate;
    const bestDistance = orderedDistance(from, best);
    const candidateDistance = orderedDistance(from, candidate);
    if (candidateDistance < bestDistance) return candidate;
    if (candidateDistance === bestDistance && candidate.hp < best.hp) return candidate;
    return best;
  }, null);
}

function selectPriorityTarget(enemy, combatants, partyMembers) {
  const primary = nearestLowestHP(enemy, partyMembers);
  const protectedAlly = combatants.find(
    c => c.side === enemy.side && c.id !== enemy.id && c.hp > 0 && (c.behavior === 'artillery' || c.behavior === 'controller')
  );
  if (protectedAlly) {
    const threat = nearestLowestHP(protectedAlly, partyMembers);
    const threatDistance = threat ? chebyshev(protectedAlly, threat) : null;
    if (threat && threat.id !== primary.id && threatDistance !== null && threatDistance <= 2) return threat;
  }
  return primary;
}

function choirAction(enemy, target) {
  for (let tier = Math.min(3, enemy.protocolAccess?.maxTier || 3); tier >= 1; tier--) {
    if (enemy.charge >= tier * 2) {
      return { type: 'cast', actorId: enemy.id, targetId: target.id, school: 'disrupt', tier };
    }
  }
  return { type: 'attack', actorId: enemy.id, targetId: target.id };
}

function nullAction(enemy, target, combatState, rngCursor) {
  const onCooldown = enemy.nullCooldownRound === combatState.round;
  if (onCooldown) return { type: 'attack', actorId: enemy.id, targetId: target.id };

  let roll = rngCursor.nextInt('combat', NULL_WEIGHT_TOTAL);
  let conditionId = NULL_CONDITIONS[NULL_CONDITIONS.length - 1];
  for (let index = 0; index < NULL_CONDITIONS.length; index++) {
    if (roll < NULL_WEIGHTS[index]) {
      conditionId = NULL_CONDITIONS[index];
      break;
    }
    roll -= NULL_WEIGHTS[index];
  }
  enemy.nullCooldownRound = combatState.round + 1;
  const dc = 10 + modifier(enemy.attributes.foc);
  return { type: 'condition', actorId: enemy.id, targetId: target.id, conditionId, dc, apCost: 1 };
}

// Capability-aware engage range. Every enemy attack is melee via UNARMED_WEAPON (combat.js:12,
// maxRange 1) — the only ranged options are Choir casting DISRUPT (band 3) and Null applying
// a condition (band 2). FR-43 says a drained Choir "falls back to a melee attack" and a Null
// on cooldown "uses its melee attack"; both scenarios drop engage range back to 1 here so the
// AI closes to strike instead of standing at stand-off range whiffing every turn. LOS extends
// that principle: if a solid wall blocks the ranged option from the caster's current cell,
// fall through to melee range so the AI closes instead of standing at stand-off attempting
// an action the weapon-attack path would refuse anyway. When `target` isn't known (legacy
// caller shape) or geometry is missing, the LOS check is skipped — behavior matches pre-LOS.
function engageRange(enemy, combatState, target) {
  const window = combatState?.window;
  const canReach = !target?.position || !enemy.position || hasLineOfSight(window, enemy.position, target.position);
  if (enemy.archetypeId === 'choir' && enemy.protocolAccess && (enemy.charge ?? 0) >= 2 && canReach) return 3;
  if (enemy.archetypeId === 'null' && enemy.protocolAccess && enemy.nullCooldownRound !== combatState.round && canReach) return 2;
  return 1;
}

// Closure suitable for combat-geometry BFS predicates: cells with a living non-self actor
// count as occupied. Mirrors combat.js:cellOccupied without creating a rules→rules cycle.
function isOccupiedFor(combatState, excludeId) {
  return (x, y) => {
    for (const actor of combatState.combatants.values()) {
      if (actor.id === excludeId) continue;
      if (actor.hp <= 0 || !actor.position) continue;
      if (actor.position.x === x && actor.position.y === y) return true;
    }
    return false;
  };
}

function nearestHostile(enemy, combatants) {
  let best = null;
  let bestDistance = Infinity;
  for (const other of combatants) {
    if (!other || other.id === enemy.id) continue;
    if (other.side === enemy.side || other.hp <= 0 || !other.position) continue;
    const dist = chebyshev(enemy, other);
    if (dist === null) continue;
    if (dist < bestDistance) { bestDistance = dist; best = other; }
  }
  return best ? { hostile: best, distance: bestDistance } : null;
}

// Pick a reachable cell within the caster's band around `target` that maximizes distance from
// `hostile`, ties → higher edge-cover from the priority target, then cell-iteration order.
// Only returns a path that actually escapes adjacency (distance-from-hostile > 1); a "kite"
// that leaves us next to the same threat isn't a kite. Iterates a (2*range+1)² band and
// checks reachability per candidate via findApproachPath — cheap for band ≤ 3 and window ≤ 8x16.
function pickKitePath(enemy, target, hostile, combatState, range) {
  const window = combatState?.window;
  if (!window || !enemy.position || !target?.position || !hostile?.position) return null;
  const occupied = isOccupiedFor(combatState, enemy.id);
  let bestPath = null;
  let bestDistFromHostile = -Infinity;
  let bestCover = -Infinity;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > range) continue;
      const cell = { x: target.position.x + dx, y: target.position.y + dy };
      const path = findApproachPath(window, occupied, enemy.position, cell, 0);
      if (!path || path.length === 0 || path.length > MOVE_RANGE) continue;
      const distFromHostile = Math.max(
        Math.abs(cell.x - hostile.position.x),
        Math.abs(cell.y - hostile.position.y)
      );
      const cover = getEdgeCoverBonus(window, { position: cell }, target);
      if (distFromHostile > bestDistFromHostile
          || (distFromHostile === bestDistFromHostile && cover > bestCover)) {
        bestDistFromHostile = distFromHostile;
        bestCover = cover;
        bestPath = path;
      }
    }
  }
  return bestDistFromHostile > 1 ? bestPath : null;
}

function maybeKitePath(enemy, target, combatants, combatState, range) {
  const nearest = nearestHostile(enemy, combatants);
  if (!nearest || nearest.distance > 1) return null; // Only kite when a hostile is adjacent.
  return pickKitePath(enemy, target, nearest.hostile, combatState, range);
}

// Melee attackers within striking distance may seek a flank first. Returns the shortest BFS
// path to a legal flank cell (tie → flankStepCandidates iteration order, which is fixed
// NEIGHBOR_STEPS order). Truncated to MOVE_RANGE so a distant flank still emits a legal move.
function pickFlankPath(enemy, target, combatants, combatState) {
  const window = combatState?.window;
  if (!window || !enemy.position || !target?.position) return null;
  const allies = combatants.filter(c => c.side === enemy.side && c.id !== enemy.id && c.hp > 0);
  if (allies.length === 0) return null;
  const occupied = isOccupiedFor(combatState, enemy.id);
  const candidates = flankStepCandidates(window, occupied, target, allies);
  let bestPath = null;
  for (const cell of candidates) {
    const path = findApproachPath(window, occupied, enemy.position, cell, 0);
    if (path && (!bestPath || path.length < bestPath.length)) bestPath = path;
  }
  if (!bestPath || bestPath.length === 0) return null;
  return bestPath.slice(0, MOVE_RANGE);
}

export function enemyAI(enemy, combatState, rngCursor, context = {}) {
  const combatants = [...combatState.combatants.values()];
  const partyMembers = combatants.filter(c => c.side === 'party' && c.hp > 0);

  if (partyMembers.length === 0) {
    return { type: 'wait', actorId: enemy.id };
  }

  if (enemy.retreats && enemy.hp < enemy.hpMax * RETREAT_HP_RATIO) {
    return { type: 'retreat', actorId: enemy.id };
  }

  const target = selectPriorityTarget(enemy, combatants, partyMembers);
  const range = engageRange(enemy, combatState, target);
  const distance = chebyshev(enemy, target);
  const canMove = enemy.moveAvailable !== false;

  // Beyond engage range → close (or hunt around walls) toward the target. Melee attackers
  // prefer a flank cell when the target is within a single move + 1 of them.
  if (distance !== null && distance > range && canMove) {
    if (range === 1 && distance <= MOVE_RANGE + 1) {
      const flank = pickFlankPath(enemy, target, combatants, combatState);
      if (flank) return { type: 'move', actorId: enemy.id, path: flank };
    }
    return { type: 'move', actorId: enemy.id, targetId: target.id, desiredRange: range };
  }

  // Within engage range → execute the archetype-specific ability.
  if (enemy.archetypeId === 'choir' && enemy.protocolAccess) {
    if (canMove && (enemy.charge ?? 0) >= 2) {
      const kite = maybeKitePath(enemy, target, combatants, combatState, range);
      if (kite) return { type: 'move', actorId: enemy.id, path: kite };
    }
    return choirAction(enemy, target);
  }
  if (enemy.archetypeId === 'null' && enemy.protocolAccess) {
    const offCooldown = enemy.nullCooldownRound !== combatState.round;
    if (canMove && offCooldown) {
      const kite = maybeKitePath(enemy, target, combatants, combatState, range);
      if (kite) return { type: 'move', actorId: enemy.id, path: kite };
    }
    return nullAction(enemy, target, combatState, rngCursor);
  }
  return { type: 'attack', actorId: enemy.id, targetId: target.id };
}
