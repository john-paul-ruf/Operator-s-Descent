import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { createRunState } from '../../src/state/run-state.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { makeGrid } from '../helpers/grids.js';
import { loadData } from '../helpers/data.js';

const gameData = {
  themes: loadData('themes'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes'),
  consumables: loadData('consumables'),
};

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) { const next = force == null ? !this.values.has(name) : Boolean(force); if (next) this.values.add(name); else this.values.delete(name); this.sync(); return next; }
  contains(name) { return this.values.has(name); }
  sync() { this.element._className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = { properties: {}, setProperty(name, value) { this.properties[name] = value; }, removeProperty(name) { delete this.properties[name]; } };
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.disabled = false;
    this.tabIndex = -1;
    this.hidden = false;
    this.parentNode = null;
    this._boundingRect = null;
    this._pointerCapture = new Set();
  }
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return this._className; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; return child; }
  replaceChildren(...children) { this.children = []; for (const child of children) this.appendChild(child); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, repeat: false, preventDefault() { this.prevented = true; }, ...event }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return this._boundingRect || { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }; }
  setPointerCapture(id) { this._pointerCapture.add(id); }
  releasePointerCapture(id) { this._pointerCapture.delete(id); }
  contains(node) {
    let cursor = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parentNode;
    }
    return false;
  }
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

function installDocument() {
  globalThis.document = {
    documentElement: new FakeElement('html'),
    createElement: (tagName) => tagName === 'canvas' ? new FakeCanvas() : new FakeElement(tagName),
    createTextNode: (value) => { const node = new FakeElement('#text'); node.textContent = value; return node; }
  };
}

function installMatchMedia(match) {
  globalThis.window = globalThis.window || {};
  globalThis.window.matchMedia = () => ({ matches: Boolean(match), addEventListener() {}, removeEventListener() {} });
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
    if (found) return found;
  }
  return null;
}

function byClass(root, className) {
  if (root.classList?.contains(className)) return root;
  for (const child of root.children || []) {
    const found = byClass(child, className);
    if (found) return found;
  }
  return null;
}

function textOf(root) {
  return [root.textContent, ...(root.children || []).flatMap((child) => textOf(child))].filter(Boolean).join(' ');
}

function keyEvent(code) {
  return { code, key: code, repeat: false, preventDefault() { this.prevented = true; } };
}

function floor(overrides = {}) {
  const cells = makeGrid(40, 64, 1);
  return {
    cells,
    entryPoint: { x: 10, y: 10 },
    descentPoint: { x: 10, y: 30 },
    containers: [],
    enemySpawns: [],
    themeId: 'cold_storage',
    floorSubSeed: 0,
    ...overrides
  };
}

function runState() {
  const character = makeCharacter({
    id: 'breacher-1',
    classId: 'breacher',
    sigilId: 'pua-e000',
    currentHP: 30,
    currentCHARGE: 10,
    protocolDeck: []
  });
  return createRunState(1234, [character], { partyPosition: { x: 10, y: 10 } });
}

async function mountExploration(setup = {}) {
  const container = new FakeElement('div');
  const { mount } = await import('../../src/ui/screens/exploration.js');
  const state = setup.runState || runState();
  const controller = mount(container, { runState: state, floor: setup.floor || floor(), data: gameData });
  return { container, controller, runState: state };
}

// Attach a bounding rect that lets tap/gesture math resolve deterministically.
function sizeBody(container, { width = 100, height = 100 } = {}) {
  const playfieldBody = byClass(container, 'exploration-playfield');
  const canvas = byTestId(container, 'exploration-canvas');
  playfieldBody._boundingRect = { width, height, left: 0, top: 0, right: width, bottom: height };
  // Canvas fills body via 100%/100% inline styles; rect matches body.
  canvas._boundingRect = { width, height, left: 0, top: 0, right: width, bottom: height };
  return { playfieldBody, canvas };
}

