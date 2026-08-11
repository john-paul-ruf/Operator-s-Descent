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

  const discoveries = findDiscoveries(lattice, visibleCells, runState);
  const interrupt = pickInterrupt(discoveries, options);
  const proximity = computeProximity(lattice, visibleCells, runState);

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

function findDiscoveries(lattice, visibleCells, runState) {
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
    discoveries.push({ type: 'damage', entity: null, newlyDiscovered: true });
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

function computeProximity(lattice, visibleCells, runState) {
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