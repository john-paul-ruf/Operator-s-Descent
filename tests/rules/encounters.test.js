import { describe, it, expect } from 'vitest';
import { createStandardEncounter, createHuntEncounter, completeEncounter, getDueEchoes, consumeEcho, injectEcho, deployBands, gatherChainedSpawns } from '../../src/rules/encounters.js';
import { createEnemy } from '../../src/rules/enemies.js';
// windowMetricsOfWindow / buildRawWindow below are local mirrors used by the widening tests.
import { createRunState } from '../../src/state/run-state.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { createPRNG } from '../../src/core/prng.js';
import { generateFloor } from '../../src/floor/generator.js';
import { makeParty, makeCharacter } from '../helpers/fixtures.js';
import { makeGrid, reachable } from '../helpers/grids.js';
import { loadData } from '../helpers/data.js';

const themesData = loadData('themes');
const enemiesData = loadData('enemies');
// Bundled game-data registry for hunt encounters, which read data.themes AND data.enemies
// (themes for the enemyMixWeights table, enemies for the archetype registry that hydrateSpawn
// consults). Structural mirror of the runtime game-data registry from src/data-loader.js.
const huntData = { themes: themesData, enemies: enemiesData };

function makeFloor() {
  return generateFloor(42, 1, {}, themesData);
}

// 20x32 floor whose upper 16 rows are wide open and lower 16 rows are walled except a
// two-column strip on the left edge. Picking a window centered on (contact.x-4, contact.y-8)
// slices the wall; shifting UP by several rows yields far more open cells.
function makeLeftEdgeAsymmetricFloor() {
  const cells = Array.from({ length: 32 }, () => new Array(20).fill(1));
  for (let y = 16; y < 32; y++) {
    for (let x = 2; x < 20; x++) cells[y][x] = 0;
  }
  return cells;
}

// 20x32 floor with two wide-open rooms connected by a single 1-cell corridor running through
// the middle. A contact inside that corridor gives an initial window dominated by walls; the
// scoring loop should still pick the best-open slice available before widening runs.
function makeCorridorSpotFloor() {
  const cells = Array.from({ length: 32 }, () => new Array(20).fill(0));
  for (let y = 4; y < 13; y++) {
    for (let x = 2; x < 18; x++) cells[y][x] = 1;
  }
  for (let y = 20; y < 29; y++) {
    for (let x = 2; x < 18; x++) cells[y][x] = 1;
  }
  for (let y = 12; y < 21; y++) cells[y][10] = 1;
  return cells;
}

