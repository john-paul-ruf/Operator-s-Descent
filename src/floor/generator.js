import { hash } from '../core/hash.js';
import { createPRNG } from '../core/prng.js';
import { ARCHETYPES, GRID_W, GRID_H } from './archetypes.js';
import { applyModifiers } from './modifiers.js';
import { validateFloor } from './validator.js';
import { enemyCountScale, thresholdFloor } from '../rules/scaling.js';

const MAX_CANDIDATES = 100;
const REPAIR_THRESHOLD = 50;
const CONTAINER_DENSITY_BASE = 3;
const GENERATION_VERSION = 2;
const HIGHER_TIER_ENEMIES = ['stalker', 'choir', 'null', 'construct'];

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

function selectTheme(worldSeed, floorNumber, themesData, prng, themesSeen) {
  const themeEntries = themesData.themes
    .filter(t => !themesSeen || !themesSeen.includes(t.id))
    .map(t => [t.id, 1]);
  if (themeEntries.length === 0) {
    return themesData.themes[0]?.id || 'cold_storage';
  }
  return weightedSelect(themeEntries, prng);
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

function placeFeatures(grid, prng, floorNumber, themeData, options = {}) {
  const floorCells = findFloorCells(grid);
  if (floorCells.length === 0) return null;

  const isThreshold = thresholdFloor(floorNumber);

  const descentPoint = floorCells.reduce((farthest, cell) => {
    const dist = cell.y * cell.y + cell.x * cell.x;
    return dist > (farthest._dist || -1) ? { ...cell, _dist: dist } : farthest;
  }, { _dist: -1 });
  delete descentPoint._dist;

  const density = themeData?.lootBias?.containerDensity || 1.0;
  const numContainers = Math.max(1, Math.floor(CONTAINER_DENSITY_BASE * density));
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
        const container = { id: i, x: cell.x, y: cell.y };
        if (isThreshold && i === 0) container.kind = 'vault';
        containers.push(container);
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

  const echoSpawns = options.echoSpawns || [];

  for (let i = 0; i < numEnemies; i++) {
    let attempts = 20;
    while (attempts-- > 0) {
      const cell = floorCells[prng.nextInt(floorCells.length)];
      const key = `${cell.x},${cell.y}`;
      if (!used.has(key) && grid[cell.y][cell.x] === 1) {
        let archetypeId = weightedSelect(enemyWeights, prng);
        if (isThreshold && i === 0) {
          archetypeId = HIGHER_TIER_ENEMIES[prng.nextInt(HIGHER_TIER_ENEMIES.length)];
        }
        enemySpawns.push({
          id: i,
          x: cell.x,
          y: cell.y,
          archetypeId,
          ...(isThreshold && i === 0 ? { elite: true } : {})
        });
        used.add(key);
        break;
      }
    }
  }

  if (isThreshold) {
    let placed = false;
    for (let attempts = 30; attempts > 0 && !placed; attempts--) {
      const cell = floorCells[prng.nextInt(floorCells.length)];
      const key = `${cell.x},${cell.y}`;
      if (!used.has(key) && grid[cell.y][cell.x] === 1) {
        enemySpawns.push({ id: enemySpawns.length, x: cell.x, y: cell.y, archetypeId: 'apex', elite: true });
        used.add(key);
        placed = true;
      }
    }
  }

  for (const echo of echoSpawns) {
    if (echo.x >= 0 && echo.x < GRID_W && echo.y >= 0 && echo.y < GRID_H &&
        grid[echo.y][echo.x] === 1 && !used.has(`${echo.x},${echo.y}`)) {
      enemySpawns.push({
        id: enemySpawns.length,
        x: echo.x,
        y: echo.y,
        archetypeId: 'echo',
        echo: true,
        character: echo.character,
        equipment: echo.equipment
      });
      used.add(`${echo.x},${echo.y}`);
    }
  }

  grid[descentPoint.y][descentPoint.x] = 3;

  const centerX = Math.floor(GRID_W / 2);
  const entryPoint = floorCells
    .filter(cell => grid[cell.y][cell.x] === 1 && !used.has(`${cell.x},${cell.y}`))
    .sort((a, b) => a.y - b.y || Math.abs(a.x - centerX) - Math.abs(b.x - centerX) || a.x - b.x)[0]
    || floorCells.find(cell => grid[cell.y][cell.x] === 1)
    || { x: centerX, y: 0 };

  return {
    cells: grid,
    entryPoint,
    descentPoint,
    containers,
    enemySpawns,
    themeId: themeData?.id || 'cold_storage',
    archetypeId: null,
    modifiers: [],
    threshold: isThreshold
  };
}

function buildCandidate(worldSeed, floorNumber, k, themesData, options) {
  const candidatePrng = createPRNG(hash(worldSeed, GENERATION_VERSION, floorNumber, k));

  const themesSeen = options.themesSeen || [];
  const isThreshold = thresholdFloor(floorNumber);
  const unseenThemes = themesData.themes.filter(t => !themesSeen.includes(t.id));

  let themeId;
  if (isThreshold && unseenThemes.length > 0) {
    themeId = weightedSelect(unseenThemes.map(t => [t.id, 1]), candidatePrng);
  } else {
    themeId = selectTheme(worldSeed, floorNumber, themesData, candidatePrng, themesSeen);
  }
  const themeData = getThemeData(themeId, themesData);

  const archetypeEntries = themeData?.archetypeWeights
    ? Object.entries(themeData.archetypeWeights)
    : Object.keys(ARCHETYPES).map(id => [id, 1]);

  const archetypeId = weightedSelect(archetypeEntries, candidatePrng);

  const generator = ARCHETYPES[archetypeId] || ARCHETYPES.chambers;
  const grid = generator(candidatePrng);

  const modifierWeights = themeData?.modifierWeights || { none: 1 };
  const modResult = applyModifiers(grid, candidatePrng, modifierWeights);
  const modifiedGrid = modResult.grid;
  const modifierIds = modResult.modifierIds;

  const featurePrng = createPRNG(hash(worldSeed, GENERATION_VERSION, floorNumber, k, 'features'));
  const floor = placeFeatures(modifiedGrid, featurePrng, floorNumber, themeData, { echoSpawns: options.echoSpawns });
  if (!floor) return null;

  floor.archetypeId = archetypeId;
  floor.modifiers = modifierIds;
  floor.floorSubSeed = k;
  floor.threshold = isThreshold;
  return floor;
}

function buildRepairCandidate(worldSeed, floorNumber, k, themesData) {
  const candidatePrng = createPRNG(hash(worldSeed, GENERATION_VERSION, floorNumber, k, 'repair'));

  const themeData = themesData.themes[0] || {};
  const grid = ARCHETYPES.chambers(candidatePrng);

  const featurePrng = createPRNG(hash(worldSeed, GENERATION_VERSION, floorNumber, k, 'repair-features'));
  const floor = placeFeatures(grid, featurePrng, floorNumber, themeData);
  if (!floor) return null;

  floor.archetypeId = 'chambers';
  floor.modifiers = [];
  floor.floorSubSeed = k;
  return floor;
}

function cloneFloor(floor) {
  return {
    ...floor,
    cells: floor.cells.map(row => [...row]),
    containers: floor.containers.map(c => ({ ...c })),
    enemySpawns: floor.enemySpawns.map(e => ({ ...e })),
    descentPoint: { ...floor.descentPoint },
    entryPoint: { ...floor.entryPoint },
    modifiers: [...floor.modifiers]
  };
}

export function generateFloor(worldSeed, floorNumber, options, themesData) {
  if (themesData === undefined && options !== undefined) {
    themesData = options;
    options = {};
  }
  options = options || {};
  const generationVersion = options.generationVersion || GENERATION_VERSION;

  let floor = null;
  let diagnostics = { attempts: 0, repaired: false, failures: [] };
  const requestedSubSeed = Number.isInteger(options.floorSubSeed) && options.floorSubSeed >= 0 ? options.floorSubSeed : null;

  if (requestedSubSeed !== null) {
    diagnostics.attempts = 1;
    const candidate = buildCandidate(worldSeed, floorNumber, requestedSubSeed, themesData, options);
    if (candidate) {
      const result = validateFloor(candidate);
      if (result.valid) floor = candidate;
      else diagnostics.failures = result.failures;
    }
  }

  if (!floor && requestedSubSeed === null) {
    for (let k = 0; k < MAX_CANDIDATES; k++) {
      diagnostics.attempts = k + 1;
      const candidate = buildCandidate(worldSeed, floorNumber, k, themesData, options);
      if (!candidate) continue;

      const result = validateFloor(candidate);
      if (result.valid) {
        floor = candidate;
        break;
      }
      diagnostics.failures = result.failures;
    }
  }

  if (!floor) {
    for (let k = 0; k < REPAIR_THRESHOLD; k++) {
      diagnostics.attempts = MAX_CANDIDATES + k + 1;
      diagnostics.repaired = true;
      const candidate = buildRepairCandidate(worldSeed, floorNumber, k, themesData);
      if (!candidate) continue;

      const result = validateFloor(candidate);
      if (result.valid) {
        floor = candidate;
        break;
      }
      diagnostics.failures = result.failures;
    }
  }

  if (!floor) {
    floor = buildRepairCandidate(worldSeed, floorNumber, 0, themesData);
  }

  if (!floor) {
    const grid = new Array(GRID_H);
    for (let y = 0; y < GRID_H; y++) {
      grid[y] = new Array(GRID_W).fill(1);
    }
    grid[0][Math.floor(GRID_W / 2)] = 3;
    grid[GRID_H - 1][Math.floor(GRID_W / 2)] = 1;
    for (let y = 1; y < GRID_H - 1; y++) grid[y][Math.floor(GRID_W / 2)] = 1;
    floor = {
      cells: grid,
      entryPoint: { x: Math.floor(GRID_W / 2), y: 0 },
      descentPoint: { x: Math.floor(GRID_W / 2), y: GRID_H - 1 },
      containers: [{ id: 0, x: Math.floor(GRID_W / 2) + 1, y: Math.floor(GRID_H / 2) }],
      enemySpawns: [],
      themeId: themesData.themes[0]?.id || 'cold_storage',
      archetypeId: 'chambers',
      modifiers: [],
      floorSubSeed: 0
    };
    grid[floor.containers[0].y][floor.containers[0].x] = 2;
  }

  return cloneFloor(floor);
}

export { GENERATION_VERSION };
