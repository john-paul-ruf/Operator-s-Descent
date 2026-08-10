import { enemyStatScale } from './scaling.js';
import { modifier, deriveStats } from './attributes.js';

export function scaleEnemyStat(baseStat, depth) {
  return enemyStatScale(baseStat, depth);
}

export function createEnemy(archetypeId, depth, rngCursor, enemiesData) {
  const archetype = enemiesData.archetypes[archetypeId];
  if (!archetype) return null;

  const enemy = {
    id: `enemy_${depth}_${archetypeId}_${rngCursor.getCursor('gen')}`,
    archetypeId,
    name: archetype.name,
    role: archetype.role,
    attributes: { ...archetype.attributes },
    depth,
    armored: archetype.armored,
    behavior: archetype.behavior,
    conditions: [],
    protocolAccess: archetype.protocolAccess || null,
    retreats: archetype.retreats,
    side: 'enemy'
  };

  for (const key of Object.keys(enemy.attributes)) {
    enemy.attributes[key] = Math.min(10, enemyStatScale(enemy.attributes[key], depth));
  }

  const hpFromVit = (enemy.attributes.vit * 4) + archetype.hpBonus;
  enemy.hpMax = hpFromVit + depth;
  enemy.hp = enemy.hpMax;
  enemy.chargeMax = enemy.protocolAccess ? enemy.attributes.res * 2 + depth : 0;
  enemy.charge = enemy.chargeMax;

  enemy.defense = 10 + modifier(enemy.attributes.fin) + (archetype.armored ? 3 : 0);
  enemy.protocolDefense = 10 + modifier(enemy.attributes.foc);

  const sigilIdx = rngCursor.nextInt('gen', 3);
  enemy.sigilCodepoint = archetype.sigilCodepoints[sigilIdx];

  return enemy;
}

export function enemyAI(enemy, combatState, rngCursor) {
  const partyMembers = [...combatState.combatants.values()].filter(
    c => c.side === 'party' && c.hp > 0
  );

  if (partyMembers.length === 0) {
    return { type: 'wait', actorId: enemy.id };
  }

  const target = partyMembers.reduce((nearest, member) => {
    const dist = distance(enemy, member);
    return dist < distance(enemy, nearest) ? member : nearest;
  });

  if (enemy.behavior === 'artillery' && enemy.protocolAccess) {
    const chargeForProtocol = enemy.charge >= 4;
    if (chargeForProtocol) {
      return { type: 'cast', actorId: enemy.id, targetId: target.id, school: 'disrupt', tier: 2 };
    }
  }

  if (enemy.behavior === 'controller' && enemy.protocolAccess) {
    return { type: 'attack', actorId: enemy.id, targetId: target.id };
  }

  if (enemy.hp < enemy.hpMax * 0.25 && enemy.retreats) {
    return { type: 'retreat', actorId: enemy.id };
  }

  return { type: 'attack', actorId: enemy.id, targetId: target.id };
}

export function createEcho(deadCharacter, echoDepth) {
  const enemy = {
    id: `echo_${deadCharacter.id}_${echoDepth}`,
    archetypeId: 'echo',
    name: 'Echo',
    attributes: { ...deadCharacter.attributes },
    depth: echoDepth,
    armored: false,
    behavior: 'echo',
    conditions: [],
    side: 'enemy',
    classId: deadCharacter.classId,
    sigilCodepoint: deadCharacter.sigilCodepoint,
    equipment: deadCharacter.equipment ? { ...deadCharacter.equipment } : null,
    signatureTier: deadCharacter.signatureTier || 1,
    isEcho: true
  };

  const scaleMult = 1 + echoDepth * (0.15 + 0.10 * Math.floor(echoDepth / 10));
  enemy.hpMax = Math.floor((deadCharacter.hpMax || 20) * scaleMult);
  enemy.hp = enemy.hpMax;
  enemy.defense = (deadCharacter.defense || 10) + Math.floor(scaleMult * 2);
  enemy.protocolDefense = (deadCharacter.protocolDefense || 10) + Math.floor(scaleMult * 2);

  return enemy;
}

function distance(a, b) {
  if (a.position && b.position) {
    return Math.max(Math.abs(a.position.x - b.position.x), Math.abs(a.position.y - b.position.y));
  }
  return 99;
}
