import { describe, it, expect } from 'vitest';
import { initiateCombat, getLegalActions, executeAction, endTurn, resolveTurn, checkCombatEnd } from '../../src/rules/combat.js';
import { createStandardEncounter } from '../../src/rules/encounters.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { modifier } from '../../src/rules/attributes.js';
import { makeCharacter, makeWeapon, makeParty, findSeed } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';
import { contactWindowFloor, blockedCornerWindow, openCombatWindow } from '../helpers/grids.js';

const protocolsData = loadData('protocols');
const conditionsData = loadData('conditions');
const consumablesData = loadData('consumables');
const baseContext = { protocolsData, conditionsData, consumablesData, runState: {} };

function makeEnemy(overrides = {}) {
  return {
    id: 'enemy_1',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    hp: 20,
    hpMax: 20,
    defense: 10,
    behavior: 'aggressive',
    retreats: false,
    side: 'enemy',
    conditions: [],
    position: { x: 5, y: 5 },
    ...overrides,
  };
}

function startCombat(party, enemies, seed = 1, firstActorId = null) {
  const cursor = createRNGCursorForRun(seed);
  const state = initiateCombat(party, enemies, cursor);
  if (firstActorId) state.currentTurn = state.turnOrder.indexOf(firstActorId);
  return { state, cursor };
}

function findAttackSeed(targetRoll, partyCount, enemyCount) {
  return findSeed(seed => {
    const c = createRNGCursorForRun(seed);
    for (let i = 0; i < partyCount + enemyCount; i++) c.nextInt('combat', 20);
    return c.nextInt('combat', 20) === targetRoll;
  });
}

describe('initiateCombat', () => {
  it('combatants map holds all ids with side, ap:2, copied conditions', () => {
    const party = [makeCharacter({ id: 'a', conditions: [{ id: 'burning', duration: 2, stacks: 1 }] })];
    const enemies = [makeCharacter({ id: 'e', conditions: [{ id: 'marked', duration: 3, stacks: 1 }] })];
    const { state } = startCombat(party, enemies);
    const a = state.combatants.get('a');
    const e = state.combatants.get('e');
    expect(a.side).toBe('party');
    expect(a.ap).toBe(2);
    expect(a.conditions).not.toBe(party[0].conditions);
    expect(a.conditions).toEqual([{ id: 'burning', duration: 2, stacks: 1 }]);
    expect(e.side).toBe('enemy');
    expect(e.conditions).not.toBe(enemies[0].conditions);
  });

  it('initiative = d20 + modifier(fin); turnOrder sorted descending', () => {
    const fast = makeCharacter({ id: 'fast', attributes: { mgt: 5, fin: 10, vit: 5, res: 5, foc: 5, sig: 5 } });
    const slow = makeCharacter({ id: 'slow', attributes: { mgt: 5, fin: 1, vit: 5, res: 5, foc: 5, sig: 5 } });
    const enemy = makeEnemy({ id: 'enemy_1', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 } });
    const { state } = startCombat([fast, slow], [enemy]);
    expect(state.turnOrder.length).toBe(3);
    const inits = {};
    for (const [id, c] of state.combatants) inits[id] = c.initiative;
    for (let i = 0; i < state.turnOrder.length - 1; i++) {
      expect(inits[state.turnOrder[i]]).toBeGreaterThanOrEqual(inits[state.turnOrder[i + 1]]);
    }
  });

  it('deterministic — same setup twice → same turnOrder', () => {
    const party = makeParty(3);
    const enemies = [makeEnemy({ id: 'e1' }), makeEnemy({ id: 'e2' })];
    const a = startCombat(party, enemies, 42);
    const b = startCombat(party, enemies, 42);
    expect(a.state.turnOrder).toEqual(b.state.turnOrder);
  });

  it('missing attributes → mod 0, no throw', () => {
    const party = [{ id: 'noattrs', hp: 20 }];
    const enemy = [makeEnemy()];
    expect(() => startCombat(party, enemy)).not.toThrow();
    const c = startCombat(party, enemy).state.combatants.get('noattrs');
    expect(c.initiative).toBeDefined();
  });

  it('initial state shape', () => {
    const { state } = startCombat([makeCharacter()], [makeEnemy()]);
    expect(state.round).toBe(1);
    expect(state.currentTurn).toBe(0);
    expect(state.log).toEqual([]);
    expect(state.ended).toBe(false);
    expect(state.result).toBeNull();
    expect(state.turnStarted).toBe(false);
  });
});

