const WINDOW_WIDTH = 8;
const WINDOW_HEIGHT = 16;

function isOpenFloorCell(floorCells, x, y) {
  return floorCells[y]?.[x] !== undefined && floorCells[y][x] !== 0;
}

function carveWindow(floorCells, contact) {
  const floorHeight = floorCells.length;
  const floorWidth = floorCells[0]?.length || 0;
  const originX = Math.max(0, Math.min(floorWidth - WINDOW_WIDTH, contact.x - Math.floor(WINDOW_WIDTH / 2)));
  const originY = Math.max(0, Math.min(floorHeight - WINDOW_HEIGHT, contact.y - Math.floor(WINDOW_HEIGHT / 2)));
  const cells = [];
  for (let y = 0; y < WINDOW_HEIGHT; y++) {
    const row = [];
    for (let x = 0; x < WINDOW_WIDTH; x++) {
      row.push(isOpenFloorCell(floorCells, originX + x, originY + y) ? 1 : 0);
    }
    cells.push(row);
  }
  return { originX, originY, width: WINDOW_WIDTH, height: WINDOW_HEIGHT, cells };
}

function openCellsOf(window) {
  const cells = [];
  for (let y = 0; y < window.height; y++) {
    for (let x = 0; x < window.width; x++) {
      if (window.cells[y][x] !== 0) cells.push({ x, y });
    }
  }
  return cells;
}

const MIN_BAND_SEPARATION = 9;
const MAX_BAND_SEPARATION = 12;

function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Deterministic anchor pair for the two deployment bands: prefer a separation inside the 9-12 cell
// target band (closest to the top of the band), falling back to the largest separation the carved
// geometry actually offers when the target band is unreachable.
function anchorPair(openCells) {
  let inBand = null;
  let inBandDistance = -1;
  let overall = [openCells[0], openCells[0]];
  let overallDistance = -1;
  for (let i = 0; i < openCells.length; i++) {
    for (let j = i + 1; j < openCells.length; j++) {
      const distance = chebyshev(openCells[i], openCells[j]);
      if (distance > overallDistance) {
        overallDistance = distance;
        overall = [openCells[i], openCells[j]];
      }
      if (distance >= MIN_BAND_SEPARATION && distance <= MAX_BAND_SEPARATION && distance > inBandDistance) {
        inBandDistance = distance;
        inBand = [openCells[i], openCells[j]];
      }
    }
  }
  return inBand || overall;
}

function nearestUnassigned(anchor, openCells, assigned, count) {
  return openCells
    .filter(cell => !assigned.has(`${cell.x},${cell.y}`))
    .sort((a, b) => chebyshev(anchor, a) - chebyshev(anchor, b) || a.y - b.y || a.x - b.x)
    .slice(0, count);
}

// Places party/hostile bands on legal, distinct cells, maximizing separation whenever geometry allows it.
// Never invents cells outside the carved window; if the window is too small the bands simply end up closer.
export function deployBands(window, partyCount, hostileCount) {
  const openCells = openCellsOf(window);
  if (openCells.length === 0) return { partyPositions: [], hostilePositions: [] };
  const [partyAnchor, hostileAnchor] = anchorPair(openCells);
  const assigned = new Set();
  const partyPositions = nearestUnassigned(partyAnchor, openCells, assigned, partyCount);
  for (const cell of partyPositions) assigned.add(`${cell.x},${cell.y}`);
  const hostilePositions = nearestUnassigned(hostileAnchor, openCells, assigned, hostileCount);
  return { partyPositions, hostilePositions };
}

