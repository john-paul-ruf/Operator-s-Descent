import { computeLOS, updateFogOfWar } from './shadowcast.js';

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
  if (runState && runState.markCellVisited) {
    runState.markCellVisited(newX, newY);
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

  const interrupt = checkInterrupts(lattice, visibleCells, runState, options);

  tickDangerClock(runState, 1);

  return {
    moved: true,
    interruptType: interrupt?.type || null,
    discoveredEntity: interrupt?.entity || null,
    visibleCells
  };
}

export function tickDangerClock(runState, stepCount) {
  if (!runState || !runState.getDangerClockRate) return { huntTriggered: false };

  const baseRate = runState.getDangerClockRate();
  const depth = runState.depth || 1;
  const scaledRate = baseRate * (1 + depth * 0.05);
  runState.dangerClockProgress += scaledRate * stepCount;

  if (runState.dangerClockProgress >= 1.0) {
    runState.dangerClockProgress = 0;
    return { huntTriggered: true, huntData: { type: 'hunt', depth: runState.depth } };
  }
  return { huntTriggered: false };
}

function checkInterrupts(lattice, visibleCells, runState, options) {
  const containers = lattice.getContainers();
  const enemySpawns = lattice.getEnemySpawns();
  const descentPoint = lattice.getDescentPoint();
  const defeated = runState?.defeatedEnemies || 0n;
  const opened = runState?.openedContainers || 0n;

  for (const spawn of enemySpawns) {
    if (visibleCells.has(`${spawn.x},${spawn.y}`)) {
      const enemyBit = BigInt(spawn.id);
      if ((defeated & (1n << enemyBit)) === 0n) {
        return { type: 'hostile', entity: spawn };
      }
    }
  }

  for (const container of containers) {
    if (visibleCells.has(`${container.x},${container.y}`)) {
      const containerBit = BigInt(container.id);
      if ((opened & (1n << containerBit)) === 0n) {
        return { type: 'container', entity: container };
      }
    }
  }

  if (descentPoint && visibleCells.has(`${descentPoint.x},${descentPoint.y}`)) {
    return { type: 'descent', entity: descentPoint };
  }

  return null;
}