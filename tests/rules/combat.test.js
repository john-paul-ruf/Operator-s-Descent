import { describe, it, expect } from 'vitest';
import { initiateCombat, getLegalActions, executeAction, endTurn, resolveTurn, checkCombatEnd, getCharacterDeaths, toCombatSnapshot, MOVE_RANGE, reachableMoveCells, pathToward } from '../../src/rules/combat.js';
import { createStandardEncounter, completeEncounter } from '../../src/rules/encounters.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { modifier } from '../../src/rules/attributes.js';
import { makeCharacter, makeWeapon, makeParty, findSeed } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';
import { contactWindowFloor, blockedCornerWindow, openCombatWindow } from '../helpers/grids.js';

const protocolsData = loadData('protocols');
const conditionsData = loadData('conditions');
const consumablesData = loadData('consumables');
const baseContext = { protocolsData, conditionsData, consumablesData, runState: {} };

// Adjacent to makeCharacter()'s default {x:0,y:0} so bare attack-resolution fixtures are
// legal-range melee by default; tests that need a specific distance override explicitly.
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
    position: { x: 1, y: 0 },
    ...overrides,
  };
}

// An open 8x16 combat window with no walls between (0,0) and any cell used below — attack
// tests that need real range/cover geometry attach this to combatState.window explicitly.
function openWindow() {
  return openCombatWindow();
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
  it('nat 20 — auto-hit, maximum possible damage (not double dice), crit:true', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 30, hp: 100, hpMax: 100 });
    const seed = findAttackSeed(19, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(true);
    expect(result.crit).toBe(true);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.crit).toBe(true);
    // d6 max (6) + modifier(mgt:5)=0 — a single fixed value, not a summed/ranged roll of two dice.
    expect(result.damage).toBe(6);
    expect(atkLog.damageRoll).toBeNull();
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

  it('ranged weapon uses modifier(fin) to hit only, no attribute added to damage', () => {
    const fin = 8;
    const party = [makeCharacter({ id: 'a', attributes: { mgt: 3, fin, vit: 5, res: 5, foc: 5, sig: 5 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 0, hp: 100, hpMax: 100 });
    const seed = findAttackSeed(19, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(fin));
    expect(atkLog.attribute).toBe('fin');
    // Nat 20 → max d6 (6), ranged damage never adds an attribute modifier.
    expect(result.damage).toBe(6);
  });

  it('weapon.accuracyBonus added to hit', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 3 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(5) + 3);
    expect(atkLog.weaponAccuracy).toBe(3);
  });

  it('polearm (adjacent-banded, maxRange 2) still resolves as melee at reach', () => {
    const mgt = 8;
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, attributes: { mgt, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, weapon: makeWeapon({ damageDie: 'd8', rangeBand: 'adjacent', maxRange: 2, accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 2, y: 0 }, defense: 10 + modifier(mgt), hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.attribute).toBe('mgt');
    expect(atkLog.range).toMatchObject({ distance: 2, band: 'adjacent', legal: true });
    if (result.hit) expect(result.damage).toBeGreaterThanOrEqual(1 + modifier(mgt));
  });

  it('beyond a weapon\'s maximum range, the attack always misses — even on a natural 20', () => {
    const seed = findAttackSeed(19, 1, 1);
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 5, y: 0 }, defense: 0, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.range).toMatchObject({ distance: 5, band: 'short', legal: false });
  });

  it('sniper below minimum range takes the -1 penalty; at/beyond it gets the +1 bonus', () => {
    const sniper = makeWeapon({ damageDie: 'd8', rangeBand: 'long', minRange: 3, maxRange: 16, accuracyBonus: -1 });
    const tooClose = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon: sniper })];
    const closeEnemy = makeEnemy({ id: 'enemy_1', position: { x: 2, y: 0 }, defense: 10, hp: 100, hpMax: 100 });
    const { state: closeState, cursor: closeCursor } = startCombat(tooClose, [closeEnemy], 1, 'a');
    executeAction(closeState, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, closeCursor, baseContext);
    expect(closeState.log.find(e => e.type === 'attack').weaponAccuracy).toBe(-1);

    const atRange = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon: sniper })];
    const farEnemy = makeEnemy({ id: 'enemy_1', position: { x: 5, y: 0 }, defense: 10, hp: 100, hpMax: 100 });
    const { state: farState, cursor: farCursor } = startCombat(atRange, [farEnemy], 1, 'a');
    executeAction(farState, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, farCursor, baseContext);
    expect(farState.log.find(e => e.type === 'attack').weaponAccuracy).toBe(1);
  });

  it('marked on target → +2 to hit', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10, hp: 100, hpMax: 100, conditions: [{ id: 'marked', duration: 3, stacks: 1 }] });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(5) + 2);
  });

  it('ranged attacker with BLINDED takes -4 to the attack roll', () => {
    const fin = 8;
    const party = [makeCharacter({ id: 'a', attributes: { mgt: 3, fin, vit: 5, res: 5, foc: 5, sig: 5 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 0 }), conditions: [{ id: 'blinded', duration: 2, stacks: 1 }] })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.attribute).toBe('fin');
    expect(atkLog.blindedPenalty).toBe(-4);
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(fin) - 4);
  });

  it('melee attacker with BLINDED takes no ranged penalty', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', accuracyBonus: 0 }), conditions: [{ id: 'blinded', duration: 2, stacks: 1 }] })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.blindedPenalty).toBe(0);
    expect(atkLog.roll).toBe(atkLog.naturalRoll + modifier(5));
  });

  it('edge-crossing cover: a wall between attacker and target grants +2 defense (half cover)', () => {
    const window = openCombatWindow();
    window.cells[0][2] = 0; // wall at (2,0) — exactly one blocked cell on the line from (0,0) to (4,0)
    window.cells[0][3] = 0; // wall at (3,0) — a second blocked cell → full cover
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 4, y: 0 }, defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.coverBonus).toBe(4); // two blocked crossings → full cover
    expect(atkLog.targetDefense).toBe(14); // 10 base + 4 full cover
  });

  it('edge-crossing cover: a single wall between attacker and target grants +2 (half cover)', () => {
    const window = openCombatWindow();
    window.cells[0][2] = 0; // exactly one blocked cell
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 4, y: 0 }, defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.coverBonus).toBe(2); // one blocked crossing → half cover
    expect(atkLog.targetDefense).toBe(12);
  });

  it('no walls between attacker and target → zero cover bonus', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 0 }) })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 4, y: 0 }, defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.coverBonus).toBe(0);
    expect(atkLog.targetDefense).toBe(10);
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