describe('createHuntEncounter — basic structure', () => {
  it('returns a hunt encounter with kind: "hunt"', () => {
    const floor = makeFloor();
    const party = makeParty(3);
    const runState = createRunState(42, party, { depth: 5 });
    const cursor = createRNGCursorForRun(42);
    const encounter = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState, cursor, huntData);
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
    const encounter = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState, cursor, huntData);
    expect(encounter).not.toBeNull();
    const positions = encounter.actors.map(a => `${a.position.x},${a.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('includes at least one elite enemy (stalker, choir, null, or construct)', () => {
    const floor = makeFloor();
    const party = makeParty(2);
    const runState = createRunState(42, party, { depth: 5 });
    const cursor = createRNGCursorForRun(42);
    const encounter = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState, cursor, huntData);
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
    const e1 = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState1, cursor1, huntData);
    const e2 = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState2, cursor2, huntData);
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
    const encounter = createHuntEncounter(tinyFloor, { x: 10, y: 16 }, party, runState, cursor, huntData);

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

describe('carveWindow — scoring loop over candidate origins (SESSION-03 checkpoint 1)', () => {
  const cursor = createRNGCursorForRun(1);
  const party = [makeCharacter({ id: 'a' })];
  const enemy = [{ id: 'e1', archetypeId: 'drone' }];
  // Standard-encounter hydration options — combat-and-ux-feedback-pass SESSION-01.
  // Kept at depth 1 for these window-geometry tests; hydrated hp/hpMax are not asserted here
  // (see the "hydrates a bare spawn stub" test below for the hp regression assertion).
  const hydration = { enemiesData, depth: 1 };

  it('left-edge contact clamps originX to 0 but the picked window shifts DOWN for openness', () => {
    const floor = { cells: makeLeftEdgeAsymmetricFloor(), themeId: 'cold_storage' };
    const encounter = createStandardEncounter(floor, { x: 0, y: 16 }, party, enemy, cursor, hydration);
    expect(encounter.window.originX).toBe(0);
    // The old deterministic origin would be y = max(0, 16-8) = 8. The scoring loop must NOT
    // pick that when a shifted-up origin yields substantially more open cells.
    expect(encounter.window.originY).not.toBe(8);
    expect(encounter.window.originY).toBeLessThan(8);
    expect(encounter.window.width).toBe(8);
    expect(encounter.window.height).toBe(16);
  });

  it('corner contact never yields a negative origin', () => {
    const floor = { cells: makeLeftEdgeAsymmetricFloor(), themeId: 'cold_storage' };
    const encounter = createStandardEncounter(floor, { x: 0, y: 0 }, party, enemy, cursor, hydration);
    expect(encounter.window.originX).toBeGreaterThanOrEqual(0);
    expect(encounter.window.originY).toBeGreaterThanOrEqual(0);
    expect(encounter.window.width).toBe(8);
    expect(encounter.window.height).toBe(16);
  });

  it('contact against the far bottom-right edge clamps origin to grid maxima', () => {
    const floor = { cells: makeLeftEdgeAsymmetricFloor(), themeId: 'cold_storage' };
    const encounter = createStandardEncounter(floor, { x: 19, y: 31 }, party, enemy, cursor, hydration);
    // Floor is 20x32; window 8x16 → maxOX = 12, maxOY = 16. Every candidate origin clamps here.
    expect(encounter.window.originX).toBe(12);
    expect(encounter.window.originY).toBe(16);
    expect(encounter.window.width).toBe(8);
    expect(encounter.window.height).toBe(16);
  });

  it('same (floorCells, contact) inputs produce byte-identical output on repeat calls', () => {
    const floor = { cells: makeCorridorSpotFloor(), themeId: 'cold_storage' };
    const c1 = createStandardEncounter(floor, { x: 10, y: 16 }, party, enemy, cursor, hydration);
    const c2 = createStandardEncounter(floor, { x: 10, y: 16 }, party, enemy, cursor, hydration);
    expect(JSON.stringify(c1.window.cells)).toBe(JSON.stringify(c2.window.cells));
    expect(c1.window.originX).toBe(c2.window.originX);
    expect(c1.window.originY).toBe(c2.window.originY);
  });

  it('window dimensions are always 8x16', () => {
    const floors = [
      { cells: makeLeftEdgeAsymmetricFloor(), themeId: 'cold_storage' },
      { cells: makeCorridorSpotFloor(), themeId: 'cold_storage' }
    ];
    const contacts = [
      { x: 0, y: 0 }, { x: 0, y: 16 }, { x: 10, y: 16 }, { x: 19, y: 31 }, { x: 5, y: 5 }
    ];
    for (const floor of floors) {
      for (const contact of contacts) {
        const e = createStandardEncounter(floor, contact, party, enemy, cursor, hydration);
        expect(e.window.width).toBe(8);
        expect(e.window.height).toBe(16);
        expect(e.window.cells.length).toBe(16);
        for (const row of e.window.cells) expect(row.length).toBe(8);
      }
    }
  });
});

describe('carveWindow — post-carve widening (SESSION-03 checkpoint 2)', () => {
  const cursor = createRNGCursorForRun(1);
  const party = [makeCharacter({ id: 'a' })];
  const enemy = [{ id: 'e1', archetypeId: 'drone' }];
  const hydration = { enemiesData, depth: 1 };

  it('narrow-corridor contact yields a spacious final window (>= 48 open cells, >= 2 2x2 regions)', () => {
    const floor = { cells: makeCorridorSpotFloor(), themeId: 'cold_storage' };
    const encounter = createStandardEncounter(floor, { x: 10, y: 16 }, party, enemy, cursor, hydration);
    const metrics = windowMetricsOfWindow(encounter.window.cells);
    expect(metrics.openCells).toBeGreaterThanOrEqual(48);
    expect(metrics.twoByTwoRegions).toBeGreaterThanOrEqual(2);
  });

  it('final window on any tested corridor contact never has fewer than 32 open cells', () => {
    const floor = { cells: makeCorridorSpotFloor(), themeId: 'cold_storage' };
    const contacts = [
      { x: 5, y: 8 }, { x: 10, y: 16 }, { x: 10, y: 20 }, { x: 15, y: 25 }, { x: 3, y: 5 }
    ];
    for (const contact of contacts) {
      const e = createStandardEncounter(floor, contact, party, enemy, cursor, hydration);
      const metrics = windowMetricsOfWindow(e.window.cells);
      expect(metrics.openCells).toBeGreaterThanOrEqual(32);
    }
  });

  it('deployBands returns anchors with Chebyshev separation >= 8 on the widened corridor case', () => {
    const floor = { cells: makeCorridorSpotFloor(), themeId: 'cold_storage' };
    const enemies2 = [
      { id: 'e1', archetypeId: 'drone' }, { id: 'e2', archetypeId: 'drone' }
    ];
    const encounter = createStandardEncounter(floor, { x: 10, y: 16 }, makeParty(2), enemies2, cursor, hydration);
    const partyPositions = encounter.actors.filter(a => a.side === 'party').map(a => a.position);
    const hostilePositions = encounter.actors.filter(a => a.side === 'enemy').map(a => a.position);
    let minSeparation = Infinity;
    for (const p of partyPositions) for (const h of hostilePositions) {
      minSeparation = Math.min(minSeparation, Math.max(Math.abs(p.x - h.x), Math.abs(p.y - h.y)));
    }
    expect(minSeparation).toBeGreaterThanOrEqual(8);
  });

  it('widening never opens a border cell — the outer ring matches the raw crop', () => {
    const floor = { cells: makeCorridorSpotFloor(), themeId: 'cold_storage' };
    const contacts = [
      { x: 10, y: 16 }, { x: 5, y: 8 }, { x: 15, y: 20 }
    ];
    for (const contact of contacts) {
      const e = createStandardEncounter(floor, contact, party, enemy, cursor, hydration);
      const raw = buildRawWindow(floor.cells, e.window.originX, e.window.originY);
      for (let x = 0; x < 8; x++) {
        expect(e.window.cells[0][x]).toBe(raw[0][x]);
        expect(e.window.cells[15][x]).toBe(raw[15][x]);
      }
      for (let y = 0; y < 16; y++) {
        expect(e.window.cells[y][0]).toBe(raw[y][0]);
        expect(e.window.cells[y][7]).toBe(raw[y][7]);
      }
    }
  });

  it('widening is idempotent — re-carving on the same inputs is a no-op', () => {
    const floor = { cells: makeCorridorSpotFloor(), themeId: 'cold_storage' };
    const contact = { x: 10, y: 16 };
    const first = createStandardEncounter(floor, contact, party, enemy, cursor, hydration);
    const second = createStandardEncounter(floor, contact, party, enemy, cursor, hydration);
    expect(JSON.stringify(first.window.cells)).toBe(JSON.stringify(second.window.cells));
  });

  it('carveWindow never mutates the input floorCells (widening writes only into the window)', () => {
    const floor = { cells: makeCorridorSpotFloor(), themeId: 'cold_storage' };
    const before = JSON.stringify(floor.cells);
    createStandardEncounter(floor, { x: 10, y: 16 }, party, enemy, cursor, hydration);
    createStandardEncounter(floor, { x: 5, y: 5 }, party, enemy, cursor, hydration);
    expect(JSON.stringify(floor.cells)).toBe(before);
  });
});

// Local re-computation of window metrics for widening assertions. Mirrors the internal
// windowMetrics logic in src/rules/encounters.js but takes a pre-built cells grid so we can
// measure the ALREADY-WIDENED window rather than rebuilding from floorCells.
function windowMetricsOfWindow(cells) {
  const H = cells.length;
  const W = cells[0].length;
  const isOpen = (x, y) => y >= 0 && y < H && x >= 0 && x < W && cells[y][x] !== 0;
  let openCells = 0;
  let oneWideCorridors = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isOpen(x, y)) continue;
      openCells++;
      const n = isOpen(x, y - 1), s = isOpen(x, y + 1), e = isOpen(x + 1, y), w = isOpen(x - 1, y);
      const on = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (w ? 1 : 0);
      if (on === 2 && ((n && s) || (e && w))) oneWideCorridors++;
    }
  }
  const claimed = Array.from({ length: H }, () => new Array(W).fill(false));
  let twoByTwoRegions = 0;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      if (claimed[y][x] || claimed[y][x + 1] || claimed[y + 1][x] || claimed[y + 1][x + 1]) continue;
      if (!isOpen(x, y) || !isOpen(x + 1, y) || !isOpen(x, y + 1) || !isOpen(x + 1, y + 1)) continue;
      claimed[y][x] = claimed[y][x + 1] = claimed[y + 1][x] = claimed[y + 1][x + 1] = true;
      twoByTwoRegions++;
    }
  }
  return { openCells, oneWideCorridors, twoByTwoRegions };
}

// Rebuilds the raw 8x16 slice of floorCells at the given origin — no widening applied.
// Lets tests distinguish widened cells from what the base crop provided.
function buildRawWindow(floorCells, originX, originY) {
  const cells = [];
  for (let y = 0; y < 16; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) {
      const v = floorCells[originY + y]?.[originX + x];
      row.push(v !== undefined && v !== 0 ? 1 : 0);
    }
    cells.push(row);
  }
  return cells;
}

describe('deployBands — reachability invariant (SESSION-01)', () => {
  it('confines party and hostile bands to one connected region (always mutually reachable)', () => {
    const cells = makeGrid(8, 16, 1);            // fully open
    for (let x = 0; x < 8; x++) cells[8][x] = 0; // wall row y=8 → top room (y0-7) ⟂ bottom room (y9-15)
    const win = { originX: 0, originY: 0, width: 8, height: 16, cells };
    const { partyPositions, hostilePositions } = deployBands(win, 2, 2);
    const all = [...partyPositions, ...hostilePositions];
    expect(all.length).toBe(4);
    // Every position sits in the same connected region as the first (BFS reachability).
    const reach = reachable(cells, all[0].x, all[0].y);
    for (const p of all) expect(reach.has(`${p.x},${p.y}`)).toBe(true);
  });
});

describe('createStandardEncounter — spawn hydration (combat-and-ux-feedback-pass SESSION-01)', () => {
  it('hydrates a bare spawn stub into a combat-ready actor with archetype hp/defense/attributes', () => {
    const floor = { cells: makeGrid(20, 32, 1), themeId: 'cold_storage' };
    const party = [makeCharacter({ id: 'a' })];
    const cursor = createRNGCursorForRun(11);
    const stub = [{ id: 42, x: 5, y: 5, archetypeId: 'drone' }];
    const encounter = createStandardEncounter(floor, { x: 5, y: 5 }, party, stub, cursor, { enemiesData, depth: 3 });
    const foe = encounter.actors.find(a => a.side === 'enemy');
    expect(foe).toBeDefined();
    expect(foe.id).toBe(42);           // spawn's original id preserved (defeat-tracking depends on it)
    // Bug regression: unhydrated actors used to default to hp/hpMax = 1. Hydrated actors carry
    // the archetype's real stats, so hp/hpMax match a directly-constructed enemy at the same depth.
    const reference = createEnemy('drone', 3, createRNGCursorForRun(11), enemiesData);
    expect(foe.hpMax).toBe(reference.hpMax);
    expect(foe.hp).toBe(reference.hp);
    expect(foe.defense).toBe(reference.defense);
    expect(foe.attributes).toEqual(reference.attributes);
    expect(foe.hpMax).toBeGreaterThan(1);
    expect(foe.behavior).toBeDefined();
  });

  it('an echo spawn hydrates via createEcho instead of vanishing on a missing archetype lookup', () => {
    const floor = { cells: makeGrid(20, 32, 1), themeId: 'cold_storage' };
    const party = [makeCharacter({ id: 'a' })];
    const cursor = createRNGCursorForRun(11);
    const deadChar = makeCharacter({ id: 'dead_a', hpMax: 24, defense: 12, protocolDefense: 11, sigilCodepoint: 0xE001 });
    const stub = [{ id: 99, x: 4, y: 4, archetypeId: 'echo', character: deadChar }];
    const encounter = createStandardEncounter(floor, { x: 4, y: 4 }, party, stub, cursor, { enemiesData, depth: 3 });
    const foe = encounter.actors.find(a => a.side === 'enemy');
    expect(foe).toBeDefined();
    expect(foe.archetypeId).toBe('echo');
    expect(foe.isEcho).toBe(true);
    expect(foe.hpMax).toBeGreaterThan(1);
    expect(foe.defense).toBeGreaterThan(0);
    expect(foe.id).toBe(99);
  });

  it('an already-hydrated actor passes through unchanged (idempotent)', () => {
    const floor = { cells: makeGrid(20, 32, 1), themeId: 'cold_storage' };
    const party = [makeCharacter({ id: 'a' })];
    const cursor = createRNGCursorForRun(11);
    const prebuilt = createEnemy('warden', 2, createRNGCursorForRun(7), enemiesData);
    const encounter = createStandardEncounter(
      floor, { x: 5, y: 5 }, party, [{ ...prebuilt, x: 5, y: 5 }], cursor, { enemiesData, depth: 2 }
    );
    const foe = encounter.actors.find(a => a.side === 'enemy');
    expect(foe.hp).toBe(prebuilt.hp);
    expect(foe.hpMax).toBe(prebuilt.hpMax);
    expect(foe.defense).toBe(prebuilt.defense);
    expect(foe.attributes).toEqual(prebuilt.attributes);
  });

  it('falls back to the raw spawn when enemiesData is absent (no crash, no fabricated stats)', () => {
    const floor = { cells: makeGrid(20, 32, 1), themeId: 'cold_storage' };
    const party = [makeCharacter({ id: 'a' })];
    const cursor = createRNGCursorForRun(11);
    const stub = [{ id: 7, x: 5, y: 5, archetypeId: 'drone' }];
    const encounter = createStandardEncounter(floor, { x: 5, y: 5 }, party, stub, cursor);
    const foe = encounter.actors.find(a => a.side === 'enemy');
    expect(foe).toBeDefined();
    expect(foe.id).toBe(7);
    expect(foe.hpMax).toBeUndefined();
  });
});

describe('createHuntEncounter — spawn hydration (combat-and-ux-feedback-pass SESSION-01)', () => {
  it('hunt actors are hydrated with archetype hp/defense/attributes at the runState depth', () => {
    const floor = makeFloor();
    const party = makeParty(3);
    const runState = createRunState(42, party, { depth: 5 });
    const cursor = createRNGCursorForRun(42);
    const encounter = createHuntEncounter(floor, { x: 10, y: 16 }, party, runState, cursor, huntData);
    expect(encounter).not.toBeNull();
    const foes = encounter.actors.filter(a => a.side === 'enemy');
    expect(foes.length).toBeGreaterThan(0);
    for (const foe of foes) {
      expect(foe.hpMax).toBeGreaterThan(1);
      expect(foe.defense).toBeGreaterThan(0);
      expect(foe.attributes).toBeDefined();
      expect(foe.behavior).toBeDefined();
      expect(foe.id).toMatch(/^hunt_/);
    }
  });
});

describe('gatherChainedSpawns — transitive combat chaining (combat-and-ux-feedback-pass SESSION-01)', () => {
  it('pulls in a second spawn within CHAIN_ANCHOR_RANGE (2) of the contact point', () => {
    const contact = { x: 10, y: 10 };
    const contactSpawn = { id: 1, x: 10, y: 10 };
    const nearby = { id: 2, x: 12, y: 10 };                     // Chebyshev 2 from contact — chains
    const outOfRange = { id: 3, x: 16, y: 10 };                 // Chebyshev 6 from contact, 4 from #2 — beyond both anchor and link range
    const chained = gatherChainedSpawns([contactSpawn, nearby, outOfRange], contact, contactSpawn);
    const ids = chained.map(s => s.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it('chains transitively: a distant spawn pulled in via a bridge, NOT direct range of contact', () => {
    // Contact at (10,10). Bridge at (12,10) — Chebyshev 2 from contact (anchor range) → chains.
    // Distant at (15,10) — Chebyshev 5 from contact (out of anchor range) but Chebyshev 3 from
    // the bridge (link range) → chains only via the bridge. This is the "chain" property; a
    // pure radius filter around the contact point would exclude the distant spawn.
    const contact = { x: 10, y: 10 };
    const contactSpawn = { id: 1, x: 10, y: 10 };
    const bridge = { id: 2, x: 12, y: 10 };
    const distant = { id: 3, x: 15, y: 10 };
    const chained = gatherChainedSpawns([contactSpawn, bridge, distant], contact, contactSpawn);
    const ids = chained.map(s => s.id).sort();
    expect(ids).toEqual([1, 2, 3]);
  });

  it('excludes a spawn beyond CHAIN_LINK_RANGE (3) of every chained member', () => {
    const contact = { x: 10, y: 10 };
    const contactSpawn = { id: 1, x: 10, y: 10 };
    const bridge = { id: 2, x: 12, y: 10 };                     // chains (dist 2 from contact)
    const isolated = { id: 9, x: 20, y: 20 };                   // dist 10 from contact, 8 from bridge — never chains
    const chained = gatherChainedSpawns([contactSpawn, bridge, isolated], contact, contactSpawn);
    const ids = chained.map(s => s.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it('caps chained total at 1 + MAX_CHAIN_ADDITIONAL (7) even for a dense mutually-adjacent cluster', () => {
    const contact = { x: 10, y: 10 };
    const contactSpawn = { id: 0, x: 10, y: 10 };
    // 12 additional spawns, each Chebyshev 1 or 2 from every other — all would chain in an
    // uncapped world. The cap holds the pull at 6 additional (7 total).
    const cluster = [];
    for (let i = 1; i <= 12; i++) {
      cluster.push({ id: i, x: 10 + (i % 3), y: 10 + Math.floor(i / 3) });
    }
    const chained = gatherChainedSpawns([contactSpawn, ...cluster], contact, contactSpawn);
    expect(chained.length).toBe(7);
    // The contact is always included, whatever the cluster iteration order.
    expect(chained.map(s => s.id)).toContain(0);
  });

  it('empty spawn list returns just the contact spawn (no chain to build)', () => {
    const contact = { x: 5, y: 5 };
    const contactSpawn = { id: 42, x: 5, y: 5 };
    const chained = gatherChainedSpawns([], contact, contactSpawn);
    expect(chained).toEqual([contactSpawn]);
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