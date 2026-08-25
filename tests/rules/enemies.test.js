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

describe('enemyAI — move action carries capability-based desiredRange (Custom Rule 11: strengthened)', () => {
  // Old behavior scaled desiredRange by archetype behavior string (aggressive→1, flanking→2,
  // artillery→3, …). But every enemy attack in the game is melee via UNARMED_WEAPON in
  // combat.js:12 — so flanking/artillery/controller/phasing archetypes without CHARGE stood
  // off at Chebyshev 2 or 3 and auto-missed forever. The new rule: engage range depends on
  // the archetype's actually-usable range attack. Choir with CHARGE ≥ 2 → 3, Null off
  // cooldown → 2, everyone else (including a drained Choir or a Null on cooldown) → 1.
  const WEAPONLESS_BEHAVIORS = ['aggressive', 'defensive', 'flanking', 'artillery', 'controller', 'phasing', 'multi-action'];

  for (const behavior of WEAPONLESS_BEHAVIORS) {
    it(`weaponless enemy with behavior ${behavior} → desiredRange 1 (melee)`, () => {
      const cursor = createRNGCursorForRun(1);
      const enemy = {
        id: `mover_${behavior}`,
        side: 'enemy',
        hp: 30,
        hpMax: 30,
        behavior,
        attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
        position: { x: 0, y: 0 },
        retreats: false,
      };
      const target = { id: 'p1', side: 'party', hp: 30, position: { x: 7, y: 0 } };
      const action = enemyAI(enemy, mockCombatState([enemy, target]), cursor);
      expect(action).toMatchObject({ type: 'move', targetId: 'p1', desiredRange: 1, actorId: enemy.id });
    });
  }

  it('choir with CHARGE ≥ 2 → desiredRange 3 (casting band)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 3, cursor, enemiesData);
    enemy.charge = 4;
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 7, y: 0 } };
    const action = enemyAI(enemy, mockCombatState([enemy, target]), cursor);
    expect(action).toMatchObject({ type: 'move', targetId: 'p1', desiredRange: 3 });
  });

  it('drained choir (CHARGE < 2) → desiredRange 1 — closes to melee per FR-43', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 3, cursor, enemiesData);
    enemy.charge = 1;
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 7, y: 0 } };
    const action = enemyAI(enemy, mockCombatState([enemy, target]), cursor);
    expect(action).toMatchObject({ type: 'move', targetId: 'p1', desiredRange: 1 });
  });

  it('null off cooldown → desiredRange 2 (condition band)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('null', 3, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 7, y: 0 } };
    const action = enemyAI(enemy, mockCombatState([enemy, target], 1), cursor);
    expect(action).toMatchObject({ type: 'move', targetId: 'p1', desiredRange: 2 });
  });

  it('null on cooldown → desiredRange 1 — uses its melee attack per FR-43', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('null', 3, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    enemy.nullCooldownRound = 2;
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 7, y: 0 } };
    const action = enemyAI(enemy, mockCombatState([enemy, target], 2), cursor);
    expect(action).toMatchObject({ type: 'move', targetId: 'p1', desiredRange: 1 });
  });

  it('charged choir with a wall on the direct LOS → desiredRange 1 (closes instead of firing through the wall)', () => {
    // A wall cell at (3,0) sits on the straight line from (0,0) to (5,0) — LOS-blocked.
    // The charged choir must fall through to melee-close, not stand off attempting to cast
    // a spell the weapon-attack path (and, once SESSION-03 wires the seam, the protocol
    // path) would refuse for the same reason.
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 3, cursor, enemiesData);
    enemy.charge = 4;
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 5, y: 0 } };
    const window = { originX: 0, originY: 0, width: 8, height: 16,
      cells: Array.from({ length: 16 }, () => Array(8).fill(1)) };
    window.cells[0][3] = 0;
    const state = { combatants: new Map([[enemy.id, enemy], ['p1', target]]), round: 1, window };
    expect(enemyAI(enemy, state, cursor)).toMatchObject({ type: 'move', targetId: 'p1', desiredRange: 1 });
  });

  it('null off cooldown with a wall on the direct LOS → desiredRange 1 (closes instead of applying a condition through the wall)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('null', 3, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 5, y: 0 } };
    const window = { originX: 0, originY: 0, width: 8, height: 16,
      cells: Array.from({ length: 16 }, () => Array(8).fill(1)) };
    window.cells[0][3] = 0;
    const state = { combatants: new Map([[enemy.id, enemy], ['p1', target]]), round: 1, window };
    expect(enemyAI(enemy, state, cursor)).toMatchObject({ type: 'move', targetId: 'p1', desiredRange: 1 });
  });

  it('charged choir with a clear LOS → still desiredRange 3 (LOS gate composes with, not replaces, the charge check)', () => {
    // Same 8x16 window as the LOS-blocked test, but no walls. The charged choir must keep
    // its stand-off range 3 — proving the new LOS gate is a further gate on the ranged
    // branch, not an accidental replacement of it.
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 3, cursor, enemiesData);
    enemy.charge = 4;
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 5, y: 0 } };
    const window = { originX: 0, originY: 0, width: 8, height: 16,
      cells: Array.from({ length: 16 }, () => Array(8).fill(1)) };
    const state = { combatants: new Map([[enemy.id, enemy], ['p1', target]]), round: 1, window };
    expect(enemyAI(enemy, state, cursor)).toMatchObject({ type: 'move', targetId: 'p1', desiredRange: 3 });
  });

  it('pathing consumes no RNG — cursor unchanged across an AI call that emits a move action', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 7, y: 0 } };
    const combatBefore = cursor.getCursor('combat');
    const genBefore = cursor.getCursor('gen');
    const action = enemyAI(enemy, mockCombatState([enemy, target]), cursor);
    expect(action.type).toBe('move');
    expect(cursor.getCursor('combat')).toBe(combatBefore);
    expect(cursor.getCursor('gen')).toBe(genBefore);
  });
});