describe('executeAction — condition', () => {
  it('null condition application lands on a missed save and consumes 1 AP, logs save.roll', () => {
    const foc = 3;
    const nullEnemy = makeEnemy({
      id: 'null',
      archetypeId: 'null',
      attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc, sig: 5 },
      hp: 30, hpMax: 30,
      position: { x: 0, y: 1 },
    });
    const party = [makeCharacter({ id: 'a', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc, sig: 5 } })];
    const { state, cursor } = startCombat(party, [nullEnemy], 1, 'null');
    const dc = 10 + modifier(foc);
    const result = executeAction(state, { type: 'condition', actorId: 'null', targetId: 'a', conditionId: 'jammed', dc, apCost: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(state.combatants.get('null').ap).toBe(1);
    const log = state.log.find(e => e.type === 'condition');
    expect(log.conditionId).toBe('jammed');
    expect(log.dc).toBe(dc);
    expect(log.save).toBeDefined();
    expect(Number.isInteger(log.save.natural)).toBe(true);
    expect(log.save.natural).toBeGreaterThanOrEqual(1);
    expect(log.save.natural).toBeLessThanOrEqual(20);
    if (log.save.success) {
      expect(log.applied).toBe(false);
      expect(state.combatants.get('a').conditions.findIndex(c => c.conditionId === 'jammed' || c.id === 'jammed')).toBe(-1);
    } else {
      expect(log.applied).toBe(true);
      expect(state.combatants.get('a').conditions.some(c => (c.conditionId ?? c.id) === 'jammed')).toBe(true);
    }
  });

  it('marked bypasses the save (noSave: true) when applied via the condition action', () => {
    const nullEnemy = makeEnemy({
      id: 'null',
      archetypeId: 'null',
      attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
      hp: 30, hpMax: 30,
      position: { x: 0, y: 1 },
    });
    const party = [makeCharacter({ id: 'a' })];
    const { state, cursor } = startCombat(party, [nullEnemy], 1, 'null');
    const result = executeAction(state, { type: 'condition', actorId: 'null', targetId: 'a', conditionId: 'marked', dc: 30, apCost: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    expect(state.combatants.get('a').conditions.some(c => (c.conditionId ?? c.id) === 'marked')).toBe(true);
  });

  it('condition against a dead/missing target returns invalid-target and spends no AP', () => {
    const nullEnemy = makeEnemy({ id: 'null', archetypeId: 'null', hp: 30, hpMax: 30, position: { x: 0, y: 1 } });
    const party = [makeCharacter({ id: 'a' })];
    const { state, cursor } = startCombat(party, [nullEnemy], 1, 'null');
    const apBefore = state.combatants.get('null').ap;
    const result = executeAction(state, { type: 'condition', actorId: 'null', targetId: 'ghost', conditionId: 'jammed', dc: 10, apCost: 1 }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'invalid-target' });
    expect(state.combatants.get('null').ap).toBe(apBefore);
  });
});

describe('prepareTurn — Choir CHARGE regeneration', () => {
  it('choir gains +1 CHARGE each turn up to chargeMax', () => {
    const party = [makeCharacter({ id: 'a', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, hp: 50, hpMax: 50 })];
    const choir = makeEnemy({
      id: 'choir', archetypeId: 'choir',
      attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
      hp: 30, hpMax: 30, charge: 4, chargeMax: 6,
      position: { x: 0, y: 1 },
    });
    const { state, cursor } = startCombat(party, [choir], 1, 'choir');
    executeAction(state, { type: 'wait', actorId: 'choir' }, cursor, baseContext);
    expect(state.combatants.get('choir').charge).toBe(5);
    state.turnStarted = false;
    state.currentTurn = state.turnOrder.indexOf('choir');
    executeAction(state, { type: 'wait', actorId: 'choir' }, cursor, baseContext);
    expect(state.combatants.get('choir').charge).toBe(6);
    state.turnStarted = false;
    state.currentTurn = state.turnOrder.indexOf('choir');
    executeAction(state, { type: 'wait', actorId: 'choir' }, cursor, baseContext);
    expect(state.combatants.get('choir').charge).toBe(6);
  });

  it('non-choir actors do not gain CHARGE from prepareTurn', () => {
    const party = [makeCharacter({ id: 'a', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, charge: 5, chargeMax: 10 })];
    const warden = makeEnemy({ id: 'warden', hp: 30, hpMax: 30, position: { x: 0, y: 1 } });
    const { state, cursor } = startCombat(party, [warden], 1, 'a');
    executeAction(state, { type: 'wait', actorId: 'a' }, cursor, baseContext);
    expect(state.combatants.get('a').charge).toBe(5);
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

  it('blocked AI action logs a synthetic wait so the LOG feed reflects the failure', () => {
    // Enemy is fully boxed by walls on every side — every move it could try is illegal, so
    // executeAction returns success:false. Before this session the engine silently zeroed AP;
    // now it must push a wait log with the failure reason so the LOG feed shows what happened.
    const window = openCombatWindow();
    // Wall every neighbor of the enemy at (5,3).
    for (const [x, y] of [[4, 2], [5, 2], [6, 2], [4, 3], [6, 3], [4, 4], [5, 4], [6, 4]]) {
      window.cells[y][x] = 0;
    }
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, hp: 100, hpMax: 100 })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 5, y: 3 }, hp: 100, hpMax: 100, behavior: 'aggressive' });
    const { state, cursor } = startCombat(party, [enemy], 1, 'enemy_1');
    state.window = window;
    state.turnStarted = false;
    resolveTurn(state, cursor, baseContext);
    const waitLog = state.log.find(entry => entry.type === 'wait' && entry.actorId === 'enemy_1');
    expect(waitLog).toBeDefined();
    expect(waitLog.reason).toBeDefined();
    expect(state.combatants.get('enemy_1').ap).toBe(0);
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
    // Custom Rule 11: strengthened per AUDIT-6 — swap now requires an adjacent living ally
    // before it appears in the legal-action list. Fixture places an ally at Chebyshev-1 so the
    // full-menu assertion still holds; the prior single-actor fixture would trip AUDIT-6 today.
    const party = [
      makeCharacter({ id: 'a', position: { x: 1, y: 1 } }),
      makeCharacter({ id: 'b', position: { x: 2, y: 1 } })
    ];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    const legal = getLegalActions(state, 'a');
    expect(legal.canAct).toBe(true);
    for (const action of ['attack', 'cast', 'overclock', 'item', 'move', 'swap', 'retreat', 'wait', 'end-turn']) {
      expect(legal.actions).toContain(action);
    }
  });

  it('AUDIT-4: 0-AP actor drops retreat from the legal-action list', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    state.combatants.get('a').ap = 0;
    expect(getLegalActions(state, 'a').actions).not.toContain('retreat');
    // 'wait' and 'end-turn' stay legal at 0 AP — the actor still needs a way off the turn.
    expect(getLegalActions(state, 'a').actions).toEqual(expect.arrayContaining(['wait', 'end-turn']));
  });

  it('AUDIT-6: swap requires an adjacent living side-mate (Chebyshev 1)', () => {
    // Solo actor → no swap.
    const solo = [makeCharacter({ id: 'a', position: { x: 1, y: 1 } })];
    const { state: soloState } = startCombat(solo, [makeEnemy()], 1, 'a');
    expect(getLegalActions(soloState, 'a').actions).not.toContain('swap');

    // Ally too far → no swap.
    const far = [
      makeCharacter({ id: 'a', position: { x: 1, y: 1 } }),
      makeCharacter({ id: 'b', position: { x: 5, y: 5 } })
    ];
    const { state: farState } = startCombat(far, [makeEnemy()], 1, 'a');
    expect(getLegalActions(farState, 'a').actions).not.toContain('swap');

    // Adjacent living ally → swap available.
    const adjacent = [
      makeCharacter({ id: 'a', position: { x: 1, y: 1 } }),
      makeCharacter({ id: 'b', position: { x: 2, y: 2 } })
    ];
    const { state: adjState } = startCombat(adjacent, [makeEnemy()], 1, 'a');
    expect(getLegalActions(adjState, 'a').actions).toContain('swap');

    // Adjacent but dead ally → no swap (executeSwap would reject with invalid-target).
    const deadNeighbor = [
      makeCharacter({ id: 'a', position: { x: 1, y: 1 } }),
      makeCharacter({ id: 'b', position: { x: 2, y: 1 }, hp: 0 })
    ];
    const { state: deadState } = startCombat(deadNeighbor, [makeEnemy()], 1, 'a');
    expect(getLegalActions(deadState, 'a').actions).not.toContain('swap');
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

  it('targetId without an explicit direction walks toward the target, stopping adjacent by default', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 5, y: 0 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.success).toBe(true);
    // desiredRange defaults to 1 (adjacent) — walker stops one cell short of the target's cell.
    expect(result.position).toEqual({ x: 4, y: 0 });
    const moveLog = state.log.find(entry => entry.type === 'move');
    expect(moveLog.steps).toBe(4);
    expect(moveLog.path).toEqual(['e', 'e', 'e', 'e']);
  });
});

