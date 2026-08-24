import { describe, it, expect } from 'vitest';
import { initiateCombat, executeAction } from '../../src/rules/combat.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { makeCharacter, makeWeapon, findSeed } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

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
    position: { x: 1, y: 0 },
    ...overrides,
  };
}

// Deterministic cursor: pops `combat` values off a queue in order; any incidental
// stream/overflow read returns 0 so opportunity-attack fallout can't corrupt the
// assertions we actually care about. Mirrors tests/rules/combat-damage.test.js.
function fixedCursor(combatValues) {
  const queue = [...combatValues];
  return {
    next: () => 0,
    nextInt: (stream, _max) => {
      if (stream === 'combat' && queue.length > 0) return queue.shift();
      return 0;
    },
    getCursor: () => 0,
    syncTo: () => {},
    getState: () => ({})
  };
}

function startCombat(party, enemies, combatValues, firstActorId) {
  const cursor = fixedCursor(combatValues);
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

describe('performAttackRoll — unified on-hit proc engine', () => {
  it('incendiary applies BURNING only on natural 20', () => {
    const critWeapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { conditions: [{ conditionId: 'burning', trigger: 'critical' }] } } };
    const party = [makeCharacter({ id: 'a', weapon: critWeapon })];
    const enemy = makeEnemy({ defense: 30, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 19], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.crit).toBe(true);
    expect(state.combatants.get('enemy_1').conditions.some(c => (c.conditionId ?? c.id) === 'burning')).toBe(true);
    expect(atkLog.procs).toEqual([{ conditionId: 'burning', trigger: 'critical', save: null, applied: true, shielded: false }]);
  });

  it('incendiary does not fire on an ordinary (non-crit) hit', () => {
    const critWeapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { conditions: [{ conditionId: 'burning', trigger: 'critical' }] } } };
    const party = [makeCharacter({ id: 'a', weapon: critWeapon })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9, 2], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.hit).toBe(true);
    expect(atkLog.crit).toBe(false);
    expect(state.combatants.get('enemy_1').conditions.some(c => (c.conditionId ?? c.id) === 'burning')).toBe(false);
    expect(atkLog.procs).toBeUndefined();
  });

  it('corrosive procs on an ordinary hit and applies when the VIT save fails', () => {
    const weapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { conditions: [{ conditionId: 'corroded', trigger: 'hit', chance: 1, save: 'vit' }] } } };
    const party = [makeCharacter({ id: 'a', weapon })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100, attributes: { mgt: 5, fin: 5, vit: 1, res: 5, foc: 5, sig: 5 } });
    // queue: init a, init enemy, attack(nat10, hits def5), damage(d6), save(nat1)
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9, 2, 0], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.hit).toBe(true);
    expect(atkLog.procs).toHaveLength(1);
    expect(atkLog.procs[0].conditionId).toBe('corroded');
    expect(atkLog.procs[0].save.success).toBe(false);
    expect(atkLog.procs[0].applied).toBe(true);
    expect(state.combatants.get('enemy_1').conditions.some(c => (c.conditionId ?? c.id) === 'corroded')).toBe(true);
  });

  it('corrosive is negated when the VIT save total meets the DC', () => {
    const weapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { conditions: [{ conditionId: 'corroded', trigger: 'hit', chance: 1, save: 'vit' }] } } };
    const party = [makeCharacter({ id: 'a', weapon })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100, attributes: { mgt: 5, fin: 5, vit: 10, res: 5, foc: 5, sig: 5 } });
    // save: nat10 + modifier(vit:10)=+5 = 15 >= dc(10+modifier(mgt:5)=10) → success, negated
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9, 2, 9], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.procs[0].save.success).toBe(true);
    expect(atkLog.procs[0].applied).toBe(false);
    expect(state.combatants.get('enemy_1').conditions.some(c => (c.conditionId ?? c.id) === 'corroded')).toBe(false);
  });

  it('jamming\'s 25% gate blocks the proc when the roll lands at/above the threshold', () => {
    const weapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { conditions: [{ conditionId: 'jammed', trigger: 'hit', chance: 0.25, save: 'foc' }] } } };
    const party = [makeCharacter({ id: 'a', weapon })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100 });
    // queue: init a, init enemy, attack(nat10), damage(d6), chance-roll(30 >= 25 → blocked)
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9, 2, 30], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.procs).toEqual([{ conditionId: 'jammed', trigger: 'hit', chanceFailed: true }]);
    expect(state.combatants.get('enemy_1').conditions.some(c => (c.conditionId ?? c.id) === 'jammed')).toBe(false);
  });

  it('jamming\'s 25% gate allows the proc through when the roll lands below the threshold', () => {
    const weapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { conditions: [{ conditionId: 'jammed', trigger: 'hit', chance: 0.25, save: 'foc' }] } } };
    const party = [makeCharacter({ id: 'a', weapon })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100, attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 1, sig: 5 } });
    // queue: init a, init enemy, attack(nat10), damage(d6), chance-roll(10 < 25 → allowed), save(nat1, fails)
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9, 2, 10, 0], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.procs).toHaveLength(1);
    expect(atkLog.procs[0].chanceFailed).toBeUndefined();
    expect(atkLog.procs[0].applied).toBe(true);
    expect(state.combatants.get('enemy_1').conditions.some(c => (c.conditionId ?? c.id) === 'jammed')).toBe(true);
  });

  it('unaffixed weapon: no procs field and no extra RNG draws beyond the plain attack+damage rolls', () => {
    const seed = findAttackSeed(9, 1, 1); // natural 10 — an ordinary, non-crit, non-fumble roll
    const party = [makeCharacter({ id: 'a', weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100 });
    const cursor = createRNGCursorForRun(seed);
    const state = initiateCombat(party, [enemy], cursor);
    state.currentTurn = state.turnOrder.indexOf('a');
    expect(cursor.getCursor('combat')).toBe(2); // two initiative draws
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(true);
    expect(result.crit).toBe(false);
    expect(cursor.getCursor('combat')).toBe(4); // + attack roll + damage roll, nothing more
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.procs).toBeUndefined();
  });
});
