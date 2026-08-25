import { createEnemy, createEcho } from './enemies.js';

const WINDOW_WIDTH = 8;
const WINDOW_HEIGHT = 16;
const CANDIDATE_RING_RADIUS = 2;
const OPEN_CELL_TARGET = 48;
const MAX_WIDENING_PASSES = 3;

function isOpenFloorCell(floorCells, x, y) {
  return floorCells[y]?.[x] !== undefined && floorCells[y][x] !== 0;
}

function isOpenWindowCell(cells, x, y) {
  return y >= 0 && y < WINDOW_HEIGHT && x >= 0 && x < WINDOW_WIDTH && cells[y][x] !== 0;
}

function buildWindowCells(floorCells, originX, originY) {
  const cells = [];
  for (let y = 0; y < WINDOW_HEIGHT; y++) {
    const row = [];
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      row.push(isOpenFloorCell(floorCells, originX + x, originY + y) ? 1 : 0);
    }
    cells.push(row);
  }
  return cells;
}

function countOpenCellsIn(cells) {
  let n = 0;
  for (let y = 0; y < WINDOW_HEIGHT; y++) {
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      if (cells[y][x] !== 0) n++;
    }
  }
  return n;
}

// Mirror of src/floor/validator.js:countOneWideCorridors (SESSION-02); both must stay in sync.
// A "1-wide corridor cell" is an open cell whose only two open orthogonal neighbors are collinear
// (N+S or E+W). Inlined here because the rules layer must not import from the floor layer.
function countOneWideCorridorsIn(cells) {
  let n = 0;
  for (let y = 0; y < WINDOW_HEIGHT; y++) {
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      if (cells[y][x] === 0) continue;
      const north = isOpenWindowCell(cells, x, y - 1);
      const south = isOpenWindowCell(cells, x, y + 1);
      const east = isOpenWindowCell(cells, x + 1, y);
      const west = isOpenWindowCell(cells, x - 1, y);
      const open = (north ? 1 : 0) + (south ? 1 : 0) + (east ? 1 : 0) + (west ? 1 : 0);
      if (open === 2 && ((north && south) || (east && west))) n++;
    }
  }
  return n;
}

// Greedy disjoint 2x2 all-open blocks: top-to-bottom, left-to-right sweep. Each matched
// block marks its four cells as claimed so overlapping blocks are not double-counted.
function countTwoByTwoRegionsIn(cells) {
  const claimed = Array.from({ length: WINDOW_HEIGHT }, () => new Array(WINDOW_WIDTH).fill(false));
  let n = 0;
  for (let y = 0; y <= WINDOW_HEIGHT - 2; y++) {
    for (let x = 0; x <= WINDOW_WIDTH - 2; x++) {
      if (claimed[y][x] || claimed[y][x + 1] || claimed[y + 1][x] || claimed[y + 1][x + 1]) continue;
      if (cells[y][x] === 0 || cells[y][x + 1] === 0 || cells[y + 1][x] === 0 || cells[y + 1][x + 1] === 0) continue;
      claimed[y][x] = true;
      claimed[y][x + 1] = true;
      claimed[y + 1][x] = true;
      claimed[y + 1][x + 1] = true;
      n++;
    }
  }
  return n;
}

// Pure — no PRNG. Metrics for scoring plus the fully-built 8x16 cells grid so callers
// don't recarve. { openCells, oneWideCorridors, twoByTwoRegions, cells }.
export function windowMetrics(floorCells, originX, originY) {
  const cells = buildWindowCells(floorCells, originX, originY);
  return {
    openCells: countOpenCellsIn(cells),
    oneWideCorridors: countOneWideCorridorsIn(cells),
    twoByTwoRegions: countTwoByTwoRegionsIn(cells),
    cells
  };
}

