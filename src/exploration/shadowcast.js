const W = 20;

export function computeLOS(lattice, originX, originY, radius) {
  const visible = new Set();
  visible.add(`${originX},${originY}`);

  const numRays = Math.max(8, radius * 8);
  for (let i = 0; i < numRays; i++) {
    const angle = (i / numRays) * 2 * Math.PI;
    const stepX = Math.cos(angle);
    const stepY = Math.sin(angle);
    let x = originX + 0.5;
    let y = originY + 0.5;

    for (let step = 0; step < radius; step++) {
      x += stepX;
      y += stepY;
      const cx = Math.floor(x);
      const cy = Math.floor(y);

      if (cx < 0 || cx >= lattice.getWidth() || cy < 0 || cy >= lattice.getHeight()) break;

      visible.add(`${cx},${cy}`);

      if (lattice.isWall(cx, cy)) break;
    }
  }

  return visible;
}

export function updateFogOfWar(fogState, visibleCells) {
  for (let i = 0; i < fogState.length; i++) {
    if (fogState[i] === 2) {
      const x = i % W;
      const y = Math.floor(i / W);
      if (!visibleCells.has(`${x},${y}`)) {
        fogState[i] = 1;
      }
    }
  }

  for (const cell of visibleCells) {
    const [x, y] = cell.split(',').map(Number);
    const idx = y * W + x;
    if (idx >= 0 && idx < fogState.length) {
      fogState[idx] = 2;
    }
  }
}