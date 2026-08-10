const GRID_W = 20;
const GRID_H = 32;

export const ARCHETYPES = {
  chambers: generateChambers,
  caves: generateCaves,
  maze: generateMaze,
  open: generateOpen,
  organic: generateOrganic,
  bastion: generateBastion,
  lattice: generateLattice,
  ruin: generateRuin
};

export { GRID_W, GRID_H };

function createGrid(fill = 0) {
  const grid = new Array(GRID_H);
  for (let y = 0; y < GRID_H; y++) {
    grid[y] = new Array(GRID_W).fill(fill);
  }
  return grid;
}

function carveRoom(grid, x, y, w, h, value = 1) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cy = y + dy;
      const cx = x + dx;
      if (cy >= 0 && cy < GRID_H && cx >= 0 && cx < GRID_W) {
        grid[cy][cx] = value;
      }
    }
  }
}

function carveCorridor(grid, x1, y1, x2, y2, value = 1) {
  let x = x1, y = y1;
  while (x !== x2 || y !== y2) {
    if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) grid[y][x] = value;
    if (x === x2) {
      y += y2 > y ? 1 : -1;
    } else {
      x += x2 > x ? 1 : -1;
    }
  }
  if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) grid[y][x] = value;
}

export function generateChambers(prng) {
  const grid = createGrid();
  const numRooms = 4 + prng.nextInt(5);
  const rooms = [];

  for (let i = 0; i < numRooms; i++) {
    const w = 3 + prng.nextInt(4);
    const h = 3 + prng.nextInt(4);
    const x = prng.nextInt(GRID_W - w);
    const y = prng.nextInt(GRID_H - h);
    carveRoom(grid, x, y, w, h);
    rooms.push({ x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) });
  }

  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1];
    const b = rooms[i];
    carveCorridor(grid, a.x, a.y, b.x, b.y);
  }
  return grid;
}

export function generateCaves(prng) {
  let grid = createGrid();
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      grid[y][x] = prng.next() < 0.45 ? 1 : 0;
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = createGrid();
    for (let y = 1; y < GRID_H - 1; y++) {
      for (let x = 1; x < GRID_W - 1; x++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (grid[y + dy][x + dx] === 1) neighbors++;
          }
        }
        next[y][x] = neighbors >= 5 ? 1 : 0;
      }
    }
    grid = next;
  }
  return grid;
}

export function generateMaze(prng) {
  const grid = createGrid();
  const stack = [];
  const startX = 1, startY = 1;
  grid[startY][startX] = 1;
  stack.push({ x: startX, y: startY });

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const dirs = [[0,-2],[2,0],[0,2],[-2,0]];
    const neighbors = [];

    for (const [dx, dy] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx > 0 && nx < GRID_W - 1 && ny > 0 && ny < GRID_H - 1 && grid[ny][nx] === 0) {
        neighbors.push({ x: nx, y: ny, mx: current.x + dx / 2, my: current.y + dy / 2 });
      }
    }

    if (neighbors.length > 0) {
      const next = neighbors[prng.nextInt(neighbors.length)];
      grid[next.my][next.mx] = 1;
      grid[next.y][next.x] = 1;
      stack.push({ x: next.x, y: next.y });
    } else {
      stack.pop();
    }
  }
  for (let i = 0; i < 4; i++) {
    const x = prng.nextInt(GRID_W - 2) + 1;
    const y = prng.nextInt(GRID_H - 2) + 1;
    grid[y][x] = 1;
  }
  return grid;
}

export function generateOpen(prng) {
  const grid = createGrid();
  for (let y = 2; y < GRID_H - 2; y++) {
    for (let x = 2; x < GRID_W - 2; x++) {
      grid[y][x] = 1;
    }
  }
  const numPillars = 6 + prng.nextInt(8);
  for (let i = 0; i < numPillars; i++) {
    const x = 3 + prng.nextInt(GRID_W - 6);
    const y = 3 + prng.nextInt(GRID_H - 6);
    const w = 1 + prng.nextInt(2);
    const h = 1 + prng.nextInt(2);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (y + dy < GRID_H - 1 && x + dx < GRID_W - 1) grid[y + dy][x + dx] = 0;
      }
    }
  }
  return grid;
}

export function generateOrganic(prng) {
  const grid = createGrid();
  const numSeeds = 6 + prng.nextInt(4);
  const seeds = [];

  for (let i = 0; i < numSeeds; i++) {
    const x = prng.nextInt(GRID_W);
    const y = prng.nextInt(GRID_H);
    seeds.push({ x, y });
    grid[y][x] = 1;
  }

  for (let i = 0; i < 100; i++) {
    const seed = seeds[prng.nextInt(seeds.length)];
    const dx = prng.nextInt(3) - 1;
    const dy = prng.nextInt(3) - 1;
    const nx = seed.x + dx;
    const ny = seed.y + dy;
    if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
      grid[ny][nx] = 1;
      if (prng.next() < 0.3) {
        seed.x = nx;
        seed.y = ny;
      }
    }
  }
  return grid;
}

export function generateBastion(prng) {
  const grid = createGrid();
  const roomH = Math.floor(GRID_H / 4);
  for (let row = 0; row < 4; row++) {
    const yStart = row * roomH;
    for (let col = 0; col < 2; col++) {
      const xStart = col * Math.floor(GRID_W / 2);
      const roomW = Math.floor(GRID_W / 2);
      carveRoom(grid, xStart + 1, yStart + 1, roomW - 2, roomH - 2);
    }
  }
  const midX = Math.floor(GRID_W / 2);
  const midY = Math.floor(GRID_H / 2);
  for (let y = 0; y < GRID_H; y++) grid[y][midX] = 1;
  for (let x = 0; x < GRID_W; x++) grid[midY][x] = 1;
  for (let i = 0; i < 3; i++) {
    const x = prng.nextInt(GRID_W - 2) + 1;
    const y = prng.nextInt(GRID_H - 2) + 1;
    grid[y][x] = 0;
  }
  return grid;
}

export function generateLattice(prng) {
  const grid = createGrid();
  for (let y = 1; y < GRID_H - 1; y++) {
    for (let x = 1; x < GRID_W - 1; x++) {
      grid[y][x] = 1;
    }
  }
  const colSpacing = 4;
  const rowSpacing = 5;
  for (let y = 2; y < GRID_H - 2; y += rowSpacing) {
    for (let x = 2; x < GRID_W - 2; x += colSpacing) {
      grid[y][x] = 0;
      if (y + 1 < GRID_H - 1) grid[y + 1][x] = 0;
      if (x + 1 < GRID_W - 1) grid[y][x + 1] = 0;
    }
  }
  return grid;
}

export function generateRuin(prng) {
  const grid = generateChambers(prng);
  const numRemovals = 20 + prng.nextInt(15);
  for (let i = 0; i < numRemovals; i++) {
    const x = prng.nextInt(GRID_W);
    const y = prng.nextInt(GRID_H);
    if (grid[y][x] === 1 && prng.next() < 0.4) {
      grid[y][x] = 0;
    }
  }
  for (let i = 0; i < 10; i++) {
    const x = prng.nextInt(GRID_W - 2) + 1;
    const y = prng.nextInt(GRID_H - 2) + 1;
    if (grid[y][x] === 0) grid[y][x] = 1;
  }
  return grid;
}