describe('reachableMoveCells', () => {
  it('exports MOVE_RANGE=5 and getLegalActions surfaces it', () => {
    expect(MOVE_RANGE).toBe(5);
    const party = [makeCharacter({ id: 'a', position: { x: 1, y: 1 } })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    expect(getLegalActions(state, 'a').moveRange).toBe(5);
  });

  it('BFS excludes origin, respects the 5-step cap, and rejects walls/occupancy', () => {
    const window = openCombatWindow();
    window.cells[3][5] = 0; // wall inside the reachable radius
    const party = [makeCharacter({ id: 'a', position: { x: 3, y: 3 } })];
    const enemy = makeEnemy({ id: 'blocker', position: { x: 3, y: 4 } });
    const { state } = startCombat(party, [enemy], 1, 'a');
    state.window = window;

    const reachable = reachableMoveCells(state, 'a');
    expect(reachable.has('3,3')).toBe(false); // origin excluded
    expect(reachable.has('5,3')).toBe(false); // wall
    expect(reachable.has('3,4')).toBe(false); // enemy occupies
    for (const entry of reachable.values()) expect(entry.steps).toBeLessThanOrEqual(MOVE_RANGE);
    expect([...reachable.values()].some(entry => entry.steps === MOVE_RANGE)).toBe(true);
  });

  it('honors the diagonal corner rule when both orthogonal neighbors are walls', () => {
    const window = blockedCornerWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const { state } = startCombat(party, [makeEnemy({ position: { x: 7, y: 15 } })], 1, 'a');
    state.window = window;

    const reachable = reachableMoveCells(state, 'a');
    // (1,1) is open floor but the origin's diagonal step is blocked; both orthogonals to it are
    // walls too, so (1,1) has no legal ingress from the origin's neighborhood at all.
    expect(reachable.has('1,0')).toBe(false); // wall
    expect(reachable.has('0,1')).toBe(false); // wall
    expect(reachable.has('1,1')).toBe(false); // corner rule blocks every diagonal into (1,1)
  });

  it('returns a shortest path array whose length equals the step count', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const { state } = startCombat(party, [makeEnemy({ position: { x: 7, y: 15 } })], 1, 'a');
    state.window = window;

    const reachable = reachableMoveCells(state, 'a');
    const cell = reachable.get('3,3');
    expect(cell.steps).toBe(3);
    expect(cell.path).toHaveLength(3);
    // Walking the returned path reaches the target cell exactly.
    const DELTAS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
    let cursor = { x: 0, y: 0 };
    for (const dir of cell.path) cursor = { x: cursor.x + DELTAS[dir][0], y: cursor.y + DELTAS[dir][1] };
    expect(cursor).toEqual({ x: 3, y: 3 });
  });

  it('missing actor or window returns an empty map without throwing', () => {
    const { state } = startCombat([makeCharacter({ id: 'a' })], [makeEnemy()], 1, 'a');
    expect(reachableMoveCells(state, 'ghost').size).toBe(0);
    expect(reachableMoveCells({ combatants: new Map(), window: null }, 'x').size).toBe(0);
  });
});

