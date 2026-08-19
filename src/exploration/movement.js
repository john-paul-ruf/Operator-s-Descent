import { computeLOS, updateFogOfWar, syncVisitedBitmap } from './shadowcast.js';
import { generateLoot } from '../rules/loot.js';

const DIRECTIONS = {
  n: { dx: 0, dy: -1 },
  ne: { dx: 1, dy: -1 },
  e: { dx: 1, dy: 0 },
  se: { dx: 1, dy: 1 },
  s: { dx: 0, dy: 1 },
  sw: { dx: -1, dy: 1 },
  w: { dx: -1, dy: 0 },
  nw: { dx: -1, dy: -1 }
};

// LOS radius bumped 8 → 10 (combat-and-overworld-clarity-pass SESSION-04) so
// the wider corridors and spacious overworld read at a glance. The sig-driven
// override in moveParty (sig * 2) is unchanged.
const DEFAULT_LOS_RADIUS = 10;

// Overworld hunter activation: an enemy within this Chebyshev range of the
// party takes one BFS-shortest step toward the party per party move. Kept at
// 8 (the historical LOS default) so a hunter activates roughly when it becomes
// visible under the new radius-10 LOS.
export const HUNT_ACTIVATION_RANGE = 8;

const DIRECTION_ORDER = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const DEFAULT_PATH_MAX_STEPS = 64;

export const HOSTILE_CONTACT_RANGE = 2;