// Enumerate up to 25 candidate origins in a Chebyshev-2 ring around the contact-centered
// origin, clamp each to grid bounds, deduplicate, and pick the best by:
//   score = openCells * 4 - oneWideCorridors * 3 + min(2, twoByTwoRegions) * 8
// Ties broken by closer-to-center Chebyshev distance, then (originY, originX) lex.
function pickBestWindow(floorCells, contact) {
  const floorHeight = floorCells.length;
  const floorWidth = floorCells[0]?.length || 0;
  const baseX = contact.x - Math.floor(WINDOW_WIDTH / 2);
  const baseY = contact.y - Math.floor(WINDOW_HEIGHT / 2);
  const maxOX = Math.max(0, floorWidth - WINDOW_WIDTH);
  const maxOY = Math.max(0, floorHeight - WINDOW_HEIGHT);

  // Deduplicate clamped origins; each unique origin remembers its smallest Chebyshev distance
  // to the base (unclamped) offset so tiebreaks favor candidates that started near the center.
  const seen = new Map();
  for (let dy = -CANDIDATE_RING_RADIUS; dy <= CANDIDATE_RING_RADIUS; dy++) {
    for (let dx = -CANDIDATE_RING_RADIUS; dx <= CANDIDATE_RING_RADIUS; dx++) {
      const oX = Math.max(0, Math.min(maxOX, baseX + dx));
      const oY = Math.max(0, Math.min(maxOY, baseY + dy));
      const cheb = Math.max(Math.abs(dx), Math.abs(dy));
      const key = `${oX},${oY}`;
      const existing = seen.get(key);
      if (!existing || existing.cheb > cheb) {
        seen.set(key, { originX: oX, originY: oY, cheb });
      }
    }
  }

  let best = null;
  for (const cand of seen.values()) {
    const m = windowMetrics(floorCells, cand.originX, cand.originY);
    const twos = Math.min(2, m.twoByTwoRegions);
    const score = m.openCells * 4 - m.oneWideCorridors * 3 + twos * 8;
    const entry = { originX: cand.originX, originY: cand.originY, cheb: cand.cheb, cells: m.cells, score };
    if (!best) { best = entry; continue; }
    if (entry.score > best.score) { best = entry; continue; }
    if (entry.score < best.score) continue;
    if (entry.cheb < best.cheb) { best = entry; continue; }
    if (entry.cheb > best.cheb) continue;
    if (entry.originY < best.originY) { best = entry; continue; }
    if (entry.originY > best.originY) continue;
    if (entry.originX < best.originX) { best = entry; }
  }

  return best;
}

// Flood-fill open regions, sorted by descending size (ties broken by earliest (y, x) cell
// so widening choices stay deterministic when two regions tie in size).
function openRegionsOf(cells) {
  const visited = Array.from({ length: WINDOW_HEIGHT }, () => new Array(WINDOW_WIDTH).fill(false));
  const regions = [];
  for (let y = 0; y < WINDOW_HEIGHT; y++) {
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      if (cells[y][x] === 0 || visited[y][x]) continue;
      const region = [];
      const stack = [[x, y]];
      visited[y][x] = true;
      let minKey = y * WINDOW_WIDTH + x;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        region.push({ x: cx, y: cy });
        const key = cy * WINDOW_WIDTH + cx;
        if (key < minKey) minKey = key;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= WINDOW_WIDTH || ny >= WINDOW_HEIGHT) continue;
          if (cells[ny][nx] === 0 || visited[ny][nx]) continue;
          visited[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      regions.push({ cells: region, minKey });
    }
  }
  regions.sort((a, b) => b.cells.length - a.cells.length || a.minKey - b.minKey);
  return regions.map(r => r.cells);
}

function isBorder(x, y) {
  return x === 0 || y === 0 || x === WINDOW_WIDTH - 1 || y === WINDOW_HEIGHT - 1;
}

