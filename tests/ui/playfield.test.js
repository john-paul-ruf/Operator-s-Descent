import { beforeEach, describe, expect, test } from 'vitest';
import {
  calculateCombatCamera,
  cellAtPoint,
  createPlayfield,
  FLOOR_COLOR,
  FLOOR_DIM_COLOR,
  WALL_COLOR,
  HIDDEN_COLOR,
  GRID_COLOR,
  WALL_LINE_COLOR,
  TICK_DIM_ALPHA
} from '../../src/ui/playfield.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.style = { properties: {}, setProperty(name, value) { this.properties[name] = value; } };
    this.listeners = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
}

class FakeCanvas extends FakeElement {
  constructor() {
    super('canvas');
    this.width = 480;
    this.height = 768;
    this.context = new FakeContext();
  }
  getContext() { return this.context; }
}

class FakeContext {
  constructor() { this.calls = []; this._globalAlpha = 1; }
  get globalAlpha() { return this._globalAlpha; }
  set globalAlpha(value) { this._globalAlpha = value; this.calls.push(['set-alpha', value]); }
  beginPath() { this.calls.push(['beginPath']); }
  arc(...args) { this.calls.push(['arc', ...args]); }
  fill() { this.calls.push(['fill', this.fillStyle]); }
  stroke() { this.calls.push(['stroke', this.strokeStyle]); }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); }
  strokeRect(...args) { this.calls.push(['strokeRect', this.strokeStyle, ...args]); }
  fillText(...args) { this.calls.push(['fillText', this.fillStyle, ...args]); }
}

function lattice() {
  const grid = Array.from({ length: 32 }, () => Array.from({ length: 20 }, () => 1));
  grid[0][0] = 0;
  grid[4][4] = 2;
  return {
    getGrid: () => grid,
    getWidth: () => 20,
    getHeight: () => 32,
    getContainers: () => [{ id: 'c1', x: 4, y: 4 }],
    getEnemySpawns: () => [{ id: 'e1', x: 5, y: 5 }]
  };
}

beforeEach(() => {
  globalThis.document = { documentElement: new FakeElement('html') };
});

