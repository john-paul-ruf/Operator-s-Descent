import { enemyStatScale } from './scaling.js';
import { modifier } from './attributes.js';

const NEVER_RETREAT = new Set(['drone', 'construct', 'apex']);
const OPTIMAL_RANGE = { aggressive: 1, defensive: 1, flanking: 2, artillery: 3, controller: 2, phasing: 2, 'multi-action': 1 };
const NULL_CONDITIONS = ['jammed', 'overloaded', 'immobilized', 'panicked', 'marked'];
const NULL_WEIGHTS = [3, 3, 1, 1, 1];
const NULL_WEIGHT_TOTAL = NULL_WEIGHTS.reduce((sum, w) => sum + w, 0);
const ARMOR_FIN_PENALTY = -1;
const ARMOR_DEFENSE_BONUS = 3;
const RETREAT_HP_RATIO = 0.25;

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

// Chebyshev distance, or null when either side lacks placed geometry (no tactical grid wired yet).
function chebyshev(a, b) {
  if (!a.position || !b.position) return null;
  return Math.max(Math.abs(a.position.x - b.position.x), Math.abs(a.position.y - b.position.y));
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

  if (enemy.archetypeId === 'choir' && enemy.protocolAccess) return choirAction(enemy, target);
  if (enemy.archetypeId === 'null' && enemy.protocolAccess) return nullAction(enemy, target, combatState, rngCursor);

  const optimalRange = OPTIMAL_RANGE[enemy.behavior] ?? 1;
  const rangeToTarget = chebyshev(enemy, target);
  if (rangeToTarget !== null && rangeToTarget > optimalRange) {
    return { type: 'move', actorId: enemy.id, targetId: target.id };
  }
  return { type: 'attack', actorId: enemy.id, targetId: target.id };
}
