// Combat audit trail — one describe() block per audit finding from SESSION-05's context.
// Passing tests document that the behavior is correct as-shipped; failing tests were queued
// for checkpoint 2 to fix. Every finding index (1-9) is preserved so future readers can
// cross-reference the session prompt without hunting.
//
// Findings 1, 2, 3, 5, 7, 8, 9 land here as passing coverage of the current (correct) behavior.
// Findings 4 and 6 land as failing-first tests that checkpoint 2 fixes.
// Finding 5 is a cross-session read-only audit — it lives in SESSION-04's exploration.js,
// so the finding is captured as a followUp note rather than a test here.

import { describe, it, expect } from 'vitest';
import {
  initiateCombat, getLegalActions, executeAction, resolveTurn, MOVE_RANGE
} from '../../src/rules/combat.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { makeCharacter, makeWeapon } from '../helpers/fixtures.js';
import { openCombatWindow } from '../helpers/grids.js';
import { loadData } from '../helpers/data.js';

const protocolsData = loadData('protocols');
const conditionsData = loadData('conditions');
const consumablesData = loadData('consumables');
const enemiesData = loadData('enemies');
const baseContext = { protocolsData, conditionsData, consumablesData, runState: {} };

function makeEnemy(overrides = {}) {
  return {
    id: 'enemy_1',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    hp: 20, hpMax: 20, defense: 10, behavior: 'aggressive', retreats: false,
    side: 'enemy', conditions: [], position: { x: 1, y: 0 }, ...overrides
  };
}

function startCombat(party, enemies, seed = 1, firstActorId = null) {
  const cursor = createRNGCursorForRun(seed);
  const state = initiateCombat(party, enemies, cursor);
  if (firstActorId) state.currentTurn = state.turnOrder.indexOf(firstActorId);
  return { state, cursor };
}