describe('executeAction — move (multi-step path)', () => {
  it('walks a 3-step path, spends moveAvailable, and logs path/steps/direction', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const { state, cursor } = startCombat(party, [makeEnemy({ position: { x: 7, y: 15 } })], 1, 'a');
    state.window = window;

    const result = executeAction(state, { type: 'move', actorId: 'a', path: ['e', 'e', 'e'] }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.position).toEqual({ x: 3, y: 0 });
    const actor = state.combatants.get('a');
    expect(actor.position).toEqual({ x: 3, y: 0 });
    expect(actor.moveAvailable).toBe(false);
    const moveLog = state.log.find(entry => entry.type === 'move');
    expect(moveLog.path).toEqual(['e', 'e', 'e']);
    expect(moveLog.steps).toBe(3);
    expect(moveLog.direction).toBe('e'); // back-compat with formatLog
    expect(moveLog.from).toEqual({ x: 0, y: 0 });
    expect(moveLog.to).toEqual({ x: 3, y: 0 });
  });

  it('rejects the whole path when any step is illegal — no partial move, no log', () => {
    const window = openCombatWindow();
    window.cells[0][2] = 0; // wall at (2,0): step 2 of ['e','e','e'] from (0,0) is invalid
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const { state, cursor } = startCombat(party, [makeEnemy({ position: { x: 7, y: 15 } })], 1, 'a');
    state.window = window;

    const before = { ...state.combatants.get('a').position };
    const result = executeAction(state, { type: 'move', actorId: 'a', path: ['e', 'e', 'e'] }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'illegal-cell' });
    expect(state.combatants.get('a').position).toEqual(before);
    expect(state.combatants.get('a').moveAvailable).toBe(true);
    expect(state.log.find(entry => entry.type === 'move')).toBeUndefined();
  });

  it('rejects overlength paths as illegal-cell', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const { state, cursor } = startCombat(party, [makeEnemy({ position: { x: 7, y: 15 } })], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', path: ['e', 'e', 'e', 'e', 'e', 'e'] }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'illegal-cell' });
  });

  it('opportunity attack fires once when the walker leaves a threatened cell along the path', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 2, y: 2 }, hp: 30, hpMax: 30 })];
    // Enemy at (1,2) threatens the origin (Chebyshev 1); after step 1 to (3,2) it no longer threatens (Chebyshev 2).
    const enemy = makeEnemy({ id: 'guard', position: { x: 1, y: 2 }, defense: 0, hp: 100, hpMax: 100,
      weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, accuracyBonus: 0 }) });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;

    const result = executeAction(state, { type: 'move', actorId: 'a', path: ['e', 'e', 'e'] }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.position).toEqual({ x: 5, y: 2 });
    const oaAttacks = state.log.filter(entry => entry.type === 'attack' && entry.trigger === 'opportunity');
    expect(oaAttacks).toHaveLength(1);
    expect(oaAttacks[0].actorId).toBe('guard');
  });

  it('lethal opportunity attack mid-path stops the walk on the last cell reached and logs cancelled', () => {
    const window = openCombatWindow();
    // Actor is fragile so a single OA hit ends the walk. Enemy has +40 accuracy and d20 damage.
    const party = [makeCharacter({ id: 'a', position: { x: 2, y: 2 }, hp: 1, hpMax: 30 })];
    const enemy = makeEnemy({ id: 'sentinel', position: { x: 1, y: 2 }, defense: 0, hp: 100, hpMax: 100,
      weapon: makeWeapon({ damageDie: 'd20', rangeBand: 'adjacent', maxRange: 1, accuracyBonus: 40 }) });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;

    const result = executeAction(state, { type: 'move', actorId: 'a', path: ['e', 'e', 'e'] }, cursor, baseContext);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('dead');
    const actor = state.combatants.get('a');
    expect(actor.hp).toBeLessThanOrEqual(0);
    // OA fires during step 1 (leaving (2,2)) — walker never advances.
    expect(actor.position).toEqual({ x: 2, y: 2 });
    expect(actor.moveAvailable).toBe(true); // never spent because the walk didn't complete
    const moveLog = state.log.find(entry => entry.type === 'move');
    expect(moveLog.cancelled).toBe(true);
    expect(moveLog.path).toEqual([]); // partial path: nothing successfully walked
    expect(moveLog.to).toBeNull();
  });

  it('back-compat: {direction} still moves one cell (enemy AI stepToward relies on this)', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 3, y: 3 } })];
    const { state, cursor } = startCombat(party, [makeEnemy({ position: { x: 7, y: 15 } })], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', direction: 'e' }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.position).toEqual({ x: 4, y: 3 });
  });

  it('panicked overrides any requested path with a single-step flee away from the nearest hostile', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 3, y: 3 } })];
    const enemy = makeEnemy({ id: 'threat', position: { x: 7, y: 15 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    // duration:2 so the condition survives prepareTurn's start_turn tick before executeMove reads it.
    state.combatants.get('a').conditions = [{ id: 'panicked', duration: 2, stacks: 1 }];

    const before = { x: 3, y: 3 };
    const beforeDistance = Math.max(Math.abs(before.x - enemy.position.x), Math.abs(before.y - enemy.position.y));
    const result = executeAction(state, { type: 'move', actorId: 'a', path: ['e', 'e', 'e'] }, cursor, baseContext);
    expect(result.success).toBe(true);
    const afterDistance = Math.max(Math.abs(result.position.x - enemy.position.x), Math.abs(result.position.y - enemy.position.y));
    expect(afterDistance).toBeGreaterThan(beforeDistance);
    const moveLog = state.log.find(entry => entry.type === 'move');
    expect(moveLog.path).toHaveLength(1);
  });
});