// BFS through INTERIOR wall cells from any interior wall touching regionA seeking any interior
// wall touching regionB. Border walls are excluded so the outer ring stays whatever the crop
// gave us — cover geometry needs the wall boundary intact. Seed frontier iterated in (y, x)
// order so re-runs pick the same connector path.
function shortestWallChain(cells, regionA, regionB) {
  const inB = new Set(regionB.map(c => `${c.x},${c.y}`));
  const seeds = [];
  const seedSeen = new Set();
  for (const cell of regionA) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (nx <= 0 || ny <= 0 || nx >= WINDOW_WIDTH - 1 || ny >= WINDOW_HEIGHT - 1) continue;
      if (cells[ny][nx] !== 0) continue;
      const key = `${nx},${ny}`;
      if (seedSeen.has(key)) continue;
      seedSeen.add(key);
      seeds.push({ x: nx, y: ny });
    }
  }
  seeds.sort((a, b) => a.y - b.y || a.x - b.x);

  const visited = new Set();
  const queue = [];
  for (const seed of seeds) {
    const key = `${seed.x},${seed.y}`;
    visited.add(key);
    queue.push({ x: seed.x, y: seed.y, path: [{ x: seed.x, y: seed.y }] });
  }

  let cap = WINDOW_WIDTH * WINDOW_HEIGHT;
  while (queue.length > 0 && cap-- > 0) {
    const cur = queue.shift();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (inB.has(`${nx},${ny}`)) return cur.path;
    }
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx <= 0 || ny <= 0 || nx >= WINDOW_WIDTH - 1 || ny >= WINDOW_HEIGHT - 1) continue;
      if (cells[ny][nx] !== 0) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny, path: [...cur.path, { x: nx, y: ny }] });
    }
  }
  return null;
}

// Open a 2-wide connector along the shortest interior wall chain between the two largest
// open regions. For each chain cell, also open exactly ONE perpendicular neighbor to make
// the corridor 2-wide (skipped if that side is already open). Border cells never touched.
// Returns true if any wall was opened.
function connectorPass(cells) {
  const regions = openRegionsOf(cells);
  if (regions.length < 2) return false;
  const path = shortestWallChain(cells, regions[0], regions[1]);
  if (!path || path.length === 0) return false;

  let mutated = false;
  for (const cell of path) {
    if (isBorder(cell.x, cell.y)) continue;
    if (cells[cell.y][cell.x] === 0) {
      cells[cell.y][cell.x] = 1;
      mutated = true;
    }
  }
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const neighbor = i > 0 ? path[i - 1] : (i + 1 < path.length ? path[i + 1] : null);
    let perpendicular;
    if (neighbor && neighbor.y === p.y) {
      perpendicular = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }];
    } else if (neighbor && neighbor.x === p.x) {
      perpendicular = [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
    } else {
      perpendicular = [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }];
    }
    let alreadyWide = false;
    for (const d of perpendicular) {
      const nx = p.x + d.dx;
      const ny = p.y + d.dy;
      if (nx < 0 || ny < 0 || nx >= WINDOW_WIDTH || ny >= WINDOW_HEIGHT) continue;
      if (cells[ny][nx] !== 0) { alreadyWide = true; break; }
    }
    if (alreadyWide) continue;
    for (const d of perpendicular) {
      const nx = p.x + d.dx;
      const ny = p.y + d.dy;
      if (nx < 0 || ny < 0 || nx >= WINDOW_WIDTH || ny >= WINDOW_HEIGHT) continue;
      if (isBorder(nx, ny)) continue;
      if (cells[ny][nx] === 0) {
        cells[ny][nx] = 1;
        mutated = true;
        break;
      }
    }
  }
  return mutated;
}

// Open every INTERIOR wall cell orthogonally adjacent to the largest open region. Border cells
// never touched; candidates iterated in (y, x) order for determinism. Returns true if any wall
// was opened.
function perimeterPass(cells) {
  const regions = openRegionsOf(cells);
  if (regions.length === 0) return false;
  const largest = regions[0];
  const inRegion = new Set(largest.map(c => `${c.x},${c.y}`));
  const candidates = new Map();
  for (const cell of largest) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (nx < 0 || ny < 0 || nx >= WINDOW_WIDTH || ny >= WINDOW_HEIGHT) continue;
      if (isBorder(nx, ny)) continue;
      if (cells[ny][nx] !== 0) continue;
      if (inRegion.has(`${nx},${ny}`)) continue;
      candidates.set(`${nx},${ny}`, { x: nx, y: ny });
    }
  }
  const ordered = [...candidates.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  if (ordered.length === 0) return false;
  for (const p of ordered) cells[p.y][p.x] = 1;
  return true;
}

