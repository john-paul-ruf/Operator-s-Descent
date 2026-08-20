import { widenOneWideCorridors } from './archetypes.js';

const MODIFIER_IDS = new Set(['dense', 'sparse', 'dangerous']);

// Modifiers marked TIGHT skip the post-application dilation pass and are allowed
// to leave 1-wide corridors behind. Design intent: at most one wall-adder is
// deliberately narrow; the rest respect the minimum 2-wide floor. `dense` owns
// the tight slot because its whole purpose is to compact passages.
const TIGHT_MODIFIER_IDS = new Set(['dense']);

export function applyModifiers(grid, prng, modifierWeights) {
  const weights = modifierWeights || { none: 1 };
  const entries = Object.entries(weights).filter(([k]) => k !== 'none');
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) return { grid, modifierIds: [] };

  const numMods = (prng.next() < 0.3 ? 1 : 0) + (prng.next() < 0.2 ? 1 : 0);
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
      grid = applyModifier(grid, prng, modId);
      if (MODIFIER_IDS.has(modId)) applied.add(modId);
    }
  }
  return { grid, modifierIds: [...applied] };
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

function countOrthoOpen(grid, x, y) {
  let n = 0;
  if (grid[y - 1]?.[x] >= 1) n++;
  if (grid[y + 1]?.[x] >= 1) n++;
  if (grid[y]?.[x - 1] >= 1) n++;
  if (grid[y]?.[x + 1] >= 1) n++;
  return n;
}

function applyDense(grid, prng) {
  const h = grid.length;
  const w = grid[0].length;
  // Density scales with area: baseline 15-24 candidates at 20x32=640 cells
  // stays ~2-4% wall-additions at any grid size (60-99 at 40x64).
  const areaScale = (w * h) / 640;
  const numWalls = Math.round((15 + prng.nextInt(10)) * areaScale);
  for (let i = 0; i < numWalls; i++) {
    const x = prng.nextInt(w - 2) + 1;
    const y = prng.nextInt(h - 2) + 1;
    if (grid[y][x] === 1 && countOrthoOpen(grid, x, y) >= 4) grid[y][x] = 0;
  }
  // `dense` is TIGHT — skip the dilation pass so its narrowing effect survives.
  return grid;
}

function applySparse(grid, prng) {
  const h = grid.length;
  const w = grid[0].length;
  // Area-proportional to keep the same removal density at any grid size.
  const areaScale = (w * h) / 640;
  const numRemovals = Math.round((10 + prng.nextInt(8)) * areaScale);
  for (let i = 0; i < numRemovals; i++) {
    const x = prng.nextInt(w - 2) + 1;
    const y = prng.nextInt(h - 2) + 1;
    if (grid[y][x] === 0 && countOrthoOpen(grid, x, y) >= 1) grid[y][x] = 1;
  }
  return grid;
}

function applyDangerous(grid, prng) {
  grid = applyDense(grid, prng);
  const h = grid.length;
  const w = grid[0].length;
  // Area-proportional pit placement.
  const areaScale = (w * h) / 640;
  const numPits = Math.round((5 + prng.nextInt(5)) * areaScale);
  for (let i = 0; i < numPits; i++) {
    const x = prng.nextInt(w - 2) + 1;
    const y = prng.nextInt(h - 2) + 1;
    if (grid[y][x] === 1 && countOrthoOpen(grid, x, y) >= 4) grid[y][x] = 0;
  }
  // `dangerous` is not TIGHT — enforce the 2-wide corridor floor after pit placement.
  widenOneWideCorridors(grid);
  return grid;
}

export { TIGHT_MODIFIER_IDS };