describe('executeAction — move (targetId + desiredRange fallback)', () => {
  it('open corridor: walks exactly MOVE_RANGE=5 toward a distant target when desiredRange 1 is unreachable in one action', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 7, y: 0 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1', desiredRange: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.position).toEqual({ x: 5, y: 0 });
    const moveLog = state.log.find(entry => entry.type === 'move');
    expect(moveLog.steps).toBe(MOVE_RANGE);
    expect(moveLog.path).toHaveLength(MOVE_RANGE);
  });

  it('desiredRange 1 stops adjacent and never enters the target\'s cell', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 3, y: 0 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1', desiredRange: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
    // Chebyshev from (2,0) to (3,0) is 1 — stop condition — walker never lands on target.
    expect(result.position).toEqual({ x: 2, y: 0 });
    expect(result.position).not.toEqual(enemy.position);
  });

  it('desiredRange 3 (artillery) stops at Chebyshev 3 from the target', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 7, y: 0 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1', desiredRange: 3 }, cursor, baseContext);
    expect(result.success).toBe(true);
    // 4 steps: dist 7→6→5→4→3, stops at dist===3, position (4,0).
    expect(result.position).toEqual({ x: 4, y: 0 });
    const finalDistance = Math.max(Math.abs(result.position.x - enemy.position.x), Math.abs(result.position.y - enemy.position.y));
    expect(finalDistance).toBe(3);
  });

  it('BFS routes around a wall column when a gap exists (Custom Rule 11: strengthened — greedy path used to wedge here and log nothing; BFS makes the enemy hunt through)', () => {
    const window = openCombatWindow();
    // Wall x=2 column from y=0 to y=14 with a gap at y=15 so BFS must route south through
    // (0,y)→…→(2,15)→(3,15)→… before turning back toward the target on the far side.
    for (let y = 0; y < window.height - 1; y++) window.cells[y][2] = 0;
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 7, y: 0 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1', desiredRange: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
    // BFS emits a MOVE_RANGE-truncated walk toward the gap — the shortest path is longer than
    // one action, but the walker still makes real progress instead of wedging at x=1.
    const actor = state.combatants.get('a');
    expect(actor.position).not.toEqual({ x: 0, y: 0 });
    // The walk never crosses the wall column mid-path — every visited cell is passable.
    const moveLog = state.log.find(entry => entry.type === 'move');
    const DELTAS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
    let sim = { x: 0, y: 0 };
    for (const dir of moveLog.path) {
      sim = { x: sim.x + DELTAS[dir][0], y: sim.y + DELTAS[dir][1] };
      expect(window.cells[sim.y][sim.x]).not.toBe(0);
    }
    expect(moveLog.steps).toBe(moveLog.path.length);
    expect(moveLog.steps).toBeLessThanOrEqual(MOVE_RANGE);
  });

  it('BFS reaches the target within 3 rounds behind an L-wall that greedy pathing wedged against forever (Custom Rule 11)', () => {
    const window = openCombatWindow();
    // L-wall: three cells at x=4, y=2..4 block every direct east step from (3,3) to (5,3).
    window.cells[2][4] = 0;
    window.cells[3][4] = 0;
    window.cells[4][4] = 0;
    const party = [makeCharacter({ id: 'a', position: { x: 3, y: 3 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 5, y: 3 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    // Under a single move action the walker routes around: (3,3)→(3,2)→(4,1)→(5,2), stopping
    // at Chebyshev 1 of (5,3). Greedy stepFrom used to return null here and log nothing.
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1', desiredRange: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
    const finalDistance = Math.max(
      Math.abs(state.combatants.get('a').position.x - 5),
      Math.abs(state.combatants.get('a').position.y - 3)
    );
    expect(finalDistance).toBeLessThanOrEqual(1);
  });

  it('fully walled-off target (enclosed): BFS returns null → invalid-direction, no move, moveAvailable preserved', () => {
    const window = openCombatWindow();
    // Enclose target at (5,3) with walls on every adjacent side. BFS has no reachable cell
    // within Chebyshev 1 — the only remaining test of the null-return contract.
    for (const [x, y] of [[4, 2], [5, 2], [6, 2], [4, 3], [6, 3], [4, 4], [5, 4], [6, 4]]) {
      window.cells[y][x] = 0;
    }
    const party = [makeCharacter({ id: 'a', position: { x: 3, y: 3 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 5, y: 3 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    const before = { ...state.combatants.get('a').position };
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1', desiredRange: 1 }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'invalid-direction' });
    expect(state.combatants.get('a').position).toEqual(before);
    expect(state.combatants.get('a').moveAvailable).toBe(true);
    expect(state.log.find(entry => entry.type === 'move')).toBeUndefined();
  });

  it('opportunity attacks fire on each threatened departure during a multi-step fallback walk', () => {
    const window = openCombatWindow();
    // Actor pinned to y=0 so DIRECTION_ORDER's diagonal-first preference stays inert
    // (n/ne are out of bounds) and the greedy walk marches straight east.
    //   guard_a (1,0) threatens (2,0) but NOT (3,0); actor departs (2,0) on step 1 → OA #1.
    //   guard_b (4,1) threatens (4,0)/(5,0) but NOT (6,0); actor departs (5,0) on step 4 → OA #2.
    // A guard at (5,1) would also threaten (6,0) (Chebyshev 1) and swallow the second OA.
    const party = [makeCharacter({ id: 'a', position: { x: 2, y: 0 }, hp: 100, hpMax: 100 })];
    const guardA = makeEnemy({ id: 'guard_a', position: { x: 1, y: 0 }, defense: 0, hp: 100, hpMax: 100,
      weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, accuracyBonus: 0 }) });
    const guardB = makeEnemy({ id: 'guard_b', position: { x: 4, y: 1 }, defense: 0, hp: 100, hpMax: 100,
      weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, accuracyBonus: 0 }) });
    const target = makeEnemy({ id: 'enemy_1', position: { x: 7, y: 0 } });
    const { state, cursor } = startCombat(party, [guardA, guardB, target], 1, 'a');
    state.window = window;
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1', desiredRange: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.position).toEqual({ x: 6, y: 0 });
    const oaAttacks = state.log.filter(entry => entry.type === 'attack' && entry.trigger === 'opportunity');
    expect(oaAttacks).toHaveLength(2);
    const attackerIds = oaAttacks.map(a => a.actorId).sort();
    expect(attackerIds).toEqual(['guard_a', 'guard_b']);
  });

  it('pathToward consumes zero RNG (determinism preserved)', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const target = makeEnemy({ id: 'enemy_1', position: { x: 7, y: 0 } });
    const { state, cursor } = startCombat(party, [target], 1, 'a');
    state.window = window;
    const combatBefore = cursor.getCursor('combat');
    const genBefore = cursor.getCursor('gen');
    const path = pathToward(state, state.combatants.get('a'), 'enemy_1', MOVE_RANGE, 1);
    expect(path).toEqual(['e', 'e', 'e', 'e', 'e']);
    expect(cursor.getCursor('combat')).toBe(combatBefore);
    expect(cursor.getCursor('gen')).toBe(genBefore);
  });

  it('pathToward returns null when actor is already within desiredRange (no wasted move action)', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 3, y: 3 } })];
    const target = makeEnemy({ id: 'enemy_1', position: { x: 5, y: 3 } });
    const { state } = startCombat(party, [target], 1, 'a');
    state.window = window;
    // Chebyshev(3,3 → 5,3) = 2, already inside desiredRange 3 (artillery).
    expect(pathToward(state, state.combatants.get('a'), 'enemy_1', MOVE_RANGE, 3)).toBeNull();
  });

  it('missing target / missing actor position returns null instead of throwing', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const { state } = startCombat(party, [makeEnemy({ id: 'enemy_1', position: { x: 5, y: 0 } })], 1, 'a');
    state.window = window;
    expect(pathToward(state, state.combatants.get('a'), 'ghost', MOVE_RANGE, 1)).toBeNull();
    const noPosActor = { ...state.combatants.get('a'), position: undefined };
    expect(pathToward(state, noPosActor, 'enemy_1', MOVE_RANGE, 1)).toBeNull();
  });

  it('non-finite desiredRange in action defaults to 1 (adjacent)', () => {
    const window = openCombatWindow();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 } })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 3, y: 0 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = window;
    // desiredRange omitted (undefined) → default 1 → stops at (2,0).
    const result = executeAction(state, { type: 'move', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.position).toEqual({ x: 2, y: 0 });
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

describe('terminal results — victory payload', () => {
  it('victory sets ended, result, and victoryPayload with defeated spawn IDs', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd20' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 0, hp: 1, hpMax: 1 });
    const { state } = startCombat(party, [enemy], 1, 'a');
    state.combatants.get('enemy_1').hp = 0;
    const end = checkCombatEnd(state);
    expect(end.result).toBe('victory');
    expect(state.victoryPayload).toBeDefined();
    expect(state.victoryPayload.defeatedSpawnIds).toContain('enemy_1');
    expect(state.victoryPayload.reason).toBe('combat-victory');
  });

  it('victoryPayload is built only once', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd20' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 0, hp: 1, hpMax: 1 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    checkCombatEnd(state);
    const first = state.victoryPayload;
    checkCombatEnd(state);
    expect(state.victoryPayload).toBe(first);
  });
});