export function createStandardEncounter(floor, contact, party, enemies, rngCursor) {
  const floorCells = floor?.cells || floor?.grid || [[1]];
  const window = carveWindow(floorCells, contact || { x: 0, y: 0 });
  const { partyPositions, hostilePositions } = deployBands(window, party.length, enemies.length);
  const actors = [
    ...party.map((member, index) => ({
      ...member,
      side: 'party',
      position: partyPositions[index] ? { ...partyPositions[index] } : { x: 0, y: 0 }
    })),
    ...enemies.map((enemy, index) => ({
      ...enemy,
      side: 'enemy',
      position: hostilePositions[index] ? { ...hostilePositions[index] } : { x: window.width - 1, y: window.height - 1 }
    }))
  ];
  return {
    id: `encounter_${contact?.x ?? 0}_${contact?.y ?? 0}_${rngCursor.getCursor('gen')}`,
    kind: 'standard',
    window,
    actors,
    forfeitableLoot: []
  };
}

export function completeEncounter(encounter, combatResult) {
  if (!encounter || !combatResult) return { resolved: false, reason: 'invalid-input' };
  const result = combatResult.result;
  if (result === 'victory') {
    return {
      resolved: true,
      outcome: 'victory',
      loot: [...(encounter.forfeitableLoot || [])],
      defeatedSpawnIds: combatResult.victoryPayload?.defeatedSpawnIds || [],
      reclaimableGear: combatResult.victoryPayload?.reclaimableGear || []
    };
  }
  if (result === 'retreat') {
    return {
      resolved: true,
      outcome: 'retreat',
      loot: [],
      forfeitedLoot: [...(encounter.forfeitableLoot || [])]
    };
  }
  if (result === 'wipe') {
    return {
      resolved: true,
      outcome: 'wipe',
      loot: [],
      forfeitedLoot: [...(encounter.forfeitableLoot || [])]
    };
  }
  return { resolved: false, reason: 'combat-not-ended' };
}

const HUNT_MIN_DISTANCE = 4;
const HUNT_MAX_DISTANCE = 6;
const HUNT_ELITE_TYPES = ['stalker', 'choir', 'null', 'construct'];

function findHuntSpawnCells(floorCells, partyPos, minDist, maxDist) {
  const candidates = floorCells.filter(cell => {
    if (cell.x === partyPos.x && cell.y === partyPos.y) return false;
    const dx = Math.abs(cell.x - partyPos.x);
    const dy = Math.abs(cell.y - partyPos.y);
    const dist = Math.max(dx, dy);
    return dist >= minDist && dist <= maxDist;
  });
  return candidates;
}

function groupBySide(candidates, partyPos) {
  const sides = { n: [], s: [], e: [], w: [], ne: [], nw: [], se: [], sw: [] };
  for (const cell of candidates) {
    const dx = cell.x - partyPos.x;
    const dy = cell.y - partyPos.y;
    let key;
    if (dy < 0 && Math.abs(dx) <= Math.abs(dy)) key = 'n';
    else if (dy > 0 && Math.abs(dx) <= Math.abs(dy)) key = 's';
    else if (dx > 0 && Math.abs(dy) <= Math.abs(dx)) key = 'e';
    else if (dx < 0 && Math.abs(dy) <= Math.abs(dx)) key = 'w';
    else if (dx > 0 && dy < 0) key = 'ne';
    else if (dx < 0 && dy < 0) key = 'nw';
    else if (dx > 0 && dy > 0) key = 'se';
    else key = 'sw';
    sides[key].push(cell);
  }
  return sides;
}

