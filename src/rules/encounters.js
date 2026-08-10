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
