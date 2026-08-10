export function createLattice(floor) {
  const grid = floor.cells || floor.grid;
  const width = grid[0]?.length || 20;
  const height = grid.length;
  let partyPos = { x: floor.startX || Math.floor(width / 2), y: floor.startY || 0 };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === 3) {
        partyPos = { x, y: Math.max(0, y - 1) };
        break;
      }
    }
  }

  return {
    getCell(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return { type: 0, x, y };
      return { type: grid[y][x], x, y };
    },
    isWalkable(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return grid[y][x] !== 0;
    },
    isWall(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return true;
      return grid[y][x] === 0;
    },
    setPartyPosition(x, y) { partyPos = { x, y }; },
    getPartyPosition() { return { ...partyPos }; },
    getWidth() { return width; },
    getHeight() { return height; },
    getGrid() { return grid; },
    getContainers() { return floor.containers || []; },
    getEnemySpawns() { return floor.enemySpawns || []; },
    getDescentPoint() { return floor.descentPoint || null; }
  };
}