// Post-carve widening. Mutates the passed-in window `cells` only (never floorCells). Runs a
// connector pass first, then perimeter passes; caps total passes at MAX_WIDENING_PASSES for
// bounded latency. Short-circuits as soon as OPEN_CELL_TARGET is met, so re-invoking on an
// already-saturated grid returns immediately (idempotent when the target is reachable — true
// for every real 20x32 floor slice we generate).
function widenWindow(cells) {
  let passes = 0;
  while (passes < MAX_WIDENING_PASSES && countOpenCellsIn(cells) < OPEN_CELL_TARGET) {
    const mutated = passes === 0 ? connectorPass(cells) : perimeterPass(cells);
    passes++;
    if (!mutated) break;
  }
  return { passes, hitCap: passes === MAX_WIDENING_PASSES };
}

// Pure — no PRNG, no side effects on floorCells. Picks the best of ~25 candidate origins in a
// Chebyshev-2 ring, then widens the CARVED WINDOW ONLY when the initial slice falls short of
// OPEN_CELL_TARGET open cells. Returns { originX, originY, width: 8, height: 16, cells }. If
// floorCells collapses to `[[1]]` the smallest legal window is returned with just (0,0) open.
function carveWindow(floorCells, contact) {
  const best = pickBestWindow(floorCells, contact);
  const cells = best ? best.cells : buildWindowCells(floorCells, 0, 0);
  const originX = best ? best.originX : 0;
  const originY = best ? best.originY : 0;
  if (countOpenCellsIn(cells) < OPEN_CELL_TARGET) {
    widenWindow(cells);
  }
  return { originX, originY, width: WINDOW_WIDTH, height: WINDOW_HEIGHT, cells };
}

function openCellsOf(window) {
  const cells = [];
  for (let y = 0; y < window.height; y++) {
    for (let x = 0; x < window.width; x++) {
      if (window.cells[y][x] !== 0) cells.push({ x, y });
    }
  }
  return cells;
}

const MIN_BAND_SEPARATION = 9;
const MAX_BAND_SEPARATION = 12;

function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Deterministic anchor pair for the two deployment bands: prefer a separation inside the 9-12 cell
// target band (closest to the top of the band), falling back to the largest separation the carved
// geometry actually offers when the target band is unreachable.
function anchorPair(openCells) {
  let inBand = null;
  let inBandDistance = -1;
  let overall = [openCells[0], openCells[0]];
  let overallDistance = -1;
  for (let i = 0; i < openCells.length; i++) {
    for (let j = i + 1; j < openCells.length; j++) {
      const distance = chebyshev(openCells[i], openCells[j]);
      if (distance > overallDistance) {
        overallDistance = distance;
        overall = [openCells[i], openCells[j]];
      }
      if (distance >= MIN_BAND_SEPARATION && distance <= MAX_BAND_SEPARATION && distance > inBandDistance) {
        inBandDistance = distance;
        inBand = [openCells[i], openCells[j]];
      }
    }
  }
  return inBand || overall;
}

function nearestUnassigned(anchor, openCells, assigned, count) {
  return openCells
    .filter(cell => !assigned.has(`${cell.x},${cell.y}`))
    .sort((a, b) => chebyshev(anchor, a) - chebyshev(anchor, b) || a.y - b.y || a.x - b.x)
    .slice(0, count);
}

// Places party/hostile bands on legal, distinct cells, maximizing separation whenever geometry allows it.
// Reachability guarantee: confine BOTH bands to a single connected open region so party and
// hostiles can always path to each other. openRegionsOf is sorted largest-first; row-major
// sorting makes the single-region case byte-identical to the old openCellsOf(window) order,
// so fully-connected windows deploy exactly as before — only disconnected windows change.
export function deployBands(window, partyCount, hostileCount) {
  const regions = openRegionsOf(window.cells);
  if (regions.length === 0) return { partyPositions: [], hostilePositions: [] };
  const openCells = regions[0].slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const [partyAnchor, hostileAnchor] = anchorPair(openCells);
  const assigned = new Set();
  const partyPositions = nearestUnassigned(partyAnchor, openCells, assigned, partyCount);
  for (const cell of partyPositions) assigned.add(`${cell.x},${cell.y}`);
  const hostilePositions = nearestUnassigned(hostileAnchor, openCells, assigned, hostileCount);
  return { partyPositions, hostilePositions };
}