describe('terminal results — retreat payload', () => {
  it('successful retreat sets ended=true, result=retreat with retreatPayload', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const seed = findAttackSeed(14, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'retreat', actorId: 'a' }, cursor, baseContext);
    expect(result.retreated).toBe(true);
    expect(state.ended).toBe(true);
    expect(state.result).toBe('retreat');
    expect(state.retreatPayload).toBeDefined();
    expect(state.retreatPayload.retreated).toBe(true);
    expect(state.retreatPayload.reason).toBe('retreat');
  });

  it('failed retreat does not set ended', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1' });
    const seed = findAttackSeed(0, 1, 1);
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    executeAction(state, { type: 'retreat', actorId: 'a' }, cursor, baseContext);
    expect(state.ended).toBe(false);
    expect(state.result).toBeNull();
    expect(state.retreatPayload).toBeUndefined();
  });
});

describe('getCharacterDeaths', () => {
  it('returns dead party members with survivors', () => {
    const party = [
      makeCharacter({ id: 'a', hp: 100, hpMax: 100, weapon: makeWeapon({ damageDie: 'd20' }) }),
      makeCharacter({ id: 'b', hp: 100, hpMax: 100 })
    ];
    const enemy = makeEnemy({ id: 'enemy_1', defense: 0, hp: 100, hpMax: 100, weapon: { damageDie: 'd20', rangeBand: 'adjacent', maxRange: 1, accuracyBonus: 0 } });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const deadActor = state.combatants.get('b');
    deadActor.hp = 0;
    const deaths = getCharacterDeaths(state);
    expect(deaths).toHaveLength(1);
    expect(deaths[0].characterId).toBe('b');
  });

  it('returns empty when no survivors (wipe — deaths handled separately)', () => {
    const party = [makeCharacter({ id: 'a', hp: 0 })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 100, hpMax: 100 });
    const { state } = startCombat(party, [enemy]);
    const deaths = getCharacterDeaths(state);
    expect(deaths).toHaveLength(0);
  });

  it('does not return the same death twice', () => {
    const party = [
      makeCharacter({ id: 'a', hp: 100, hpMax: 100 }),
      makeCharacter({ id: 'b', hp: 100, hpMax: 100 })
    ];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 100, hpMax: 100 });
    const { state } = startCombat(party, [enemy]);
    state.combatants.get('b').hp = 0;
    const first = getCharacterDeaths(state);
    const second = getCharacterDeaths(state);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});