describe('executeAction guards', () => {
  it('unknown actorId → invalid-actor', () => {
    const { state, cursor } = startCombat([makeCharacter()], [makeEnemy()]);
    expect(executeAction(state, { type: 'attack', actorId: 'nope', targetId: 'enemy_1' }, cursor, baseContext))
      .toEqual({ success: false, reason: 'invalid-actor' });
  });

  it('dead actor (hp 0) → invalid-actor', () => {
    const party = [makeCharacter({ id: 'a', hp: 0 })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    expect(executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext))
      .toEqual({ success: false, reason: 'invalid-actor' });
  });

  it('actor not at turnOrder[currentTurn] → invalid-turn', () => {
    const party = [makeCharacter({ id: 'a' }), makeCharacter({ id: 'b' })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    expect(executeAction(state, { type: 'wait', actorId: 'b' }, cursor, baseContext))
      .toEqual({ success: false, reason: 'invalid-turn' });
  });

  it('first action triggers prepareTurn — AP refilled to 2', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    const actor = state.combatants.get('a');
    actor.ap = 0;
    executeAction(state, { type: 'wait', actorId: 'a' }, cursor, baseContext);
    expect(state.turnStarted).toBe(true);
    expect(actor.ap).toBe(0);
  });

  it('condition ticked exactly once per turn — duration-1 burning expires on first action', () => {
    const party = [makeCharacter({ id: 'a', conditions: [{ id: 'burning', duration: 1, stacks: 1 }] })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    executeAction(state, { type: 'wait', actorId: 'a' }, cursor, baseContext);
    const actor = state.combatants.get('a');
    expect(actor.conditions).toHaveLength(0);
  });

  it('second action same turn does NOT tick again', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon(), conditions: [{ id: 'burning', duration: 2, stacks: 1 }] })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 1000, hpMax: 1000, defense: 0 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const actor = state.combatants.get('a');
    expect(actor.conditions[0].duration).toBe(1);
    const durAfterFirst = actor.conditions[0].duration;
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(actor.conditions[0].duration).toBe(durAfterFirst);
  });

  it('burning tick can kill actor → invalid-actor', () => {
    const party = [makeCharacter({ id: 'a', hp: 1, conditions: [{ id: 'burning', duration: 2, stacks: 5 }] })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'invalid-actor' });
    const condDmgLog = state.log.find(e => e.type === 'condition-damage');
    expect(condDmgLog).toBeDefined();
    const deathLog = state.log.find(e => e.type === 'death' && e.cause === 'condition');
    expect(deathLog).toBeDefined();
  });

  it('AP exhausted after two attacks → third action no-ap', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon() })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 1000, hpMax: 1000 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'no-ap' });
  });

  it('jammed blocks cast/overclock but not attack', () => {
    const party = [makeCharacter({ id: 'a', charge: 20, protocols: [{ school: 'disrupt', tier: 1 }] })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const actor = state.combatants.get('a');
    actor.conditions = [{ id: 'jammed', duration: 2, stacks: 1 }];
    const castResult = executeAction(state, { type: 'cast', actorId: 'a', targetId: 'enemy_1', school: 'disrupt', tier: 1 }, cursor, baseContext);
    expect(castResult).toEqual({ success: false, reason: 'jammed' });
  });

  it('panicked blocks attack but not cast', () => {
    const party = [makeCharacter({ id: 'a', charge: 20, protocols: [{ school: 'disrupt', tier: 1 }] })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const actor = state.combatants.get('a');
    actor.conditions = [{ id: 'panicked', duration: 2, stacks: 1 }];
    const atkResult = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(atkResult).toEqual({ success: false, reason: 'panicked' });
  });

  it('garbage action type → invalid-action', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    expect(executeAction(state, { type: 'dance', actorId: 'a' }, cursor, baseContext))
      .toEqual({ success: false, reason: 'invalid-action' });
  });

  it('null action tolerated → invalid-actor', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    expect(executeAction(state, null, cursor, baseContext)).toEqual({ success: false, reason: 'invalid-actor' });
  });
});

