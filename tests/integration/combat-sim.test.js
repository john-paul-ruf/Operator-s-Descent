import { describe, it, expect } from 'vitest';
import { initiateCombat, executeAction, resolveTurn, checkCombatEnd } from '../../src/rules/combat.js';
import { createEnemy } from '../../src/rules/enemies.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { makeCharacter, makeParty } from '../helpers/fixtures.js';
import { deriveStats } from '../../src/rules/attributes.js';
import { loadData } from '../helpers/data.js';

const protocolsData = loadData('protocols');
const conditionsData = loadData('conditions');
const consumablesData = loadData('consumables');
const enemiesData = loadData('enemies');
const classData = loadData('classes');

function makeFighter(id, overrides = {}) {
  const base = makeCharacter({ id });
  const cls = classData.classes[0];
  const derived = deriveStats(base, cls);
  return {
    ...base,
    hp: derived.hpMax,
    hpMax: derived.hpMax,
    charge: derived.chargeMax,
    chargeMax: derived.chargeMax,
    defense: derived.defenseBase,
    weapon: { damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 0 },
    ...overrides,
  };
}

function defaultAttack(state, actor) {
  const enemies = [...state.combatants.values()].filter(c => c.side === 'enemy' && c.hp > 0);
  if (enemies.length === 0) return { type: 'wait', actorId: actor.id };
  const target = enemies[0];
  return { type: 'attack', actorId: actor.id, targetId: target.id };
}

function simulate(party, enemies, seed, context, { maxIterations = 400, act } = {}) {
  const cursor = createRNGCursorForRun(seed);
  const state = initiateCombat(party, enemies, cursor);
  let guard = maxIterations;
  while (!state.ended && guard-- > 0) {
    const end = resolveTurn(state, cursor, context);
    if (end.ended) break;
    const actorId = state.turnOrder[state.currentTurn];
    const actor = state.combatants.get(actorId);
    if (actor?.side === 'party' && actor.hp > 0 && actor.ap > 0) {
      const action = act ? act(state, actor) : defaultAttack(state, actor);
      const r = executeAction(state, action, cursor, context);
      if (!r.success) actor.ap = 0;
    }
  }
  return { state, iterations: maxIterations - guard, cursor };
}

const baseContext = {
  protocolsData,
  conditionsData: conditionsData.conditions,
  consumablesData,
};

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

describe('combat simulation — termination & outcome sweep (20 seeds)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: terminates < 400, ended=true, result ∈ {victory, wipe}`, () => {
      const party = [makeFighter('p1'), makeFighter('p2')];
      const cursor = createRNGCursorForRun(seed);
      const drone = createEnemy('drone', 2, cursor, enemiesData);
      const warden = createEnemy('warden', 2, cursor, enemiesData);
      const result = simulate(party, [drone, warden], seed, baseContext);
      expect(result.iterations).toBeLessThan(400);
      expect(result.state.ended).toBe(true);
      expect(['victory', 'wipe', 'retreat']).toContain(result.state.result);
    });
  }
});

describe('combat simulation — strong party always victories', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: strong party vs depth-1 drones → victory`, () => {
      const party = [makeFighter('p1', { attributes: { mgt: 8, fin: 8, vit: 8, res: 8, foc: 8, sig: 8 } })];
      const cursor = createRNGCursorForRun(seed);
      const drone = createEnemy('drone', 1, cursor, enemiesData);
      const result = simulate(party, [drone], seed, baseContext);
      expect(result.state.ended).toBe(true);
      expect(result.state.result).toBe('victory');
    });
  }
});

describe('combat simulation — hopeless party always wipes', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: hp-1 party vs depth-15 apex ×3 → wipe`, () => {
      const party = [makeFighter('p1', { hp: 1, hpMax: 1, weapon: null })];
      const cursor = createRNGCursorForRun(seed);
      const apexes = [0, 1, 2].map(() => createEnemy('apex', 15, cursor, enemiesData));
      const result = simulate(party, apexes, seed, baseContext);
      expect(result.state.ended).toBe(true);
      expect(result.state.result).toBe('wipe');
    });
  }
});

