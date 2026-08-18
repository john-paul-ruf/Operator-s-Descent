import { describe, it, expect } from 'vitest';
import { initiateCombat, executeAction } from '../../src/rules/combat.js';
import { modifier } from '../../src/rules/attributes.js';
import { makeCharacter, makeWeapon } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

const protocolsData = loadData('protocols');
const conditionsData = loadData('conditions');
const consumablesData = loadData('consumables');
const baseContext = { protocolsData, conditionsData, consumablesData, runState: {} };

// Deterministic cursor: pops `combat` values off a queue in order; any incidental
// stream/overflow read returns 0 so opportunity-attack fallout can't corrupt the
// assertions we actually care about (drone damage / target hp).
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

// Drone stat block per data/enemies.json (mgt 3 → modifier −2). This is the
// exact archetype cited in the balance decision — low MGT means a low damage
// roll on a landed melee hit floors negative before the on-hit clamp.
function makeDrone(overrides = {}) {
  return {
    id: 'drone_1',
    archetypeId: 'drone',
    attributes: { mgt: 3, fin: 5, vit: 2, res: 1, foc: 2, sig: 3 },
    hp: 20,
    hpMax: 20,
    defense: 10,
    behavior: 'aggressive',
    retreats: false,
    side: 'enemy',
    conditions: [],
    position: { x: 1, y: 0 },
    weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }),
    ...overrides
  };
}

describe('performAttackRoll — on-hit damage floor (minimum 1)', () => {
  it('Drone melee hit with a natural-1 damage roll deals 1 damage (not 0)', () => {
    // mgt 3 → modifier(-2). Attack roll 15 vs defense 5 → hits (13 ≥ 5).
    // Damage: d6 roll of 1 + (-2) = -1 → floored to 1 (was 0 before the fix).
    const target = makeCharacter({ id: 'target', hp: 30, hpMax: 30, defense: 5, position: { x: 0, y: 0 } });
    const drone = makeDrone();
    // Queue: initiative_target(0), initiative_drone(0), attack_roll(14→nat15), damage_roll(0→nat1).
    const cursor = fixedCursor([0, 0, 14, 0]);
    const state = initiateCombat([target], [drone], cursor);
    state.currentTurn = state.turnOrder.indexOf('drone_1');
    const hpBefore = state.combatants.get('target').hp;

    const result = executeAction(
      state,
      { type: 'attack', actorId: 'drone_1', targetId: 'target' },
      cursor,
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.hit).toBe(true);
    expect(result.crit).toBe(false);
    expect(result.fumble).toBe(false);
    expect(result.damage).toBeGreaterThanOrEqual(1);
    expect(result.damage).toBe(1);
    expect(hpBefore - state.combatants.get('target').hp).toBeGreaterThanOrEqual(1);
    // Confirm the ledger recorded the clamped damage — not the pre-clamp -1.
    const atkLog = state.log.find(entry => entry.type === 'attack');
    expect(atkLog.damage).toBe(1);
    expect(atkLog.attributeModifier).toBe(modifier(3));
  });

  it('miss still deals 0 damage (floor only applies inside the hit branch)', () => {
    // Attack roll 5 + (-2) = 3 vs defense 30 → miss. Not a fumble, no OA path.
    const target = makeCharacter({ id: 'target', hp: 30, hpMax: 30, defense: 30, position: { x: 0, y: 0 } });
    const drone = makeDrone();
    const cursor = fixedCursor([0, 0, 4]);
    const state = initiateCombat([target], [drone], cursor);
    state.currentTurn = state.turnOrder.indexOf('drone_1');

    const result = executeAction(
      state,
      { type: 'attack', actorId: 'drone_1', targetId: 'target' },
      cursor,
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.hit).toBe(false);
    expect(result.fumble).toBe(false);
    expect(result.damage).toBe(0);
    expect(state.combatants.get('target').hp).toBe(30);
  });

  it('fumble (nat 1) still deals 0 damage', () => {
    // Nat 1 auto-misses regardless of totals; the fumble branch never enters
    // the hit damage code, so the on-hit floor doesn't apply.
    const target = makeCharacter({ id: 'target', hp: 30, hpMax: 30, defense: 1, position: { x: 0, y: 0 } });
    const drone = makeDrone();
    const cursor = fixedCursor([0, 0, 0]);
    const state = initiateCombat([target], [drone], cursor);
    state.currentTurn = state.turnOrder.indexOf('drone_1');

    const result = executeAction(
      state,
      { type: 'attack', actorId: 'drone_1', targetId: 'target' },
      cursor,
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.hit).toBe(false);
    expect(result.fumble).toBe(true);
    expect(result.damage).toBe(0);
    // The drone deals nothing; target HP unchanged (OA from target may fire but
    // targets the drone, not itself).
    expect(state.combatants.get('target').hp).toBe(30);
  });

  it('crit (nat 20) still deals dieSize (+ melee modifier), floor doesn\'t truncate it', () => {
    // Nat 20 auto-hits and takes the crit branch (damage = dieSize). For a
    // Drone (mgt 3, mod -2) with d6: damage = 6 + (-2) = 4, floored at 1 → 4.
    const target = makeCharacter({ id: 'target', hp: 30, hpMax: 30, defense: 10, position: { x: 0, y: 0 } });
    const drone = makeDrone();
    const cursor = fixedCursor([0, 0, 19]);
    const state = initiateCombat([target], [drone], cursor);
    state.currentTurn = state.turnOrder.indexOf('drone_1');

    const result = executeAction(
      state,
      { type: 'attack', actorId: 'drone_1', targetId: 'target' },
      cursor,
      baseContext
    );

    expect(result.success).toBe(true);
    expect(result.hit).toBe(true);
    expect(result.crit).toBe(true);
    expect(result.damage).toBe(6 + modifier(3)); // 6 + (-2) = 4
    expect(state.combatants.get('target').hp).toBe(30 - (6 + modifier(3)));
  });
});
