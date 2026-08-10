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
