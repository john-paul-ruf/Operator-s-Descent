import { describe, it, expect, beforeAll } from 'vitest';
import { createEnemy } from '../../src/rules/enemies.js';
import { deriveEnemyStats, toCombatSnapshot } from '../../src/rules/combat.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { encodeRun, initEncoder } from '../../src/state/save-encode.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { buildRealisticRun } from '../helpers/run-builder.js';
import { loadData } from '../helpers/data.js';

// SESSION-02 (v4) pins the enemy-stat persistence contract at the snapshot
// seam. Standard-archetype enemies are a pure function of
// (archetypeId, depth), so the wire format only carries the fields that
// vary per instance (hpMax, chargeMax, sigilCodepoint) and the runtime
// re-derives attributes/defense/behavior/protocolAccess via
// deriveEnemyStats on restore. These tests prove:
//   (1) toCombatSnapshot emits the slim v4 block for standard archetypes
//   (2) encode → decode preserves the slim block byte-for-byte
//   (3) deriveEnemyStats reconstructs the full stat block identically to
//       createEnemy (excluding the RNG-picked sigil, which is persisted)
//   (4) the derived template is what actorFromSnapshot fills in for
//       defense/attributes/behavior/retreats/protocolAccess on resume
// The restore path must NOT re-run createEnemy — that consumes the `gen` RNG
// stream (see STATE.md Design Decision 3) — deriveEnemyStats is pure.

const enemiesData = loadData('enemies');
const symbolTable = loadData('symbol-table');

beforeAll(() => initEncoder(symbolTable));

function makeConstruct(depth = 4) {
  const cursor = createRNGCursorForRun(1234);
  const enemy = createEnemy('construct', depth, cursor, enemiesData);
  enemy.position = { x: 3, y: 4 };
  return enemy;
}

function buildCombatState(enemy) {
  const party = {
    id: 'operator_1',
    side: 'party',
    position: { x: 1, y: 1 },
    hp: 22,
    hpMax: 22,
    charge: 4,
    chargeMax: 4,
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    conditions: [],
    initiative: 12,
    ap: 2,
    moveAvailable: true,
    freeActions: 0,
    defeated: false,
    retreated: false
  };
  const enemyActor = {
    ...enemy,
    side: 'enemy',
    initiative: 7,
    ap: 2,
    moveAvailable: true,
    freeActions: 0,
    defeated: false,
    retreated: false
  };
  const combatants = new Map();
  combatants.set(party.id, party);
  combatants.set(enemyActor.id, enemyActor);
  return {
    id: 'encounter_3_4_1',
    kind: 'standard',
    round: 1,
    currentTurn: 0,
    turnOrder: [party.id, enemyActor.id],
    combatants,
    log: [],
    ended: false,
    result: null,
    window: { originX: 3, originY: 4 }
  };
}

describe('enemy combat stats survive save/restore', () => {
  it('toCombatSnapshot emits the v4 slim block for standard archetypes', () => {
    const enemy = makeConstruct(4);
    const snapshot = toCombatSnapshot(buildCombatState(enemy));
    const enemyEntry = snapshot.actors.find((a) => a.side === 'enemy');
    expect(enemyEntry).toBeDefined();
    expect(enemyEntry.stats).toEqual({
      archetypeId: 'construct',
      hpMax: enemy.hpMax,
      chargeMax: enemy.chargeMax,
      sigilCodepoint: enemy.sigilCodepoint
    });
  });

  it('round-trips through the save pipeline preserving the slim block byte-for-byte', () => {
    const enemy = makeConstruct(4);
    const snapshot = toCombatSnapshot(buildCombatState(enemy));
    const state = buildRealisticRun(11, { depth: 4 });
    state.activeCombat = snapshot;
    const encoded = encodeRun(state);
    expect(encoded.success).toBe(true);
    const decoded = decodeRun(encoded.fragment);
    expect(decoded.success).toBe(true);
    const restoredEnemy = decoded.runState.activeCombat.actors.find((a) => a.side === 'enemy');
    expect(restoredEnemy).toBeDefined();
    expect(restoredEnemy.stats).toEqual({
      archetypeId: 'construct',
      hpMax: enemy.hpMax,
      chargeMax: enemy.chargeMax,
      sigilCodepoint: enemy.sigilCodepoint
    });
  });

  it('deriveEnemyStats reconstructs the same template createEnemy produced (excluding sigil)', () => {
    // Every standard archetype at multiple depths — this is the parity
    // guard that pins the runtime re-derivation to createEnemy. If either
    // side drifts (attribute formulas, hp/defense scaling, behavior list,
    // never-retreat set), this test lights up and the v4 restore path
    // silently corrupts enemy balance until it's fixed.
    for (const archetypeId of ['drone', 'warden', 'stalker', 'choir', 'null', 'construct', 'phantom', 'apex']) {
      for (const depth of [1, 4, 10, 50]) {
        const cursor = createRNGCursorForRun(depth * 100 + 7);
        const enemy = createEnemy(archetypeId, depth, cursor, enemiesData);
        const derived = deriveEnemyStats(archetypeId, depth, enemiesData);
        expect(derived).toBeTruthy();
        expect(derived.archetypeId).toBe(archetypeId);
        expect(derived.attributes).toEqual(enemy.attributes);
        expect(derived.defense).toBe(enemy.defense);
        expect(derived.protocolDefense).toBe(enemy.protocolDefense);
        expect(derived.hpMax).toBe(enemy.hpMax);
        expect(derived.chargeMax).toBe(enemy.chargeMax);
        expect(derived.behavior).toBe(enemy.behavior);
        expect(derived.retreats).toBe(Boolean(enemy.retreats));
        expect(derived.protocolAccess ?? null).toEqual(enemy.protocolAccess ?? null);
      }
    }
  });

  it('choir re-derives protocolAccess and chargeMax > 0 from archetype + depth', () => {
    const cursor = createRNGCursorForRun(7);
    const enemy = createEnemy('choir', 6, cursor, enemiesData);
    const derived = deriveEnemyStats('choir', 6, enemiesData);
    expect(derived.protocolAccess).toEqual({ schools: ['disrupt', 'scry'], maxTier: 3 });
    expect(derived.chargeMax).toBe(enemy.chargeMax);
    expect(derived.chargeMax).toBeGreaterThan(0);
    expect(derived.behavior).toBe('artillery');
    expect(derived.retreats).toBe(true);
  });

  it('deriveEnemyStats returns null for archetypes it cannot derive (echo, unknown)', () => {
    // Echoes inherit party-character attributes, so the codec still
    // persists the full inline template for them; the runtime falls back
    // to persistedStats.* when derivedStats is null.
    expect(deriveEnemyStats('echo', 4, enemiesData)).toBeNull();
    expect(deriveEnemyStats('nonexistent', 4, enemiesData)).toBeNull();
    expect(deriveEnemyStats(null, 4, enemiesData)).toBeNull();
  });
});
