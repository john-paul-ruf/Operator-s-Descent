import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  cellAtPoint,
  createPlayfield,
  FLOOR_COLOR,
  FLOOR_DIM_COLOR,
  WALL_COLOR,
  HIDDEN_COLOR,
  GRID_COLOR,
  WALL_LINE_COLOR,
  TICK_DIM_ALPHA,
  WALL_GLOW_ALPHA,
  WALL_GLOW_BLUR,
  wallThickness
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
  constructor() {
    this.calls = [];
    this._globalAlpha = 1;
    this._shadowBlur = 0;
    this._shadowColor = 'transparent';
  }
  get globalAlpha() { return this._globalAlpha; }
  set globalAlpha(value) { this._globalAlpha = value; this.calls.push(['set-alpha', value]); }
  get shadowBlur() { return this._shadowBlur; }
  set shadowBlur(value) { this._shadowBlur = value; this.calls.push(['set-shadow-blur', value]); }
  get shadowColor() { return this._shadowColor; }
  set shadowColor(value) { this._shadowColor = value; this.calls.push(['set-shadow-color', value]); }
  beginPath() { this.calls.push(['beginPath']); }
  arc(...args) { this.calls.push(['arc', ...args]); }
  fill() { this.calls.push(['fill', this.fillStyle]); }
  stroke() { this.calls.push(['stroke', this.strokeStyle]); }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); }
  strokeRect(...args) { this.calls.push(['strokeRect', this.strokeStyle, ...args]); }
  fillText(...args) { this.calls.push(['fillText', this.fillStyle, ...args]); }
  setTransform(...args) { this.calls.push(['setTransform', ...args]); }
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

  test('paints near-black floors, black walls/hidden cells, corner ticks (no floor strokeRect), cyan boundary lines drawn OUTSIDE the traversable square', () => {
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
    // Corner between (1,1),(2,1),(1,2),(2,2) — all revealed traversable floor — sits at pixel (2*24, 2*24)=(48,48).
    // Horizontal bar: x=48-4=44, y=48, w=9, h=1
    expect(gridFills.some((c) => c[2] === 44 && c[3] === 48 && c[4] === 9 && c[5] === 1)).toBe(true);
    // Vertical bar: x=48, y=44, w=1, h=9
    expect(gridFills.some((c) => c[2] === 48 && c[3] === 44 && c[4] === 1 && c[5] === 9)).toBe(true);

    // Cyan wall boundary lines exist and sit OUTSIDE the traversable cell (walls-npc-docks 2026-08-17).
    // Floor at (1,0): west neighbor (0,0) is wall → west wall paints a t=3 strip at (24-3, 0, 3, 24).
    const cyanLines = fills.filter((c) => c[1] === '#7ec8e3');
    expect(cyanLines.length).toBeGreaterThan(0);
    expect(cyanLines.some((c) => c[2] === 21 && c[3] === 0 && c[4] === 3 && c[5] === 24)).toBe(true);
    // Same cell (1,0): north neighbor (1,-1) is out-of-bounds ≡ wall → north wall at (24, -3, 24, 3).
    expect(cyanLines.some((c) => c[2] === 24 && c[3] === -3 && c[4] === 24 && c[5] === 3)).toBe(true);
    // Corner joint at (1,0) NW (both north & west walls) → 3x3 square at (21, -3).
    expect(cyanLines.some((c) => c[2] === 21 && c[3] === -3 && c[4] === 3 && c[5] === 3)).toBe(true);
    // Hidden cell (6,6) never emits a wall line (skipped when !revealed).
    // Its would-be outside strips would sit at x/y = 6*24 ± 3; assert nothing cyan touches that column.
    expect(cyanLines.some((c) => c[2] === 6 * 24 && c[3] === 6 * 24 - 3 && c[4] === 24 && c[5] === 3)).toBe(false);
    // Interior all-floor cell (10,10) has no wall neighbor → no cyan attributable to it (no north/west outside strips).
    expect(cyanLines.some((c) => c[2] === 10 * 24 && c[3] === 10 * 24 - 3)).toBe(false);
    expect(cyanLines.some((c) => c[2] === 10 * 24 - 3 && c[3] === 10 * 24)).toBe(false);
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

  test('renders combat overlays and selected target labels at world-cell coords (2x scale, no camera window)', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', position: { x: 3, y: 3 }, sigilCodepoint: 0xE000 }],
      ['e1', { id: 'e1', side: 'enemy', position: { x: 4, y: 4 }, sigilCodepoint: 0xE030 }]
    ]);

    // No viewTransform → identity transform, full-window world render.
    playfield.renderCombat({ combatants, turnOrder: ['p1'], currentTurn: 0, round: 2 }, lattice(), {
      selectedTargetId: 'e1',
      validTargets: new Set(['4,4']),
      rangeCells: new Set(['2,2']),
      coverCells: new Set(['3,3']),
      pathCells: new Set(['1,1'])
    });

    const labels = canvas.context.calls.filter(([name]) => name === 'fillText').map((call) => call[2]);
    expect(labels).toEqual(expect.arrayContaining(['VALID', 'R', 'C', 'P', 'ACTIVE', 'TARGET']));
    // A 48×48 floor tile fills somewhere on the canvas — proves world-cell rendering happened.
    expect(canvas.context.calls.some((call) => call[0] === 'fillRect' && call[4] === 48 && call[5] === 48)).toBe(true);
    expect(canvas.context.font).toMatch(/^32px/);
  });

  test('combat wall-line pass samples the full grid so world borders do not gain spurious cyan frames (walls drawn OUTSIDE)', () => {
    // The full-window path renders every cell (0..19, 0..31). At gx=7 the neighbor at gx=8 is
    // ALSO an open floor cell → no cyan east strip at x = 7*48 + 48 = 384.
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);

    playfield.renderCombat({ combatants: new Map(), turnOrder: [], currentTurn: 0, round: 1 }, lattice(), {});

    const fills = canvas.context.calls.filter(([n]) => n === 'fillRect');
    const cyan = fills.filter((c) => c[1] === '#7ec8e3');
    // Column 7 east neighbor (gx=8) is open floor → no east wall strip should exist for that cell.
    const spuriousRightEdge = cyan.some((c) => c[2] === 7 * 48 + 48 && c[4] === 6);
    expect(spuriousRightEdge).toBe(false);
    // Column 0 west neighbor (gx=-1) is out-of-bounds ≡ wall → west outside-strip MUST exist for
    // revealed floor rows (row 1..31 since (0,0) is a wall) at x = -6, w = 6, size = 48.
    expect(cyan.some((c) => c[2] === -6 && c[3] === 1 * 48 && c[4] === 6 && c[5] === 48)).toBe(true);
  });

  test('wallThickness scales with cell size, floored at 3px', () => {
    expect(wallThickness(24)).toBe(3);   // 3 = max(3, round(3))
    expect(wallThickness(48)).toBe(6);   // 6 = max(3, round(6))
    expect(wallThickness(16)).toBe(3);   // 3 = max(3, round(2))
    expect(wallThickness(72)).toBe(9);   // 9 = max(3, round(9))
  });

  test('interior ticks require ALL 4 touching cells to be revealed traversable floor (walls-npc-docks 2026-08-17)', () => {
    // Corner between (1,1)(2,1)(1,2)(2,2) at pixel (48,48). Make (2,2) a wall so the corner
    // has one non-floor neighbor → NO tick fires. Corner at (96,96) touches (3,3)(4,3)(3,4)(4,4)
    // — (4,4) is a CONTAINER (traversable, not wall) → tick still fires.
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const grid = Array.from({ length: 32 }, () => Array.from({ length: 20 }, () => 1));
    grid[0][0] = 0;
    grid[2][2] = 0; // wall carved into an otherwise-open corner
    grid[4][4] = 2; // container — still traversable
    const modLattice = {
      getGrid: () => grid,
      getWidth: () => 20,
      getHeight: () => 32,
      getContainers: () => [],
      getEnemySpawns: () => []
    };
    const fog = new Uint8Array(20 * 32).fill(2);
    playfield.renderExploration(modLattice, fog, { x: 1, y: 1 });

    const gridFills = canvas.context.calls.filter(([n]) => n === 'fillRect').filter((c) => c[1] === '#3a3a3a');
    // No tick at (48,48) — (2,2) is a wall.
    expect(gridFills.some((c) => c[2] === 44 && c[3] === 48 && c[4] === 9 && c[5] === 1)).toBe(false);
    expect(gridFills.some((c) => c[2] === 48 && c[3] === 44 && c[4] === 1 && c[5] === 9)).toBe(false);
    // Tick at (96,96) — all four are traversable (open + container).
    expect(gridFills.some((c) => c[2] === 92 && c[3] === 96 && c[4] === 9 && c[5] === 1)).toBe(true);
    expect(gridFills.some((c) => c[2] === 96 && c[3] === 92 && c[4] === 1 && c[5] === 9)).toBe(true);
  });

  test('unrevealed neighbor at a corner suppresses the tick even when all four are traversable', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const fog = new Uint8Array(20 * 32).fill(2);
    // Hide (2,2). Corner at (48,48) touches (1,1)(2,1)(1,2)(2,2); (2,2) unrevealed → no tick.
    fog[2 * 20 + 2] = 0;
    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 });
    const gridFills = canvas.context.calls.filter(([n]) => n === 'fillRect').filter((c) => c[1] === '#3a3a3a');
    expect(gridFills.some((c) => c[2] === 44 && c[3] === 48 && c[4] === 9 && c[5] === 1)).toBe(false);
  });

  test('wall lines wrap in shadow-blur/alpha (WALL_GLOW_* range) and reset to defaults after the pass', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const fog = new Uint8Array(20 * 32).fill(2);
    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 });

    // Static glow (pulse disabled by default) sits at g=0.7 → the middle of [WALL_GLOW_BLUR/ALPHA].
    const g = 0.7;
    const expectedBlur = WALL_GLOW_BLUR[0] + g * (WALL_GLOW_BLUR[1] - WALL_GLOW_BLUR[0]);
    const expectedAlpha = WALL_GLOW_ALPHA[0] + g * (WALL_GLOW_ALPHA[1] - WALL_GLOW_ALPHA[0]);

    // Walk the recorded calls; while a cyan #7ec8e3 fillRect is emitted, shadowBlur/alpha must match.
    let currentBlur = 0;
    let currentAlpha = 1;
    const cyanBlurs = [];
    const cyanAlphas = [];
    for (const call of canvas.context.calls) {
      if (call[0] === 'set-shadow-blur') currentBlur = call[1];
      else if (call[0] === 'set-alpha') currentAlpha = call[1];
      else if (call[0] === 'fillRect' && call[1] === '#7ec8e3') { cyanBlurs.push(currentBlur); cyanAlphas.push(currentAlpha); }
    }
    expect(cyanBlurs.length).toBeGreaterThan(0);
    expect(cyanBlurs.every((v) => Math.abs(v - expectedBlur) < 1e-9)).toBe(true);
    expect(cyanAlphas.every((v) => Math.abs(v - expectedAlpha) < 1e-9)).toBe(true);

    // After the pass ends, the context is reset: shadow off, alpha back to 1.
    expect(canvas.context.shadowBlur).toBe(0);
    expect(canvas.context.globalAlpha).toBe(1);
  });

  test('setPulse(true) after a render starts an rAF loop that replays the last render; destroy() cancels and clears it', () => {
    const raf = [];
    const cancels = [];
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
    globalThis.cancelAnimationFrame = (id) => { cancels.push(id); };
    try {
      const canvas = new FakeCanvas();
      const playfield = createPlayfield(canvas);

      // Pulse on without a prior render schedules nothing.
      playfield.setPulse(true);
      expect(raf.length).toBe(0);

      const fog = new Uint8Array(20 * 32).fill(2);
      playfield.renderExploration(lattice(), fog, { x: 1, y: 1 });
      // First render with pulse on schedules an rAF frame.
      expect(raf.length).toBe(1);

      // Firing the frame replays the render (clearRect count grows) and schedules another rAF.
      const beforeClear = canvas.context.calls.filter((c) => c[0] === 'clearRect').length;
      raf[0](50);
      const afterClear = canvas.context.calls.filter((c) => c[0] === 'clearRect').length;
      expect(afterClear).toBeGreaterThan(beforeClear);
      expect(raf.length).toBe(2);

      // destroy() cancels the pending frame and clears state — no further rAFs scheduled.
      playfield.destroy();
      expect(cancels.length).toBe(1);
      raf[1](100);
      expect(raf.length).toBe(2);
    } finally {
      if (originalRaf) globalThis.requestAnimationFrame = originalRaf; else delete globalThis.requestAnimationFrame;
      if (originalCancel) globalThis.cancelAnimationFrame = originalCancel; else delete globalThis.cancelAnimationFrame;
    }
  });

  test('reduced-motion path (setPulse never enabled) never schedules a requestAnimationFrame frame', () => {
    const raf = [];
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
    try {
      const canvas = new FakeCanvas();
      const playfield = createPlayfield(canvas);
      const fog = new Uint8Array(20 * 32).fill(2);
      // Pulse defaults to false; simulate the reduced-motion branch by leaving setPulse false.
      playfield.setPulse(false);
      playfield.renderExploration(lattice(), fog, { x: 1, y: 1 });
      expect(raf.length).toBe(0);
      // Static wall glow still lands in the fill stream (proves walls rendered).
      const cyanFills = canvas.context.calls.filter((c) => c[0] === 'fillRect' && c[1] === '#7ec8e3');
      expect(cyanFills.length).toBeGreaterThan(0);
    } finally {
      if (originalRaf) globalThis.requestAnimationFrame = originalRaf; else delete globalThis.requestAnimationFrame;
    }
  });

  test('cellAtPoint returns null when no viewTransform is supplied (camera-window path retired)', () => {
    const canvas = new FakeCanvas();
    canvas.width = 384;
    canvas.height = 768;
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, right: 202, bottom: 404, width: 192, height: 384 });

    // No viewTransform → null. Legacy `camera` option is ignored (signature is
    // {canvas, cellSize, viewTransform}); callers must always supply viewTransform.
    expect(cellAtPoint({ canvas, cellSize: 48 }, 58, 68)).toBeNull();
    expect(cellAtPoint({ canvas, cellSize: 48, viewTransform: { scale: 0, dx: 0, dy: 0 } }, 58, 68)).toBeNull();
    // Outside the canvas rect returns null even when a viewTransform is provided.
    expect(cellAtPoint({ canvas, cellSize: 48, viewTransform: { scale: 1, dx: 0, dy: 0 } }, 5, 500)).toBeNull();
    expect(cellAtPoint({ canvas, cellSize: 48, viewTransform: { scale: 1, dx: 0, dy: 0 } }, 300, 30)).toBeNull();
  });

  test('writes accent only through CSS custom property; retired camera exports are gone', async () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);

    // Legacy `calculateCombatCamera` and `autoPan` exports were retired with the cell-window camera.
    const module = await import('../../src/ui/playfield.js');
    expect(module.calculateCombatCamera).toBeUndefined();
    expect(playfield.autoPan).toBeUndefined();
    expect(playfield.getCamera).toBeUndefined();

    expect(playfield.setAccent({ accent: '#123abc' })).toBe(true);
    expect(document.documentElement.style.properties['--accent']).toBe('#123abc');
    expect(playfield.setAccent('not-a-color')).toBe(false);
  });

  test('renderExploration with viewTransform applies setTransform(matrix) after clear and resets to identity at the end', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const fog = new Uint8Array(20 * 32).fill(2);
    const viewTransform = { scale: 2, dx: -48, dy: -96 };

    playfield.renderExploration(lattice(), fog, { x: 1, y: 1 }, { viewTransform });

    const transforms = canvas.context.calls.filter(([n]) => n === 'setTransform');
    // First: identity for clear. Second: view transform. Last: identity reset.
    expect(transforms.length).toBeGreaterThanOrEqual(3);
    expect(transforms[0].slice(1)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(transforms[1].slice(1)).toEqual([2, 0, 0, 2, -48, -96]);
    expect(transforms.at(-1).slice(1)).toEqual([1, 0, 0, 1, 0, 0]);

    // The view transform is applied AFTER clearRect (clear runs at identity so it wipes the full canvas).
    // setTransform args are [a=scale, b=0, c=0, d=scale, e=dx, f=dy] → destructured index 5 = dx.
    const clearIdx = canvas.context.calls.findIndex(([n]) => n === 'clearRect');
    const viewIdx = canvas.context.calls.findIndex(([n, s, , , , dx]) => n === 'setTransform' && s === 2 && dx === -48);
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(viewIdx).toBeGreaterThan(clearIdx);
  });

  test('combat + viewTransform draws the FULL window in world px: no camera window subtraction, no cull, aria uses WxH', () => {
    const canvas = new FakeCanvas();
    const playfield = createPlayfield(canvas);
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', position: { x: 3, y: 3 }, sigilCodepoint: 0xE000 }],
      // (18, 30) is outside the default 8×16 camera window — with viewTransform, it must still render.
      ['e1', { id: 'e1', side: 'enemy', position: { x: 18, y: 30 }, sigilCodepoint: 0xE030 }]
    ]);
    const viewTransform = { scale: 1, dx: 0, dy: 0 };

    playfield.renderCombat({ combatants, turnOrder: ['p1'], currentTurn: 0, round: 4 }, lattice(), {
      viewTransform,
      selectedTargetId: 'e1'
    });

    // The world is 20×32 cells at COMBAT_CELL_SIZE=48 → floor tiles reach x=(19)*48=912, y=(31)*48=1488.
    // The legacy camera-window path could NOT paint any tile beyond (8*48, 16*48) — proof that the
    // full window renders through the view transform.
    const fills = canvas.context.calls.filter(([n]) => n === 'fillRect');
    expect(fills.some((c) => c[2] === 19 * 48 && c[3] === 31 * 48)).toBe(true);

    // Aria description reflects world dimensions, not window window-corner coords.
    expect(canvas.getAttribute('aria-label')).toBe('Combat map, window 20x32, round 4.');

    // Selected enemy at (18, 30) is drawn at absolute world coords — no camera.x/y subtraction.
    // TARGET frame passes px+4/py+4, then drawFrame adds inset=2 → strokeRect at (18*48+6, 30*48+6).
    // In the legacy windowed path this actor sits outside the 8×16 window and would be culled entirely.
    const strokes = canvas.context.calls.filter(([n, style]) => n === 'strokeRect' && style === '#e83a3a');
    expect(strokes.some((c) => c[2] === 18 * 48 + 6 && c[3] === 30 * 48 + 6)).toBe(true);
  });

  test('cellAtPoint inverts a viewTransform under CSS scaling + dpr ≠ 1', () => {
    const canvas = new FakeCanvas();
    // Canvas backed by DPR=2: 40×40 CSS px displays as 80×80 device px.
    canvas.width = 80;
    canvas.height = 80;
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, right: 50, bottom: 60, width: 40, height: 40 });
    // View transform scale bakes dpr in already: worldScale=1, dpr=2 → viewTransform.scale=2, dx/dy in device px.
    // Panned so world (0,0) sits at device (-96, -96) (i.e. two 48-cell columns/rows scrolled out of view).
    const viewTransform = { scale: 2, dx: -96, dy: -96 };

    // Point at CSS (30, 40) → rect-relative (20, 20) → device (40, 40).
    // World px = (40 - -96) / 2 = 68 (both axes). At cellSize 48 → cell floor(68/48) = 1.
    expect(cellAtPoint({ canvas, cellSize: 48, viewTransform }, 30, 40)).toEqual({ x: 1, y: 1 });

    // Outside the rect still returns null in the viewTransform branch.
    expect(cellAtPoint({ canvas, cellSize: 48, viewTransform }, 5, 40)).toBeNull();
  });

  test('pulse replay preserves the viewTransform args across an rAF-triggered redraw', () => {
    const raf = [];
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
    try {
      const canvas = new FakeCanvas();
      const playfield = createPlayfield(canvas);
      playfield.setPulse(true);
      const fog = new Uint8Array(20 * 32).fill(2);
      const viewTransform = { scale: 3, dx: -12, dy: -24 };

      playfield.renderExploration(lattice(), fog, { x: 1, y: 1 }, { viewTransform });
      expect(raf.length).toBe(1);

      // Frame replay must reapply the same view transform (not fall back to identity).
      // setTransform args are [a=scale, b=0, c=0, d=scale, e=dx, f=dy] → destructured index 5 = dx.
      const matchView = ([n, s, , , , dx]) => n === 'setTransform' && s === 3 && dx === -12;
      const beforeCount = canvas.context.calls.filter(matchView).length;
      raf[0](50);
      const afterCount = canvas.context.calls.filter(matchView).length;
      expect(beforeCount).toBeGreaterThan(0);
      expect(afterCount).toBeGreaterThan(beforeCount);
      playfield.destroy();
    } finally {
      if (originalRaf) globalThis.requestAnimationFrame = originalRaf; else delete globalThis.requestAnimationFrame;
    }
  });
});
