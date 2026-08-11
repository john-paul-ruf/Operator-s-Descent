import { hash } from '../core/hash.js';
import { createPRNG } from '../core/prng.js';
import { ARCHETYPES, GRID_W, GRID_H } from './archetypes.js';
import { applyModifiers } from './modifiers.js';
import { validateFloor } from './validator.js';
import { enemyCountScale } from '../rules/scaling.js';

const MAX_ATTEMPTS = 10;
const CONTAINER_DENSITY_BASE = 3;

function wrapGenStream(rngCursor) {
  return {
    next: () => rngCursor.next('gen'),
    nextInt: (max) => rngCursor.nextInt('gen', max)
  };
}

function weightedSelect(entries, prng) {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total === 0) return entries[0]?.[0] || null;
  let roll = prng.nextInt(total);
  for (const [id, w] of entries) {
    roll -= w;
    if (roll < 0) return id;
  }
  return entries[0]?.[0] || null;
}

function selectTheme(worldSeed, floorNumber, themesData, prng) {
  const subPrng = createPRNG(hash(worldSeed, floorNumber, 'theme'));
  const themeEntries = themesData.themes.map(t => [t.id, 1]);
  return weightedSelect(themeEntries, subPrng);
}

function getThemeData(themeId, themesData) {
  return themesData.themes.find(t => t.id === themeId) || themesData.themes[0];
}

function findFloorCells(grid) {
  const cells = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (grid[y][x] === 1 || grid[y][x] === 2 || grid[y][x] === 3) cells.push({ x, y });
    }
  }
  return cells;
}

function placeFeatures(grid, prng, floorNumber, themeData) {
  const floorCells = findFloorCells(grid);
  if (floorCells.length === 0) return null;

  const descentPoint = floorCells.reduce((farthest, cell) => {
    const dist = cell.y * cell.y + cell.x * cell.x;
    return dist > (farthest._dist || -1) ? { ...cell, _dist: dist } : farthest;
  }, { _dist: -1 });
  delete descentPoint._dist;

  const numContainers = Math.max(1, Math.floor(CONTAINER_DENSITY_BASE * (themeData?.lootBias?.containerDensity || 1.0)));
  const containers = [];
  const used = new Set();
  used.add(`${descentPoint.x},${descentPoint.y}`);

  for (let i = 0; i < numContainers; i++) {
    let attempts = 20;
    while (attempts-- > 0) {
      const cell = floorCells[prng.nextInt(floorCells.length)];
      const key = `${cell.x},${cell.y}`;
      if (!used.has(key) && grid[cell.y][cell.x] === 1) {
        grid[cell.y][cell.x] = 2;
        containers.push({ id: i, x: cell.x, y: cell.y });
        used.add(key);
        break;
      }
    }
  }

  const baseEnemyCount = 2 + Math.floor(floorNumber / 3);
  const numEnemies = enemyCountScale(baseEnemyCount, floorNumber);
  const enemySpawns = [];

  const enemyWeights = themeData?.enemyMixWeights
    ? Object.entries(themeData.enemyMixWeights)
    : [['drone', 1]];

  for (let i = 0; i < numEnemies; i++) {
    let attempts = 20;
    while (attempts-- > 0) {
      const cell = floorCells[prng.nextInt(floorCells.length)];
      const key = `${cell.x},${cell.y}`;
      if (!used.has(key) && grid[cell.y][cell.x] === 1) {
        const archetypeId = weightedSelect(enemyWeights, prng);
        enemySpawns.push({ id: i, x: cell.x, y: cell.y, archetypeId });
        used.add(key);
        break;
      }
    }
  }

  grid[descentPoint.y][descentPoint.x] = 3;

  return {
    cells: grid,
    descentPoint,
    containers,
    enemySpawns,
    themeId: themeData?.id || 'cold_storage',
    archetypeId: null,
    modifiers: []
  };
}

export function generateFloor(worldSeed, floorNumber, rngCursor, themesData) {
  const genPrng = wrapGenStream(rngCursor);
  let lastFloor = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const themeId = selectTheme(worldSeed, floorNumber, themesData, genPrng);
    const themeData = getThemeData(themeId, themesData);

    const archetypeEntries = themeData?.archetypeWeights
      ? Object.entries(themeData.archetypeWeights)
      : Object.keys(ARCHETYPES).map(id => [id, 1]);

    const archetypeId = weightedSelect(archetypeEntries, genPrng);

    const generator = ARCHETYPES[archetypeId] || ARCHETYPES.chambers;
    const grid = generator(genPrng);

    const modifierWeights = themeData?.modifierWeights || { none: 1 };
    const modResult = applyModifiers(grid, genPrng, modifierWeights);
    const modifiedGrid = modResult.grid;
    const modifierIds = modResult.modifierIds;

    const featurePrng = createPRNG(hash(worldSeed, floorNumber, attempt));
    const floor = placeFeatures(modifiedGrid, featurePrng, floorNumber, themeData);
    if (!floor) continue;

    floor.archetypeId = archetypeId;
    floor.modifiers = modifierIds;
    lastFloor = floor;

    const result = validateFloor(floor);
    if (result.valid) return floor;
  }

  if (lastFloor) {
    return lastFloor;
  }

  const fallbackGrid = ARCHETYPES.chambers(createPRNG(hash(worldSeed, floorNumber, 999)));
  const fallbackFloor = placeFeatures(fallbackGrid, createPRNG(hash(worldSeed, floorNumber, 998)), floorNumber, themesData.themes[0] || {});
  if (fallbackFloor) {
    fallbackFloor.archetypeId = 'chambers';
    return fallbackFloor;
  }

  const grid = new Array(GRID_H);
  for (let y = 0; y < GRID_H; y++) {
    grid[y] = new Array(GRID_W).fill(1);
  }
  grid[GRID_H - 1][Math.floor(GRID_W / 2)] = 3;
  return {
    cells: grid,
    descentPoint: { x: Math.floor(GRID_W / 2), y: GRID_H - 1 },
    containers: [],
    enemySpawns: [],
    themeId: 'cold_storage',
    archetypeId: 'chambers',
    modifiers: []
  };
}