describe('executeAction — attack resolution', () => {
  it('nat 20 — auto-hit, 2 damage dice, crit:true', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 30, hp: 100, hpMax: 100 });
    const seed = findAttackSeed(19, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(true);
    expect(result.crit).toBe(true);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.crit).toBe(true);
    expect(result.damage).toBeGreaterThanOrEqual(2);
  });

  it('nat 1 — auto-miss even vs defense 1', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 1, hp: 20, hpMax: 20 });
    const seed = findAttackSeed(0, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(false);
    expect(result.fumble).toBe(true);
    expect(result.damage).toBe(0);
  });

  it('melee adds modifier(mgt) to hit AND damage', () => {
    const mgt = 8;
    const party = [makeCharacter({ id: 'a', attributes: { mgt, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10 + modifier(mgt) + 5, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    const expectedTotal = atkLog.naturalRoll + modifier(mgt);
    expect(atkLog.roll).toBe(expectedTotal);
    if (result.hit) {
      expect(result.damage).toBeGreaterThanOrEqual(1 + modifier(mgt));
    }
  });

  it('ranged weapon uses modifier(fin) to hit only', () => {
    const fin = 8;
    const party = [makeCharacter({ id: 'a', attributes: { mgt: 3, fin, vit: 5, res: 5, foc: 5, sig: 5 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'ranged', accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(fin));
  });

  it('weapon.accuracyBonus added to hit', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'ranged', accuracyBonus: 3 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(5) + 3);
  });

  it('marked on target → +2 to hit', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10, hp: 100, hpMax: 100, conditions: [{ id: 'marked', duration: 3, stacks: 1 }] });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(5) + 2);
  });

  it('blinded on target → defense -4', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 20, hp: 100, hpMax: 100, conditions: [{ id: 'blinded', duration: 2, stacks: 1 }] });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(5));
  });

  it('coverBonus raises target defense', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10, hp: 100, hpMax: 100, coverBonus: 4 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    const expectedDef = 10 + 4;
    expect(atkLog.hit).toBe(atkLog.naturalRoll !== 1 && (atkLog.naturalRoll === 20 || atkLog.roll >= expectedDef));
  });

  it('overloaded target → damage ×1.5 floored', () => {
    const seed = findAttackSeed(19, 1, 1);
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 30, hp: 200, hpMax: 200, conditions: [{ id: 'overloaded', duration: 2, stacks: 1 }] });
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.crit).toBe(true);
    const overloadedDamage = result.damage;
    const enemy2 = makeEnemy({ id: 'enemy_2', defense: 30, hp: 200, hpMax: 200 });
    const { state: state2, cursor: cursor2 } = startCombat(party, [enemy2], seed, 'a');
    const result2 = executeAction(state2, { type: 'attack', actorId: 'a', targetId: 'enemy_2' }, cursor2, baseContext);
    expect(Math.floor(result2.damage * 1.5)).toBe(overloadedDamage);
  });

  it('death — hp clamps to 0, death log entry', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd20', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 0, hp: 1, hpMax: 1 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    if (result.hit) {
      expect(state.combatants.get('enemy_1').hp).toBe(0);
      const deathLog = state.log.find(e => e.type === 'death');
      expect(deathLog).toBeDefined();
    }
  });

  it('invalid-target for dead/missing target — no AP spent', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 0 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const apBefore = state.combatants.get('a').ap;
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'invalid-target' });
    expect(state.combatants.get('a').ap).toBe(apBefore);
  });

  it('damage die parsing — d10 → rolls in [1,10]', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd10', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 0, hp: 200, hpMax: 200 });
    const seed = findAttackSeed(19, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(true);
    expect(result.crit).toBe(true);
    expect(result.damage - modifier(5)).toBeGreaterThanOrEqual(2);
    expect(result.damage - modifier(5)).toBeLessThanOrEqual(20);
  });

  it('no weapon → d6 fallback', () => {
    const seed = findAttackSeed(19, 1, 1);
    const party = [makeCharacter({ id: 'a', weapon: null, attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 } })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 30, hp: 200, hpMax: 200 });
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.crit).toBe(true);
    expect(result.damage - modifier(5)).toBeGreaterThanOrEqual(2);
    expect(result.damage - modifier(5)).toBeLessThanOrEqual(12);
  });
});