// Graph ("connected") distance from the party to the nearest VISIBLE, undefeated
// hostile, bounded at maxSteps. 8-way over walkable cells, honoring moveParty's
// closed-corner rule; fog-INDEPENDENT (traversability, not what's revealed) but
// the hostile itself must be in visibleCells (we only auto-engage what we can
// see). RNG-free. Returns { distance, entity } or { distance: null, entity: null }.
// Uses getActiveEnemySpawns so hunter-moved positions (SESSION-04) are seen,
// then additionally filters by runState.defeatedEnemies because the lattice's
// snapshot may lag behind runtime combat updates.
function nearestConnectedHostile(lattice, visibleCells, runState, maxSteps = HOSTILE_CONTACT_RANGE) {
  const defeated = runState?.defeatedEnemies || 0n;
  const hostileAt = new Map();
  for (const spawn of lattice.getActiveEnemySpawns()) {
    if ((defeated & (1n << BigInt(spawn.id))) !== 0n) continue;
    if (!visibleCells.has(`${spawn.x},${spawn.y}`)) continue;
    hostileAt.set(`${spawn.x},${spawn.y}`, spawn);
  }
  if (hostileAt.size === 0) return { distance: null, entity: null };
  const start = lattice.getPartyPosition();
  const w = lattice.getWidth();
  const h = lattice.getHeight();
  const dist = new Map([[`${start.x},${start.y}`, 0]]);
  const queue = [{ x: start.x, y: start.y }];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(`${cur.x},${cur.y}`);
    if (d > 0) {
      const hit = hostileAt.get(`${cur.x},${cur.y}`);
      if (hit) return { distance: d, entity: hit };
    }
    if (d >= maxSteps) continue;
    for (const name of DIRECTION_ORDER) {
      const delta = DIRECTIONS[name];
      const nx = cur.x + delta.dx;
      const ny = cur.y + delta.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nextKey = `${nx},${ny}`;
      if (dist.has(nextKey)) continue;
      const occupied = hostileAt.has(nextKey);
      if (!lattice.isWalkable(nx, ny) && !occupied) continue;
      if (delta.dx !== 0 && delta.dy !== 0) {
        const hOpen = lattice.isWalkable(cur.x + delta.dx, cur.y);
        const vOpen = lattice.isWalkable(cur.x, cur.y + delta.dy);
        if (!hOpen && !vOpen) continue;
      }
      dist.set(nextKey, d + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  return { distance: null, entity: null };
}

export { nearestConnectedHostile };

export function findExplorationPath(lattice, fogState, from, to, options = {}) {
  if (!lattice || !fogState || !from || !to) return null;
  if (from.x === to.x && from.y === to.y) return null;
  const w = lattice.getWidth();
  const h = lattice.getHeight();
  if (to.x < 0 || to.y < 0 || to.x >= w || to.y >= h) return null;
  if (!lattice.isWalkable(to.x, to.y)) return null;
  if (fogState[to.y * w + to.x] === 0) return null;
  const maxSteps = Number.isFinite(options.maxSteps) && options.maxSteps > 0
    ? Math.floor(options.maxSteps)
    : DEFAULT_PATH_MAX_STEPS;

  const startKey = `${from.x},${from.y}`;
  const targetKey = `${to.x},${to.y}`;
  const parent = new Map();
  parent.set(startKey, null);
  const distance = new Map();
  distance.set(startKey, 0);
  const queue = [{ x: from.x, y: from.y }];
  let head = 0;
  let found = false;

  while (head < queue.length) {
    const current = queue[head++];
    if (current.x === to.x && current.y === to.y) { found = true; break; }
    const dist = distance.get(`${current.x},${current.y}`);
    if (dist >= maxSteps) continue;
    for (const direction of DIRECTION_ORDER) {
      const delta = DIRECTIONS[direction];
      const nx = current.x + delta.dx;
      const ny = current.y + delta.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!lattice.isWalkable(nx, ny)) continue;
      if (fogState[ny * w + nx] === 0) continue;
      if (delta.dx !== 0 && delta.dy !== 0) {
        const hOpen = lattice.isWalkable(current.x + delta.dx, current.y);
        const vOpen = lattice.isWalkable(current.x, current.y + delta.dy);
        if (!hOpen && !vOpen) continue;
      }
      const nextKey = `${nx},${ny}`;
      if (parent.has(nextKey)) continue;
      parent.set(nextKey, { key: `${current.x},${current.y}`, direction });
      distance.set(nextKey, dist + 1);
      queue.push({ x: nx, y: ny });
    }
  }

  if (!found) return null;
  const path = [];
  const cells = [];
  let cursor = targetKey;
  while (cursor && cursor !== startKey) {
    const entry = parent.get(cursor);
    if (!entry) return null;
    path.unshift(entry.direction);
    const [cx, cy] = cursor.split(',').map(Number);
    cells.unshift({ x: cx, y: cy });
    cursor = entry.key;
  }
  if (path.length === 0) return null;
  if (path.length > maxSteps) return null;
  return { path, cells };
}

export function moveParty(lattice, fogState, direction, rngCursor, runState, options = {}) {
  const pos = lattice.getPartyPosition();
  const dir = DIRECTIONS[direction];
  if (!dir) return { moved: false, interruptType: 'invalid-direction' };

  const newX = pos.x + dir.dx;
  const newY = pos.y + dir.dy;

  if (dir.dx !== 0 && dir.dy !== 0) {
    const hWalkable = lattice.isWalkable(pos.x + dir.dx, pos.y);
    const vWalkable = lattice.isWalkable(pos.x, pos.y + dir.dy);
    if (!hWalkable && !vWalkable) {
      return { moved: false, interruptType: 'blocked' };
    }
  }

  if (!lattice.isWalkable(newX, newY)) {
    return { moved: false, interruptType: 'blocked' };
  }

  lattice.setPartyPosition(newX, newY);
  if (runState) {
    if (runState.partyPosition) {
      runState.partyPosition = { x: newX, y: newY };
    }
    if (runState.markCellVisited) {
      runState.markCellVisited(newX, newY);
    }
  }

  let losRadius = options.losRadius || DEFAULT_LOS_RADIUS;
  if (runState && runState.party && runState.party.length > 0) {
    const sigil = runState.party[0]?.attributes?.sig;
    if (sigil && !options.losRadius) {
      losRadius = Math.max(1, sigil * 2);
    }
  }

  const visibleCells = computeLOS(lattice, newX, newY, losRadius);

  if (fogState) {
    updateFogOfWar(fogState, visibleCells);
  }

  if (runState && runState.fogOfWar && fogState) {
    syncVisitedBitmap(fogState, runState.fogOfWar);
  }

  // Ordering (SESSION-04): party moves → LOS refresh → hunters move → discovery
  // + contact detection run against the NEW state. This lets a hunter that
  // closes to Chebyshev-1 on the same tick as the party's step trigger combat
  // before the tick ends.
  let hunterStep = { moved: [], contactSpawnId: null };
  if (!options.combatActive) {
    hunterStep = stepHunters(lattice, runState);
  }

  const discoveries = findDiscoveries(lattice, visibleCells, runState, options);
  const interrupt = pickInterrupt(discoveries, options);
  const proximity = computeExplorationProximity(lattice, visibleCells, runState);

  let combatContact = false;
  let hostileContactDistance = null;
  let contactEntity = null;
  if (!options.combatActive) {
    if (!runState._contactedHostiles) runState._contactedHostiles = new Set();
    const near = nearestConnectedHostile(lattice, visibleCells, runState, HOSTILE_CONTACT_RANGE);
    if (near.entity) {
      hostileContactDistance = near.distance;
      // Dedup by spawn.id (SESSION-04): hunter movement changes positions,
      // so keying by (x,y) would re-fire combatContact every time an enemy
      // stepped. spawn.id is the stable identity of a given enemy.
      if (!runState._contactedHostiles.has(near.entity.id)) {
        runState._contactedHostiles.add(near.entity.id);
        combatContact = true;
        contactEntity = near.entity;
      }
    }
    // Hunter-triggered contact fallback: if the hunter closes to Chebyshev-1
    // and shadowcast LOS still doesn't include its new cell (rare wall geometry),
    // ensure combatContact still fires from the hunter step result.
    if (!combatContact && hunterStep.contactSpawnId != null) {
      const spawn = lattice.getActiveEnemySpawns().find(e => e.id === hunterStep.contactSpawnId);
      if (spawn && !runState._contactedHostiles.has(spawn.id)) {
        runState._contactedHostiles.add(spawn.id);
        combatContact = true;
        contactEntity = spawn;
        hostileContactDistance = 1;
      }
    }
  }

  let huntResult = null;
  let pendingHunt = false;

  if (!options.combatActive) {
    huntResult = tickDangerClock(runState, 1, { exploring: true });
    if (huntResult?.huntTriggered) {
      if (interrupt === null || interrupt.type === 'hostile') {
        return {
          moved: true,
          position: { x: newX, y: newY },
          visibleCells,
          discoveries,
          interruptType: 'hunt',
          discoveredEntity: huntResult.huntData,
          danger: { progress: runState?.dangerClockProgress ?? 0, huntTriggered: true, huntData: huntResult.huntData },
          proximity,
          combatContact,
          hostileContactDistance,
          contactEntity,
          stateDelta: { position: true, fog: true, danger: true }
        };
      } else {
        pendingHunt = true;
      }
    }
  } else if (runState?.dangerClockProgress >= 1.0) {
    pendingHunt = true;
  }

  return {
    moved: true,
    position: { x: newX, y: newY },
    visibleCells,
    discoveries,
    interruptType: interrupt?.type || null,
    discoveredEntity: interrupt?.entity || null,
    danger: {
      progress: runState?.dangerClockProgress ?? 0,
      huntTriggered: false,
      pendingHunt
    },
    proximity,
    combatContact,
    hostileContactDistance,
    contactEntity,
    stateDelta: { position: true, fog: true, danger: true }
  };
}

export function tickDangerClock(runState, stepCount, context = {}) {
  if (!runState || !runState.getDangerClockRate) return { huntTriggered: false };

  const wasAtThreshold = runState.dangerClockProgress >= 1.0;

  const baseRate = runState.getDangerClockRate();
  runState.dangerClockProgress += baseRate * stepCount;

  if (context.combatActive) {
    return { huntTriggered: false, pendingHunt: runState.dangerClockProgress >= 1.0 };
  }

  if (!wasAtThreshold && runState.dangerClockProgress >= 1.0) {
    return { huntTriggered: true, huntData: { type: 'hunt', depth: runState.depth } };
  }
  return { huntTriggered: false };
}

export function resetDangerClock(runState) {
  if (!runState) return;
  runState.dangerClockProgress = 0;
}

function findDiscoveries(lattice, visibleCells, runState, options = {}) {
  const discoveries = [];
  const defeated = runState?.defeatedEnemies || 0n;
  const opened = runState?.openedContainers || 0n;

  if (!runState?._knownHostiles) runState._knownHostiles = new Set();
  if (!runState?._knownContainers) runState._knownContainers = new Set();

  // Hostile discoveries iterate the active (culled-filtered, hunter-position-
  // adjusted) spawns and key by spawn.id — otherwise a hunter moving each turn
  // would count as a fresh discovery on every step. The lattice's defeat
  // snapshot lags runtime combat, so we additionally filter by runState.
  for (const spawn of lattice.getActiveEnemySpawns()) {
    if ((defeated & (1n << BigInt(spawn.id))) !== 0n) continue;
    if (visibleCells.has(`${spawn.x},${spawn.y}`)) {
      const newlyDiscovered = !runState._knownHostiles.has(spawn.id);
      discoveries.push({ type: 'hostile', entity: spawn, newlyDiscovered });
      if (newlyDiscovered) runState._knownHostiles.add(spawn.id);
    }
  }

  for (const container of lattice.getActiveContainers()) {
    if (visibleCells.has(`${container.x},${container.y}`)) {
      const containerBit = BigInt(container.id);
      if ((opened & (1n << containerBit)) === 0n) {
        const key = `${container.x},${container.y}`;
        const newlyDiscovered = !runState._knownContainers.has(key);
        discoveries.push({ type: 'container', entity: container, newlyDiscovered });
        if (newlyDiscovered) runState._knownContainers.add(key);
      }
    }
  }

  const descentPoint = lattice.getDescentPoint();
  if (descentPoint && visibleCells.has(`${descentPoint.x},${descentPoint.y}`)) {
    const newlyDiscovered = !runState?._knownDescent;
    discoveries.push({ type: 'descent', entity: descentPoint, newlyDiscovered });
    if (newlyDiscovered && runState) runState._knownDescent = true;
  }

  if (moveParty._damageFlag) {
    if (options.autoStopToggles?.damage !== false) discoveries.push({ type: 'damage', entity: null, newlyDiscovered: true });
    moveParty._damageFlag = false;
  }

  return discoveries;
}

function pickInterrupt(discoveries, options) {
  const toggles = options.autoStopToggles || {};

  for (const d of discoveries) {
    if (d.type === 'hostile' && d.newlyDiscovered) {
      return { type: 'hostile', entity: d.entity };
    }
  }
  if (toggles.container !== false) {
    for (const d of discoveries) {
      if (d.type === 'container' && d.newlyDiscovered) {
        return { type: 'container', entity: d.entity };
      }
    }
  }
  if (toggles.descent !== false) {
    for (const d of discoveries) {
      if (d.type === 'descent' && d.newlyDiscovered) {
        return { type: 'descent', entity: d.entity };
      }
    }
  }
  for (const d of discoveries) {
    if (d.type === 'damage') {
      return { type: 'damage', entity: null };
    }
  }

  return null;
}

export function computeExplorationProximity(lattice, visibleCells, runState) {
  const defeated = runState?.defeatedEnemies || 0n;
  const opened = runState?.openedContainers || 0n;
  const pos = lattice.getPartyPosition();

  let nearestHostile = Infinity;
  for (const spawn of lattice.getActiveEnemySpawns()) {
    if ((defeated & (1n << BigInt(spawn.id))) !== 0n) continue;
    if (!visibleCells.has(`${spawn.x},${spawn.y}`)) continue;
    const dist = Math.max(Math.abs(spawn.x - pos.x), Math.abs(spawn.y - pos.y));
    if (dist < nearestHostile) nearestHostile = dist;
  }

  let nearestContainer = Infinity;
  for (const c of lattice.getActiveContainers()) {
    if ((opened & (1n << BigInt(c.id))) !== 0n) continue;
    if (!visibleCells.has(`${c.x},${c.y}`)) continue;
    const dist = Math.max(Math.abs(c.x - pos.x), Math.abs(c.y - pos.y));
    if (dist < nearestContainer) nearestContainer = dist;
  }

  return {
    nearestHostile: nearestHostile === Infinity ? null : nearestHostile,
    nearestContainer: nearestContainer === Infinity ? null : nearestContainer
  };
}

moveParty._damageFlag = false;

export function signalMovementDamage() {
  moveParty._damageFlag = true;
}

// Overworld hunt (SESSION-04). After every party move, each active enemy within
// HUNT_ACTIVATION_RANGE (Chebyshev, default 8) takes ONE BFS-shortest step
// toward the party over the exploration lattice. Ordering is deterministic:
// spawn.id ascending, NEIGHBOR_STEPS via DIRECTION_ORDER for ties. RNG-free.
// Walls, closed-corner rule, the party cell, and other hunter cells all block
// a step; a blocked hunter simply stays put. Positions live in the lattice's
// session-scoped hunter override map — NOT persisted to the save (Custom
// Rule 13). Returns { moved: [{id, from, to}], contactSpawnId } — the caller
// treats a contactSpawnId (any hunter that ends adjacent to the party) as an
// immediate combat contact.
export function stepHunters(lattice, runState) {
  const moved = [];
  let contactSpawnId = null;
  if (!lattice) return { moved, contactSpawnId };
  const party = lattice.getPartyPosition();
  if (!party) return { moved, contactSpawnId };
  const w = lattice.getWidth();
  const h = lattice.getHeight();

  const defeated = runState?.defeatedEnemies || 0n;
  const activeEnemies = lattice.getActiveEnemySpawns()
    .filter(spawn => (defeated & (1n << BigInt(spawn.id))) === 0n);
  if (activeEnemies.length === 0) return { moved, contactSpawnId };
  const sortedEnemies = [...activeEnemies].sort((a, b) => a.id - b.id);

  const occupied = new Map(); // "x,y" → 'party' | spawn.id
  occupied.set(`${party.x},${party.y}`, 'party');
  for (const spawn of sortedEnemies) occupied.set(`${spawn.x},${spawn.y}`, spawn.id);

  // BFS from party outward over walkable + corner-rule cells. Distance map is
  // reused for every hunter so the whole pass is O(cells) not O(hunters × cells).
  // Occupancy is checked per-hunter at step-selection time so id-order conflicts
  // resolve correctly (the id-lower hunter takes the shared step; others stall).
  const distFromParty = new Map();
  distFromParty.set(`${party.x},${party.y}`, 0);
  const queue = [{ x: party.x, y: party.y }];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = distFromParty.get(`${cur.x},${cur.y}`);
    for (const name of DIRECTION_ORDER) {
      const delta = DIRECTIONS[name];
      const nx = cur.x + delta.dx;
      const ny = cur.y + delta.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = `${nx},${ny}`;
      if (distFromParty.has(nk)) continue;
      if (!lattice.isWalkable(nx, ny)) continue;
      if (delta.dx !== 0 && delta.dy !== 0) {
        const hOpen = lattice.isWalkable(cur.x + delta.dx, cur.y);
        const vOpen = lattice.isWalkable(cur.x, cur.y + delta.dy);
        if (!hOpen && !vOpen) continue;
      }
      distFromParty.set(nk, d + 1);
      queue.push({ x: nx, y: ny });
    }
  }

  for (const enemy of sortedEnemies) {
    const chebDist = Math.max(Math.abs(enemy.x - party.x), Math.abs(enemy.y - party.y));
    if (chebDist > HUNT_ACTIVATION_RANGE) continue;
    if (chebDist === 1) {
      if (contactSpawnId == null) contactSpawnId = enemy.id;
      continue;
    }
    const myDist = distFromParty.get(`${enemy.x},${enemy.y}`);
    if (myDist == null || myDist <= 1) {
      if (myDist === 1 && contactSpawnId == null) contactSpawnId = enemy.id;
      continue;
    }
    let bestStep = null;
    for (const name of DIRECTION_ORDER) {
      const delta = DIRECTIONS[name];
      const nx = enemy.x + delta.dx;
      const ny = enemy.y + delta.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nk = `${nx},${ny}`;
      const nDist = distFromParty.get(nk);
      if (nDist !== myDist - 1) continue;
      if (delta.dx !== 0 && delta.dy !== 0) {
        const hOpen = lattice.isWalkable(enemy.x + delta.dx, enemy.y);
        const vOpen = lattice.isWalkable(enemy.x, enemy.y + delta.dy);
        if (!hOpen && !vOpen) continue;
      }
      if (nx === party.x && ny === party.y) continue; // never step onto the party
      const occ = occupied.get(nk);
      if (occ !== undefined && occ !== enemy.id) continue;
      bestStep = { x: nx, y: ny };
      break;
    }
    if (!bestStep) continue;
    occupied.delete(`${enemy.x},${enemy.y}`);
    occupied.set(`${bestStep.x},${bestStep.y}`, enemy.id);
    lattice.setHunterPosition(enemy.id, bestStep);
    moved.push({ id: enemy.id, from: { x: enemy.x, y: enemy.y }, to: bestStep });
    const newCheb = Math.max(Math.abs(bestStep.x - party.x), Math.abs(bestStep.y - party.y));
    if (newCheb === 1 && contactSpawnId == null) contactSpawnId = enemy.id;
  }

  return { moved, contactSpawnId };
}

