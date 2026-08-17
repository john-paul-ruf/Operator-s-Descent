import { computeLOS, updateFogOfWar, syncVisitedBitmap } from './shadowcast.js';

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

const DEFAULT_LOS_RADIUS = 8;

const DIRECTION_ORDER = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const DEFAULT_PATH_MAX_STEPS = 64;

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

  const discoveries = findDiscoveries(lattice, visibleCells, runState, options);
  const interrupt = pickInterrupt(discoveries, options);
  const proximity = computeExplorationProximity(lattice, visibleCells, runState);

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

  for (const spawn of lattice.getEnemySpawns()) {
    if (visibleCells.has(`${spawn.x},${spawn.y}`)) {
      const enemyBit = BigInt(spawn.id);
      if ((defeated & (1n << enemyBit)) === 0n) {
        const key = `${spawn.x},${spawn.y}`;
        const newlyDiscovered = !runState._knownHostiles.has(key);
        discoveries.push({ type: 'hostile', entity: spawn, newlyDiscovered });
        if (newlyDiscovered) runState._knownHostiles.add(key);
      }
    }
  }

  for (const container of lattice.getContainers()) {
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
  for (const spawn of lattice.getEnemySpawns()) {
    const bit = BigInt(spawn.id);
    if ((defeated & (1n << bit)) !== 0n) continue;
    if (!visibleCells.has(`${spawn.x},${spawn.y}`)) continue;
    const dist = Math.max(Math.abs(spawn.x - pos.x), Math.abs(spawn.y - pos.y));
    if (dist < nearestHostile) nearestHostile = dist;
  }

  let nearestContainer = Infinity;
  for (const c of lattice.getContainers()) {
    const bit = BigInt(c.id);
    if ((opened & (1n << bit)) !== 0n) continue;
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