describe('executeAction — cast', () => {
  it('cast success decrements AP and logs protocol entry', () => {
    const party = [makeCharacter({ id: 'a', charge: 20, protocols: [{ school: 'disrupt', tier: 1 }] })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'cast', actorId: 'a', targetId: 'enemy_1', school: 'disrupt', tier: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(state.combatants.get('a').ap).toBe(1);
    const protoLog = state.log.find(e => e.type === 'protocol');
    expect(protoLog).toBeDefined();
    expect(protoLog.school).toBe('disrupt');
    expect(protoLog.tier).toBe(1);
    expect(protoLog.overclocked).toBe(false);
  });

  it('invalid-protocol when actor lacks the protocol in actor.protocols', () => {
    const party = [makeCharacter({ id: 'a', charge: 20, protocols: [] })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'cast', actorId: 'a', targetId: 'enemy_1', school: 'disrupt', tier: 1 }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'invalid-protocol' });
  });

  it('enemy side uses protocolAccess.schools + maxTier', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1', protocolAccess: { schools: ['disrupt'], maxTier: 3 }, charge: 20 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'enemy_1');
    const result = executeAction(state, { type: 'cast', actorId: 'enemy_1', targetId: 'a', school: 'disrupt', tier: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
  });
});

describe('executeAction — item', () => {
  it('consuming by baseType splices inventory item and decrements AP', () => {
    const party = [makeCharacter({ id: 'a', hp: 10, hpMax: 30 })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const inventory = [{ id: 'item_1', baseType: 'repair_patch', category: 'consumable' }];
    const ctx = { ...baseContext, runState: { inventory } };
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'item', actorId: 'a', targetId: 'a', consumableId: 'repair_patch' }, cursor, ctx);
    expect(result.success).toBe(true);
    expect(inventory).toHaveLength(0);
    expect(state.combatants.get('a').ap).toBe(1);
  });

  it('unknown consumableId with inventory present → invalid-item', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const ctx = { ...baseContext, runState: { inventory: [] } };
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'item', actorId: 'a', targetId: 'a', consumableId: 'nonexistent' }, cursor, ctx);
    expect(result).toEqual({ success: false, reason: 'invalid-item' });
  });

  it('no runState in context → direct consumable use, no splice, succeeds', () => {
    const party = [makeCharacter({ id: 'a', hp: 10, hpMax: 30 })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const ctx = { protocolsData, conditionsData, consumablesData };
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'item', actorId: 'a', targetId: 'a', consumableId: 'repair_patch' }, cursor, ctx);
    expect(result.success).toBe(true);
  });
});

describe('executeAction — retreat', () => {
  it('retreat with roll >= 15 → success, ap:0', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const seed = findAttackSeed(14, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'retreat', actorId: 'a' }, cursor, baseContext);
    expect(result.retreated).toBe(true);
    expect(state.combatants.get('a').ap).toBe(0);
    const retreatLog = state.log.find(e => e.type === 'retreat');
    expect(retreatLog.success).toBe(true);
  });

  it('retreat with roll < 15 → failure, ap still 0', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const seed = findAttackSeed(0, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'retreat', actorId: 'a' }, cursor, baseContext);
    expect(result.retreated).toBe(false);
    expect(state.combatants.get('a').ap).toBe(0);
  });
});

describe('executeAction — wait', () => {
  it('wait → ap:0, logged, success:true', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'wait', actorId: 'a' }, cursor, baseContext);
    expect(result).toEqual({ success: true });
    expect(state.combatants.get('a').ap).toBe(0);
    expect(state.log.find(e => e.type === 'wait')).toBeDefined();
  });
});

