const GRID_W = 20;
const GRID_H = 32;

export const ARCHETYPES = {
  chambers: generateChambers,
  caves: generateCaves,
  mazes: generateMazes,
  cathedrals: generateCathedrals,
  spines: generateSpines,
  fractured: generateFractured,
  rings: generateRings,
  shards: generateShards
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
  const numRooms = 5 + prng.nextInt(4);
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

export function generateMazes(prng) {
  const grid = createGrid();
  const numRegions = 2 + prng.nextInt(2);
  const regions = [];
  for (let r = 0; r < numRegions; r++) {
    const regionW = 6 + prng.nextInt(6);
    const regionH = 8 + prng.nextInt(8);
    const rx = prng.nextInt(GRID_W - regionW);
    const ry = prng.nextInt(GRID_H - regionH);
    regions.push({ rx, ry, regionW, regionH });
  }
  for (const { rx, ry, regionW, regionH } of regions) {
    if (regionW < 4 || regionH < 4) continue;
    const stack = [];
    const startX = rx + 1, startY = ry + 1;
    if (grid[startY] && grid[startY][startX] === 0) {
      grid[startY][startX] = 1;
      stack.push({ x: startX, y: startY });
    }
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const dirs = [[0,-2],[2,0],[0,2],[-2,0]];
      const neighbors = [];
      for (const [dx, dy] of dirs) {
        const nx = current.x + dx;
        const ny = current.y + dy;
        if (nx > rx && nx < rx + regionW - 1 && ny > ry && ny < ry + regionH - 1 && grid[ny] && grid[ny][nx] === 0) {
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
  }
  for (let i = 1; i < regions.length; i++) {
    const a = regions[i - 1];
    const b = regions[i];
    const ax = a.rx + Math.floor(a.regionW / 2);
    const ay = a.ry + Math.floor(a.regionH / 2);
    const bx = b.rx + Math.floor(b.regionW / 2);
    const by = b.ry + Math.floor(b.regionH / 2);
    carveCorridor(grid, ax, ay, bx, by);
  }
  return grid;
}

export function generateCathedrals(prng) {
  const grid = createGrid();
  const roomH = Math.floor(GRID_H / 4);
  const roomW = Math.floor(GRID_W / 2);
  const rooms = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      const xPadding = 2 + prng.nextInt(2);
      const yPadding = 2 + prng.nextInt(2);
      const w = roomW - xPadding - 3 - prng.nextInt(2);
      const h = roomH - yPadding - 3 - prng.nextInt(2);
      if (w < 2 || h < 1) continue;
      const xStart = col * roomW + xPadding;
      const yStart = row * roomH + yPadding;
      carveRoom(grid, xStart, yStart, w, h);
      rooms.push({ x: xStart + Math.floor(w / 2), y: yStart + Math.floor(h / 2) });
    }
  }
  const midX = Math.floor(GRID_W / 2);
  for (let row = 0; row < 4; row++) {
    const y = row * roomH;
    if (row > 0) for (let x = 1; x < GRID_W - 1; x++) grid[y][x] = 0;
  }
  const numPillars = 8 + prng.nextInt(8);
  for (let i = 0; i < numPillars; i++) {
    const room = rooms[prng.nextInt(rooms.length)];
    if (!room) continue;
    const dx = prng.nextInt(3) - 1;
    const dy = prng.nextInt(3) - 1;
    const x = Math.max(1, Math.min(GRID_W - 2, room.x + dx));
    const y = Math.max(1, Math.min(GRID_H - 2, room.y + dy));
    if (x !== midX) grid[y][x] = 0;
  }
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(grid, rooms[i - 1].x, rooms[i - 1].y, rooms[i].x, rooms[i].y);
  }
  return grid;
}

export function generateSpines(prng) {
  const grid = createGrid();
  const numSpines = 2 + prng.nextInt(2);
  const spinePaths = [];
  for (let s = 0; s < numSpines; s++) {
    let x = 2 + prng.nextInt(GRID_W - 4);
    const spineCells = [];
    let y = 1;
    while (y < GRID_H - 1) {
      grid[y][x] = 1;
      spineCells.push({ x, y });
      const drift = prng.nextInt(3) - 1;
      const nx = Math.max(1, Math.min(GRID_W - 2, x + drift));
      if (nx !== x) {
        const step = nx > x ? 1 : -1;
        for (let cx = x + step; cx !== nx + step; cx += step) {
          grid[y][cx] = 1;
          spineCells.push({ x: cx, y });
        }
      }
      x = nx;
      y++;
    }
    spinePaths.push(spineCells);
  }
  for (let s = 0; s < spinePaths.length; s++) {
    for (let s2 = s + 1; s2 < spinePaths.length; s2++) {
      const c1 = spinePaths[s][Math.floor(spinePaths[s].length / 2)];
      const c2 = spinePaths[s2][Math.floor(spinePaths[s2].length / 2)];
      carveCorridor(grid, c1.x, c1.y, c2.x, c1.y);
    }
  }
  const numRooms = 4 + prng.nextInt(4);
  const roomCenters = [];
  for (let i = 0; i < numRooms; i++) {
    const w = 3 + prng.nextInt(3);
    const h = 3 + prng.nextInt(3);
    const x = prng.nextInt(GRID_W - w);
    const y = prng.nextInt(GRID_H - h);
    carveRoom(grid, x, y, w, h);
    roomCenters.push({ x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) });
  }
  for (const center of roomCenters) {
    let nearestCell = null;
    let nearestDist = Infinity;
    for (const path of spinePaths) {
      for (const cell of path) {
        const d = Math.abs(center.x - cell.x) + Math.abs(center.y - cell.y);
        if (d < nearestDist) { nearestDist = d; nearestCell = cell; }
      }
    }
    if (nearestCell) carveCorridor(grid, center.x, center.y, nearestCell.x, nearestCell.y);
  }
  return grid;
}