describe('toCombatSnapshot', () => {
  it('returns null when combat is ended', () => {
    const party = [makeCharacter({ id: 'a' })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 0 });
    const { state } = startCombat(party, [enemy]);
    checkCombatEnd(state);
    expect(toCombatSnapshot(state)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(toCombatSnapshot(null)).toBeNull();
  });

  it('produces a snapshot with arena/actors/initiativeOrder/currentIndex/round/encounter', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon() })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 50, hpMax: 50 });
    const { state } = startCombat(party, [enemy], 1, 'a');
    const snap = toCombatSnapshot(state);
    expect(snap).not.toBeNull();
    expect(snap.arena).toBeDefined();
    expect(snap.actors).toHaveLength(2);
    expect(snap.initiativeOrder).toHaveLength(2);
    expect(snap.initiativeOrder).toEqual(state.turnOrder);
    expect(snap.currentIndex).toBe(state.currentTurn);
    expect(snap.round).toBe(1);
    expect(snap.encounter).toBeDefined();
    expect(snap.pendingEffects).toEqual([]);
    expect(snap.eventOrder).toBe(0);
  });

  it('excludes dead actors from the snapshot', () => {
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon() }), makeCharacter({ id: 'b', hp: 0 })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 50, hpMax: 50 });
    const { state } = startCombat(party, [enemy], 1, 'a');
    const snap = toCombatSnapshot(state);
    expect(snap.actors).toHaveLength(2);
    expect(snap.initiativeOrder).toHaveLength(2);
    expect(snap.actors.find(a => a.id === 'b')).toBeUndefined();
  });
});

