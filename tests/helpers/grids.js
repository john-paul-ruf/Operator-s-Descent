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
