import { describe, expect, it, vi } from 'vitest';
import { createLattice } from '../../src/exploration/lattice.js';
import {
  moveParty,
  stepHunters,
  pruneEmptyCaches,
  HUNT_ACTIVATION_RANGE
} from '../../src/exploration/movement.js';
import { createRunState } from '../../src/state/run-state.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { makeGrid, carve } from '../helpers/grids.js';
import { loadData } from '../helpers/data.js';

function makeFloor(overrides = {}) {
  const grid = makeGrid(20, 32, 0);
  carve(grid, 1, 1, 18, 30, 1);
  return {
    cells: grid,
    containers: [],
    enemySpawns: [],
    descentPoint: { x: 10, y: 30 },
    floorSubSeed: 0,
    themeId: 'cold_storage',
    ...overrides,
  };
}

function makeRunState(sig = 5) {
  const party = [makeCharacter({ id: 'a', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig } })];
  return createRunState(42, party);
}

describe('stepHunters — activation and pathing', () => {
  it('enemy beyond HUNT_ACTIVATION_RANGE stays put', () => {
    // HUNT_ACTIVATION_RANGE = 8. Party at (2,2), enemy at (12,2), Chebyshev=10.
    const lat = createLattice(makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 2, archetypeId: 'drone' }]
    }));
    lat.setPartyPosition(2, 2);
    const rs = makeRunState();
    const result = stepHunters(lat, rs);
    expect(result.moved).toEqual([]);
    expect(result.contactSpawnId).toBeNull();
    expect(lat.getActiveEnemySpawns()[0]).toMatchObject({ x: 12, y: 2 });
  });

  it('enemy within HUNT_ACTIVATION_RANGE takes one BFS-shortest step toward the party', () => {
    // Party (10,15), enemy (12,15) chebyshev 2 → hunts.
    const lat = createLattice(makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }]
    }));
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const result = stepHunters(lat, rs);
    // Enemy stepped from (12,15) to a cell at Chebyshev distance 1 from the party.
    const after = lat.getActiveEnemySpawns()[0];
    const cheb = Math.max(Math.abs(after.x - 10), Math.abs(after.y - 15));
    expect(cheb).toBe(1);
    expect(result.moved).toHaveLength(1);
    expect(result.moved[0]).toMatchObject({ id: 0, from: { x: 12, y: 15 }, to: { x: after.x, y: after.y } });
    expect(result.contactSpawnId).toBe(0);
  });

  it('enemy already adjacent stays put and reports contact', () => {
    const lat = createLattice(makeFloor({
      enemySpawns: [{ id: 0, x: 11, y: 15, archetypeId: 'drone' }]
    }));
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    const result = stepHunters(lat, rs);
    expect(result.moved).toEqual([]);
    expect(result.contactSpawnId).toBe(0);
    expect(lat.getActiveEnemySpawns()[0]).toMatchObject({ x: 11, y: 15 });
  });

  it('hunter routes around a U-wall (BFS, not local greedy)', () => {
    // Walls at (5,4),(4,5),(5,6) plus the closed-corner rule seal off every
    // path from enemy (5,5) toward party (2,5) except via the east side. The
    // hunter must step east even though every east move goes AWAY from the
    // party locally — BFS finds the shortest connected path over the detour.
    const grid = makeGrid(20, 32, 1);
    grid[4][5] = 0;
    grid[5][4] = 0;
    grid[6][5] = 0;
    const lat = createLattice({
      cells: grid,
      enemySpawns: [{ id: 0, x: 5, y: 5, archetypeId: 'drone' }],
      containers: [], descentPoint: null,
    });
    lat.setPartyPosition(2, 5);
    const rs = makeRunState();
    stepHunters(lat, rs);
    const after = lat.getActiveEnemySpawns()[0];
    // The step lands on one of (6,4), (6,5), (6,6) — the east detour cells.
    // DIRECTION_ORDER breaks the tie in favor of ne = (6,4).
    expect(after).toMatchObject({ x: 6, y: 4 });
  });

  it('deterministic: identical inputs produce identical trajectories over 10 party moves', () => {
    function trajectory() {
      const lat = createLattice(makeFloor({
        enemySpawns: [
          { id: 0, x: 15, y: 15, archetypeId: 'drone' },
          { id: 1, x: 12, y: 18, archetypeId: 'drone' },
          { id: 2, x: 15, y: 12, archetypeId: 'drone' }
        ]
      }));
      lat.setPartyPosition(5, 15);
      const rs = makeRunState();
      const cursor = createRNGCursorForRun(1);
      const fog = new Uint8Array(640);
      const trail = [];
      for (let i = 0; i < 10; i++) {
        moveParty(lat, fog, 'e', cursor, rs);
        trail.push(lat.getActiveEnemySpawns().map(e => ({ id: e.id, x: e.x, y: e.y })));
      }
      return trail;
    }
    const t1 = trajectory();
    const t2 = trajectory();
    expect(t1).toEqual(t2);
  });

  it('id-lower hunter takes the shared step; id-higher stalls that turn', () => {
    // Two hunters at (5,10) and (5,12). Party at (3,11). Both would like to
    // step to (4,11) as their best move (Chebyshev-1 from party). The id-lower
    // hunter (id 0) gets it; id 1 either takes an alternate step or stalls,
    // but never lands on the same cell.
    const lat = createLattice(makeFloor({
      enemySpawns: [
        { id: 0, x: 5, y: 10, archetypeId: 'drone' },
        { id: 1, x: 5, y: 12, archetypeId: 'drone' }
      ]
    }));
    lat.setPartyPosition(3, 11);
    const rs = makeRunState();
    stepHunters(lat, rs);
    const after = lat.getActiveEnemySpawns();
    const positions = after.map(e => `${e.x},${e.y}`);
    // No collision — the two spawns occupy distinct cells.
    expect(new Set(positions).size).toBe(2);
  });

  it('a hunter blocked by walls and other hunters simply stays put (no wait log)', () => {
    // A 3-cell east-west corridor: (2,3),(3,3),(4,3) open, everything else wall.
    // Party at (4,3). Enemy 0 at (3,3) → Chebyshev-1 adjacent to party (contact).
    // Enemy 1 at (2,3) → wants to step east to (3,3), but that cell is held by
    // enemy 0. No other cell is walkable. Enemy 1 stays put; no wait log.
    const grid = makeGrid(20, 32, 0);
    grid[3][2] = 1;
    grid[3][3] = 1;
    grid[3][4] = 1;
    const lat = createLattice({
      cells: grid,
      enemySpawns: [
        { id: 0, x: 3, y: 3, archetypeId: 'drone' },
        { id: 1, x: 2, y: 3, archetypeId: 'drone' }
      ],
      containers: [], descentPoint: null,
    });
    lat.setPartyPosition(4, 3);
    const rs = makeRunState();
    const result = stepHunters(lat, rs);
    expect(result.moved).toEqual([]);
    expect(result.contactSpawnId).toBe(0);
    expect(lat.getActiveEnemySpawns().find(e => e.id === 1)).toMatchObject({ x: 2, y: 3 });
  });

  it('defeated enemy does not hunt', () => {
    const lat = createLattice(makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }]
    }));
    lat.setPartyPosition(10, 15);
    const rs = makeRunState();
    rs.markEnemyDefeated(0);
    stepHunters(lat, rs);
    // Enemy still reported at its original cell because no hunter override was set.
    expect(lat.getHunterPosition(0)).toBeNull();
  });

  it('culled enemy does not hunt', () => {
    const lat = createLattice(makeFloor({
      enemySpawns: [{ id: 0, x: 12, y: 15, archetypeId: 'drone' }]
    }));
    lat.setPartyPosition(10, 15);
    lat.markCulled('enemy', 0);
    const rs = makeRunState();
    stepHunters(lat, rs);
    expect(lat.getHunterPosition(0)).toBeNull();
  });

  it('exports HUNT_ACTIVATION_RANGE = 8 (matches historic LOS default)', () => {
    expect(HUNT_ACTIVATION_RANGE).toBe(8);
  });
});