// Combat chaining — combat-and-ux-feedback-pass SESSION-01.
// CHAIN_ANCHOR_RANGE mirrors HOSTILE_CONTACT_RANGE (src/exploration/movement.js): the same
// threshold that triggers combat contact also defines who joins the fight around the contact
// point. Duplicated here deliberately because the rules layer must not import from the
// exploration layer (FORGE-CONFIG Architecture dependency flow).
const CHAIN_ANCHOR_RANGE = 2;
// CHAIN_LINK_RANGE = anchor + 1: once the initial group is seated, other spawns join if they
// stand within one extra cell of ANY already-chained spawn — the transitive "chain" that pulls
// a distant spawn in via a bridge of nearby ones.
const CHAIN_LINK_RANGE = 3;
// Cap total combatants at 1 (contact) + this. Floor spawn density (8+2*floor/3 across 40x64)
// keeps this from binding in typical play; it exists to bound the pathological dense cluster.
const MAX_CHAIN_ADDITIONAL = 6;

function chebyshevXY(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Transitive closure over activeSpawns rooted at contactSpawn. Passes:
//   1. Any spawn within CHAIN_ANCHOR_RANGE of contactPoint joins.
//   2. Iterate: any spawn within CHAIN_LINK_RANGE of any already-chained spawn joins.
//   3. Repeat until a full pass adds nothing new — or the cap is hit.
// Deterministic: iterates activeSpawns in its given order every pass; stops immediately when
// chained.size === 1 + MAX_CHAIN_ADDITIONAL. Returns [contactSpawn, ...pulled-in spawns].
export function gatherChainedSpawns(activeSpawns, contactPoint, contactSpawn) {
  const chained = new Map();
  if (contactSpawn) chained.set(contactSpawn.id, contactSpawn);
  const capReached = () => chained.size >= 1 + MAX_CHAIN_ADDITIONAL;
  let changed = true;
  while (changed && !capReached()) {
    changed = false;
    for (const spawn of activeSpawns) {
      if (capReached()) break;
      if (chained.has(spawn.id)) continue;
      const nearContact = contactPoint ? chebyshevXY(spawn, contactPoint) <= CHAIN_ANCHOR_RANGE : false;
      let nearChained = false;
      if (!nearContact) {
        for (const member of chained.values()) {
          if (chebyshevXY(spawn, member) <= CHAIN_LINK_RANGE) { nearChained = true; break; }
        }
      }
      if (nearContact || nearChained) {
        chained.set(spawn.id, spawn);
        changed = true;
      }
    }
  }
  return [...chained.values()];
}

// Turns a bare floor spawn stub ({id, x, y, archetypeId, ...}) into a combat-ready actor.
// Idempotent — an already-hydrated actor (hp/hpMax/defense present) passes through untouched,
// so this is safe to call on encounter.actors that arrived pre-hydrated from another caller.
// When enemiesData is absent (test fixtures that skip the archetype registry), the raw spawn
// passes through unchanged rather than crashing on the undefined archetype lookup.
export function hydrateSpawn(spawn, depth, rngCursor, enemiesData) {
  if (!spawn) return null;
  if (spawn.hp !== undefined && spawn.hpMax !== undefined && spawn.defense !== undefined) return spawn;
  if (spawn.archetypeId === 'echo') {
    const echo = createEcho(spawn.character, depth);
    return echo ? { ...echo, id: spawn.id ?? echo.id, x: spawn.x, y: spawn.y } : spawn;
  }
  if (!enemiesData) return spawn;
  const enemy = createEnemy(spawn.archetypeId, depth, rngCursor, enemiesData);
  if (!enemy) return spawn;
  return {
    ...enemy,
    id: spawn.id ?? enemy.id,
    x: spawn.x,
    y: spawn.y,
    ...(spawn.elite ? { elite: true } : {})
  };
}

export function createStandardEncounter(floor, contact, party, enemies, rngCursor, options = {}) {
  const floorCells = floor?.cells || floor?.grid || [[1]];
  const window = carveWindow(floorCells, contact || { x: 0, y: 0 });
  const depth = options.depth || 1;
  const hydrated = (enemies || []).map(e => hydrateSpawn(e, depth, rngCursor, options.enemiesData));
  const { partyPositions, hostilePositions } = deployBands(window, party.length, hydrated.length);
  const actors = [
    ...party.map((member, index) => ({
      ...member,
      side: 'party',
      position: partyPositions[index] ? { ...partyPositions[index] } : { x: 0, y: 0 }
    })),
    ...hydrated.map((enemy, index) => ({
      ...enemy,
      side: 'enemy',
      position: hostilePositions[index] ? { ...hostilePositions[index] } : { x: window.width - 1, y: window.height - 1 }
    }))
  ];
  return {
    id: `encounter_${contact?.x ?? 0}_${contact?.y ?? 0}_${rngCursor.getCursor('gen')}`,
    kind: 'standard',
    window,
    actors,
    forfeitableLoot: []
  };
}

export function completeEncounter(encounter, combatResult) {
  if (!encounter || !combatResult) return { resolved: false, reason: 'invalid-input' };
  const result = combatResult.result;
  if (result === 'victory') {
    return {
      resolved: true,
      outcome: 'victory',
      loot: [...(encounter.forfeitableLoot || [])],
      defeatedSpawnIds: combatResult.victoryPayload?.defeatedSpawnIds || [],
      reclaimableGear: combatResult.victoryPayload?.reclaimableGear || []
    };
  }
  if (result === 'retreat') {
    return {
      resolved: true,
      outcome: 'retreat',
      loot: [],
      forfeitedLoot: [...(encounter.forfeitableLoot || [])]
    };
  }
  if (result === 'wipe') {
    return {
      resolved: true,
      outcome: 'wipe',
      loot: [],
      forfeitedLoot: [...(encounter.forfeitableLoot || [])]
    };
  }
  return { resolved: false, reason: 'combat-not-ended' };
}

const HUNT_MIN_DISTANCE = 4;
const HUNT_MAX_DISTANCE = 6;
const HUNT_ELITE_TYPES = ['stalker', 'choir', 'null', 'construct'];

function findHuntSpawnCells(floorCells, partyPos, minDist, maxDist) {
  const candidates = floorCells.filter(cell => {
    if (cell.x === partyPos.x && cell.y === partyPos.y) return false;
    const dx = Math.abs(cell.x - partyPos.x);
    const dy = Math.abs(cell.y - partyPos.y);
    const dist = Math.max(dx, dy);
    return dist >= minDist && dist <= maxDist;
  });
  return candidates;
}

function groupBySide(candidates, partyPos) {
  const sides = { n: [], s: [], e: [], w: [], ne: [], nw: [], se: [], sw: [] };
  for (const cell of candidates) {
    const dx = cell.x - partyPos.x;
    const dy = cell.y - partyPos.y;
    let key;
    if (dy < 0 && Math.abs(dx) <= Math.abs(dy)) key = 'n';
    else if (dy > 0 && Math.abs(dx) <= Math.abs(dy)) key = 's';
    else if (dx > 0 && Math.abs(dy) <= Math.abs(dx)) key = 'e';
    else if (dx < 0 && Math.abs(dy) <= Math.abs(dx)) key = 'w';
    else if (dx > 0 && dy < 0) key = 'ne';
    else if (dx < 0 && dy < 0) key = 'nw';
    else if (dx > 0 && dy > 0) key = 'se';
    else key = 'sw';
    sides[key].push(cell);
  }
  return sides;
}

export function createHuntEncounter(floor, partyPosition, party, runState, rngCursor, data) {
  const floorCells = floor?.cells || floor?.grid || [[1]];
  const allCells = [];
  for (let y = 0; y < floorCells.length; y++) {
    for (let x = 0; x < floorCells[0].length; x++) {
      if (floorCells[y][x] !== 0) allCells.push({ x, y });
    }
  }

  let candidates = findHuntSpawnCells(allCells, partyPosition, HUNT_MIN_DISTANCE, HUNT_MAX_DISTANCE);
  if (candidates.length < 2) {
    candidates = findHuntSpawnCells(allCells, partyPosition, 2, 8);
  }
  if (candidates.length < 2) {
    candidates = allCells.filter(c => c.x !== partyPosition.x || c.y !== partyPosition.y);
  }

  const sides = groupBySide(candidates, partyPosition);
  const sideKeys = Object.keys(sides).filter(k => sides[k].length > 0);

  if (sideKeys.length < 2) {
    return null;
  }

  const depth = runState?.depth || 1;
  const baseEnemyCount = 2 + Math.floor(depth / 3);
  const numEnemies = baseEnemyCount + Math.floor(depth / 5);
  const themeData = data?.themes?.themes?.find(t => t.id === floor?.themeId) || {};
  const enemyWeights = themeData?.enemyMixWeights
    ? Object.entries(themeData.enemyMixWeights)
    : [['drone', 1]];

  const enemyPositions = [];
  const assigned = new Set();

  const selectedSides = [];
  const shuffledSides = [...sideKeys].sort(() => rngCursor.next('combat') - 0.5);
  for (const side of shuffledSides) {
    selectedSides.push(side);
    if (selectedSides.length >= Math.min(4, sideKeys.length)) break;
  }

  for (let i = 0; i < numEnemies; i++) {
    const side = selectedSides[i % selectedSides.length];
    const sideCells = sides[side].filter(c => !assigned.has(`${c.x},${c.y}`));
    if (sideCells.length === 0) continue;
    const cell = sideCells[Math.floor(rngCursor.next('combat') * sideCells.length)];
    assigned.add(`${cell.x},${cell.y}`);
    enemyPositions.push({ ...cell });
  }

  if (enemyPositions.length === 0) return null;

  const enemies = [];
  for (let i = 0; i < enemyPositions.length; i++) {
    let archetypeId;
    if (i === 0) {
      archetypeId = HUNT_ELITE_TYPES[Math.floor(rngCursor.next('combat') * HUNT_ELITE_TYPES.length)];
    } else {
      const total = enemyWeights.reduce((sum, [, w]) => sum + w, 0);
      if (total > 0) {
        let roll = rngCursor.nextInt('combat', total);
        archetypeId = enemyWeights[0][0];
        for (const [id, w] of enemyWeights) {
          roll -= w;
          if (roll < 0) { archetypeId = id; break; }
        }
      } else {
        archetypeId = 'drone';
      }
    }
    enemies.push(hydrateSpawn(
      { id: `hunt_${i}`, archetypeId, elite: i === 0 },
      depth,
      rngCursor,
      data?.enemies
    ));
  }

  const window = carveWindow(floorCells, partyPosition);
  const { partyPositions, hostilePositions } = deployBands(window, party.length, enemies.length);

  const actors = [
    ...party.map((member, index) => ({
      ...member,
      side: 'party',
      position: partyPositions[index] ? { ...partyPositions[index] } : { x: 0, y: 0 }
    })),
    ...enemies.map((enemy, index) => ({
      ...enemy,
      side: 'enemy',
      position: hostilePositions[index] ? { ...hostilePositions[index] } : { x: window.width - 1, y: window.height - 1 }
    }))
  ];

  return {
    id: `hunt_${depth}_${partyPosition.x}_${partyPosition.y}`,
    kind: 'hunt',
    window,
    actors,
    forfeitableLoot: []
  };
}

export function injectEcho(floor, echo, prng, floorCells) {
  const cells = floorCells || [];
  if (cells.length === 0) return null;

  const cell = cells[prng.nextInt(cells.length)];
  return {
    x: cell.x,
    y: cell.y,
    character: echo.character,
    equipment: echo.character?.equipment || null
  };
}

export function getDueEchoes(runState, floorNumber) {
  if (!runState?.echoQueue) return [];
  return runState.echoQueue.filter(echo =>
    echo.appearanceFloor === floorNumber && !echo.consumed
  );
}

export function consumeEcho(runState, echoIndex) {
  if (!runState?.echoQueue || echoIndex < 0 || echoIndex >= runState.echoQueue.length) return false;
  runState.echoQueue[echoIndex].consumed = true;
  return true;
}
