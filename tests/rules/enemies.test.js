import { describe, it, expect } from 'vitest';
import {
  scaleEnemyStat,
  createEnemy,
  enemyAI,
  createEcho,
} from '../../src/rules/enemies.js';
import { enemyStatScale, lootRarityShift } from '../../src/rules/scaling.js';
import { modifier, deriveStats } from '../../src/rules/attributes.js';
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

describe('createEnemy — attribute cap', () => {
  it('every scaled attribute <= 10 at high depth (40)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('construct', 40, cursor, enemiesData);
    for (const val of Object.values(enemy.attributes)) {
      expect(val).toBeLessThanOrEqual(10);
    }
  });
});

describe('createEnemy — HP formula', () => {
  it('hpMax === scaledVit * 4 + hpBonus + depth, hp === hpMax', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 5, cursor, enemiesData);
    const arch = enemiesData.archetypes.drone;
    const scaledVit = Math.min(10, enemyStatScale(arch.attributes.vit, 5));
    expect(enemy.hpMax).toBe(scaledVit * 4 + arch.hpBonus + 5);
    expect(enemy.hp).toBe(enemy.hpMax);
  });
});

describe('createEnemy — charge', () => {
  it('archetype with protocolAccess → chargeMax === res*2 + depth', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 3, cursor, enemiesData);
    expect(enemy.chargeMax).toBe(enemy.attributes.res * 2 + 3);
    expect(enemy.charge).toBe(enemy.chargeMax);
  });
  it('archetype without protocolAccess → chargeMax 0', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 3, cursor, enemiesData);
    expect(enemy.chargeMax).toBe(0);
  });
});

describe('createEnemy — defense', () => {
  it('armored → 10 + modifier(fin) + 3', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('construct', 1, cursor, enemiesData);
    expect(enemy.defense).toBe(10 + modifier(enemy.attributes.fin) + 3);
  });
  it('non-armored → 10 + modifier(fin)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    expect(enemy.defense).toBe(10 + modifier(enemy.attributes.fin));
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

describe('createEnemy — null archetype', () => {
  it('creates successfully', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('null', 1, cursor, enemiesData);
    expect(enemy).not.toBeNull();
    expect(enemy.name).toBe('Null');
  });
});

function mockCombatState(party) {
  const combatants = new Map();
  for (const c of party) combatants.set(c.id, c);
  return { combatants };
}

describe('enemyAI — no living party', () => {
  it('returns {type: "wait"}', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    const state = mockCombatState([{ id: 'p1', side: 'party', hp: 0 }]);
    expect(enemyAI(enemy, state, cursor)).toEqual({ type: 'wait', actorId: enemy.id });
  });
});

describe('enemyAI — nearest targeting', () => {
  it('targets closer party member', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const far = { id: 'far', side: 'party', hp: 30, position: { x: 5, y: 0 } };
    const near = { id: 'near', side: 'party', hp: 30, position: { x: 2, y: 0 } };
    const state = mockCombatState([far, near]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.targetId).toBe('near');
  });
  it('missing position on either side → distance 99 fallback, first member wins reduce', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    const p1 = { id: 'p1', side: 'party', hp: 30 };
    const p2 = { id: 'p2', side: 'party', hp: 30 };
    const state = mockCombatState([p1, p2]);
    expect(() => enemyAI(enemy, state, cursor)).not.toThrow();
  });
});

describe('enemyAI — artillery behavior', () => {
  it('artillery + protocolAccess + charge >= 4 → cast disrupt tier 2', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 5;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([{ id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.type).toBe('cast');
    expect(action.school).toBe('disrupt');
    expect(action.tier).toBe(2);
  });
  it('artillery + charge 3 → falls through to attack', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 3;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([{ id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.type).toBe('attack');
  });
});

describe('enemyAI — controller behavior', () => {
  it('controller + protocolAccess → attack (never cast)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('null', 5, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([{ id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.type).toBe('attack');
  });
});

describe('enemyAI — retreat on low hp', () => {
  it('hp < 25% hpMax + retreats → retreat', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('stalker', 1, cursor, enemiesData);
    enemy.hp = 1;
    enemy.hpMax = 100;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([{ id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.type).toBe('retreat');
  });
  it('hp < 25% + retreats false → attack', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    enemy.hp = 1;
    enemy.hpMax = 100;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([{ id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.type).toBe('attack');
  });
});

describe('enemyAI — default', () => {
  it('default → attack nearest', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([{ id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
    const action = enemyAI(enemy, state, cursor);
    expect(action.type).toBe('attack');
    expect(action.targetId).toBe('p1');
  });
});

describe('createEcho', () => {
  it('depth 4, hpMax 20 → echo hpMax 32, full hp', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, hpMax: 20, defense: 10, classId: 'breacher', sigilCodepoint: 0xE000, signatureTier: 2 };
    const echo = createEcho(dead, 4);
    const scaleMult = 1 + 4 * (0.15 + 0.10 * Math.floor(4 / 10));
    expect(echo.hpMax).toBe(Math.floor(20 * scaleMult));
    expect(echo.hp).toBe(echo.hpMax);
    expect(echo.hpMax).toBe(32);
  });
  it('defense === base + floor(scaleMult * 2)', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10 };
    const echo = createEcho(dead, 4);
    const scaleMult = 1 + 4 * 0.15;
    expect(echo.defense).toBe(10 + Math.floor(scaleMult * 2));
  });
  it('copies attributes as fresh object (mutate echo, source unchanged)', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10 };
    const echo = createEcho(dead, 4);
    echo.attributes.mgt = 99;
    expect(dead.attributes.mgt).toBe(5);
  });
  it('carries classId, sigilCodepoint, signatureTier', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10, classId: 'breacher', sigilCodepoint: 57344, signatureTier: 3 };
    const echo = createEcho(dead, 4);
    expect(echo.classId).toBe('breacher');
    expect(echo.sigilCodepoint).toBe(57344);
    expect(echo.signatureTier).toBe(3);
  });
  it('signatureTier defaults to 1', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10 };
    const echo = createEcho(dead, 4);
    expect(echo.signatureTier).toBe(1);
  });
  it('equipment cloned or null', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10, equipment: { weapon: 'sidearm' } };
    const echo = createEcho(dead, 4);
    expect(echo.equipment).toEqual({ weapon: 'sidearm' });
    expect(echo.equipment).not.toBe(dead.equipment);
    const dead2 = { id: 'char_b', attributes: { mgt: 5 }, hpMax: 20, defense: 10 };
    const echo2 = createEcho(dead2, 4);
    expect(echo2.equipment).toBeNull();
  });
  it('isEcho: true, id === echo_<id>_<depth>', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, hpMax: 20, defense: 10 };
    const echo = createEcho(dead, 7);
    expect(echo.isEcho).toBe(true);
    expect(echo.id).toBe('echo_char_a_7');
  });
  it('missing hpMax → base 20 fallback', () => {
    const dead = { id: 'char_a', attributes: { mgt: 5 }, defense: 10 };
    const echo = createEcho(dead, 4);
    const scaleMult = 1 + 4 * 0.15;
    expect(echo.hpMax).toBe(Math.floor(20 * scaleMult));
  });
});