describe('stepHunters — full-flow integration via moveParty', () => {
  it('three-enemy fixture — party moves east 4 times, hunters converge, combat triggers', () => {
    // Party at (5,15). Enemies at Chebyshev 3, 6, 10 from party in a straight
    // east corridor. Enemy at 10 stays put (outside HUNT_ACTIVATION_RANGE); the
    // other two close each turn. Contact happens within 4 party moves.
    const lat = createLattice(makeFloor({
      enemySpawns: [
        { id: 0, x: 8, y: 15, archetypeId: 'drone' },  // Cheb 3
        { id: 1, x: 11, y: 15, archetypeId: 'drone' }, // Cheb 6
        { id: 2, x: 15, y: 15, archetypeId: 'drone' }  // Cheb 10 (outside range)
      ]
    }));
    lat.setPartyPosition(5, 15);
    const rs = makeRunState();
    const cursor = createRNGCursorForRun(1);
    const fog = new Uint8Array(640);
    let contact = false;
    for (let i = 0; i < 4; i++) {
      const result = moveParty(lat, fog, 'e', cursor, rs);
      if (result.combatContact) { contact = true; break; }
    }
    expect(contact).toBe(true);
  });
});

describe('pruneEmptyCaches — cull containers whose loot rolls empty', () => {
  const gameData = {
    themes: loadData('themes'),
    equipment: loadData('equipment'),
    affixes: loadData('affixes'),
    consumables: loadData('consumables'),
  };

  it('no-op when data or floor missing', () => {
    const lat = createLattice(makeFloor({
      containers: [{ id: 0, x: 3, y: 3, kind: 'cache' }]
    }));
    const rs = makeRunState();
    expect(pruneEmptyCaches(lat, rs, null, gameData)).toEqual({ containers: [], enemies: [] });
    expect(pruneEmptyCaches(lat, rs, {}, null)).toEqual({ containers: [], enemies: [] });
    expect(lat.isCulled('container', 0)).toBe(false);
  });

  it('culls a container whose generateLoot() returns []', async () => {
    // Stub generateLoot to return [] for id 0 and non-empty for id 1.
    const lootModule = await import('../../src/rules/loot.js');
    const spy = vi.spyOn(lootModule, 'generateLoot').mockImplementation((_seed, _depth, _floor, containerId) => {
      return containerId === 0 ? [] : [{ id: 'item-a', category: 'weapon', baseType: 'pistol', rarity: 'stock', rarityTier: 0, affixes: [], corrupt: false, salvageValue: 1 }];
    });
    try {
      const floor = makeFloor({
        containers: [
          { id: 0, x: 3, y: 3, kind: 'cache' },
          { id: 1, x: 5, y: 5, kind: 'cache' }
        ]
      });
      const lat = createLattice(floor);
      const rs = makeRunState();
      const result = pruneEmptyCaches(lat, rs, floor, gameData);
      expect(result.containers).toEqual([0]);
      expect(lat.isCulled('container', 0)).toBe(true);
      expect(lat.isCulled('container', 1)).toBe(false);
      const active = lat.getActiveContainers();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('skips already-opened containers and does not re-cull already-culled ones', async () => {
    const lootModule = await import('../../src/rules/loot.js');
    const spy = vi.spyOn(lootModule, 'generateLoot').mockReturnValue([]);
    try {
      const floor = makeFloor({
        containers: [
          { id: 0, x: 3, y: 3, kind: 'cache' },
          { id: 1, x: 5, y: 5, kind: 'cache' }
        ]
      });
      const lat = createLattice(floor, { openedContainers: 1n });
      lat.markCulled('container', 1);
      const rs = makeRunState();
      const result = pruneEmptyCaches(lat, rs, floor, gameData);
      // id 0 was opened → skipped; id 1 was already culled → skipped.
      expect(result.containers).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('enemy hasDrop:false marks the spawn culled (future enemy-drops hook)', () => {
    const floor = makeFloor({
      enemySpawns: [
        { id: 0, x: 3, y: 3, archetypeId: 'drone', hasDrop: false },
        { id: 1, x: 5, y: 5, archetypeId: 'drone' } // no hasDrop → not culled
      ]
    });
    const lat = createLattice(floor);
    const rs = makeRunState();
    const result = pruneEmptyCaches(lat, rs, floor, gameData);
    expect(result.enemies).toEqual([0]);
    expect(lat.isCulled('enemy', 0)).toBe(true);
    expect(lat.isCulled('enemy', 1)).toBe(false);
  });
});