// Empty-cache cull (SESSION-04). Called ONCE at exploration mount per floor
// entry. For each container, run generateLoot() against its stable seed; if
// the projected item count is 0, mark the container culled on the lattice —
// it never renders, never triggers a container interrupt. Enemies reserve a
// hook via spawn.hasDrop for a future enemy-drops feature (today no enemy
// culls for loot reasons). `data` is the game-data registry (equipment,
// affixes, consumables, themes); `floor` supplies floorSubSeed + themeId.
export function pruneEmptyCaches(lattice, runState, floor, data) {
  const pruned = { containers: [], enemies: [] };
  if (!lattice || !runState || !floor || !data) return pruned;
  const equipmentData = data.equipment;
  const affixesData = data.affixes;
  const consumablesData = data.consumables;
  if (!equipmentData || !affixesData || !consumablesData) return pruned;
  const themes = data.themes?.themes || [];
  const theme = themes.find((t) => t.id === floor.themeId) || null;
  const themeLootBias = theme?.lootBias || null;
  const floorId = `${runState.worldSeed}:${runState.depth}:${floor.floorSubSeed ?? 0}`;
  for (const container of lattice.getContainers()) {
    if (lattice.isContainerOpened(container.id)) continue;
    if (lattice.isCulled('container', container.id)) continue;
    const items = generateLoot(
      runState.worldSeed,
      runState.depth,
      floorId,
      container.id,
      themeLootBias,
      equipmentData,
      affixesData,
      consumablesData,
      { containerType: container.kind }
    );
    if (Array.isArray(items) && items.length === 0) {
      lattice.markCulled('container', container.id);
      pruned.containers.push(container.id);
    }
  }
  for (const spawn of lattice.getEnemySpawns()) {
    if (lattice.isEnemyDefeated(spawn.id)) continue;
    if (lattice.isCulled('enemy', spawn.id)) continue;
    if (spawn.hasDrop === false) {
      // Reserved hook. Today no enemy sets hasDrop === false explicitly; this
      // branch stays inert until a future feature ships enemy loot with the
      // hasDrop toggle.
      lattice.markCulled('enemy', spawn.id);
      pruned.enemies.push(spawn.id);
    }
  }
  return pruned;
}