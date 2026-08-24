import { describe, it, expect } from 'vitest';
import { initiateCombat, executeAction } from '../../src/rules/combat.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { modifier } from '../../src/rules/attributes.js';
import { makeCharacter, makeWeapon, findSeed } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';
import { openCombatWindow } from '../helpers/grids.js';

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
    expect(atkLog.leech).toBeUndefined();
  });
});

describe('performAttackRoll — vampiric leech', () => {
  it('heals the attacker 1 HP on hit, capped at hpMax', () => {
    const weapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { healing: 1 } } };
    const party = [makeCharacter({ id: 'a', hp: 18, hpMax: 20, weapon })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9, 2], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.hit).toBe(true);
    expect(atkLog.leech).toBe(1);
    expect(state.combatants.get('a').hp).toBe(19);
  });

  it('does not overheal past hpMax and omits leech when nothing was healed', () => {
    const weapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { healing: 1 } } };
    const party = [makeCharacter({ id: 'a', hp: 20, hpMax: 20, weapon })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9, 2], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.hit).toBe(true);
    expect(atkLog.leech).toBeUndefined();
    expect(state.combatants.get('a').hp).toBe(20);
  });

  it('does not heal on a miss', () => {
    const weapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }), effects: { onHit: { healing: 1 } } };
    const party = [makeCharacter({ id: 'a', hp: 18, hpMax: 20, weapon })];
    const enemy = makeEnemy({ defense: 30, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9], 'a'); // nat10, total 10 < 30 → miss
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.hit).toBe(false);
    expect(atkLog.leech).toBeUndefined();
    expect(state.combatants.get('a').hp).toBe(18);
  });
});

describe('performAttackRoll — phasing weapon ignores cover', () => {
  it('negates a positive cover bonus from intervening walls', () => {
    const window = openCombatWindow();
    window.cells[0][2] = 0;
    window.cells[0][3] = 0; // two blocked crossings — would be full cover (+4) without phasing
    const weapon = { ...makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 0 }), effects: { attack: { ignoreCover: true } } };
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon })];
    const enemy = makeEnemy({ position: { x: 4, y: 0 }, defense: 10, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9], 'a');
    state.window = window;
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.coverBonus).toBe(0);
    expect(atkLog.targetDefense).toBe(10);
  });
});

describe('performAttackRoll — effective FIN (attack + initiative)', () => {
  it('attack modifier uses effectiveAttributes.fin over raw attributes.fin when present', () => {
    const party = [makeCharacter({
      id: 'a',
      attributes: { mgt: 5, fin: 10, vit: 5, res: 5, foc: 5, sig: 5 },
      effectiveAttributes: { mgt: 5, fin: 1, vit: 5, res: 5, foc: 5, sig: 5 },
      weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 0 })
    })];
    const enemy = makeEnemy({ defense: 30, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.attributeModifier).toBe(modifier(1));
    expect(atkLog.attributeModifier).not.toBe(modifier(10));
  });

  it('falls back to raw attributes.fin — byte-identical to today — when effectiveAttributes is absent', () => {
    const party = [makeCharacter({
      id: 'a',
      attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
      weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 4, accuracyBonus: 0 })
    })];
    const enemy = makeEnemy({ defense: 30, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9], 'a');
    executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.attributeModifier).toBe(modifier(5));
  });

  it('initiative uses effectiveAttributes.fin over raw attributes.fin when present', () => {
    const heavy = makeCharacter({
      id: 'a',
      attributes: { mgt: 5, fin: 10, vit: 5, res: 5, foc: 5, sig: 5 },
      effectiveAttributes: { mgt: 5, fin: 1, vit: 5, res: 5, foc: 5, sig: 5 }
    });
    const enemy = makeEnemy({ id: 'enemy_1' });
    const cursor = fixedCursor([9, 0]); // a: nat10, enemy: nat1
    const state = initiateCombat([heavy], [enemy], cursor);
    expect(state.combatants.get('a').initiative).toBe(10 + modifier(1));
  });
});

