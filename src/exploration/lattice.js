export const CELL = { WALL: 0, OPEN: 1, CONTAINER: 2, DESCENT: 3 };

function findFirstOpenCell(grid, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] !== CELL.WALL) return { x, y };
    }
  }
  return null;
}

export function createLattice(floor, savedDiff = null) {
  const grid = floor.cells || floor.grid;
  const width = grid[0]?.length || 20;
  const height = grid.length || 32;
  const containers = floor.containers || [];
  const enemySpawns = floor.enemySpawns || [];
  const descentPoint = floor.descentPoint || null;
  const entryPoint = floor.entryPoint || { x: Math.floor(width / 2), y: 0 };

  let partyPos;

  if (savedDiff && savedDiff.partyPosition &&
      savedDiff.partyPosition.x >= 0 && savedDiff.partyPosition.x < width &&
      savedDiff.partyPosition.y >= 0 && savedDiff.partyPosition.y < height &&
      grid[savedDiff.partyPosition.y][savedDiff.partyPosition.x] !== CELL.WALL) {
    partyPos = { ...savedDiff.partyPosition };
  } else if (entryPoint.x >= 0 && entryPoint.x < width &&
             entryPoint.y >= 0 && entryPoint.y < height &&
             grid[entryPoint.y][entryPoint.x] !== CELL.WALL) {
    partyPos = { ...entryPoint };
  } else {
    partyPos = findFirstOpenCell(grid, width, height) || { ...entryPoint };
  }

  const openedContainers = savedDiff?.openedContainers ?? 0n;
  const defeatedEnemies = savedDiff?.defeatedEnemies ?? 0n;

  function isContainerOpened(id) {
    return (openedContainers & (1n << BigInt(id))) !== 0n;
  }

  function isEnemyDefeated(id) {
    return (defeatedEnemies & (1n << BigInt(id))) !== 0n;
  }

  function getActiveContainers() {
    return containers.filter(c => !isContainerOpened(c.id));
  }

  function getActiveEnemySpawns() {
    return enemySpawns.filter(e => !isEnemyDefeated(e.id));
  }

  return {
    getCell(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return { type: CELL.WALL, x, y };
      return { type: grid[y][x], x, y };
    },
    isWalkable(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return grid[y][x] !== CELL.WALL;
    },
    isWall(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return true;
      return grid[y][x] === CELL.WALL;
    },
    isOpaque(x, y) {
      return this.isWall(x, y);
    },
    isOccupied(x, y) {
      if (x === partyPos.x && y === partyPos.y) return true;
      for (const e of getActiveEnemySpawns()) {
        if (e.x === x && e.y === y) return true;
      }
      return false;
    },
    setPartyPosition(x, y) { partyPos = { x, y }; },
    getPartyPosition() { return { ...partyPos }; },
    getWidth() { return width; },
    getHeight() { return height; },
    getGrid() { return grid; },
    getContainers() { return containers; },
    getEnemySpawns() { return enemySpawns; },
    getActiveContainers,
    getActiveEnemySpawns,
    getDescentPoint() { return descentPoint; },
    getEntryPoint() { return entryPoint; },
    isContainerOpened,
    isEnemyDefeated
  };
}