export const HALF_COVER_BONUS = 2;
export const FULL_COVER_BONUS = 4;
export const FLANK_ATTACK_BONUS = 2;

// Chebyshev movement distance — the one distance convention combat/AI share. Returns null
// (never a "far" fallback) when either side lacks placed geometry, so non-positional callers
// degrade to unlimited range instead of an unresolvable illegal state.
export function distanceCells(a, b) {
  if (!Number.isInteger(a?.x) || !Number.isInteger(a?.y) || !Number.isInteger(b?.x) || !Number.isInteger(b?.y)) return null;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isBlockedCell(lattice, x, y) {
  if (!lattice) return false;
  if (typeof lattice.isWall === 'function') return lattice.isWall(x, y);
  const row = lattice.cells ? lattice.cells[y] : undefined;
  return row ? row[x] === 0 : true;
}

// Deterministic integer supercover line from `from` to `to`: the ordered list of every cell
// the ideal line segment touches, including both neighbors it grazes at an exact lattice
// corner (never silently picks one side the way Bresenham does). Excludes `from`, includes
// `to`. Direction-independent by construction — tracing b→a visits the same interior cells
// as a→b — which is what keeps cover/flank checks symmetric regardless of who is attacking.
export function traceSupercoverEdges(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const nx = Math.abs(dx);
  const ny = Math.abs(dy);
  const signX = dx > 0 ? 1 : -1;
  const signY = dy > 0 ? 1 : -1;
  const edges = [];
  let x = from.x;
  let y = from.y;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    const a = (1 + 2 * ix) * ny;
    const b = (1 + 2 * iy) * nx;
    if (ny === 0 || (nx !== 0 && a < b)) {
      x += signX; ix++;
      edges.push({ x, y, corner: false });
    } else if (nx === 0 || a > b) {
      y += signY; iy++;
      edges.push({ x, y, corner: false });
    } else {
      // Exact corner tie: the line passes through the point shared by four cells. Supercover
      // includes both orthogonal neighbors it grazes, not just the diagonal cell beyond them —
      // the same pair the movement corner-rule inspects for a diagonal step.
      edges.push({ x: x + signX, y, corner: true });
      edges.push({ x, y: y + signY, corner: true });
      x += signX; y += signY; ix++; iy++;
      edges.push({ x, y, corner: false });
    }
  }
  return edges;
}

// True line of sight: false only when the trace's interior genuinely threads through a wall
// cell (corner: false — an orthogonal step or the final diagonal landing cell). A grazed
// corner (corner: true) is NOT a block — that's what getEdgeCoverBonus's half/full cover
// already represents, and this function must not change that existing behavior. Unpositioned
// callers (either endpoint missing a position) pass through as legal, matching how existing
// callers (performAttackRoll's `positioned` guard, protocol targeting's null-context short-
// circuit) already treat missing geometry.
export function hasLineOfSight(lattice, from, to) {
  if (!from || !to) return true;
  for (const edge of traceSupercoverEdges(from, to)) {
    if (edge.x === to.x && edge.y === to.y) continue;
    if (edge.corner) continue;
    if (isBlockedCell(lattice, edge.x, edge.y)) return false;
  }
  return true;
}

// Cover from edge-crossing, not a wall value guessed off a raw string: trace the supercover
// line and count blocked cells it grazes between the two positions (excluding the target's
// own occupied cell). Zero crossings is no cover; one is half; two or more is full.
export function getEdgeCoverBonus(lattice, attacker, target) {
  const from = attacker?.position;
  const to = target?.position;
  if (!from || !to) return 0;
  let covered = 0;
  for (const edge of traceSupercoverEdges(from, to)) {
    if (edge.x === to.x && edge.y === to.y) continue;
    if (isBlockedCell(lattice, edge.x, edge.y)) covered++;
  }
  return covered >= 2 ? FULL_COVER_BONUS : covered === 1 ? HALF_COVER_BONUS : 0;
}

// Same corner rule as movement: a diagonal neighbor is only "legally adjacent" when at least
// one of the two orthogonal cells between the centers is open.
function isLegallyAdjacent(lattice, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
  if (dx !== 0 && dy !== 0) {
    const hOpen = !isBlockedCell(lattice, from.x + dx, from.y);
    const vOpen = !isBlockedCell(lattice, from.x, from.y + dy);
    if (!hOpen && !vOpen) return false;
  }
  return true;
}

// True when two of `allies` (living, legally adjacent to `target`) sit on exactly opposite
// sides of it. Callers include the attacker itself in `allies` so the bonus only applies when
// the attacker is one of the two flankers.
export function isFlanked(target, allies, lattice) {
  const center = target?.position;
  if (!center) return false;
  const adjacent = (allies || []).filter(ally => ally?.hp > 0 && ally.position && isLegallyAdjacent(lattice, center, ally.position));
  for (let i = 0; i < adjacent.length; i++) {
    for (let j = i + 1; j < adjacent.length; j++) {
      const a = adjacent[i].position;
      const b = adjacent[j].position;
      if (a.x - center.x === center.x - b.x && a.y - center.y === center.y - b.y) return true;
    }
  }
  return false;
}

