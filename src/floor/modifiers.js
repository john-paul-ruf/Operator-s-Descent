export function applyModifiers(grid, prng, modifierWeights) {
  const weights = modifierWeights || { none: 1 };
  const entries = Object.entries(weights).filter(([k]) => k !== 'none');
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) return grid;

  const numMods = 0 + (prng.next() < 0.3 ? 1 : 0) + (prng.next() < 0.2 ? 1 : 0);
  const applied = new Set();

  for (let i = 0; i < numMods; i++) {
    let roll = prng.nextInt(totalWeight);
    let modId = null;
    for (const [id, w] of entries) {
      roll -= w;
      if (roll < 0) {
        modId = id;
        break;
      }
    }
    if (modId && !applied.has(modId)) {
      applied.add(modId);
      grid = applyModifier(grid, prng, modId);
    }
  }
  return grid;
}

function applyModifier(grid, prng, modId) {
  switch (modId) {
    case 'dense':
      return applyDense(grid, prng);
    case 'sparse':
      return applySparse(grid, prng);
    case 'dangerous':
      return applyDangerous(grid, prng);
    default:
      return grid;
  }
}

function applyDense(grid, prng) {
  const h = grid.length;
  const w = grid[0].length;
  const numWalls = 15 + prng.nextInt(10);
  for (let i = 0; i < numWalls; i++) {
    const x = prng.nextInt(w - 2) + 1;
    const y = prng.nextInt(h - 2) + 1;
    if (grid[y][x] === 1) grid[y][x] = 0;
  }
  return grid;
}

function applySparse(grid, prng) {
  const h = grid.length;
  const w = grid[0].length;
  const numRemovals = 10 + prng.nextInt(8);
  for (let i = 0; i < numRemovals; i++) {
    const x = prng.nextInt(w - 2) + 1;
    const y = prng.nextInt(h - 2) + 1;
    if (grid[y][x] === 0) grid[y][x] = 1;
  }
  return grid;
}

function applyDangerous(grid, prng) {
  grid = applyDense(grid, prng);
  const h = grid.length;
  const w = grid[0].length;
  const numPits = 5 + prng.nextInt(5);
  for (let i = 0; i < numPits; i++) {
    const x = prng.nextInt(w - 2) + 1;
    const y = prng.nextInt(h - 2) + 1;
    if (grid[y][x] === 1) grid[y][x] = 0;
  }
  return grid;
}