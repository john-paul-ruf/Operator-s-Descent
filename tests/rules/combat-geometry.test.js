import { describe, it, expect } from 'vitest';
import {
  distanceCells,
  traceSupercoverEdges,
  getEdgeCoverBonus,
  isFlanked,
  getOpportunityAttackers,
  findApproachPath,
  flankStepCandidates,
  HALF_COVER_BONUS,
  FULL_COVER_BONUS,
  FLANK_ATTACK_BONUS,
} from '../../src/rules/combat-geometry.js';
import { makeGrid, carve, openCombatWindow, blockedCornerWindow } from '../helpers/grids.js';

function latticeWithWalls(width, height, walls) {
  const cells = makeGrid(width, height, 1);
  for (const [x, y] of walls) {
    if (y >= 0 && y < height && x >= 0 && x < width) cells[y][x] = 0;
  }
  return { originX: 0, originY: 0, width, height, cells };
}

function actor(id, x, y, side = 'party', hp = 10) {
  return { id, side, hp, position: { x, y } };
}

describe('distanceCells', () => {
  it('returns Chebyshev distance for orthogonal offset', () => {
    expect(distanceCells({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
  });

  it('returns Chebyshev distance for diagonal offset', () => {
    expect(distanceCells({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
  });

  it('returns 0 for same cell', () => {
    expect(distanceCells({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });

  it('returns null when either side lacks integer position', () => {
    expect(distanceCells(null, { x: 1, y: 1 })).toBeNull();
    expect(distanceCells({ x: 1, y: 1 }, null)).toBeNull();
    expect(distanceCells({ x: 1.5, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(distanceCells({ x: 1, y: 1 }, { x: 'a', y: 2 })).toBeNull();
  });
});

describe('traceSupercoverEdges', () => {
  it('excludes the origin, includes the destination', () => {
    const edges = traceSupercoverEdges({ x: 0, y: 0 }, { x: 3, y: 0 });
    expect(edges).toHaveLength(3);
    expect(edges[0]).toMatchObject({ x: 1, y: 0 });
    expect(edges[2]).toMatchObject({ x: 3, y: 0 });
  });

  it('pure horizontal line: no corner grazes', () => {
    const edges = traceSupercoverEdges({ x: 0, y: 0 }, { x: 4, y: 0 });
    expect(edges.every(e => !e.corner)).toBe(true);
    expect(edges.map(e => `${e.x},${e.y}`)).toEqual(['1,0', '2,0', '3,0', '4,0']);
  });

  it('pure vertical line: no corner grazes', () => {
    const edges = traceSupercoverEdges({ x: 0, y: 0 }, { x: 0, y: 4 });
    expect(edges.every(e => !e.corner)).toBe(true);
    expect(edges.map(e => `${e.x},${e.y}`)).toEqual(['0,1', '0,2', '0,3', '0,4']);
  });

  it('pure diagonal line: every step is a corner graze (both orthogonal neighbors)', () => {
    const edges = traceSupercoverEdges({ x: 0, y: 0 }, { x: 3, y: 3 });
    const corners = edges.filter(e => e.corner);
    expect(corners).toHaveLength(6);
  });

  it('direction-independent: full path (excl. destination) visits the same cells either direction', () => {
    const forward = traceSupercoverEdges({ x: 0, y: 0 }, { x: 4, y: 2 });
    const backward = traceSupercoverEdges({ x: 4, y: 2 }, { x: 0, y: 0 });
    const interior = edges => edges.slice(0, -1).map(e => `${e.x},${e.y}:${e.corner}`).sort().join('|');
    expect(interior(forward)).toBe(interior(backward));
  });

  it('same origin and target → empty edge list', () => {
    expect(traceSupercoverEdges({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([]);
  });
});

describe('getEdgeCoverBonus', () => {
  it('zero crossings → no cover bonus', () => {
    const lattice = latticeWithWalls(8, 8, []);
    expect(getEdgeCoverBonus(lattice, { position: { x: 0, y: 0 } }, { position: { x: 3, y: 0 } })).toBe(0);
  });

  it('one blocked crossing → half cover bonus', () => {
    const lattice = latticeWithWalls(8, 8, [[2, 0]]);
    expect(getEdgeCoverBonus(lattice, { position: { x: 0, y: 0 } }, { position: { x: 4, y: 0 } })).toBe(HALF_COVER_BONUS);
  });

  it('two blocked crossings → full cover bonus', () => {
    const lattice = latticeWithWalls(8, 8, [[2, 0], [3, 0]]);
    expect(getEdgeCoverBonus(lattice, { position: { x: 0, y: 0 } }, { position: { x: 4, y: 0 } })).toBe(FULL_COVER_BONUS);
  });

  it('target\'s own cell is not counted as a cover crossing', () => {
    const lattice = latticeWithWalls(8, 8, [[4, 0]]);
    expect(getEdgeCoverBonus(lattice, { position: { x: 0, y: 0 } }, { position: { x: 4, y: 0 } })).toBe(0);
  });

  it('returns 0 when either side has no position', () => {
    expect(getEdgeCoverBonus(null, {}, { position: { x: 1, y: 1 } })).toBe(0);
    expect(getEdgeCoverBonus(null, { position: { x: 0, y: 0 } }, {})).toBe(0);
  });

  it('no lattice → no cover', () => {
    expect(getEdgeCoverBonus(null, { position: { x: 0, y: 0 } }, { position: { x: 3, y: 0 } })).toBe(0);
  });

  it('diagonal diagonal line grazes both orthogonal neighbors at a corner — both count as crossings', () => {
    const lattice = latticeWithWalls(8, 8, [[1, 0], [0, 1]]);
    expect(getEdgeCoverBonus(lattice, { position: { x: 0, y: 0 } }, { position: { x: 3, y: 3 } })).toBe(FULL_COVER_BONUS);
  });
});

describe('isFlanked', () => {
  it('true when two allies sit on opposite sides of the target (adjacent)', () => {
    const lattice = latticeWithWalls(8, 8, []);
    const target = actor('t', 2, 2, 'enemy');
    const allyA = actor('a', 1, 2, 'party');
    const allyB = actor('b', 3, 2, 'party');
    expect(isFlanked(target, [allyA, allyB, target], lattice)).toBe(true);
  });

  it('true for diagonal opposite sides', () => {
    const lattice = latticeWithWalls(8, 8, []);
    const target = actor('t', 2, 2, 'enemy');
    const allyA = actor('a', 1, 1, 'party');
    const allyB = actor('b', 3, 3, 'party');
    expect(isFlanked(target, [allyA, allyB], lattice)).toBe(true);
  });

  it('false when allies are on the same side (not opposite)', () => {
    const lattice = latticeWithWalls(8, 8, []);
    const target = actor('t', 2, 2, 'enemy');
    const allyA = actor('a', 1, 2, 'party');
    const allyB = actor('b', 1, 3, 'party');
    expect(isFlanked(target, [allyA, allyB], lattice)).toBe(false);
  });

  it('false when only one ally is adjacent', () => {
    const lattice = latticeWithWalls(8, 8, []);
    const target = actor('t', 2, 2, 'enemy');
    const allyA = actor('a', 1, 2, 'party');
    const allyB = actor('b', 5, 5, 'party');
    expect(isFlanked(target, [allyA, allyB], lattice)).toBe(false);
  });

  it('false when a diagonal ally has both orthogonal neighbors walled (corner rule)', () => {
    const lattice = latticeWithWalls(8, 8, [[1, 2], [2, 1]]);
    const target = actor('t', 2, 2, 'enemy');
    const allyA = actor('a', 1, 1, 'party');
    const allyB = actor('b', 3, 3, 'party');
    expect(isFlanked(target, [allyA, allyB], lattice)).toBe(false);
  });

  it('dead allies do not count', () => {
    const lattice = latticeWithWalls(8, 8, []);
    const target = actor('t', 2, 2, 'enemy');
    const allyA = actor('a', 1, 2, 'party', 0);
    const allyB = actor('b', 3, 2, 'party', 0);
    expect(isFlanked(target, [allyA, allyB], lattice)).toBe(false);
  });

  it('no target position → false', () => {
    expect(isFlanked({}, [actor('a', 0, 0)], null)).toBe(false);
  });

  it('no allies → false', () => {
    const lattice = latticeWithWalls(8, 8, []);
    expect(isFlanked(actor('t', 2, 2, 'enemy'), [], lattice)).toBe(false);
  });
});

describe('getOpportunityAttackers', () => {
  function combatState(actors) {
    const combatants = new Map();
    for (const a of actors) combatants.set(a.id, a);
    return { combatants };
  }

  it('lists enemies who threatened from but no longer threaten to', () => {
    const mover = actor('m', 2, 2, 'party');
    const enemy = actor('e', 3, 2, 'enemy');
    const state = combatState([mover, enemy]);
    const attackers = getOpportunityAttackers(mover, { x: 2, y: 2 }, { x: 5, y: 2 }, state);
    expect(attackers).toHaveLength(1);
    expect(attackers[0].id).toBe('e');
  });

  it('does not trigger when the destination is still adjacent to the enemy', () => {
    const mover = actor('m', 2, 2, 'party');
    const enemy = actor('e', 3, 2, 'enemy');
    const state = combatState([mover, enemy]);
    const attackers = getOpportunityAttackers(mover, { x: 2, y: 2 }, { x: 2, y: 3 }, state);
    expect(attackers).toHaveLength(0);
  });

  it('excludes same-side actors', () => {
    const mover = actor('m', 2, 2, 'party');
    const ally = actor('a', 3, 2, 'party');
    const state = combatState([mover, ally]);
    expect(getOpportunityAttackers(mover, { x: 2, y: 2 }, { x: 5, y: 2 }, state)).toHaveLength(0);
  });

  it('excludes dead enemies', () => {
    const mover = actor('m', 2, 2, 'party');
    const deadEnemy = actor('e', 3, 2, 'enemy', 0);
    const state = combatState([mover, deadEnemy]);
    expect(getOpportunityAttackers(mover, { x: 2, y: 2 }, { x: 5, y: 2 }, state)).toHaveLength(0);
  });

  it('null destination → lists every enemy currently threatening the mover (fumble case)', () => {
    const mover = actor('m', 2, 2, 'party');
    const e1 = actor('e1', 3, 2, 'enemy');
    const e2 = actor('e2', 2, 3, 'enemy');
    const farEnemy = actor('e3', 6, 6, 'enemy');
    const state = combatState([mover, e1, e2, farEnemy]);
    const attackers = getOpportunityAttackers(mover, { x: 2, y: 2 }, null, state);
    expect(attackers.map(a => a.id).sort()).toEqual(['e1', 'e2']);
  });

  it('null from or null state → empty list', () => {
    expect(getOpportunityAttackers(actor('m', 2, 2, 'party'), null, { x: 3, y: 3 }, {})).toHaveLength(0);
    expect(getOpportunityAttackers(actor('m', 2, 2, 'party'), { x: 2, y: 2 }, { x: 3, y: 3 }, null)).toHaveLength(0);
  });
});

describe('findApproachPath', () => {
  const noOccupancy = () => false;

  it('returns a direct straight-line path across open floor', () => {
    const window = openCombatWindow();
    const path = findApproachPath(window, noOccupancy, { x: 0, y: 0 }, { x: 5, y: 0 }, 1);
    // desiredRange 1 → stop one cell short of target. 4 east steps reach (4,0).
    expect(path).toEqual(['e', 'e', 'e', 'e']);
  });

  it('null when already within desiredRange (no wasted intent)', () => {
    const window = openCombatWindow();
    expect(findApproachPath(window, noOccupancy, { x: 3, y: 3 }, { x: 4, y: 3 }, 1)).toBeNull();
    expect(findApproachPath(window, noOccupancy, { x: 3, y: 3 }, { x: 5, y: 3 }, 3)).toBeNull();
  });

  it('routes around a U-shaped wall pocket the greedy walker cannot escape', () => {
    const window = openCombatWindow();
    // Vertical wall column at x=4 blocks a straight east march; leave a gap at y=7 so BFS
    // can slip through. Greedy Chebyshev descent from (0,0) would wedge against the wall.
    for (let y = 0; y < window.height; y++) window.cells[y][4] = 0;
    window.cells[7][4] = 1;
    const path = findApproachPath(window, noOccupancy, { x: 0, y: 0 }, { x: 6, y: 0 }, 1);
    expect(path).not.toBeNull();
    // The path must include a step through the (4,7) gap — otherwise it went through a wall.
    let cursor = { x: 0, y: 0 };
    let touchedGap = false;
    const DELTAS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
    for (const dir of path) {
      const [dx, dy] = DELTAS[dir];
      cursor = { x: cursor.x + dx, y: cursor.y + dy };
      if (cursor.x === 4 && cursor.y === 7) touchedGap = true;
      expect(window.cells[cursor.y][cursor.x]).not.toBe(0);
    }
    expect(touchedGap).toBe(true);
    // BFS stops within Chebyshev 1 of (6,0).
    expect(Math.max(Math.abs(cursor.x - 6), Math.abs(cursor.y - 0))).toBeLessThanOrEqual(1);
  });

  it('returns null when the target is completely walled off', () => {
    const window = openCombatWindow();
    // Enclose the cell at (5,3) with walls on every side (adjacent cells + itself).
    for (const [x, y] of [[4, 2], [5, 2], [6, 2], [4, 3], [6, 3], [4, 4], [5, 4], [6, 4]]) {
      window.cells[y][x] = 0;
    }
    expect(findApproachPath(window, noOccupancy, { x: 0, y: 0 }, { x: 5, y: 3 }, 1)).toBeNull();
  });

  it('deterministic tie-break: pure orthogonal choice prefers `n` over other equidistant directions', () => {
    const window = openCombatWindow();
    // From (3,7) to (3,4) — distance 3 due north. BFS explores neighbors in NEIGHBOR_STEPS
    // order (n first); the first path found is the pure-north walk.
    const path = findApproachPath(window, noOccupancy, { x: 3, y: 7 }, { x: 3, y: 4 }, 1);
    expect(path).toEqual(['n', 'n']);
  });

  it('respects the isOccupied predicate: blocked cells never enter the path', () => {
    const window = openCombatWindow();
    // Occupy (1,0) so the direct east route from (0,0)→(3,0) has to detour.
    const isOccupied = (x, y) => x === 1 && y === 0;
    const path = findApproachPath(window, isOccupied, { x: 0, y: 0 }, { x: 3, y: 0 }, 1);
    expect(path).not.toBeNull();
    let cursor = { x: 0, y: 0 };
    const DELTAS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
    for (const dir of path) {
      cursor = { x: cursor.x + DELTAS[dir][0], y: cursor.y + DELTAS[dir][1] };
      expect(cursor).not.toEqual({ x: 1, y: 0 });
    }
  });

  it('respects the diagonal corner rule (mirrors the movement engine)', () => {
    const window = blockedCornerWindow();
    // Origin (0,0), target (2,2). Walls at (1,0) and (0,1) block every diagonal into (1,1),
    // and both orthogonal singles are walls, so nothing is reachable.
    expect(findApproachPath(window, () => false, { x: 0, y: 0 }, { x: 2, y: 2 }, 1)).toBeNull();
  });

  it('null on missing inputs (no throw)', () => {
    const window = openCombatWindow();
    expect(findApproachPath(null, () => false, { x: 0, y: 0 }, { x: 1, y: 0 }, 1)).toBeNull();
    expect(findApproachPath(window, () => false, null, { x: 1, y: 0 }, 1)).toBeNull();
    expect(findApproachPath(window, () => false, { x: 0, y: 0 }, null, 1)).toBeNull();
  });
});

describe('flankStepCandidates', () => {
  const noOccupancy = () => false;

  it('empty when there are no living allies to complete a flank', () => {
    const window = openCombatWindow();
    const target = actor('t', 3, 3, 'enemy');
    expect(flankStepCandidates(window, noOccupancy, target, [])).toEqual([]);
    expect(flankStepCandidates(window, noOccupancy, target, [actor('d', 2, 3, 'party', 0)])).toEqual([]);
  });

  it('lists the opposite adjacent cells that complete a flank with an existing ally', () => {
    const window = openCombatWindow();
    const target = actor('t', 3, 3, 'enemy');
    const ally = actor('mate', 2, 3, 'party'); // west of target
    const cells = flankStepCandidates(window, noOccupancy, target, [ally]);
    // The ally is due west; opposite-side flanks require the probe due east — (4,3) — or a
    // diagonal pair opposite the ally (there is no strict-opposite for a diagonal ally, so
    // only the direct east cell qualifies for a purely-west ally).
    expect(cells).toContainEqual({ x: 4, y: 3 });
    expect(cells).not.toContainEqual({ x: 2, y: 3 }); // same side as ally, not a flank
  });

  it('excludes cells occupied, walled, or corner-blocked', () => {
    const window = openCombatWindow();
    // Wall the east cell so a would-be flanker cannot stand there.
    window.cells[3][4] = 0;
    const target = actor('t', 3, 3, 'enemy');
    const ally = actor('mate', 2, 3, 'party');
    const cells = flankStepCandidates(window, noOccupancy, target, [ally]);
    expect(cells).not.toContainEqual({ x: 4, y: 3 });
  });

  it('respects the isOccupied predicate (a living occupant on a candidate cell removes it)', () => {
    const window = openCombatWindow();
    const target = actor('t', 3, 3, 'enemy');
    const ally = actor('mate', 2, 3, 'party');
    const isOccupied = (x, y) => x === 4 && y === 3;
    const cells = flankStepCandidates(window, isOccupied, target, [ally]);
    expect(cells).not.toContainEqual({ x: 4, y: 3 });
  });

  it('deterministic order: candidates return in NEIGHBOR_STEPS (n, ne, e, se, s, sw, w, nw) order', () => {
    const window = openCombatWindow();
    const target = actor('t', 3, 3, 'enemy');
    // Two allies at opposite corners create two diagonal flank possibilities: probe cells at
    // (3,4) [s of target] paired with (3,2) already covered by an ally.
    const allyNorth = actor('n_ally', 3, 2, 'party');
    const allyWest = actor('w_ally', 2, 3, 'party');
    const cells = flankStepCandidates(window, noOccupancy, target, [allyNorth, allyWest]);
    // Both (4,3) — east flank vs the west ally — and (3,4) — south flank vs the north ally —
    // are valid. NEIGHBOR_STEPS order is n, ne, e, se, s, sw, w, nw; the east candidate (e)
    // comes before the south candidate (s), so (4,3) appears first.
    const eastIdx = cells.findIndex(c => c.x === 4 && c.y === 3);
    const southIdx = cells.findIndex(c => c.x === 3 && c.y === 4);
    expect(eastIdx).toBeGreaterThanOrEqual(0);
    expect(southIdx).toBeGreaterThanOrEqual(0);
    expect(eastIdx).toBeLessThan(southIdx);
  });
});