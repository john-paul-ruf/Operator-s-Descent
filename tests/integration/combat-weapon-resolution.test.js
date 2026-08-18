import { describe, it, expect } from 'vitest';
import { initiateCombat, executeAction } from '../../src/rules/combat.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { resolveLoadout, evaluateRange } from '../../src/rules/equipment.js';
import { makeCharacter, findSeed } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

// Prep→engine seam test. The reported bug: every armed party attack missed 100% of
// the time because materializeItem/normalizeItem store the equipped weapon as an
// object with `baseType` and no base stats, and (a) equipped()/resolveLoadout
// silently returned null-stat weapons for object sources, and (b) combat prep
// never called resolveLoadout at all. This file pins the fix at the seam
// resolveLoadout → engine — the equipment unit test covers (a); this covers (b)
// by proving the resolved weapon lands a hit and the raw item does not.

const equipmentData = loadData('equipment');
const affixesData = loadData('affixes');
const conditionsData = loadData('conditions');
const protocolsData = loadData('protocols');
const consumablesData = loadData('consumables');
const baseContext = { protocolsData, conditionsData, consumablesData, runState: {} };

// Object-form weapon exactly as produced by materializeItem → normalizeItem — no
// damageDie/rangeBand on the item itself; the catalog owns those fields.
function objectFormSidearm() {
  return { id: 'operator-weapon-sidearm', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
}

function makeEnemy(overrides = {}) {
  return {
    id: 'enemy_1',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    hp: 1,
    hpMax: 1,
    defense: 0,
    behavior: 'aggressive',
    retreats: false,
    side: 'enemy',
    conditions: [],
    position: { x: 1, y: 0 },
    ...overrides,
  };
}

function startCombat(party, enemies, seed, firstActorId) {
  const cursor = createRNGCursorForRun(seed);
  const state = initiateCombat(party, enemies, cursor);
  if (firstActorId) state.currentTurn = state.turnOrder.indexOf(firstActorId);
  return { state, cursor };
}

// Find a seed where the third combat d20 (after 2 initiative rolls) is a nat 20
// (auto-hit, max damage) — mirrors combat.test.js's findAttackSeed pattern.
function findCritSeed() {
  return findSeed((seed) => {
    const cursor = createRNGCursorForRun(seed);
    for (let i = 0; i < 2; i++) cursor.nextInt('combat', 20);
    return cursor.nextInt('combat', 20) === 19;
  });
}

describe('combat weapon resolution — prep→engine seam', () => {
  it('a stock-armed party member with an object-form weapon lands a hit at adjacent range', () => {
    const character = { equipment: { weapon: objectFormSidearm(), armor: null, offhand: null } };
    const { weapon } = resolveLoadout(character, equipmentData, affixesData);
    // Sanity: the resolver now sees the catalog fields.
    expect(weapon).toMatchObject({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1 });
    expect(evaluateRange(weapon, 1).legal).toBe(true);

    const seed = findCritSeed();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon })];
    const { state, cursor } = startCombat(party, [makeEnemy()], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.hit).toBe(true);
    expect(result.damage).toBeGreaterThanOrEqual(1);
  });

  it('the raw object-form item without resolution is rejected as not_a_weapon and misses', () => {
    // Negative control that documents the pre-fix failure mode: an unresolved
    // item has no rangeBand/maxRange, so evaluateRange short-circuits and the
    // attack cannot hit — the exact chain that broke every party attack.
    const raw = objectFormSidearm();
    expect(evaluateRange(raw, 1)).toMatchObject({ legal: false, reason: 'not_a_weapon' });

    const seed = findCritSeed();
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, weapon: raw })];
    const enemy = makeEnemy({ hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], seed, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.success).toBe(true);
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
    const atkLog = state.log.find((entry) => entry.type === 'attack');
    expect(atkLog.range.legal).toBe(false);
  });
});