describe('performAttackRoll — Lucky auto-reroll', () => {
  function luckyWeapon() {
    return makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' });
  }

  it('miss + available → draws a second d20, keeps the better result, sets the use flag', () => {
    const party = [makeCharacter({ id: 'a', weapon: luckyWeapon() })];
    const enemy = makeEnemy({ defense: 12, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 4, 14, 2], 'a'); // nat5 (miss) → nat15 (hit) → damage
    const actor = state.combatants.get('a');
    actor.luckyReroll = { available: true, itemId: 'lucky_1' };
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(true);
    expect(actor.luckyRerollUsed).toBe(true);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.luckyReroll).toEqual({ itemId: 'lucky_1', firstNatural: 5, keptNatural: 15 });
    expect(atkLog.naturalRoll).toBe(15);
  });

  it('second miss still consumes the use and keeps the better (still-losing) roll', () => {
    const party = [makeCharacter({ id: 'a', weapon: luckyWeapon() })];
    const enemy = makeEnemy({ defense: 12, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 4, 3], 'a'); // nat5 (miss) → nat4 (still miss, worse)
    const actor = state.combatants.get('a');
    actor.luckyReroll = { available: true, itemId: 'lucky_1' };
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(false);
    expect(actor.luckyRerollUsed).toBe(true);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.luckyReroll).toEqual({ itemId: 'lucky_1', firstNatural: 5, keptNatural: 5 });
  });

  it('a fumble is rerolled before the fumble-reaction opportunity attack fires', () => {
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon: luckyWeapon() })];
    const target = makeEnemy({ id: 'target', position: { x: 1, y: 0 }, defense: 5, hp: 100, hpMax: 100 });
    const reactor = makeEnemy({ id: 'reactor', position: { x: 0, y: 1 }, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [target, reactor], [0, 0, 0, 0, 14, 2], 'a'); // nat1 (fumble) → nat15 (hit) → damage
    const actor = state.combatants.get('a');
    actor.luckyReroll = { available: true, itemId: 'lucky_1' };
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'target' }, cursor, baseContext);
    expect(result.hit).toBe(true);
    expect(result.fumble).toBe(false);
    const atkLog = state.log.find(e => e.type === 'attack');
    expect(atkLog.luckyReroll.firstNatural).toBe(1);
    expect(atkLog.triggeredAttacks).toHaveLength(0);
    expect(state.log.filter(e => e.type === 'attack')).toHaveLength(1);
  });

  it('no reroll when unavailable, already used, or the attacker is on the enemy side', () => {
    const missSetup = () => {
      const party = [makeCharacter({ id: 'a', weapon: luckyWeapon() })];
      const enemy = makeEnemy({ defense: 12, hp: 100, hpMax: 100 });
      return startCombat(party, [enemy], [0, 0, 4], 'a'); // nat5 (miss); no second value queued
    };

    const unavailable = missSetup();
    const r1 = executeAction(unavailable.state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, unavailable.cursor, baseContext);
    expect(r1.hit).toBe(false);
    expect(unavailable.state.log.find(e => e.type === 'attack').luckyReroll).toBeUndefined();

    const used = missSetup();
    used.state.combatants.get('a').luckyReroll = { available: true, itemId: 'lucky_1' };
    used.state.combatants.get('a').luckyRerollUsed = true;
    const r2 = executeAction(used.state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, used.cursor, baseContext);
    expect(r2.hit).toBe(false);
    expect(used.state.log.find(e => e.type === 'attack').luckyReroll).toBeUndefined();

    const enemyParty = [makeCharacter({ id: 'a', hp: 100, hpMax: 100 })];
    const enemyAttacker = makeEnemy({ id: 'enemy_1', weapon: luckyWeapon(), defense: 12 });
    const { state: enemyState, cursor: enemyCursor } = startCombat(enemyParty, [enemyAttacker], [0, 0, 4], 'enemy_1');
    enemyState.combatants.get('enemy_1').luckyReroll = { available: true, itemId: 'lucky_1' };
    const r3 = executeAction(enemyState, { type: 'attack', actorId: 'enemy_1', targetId: 'a' }, enemyCursor, baseContext);
    expect(r3.hit).toBe(false);
    expect(enemyState.log.find(e => e.type === 'attack').luckyReroll).toBeUndefined();
  });

  it('a hit never triggers a reroll, even when available', () => {
    const party = [makeCharacter({ id: 'a', weapon: luckyWeapon() })];
    const enemy = makeEnemy({ defense: 5, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], [0, 0, 9, 2], 'a'); // nat10 hits def5
    const actor = state.combatants.get('a');
    actor.luckyReroll = { available: true, itemId: 'lucky_1' };
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.hit).toBe(true);
    expect(actor.luckyRerollUsed).toBeUndefined();
    expect(state.log.find(e => e.type === 'attack').luckyReroll).toBeUndefined();
  });
});
