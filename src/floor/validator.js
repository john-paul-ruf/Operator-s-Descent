function isOpenCell(v) {
  return v === 1 || v === 2 || v === 3;
}

function floodFill(grid, startX, startY) {
  const h = grid.length;
  const w = grid[0].length;
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));
  const queue = [[startX, startY]];
  visited[startY][startX] = true;
  let count = 0;

  while (queue.length > 0) {
    const [x, y] = queue.shift();
    count++;
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx] && isOpenCell(grid[ny][nx])) {
        visited[ny][nx] = true;
        queue.push([nx, ny]);
      }
    }
  }
  return { visited, count };
}

function findFirstOpen(grid) {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[0].length; x++) {
      if (isOpenCell(grid[y][x])) return { x, y };
    }
  }
  return null;
}

function countOpenCells(grid) {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (isOpenCell(cell)) count++;
    }
  }
  return count;
}

function countLoops(grid) {
  let loopPoints = 0;
  for (let y = 1; y < grid.length - 1; y++) {
    for (let x = 1; x < grid[0].length - 1; x++) {
      if (isOpenCell(grid[y][x])) {
        let openNeighbors = 0;
        if (isOpenCell(grid[y-1][x])) openNeighbors++;
        if (isOpenCell(grid[y+1][x])) openNeighbors++;
        if (isOpenCell(grid[y][x-1])) openNeighbors++;
        if (isOpenCell(grid[y][x+1])) openNeighbors++;
        if (openNeighbors >= 3) loopPoints++;
      }
    }
  }
  return loopPoints;
}

function maxOpenArea(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));
  let maxSize = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isOpenCell(grid[y][x]) && !visited[y][x]) {
        let size = 0;
        const queue = [[x, y]];
        visited[y][x] = true;
        while (queue.length > 0) {
          const [cx, cy] = queue.shift();
          size++;
          const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx] && isOpenCell(grid[ny][nx])) {
              visited[ny][nx] = true;
              queue.push([nx, ny]);
            }
          }
        }
        maxSize = Math.max(maxSize, size);
      }
    }
  }
  return maxSize;
}

export function validateFloor(floor) {
  const failures = [];
  const grid = floor.cells;

  const start = findFirstOpen(grid);
  if (!start) {
    return { valid: false, failures: ['no-floor-cells'] };
  }

  const { visited, count } = floodFill(grid, start.x, start.y);
  const totalOpen = countOpenCells(grid);
  if (count < totalOpen) {
    failures.push('connectivity');
  }

  const loops = countLoops(grid);
  if (loops < 3 && totalOpen > 50) {
    failures.push('loop-density');
  }

  const openArea = maxOpenArea(grid);
  if (openArea > 200) {
    failures.push('open-cell-bounds');
  }

  if (floor.descentPoint) {
    const dp = floor.descentPoint;
    if (dp.y >= 0 && dp.y < grid.length && dp.x >= 0 && dp.x < grid[0].length) {
      if (!isOpenCell(grid[dp.y][dp.x]) || !visited[dp.y][dp.x]) {
        failures.push('descent-reachability');
      }
    } else {
      failures.push('descent-reachability');
    }
  } else {
    failures.push('descent-reachability');
  }

  if (floor.containers && floor.containers.length > 0) {
    for (const container of floor.containers) {
      if (container.y >= 0 && container.y < grid.length && container.x >= 0 && container.x < grid[0].length) {
        if (!isOpenCell(grid[container.y][container.x]) || !visited[container.y][container.x]) {
          failures.push('container-accessibility');
          break;
        }
      }
    }
  }

  if (totalOpen > 100 && openArea < 40 && loops < 2) {
    failures.push('interior-cover');
  }

  return { valid: failures.length === 0, failures };
}