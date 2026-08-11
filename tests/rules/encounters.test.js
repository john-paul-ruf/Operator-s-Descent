import { describe, it, expect } from 'vitest';
import { createStandardEncounter, createHuntEncounter, completeEncounter, getDueEchoes, consumeEcho, injectEcho } from '../../src/rules/encounters.js';
import { createRunState } from '../../src/state/run-state.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { createPRNG } from '../../src/core/prng.js';
import { generateFloor } from '../../src/floor/generator.js';
import { makeParty, makeCharacter } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

const themesData = loadData('themes');

function makeFloor() {
  return generateFloor(42, 1, {}, themesData);
}

describe('createHuntEncounter — basic structure', () => {
  it('returns a hunt encounter with kind: "hunt"', () => {
    const floor = makeFloor();
    const party = makeParty(3);
    const runState = createRunState(42, party, { depth: 5 });
    const cursor = createRNGCursorForRun(42);
    const encounter = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState, cursor, themesData);
    expect(encounter).not.toBeNull();
    expect(encounter.kind).toBe('hunt');
    expect(encounter.id).toContain('hunt_5_');
    expect(encounter.window).toBeDefined();
    expect(encounter.actors).toBeDefined();
  });

  it('deploys party and enemies on distinct cells', () => {
    const floor = makeFloor();
    const party = makeParty(3);
    const runState = createRunState(42, party, { depth: 5 });
    const cursor = createRNGCursorForRun(42);
    const encounter = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState, cursor, themesData);
    expect(encounter).not.toBeNull();
    const positions = encounter.actors.map(a => `${a.position.x},${a.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('includes at least one elite enemy (stalker, choir, null, or construct)', () => {
    const floor = makeFloor();
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 5 });
    const cursor = createRNGCursorForRun(42);
    const encounter = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState, cursor, themesData);
    expect(encounter).not.toBeNull();
    const elites = encounter.actors.filter(a => a.side === 'enemy' && a.elite);
    expect(elites.length).toBeGreaterThanOrEqual(1);
    expect(['stalker', 'choir', 'null', 'construct']).toContain(elites[0].archetypeId);
  });
});

describe('createHuntEncounter — determinism', () => {
  it('same state → same encounter', () => {
    const floor = makeFloor();
    const party = makeParty(2);
    const runState1 = createRunState(42, party, { depth: 5 });
    const runState2 = createRunState(42, party, { depth: 5 });
    const cursor1 = createRNGCursorForRun(42);
    const cursor2 = createRNGCursorForRun(42);
    const e1 = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState1, cursor1, themesData);
    const e2 = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState2, cursor2, themesData);
    expect(e1).toEqual(e2);
  });
});

describe('createHuntEncounter — geometry tolerance', () => {
  it('returns null when not enough sides available', () => {
    const tinyFloor = {
      cells: Array.from({ length: 32 }, () => new Array(20).fill(0)),
      themeId: 'cold_storage'
    };
    tinyFloor.cells[16][10] = 1;
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 5 });
    const cursor = createRNGCursorForRun(42);
    const encounter = createHuntEncounter(tinyFloor, { x: 10, y: 16 }, party, runState, cursor, themesData);
    expect(encounter).toBeNull();
  });
});

describe('threshold encounters — elite/Apex spawn', () => {
  it('threshold floor generation includes at least one apex/elite enemy', () => {
    for (const seed of [42, 99, 777]) {
      const f = generateFloor(seed, 10, {}, themesData);
      const elites = f.enemySpawns.filter(e => e.elite || e.archetypeId === 'apex');
      expect(elites.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('threshold floor includes at least one vault container', () => {
    for (const seed of [42, 99, 777]) {
      const f = generateFloor(seed, 10, {}, themesData);
      const vaults = f.containers.filter(c => c.kind === 'vault');
      expect(vaults.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('getDueEchoes — appearance tracking', () => {
  it('returns echoes whose appearanceFloor matches and are not consumed', () => {
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 1 });
    const deadChar = makeCharacter({ id: 'dead_1' });
    runState.queueEcho(deadChar, 3, createRNGCursorForRun(42));
    expect(runState.echoQueue.length).toBe(1);
    const echo = runState.echoQueue[0];
    const due = runState.getDueEchoes(echo.appearanceFloor);
    expect(due.length).toBe(1);
    expect(due[0].appearanceFloor).toBe(echo.appearanceFloor);
  });

  it('returns empty for non-matching floor', () => {
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 1 });
    const deadChar = makeCharacter({ id: 'dead_1' });
    runState.queueEcho(deadChar, 3, createRNGCursorForRun(42));
    const due = runState.getDueEchoes(1);
    expect(due.length).toBe(0);
  });
});

describe('consumeEcho — atomic consumption', () => {
  it('marks echo as consumed with resolved: killed', () => {
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 1 });
    const deadChar = makeCharacter({ id: 'dead_1' });
    runState.queueEcho(deadChar, 3, createRNGCursorForRun(42));
    const result = runState.consumeEcho(0);
    expect(result.consumed).toBe(true);
    expect(runState.echoQueue[0].consumed).toBe(true);
    expect(runState.echoQueue[0].resolved).toBe('killed');
  });

  it('double-consume returns false', () => {
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 1 });
    const deadChar = makeCharacter({ id: 'dead_1' });
    runState.queueEcho(deadChar, 3, createRNGCursorForRun(42));
    runState.consumeEcho(0);
    const result = runState.consumeEcho(0);
    expect(result.consumed).toBe(false);
  });

  it('resolveEchoRetreat marks echo as retreated', () => {
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 1 });
    const deadChar = makeCharacter({ id: 'dead_1' });
    runState.queueEcho(deadChar, 3, createRNGCursorForRun(42));
    const result = runState.resolveEchoRetreat(0);
    expect(result.resolved).toBe(true);
    expect(runState.echoQueue[0].consumed).toBe(true);
    expect(runState.echoQueue[0].resolved).toBe('retreated');
  });
});

describe('getDueEchoes — two queued echoes', () => {
  it('handles two concurrent echoes at different appearance floors', () => {
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 1 });
    const cursor = createRNGCursorForRun(42);
    runState.queueEcho(makeCharacter({ id: 'dead_1' }), 2, cursor);
    runState.queueEcho(makeCharacter({ id: 'dead_2' }), 4, cursor);
    expect(runState.echoQueue.length).toBe(2);
    const dueA = runState.getDueEchoes(runState.echoQueue[0].appearanceFloor);
    const dueB = runState.getDueEchoes(runState.echoQueue[1].appearanceFloor);
    expect(dueA.length).toBeGreaterThanOrEqual(1);
    expect(dueB.length).toBeGreaterThanOrEqual(1);
  });
});

describe('injectEcho — placement', () => {
  it('places an echo spawn at a valid floor cell', () => {
    const floor = makeFloor();
    const cells = [];
    for (let y = 0; y < floor.cells.length; y++) {
      for (let x = 0; x < floor.cells[0].length; x++) {
        if (floor.cells[y][x] === 1) cells.push({ x, y });
      }
    }
    const prng = createPRNG(42);
    const echo = { character: makeCharacter({ id: 'dead_1' }) };
    const spawn = injectEcho(floor, echo, prng, cells);
    expect(spawn).not.toBeNull();
    expect(spawn.x).toBeGreaterThanOrEqual(0);
    expect(spawn.y).toBeGreaterThanOrEqual(0);
  });

  it('returns null when no cells available', () => {
    const floor = makeFloor();
    const prng = createPRNG(42);
    const echo = { character: makeCharacter({ id: 'dead_1' }) };
    const spawn = injectEcho(floor, echo, prng, []);
    expect(spawn).toBeNull();
  });
});

describe('completeEncounter — hunt outcome', () => {
  it('victory on hunt returns resolved with loot', () => {
    const encounter = { id: 'hunt_1', kind: 'hunt', forfeitableLoot: [] };
    const combatResult = { result: 'victory', victoryPayload: { defeatedSpawnIds: [0, 1], reclaimableGear: [] } };
    const completion = completeEncounter(encounter, combatResult);
    expect(completion.resolved).toBe(true);
    expect(completion.outcome).toBe('victory');
  });

  it('retreat on hunt returns resolved with forfeitedLoot', () => {
    const encounter = { id: 'hunt_1', kind: 'hunt', forfeitableLoot: ['item1'] };
    const combatResult = { result: 'retreat' };
    const completion = completeEncounter(encounter, combatResult);
    expect(completion.resolved).toBe(true);
    expect(completion.outcome).toBe('retreat');
    expect(completion.forfeitedLoot).toEqual(['item1']);
  });
});