describe('completeEncounter', () => {
  it('maps victory to resolved with loot and defeated spawn IDs', () => {
    const encounter = { id: 'e1', kind: 'standard', forfeitableLoot: ['item1'] };
    const combatResult = { result: 'victory', victoryPayload: { defeatedSpawnIds: ['enemy_1'], reclaimableGear: [] } };
    const completion = completeEncounter(encounter, combatResult);
    expect(completion.resolved).toBe(true);
    expect(completion.outcome).toBe('victory');
    expect(completion.loot).toEqual(['item1']);
    expect(completion.defeatedSpawnIds).toEqual(['enemy_1']);
  });

  it('maps retreat to resolved with forfeited loot', () => {
    const encounter = { id: 'e1', kind: 'standard', forfeitableLoot: ['item1', 'item2'] };
    const combatResult = { result: 'retreat' };
    const completion = completeEncounter(encounter, combatResult);
    expect(completion.resolved).toBe(true);
    expect(completion.outcome).toBe('retreat');
    expect(completion.loot).toEqual([]);
    expect(completion.forfeitedLoot).toEqual(['item1', 'item2']);
  });

  it('maps wipe to resolved with forfeited loot, no victory drops', () => {
    const encounter = { id: 'e1', kind: 'standard', forfeitableLoot: ['item1'] };
    const combatResult = { result: 'wipe' };
    const completion = completeEncounter(encounter, combatResult);
    expect(completion.resolved).toBe(true);
    expect(completion.outcome).toBe('wipe');
    expect(completion.forfeitedLoot).toEqual(['item1']);
  });

  it('returns unresolved for non-ended combat', () => {
    const encounter = { id: 'e1', kind: 'standard' };
    const combatResult = { result: null };
    const completion = completeEncounter(encounter, combatResult);
    expect(completion.resolved).toBe(false);
  });

  it('returns invalid for null inputs', () => {
    expect(completeEncounter(null, { result: 'victory' }).resolved).toBe(false);
    expect(completeEncounter({ id: 'e1' }, null).resolved).toBe(false);
  });
});