export function generateFractured(prng) {
  const grid = createGrid();
  const splitX = Math.floor(GRID_W / 2) + prng.nextInt(4) - 2;
  const leftRooms = 2 + prng.nextInt(2);
  const rightRooms = 2 + prng.nextInt(2);
  const leftCenters = [];
  const rightCenters = [];
  for (let i = 0; i < leftRooms; i++) {
    const w = 2 + prng.nextInt(3);
    const h = 3 + prng.nextInt(4);
    const x = prng.nextInt(Math.max(1, splitX - 2 - w));
    const y = prng.nextInt(GRID_H - h);
    carveRoom(grid, x, y, w, h);
    leftCenters.push({ x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) });
  }
  for (let i = 0; i < rightRooms; i++) {
    const w = 2 + prng.nextInt(3);
    const h = 3 + prng.nextInt(4);
    const x = splitX + 2 + prng.nextInt(Math.max(1, GRID_W - splitX - 3 - w));
    const y = prng.nextInt(GRID_H - h);
    carveRoom(grid, x, y, w, h);
    rightCenters.push({ x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) });
  }
  for (let i = 1; i < leftCenters.length; i++) {
    carveCorridor(grid, leftCenters[i - 1].x, leftCenters[i - 1].y, leftCenters[i].x, leftCenters[i].y);
  }
  for (let i = 1; i < rightCenters.length; i++) {
    carveCorridor(grid, rightCenters[i - 1].x, rightCenters[i - 1].y, rightCenters[i].x, rightCenters[i].y);
  }
  const numBridges = 2 + prng.nextInt(3);
  for (let i = 0; i < numBridges; i++) {
    const leftIdx = prng.nextInt(leftCenters.length);
    const rightIdx = prng.nextInt(rightCenters.length);
    const bridgeY = leftCenters[leftIdx].y;
    carveCorridor(grid, leftCenters[leftIdx].x, bridgeY, rightCenters[rightIdx].x, bridgeY);
  }
  return grid;
}

export function generateRings(prng) {
  const grid = createGrid();
  const centerY = Math.floor(GRID_H / 2);
  const numRings = 3 + prng.nextInt(2);
  const ringSpacing = Math.floor(GRID_H / (numRings + 1));
  const ringCenters = [];
  for (let r = 0; r < numRings; r++) {
    const ry = ringSpacing * (r + 1);
    ringCenters.push({ y: ry, x: Math.floor(GRID_W / 2) });
    const width = 5 + prng.nextInt(4);
    const height = 1;
    const xStart = Math.floor((GRID_W - width) / 2);
    carveRoom(grid, xStart, ry, width, height);
    if (xStart > 1) carveCorridor(grid, xStart - 1, ry, 1, ry);
    if (xStart + width < GRID_W - 1) carveCorridor(grid, xStart + width, ry, GRID_W - 2, ry);
  }
  for (let i = 1; i < ringCenters.length; i++) {
    const a = ringCenters[i - 1];
    const b = ringCenters[i];
    carveCorridor(grid, a.x, a.y, b.x, b.y);
  }
  const numRooms = 3 + prng.nextInt(4);
  const roomCenters = [];
  for (let i = 0; i < numRooms; i++) {
    const w = 3 + prng.nextInt(3);
    const h = 3 + prng.nextInt(3);
    const x = prng.nextInt(GRID_W - w);
    const y = prng.nextInt(GRID_H - h);
    carveRoom(grid, x, y, w, h);
    roomCenters.push({ x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) });
  }
  for (const center of roomCenters) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const rc of ringCenters) {
      const d = Math.abs(center.x - rc.x) + Math.abs(center.y - rc.y);
      if (d < nearestDist) { nearestDist = d; nearest = rc; }
    }
    if (nearest) carveCorridor(grid, center.x, center.y, nearest.x, nearest.y);
  }
  return grid;
}

export function generateShards(prng) {
  const grid = createGrid();
  const numShards = 6 + prng.nextInt(4);
  const shardCenters = [];
  for (let i = 0; i < numShards; i++) {
    const cx = 1 + prng.nextInt(GRID_W - 2);
    const cy = 1 + prng.nextInt(GRID_H - 2);
    const w = 2 + prng.nextInt(2);
    const h = 2 + prng.nextInt(2);
    carveRoom(grid, cx, cy, Math.min(w, GRID_W - cx), Math.min(h, GRID_H - cy));
    shardCenters.push({ x: cx + Math.floor(w / 2), y: cy + Math.floor(h / 2) });
  }
  for (let i = 1; i < shardCenters.length; i++) {
    const a = shardCenters[i - 1];
    const b = shardCenters[i];
    carveCorridor(grid, a.x, a.y, b.x, b.y);
  }
  return grid;
}