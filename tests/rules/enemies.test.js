import { describe, it, expect } from 'vitest';
import {
  scaleEnemyStat,
  createEnemy,
  enemyAI,
  createEcho,
} from '../../src/rules/enemies.js';
import { enemyStatScale } from '../../src/rules/scaling.js';
import { modifier } from '../../src/rules/attributes.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { loadData } from '../helpers/data.js';

const enemiesData = loadData('enemies');

describe('scaleEnemyStat', () => {
  it('delegates to enemyStatScale', () => {
    expect(scaleEnemyStat(10, 5)).toBe(enemyStatScale(10, 5));
  });
});

describe('createEnemy — unknown archetype', () => {
  it('returns null', () => {
    const cursor = createRNGCursorForRun(1);
    expect(createEnemy('nonexistent', 1, cursor, enemiesData)).toBeNull();
  });
});

describe('createEnemy — drone at depth 1', () => {
  it('copies name/role/behavior/retreats, conditions empty, side enemy', () => {
    const cursor = createRNGCursorForRun(1);
    const cursorBefore = cursor.getCursor('gen');
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    expect(enemy.name).toBe('Drone');
    expect(enemy.role).toBe('Swarm minion');
    expect(enemy.behavior).toBe('aggressive');
    expect(enemy.retreats).toBe(false);
    expect(enemy.conditions).toEqual([]);
    expect(enemy.side).toBe('enemy');
    expect(enemy.id).toBe(`enemy_1_drone_${cursorBefore}`);
  });
});

describe('createEnemy — raw attributes stay frozen 1-10', () => {
  it('attributes equal archetype attributes exactly, unaffected by depth', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('construct', 40, cursor, enemiesData);
    expect(enemy.attributes).toEqual(enemiesData.archetypes.construct.attributes);
  });
  it('never retreats regardless of data at drone/construct/apex', () => {
    const cursor = createRNGCursorForRun(1);
    for (const id of ['drone', 'construct', 'apex']) {
      expect(createEnemy(id, 1, cursor, enemiesData).retreats).toBe(false);
    }
  });
});

describe('createEnemy — HP formula', () => {
  it('hpMax === scaleEnemyStat(vit*4 + hpBonus, depth), hp === hpMax', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 5, cursor, enemiesData);
    const arch = enemiesData.archetypes.drone;
    const baseHp = arch.attributes.vit * 4 + arch.hpBonus;
    expect(enemy.hpMax).toBe(scaleEnemyStat(baseHp, 5));
    expect(enemy.hp).toBe(enemy.hpMax);
  });
});

describe('createEnemy — charge', () => {
  it('choir → chargeMax === res*2 + depth', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 3, cursor, enemiesData);
    expect(enemy.chargeMax).toBe(enemy.attributes.res * 2 + 3);
    expect(enemy.charge).toBe(enemy.chargeMax);
  });
  it('non-choir → chargeMax 0 (null has no CHARGE, only conditions)', () => {
    const cursor = createRNGCursorForRun(1);
    expect(createEnemy('drone', 3, cursor, enemiesData).chargeMax).toBe(0);
    expect(createEnemy('null', 3, cursor, enemiesData).chargeMax).toBe(0);
  });
});

describe('createEnemy — defense/protocolDefense scale by depth, armor applies FIN penalty', () => {
  it('armored (construct): defense = scaleEnemyStat(10 + modifier(fin-1) + 3, depth)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('construct', 7, cursor, enemiesData);
    const arch = enemiesData.archetypes.construct;
    const expected = scaleEnemyStat(10 + modifier(arch.attributes.fin - 1) + 3, 7);
    expect(enemy.defense).toBe(expected);
  });
  it('non-armored (drone): defense = scaleEnemyStat(10 + modifier(fin), depth)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 7, cursor, enemiesData);
    const arch = enemiesData.archetypes.drone;
    expect(enemy.defense).toBe(scaleEnemyStat(10 + modifier(arch.attributes.fin), 7));
  });
  it('protocolDefense = scaleEnemyStat(10 + modifier(foc), depth)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('null', 12, cursor, enemiesData);
    const arch = enemiesData.archetypes.null;
    expect(enemy.protocolDefense).toBe(scaleEnemyStat(10 + modifier(arch.attributes.foc), 12));
  });
});

describe('createEnemy — attack bonuses and initiative', () => {
  it('meleeAttackBonus/rangedAttackBonus/protocolAttackBonus scale, initiativeMod does not', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('stalker', 21, cursor, enemiesData);
    const arch = enemiesData.archetypes.stalker;
    expect(enemy.meleeAttackBonus).toBe(scaleEnemyStat(modifier(arch.attributes.mgt), 21));
    expect(enemy.rangedAttackBonus).toBe(scaleEnemyStat(modifier(arch.attributes.fin), 21));
    expect(enemy.protocolAttackBonus).toBe(scaleEnemyStat(modifier(arch.attributes.foc), 21));
    expect(enemy.initiativeMod).toBe(modifier(arch.attributes.fin));
  });
});