describe('enemyAI — Choir casts the highest affordable tier of DISRUPT, else melee (Custom Rule 11: targets placed within engage range — the old tests wrongly asserted cast intent from stand-off distance where the caster should first close)', () => {
  it('charge 6 within band → tier 3', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 6;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 3, y: 0 } }]);
    const action = enemyAI(enemy, state, cursor);
    expect(action).toMatchObject({ type: 'cast', school: 'disrupt', tier: 3, targetId: 'p1' });
  });
  it('charge 5 within band → tier 2', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 5;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 3, y: 0 } }]);
    expect(enemyAI(enemy, state, cursor)).toMatchObject({ type: 'cast', tier: 2 });
  });
  it('charge 3 within band → tier 1', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 3;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 3, y: 0 } }]);
    expect(enemyAI(enemy, state, cursor)).toMatchObject({ type: 'cast', tier: 1 });
  });
  it('charge 1 adjacent → melee attack (drained caster falls back to melee)', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('choir', 5, cursor, enemiesData);
    enemy.charge = 1;
    enemy.position = { x: 0, y: 0 };
    const state = mockCombatState([enemy, { id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } }]);
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

describe('enemyAI — stalker (behavior: flanking) attacks adjacent instead of standing at Chebyshev 2', () => {
  // Regression for the engage-range bug this session fixes. Stalker's old OPTIMAL_RANGE was 2,
  // but no enemy has a weapon → UNARMED_WEAPON caps at maxRange 1 → the attack was forced to
  // range.legal:false and hit was always false. Adjacent stalkers must attack.
  it('adjacent stalker emits attack, not a stand-off move', () => {
    const cursor = createRNGCursorForRun(1);
    const enemy = createEnemy('stalker', 1, cursor, enemiesData);
    enemy.position = { x: 0, y: 0 };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 1, y: 0 } };
    const action = enemyAI(enemy, mockCombatState([enemy, target]), cursor);
    expect(action).toEqual({ type: 'attack', actorId: enemy.id, targetId: 'p1' });
  });
});

describe('enemyAI — flank preference (deterministic path emission)', () => {
  // A melee enemy with a target within MOVE_RANGE+1 tries flankStepCandidates first: an
  // opposite-side ally + the moving enemy's future position = flanked target. The path
  // returned must be legal, deterministic, and end at a cell that isFlanked(target)==true.
  function windowWithWalls() {
    // 8x16 open combat window matching createStandardEncounter's fixed size.
    const cells = Array.from({ length: 16 }, () => Array(8).fill(1));
    return { originX: 0, originY: 0, width: 8, height: 16, cells };
  }

  function makeMock(actors, window, round = 1) {
    const combatants = new Map();
    for (const a of actors) combatants.set(a.id, a);
    return { combatants, round, window, turnOrder: actors.map(a => a.id) };
  }

  it('flanks with an existing side-mate on the opposite side', () => {
    const cursor = createRNGCursorForRun(1);
    const window = windowWithWalls();
    const attacker = { id: 'atk', side: 'enemy', hp: 30, hpMax: 30, behavior: 'aggressive',
      attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, position: { x: 5, y: 3 },
      retreats: false, moveAvailable: true };
    const ally = { id: 'ally', side: 'enemy', hp: 30, hpMax: 30, position: { x: 2, y: 3 } };
    const target = { id: 'p1', side: 'party', hp: 30, position: { x: 3, y: 3 } };
    const state = makeMock([attacker, ally, target], window);
    const action = enemyAI(attacker, state, cursor);
    expect(action.type).toBe('move');
    expect(Array.isArray(action.path)).toBe(true);
    // Walking the path from (5,3) must land on a cell that flanks the target with the ally.
    const DELTAS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
    let final = { x: 5, y: 3 };
    for (const dir of action.path) final = { x: final.x + DELTAS[dir][0], y: final.y + DELTAS[dir][1] };
    // Landing cell is adjacent to target and opposite the ally (ally at (2,3), target at (3,3)
    // → opposite adjacent is (4,3)).
    expect(final).toEqual({ x: 4, y: 3 });
  });

  it('two identical AI calls emit byte-identical flank paths (determinism)', () => {
    const window = windowWithWalls();
    const build = () => {
      const attacker = { id: 'atk', side: 'enemy', hp: 30, hpMax: 30, behavior: 'aggressive',
        attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, position: { x: 5, y: 3 },
        retreats: false, moveAvailable: true };
      const ally = { id: 'ally', side: 'enemy', hp: 30, hpMax: 30, position: { x: 2, y: 3 } };
      const target = { id: 'p1', side: 'party', hp: 30, position: { x: 3, y: 3 } };
      return { attacker, state: makeMock([attacker, ally, target], window) };
    };
    const a = build();
    const b = build();
    const cursorA = createRNGCursorForRun(1);
    const cursorB = createRNGCursorForRun(1);
    const actionA = enemyAI(a.attacker, a.state, cursorA);
    const actionB = enemyAI(b.attacker, b.state, cursorB);
    expect(actionA).toEqual(actionB);
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
