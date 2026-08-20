function isOpenCell(v) {
  return v === 1 || v === 2 || v === 3;
}

function floodFill(grid, startX, startY) {
  const h = grid.length;
  const w = grid[0].length;
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));
  const stack = [[startX, startY]];
  visited[startY][startX] = true;
  let count = 0;

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    count++;
    if (grid[y - 1]?.[x] >= 1 && !visited[y - 1]?.[x]) { visited[y - 1][x] = true; stack.push([x, y - 1]); }
    if (grid[y + 1]?.[x] >= 1 && !visited[y + 1]?.[x]) { visited[y + 1][x] = true; stack.push([x, y + 1]); }
    if (grid[y]?.[x - 1] >= 1 && !visited[y]?.[x - 1]) { visited[y][x - 1] = true; stack.push([x - 1, y]); }
    if (grid[y]?.[x + 1] >= 1 && !visited[y]?.[x + 1]) { visited[y][x + 1] = true; stack.push([x + 1, y]); }
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

// Count open cells whose only two open orthogonal neighbors are collinear
// (N+S or E+W). Those cells are the "throat" of a 1-cell-wide corridor.
// Exported so callers (e.g. src/rules/encounters.js) can reuse the same
// definition; kept in the floor layer as the source of truth.
export function countOneWideCorridors(grid) {
  const h = grid.length;
  const w = grid[0].length;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isOpenCell(grid[y][x])) continue;
      const openN = isOpenCell(grid[y - 1]?.[x]);
      const openS = isOpenCell(grid[y + 1]?.[x]);
      const openW = isOpenCell(grid[y]?.[x - 1]);
      const openE = isOpenCell(grid[y]?.[x + 1]);
      const total = (openN ? 1 : 0) + (openS ? 1 : 0) + (openW ? 1 : 0) + (openE ? 1 : 0);
      if (total === 2 && ((openN && openS) || (openE && openW))) count++;
    }
  }
  return count;
}

// Maximum number of 1-wide corridor tiles a candidate floor may contain
// before the `corridor-width` check rejects it. The repair-fallback path
// in src/floor/generator.js is exempt so the generator always terminates.
// Area-proportional to keep the same ~1.9% ceiling at 40x64 (2560 cells).
export const MAX_ONE_WIDE_CORRIDOR = 48;

function maxOpenArea(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const visited = Array.from({ length: h }, () => new Array(w).fill(false));
  let maxSize = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isOpenCell(grid[y][x]) && !visited[y][x]) {
        let size = 0;
        const stack = [[x, y]];
        visited[y][x] = true;
        while (stack.length > 0) {
          const [cx, cy] = stack.pop();
          size++;
          if (grid[cy - 1]?.[cx] >= 1 && !visited[cy - 1]?.[cx]) { visited[cy - 1][cx] = true; stack.push([cx, cy - 1]); }
          if (grid[cy + 1]?.[cx] >= 1 && !visited[cy + 1]?.[cx]) { visited[cy + 1][cx] = true; stack.push([cx, cy + 1]); }
          if (grid[cy]?.[cx - 1] >= 1 && !visited[cy]?.[cx - 1]) { visited[cy][cx - 1] = true; stack.push([cx - 1, cy]); }
          if (grid[cy]?.[cx + 1] >= 1 && !visited[cy]?.[cx + 1]) { visited[cy][cx + 1] = true; stack.push([cx + 1, cy]); }
        }
        maxSize = Math.max(maxSize, size);
      }
    }
  }
  return maxSize;
}

export function validateFloor(floor) {
  const failures = [];
  const metrics = {};
  const grid = floor.cells;

  const start = findFirstOpen(grid);
  if (!start) {
    return { valid: false, failures: ['no-floor-cells'], metrics: { openCells: 0, connectedCells: 0, loops: 0, maxRegion: 0 } };
  }

  const { visited, count } = floodFill(grid, start.x, start.y);
  const totalOpen = countOpenCells(grid);
  metrics.openCells = totalOpen;
  metrics.connectedCells = count;

  if (count < totalOpen) {
    failures.push('connectivity');
  }

  const loops = countLoops(grid);
  metrics.loops = loops;
  // Cell-count thresholds scale with area (20x32=640 → 40x64=2560, x4).
  if (loops < 3 && totalOpen > 200) {
    failures.push('loop-density');
  }

  const openArea = maxOpenArea(grid);
  metrics.maxRegion = openArea;
  // At 40x64 (2560 cells) allow up to ~59% of grid in one connected region;
  // chambers-style archetypes naturally merge rooms into large sprawls.
  if (openArea > 1500) {
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
      } else {
        failures.push('container-accessibility');
        break;
      }
    }
  }

  if (totalOpen > 400 && openArea < 240 && loops < 2) {
    failures.push('interior-cover');
  }

  const oneWide = countOneWideCorridors(grid);
  metrics.oneWideCorridors = oneWide;
  if (oneWide > MAX_ONE_WIDE_CORRIDOR) {
    failures.push('corridor-width');
  }

  return { valid: failures.length === 0, failures, metrics };
}