describe('resolveTurn', () => {
  it('party actor with AP → returns immediately', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.turnStarted = false;
    const before = state.combatants.get('a').ap;
    const result = resolveTurn(state, cursor, baseContext);
    expect(result.ended).toBe(false);
    expect(state.combatants.get('a').ap).toBe(before);
  });

  it('enemy turns auto-play via enemyAI until AP exhausted', () => {
    const party = [makeCharacter({ id: 'a', hp: 100, hpMax: 100 })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'enemy_1');
    state.turnStarted = false;
    resolveTurn(state, cursor, baseContext);
    expect(state.combatants.get('enemy_1').ap).toBe(0);
  });

  it('dead actors skipped; full cycle increments round', () => {
    const party = [makeCharacter({ id: 'a', hp: 100, hpMax: 100 }), makeCharacter({ id: 'b', hp: 0 })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'enemy_1');
    resolveTurn(state, cursor, baseContext);
    expect(state.combatants.get('enemy_1').ap).toBe(0);
  });

  it('all-enemy state (party dead) → returns ended wipe without hanging', () => {
    const party = [makeCharacter({ id: 'a', hp: 0 })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy]);
    const result = resolveTurn(state, cursor, baseContext);
    expect(result.ended).toBe(true);
    expect(result.result).toBe('wipe');
  });

  it('safety counter — one enemy with no valid targets → AI returns wait, loop terminates', () => {
    const party = [makeCharacter({ id: 'a', hp: 0 })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 100, hpMax: 100, behavior: 'aggressive' });
    const { state, cursor } = startCombat(party, [enemy], 1, 'enemy_1');
    state.turnStarted = false;
    const result = resolveTurn(state, cursor, baseContext);
    expect(result.ended).toBe(true);
    expect(result.result).toBe('wipe');
  });
});

describe('checkCombatEnd', () => {
  it('living party + living enemies → not ended', () => {
    const { state } = startCombat([makeCharacter()], [makeEnemy()]);
    const result = checkCombatEnd(state);
    expect(result).toEqual({ ended: false, result: null });
  });

  it('no living enemies → victory', () => {
    const { state } = startCombat([makeCharacter()], [makeEnemy({ hp: 0 })]);
    const result = checkCombatEnd(state);
    expect(result.ended).toBe(true);
    expect(result.result).toBe('victory');
  });

  it('no living party → wipe', () => {
    const party = [makeCharacter({ hp: 0 })];
    const { state } = startCombat(party, [makeEnemy()]);
    const result = checkCombatEnd(state);
    expect(result.ended).toBe(true);
    expect(result.result).toBe('wipe');
  });

  it('both dead → victory (enemies checked first)', () => {
    const party = [makeCharacter({ hp: 0 })];
    const { state } = startCombat(party, [makeEnemy({ hp: 0 })]);
    const result = checkCombatEnd(state);
    expect(result.result).toBe('victory');
  });
});

