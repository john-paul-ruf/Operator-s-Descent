import { GRID_W, GRID_H } from '../floor/archetypes.js';

const CELLS = GRID_W * GRID_H;

const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1]
];

export function computeLOS(lattice, originX, originY, radius) {
  const visible = new Set();
  visible.add(`${originX},${originY}`);

  if (radius <= 0) return visible;

  const w = lattice.getWidth();
  const h = lattice.getHeight();

  for (let oct = 0; oct < 8; oct++) {
    const xx = MULT[0][oct];
    const xy = MULT[1][oct];
    const yx = MULT[2][oct];
    const yy = MULT[3][oct];
    castLight(lattice, originX, originY, 1, 1.0, 0.0, radius, xx, xy, yx, yy, visible, w, h);
  }

  return visible;
}

function castLight(lattice, cx, cy, row, start, end, radius, xx, xy, yx, yy, visible, w, h) {
  if (start < end) return;
  if (row > radius) return;

  const r2 = radius * radius;
  let nextStart = start;
  let blocked = false;

  for (let j = row; j <= radius; j++) {
    let dx = -j - 1;
    const dy = -j;
    let localBlocked = false;

    while (dx <= 0) {
      const X = cx + dx * xx + dy * xy;
      const Y = cy + dx * yx + dy * yy;

      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);

      if (start < rSlope) {
        dx++;
        continue;
      } else if (end > lSlope) {
        break;
      }

      if (dx * dx + dy * dy <= r2) {
        if (X >= 0 && X < w && Y >= 0 && Y < h) {
          visible.add(`${X},${Y}`);
        }
      }

      const isWall = (X < 0 || X >= w || Y < 0 || Y >= h) || lattice.isWall(X, Y);

      if (blocked) {
        if (isWall) {
          nextStart = rSlope;
          dx++;
          continue;
        } else {
          blocked = false;
          start = nextStart;
        }
      } else if (isWall && j < radius) {
        blocked = true;
        castLight(lattice, cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy, visible, w, h);
        nextStart = rSlope;
      }

      dx++;
    }

    if (blocked) break;
    start = nextStart;
  }
}

export function createFogState(visitedBitmap, visibleCells) {
  const fog = new Uint8Array(CELLS);
  if (visitedBitmap) {
    for (let i = 0; i < CELLS; i++) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      if (byteIdx < visitedBitmap.length && (visitedBitmap[byteIdx] & (1 << bitIdx))) {
        fog[i] = 1;
      }
    }
  }
  if (visibleCells) {
    for (const key of visibleCells) {
      const [x, y] = key.split(',').map(Number);
      const idx = y * GRID_W + x;
      if (idx >= 0 && idx < CELLS) {
        fog[idx] = 2;
      }
    }
  }
  return fog;
}

export function updateFogOfWar(fogState, visibleCells) {
  for (let i = 0; i < fogState.length; i++) {
    if (fogState[i] === 2) {
      const x = i % GRID_W;
      const y = Math.floor(i / GRID_W);
      if (!visibleCells.has(`${x},${y}`)) {
        fogState[i] = 1;
      }
    }
  }

  for (const cell of visibleCells) {
    const [x, y] = cell.split(',').map(Number);
    const idx = y * GRID_W + x;
    if (idx >= 0 && idx < fogState.length) {
      fogState[idx] = 2;
    }
  }
}

export function syncVisitedBitmap(fogState, visitedBitmap) {
  for (let i = 0; i < fogState.length; i++) {
    if (fogState[i] > 0) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      if (byteIdx < visitedBitmap.length) {
        visitedBitmap[byteIdx] |= (1 << bitIdx);
      }
    }
  }
}