// Living hostiles who threatened `from` (adjacent) but no longer threaten `to`. Pass `to: null`
// to list every hostile currently threatening `actor` in place — this is also how a natural-1
// fumble looks up "any adjacent enemy" without a second code path.
export function getOpportunityAttackers(actor, from, to, combatState) {
  if (!combatState || !from) return [];
  const attackers = [];
  for (const other of combatState.combatants.values()) {
    if (!other || other.id === actor.id || other.side === actor.side || other.hp <= 0 || !other.position) continue;
    const wasThreatened = distanceCells(from, other.position) === 1;
    const stillThreatened = to ? distanceCells(to, other.position) === 1 : false;
    if (wasThreatened && !stillThreatened) attackers.push(other);
  }
  return attackers;
}

// Deterministic 8-direction step list. The order (n, ne, e, se, s, sw, w, nw) matches
// combat.js:DIRECTION_ORDER exactly so BFS ties resolve identically to the movement engine —
// load-bearing for FR-43's "identical AI behavior from a loaded save" guarantee.
const NEIGHBOR_STEPS = [
  { name: 'n', dx: 0, dy: -1 },
  { name: 'ne', dx: 1, dy: -1 },
  { name: 'e', dx: 1, dy: 0 },
  { name: 'se', dx: 1, dy: 1 },
  { name: 's', dx: 0, dy: 1 },
  { name: 'sw', dx: -1, dy: 1 },
  { name: 'w', dx: -1, dy: 0 },
  { name: 'nw', dx: -1, dy: -1 }
];

function inBounds(window, x, y) {
  return !!window && x >= 0 && y >= 0 && x < window.width && y < window.height;
}

function isPassableCell(window, x, y) {
  return inBounds(window, x, y) && window.cells[y][x] !== 0;
}

// Single-step legality — destination passable and the diagonal corner rule (at least one
// orthogonal neighbor open). Mirrors combat.js:legalStep exactly; both must agree so a
// path found here is walkable there without silent divergence.
function isLegalStep(window, from, dx, dy) {
  if (!isPassableCell(window, from.x + dx, from.y + dy)) return false;
  if (dx !== 0 && dy !== 0) {
    const hOpen = isPassableCell(window, from.x + dx, from.y);
    const vOpen = isPassableCell(window, from.x, from.y + dy);
    if (!hOpen && !vOpen) return false;
  }
  return true;
}

// BFS shortest path from `from` to the nearest cell within Chebyshev `desiredRange` of
// `targetPos`. Occupied cells block transit (except `from`); ties broken by NEIGHBOR_STEPS
// direction order. Bounded by `window.width * window.height` expansions so a pathological
// map cannot hang the search. Returns ordered direction names (possibly longer than one
// move), or null when no such cell is reachable or the origin is already within range.
// Consumes zero RNG — pure graph search.
export function findApproachPath(window, isOccupied, from, targetPos, desiredRange) {
  if (!window || !from || !targetPos) return null;
  const range = Number.isFinite(desiredRange) ? Math.max(0, Math.floor(desiredRange)) : 0;
  if (distanceCells(from, targetPos) <= range) return null;
  const visited = new Set([`${from.x},${from.y}`]);
  const queue = [{ x: from.x, y: from.y, path: [] }];
  const cap = window.width * window.height;
  let expansions = 0;
  while (queue.length > 0 && expansions++ < cap) {
    const current = queue.shift();
    for (const step of NEIGHBOR_STEPS) {
      const nx = current.x + step.dx;
      const ny = current.y + step.dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (!isLegalStep(window, current, step.dx, step.dy)) continue;
      if (typeof isOccupied === 'function' && isOccupied(nx, ny)) continue;
      visited.add(key);
      const path = [...current.path, step.name];
      if (distanceCells({ x: nx, y: ny }, targetPos) <= range) return path;
      queue.push({ x: nx, y: ny, path });
    }
  }
  return null;
}

// Cells legally adjacent to `target` (passable, unoccupied, corner-rule respected) where
// placing the moving actor would complete a flank per isFlanked, given the current living
// side-mates in `allies`. Returned in NEIGHBOR_STEPS order for determinism. `isOccupied`
// should exclude the moving actor so their own cell doesn't block candidacy when it happens
// to be adjacent to the target.
export function flankStepCandidates(window, isOccupied, target, allies) {
  if (!window || !target?.position) return [];
  const livingAllies = (allies || []).filter(a => a?.hp > 0 && a.position);
  if (livingAllies.length === 0) return [];
  const center = target.position;
  const candidates = [];
  for (const step of NEIGHBOR_STEPS) {
    const nx = center.x + step.dx;
    const ny = center.y + step.dy;
    if (!isPassableCell(window, nx, ny)) continue;
    if (typeof isOccupied === 'function' && isOccupied(nx, ny)) continue;
    if (step.dx !== 0 && step.dy !== 0) {
      const hOpen = isPassableCell(window, center.x + step.dx, center.y);
      const vOpen = isPassableCell(window, center.x, center.y + step.dy);
      if (!hOpen && !vOpen) continue;
    }
    const probe = { hp: 1, position: { x: nx, y: ny } };
    if (isFlanked(target, [...livingAllies, probe], window)) {
      candidates.push({ x: nx, y: ny });
    }
  }
  return candidates;
}