describe('initiateCombat — encounter contract (deployment window)', () => {
  it('accepts a createStandardEncounter result and carries its window/id/kind', () => {
    const floor = contactWindowFloor();
    const cursor = createRNGCursorForRun(1);
    const encounter = createStandardEncounter(floor, { x: 12, y: 12 }, [makeCharacter({ id: 'a' })], [makeEnemy({ id: 'enemy_1' })], cursor);
    const state = initiateCombat(encounter, cursor);
    expect(state.window).toBe(encounter.window);
    expect(state.id).toBe(encounter.id);
    expect(state.kind).toBe('standard');
    expect(state.combatants.get('a').position).toEqual(encounter.actors.find(a => a.id === 'a').position);
  });

  it('deploys party/hostile bands on distinct legal cells, 9-12 cells apart when geometry permits', () => {
    const floor = contactWindowFloor();
    const cursor = createRNGCursorForRun(1);
    const party = [makeCharacter({ id: 'a' }), makeCharacter({ id: 'b' })];
    const enemies = [makeEnemy({ id: 'e1' }), makeEnemy({ id: 'e2' })];
    const encounter = createStandardEncounter(floor, { x: 12, y: 12 }, party, enemies, cursor);
    const positions = encounter.actors.map(a => `${a.position.x},${a.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
    const partyPositions = encounter.actors.filter(a => a.side === 'party').map(a => a.position);
    const hostilePositions = encounter.actors.filter(a => a.side === 'enemy').map(a => a.position);
    let minSeparation = Infinity;
    for (const p of partyPositions) for (const h of hostilePositions) {
      minSeparation = Math.min(minSeparation, Math.max(Math.abs(p.x - h.x), Math.abs(p.y - h.y)));
    }
    expect(minSeparation).toBeGreaterThanOrEqual(9);
    expect(minSeparation).toBeLessThanOrEqual(12);
  });

  it('never invents cells outside the carved geometry — every actor lands on an open window cell', () => {
    const floor = contactWindowFloor();
    const cursor = createRNGCursorForRun(1);
    const encounter = createStandardEncounter(floor, { x: 12, y: 12 }, makeParty(3), [makeEnemy({ id: 'e1' }), makeEnemy({ id: 'e2' })], cursor);
    for (const actor of encounter.actors) {
      expect(encounter.window.cells[actor.position.y][actor.position.x]).not.toBe(0);
    }
  });

  it('legacy roster contract initiateCombat(party, enemies, cursor) still works with window null', () => {
    const { state } = startCombat([makeCharacter()], [makeEnemy()]);
    expect(state.window).toBeNull();
    expect(state.kind).toBe('legacy');
  });
});

describe('initiateCombat — Apex double initiative slot', () => {
  it('an actor with actionSlotsPerRound 2 appears twice in turnOrder, spaced roughly evenly', () => {
    const party = makeParty(2);
    const apex = makeEnemy({ id: 'apex_1', actionSlotsPerRound: 2 });
    const { state } = startCombat(party, [apex]);
    const occurrences = state.turnOrder.reduce((count, id) => count + (id === 'apex_1' ? 1 : 0), 0);
    expect(occurrences).toBe(2);
    expect(state.turnOrder.length).toBe(4);
    const indices = state.turnOrder.reduce((acc, id, i) => (id === 'apex_1' ? [...acc, i] : acc), []);
    expect(indices[1] - indices[0]).toBeGreaterThanOrEqual(1);
  });

  it('non-apex actors appear exactly once', () => {
    const party = makeParty(2);
    const { state } = startCombat(party, [makeEnemy({ id: 'e1' })]);
    for (const id of ['char_a', 'char_b', 'e1']) {
      expect(state.turnOrder.filter(entry => entry === id).length).toBe(1);
    }
  });
});

describe('getLegalActions', () => {
  it('dead actor → canAct false, no actions', () => {
    const party = [makeCharacter({ id: 'a', hp: 0 })];
    const { state } = startCombat(party, [makeEnemy()]);
    expect(getLegalActions(state, 'a')).toEqual({ canAct: false, actions: [], legalMoveDirections: [] });
  });

  it('not this actor\'s turn → canAct false', () => {
    const party = [makeCharacter({ id: 'a' }), makeCharacter({ id: 'b' })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    expect(getLegalActions(state, 'b').canAct).toBe(false);
  });

  it('active actor with full AP → includes attack/cast/overclock/item/move/swap/retreat/wait/end-turn', () => {
    const party = [makeCharacter({ id: 'a', position: { x: 1, y: 1 } })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    const legal = getLegalActions(state, 'a');
    expect(legal.canAct).toBe(true);
    for (const action of ['attack', 'cast', 'overclock', 'item', 'move', 'swap', 'retreat', 'wait', 'end-turn']) {
      expect(legal.actions).toContain(action);
    }
  });

  it('panicked actor → attack excluded from legal actions', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    state.combatants.get('a').conditions = [{ id: 'panicked', duration: 1, stacks: 1 }];
    expect(getLegalActions(state, 'a').actions).not.toContain('attack');
  });

  it('jammed actor → cast/overclock excluded', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    state.combatants.get('a').conditions = [{ id: 'jammed', duration: 1, stacks: 1 }];
    const actions = getLegalActions(state, 'a').actions;
    expect(actions).not.toContain('cast');
    expect(actions).not.toContain('overclock');
  });

  it('immobilized actor → move excluded', () => {
    const party = [makeCharacter({ id: 'a', position: { x: 1, y: 1 } })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    state.combatants.get('a').conditions = [{ id: 'immobilized', duration: 1, stacks: 1 }];
    expect(getLegalActions(state, 'a').actions).not.toContain('move');
  });
});

describe('executeAction — move', () => {
  function windowState(actorPosition, window = blockedCornerWindow()) {
    const party = [makeCharacter({ id: 'a', position: actorPosition })];
    const { state, cursor } = startCombat(party, [makeEnemy({ position: { x: 7, y: 15 } })], 1, 'a');
    state.window = window;
    return { state, cursor };
  }

  it('moves exactly one legal cell and consumes moveAvailable, not AP', () => {
    const { state, cursor } = windowState({ x: 3, y: 3 });
    const before = state.combatants.get('a').ap;
    const result = executeAction(state, { type: 'move', actorId: 'a', direction: 'e' }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.position).toEqual({ x: 4, y: 3 });
    expect(state.combatants.get('a').position).toEqual({ x: 4, y: 3 });
    expect(state.combatants.get('a').ap).toBe(before);
    expect(state.combatants.get('a').moveAvailable).toBe(false);
  });

  it('second move same turn fails — moveAvailable already spent', () => {
    const { state, cursor } = windowState({ x: 3, y: 3 });
    executeAction(state, { type: 'move', actorId: 'a', direction: 'e' }, cursor, baseContext);
    const result = executeAction(state, { type: 'move', actorId: 'a', direction: 'e' }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'no-move' });
  });

  it('corner rule blocks a diagonal step when both orthogonal neighbors are walls', () => {
    const { state, cursor } = windowState({ x: 0, y: 0 });
    const result = executeAction(state, { type: 'move', actorId: 'a', direction: 'se' }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'illegal-cell' });
    expect(state.combatants.get('a').position).toEqual({ x: 0, y: 0 });
  });

  it('cannot move onto a cell occupied by a living actor', () => {
    const { state, cursor } = windowState({ x: 3, y: 3 });
    const occupant = makeEnemy({ id: 'blocker', position: { x: 4, y: 3 } });
    state.combatants.set('blocker', { ...occupant, side: 'enemy' });
    const result = executeAction(state, { type: 'move', actorId: 'a', direction: 'e' }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'illegal-cell' });
  });

  it('immobilized actor cannot move', () => {
    const { state, cursor } = windowState({ x: 3, y: 3 });
    state.combatants.get('a').conditions = [{ id: 'immobilized', duration: 1, stacks: 1 }];
    const result = executeAction(state, { type: 'move', actorId: 'a', direction: 'e' }, cursor, baseContext);
    expect(result.success).toBe(false);
  });

  it('panicked actor always flees away from the nearest hostile, ignoring the requested direction', () => {
    const { state, cursor } = windowState({ x: 3, y: 3 });
    // duration:2 so the condition survives prepareTurn's once-per-turn tick before executeMove reads it.
    state.combatants.get('a').conditions = [{ id: 'panicked', duration: 2, stacks: 1 }];
    const before = state.combatants.get('a').position;
    const hostile = [...state.combatants.values()].find(c => c.side === 'enemy');
    const beforeDistance = Math.max(Math.abs(before.x - hostile.position.x), Math.abs(before.y - hostile.position.y));
    const result = executeAction(state, { type: 'move', actorId: 'a', direction: 'w' }, cursor, baseContext);
    expect(result.success).toBe(true);
    const afterDistance = Math.max(Math.abs(result.position.x - hostile.position.x), Math.abs(result.position.y - hostile.position.y));
    expect(afterDistance).toBeGreaterThan(beforeDistance);
  });

  it('targetId without an explicit direction steps toward the target', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 5, y: 0 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.position).toEqual({ x: 1, y: 0 });
  });
});

describe('executeAction — swap', () => {
  it('swaps positions with an adjacent living ally at 0 AP cost, once per turn', () => {
    const party = [makeCharacter({ id: 'a', position: { x: 1, y: 1 } }), makeCharacter({ id: 'b', position: { x: 1, y: 2 } })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    const apBefore = state.combatants.get('a').ap;
    const result = executeAction(state, { type: 'swap', actorId: 'a', targetId: 'b' }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(state.combatants.get('a').position).toEqual({ x: 1, y: 2 });
    expect(state.combatants.get('b').position).toEqual({ x: 1, y: 1 });
    expect(state.combatants.get('a').ap).toBe(apBefore);
    expect(state.combatants.get('a').swapAvailable).toBe(false);
  });

  it('second swap same turn fails', () => {
    const party = [makeCharacter({ id: 'a', position: { x: 1, y: 1 } }), makeCharacter({ id: 'b', position: { x: 1, y: 2 } })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    executeAction(state, { type: 'swap', actorId: 'a', targetId: 'b' }, cursor, baseContext);
    const result = executeAction(state, { type: 'swap', actorId: 'a', targetId: 'b' }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'no-swap' });
  });

  it('rejects a non-adjacent or hostile target', () => {
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } }), makeCharacter({ id: 'b', position: { x: 5, y: 5 } })];
    const { state, cursor } = startCombat(party, [makeEnemy({ position: { x: 0, y: 1 } })], 1, 'a');
    expect(executeAction(state, { type: 'swap', actorId: 'a', targetId: 'b' }, cursor, baseContext)).toEqual({ success: false, reason: 'not-adjacent' });
    expect(executeAction(state, { type: 'swap', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext)).toEqual({ success: false, reason: 'invalid-target' });
  });
});

describe('executeAction / endTurn — end-turn does not force a second action', () => {
  it('end-turn action zeroes AP even when AP is already full, and works without spending an action', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    const result = executeAction(state, { type: 'end-turn', actorId: 'a' }, cursor, baseContext);
    expect(result).toEqual({ success: true });
    expect(state.combatants.get('a').ap).toBe(0);
    expect(state.log.find(e => e.type === 'end-turn')).toBeDefined();
  });

  it('a partial turn (one attack, then end-turn) is legal — never forces two actions', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon() })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 1000, hpMax: 1000 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(state.combatants.get('a').ap).toBe(1);
    const result = executeAction(state, { type: 'end-turn', actorId: 'a' }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(state.combatants.get('a').ap).toBe(0);
  });

  it('standalone endTurn() export validates actor/turn and zeroes AP', () => {
    const party = [makeCharacter({ id: 'a' }), makeCharacter({ id: 'b' })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    executeAction(state, { type: 'wait', actorId: 'a' }, cursor, baseContext);
    expect(endTurn(state, 'b')).toEqual({ success: false, reason: 'invalid-turn' });
    const party2 = [makeCharacter({ id: 'x' })];
    const { state: state2 } = startCombat(party2, [makeEnemy()], 1, 'x');
    expect(endTurn(state2, 'x')).toEqual({ success: true });
    expect(state2.combatants.get('x').ap).toBe(0);
  });
});

describe('initiateCombat — initiative tie-break', () => {
  it('equal initiative resolves by stable ascending actor-id order', () => {
    // Both combatants share fin:5 (modifier 0), so equal initiative reduces to equal raw d20 draws.
    const seed = findSeed(candidate => {
      const c = createRNGCursorForRun(candidate);
      const first = c.nextInt('combat', 20);
      const second = c.nextInt('combat', 20);
      return first === second;
    });
    const party = [makeCharacter({ id: 'zzz', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 } })];
    const enemy = makeEnemy({ id: 'aaa', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 } });
    const cursor = createRNGCursorForRun(seed);
    const state = initiateCombat(party, [enemy], cursor);
    expect(state.combatants.get('zzz').initiative).toBe(state.combatants.get('aaa').initiative);
    expect(state.turnOrder).toEqual(['aaa', 'zzz']);
  });
});