describe('playfield rendering', () => {
  test('exposes the near-black lattice palette constants (clarity-and-fit 2026-08-16)', () => {
    expect(FLOOR_COLOR).toBe('#101010');
    expect(FLOOR_DIM_COLOR).toBe('#0a0a0a');
    expect(WALL_COLOR).toBe('#000000');
    expect(HIDDEN_COLOR).toBe('#000000');
    expect(GRID_COLOR).toBe('#3a3a3a');
    expect(WALL_LINE_COLOR).toBe('#7ec8e3');
    expect(TICK_DIM_ALPHA).toBe(0.45);
  });

  test('renders exploration fog without leaking hidden entities and keeps canvas read-only', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const fog = new Uint8Array(20 * 32);
    fog[4 * 20 + 4] = 1;
    fog[5 * 20 + 5] = 0;

    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 });

    const text = canvas.context.calls.filter(([name]) => name === 'fillText').map((call) => call[2]);
    expect(text).not.toContain('HOSTILE');
    expect(text.some((value) => typeof value === 'string' && value.length === 1)).toBe(true);
    expect(canvas.context.calls.some((call) => call[0] === 'arc' && call[3] === 9.36)).toBe(true);
    expect(canvas.context.font).toMatch(/^18px/);
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.listeners.size).toBe(0);
  });

  test('paints near-black floors, black walls/hidden cells, corner ticks (no floor strokeRect), cyan boundary lines', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const fog = new Uint8Array(20 * 32).fill(2);
    fog[6 * 20 + 6] = 0;

    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 });

    const fills = canvas.context.calls.filter(([n]) => n === 'fillRect');
    // Wall at (0,0) draws #000000; floor at (1,0) draws #101010; hidden (6,6) draws #000000.
    expect(fills.some((c) => c[1] === '#000000' && c[2] === 0 && c[3] === 0 && c[4] === 24 && c[5] === 24)).toBe(true);
    expect(fills.some((c) => c[1] === '#101010' && c[2] === 24 && c[3] === 0 && c[4] === 24 && c[5] === 24)).toBe(true);
    expect(fills.some((c) => c[1] === '#000000' && c[2] === 6 * 24 && c[3] === 6 * 24)).toBe(true);

    // No strokeRect gridlines on floor cells anywhere.
    expect(canvas.context.calls.some(([n, style]) => n === 'strokeRect' && style === '#3a3a3a')).toBe(false);

    // Tick pass fills GRID_COLOR at interior corners as 1px strips (a horizontal 9x1 + vertical 1x9 at 24px cells, arm=4).
    const gridFills = fills.filter((c) => c[1] === '#3a3a3a');
    expect(gridFills.length).toBeGreaterThan(0);
    // Corner between (1,1),(2,1),(1,2),(2,2) — all revealed floor — sits at pixel (2*24, 2*24)=(48,48).
    // Horizontal bar: x=48-4=44, y=48, w=9, h=1
    expect(gridFills.some((c) => c[2] === 44 && c[3] === 48 && c[4] === 9 && c[5] === 1)).toBe(true);
    // Vertical bar: x=48, y=44, w=1, h=9
    expect(gridFills.some((c) => c[2] === 48 && c[3] === 44 && c[4] === 1 && c[5] === 9)).toBe(true);

    // Cyan wall boundary lines exist. Wall at (0,0) → floor at (1,0) sees a west wall line inset.
    const cyanLines = fills.filter((c) => c[1] === '#7ec8e3');
    expect(cyanLines.length).toBeGreaterThan(0);
    expect(cyanLines.some((c) => c[2] === 24 + 1 && c[3] === 0 + 1)).toBe(true);
    // Hidden cell (6,6) does not emit a wall line: no cyan at that inset origin.
    expect(cyanLines.some((c) => c[2] === 6 * 24 + 1 && c[3] === 6 * 24 + 1)).toBe(false);
    // Interior all-floor cell has no cyan (no adjacent wall to draw a boundary against).
    expect(cyanLines.some((c) => c[2] === 10 * 24 + 1 && c[3] === 10 * 24 + 1)).toBe(false);
  });

  test('fog=1 (seen) draws dim floor and dim-alpha ticks; VISITED_OVERLAY black-overlay pass is gone', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    // All cells fog=1 (seen, not visible). Ensures every revealed floor is dim.
    const fog = new Uint8Array(20 * 32).fill(1);

    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 });

    const fills = canvas.context.calls.filter(([n]) => n === 'fillRect');
    // Floors render with FLOOR_DIM_COLOR when fog === 1.
    expect(fills.some((c) => c[1] === '#0a0a0a' && c[4] === 24 && c[5] === 24)).toBe(true);
    // No black rgba(0,0,0,0.55) overlay pass (the removed VISITED_OVERLAY).
    expect(fills.some((c) => c[1] === 'rgba(0,0,0,0.55)')).toBe(false);

    // Every tick-color fill draw occurs while globalAlpha === TICK_DIM_ALPHA.
    let currentAlpha = 1;
    const tickAlphas = [];
    for (const call of canvas.context.calls) {
      if (call[0] === 'set-alpha') currentAlpha = call[1];
      else if (call[0] === 'fillRect' && call[1] === '#3a3a3a') tickAlphas.push(currentAlpha);
    }
    expect(tickAlphas.length).toBeGreaterThan(0);
    expect(tickAlphas.every((a) => a === TICK_DIM_ALPHA)).toBe(true);
  });

  test('renderExploration stagedPath overlay draws PATH_COLOR previews (55% alpha) and inset outline on the final step', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const fog = new Uint8Array(20 * 32).fill(2);
    const stagedPath = [
      { direction: 'e', x: 2, y: 1 },
      { direction: 'e', x: 3, y: 1 },
      { direction: 's', x: 3, y: 2 }
    ];

    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 }, { stagedPath });

    let alpha = 1;
    const previewFills = [];
    for (const call of canvas.context.calls) {
      if (call[0] === 'set-alpha') alpha = call[1];
      else if (call[0] === 'fillRect' && call[1] === '#d8d8d8') previewFills.push({ alpha, args: call.slice(2) });
    }
    expect(previewFills).toHaveLength(3);
    // Each preview is a 5x5 square centered on the cell — cell (2,1) center (60,36) → rect (58,34,5,5).
    expect(previewFills[0]).toEqual({ alpha: 0.55, args: [58, 34, 5, 5] });
    expect(previewFills[1]).toEqual({ alpha: 0.55, args: [82, 34, 5, 5] });
    expect(previewFills[2]).toEqual({ alpha: 0.55, args: [82, 58, 5, 5] });

    // Final step gets a full-alpha PATH_COLOR strokeRect inset by 1px.
    const strokes = canvas.context.calls.filter(([n, style]) => n === 'strokeRect' && style === '#d8d8d8');
    expect(strokes).toHaveLength(1);
    expect(strokes[0].slice(2)).toEqual([3 * 24 + 1, 2 * 24 + 1, 22, 22]);
  });

  test('renderExploration without stagedPath (or empty stagedPath) emits no PATH_COLOR preview marks', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const fog = new Uint8Array(20 * 32).fill(2);

    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 });
    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 }, { stagedPath: [] });

    expect(canvas.context.calls.some((c) => c[0] === 'fillRect' && c[1] === '#d8d8d8')).toBe(false);
    expect(canvas.context.calls.some((c) => c[0] === 'strokeRect' && c[1] === '#d8d8d8')).toBe(false);
  });

  test('renders combat overlays and selected target labels at 2x scale', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', position: { x: 3, y: 3 }, sigilCodepoint: 0xE000 }],
      ['e1', { id: 'e1', side: 'enemy', position: { x: 4, y: 4 }, sigilCodepoint: 0xE030 }]
    ]);

    playfield.renderCombat({ combatants, turnOrder: ['p1'], currentTurn: 0, round: 2 }, lattice(), {
      camera: { x: 0, y: 0, w: 8, h: 16 },
      selectedTargetId: 'e1',
      validTargets: new Set(['4,4']),
      rangeCells: new Set(['2,2']),
      coverCells: new Set(['3,3']),
      pathCells: new Set(['1,1'])
    });

    const labels = canvas.context.calls.filter(([name]) => name === 'fillText').map((call) => call[2]);
    expect(labels).toEqual(expect.arrayContaining(['VALID', 'R', 'C', 'P', 'ACTIVE', 'TARGET']));
    expect(canvas.context.calls.some((call) => call[0] === 'fillRect' && call[4] === 48 && call[5] === 48)).toBe(true);
    expect(canvas.context.font).toMatch(/^32px/);
  });

  test('combat wall-line pass samples the full grid so camera borders do not gain spurious cyan frames', () => {
    // Camera window whose right edge (dx=7) maps to gx=7 — an OPEN floor cell whose
    // real neighbor at gx=8 is ALSO an open floor cell. No cyan edge should appear there.
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);

    playfield.renderCombat({ combatants: new Map(), turnOrder: [], currentTurn: 0, round: 1 }, lattice(), {
      camera: { x: 0, y: 0, w: 8, h: 16 }
    });

    const fills = canvas.context.calls.filter(([n]) => n === 'fillRect');
    const cyan = fills.filter((c) => c[1] === '#7ec8e3');
    // Right edge of camera-column 7 (gx=7): line would be inset at x = 7*48 + 48 - 3 = 45+7*48 = 381
    // Neighbor gx=8 is real open floor → no line should exist at that x.
    const spuriousRightEdge = cyan.some((c) => c[2] === 7 * 48 + 48 - 3);
    expect(spuriousRightEdge).toBe(false);
    // Left edge of camera-column 0 (gx=0): neighbor gx=-1 is out-of-bounds ≡ wall → line MUST exist
    // at x = 0*48 + 1 = 1 for revealed floor rows (row 1..15; row 0's cell 0,0 is a wall).
    expect(cyan.some((c) => c[2] === 1 && c[3] === 1 * 48 + 1)).toBe(true);
  });

  test('cellAtPoint maps client coords through CSS scale + camera offset; null outside canvas', () => {
    const canvas = new FakeCanvas();
    canvas.width = 384;
    canvas.height = 768;
    // Rect: 192x384 CSS pixels, positioned at (10, 20). Each rect pixel = 2 canvas pixels.
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, right: 202, bottom: 404, width: 192, height: 384 });

    // Point (58, 68) → rect-relative (48, 48) → canvas (96, 96) → cell (2, 2) at cellSize=48, camera (0,0)
    expect(cellAtPoint({ canvas, camera: { x: 0, y: 0, w: 8, h: 16 }, cellSize: 48 }, 58, 68)).toEqual({ x: 2, y: 2 });
    // Same point with camera offset shifts the world-space cell by the camera origin.
    expect(cellAtPoint({ canvas, camera: { x: 3, y: 5, w: 8, h: 12 }, cellSize: 48 }, 58, 68)).toEqual({ x: 5, y: 7 });
    // Outside the canvas rect returns null (both above/left and below/right).
    expect(cellAtPoint({ canvas, camera: { x: 0, y: 0 }, cellSize: 48 }, 5, 500)).toBeNull();
    expect(cellAtPoint({ canvas, camera: { x: 0, y: 0 }, cellSize: 48 }, 300, 30)).toBeNull();
  });

  test('calculates bounded camera and writes accent only through CSS custom property', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);

    expect(calculateCombatCamera({ width: 20, height: 32, active: { x: 19, y: 31 } })).toEqual({ x: 12, y: 16, w: 8, h: 16 });
    expect(playfield.autoPan({ width: 20, height: 32, active: { x: 10, y: 20 }, selected: { x: 10, y: 28 }, consoleExpanded: true })).toEqual({ x: 6, y: 18, w: 8, h: 12 });
    expect(playfield.setAccent({ accent: '#123abc' })).toBe(true);
    expect(document.documentElement.style.properties['--accent']).toBe('#123abc');
    expect(playfield.setAccent('not-a-color')).toBe(false);
  });
});