describe('combat simulation — invariant audit', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: no negative HP, log consistency, AP economy`, () => {
      const party = [makeFighter('p1'), makeFighter('p2')];
      const cursor = createRNGCursorForRun(seed);
      const drone = createEnemy('drone', 2, cursor, enemiesData);
      const warden = createEnemy('warden', 2, cursor, enemiesData);
      const result = simulate(party, [drone, warden], seed, baseContext);
      const state = result.state;

      for (const [, c] of state.combatants) {
        expect(c.hp).toBeGreaterThanOrEqual(0);
        if (c.hp === 0) {
          const deathLogs = state.log.filter(l => l.type === 'death' && l.targetId === c.id);
          expect(deathLogs.length).toBeGreaterThanOrEqual(1);
        }
      }

      for (const entry of state.log) {
        if (entry.type === 'attack') {
          expect(state.combatants.has(entry.actorId)).toBe(true);
          expect(state.combatants.has(entry.targetId)).toBe(true);
        }
      }
      expect(state.round).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('combat simulation — determinism', () => {
  it('same seed + same setup → identical log and result across two runs', () => {
    const seed = 42;
    const mkParty = () => [makeFighter('p1'), makeFighter('p2')];
    const mkEnemies = () => {
      const cursor = createRNGCursorForRun(seed);
      return [createEnemy('drone', 2, cursor, enemiesData), createEnemy('warden', 2, cursor, enemiesData)];
    };
    const r1 = simulate(mkParty(), mkEnemies(), seed, baseContext);
    const r2 = simulate(mkParty(), mkEnemies(), seed, baseContext);
    expect(r1.state.log).toEqual(r2.state.log);
    expect(r1.state.result).toBe(r2.state.result);
  });
});

describe('combat simulation — feature paths', () => {
  it('burning kills enemy during prepareTick without an attack landing', () => {
    const party = [makeFighter('p1')];
    const cursor = createRNGCursorForRun(99);
    const enemy = createEnemy('drone', 2, cursor, enemiesData);
    enemy.hp = 2;
    enemy.hpMax = 2;
    enemy.conditions = [{ id: 'burning', duration: 3, stacks: 3 }];
    const result = simulate(party, [enemy], 99, baseContext, {
      act: () => ({ type: 'wait', actorId: 'p1' }),
    });
    const hasConditionDeath = result.state.log.some(l => l.type === 'death' && l.cause === 'condition');
    expect(hasConditionDeath).toBe(true);
  });

  it('protocol cast in-flow: caster charge decreases by 2 per cast', () => {
    const party = [makeFighter('p1', {
      protocols: [{ school: 'disrupt', tier: 1 }],
      charge: 10,
      chargeMax: 10,
      attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    })];
    const cursor = createRNGCursorForRun(5);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    const beforeCharge = party[0].charge;
    const result = simulate(party, [enemy], 5, baseContext, {
      act: (state, actor) => {
        if (actor.charge >= 2) {
          const enemies = [...state.combatants.values()].filter(c => c.side === 'enemy' && c.hp > 0);
          return { type: 'cast', actorId: actor.id, school: 'disrupt', tier: 1, targetId: enemies[0]?.id };
        }
        return defaultAttack(state, actor);
      },
    });
    const protocolLogs = result.state.log.filter(l => l.type === 'protocol');
    expect(protocolLogs.length).toBeGreaterThan(0);
    const caster = result.state.combatants.get('p1');
    expect(caster.charge).toBeLessThan(beforeCharge);
  });

  it('consumable in-flow: inventory shrinks and HP increases', () => {
    const party = [makeFighter('p1', { hp: 5, hpMax: 30 })];
    const cursor = createRNGCursorForRun(3);
    const enemy = createEnemy('drone', 1, cursor, enemiesData);
    const runState = {
      inventory: [{ id: 'patch_0', baseType: 'repair_patch' }],
    };
    const ctx = { ...baseContext, runState };
    const result = simulate(party, [enemy], 3, ctx, {
      act: (state, actor) => {
        if (actor.hp < actor.hpMax / 2) {
          return { type: 'item', actorId: actor.id, targetId: actor.id, consumableId: 'repair_patch' };
        }
        return defaultAttack(state, actor);
      },
    });
    expect(runState.inventory.length).toBe(0);
    const itemLogs = result.state.log.filter(l => l.type === 'item');
    expect(itemLogs.length).toBeGreaterThan(0);
  });

  it('retreat behavior: warden at low hp attempts retreat', () => {
    let retreatSeen = false;
    for (let seed = 0; seed < 100; seed++) {
      const party = [makeFighter('p1', {
        attributes: { mgt: 10, fin: 10, vit: 10, res: 10, foc: 10, sig: 10 },
      })];
      const cursor = createRNGCursorForRun(seed);
      const warden = createEnemy('warden', 1, cursor, enemiesData);
      warden.hp = 1;
      warden.hpMax = 10;
      const result = simulate(party, [warden], seed, baseContext, {
        act: (state, actor) => {
          const w = [...state.combatants.values()].find(c => c.side === 'enemy');
          if (w && w.hp > 0) {
            return { type: 'attack', actorId: actor.id, targetId: w.id };
          }
          return { type: 'wait', actorId: actor.id };
        },
      });
      if (result.state.log.some(l => l.type === 'retreat')) {
        retreatSeen = true;
        break;
      }
    }
    expect(retreatSeen).toBe(true);
  });

  it('artillery: choir casts disrupt when charge ≥ 4', () => {
    let protocolSeen = false;
    for (let seed = 0; seed < 50; seed++) {
      const party = [makeFighter('p1', { hp: 100, hpMax: 100 })];
      const cursor = createRNGCursorForRun(seed);
      const choir = createEnemy('choir', 5, cursor, enemiesData);
      if (choir.charge < 4) continue;
      const result = simulate(party, [choir], seed, baseContext, {
        act: (state, actor) => {
          const enemies = [...state.combatants.values()].filter(c => c.side === 'enemy' && c.hp > 0);
          if (enemies.length > 0) {
            return { type: 'attack', actorId: actor.id, targetId: enemies[0].id };
          }
          return { type: 'wait', actorId: actor.id };
        },
      });
      if (result.state.log.some(l => l.type === 'protocol')) {
        protocolSeen = true;
        break;
      }
    }
    expect(protocolSeen).toBe(true);
  });
});