// zoomToCells(24, 40): body 480×768 vs world 960×1536 → fitScale 0.5 → scale = clamp(40/24, 0.5, 4) = 5/3.
// Camera centers the party at the canvas center; one world cell = 24 * 5/3 = 40 screen px.
const CELL_PX = 24;
const SCALE = 40 / CELL_PX;
const CENTER = { x: 240, y: 384 };
function cellToClient(dxCells, dyCells) {
  return {
    x: CENTER.x + dxCells * CELL_PX * SCALE,
    y: CENTER.y + dyCells * CELL_PX * SCALE
  };
}

beforeEach(() => { installDocument(); installMatchMedia(false); });
afterEach(() => { delete globalThis.document; delete globalThis.window; });

describe('exploration screen controller', () => {
  it('composes the pinned status alert playfield and console shell in mock order', async () => {
    const { container } = await mountExploration();
    const canvas = byTestId(container, 'exploration-canvas');
    const alert = byTestId(container, 'alert-banner');
    const playfieldBody = byClass(container, 'exploration-playfield');

    expect(container.classList.contains('exploration-screen')).toBe(true);
    expect(container.children.map((child) => child.className)).toEqual([
      expect.stringContaining('status-strip'),
      'alert-banner',
      'exploration-playfield playfield-body',
      expect.stringContaining('console-bar')
    ]);
    expect(alert.hidden).toBe(true);
    expect(alert.textContent).toBe('◈ HOSTILE DETECTED — MOVEMENT HALTED — TAP TO ENGAGE');
    expect(playfieldBody.style.overflow).toBe('hidden');
    // SESSION-04 Fix B: canvas + eligible-container marker overlay.
    const marker = byTestId(container, 'loot-eligible-marker');
    expect(playfieldBody.children).toEqual([canvas, marker]);
    expect([canvas.width, canvas.height]).toEqual([480, 768]);
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.height).toBe('100%');
    expect(canvas.classList.contains('lattice-canvas')).toBe(true);
  });

  it('arrow key moves the party immediately (no staging) and updates audio', async () => {
    const audio = [];
    const off = bus.on('audio:update-state', (payload) => audio.push(payload));
    const { container, runState: state } = await mountExploration();

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toContain('MOVED');
    expect(audio.at(-1).proximity).toEqual({ hostile: null, container: null });
    off();
  });

  it('requests combat on hostile discovery when the immediate move lands next to a hostile', async () => {
    const combat = [];
    const off = bus.on('state:combat-start', (payload) => combat.push(payload));
    const hostileFloor = floor({ enemySpawns: [{ id: 0, x: 12, y: 10, archetypeId: 'drone' }] });
    const { container, runState: state } = await mountExploration({ floor: hostileFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(combat).toHaveLength(1);
    expect(combat[0]).toMatchObject({ runState: state, floor: hostileFloor, reason: 'hostile', encounter: expect.objectContaining({ kind: 'standard' }), moveResult: expect.objectContaining({ interruptType: 'hostile', combatContact: true }) });
    off();
  });

  it('far hostile sighting posts SIGHTED notice and does NOT start combat', async () => {
    const combat = [];
    const off = bus.on('state:combat-start', (payload) => combat.push(payload));
    const farHostileFloor = floor({ enemySpawns: [{ id: 0, x: 16, y: 10, archetypeId: 'drone' }] });
    const { container } = await mountExploration({ floor: farHostileFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(combat).toHaveLength(0);
    expect(byTestId(container, 'move-notice').textContent).toContain('SIGHTED');
    expect(byTestId(container, 'alert-banner').hidden).toBe(false);
    off();
  });

  it('enables LOOT only for an unopened adjacent container discovered by the immediate move', async () => {
    const opens = [];
    const off = bus.on('loot:open-request', (payload) => opens.push(payload));
    const lootFloor = floor({ containers: [{ id: 0, x: 12, y: 10 }] });
    const { container } = await mountExploration({ floor: lootFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(byTestId(container, 'console-tab-loot').getAttribute('aria-selected')).toBe('true');
    expect(textOf(byTestId(container, 'loot-container'))).toContain('CONTAINER 0');
    byTestId(container, 'loot-open').click();
    expect(opens).toHaveLength(1);
    expect(opens[0].container).toMatchObject({ id: 0, x: 12, y: 10 });
    off();
  });

  it('honors discovery auto-stop toggle while preserving immediate movement', async () => {
    const farContainerFloor = floor({ containers: [{ id: 0, x: 13, y: 10 }] });
    const { container, runState: state } = await mountExploration({ floor: farContainerFloor });

    byTestId(container, 'toggle-discovery').click();
    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    expect(byTestId(container, 'console-tab-loot').disabled).toBe(true);
    expect(textOf(container)).not.toContain('CONTAINER DISCOVERED');
  });

  it('confirm on the descent cell requests floor-change (single-tap descent flow, no staging)', async () => {
    const changes = [];
    const off = bus.on('state:floor-change', (payload) => changes.push(payload));
    const descentFloor = floor({ descentPoint: { x: 11, y: 10 } });
    descentFloor.cells[10][11] = 3;
    const { container, runState: state } = await mountExploration({ floor: descentFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));
    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    expect(changes).toHaveLength(0);
    byTestId(container, 'move-confirm').click();
    expect(changes).toEqual([expect.objectContaining({ runState: state, floor: descentFloor, reason: 'descent-confirmed' })]);
    off();
  });

  it('tears down input and subscriptions on unmount', async () => {
    const { container, controller, runState: state } = await mountExploration();
    controller.unmount();

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
  });

  it('unmount destroys the playfield pulse loop so no further rAF frames are scheduled', async () => {
    const raf = [];
    const cancels = [];
    const originalRaf = globalThis.window?.requestAnimationFrame;
    const originalCancel = globalThis.window?.cancelAnimationFrame;
    globalThis.window = globalThis.window || {};
    globalThis.window.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
    globalThis.window.cancelAnimationFrame = (id) => { cancels.push(id); };
    globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
    try {
      const { controller } = await mountExploration();
      const scheduledBefore = raf.length;
      expect(scheduledBefore).toBeGreaterThan(0);
      controller.unmount();
      const lastCallback = raf[raf.length - 1];
      raf.length = 0;
      lastCallback(16);
      expect(raf.length).toBe(0);
      expect(cancels.length).toBeGreaterThan(0);
    } finally {
      if (originalRaf) globalThis.window.requestAnimationFrame = originalRaf; else delete globalThis.window.requestAnimationFrame;
      if (originalCancel) globalThis.window.cancelAnimationFrame = originalCancel; else delete globalThis.window.cancelAnimationFrame;
      delete globalThis.requestAnimationFrame;
      delete globalThis.cancelAnimationFrame;
    }
  });

  it('a sub-threshold drag ending on the party cell does not move the party (tap-on-self ignored)', async () => {
    const { container, runState: state } = await mountExploration();
    const { playfieldBody } = sizeBody(container, { width: 480, height: 768 });

    // Body 480×768 vs world 960×1536 → fitScale 0.5; primeCamera calls zoomToCells(24, 40) →
    // scale clamp(5/3, 0.5, 4) = 5/3 and centers party (10,10) at canvas center (240, 384).
    // A +2px pointermove stays under the 6px drag threshold → tap fires; tap on party is ignored.
    const down = cellToClient(0, 0);
    playfieldBody.dispatch('pointerdown', { pointerId: 1, clientX: down.x, clientY: down.y });
    playfieldBody.dispatch('pointermove', { pointerId: 1, clientX: down.x + 2, clientY: down.y + 2 });
    playfieldBody.dispatch('pointerup', { pointerId: 1 });

    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
  });

  it('a drag past 6px pans (camera state.x/y move) and does not move the party', async () => {
    const { container, runState: state } = await mountExploration();
    const { playfieldBody } = sizeBody(container, { width: 480, height: 768 });

    playfieldBody.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    playfieldBody.dispatch('pointermove', { pointerId: 1, clientX: 40, clientY: 40 });
    playfieldBody.dispatch('pointerup', { pointerId: 1 });

    // Party never moves from a drag alone (no tap fires — moved past threshold).
    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
  });

  it('tap on a revealed reachable cell runs the party along a BFS path immediately', async () => {
    const { container, runState: state } = await mountExploration();
    const { playfieldBody } = sizeBody(container, { width: 480, height: 768 });

    // Body 480×768 vs world 960×1536 (40×24, 64×24) → fitScale 0.5. primeCamera runs
    // zoomToCells(24, 40) → scale clamp(5/3, 0.5, 4) = 5/3 and centers party (10,10) at
    // canvas center (240, 384). One world cell = 40 screen px. Tap on world cell (11,10) →
    // client (280, 384). Below drag threshold → fires as tap; BFS finds [e]; executes immediately.
    const tap = cellToClient(1, 0);
    playfieldBody.dispatch('pointerdown', { pointerId: 3, clientX: tap.x, clientY: tap.y });
    playfieldBody.dispatch('pointerup', { pointerId: 3, clientX: tap.x, clientY: tap.y });

    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
  });

  it('tap on an unreachable cell posts NO PATH and does not move the party', async () => {
    // Ring the party with walls so no move is possible.
    const walledFloor = floor();
    walledFloor.cells[9][9] = 0; walledFloor.cells[9][10] = 0; walledFloor.cells[9][11] = 0;
    walledFloor.cells[10][9] = 0; walledFloor.cells[10][11] = 0;
    walledFloor.cells[11][9] = 0; walledFloor.cells[11][10] = 0; walledFloor.cells[11][11] = 0;
    const { container, runState: state } = await mountExploration({ floor: walledFloor });
    const { playfieldBody } = sizeBody(container, { width: 480, height: 768 });

    // Tap on (15, 15), an unreachable open cell.
    playfieldBody.dispatch('pointerdown', { pointerId: 4, clientX: 15 * 24 + 12, clientY: 15 * 24 + 12 });
    playfieldBody.dispatch('pointerup', { pointerId: 4 });

    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toBe('NO PATH.');
  });

  it('tap-to-move truncates on hostile interrupt', async () => {
    const combat = [];
    const off = bus.on('state:combat-start', (payload) => combat.push(payload));
    const hostileFloor = floor({ enemySpawns: [{ id: 0, x: 13, y: 10, archetypeId: 'drone' }] });
    const { container, runState: state } = await mountExploration({ floor: hostileFloor });
    const { playfieldBody } = sizeBody(container, { width: 480, height: 768 });

    // Tap on (14,10): BFS path [e,e,e,e]. First step (11,10) does not see hostile; second (12,10)
    // reveals hostile at (13,10) → interrupt → truncate.
    playfieldBody.dispatch('pointerdown', { pointerId: 5, clientX: 14 * 24 + 12, clientY: 10 * 24 + 12 });
    playfieldBody.dispatch('pointerup', { pointerId: 5 });

    expect(combat).toHaveLength(1);
    // Party halted before reaching (14,10); at least one step happened but not all four.
    expect(state.partyPosition.x).toBeGreaterThan(10);
    expect(state.partyPosition.x).toBeLessThan(14);
    off();
  });

  it('focuses the container on mount so arrow keys work without a prior click', async () => {
    const { container } = await mountExploration();
    expect(container.focused).toBe(true);
  });

  it('refocuses the container on pointerdown when focus has drifted elsewhere', async () => {
    const { container } = await mountExploration();
    const playfieldBody = byClass(container, 'exploration-playfield');
    container.focused = false;
    const other = new FakeElement('div');
    globalThis.document.activeElement = other;

    playfieldBody.dispatch('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    expect(container.focused).toBe(true);

    globalThis.document.activeElement = container;
    container.focused = false;
    playfieldBody.dispatch('pointerdown', { pointerId: 2, clientX: 20, clientY: 20 });
    expect(container.focused).toBe(false);

    delete globalThis.document.activeElement;
  });

  it('does not steal focus from a console child that already holds it', async () => {
    const { container } = await mountExploration();
    const playfieldBody = byClass(container, 'exploration-playfield');
    const button = byTestId(container, 'toggle-discovery');
    globalThis.document.activeElement = button;
    container.focused = false;

    playfieldBody.dispatch('pointerdown', { pointerId: 1, clientX: 5, clientY: 5 });
    expect(container.focused).toBe(false);

    delete globalThis.document.activeElement;
  });

  it('routes console:intent move_* actions from panes that decline the input into an immediate move', async () => {
    const { container, runState: state } = await mountExploration();
    bus.dispatch('console:intent', { mode: 'gear', action: 'move_e', source: 'keyboard' });
    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toContain('MOVED');
  });

  it('routes each console:intent direction into an immediate move', async () => {
    const directions = ['move_n', 'move_s', 'move_w', 'move_ne', 'move_nw', 'move_se', 'move_sw'];
    for (const action of directions) {
      const { runState: state } = await mountExploration();
      bus.dispatch('console:intent', { mode: 'gear', action, source: 'keyboard' });
      expect(state.partyPosition).not.toEqual({ x: 10, y: 10 });
    }
  });

  it('ignores console:intent moves when combat is active', async () => {
    const state = runState();
    state.activeCombat = { round: 1 };
    const { runState: mounted } = await mountExploration({ runState: state });
    bus.dispatch('console:intent', { mode: 'gear', action: 'move_e', source: 'keyboard' });
    expect(mounted.partyPosition).toEqual({ x: 10, y: 10 });
  });

  it('ignores non-move console:intent actions', async () => {
    const { runState: state } = await mountExploration();
    bus.dispatch('console:intent', { mode: 'gear', action: 'inspect', source: 'keyboard' });
    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
  });

  it('stops routing console:intent after unmount', async () => {
    const { container, controller, runState: state } = await mountExploration();
    controller.unmount();
    bus.dispatch('console:intent', { mode: 'gear', action: 'move_e', source: 'keyboard' });
    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
    expect(byTestId(container, 'move-notice')).toBe(null);
  });

  it('renders the three-region wide shell with telemetry, playfield column, and dock', async () => {
    installMatchMedia(true);
    const { container } = await mountExploration();
    const shell = byTestId(container, 'wide-shell');

    expect(shell).not.toBe(null);
    expect(shell.className).toContain('wide-shell');
    expect(shell.dataset.wideRoot).toBe('');
    expect(shell.children.map((child) => child.className.split(/\s+/)[0])).toEqual(
      expect.arrayContaining(['wide-telemetry-dock', 'wide-playfield-column', 'wide-console-dock'])
    );
    const alert = byTestId(container, 'alert-banner');
    expect(alert).not.toBe(null);
    expect(alert.className.split(/\s+/)).toContain('playfield-alert-banner');
    expect(byTestId(container, 'exploration-canvas')).not.toBe(null);
    expect(byTestId(container, 'telemetry-dock')).not.toBe(null);
    expect(byTestId(container, 'console-tab-move').getAttribute('aria-selected')).toBe('true');
    expect(byTestId(container, 'console-tab-combat').disabled).toBe(true);
    expect(byClass(container, 'console-dim-layer')).toBe(null);
  });

  it('wide mount attaches pane handles + collapse buttons and cleans them up on unmount', async () => {
    installMatchMedia(true);
    const { container, controller } = await mountExploration();

    expect(byTestId(container, 'pane-handle-left')).not.toBe(null);
    expect(byTestId(container, 'pane-handle-right')).not.toBe(null);
    expect(byTestId(container, 'pane-collapse-left')).not.toBe(null);
    expect(byTestId(container, 'pane-collapse-right')).not.toBe(null);

    controller.unmount();

    expect(byTestId(container, 'pane-handle-left')).toBe(null);
    expect(byTestId(container, 'pane-handle-right')).toBe(null);
    expect(byTestId(container, 'pane-collapse-left')).toBe(null);
    expect(byTestId(container, 'pane-collapse-right')).toBe(null);
  });

  it('portrait mount does not attach pane handles or collapse buttons', async () => {
    const { container } = await mountExploration();
    expect(byTestId(container, 'pane-handle-left')).toBe(null);
    expect(byTestId(container, 'pane-handle-right')).toBe(null);
    expect(byTestId(container, 'pane-collapse-left')).toBe(null);
    expect(byTestId(container, 'pane-collapse-right')).toBe(null);
  });

  it('blocked keyboard move (wall) posts BLOCKED notice and does not move the party', async () => {
    const walledFloor = floor();
    walledFloor.cells[10][11] = 0;
    const { container, runState: state } = await mountExploration({ floor: walledFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toBe('BLOCKED — wall or closed corner.');
  });

  it('camera snaps to the party cell after every party move (SESSION-04 lock)', async () => {
    const { container } = await mountExploration();
    const { canvas } = sizeBody(container, { width: 480, height: 768 });
    // Start position (10,10). Move east twice; each move re-centers the camera.
    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    // Look at the LAST viewTransform baked into the canvas — its dx/dy should
    // place world cell (12,10) at the viewport center.
    const transforms = canvas.context.calls.filter(([n]) => n === 'setTransform');
    // Ignore identity transforms; find the last non-identity view transform.
    const viewTransforms = transforms.filter((c) => !(c[1] === 1 && c[5] === 0 && c[6] === 0));
    const last = viewTransforms.at(-1);
    expect(last).toBeDefined();
    // setTransform args (a=scale, b, c, d, e=dx, f=dy).
    const scale = last[1];
    const dx = last[5];
    const dy = last[6];
    // World px center of cell (12,10) = (12*24+12, 10*24+12) = (300, 252).
    // After the view transform, that world point maps to canvas coord
    // (300*scale + dx, 252*scale + dy) — which must equal the canvas center
    // (240, 384) (canvas 480×768, dpr 1 → scale 40/24=5/3).
    const cx = 300 * scale + dx;
    const cy = 252 * scale + dy;
    expect(cx).toBeCloseTo(240, 1);
    expect(cy).toBeCloseTo(384, 1);
  });

  it('mount prunes empty-loot containers so they never trigger a container interrupt', async () => {
    const lootModule = await import('../../src/exploration/movement.js');
    // We can't easily stub inside movement.js here — instead stub the loot
    // generator so the empty container path fires deterministically.
    const loot = await import('../../src/rules/loot.js');
    const spy = vi.spyOn(loot, 'generateLoot').mockReturnValue([]);
    try {
      const cachedFloor = floor({ containers: [{ id: 0, x: 12, y: 10, kind: 'cache' }] });
      const { container, controller, runState: state } = await mountExploration({ floor: cachedFloor });
      try {
        // Move east into the container cell — normally would fire a container
        // interrupt. With pruning, the container is culled and no interrupt fires.
        container.dispatch('keydown', keyEvent('ArrowRight'));
        expect(state.partyPosition).toEqual({ x: 11, y: 10 });
        // Loot pane should not be selected because the container interrupt never fired.
        expect(byTestId(container, 'console-tab-loot').getAttribute('aria-selected')).not.toBe('true');
      } finally {
        controller.unmount();
      }
    } finally {
      spy.mockRestore();
    }
  });

  // SESSION-04 Fix B — the loot-eligible marker is a DOM overlay pinned to the
  // currently-eligible container's cell via camera-state math. See the audit
  // note above refreshLootState in src/ui/screens/exploration.js for why the
  // marker (not a distance widen) is the chosen fix.
  //
  // Camera math for these tests: playfieldBody has no bounding rect in the fake
  // DOM → resizeCanvas fallback primes the camera to canvas.width×height
  // (480×768) vs world 960×1536 → fitScale 0.5; zoomToCells(24, 40) → scale
  // clamp(5/3, 0.5, 4) = 5/3. centerOn party (10,10) center (252, 252) → state.x
  // = 108, state.y = 21.6 (clamp bounds 0..672 / 0..1075.2 — both in-range).
  it('renders the loot-eligible marker positioned over an adjacent unopened container', async () => {
    const containerFloor = floor({ containers: [{ id: 0, x: 11, y: 10 }] });
    const { container } = await mountExploration({ floor: containerFloor });
    const marker = byTestId(container, 'loot-eligible-marker');

    expect(marker).not.toBe(null);
    expect(marker.hidden).toBe(false);
    // Container (11,10) center: worldX = 11*24 + 12 = 276, worldY = 252.
    // cssX = (276 − 108) * 5/3 = 280; cssY = (252 − 21.6) * 5/3 = 384.
    expect(marker.style.left).toBe('280px');
    expect(marker.style.top).toBe('384px');
  });

  it('hides the loot-eligible marker on mount when no container is adjacent', async () => {
    const { container } = await mountExploration();
    const marker = byTestId(container, 'loot-eligible-marker');
    expect(marker).not.toBe(null);
    expect(marker.hidden).toBe(true);
  });

  it('hides the loot-eligible marker after the party steps away from the container', async () => {
    const containerFloor = floor({ containers: [{ id: 0, x: 11, y: 10 }] });
    const { container, runState: state } = await mountExploration({ floor: containerFloor });
    const marker = byTestId(container, 'loot-eligible-marker');
    expect(marker.hidden).toBe(false);

    // Move west: party (10,10) → (9,10) → Chebyshev 2 from container (11,10),
    // eligibility drops synchronously via refreshLootState → renderPlayfield
    // → positionEligibleMarker (regression against Issue K: loot/map sync).
    container.dispatch('keydown', keyEvent('ArrowLeft'));

    expect(state.partyPosition).toEqual({ x: 9, y: 10 });
    expect(marker.hidden).toBe(true);
  });

  it('shows the loot-eligible marker after the party moves into range of a container', async () => {
    // Container two east of the party — not eligible on mount.
    const containerFloor = floor({ containers: [{ id: 0, x: 12, y: 10 }] });
    const { container } = await mountExploration({ floor: containerFloor });
    const marker = byTestId(container, 'loot-eligible-marker');
    expect(marker.hidden).toBe(true);

    // Step east → party (11,10), container (12,10) → Chebyshev 1, eligible.
    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(marker.hidden).toBe(false);
    // Container (12,10) center: worldX = 12*24 + 12 = 300, worldY = 252.
    // Camera re-centered on party (11,10) after move → new worldCenter (276,252)
    // → state.x = 276 − 144 = 132 (clamped to ≤672, in range), state.y = 21.6.
    // cssX = (300 − 132) * 5/3 = 280; cssY = (252 − 21.6) * 5/3 = 384.
    expect(marker.style.left).toBe('280px');
    expect(marker.style.top).toBe('384px');
  });

  it('user pan sets userAdjusted=true and preserves camera between moves; next party move re-centers', async () => {
    const { container } = await mountExploration();
    const { playfieldBody, canvas } = sizeBody(container, { width: 480, height: 768 });

    // Capture the initial view transform (camera centered on party (10,10)).
    let transforms = canvas.context.calls.filter(([n]) => n === 'setTransform');
    let viewTransforms = transforms.filter((c) => !(c[1] === 1 && c[5] === 0 && c[6] === 0));
    const initialView = viewTransforms.at(-1);

    // User drags past the threshold — camera pans and userAdjusted becomes true.
    playfieldBody.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    playfieldBody.dispatch('pointermove', { pointerId: 1, clientX: 40, clientY: 40 });
    playfieldBody.dispatch('pointerup', { pointerId: 1 });

    // The view transform after the drag should differ from the initial one.
    transforms = canvas.context.calls.filter(([n]) => n === 'setTransform');
    viewTransforms = transforms.filter((c) => !(c[1] === 1 && c[5] === 0 && c[6] === 0));
    const afterDragView = viewTransforms.at(-1);
    // dx or dy shifted by the pan.
    const panned = afterDragView[5] !== initialView[5] || afterDragView[6] !== initialView[6];
    expect(panned).toBe(true);

    // Now move the party — the camera should re-center on the party cell.
    container.dispatch('keydown', keyEvent('ArrowRight'));
    transforms = canvas.context.calls.filter(([n]) => n === 'setTransform');
    viewTransforms = transforms.filter((c) => !(c[1] === 1 && c[5] === 0 && c[6] === 0));
    const afterMoveView = viewTransforms.at(-1);
    const scale = afterMoveView[1];
    const dx = afterMoveView[5];
    const dy = afterMoveView[6];
    // Party is at (11,10). Canvas coords of that world center should map to (240,384).
    const cx = (11 * 24 + 12) * scale + dx;
    const cy = (10 * 24 + 12) * scale + dy;
    expect(cx).toBeCloseTo(240, 1);
    expect(cy).toBeCloseTo(384, 1);
  });
});