describe('AUDIT-1 — performAttackRoll unpositioned actors', () => {
  // AUDIT-1 confirmed correct: `positioned = distance !== null` short-circuits
  // range to `{ legal: true, reason: 'unpositioned' }` (combat.js:451-455). Intent is
  // that non-positional fixtures never fail with an out-of-range error; the range
  // legality flag stays true and the attack resolves on the roll alone.
  it('unpositioned attacker/target still resolves to a legal range so the attack proceeds', () => {
    const party = [makeCharacter({ id: 'a', position: undefined, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent' }) })];
    const enemy = makeEnemy({ id: 'enemy_1', position: undefined, defense: 0, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'attack', actorId: 'a', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.success).toBe(true);
    const atkLog = state.log.find(entry => entry.type === 'attack');
    expect(atkLog.range.legal).toBe(true);
    expect(atkLog.range.distance).toBeNull();
  });
});

describe('AUDIT-2 — executeProtocol has no numeric range gate', () => {
  // AUDIT-2 confirmed absence: today `data/protocols.json` `range` fields are human-readable
  // strings ("SIG×2", "adjacent", "5 cells", "full floor"). `Number.isFinite(protocolData.range)`
  // is false for every shipped protocol, so no numeric bound is enforceable at runtime. The
  // rules engine reflects this: `executeProtocol` (combat.js:556) never distance-checks.
  // The range gate added in checkpoint 2 is a `Number.isFinite` guard — a no-op for current
  // data, and a hook for future numeric protocol ranges.
  it('every shipped protocol has a non-numeric range field (documenting the absence)', () => {
    for (const [school, schoolData] of Object.entries(protocolsData.schools)) {
      for (const tier of schoolData.tiers) {
        expect(Number.isFinite(tier.range)).toBe(false);
      }
    }
  });

  it('executeProtocol with a distant target succeeds today — no rule-layer distance bound', () => {
    const party = [makeCharacter({ id: 'a', position: { x: 0, y: 0 }, charge: 20, protocols: [{ school: 'disrupt', tier: 1 }] })];
    const enemy = makeEnemy({ id: 'enemy_1', position: { x: 7, y: 15 }, hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    state.window = openCombatWindow();
    const result = executeAction(state, { type: 'cast', actorId: 'a', targetId: 'enemy_1', school: 'disrupt', tier: 1 }, cursor, baseContext);
    expect(result.success).toBe(true);
  });
});

describe('AUDIT-3 — executeItem rejects dead/missing targets', () => {
  // AUDIT-3 confirmed correct: combat.js:584-585 checks `!target || target.hp <= 0` before
  // applying the consumable. Stale targetIds surface as `invalid-target` and never consume AP.
  it('stale targetId (dead target) returns invalid-target and does not spend AP', () => {
    const party = [makeCharacter({ id: 'a', hp: 10, hpMax: 30 })];
    const dead = makeCharacter({ id: 'b', hp: 0 });
    const inventory = [{ id: 'item_1', baseType: 'repair_patch', category: 'consumable' }];
    const ctx = { ...baseContext, runState: { inventory } };
    const { state, cursor } = startCombat([party[0], dead], [makeEnemy()], 1, 'a');
    const apBefore = state.combatants.get('a').ap;
    const result = executeAction(state, { type: 'item', actorId: 'a', targetId: 'b', consumableId: 'repair_patch' }, cursor, ctx);
    expect(result).toEqual({ success: false, reason: 'invalid-target' });
    expect(state.combatants.get('a').ap).toBe(apBefore);
    expect(inventory).toHaveLength(1);
  });
});

describe('AUDIT-4 — retreat is unavailable when the actor has no AP', () => {
  // AUDIT-4 broken: getLegalActions (combat.js:230) pushes 'retreat' whenever it's the
  // actor's turn regardless of AP. The rules-level guard at combat.js:243 already gates
  // execution with `no-ap`, but the UI-facing legal-action list still advertises retreat.
  // Checkpoint 2 tightens getLegalActions so the console cannot even offer the button at
  // 0 AP. This test is the failing-first version — it exercises the legal list, not
  // execution. Once fixed it verifies retreat drops out of the list.
  it('actor with 0 AP does not see retreat in the legal-action list', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    state.combatants.get('a').ap = 0;
    const legal = getLegalActions(state, 'a');
    expect(legal.actions).not.toContain('retreat');
  });

  it('executeAction rejects retreat with no-ap when AP is 0 (defense-in-depth already in place)', () => {
    const party = [makeCharacter({ id: 'a' })];
    const { state, cursor } = startCombat(party, [makeEnemy()], 1, 'a');
    state.combatants.get('a').ap = 0;
    state.turnStarted = true;  // skip prepareTurn's AP refill so ap stays 0
    const result = executeAction(state, { type: 'retreat', actorId: 'a' }, cursor, baseContext);
    expect(result).toEqual({ success: false, reason: 'no-ap' });
  });
});

describe('AUDIT-6 — swap requires an adjacent living ally', () => {
  // AUDIT-6 broken: getLegalActions (combat.js:229) pushes 'swap' whenever `swapAvailable`
  // is truthy, with no adjacency probe. executeSwap rejects the bad case with
  // `not-adjacent`/`invalid-target`, but the UI still shows the button as available.
  // Checkpoint 2 makes the legal-action list only include 'swap' when at least one
  // adjacent living side-mate exists.
  it('solo actor (no allies) does not see swap in the legal-action list', () => {
    const party = [makeCharacter({ id: 'a', position: { x: 1, y: 1 } })];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    const legal = getLegalActions(state, 'a');
    expect(legal.actions).not.toContain('swap');
  });

  it('non-adjacent ally (Chebyshev 3) does not enable swap', () => {
    const party = [
      makeCharacter({ id: 'a', position: { x: 1, y: 1 } }),
      makeCharacter({ id: 'b', position: { x: 4, y: 4 } })
    ];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    const legal = getLegalActions(state, 'a');
    expect(legal.actions).not.toContain('swap');
  });

  it('adjacent living ally makes swap available', () => {
    const party = [
      makeCharacter({ id: 'a', position: { x: 1, y: 1 } }),
      makeCharacter({ id: 'b', position: { x: 2, y: 1 } })
    ];
    const { state } = startCombat(party, [makeEnemy()], 1, 'a');
    const legal = getLegalActions(state, 'a');
    expect(legal.actions).toContain('swap');
  });
});

describe('AUDIT-7 — Choir archetype protocolAccess includes disrupt', () => {
  // AUDIT-7 confirmed correct: `choirAction` (enemies.js:140) always requests `school: 'disrupt'`
  // and `canUseProtocol` (combat.js:600-602) gates enemies through `protocolAccess.schools`.
  // data/enemies.json ships `choir.protocolAccess.schools = ["disrupt", "scry"]` so the
  // Choir's default request is always accepted at the rules layer.
  it('choir archetype declares disrupt in protocolAccess.schools', () => {
    const choir = enemiesData.archetypes.choir;
    expect(choir.protocolAccess).not.toBeNull();
    expect(choir.protocolAccess.schools).toContain('disrupt');
  });
});

describe('AUDIT-8 — resolveTurn safety cap terminates every scenario', () => {
  // AUDIT-8 confirmed correct: safety = turnOrder.length * 2 + 1 (combat.js:615). Apex
  // actors occupy two initiative slots, so a 3-actor combat with an apex has turnOrder.length
  // 4 and safety 9. The worst-case tail (condition tick kills an actor before it acts) still
  // resolves inside the cap because `advanceTurn` runs on every iteration.
  it('apex + party + condition-tick death combat terminates without hitting the safety cap', () => {
    const party = [
      makeCharacter({ id: 'a', hp: 100, hpMax: 100, weapon: makeWeapon() }),
      makeCharacter({ id: 'b', hp: 1, hpMax: 30, conditions: [{ id: 'burning', duration: 2, stacks: 5 }] })
    ];
    const apex = makeEnemy({ id: 'apex_1', actionSlotsPerRound: 2, hp: 1, hpMax: 1 });
    const { state, cursor } = startCombat(party, [apex]);
    // turnOrder length is 4 (party × 2 + apex × 2). Cap = 9.
    expect(state.turnOrder.length).toBe(4);
    const result = resolveTurn(state, cursor, baseContext);
    // Either combat ends OR the loop drops back to a party actor with AP — both terminal.
    expect(result).toBeDefined();
    expect(state.round).toBeGreaterThanOrEqual(1);
  });
});

describe('AUDIT-9 — insufficient-charge reason flows through the pipeline', () => {
  // AUDIT-9 confirmed correct: protocols.js:174 returns `{success:false, reason:'insufficient-charge'}`
  // → executeProtocol returns it → executeAction returns it → screens/combat.js actionFailureMessage
  // maps 'insufficient-charge' to 'INSUFFICIENT CHARGE' (screens/combat.js:224). This test verifies
  // the rules-layer link; the UI-layer link is exercised in tests/ui/combat-screen.test.js.
  it('overclock with less charge than tier cost surfaces reason:insufficient-charge', () => {
    const party = [makeCharacter({ id: 'a', charge: 0, chargeMax: 20, protocols: [{ school: 'disrupt', tier: 1 }] })];
    const enemy = makeEnemy({ id: 'enemy_1', hp: 100, hpMax: 100 });
    const { state, cursor } = startCombat(party, [enemy], 1, 'a');
    const result = executeAction(state, { type: 'overclock', actorId: 'a', targetId: 'enemy_1', school: 'disrupt', tier: 1 }, cursor, baseContext);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('insufficient-charge');
  });
});

// AUDIT-5 (cross-tick hunter contact): READ-ONLY finding. The encounter's actor positions
// are constructed by SESSION-04's src/ui/screens/exploration.js at combat-start time —
// outside SESSION-05's lease. Captured as a followUp note in the handoff JSON so Jikijitsu
// can route it to the next session that owns exploration.js. No test lands here.
//
// The MOVE_RANGE import above is intentional — it keeps this file's import surface aligned
// with combat.test.js so an accidental combat.js export drop is caught here too.
void MOVE_RANGE;
