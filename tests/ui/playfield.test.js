import { beforeEach, describe, expect, test } from 'vitest';
import { calculateCombatCamera, createPlayfield } from '../../src/ui/playfield.js';

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
  constructor() { this.calls = []; }
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
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.listeners.size).toBe(0);
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