describe('createEnemy — threshold cumulative multiplier (depth 10 vs 9)', () => {
  it('scaling jumps at threshold floors per FR-40', () => {
    const cursor = createRNGCursorForRun(1);
    const arch = enemiesData.archetypes.warden;
    const baseHp = arch.attributes.vit * 4 + arch.hpBonus;
    expect(scaleEnemyStat(baseHp, 9)).toBe(Math.floor(baseHp * (1 + 9 * 0.15)));
    expect(scaleEnemyStat(baseHp, 10)).toBe(Math.floor(baseHp * (1 + 10 * 0.25)));
  });
});

describe('createEnemy — actionSlotsPerRound', () => {
  it('apex gets 2, others get 1', () => {
    const cursor = createRNGCursorForRun(1);
    expect(createEnemy('apex', 10, cursor, enemiesData).actionSlotsPerRound).toBe(2);
    expect(createEnemy('drone', 10, cursor, enemiesData).actionSlotsPerRound).toBe(1);
  });
});

describe('createEnemy — options.position', () => {
  it('sets a cloned position when provided', () => {
    const cursor = createRNGCursorForRun(1);
    const pos = { x: 3, y: 4 };
    const enemy = createEnemy('drone', 1, cursor, enemiesData, { position: pos });
    expect(enemy.position).toEqual(pos);
    expect(enemy.position).not.toBe(pos);
  });
});

describe('createEnemy — sigil', () => {
  it('sigil drawn from codepoints[0..2] via one gen draw (cursor advances by 1)', () => {
    for (const seed of [1, 2, 3]) {
      const cursor = createRNGCursorForRun(seed);
      const before = cursor.getCursor('gen');
      const enemy = createEnemy('drone', 1, cursor, enemiesData);
      expect(cursor.getCursor('gen')).toBe(before + 1);
      expect(enemiesData.archetypes.drone.sigilCodepoints).toContain(enemy.sigilCodepoint);
    }
  });
});

function mockCombatState(combatantList, round = 1) {
  const combatants = new Map();
  for (const c of combatantList) combatants.set(c.id, c);
  return { combatants, round };
}

describe('enemyAI — no living party', () => {
  it('returns {type: "wait"}', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    const state = mockCombatState([{ id: 'p1', side: 'party', hp: 0 }]);
    expect(enemyAI(enemy, state, cursor)).toEqual({ type: 'wait', actorId: enemy.id });
  });
});

describe('enemyAI — nearest targeting with lowest-HP tiebreak', () => {
  it('targets closer party member', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const far = { id: 'far', side: 'party', hp: 30, position: { x: 5, y: 0 } };
    const near = { id: 'near', side: 'party', hp: 30, position: { x: 2, y: 0 } };
    const state = mockCombatState([enemy, far, near]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.targetId).toBe('near');
  });
  it('tie in distance breaks to lowest HP', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const tough = { id: 'tough', side: 'party', hp: 30, position: { x: 1, y: 0 } };
    const hurt = { id: 'hurt', side: 'party', hp: 5, position: { x: 0, y: 1 } };
    const state = mockCombatState([enemy, tough, hurt]);
    expect(enemyAI(enemy, state, cursor).targetId).toBe('hurt');
  });
});

describe('enemyAI — retreat exceptions', () => {
  it('stalker below 25% hp retreats', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('stalker', 1, cursor, enemiesData);
    enemy.hp = 1;
    enemy.hpMax = 100;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
    expect(enemyAI(enemy, state, cursor).type).toBe('retreat');
  });
  it('drone/construct/apex never retreat even below 25% hp', () => {
    const cursor = createRNGCursorForRun(1);
    for (const id of ['drone', 'construct', 'apex']) {
      const enemy = createEnemy(id, 1, cursor, enemiesData);
      enemy.hp = 1;
      enemy.hpMax = 100;
      enemy.position = { x: 0, y: 0 };
      const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
      expect(enemyAI(enemy, state, cursor).type).not.toBe('retreat');
    }
  });
});

describe('enemyAI — protects allied Choir/Null at medium priority', () => {
  it('targets the threat nearest the endangered caster instead of its own nearest', () => {
    const cursor = createRNGCursorForRun(1);
    const warden = createEnemy('warden', 1, cursor, enemiesData);
    warden.position = { x: 10, y: 10 };
    const choir = createEnemy('choir', 1, cursor, enemiesData);
    choir.position = { x: 0, y: 0 };
    const nearWarden = { id: 'near_warden', side: 'party', hp: 30, position: { x: 9, y: 10 } };
    const threatensChoir = { id: 'threatens_choir', side: 'party', hp: 30, position: { x: 1, y: 0 } };
    const state = mockCombatState([warden, choir, nearWarden, threatensChoir]);
    expect(enemyAI(warden, state, cursor).targetId).toBe('threatens_choir');
  });
});

