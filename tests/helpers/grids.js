export function makeGrid(w, h, fill = 0) {
  const grid = new Array(h);
  for (let y = 0; y < h; y++) {
    grid[y] = new Array(w).fill(fill);
  }
  return grid;
}

export function carve(grid, x, y, w, h, v = 1) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cy = y + dy;
      const cx = x + dx;
      if (cy >= 0 && cy < grid.length && cx >= 0 && cx < grid[0].length) {
        grid[cy][cx] = v;
      }
    }
  }
}

export function openCount(grid) {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell === 1 || cell === 2 || cell === 3) count++;
    }
  }
  return count;
}

export function reachable(grid, sx, sy) {
  const h = grid.length;
  const w = grid[0].length;
  const visited = new Set();
  const queue = [[sx, sy]];
  visited.add(`${sx},${sy}`);
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited.has(`${nx},${ny}`) &&
          (grid[ny][nx] === 1 || grid[ny][nx] === 2 || grid[ny][nx] === 3)) {
        visited.add(`${nx},${ny}`);
        queue.push([nx, ny]);
      }
    }
  }
  return visited;
}

export function reshapeFloor() {
  const cells = makeGrid(7, 7, 1);
  carve(cells, 2, 2, 3, 3, 0);
  return {
    cells,
    startPoint: { x: 0, y: 0 },
    descentPoint: { x: 6, y: 6 },
    containers: [{ x: 6, y: 0 }]
  };
}

export function corridorReshapeFloor() {
  const cells = makeGrid(7, 7, 0);
  carve(cells, 0, 3, 7, 1);
  return {
    cells,
    startPoint: { x: 0, y: 3 },
    descentPoint: { x: 6, y: 3 },
    containers: [{ x: 6, y: 3 }]
  };
}

// A wide-open floor big enough that createStandardEncounter's 8x16 contact window fits entirely inside it,
// so deployment bands can reach the full 9-12 cell separation target.
export function contactWindowFloor() {
  const cells = makeGrid(24, 24, 1);
  return { cells, startPoint: { x: 0, y: 0 }, descentPoint: { x: 23, y: 23 }, containers: [] };
}

// A fully open 8x16 combat window (matches createStandardEncounter's fixed size), no walls.
export function openCombatWindow() {
  return { originX: 0, originY: 0, width: 8, height: 16, cells: makeGrid(8, 16, 1) };
}

// An 8x16 combat window (matches createStandardEncounter's fixed size). An actor standing at (0,0)
// has both orthogonal neighbors of a diagonal step to (1,1) walled off, so the corner rule must
// reject that diagonal move even though (1,1) itself is open.
export function blockedCornerWindow() {
  const cells = makeGrid(8, 16, 1);
  cells[0][1] = 0; // (1,0): the horizontal neighbor on the way from (0,0) to (1,1)
  cells[1][0] = 0; // (0,1): the vertical neighbor on the way from (0,0) to (1,1)
  return { originX: 0, originY: 0, width: 8, height: 16, cells };
}
