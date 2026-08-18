import { describe, it, expect, beforeAll } from 'vitest';
import { createEnemy } from '../../src/rules/enemies.js';
import { toCombatSnapshot } from '../../src/rules/combat.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { encodeRun, initEncoder } from '../../src/state/save-encode.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { buildRealisticRun } from '../helpers/run-builder.js';
import { loadData } from '../helpers/data.js';

// SESSION-02 pins the enemy-stat persistence contract at the snapshot seam.
// Before this session, mid-combat save/reload rebuilt every enemy from an
// empty base (base = {} in actorFromSnapshot), silently swapping the enemy's
// real defense/attributes for DEFAULT_ATTRIBUTES/10 and rewriting balance on
// resume. These tests prove the resolved stat block now survives:
//   (1) directly through toCombatSnapshot + the codec round-trip
//   (2) end-to-end through the encodeRun → decodeRun save pipeline
// The restore path must NOT re-run createEnemy — that consumes the `gen` RNG
// stream (see STATE.md Design Decision 3) — so we assert the stored stats
// come back verbatim, not derived.

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
  it('toCombatSnapshot carries the resolved enemy stat block', () => {
    const enemy = makeConstruct(4);
    const snapshot = toCombatSnapshot(buildCombatState(enemy));
    const enemyEntry = snapshot.actors.find((a) => a.side === 'enemy');
    expect(enemyEntry).toBeDefined();
    expect(enemyEntry.stats).toBeDefined();
    expect(enemyEntry.stats.archetypeId).toBe('construct');
    expect(enemyEntry.stats.defense).toBe(enemy.defense);
    expect(enemyEntry.stats.protocolDefense).toBe(enemy.protocolDefense);
    expect(enemyEntry.stats.hpMax).toBe(enemy.hpMax);
    expect(enemyEntry.stats.chargeMax).toBe(enemy.chargeMax);
    expect(enemyEntry.stats.attributes).toEqual(enemy.attributes);
    expect(enemyEntry.stats.behavior).toBe(enemy.behavior);
    expect(enemyEntry.stats.retreats).toBe(Boolean(enemy.retreats));
    expect(enemyEntry.stats.sigilCodepoint).toBe(enemy.sigilCodepoint);
  });

  it('round-trips through the save pipeline with defense/attributes preserved', () => {
    const enemy = makeConstruct(4);
    const snapshot = toCombatSnapshot(buildCombatState(enemy));
    const state = buildRealisticRun(11, { depth: 4 });
    // Position operator_1 to match party snapshot actor for validation
    state.activeCombat = snapshot;
    const encoded = encodeRun(state);
    expect(encoded.success).toBe(true);
    const decoded = decodeRun(encoded.fragment);
    expect(decoded.success).toBe(true);
    const restoredEnemy = decoded.runState.activeCombat.actors.find((a) => a.side === 'enemy');
    expect(restoredEnemy).toBeDefined();
    expect(restoredEnemy.stats.defense).toBe(enemy.defense);
    expect(restoredEnemy.stats.protocolDefense).toBe(enemy.protocolDefense);
    expect(restoredEnemy.stats.attributes).toEqual(enemy.attributes);
    expect(restoredEnemy.stats.hpMax).toBe(enemy.hpMax);
    expect(restoredEnemy.stats.chargeMax).toBe(enemy.chargeMax);
    expect(restoredEnemy.stats.behavior).toBe(enemy.behavior);
    expect(restoredEnemy.stats.retreats).toBe(Boolean(enemy.retreats));
    expect(restoredEnemy.stats.sigilCodepoint).toBe(enemy.sigilCodepoint);
    expect(restoredEnemy.stats.archetypeId).toBe('construct');
    // Sanity: a Construct is unmistakably tanky and strong; the pre-fix defaults
    // (defense 10, attributes all-5) would fail this.
    expect(restoredEnemy.stats.defense).toBeGreaterThan(10);
    expect(restoredEnemy.stats.attributes.mgt).toBeGreaterThanOrEqual(7);
    expect(restoredEnemy.stats.attributes.vit).toBeGreaterThanOrEqual(8);
  });

  it('round-trips a choir enemy including protocolAccess and chargeMax > 0', () => {
    const cursor = createRNGCursorForRun(7);
    const enemy = createEnemy('choir', 6, cursor, enemiesData);
    enemy.position = { x: 4, y: 5 };
    const snapshot = toCombatSnapshot(buildCombatState(enemy));
    const state = buildRealisticRun(13, { depth: 6 });
    state.activeCombat = snapshot;
    const encoded = encodeRun(state);
    expect(encoded.success).toBe(true);
    const decoded = decodeRun(encoded.fragment);
    expect(decoded.success).toBe(true);
    const restoredEnemy = decoded.runState.activeCombat.actors.find((a) => a.side === 'enemy');
    expect(restoredEnemy.stats.archetypeId).toBe('choir');
    expect(restoredEnemy.stats.protocolAccess).toEqual({ schools: ['disrupt', 'scry'], maxTier: 3 });
    expect(restoredEnemy.stats.chargeMax).toBe(enemy.chargeMax);
    expect(restoredEnemy.stats.chargeMax).toBeGreaterThan(0);
  });
});