describe('enemyAI — move toward optimal range then attack once in range', () => {
  it('moves when farther than optimal range', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 3, y: 0 } };
    const state = mockCombatState([enemy, target]);
    expect(enemyAI(enemy, state, cursor).type).toBe('move');
  });
  it('attacks once within optimal range', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } };
    const state = mockCombatState([enemy, target]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.type).toBe('attack');
    expect(action.targetId).toBe('p1');
  });
});

describe('enemyAI — Choir casts the highest affordable tier of DISRUPT, else melee', () => {
  it('charge 6 → tier 3', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 6;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 5, y: 0 } }]);
    const action = enemyAI(enemy, state, cursor);
    expect(action).toMatchObject({ type: 'cast', school: 'disrupt', tier: 3, targetId: 'p1' });
  });
  it('charge 5 → tier 2', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 5;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 5, y: 0 } }]);
    expect(enemyAI(enemy, state, cursor)).toMatchObject({ type: 'cast', tier: 2 });
  });
  it('charge 3 → tier 1', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 3;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 5, y: 0 } }]);
    expect(enemyAI(enemy, state, cursor)).toMatchObject({ type: 'cast', tier: 1 });
  });
  it('charge 1 → melee fallback', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 1;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 5, y: 0 } }]);
    expect(enemyAI(enemy, state, cursor).type).toBe('attack');
  });
});

describe('enemyAI — Null applies a weighted condition, then cooldowns to melee', () => {
  it('returns a condition action with a deterministic weighted conditionId, dc, and 1 AP cost', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('null', 5, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } };
    const state = mockCombatState([enemy, target], 1);
    const action = enemyAI(enemy, state, cursor);
    expect(action.type).toBe('condition');
    expect(['jammed', 'overloaded', 'immobilized', 'panicked', 'marked']).toContain(action.conditionId);
    expect(action.dc).toBe(10 + modifier(enemy.attributes.foc));
    expect(action.apCost).toBe(1);
  });
  it('falls back to melee on the round immediately after applying a condition', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('null', 5, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } };
    const round1 = mockCombatState([enemy, target], 1);
    expect(enemyAI(enemy, round1, cursor).type).toBe('condition');
    const round2 = mockCombatState([enemy, target], 2);
    expect(enemyAI(enemy, round2, cursor).type).toBe('attack');
    const round3 = mockCombatState([enemy, target], 3);
    expect(enemyAI(enemy, round3, cursor).type).toBe('condition');
  });
});

describe('createEcho', () => {
  it('scales hpMax/defense/protocolDefense by the FR-40/FR-43 Echo formula', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, hpMax: 20, defense: 10, protocolDefense: 10, classId: 'breacher', sigilCodepoint: 0xE000, signatureTier: 2 };
    const echo = createEcho(dead, 4);
    expect(echo.hpMax).toBe(scaleEnemyStat(20, 4));
    expect(echo.hp).toBe(echo.hpMax);
    expect(echo.defense).toBe(scaleEnemyStat(10, 4));
    expect(echo.protocolDefense).toBe(scaleEnemyStat(10, 4));
  });
  it('freezes raw attributes as a fresh object (mutate echo, source unchanged)', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10 };
    const echo = createEcho(dead, 4);
    echo.attributes.mgt = 99;
    expect(dead.attributes.mgt).toBe(5);
  });
  it('carries classId, sigilCodepoint, signatureTier (defaults to 1)', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10, classId: 'breacher', sigilCodepoint: 57344, signatureTier: 3 };
    const echo = createEcho(dead, 4);
    expect(echo.classId).toBe('breacher');
    expect(echo.sigilCodepoint).toBe(57344);
    expect(echo.signatureTier).toBe(3);
    const noTier = createEcho({ id: 'char_b', attributes: { mgt: 5 }, hpMax: 20, defense: 10 }, 4);
    expect(noTier.signatureTier).toBe(1);
  });
  it('clones equipment or leaves it null; never grants unused consumables/calibrations', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10, equipment: { weapon: 'sidearm' } };
    const echo = createEcho(dead, 4);
    expect(echo.equipment).toEqual({ weapon: 'sidearm' });
    expect(echo.equipment).not.toBe(dead.equipment);
    expect(echo.consumables).toBeUndefined();
    expect(echo.calibrationCount).toBeUndefined();
    const dead2 = { id: 'char_b', attributes: { mgt: 5 }, hpMax: 20, defense: 10 };
    expect(createEcho(dead2, 4).equipment).toBeNull();
  });
  it('isEcho: true, never retreats, id === echo_<id>_<depth>', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10 };
    const echo = createEcho(dead, 7);
    expect(echo.isEcho).toBe(true);
    expect(echo.retreats).toBe(false);
    expect(echo.id).toBe('echo_char_a_7');
  });
  it('missing hpMax → base 20 fallback before scaling', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, defense: 10 };
    const echo = createEcho(dead, 4);
    expect(echo.hpMax).toBe(scaleEnemyStat(20, 4));
  });
});