export function createHuntEncounter(floor, partyPosition, party, runState, rngCursor, data) {
  const floorCells = floor?.cells || floor?.grid || [[1]];
  const allCells = [];
  for (let y = 0; y < floorCells.length; y++) {
    for (let x = 0; x < floorCells[0].length; x++) {
      if (floorCells[y][x] !== 0) allCells.push({ x, y });
    }
  }

  let candidates = findHuntSpawnCells(allCells, partyPosition, HUNT_MIN_DISTANCE, HUNT_MAX_DISTANCE);
  if (candidates.length < 2) {
    candidates = findHuntSpawnCells(allCells, partyPosition, 2, 8);
  }
  if (candidates.length < 2) {
    candidates = allCells.filter(c => c.x !== partyPosition.x || c.y !== partyPosition.y);
  }

  const sides = groupBySide(candidates, partyPosition);
  const sideKeys = Object.keys(sides).filter(k => sides[k].length > 0);

  if (sideKeys.length < 2) {
    return null;
  }

  const depth = runState?.depth || 1;
  const baseEnemyCount = 2 + Math.floor(depth / 3);
  const numEnemies = baseEnemyCount + Math.floor(depth / 5);
  const themeData = data?.themes?.themes?.find(t => t.id === floor?.themeId) || {};
  const enemyWeights = themeData?.enemyMixWeights
    ? Object.entries(themeData.enemyMixWeights)
    : [['drone', 1]];

  const enemyPositions = [];
  const assigned = new Set();

  const selectedSides = [];
  const shuffledSides = [...sideKeys].sort(() => rngCursor.next('combat') - 0.5);
  for (const side of shuffledSides) {
    selectedSides.push(side);
    if (selectedSides.length >= Math.min(4, sideKeys.length)) break;
  }

  for (let i = 0; i < numEnemies; i++) {
    const side = selectedSides[i % selectedSides.length];
    const sideCells = sides[side].filter(c => !assigned.has(`${c.x},${c.y}`));
    if (sideCells.length === 0) continue;
    const cell = sideCells[Math.floor(rngCursor.next('combat') * sideCells.length)];
    assigned.add(`${cell.x},${cell.y}`);
    enemyPositions.push({ ...cell });
  }

  if (enemyPositions.length === 0) return null;

  const enemies = [];
  for (let i = 0; i < enemyPositions.length; i++) {
    let archetypeId;
    if (i === 0) {
      archetypeId = HUNT_ELITE_TYPES[Math.floor(rngCursor.next('combat') * HUNT_ELITE_TYPES.length)];
    } else {
      const total = enemyWeights.reduce((sum, [, w]) => sum + w, 0);
      if (total > 0) {
        let roll = rngCursor.nextInt('combat', total);
        archetypeId = enemyWeights[0][0];
        for (const [id, w] of enemyWeights) {
          roll -= w;
          if (roll < 0) { archetypeId = id; break; }
        }
      } else {
        archetypeId = 'drone';
      }
    }
    enemies.push({
      id: `hunt_${i}`,
      archetypeId,
      elite: i === 0
    });
  }

  const window = carveWindow(floorCells, partyPosition);
  const { partyPositions, hostilePositions } = deployBands(window, party.length, enemies.length);

  const actors = [
    ...party.map((member, index) => ({
      ...member,
      side: 'party',
      position: partyPositions[index] ? { ...partyPositions[index] } : { x: 0, y: 0 }
    })),
    ...enemies.map((enemy, index) => ({
      ...enemy,
      side: 'enemy',
      position: hostilePositions[index] ? { ...hostilePositions[index] } : { x: window.width - 1, y: window.height - 1 }
    }))
  ];

  return {
    id: `hunt_${depth}_${partyPosition.x}_${partyPosition.y}`,
    kind: 'hunt',
    window,
    actors,
    forfeitableLoot: []
  };
}

export function injectEcho(floor, echo, prng, floorCells) {
  const cells = floorCells || [];
  if (cells.length === 0) return null;

  const cell = cells[prng.nextInt(cells.length)];
  return {
    x: cell.x,
    y: cell.y,
    character: echo.character,
    equipment: echo.character?.equipment || null
  };
}

export function getDueEchoes(runState, floorNumber) {
  if (!runState?.echoQueue) return [];
  return runState.echoQueue.filter(echo =>
    echo.appearanceFloor === floorNumber && !echo.consumed
  );
}

export function consumeEcho(runState, echoIndex) {
  if (!runState?.echoQueue || echoIndex < 0 || echoIndex >= runState.echoQueue.length) return false;
  runState.echoQueue[echoIndex].consumed = true;
  return true;
}
