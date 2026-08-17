import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { createRunState } from '../../src/state/run-state.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { makeGrid } from '../helpers/grids.js';
import { loadData } from '../helpers/data.js';

const gameData = { themes: loadData('themes') };

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
    this.style = { properties: {}, setProperty(name, value) { this.properties[name] = value; } };
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
  getBoundingClientRect() { return this._boundingRect || { width: 0, height: 0, left: 0, top: 0 }; }
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
  const cells = makeGrid(20, 32, 1);
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
    expect(playfieldBody.children).toEqual([canvas]);
    expect([canvas.width, canvas.height]).toEqual([480, 768]);
    expect(canvas.classList.contains('lattice-canvas')).toBe(true);
  });

  it('routes keyboard movement through MOVE: arrow stages, Enter commits (party moves + audio update)', async () => {
    const audio = [];
    const off = bus.on('audio:update-state', (payload) => audio.push(payload));
    const { container, runState: state } = await mountExploration();

    container.dispatch('keydown', keyEvent('ArrowRight'));
    // Stage-only: party has not moved yet, notice reflects the staged step.
    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toContain('STAGED 1 STEP');

    container.dispatch('keydown', keyEvent('Enter'));
    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toContain('MOVED');
    expect(audio.at(-1).proximity).toEqual({ hostile: null, container: null });
    off();
  });

  it('requests combat on hostile discovery when the staged commit lands next to a hostile', async () => {
    const combat = [];
    const off = bus.on('state:combat-start', (payload) => combat.push(payload));
    const hostileFloor = floor({ enemySpawns: [{ id: 0, x: 12, y: 10, archetypeId: 'drone' }] });
    const { container, runState: state } = await mountExploration({ floor: hostileFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('Enter'));

    expect(combat).toHaveLength(1);
    expect(combat[0]).toMatchObject({ runState: state, floor: hostileFloor, reason: 'hostile', encounter: expect.objectContaining({ kind: 'standard' }), moveResult: expect.objectContaining({ interruptType: 'hostile' }) });
    off();
  });

  it('enables LOOT only for an unopened adjacent container discovered by the committed staged step', async () => {
    const opens = [];
    const off = bus.on('loot:open-request', (payload) => opens.push(payload));
    const lootFloor = floor({ containers: [{ id: 0, x: 12, y: 10 }] });
    const { container } = await mountExploration({ floor: lootFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('Enter'));

    expect(byTestId(container, 'console-tab-loot').getAttribute('aria-selected')).toBe('true');
    expect(textOf(byTestId(container, 'loot-container'))).toContain('CONTAINER 0');
    byTestId(container, 'loot-open').click();
    expect(opens).toHaveLength(1);
    expect(opens[0].container).toMatchObject({ id: 0, x: 12, y: 10 });
    off();
  });

  it('honors discovery auto-stop toggle while preserving movement (stage → commit)', async () => {
    const farContainerFloor = floor({ containers: [{ id: 0, x: 13, y: 10 }] });
    const { container, runState: state } = await mountExploration({ floor: farContainerFloor });

    byTestId(container, 'toggle-discovery').click();
    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('Enter'));

    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    expect(byTestId(container, 'console-tab-loot').disabled).toBe(true);
    expect(textOf(container)).not.toContain('CONTAINER DISCOVERED');
  });

  it('requests floor transition only from confirm on the descent cell (stage → commit → confirm descend)', async () => {
    const changes = [];
    const off = bus.on('state:floor-change', (payload) => changes.push(payload));
    const descentFloor = floor({ descentPoint: { x: 11, y: 10 } });
    descentFloor.cells[10][11] = 3;
    const { container, runState: state } = await mountExploration({ floor: descentFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));
    expect(changes).toHaveLength(0);
    // First confirm: commit the staged step (party moves onto descent).
    byTestId(container, 'move-confirm').click();
    expect(changes).toHaveLength(0);
    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    // Second confirm: nothing staged + standing on descent → onConfirmDescent.
    byTestId(container, 'move-confirm').click();
    expect(changes).toEqual([expect.objectContaining({ runState: state, floor: descentFloor, reason: 'descent-confirmed' })]);
    off();
  });

  it('tears down input and subscriptions on unmount', async () => {
    const { container, controller, runState: state } = await mountExploration();
    controller.unmount();

    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('Enter'));

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
      // A pulse-enabled mount schedules at least one rAF frame after the first render.
      expect(scheduledBefore).toBeGreaterThan(0);
      controller.unmount();
      // Firing the last-scheduled frame after destroy must NOT schedule another one.
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

  it('does not pan the canvas while the drag stays inside the 6px threshold', async () => {
    const { container } = await mountExploration();
    const playfieldBody = byClass(container, 'exploration-playfield');
    const canvas = byTestId(container, 'exploration-canvas');
    playfieldBody._boundingRect = { width: 100, height: 100, left: 0, top: 0 };
    canvas._boundingRect = { width: 480, height: 768, left: 0, top: 0 };

    playfieldBody.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    playfieldBody.dispatch('pointermove', { pointerId: 1, clientX: 103, clientY: 103 });

    expect(canvas.style.transform).toBe('translate3d(0px, 0px, 0)');
  });

  it('pans the canvas and clamps to the body/canvas overflow bounds', async () => {
    const { container } = await mountExploration();
    const playfieldBody = byClass(container, 'exploration-playfield');
    const canvas = byTestId(container, 'exploration-canvas');
    playfieldBody._boundingRect = { width: 300, height: 500, left: 0, top: 0 };
    canvas._boundingRect = { width: 480, height: 768, left: 0, top: 0 };

    playfieldBody.dispatch('pointerdown', { pointerId: 1, clientX: 200, clientY: 200 });
    playfieldBody.dispatch('pointermove', { pointerId: 1, clientX: -10000, clientY: -10000 });

    // minX = 300 - 480 = -180, minY = 500 - 768 = -268
    expect(canvas.style.transform).toBe('translate3d(-180px, -268px, 0)');
    expect(playfieldBody._pointerCapture.has(1)).toBe(true);

    playfieldBody.dispatch('pointerup', { pointerId: 1 });
    expect(playfieldBody._pointerCapture.has(1)).toBe(false);
  });

  it('preventDefault on touchmove while a drag is active to stop page scroll', async () => {
    const { container } = await mountExploration();
    const playfieldBody = byClass(container, 'exploration-playfield');
    playfieldBody._boundingRect = { width: 100, height: 100, left: 0, top: 0 };

    let idlePrevented = false;
    playfieldBody.dispatch('touchmove', { preventDefault: () => { idlePrevented = true; } });
    expect(idlePrevented).toBe(false);

    playfieldBody.dispatch('pointerdown', { pointerId: 2, clientX: 50, clientY: 50 });
    let activePrevented = false;
    playfieldBody.dispatch('touchmove', { preventDefault: () => { activePrevented = true; } });
    expect(activePrevented).toBe(true);
  });

  it('auto-follows the party after a committed staged step so it stays in view', async () => {
    const { container } = await mountExploration();
    const playfieldBody = byClass(container, 'exploration-playfield');
    const canvas = byTestId(container, 'exploration-canvas');
    playfieldBody._boundingRect = { width: 100, height: 100, left: 0, top: 0 };
    canvas._boundingRect = { width: 480, height: 768, left: 0, top: 0 };

    // Party at (10,10) → pixel (252,252). Body 100×100 makes party far off-screen.
    // Stage east → still at (10,10). Enter (commit) → party at (11,10) → pixel (276,252).
    // From panOffset (0,0), visibleRight - marginX = 100 - 48 = 52; party.x = 276 → dx = 52 - 276 = -224.
    // Same math for y → dy = 52 - 252 = -200. Both stay inside [minX -380, 0] / [minY -668, 0].
    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('Enter'));

    expect(canvas.style.transform).toBe('translate3d(-224px, -200px, 0)');
  });

  it('manual drag suppresses auto-follow until the next committed staged step re-engages it', async () => {
    const { container } = await mountExploration();
    const playfieldBody = byClass(container, 'exploration-playfield');
    const canvas = byTestId(container, 'exploration-canvas');
    playfieldBody._boundingRect = { width: 100, height: 100, left: 0, top: 0 };
    canvas._boundingRect = { width: 480, height: 768, left: 0, top: 0 };

    playfieldBody.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    playfieldBody.dispatch('pointermove', { pointerId: 1, clientX: 30, clientY: 30 });
    playfieldBody.dispatch('pointerup', { pointerId: 1 });
    // Drag alone: dx=-70, dy=-70 from (0,0). Clamped inside [-380, 0].
    expect(canvas.style.transform).toBe('translate3d(-70px, -70px, 0)');

    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('Enter'));
    // ensurePartyVisible re-engages. From pan (-70,-70):
    //   visibleLeft=70, visibleRight=170. party.x=276 > 170-48=122 → dx=122-276=-154 → panOffset.x = -224
    //   visibleTop=70, visibleBottom=170. party.y=252 > 170-48=122 → dy=122-252=-130 → panOffset.y = -200
    expect(canvas.style.transform).toBe('translate3d(-224px, -200px, 0)');
  });

  it('focuses the container on mount so arrow keys work without a prior click', async () => {
    const { container } = await mountExploration();
    expect(container.focused).toBe(true);
  });

  it('refocuses the container on pointerdown when focus has drifted elsewhere', async () => {
    const { container } = await mountExploration();
    const playfieldBody = byClass(container, 'exploration-playfield');
    const state = runState();
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
    void state;
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

  it('routes console:intent move_* actions from panes that decline the input into the staged path', async () => {
    const { container, runState: state } = await mountExploration();
    bus.dispatch('console:intent', { mode: 'gear', action: 'move_e', source: 'keyboard' });
    // Party has not moved — the action has staged instead.
    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toContain('STAGED 1 STEP');
  });

  it('routes each console:intent direction into staging (party position unchanged until commit)', async () => {
    const directions = ['move_n', 'move_s', 'move_w', 'move_ne', 'move_nw', 'move_se', 'move_sw'];
    for (const action of directions) {
      const { container, runState: state } = await mountExploration();
      bus.dispatch('console:intent', { mode: 'gear', action, source: 'keyboard' });
      expect(state.partyPosition).toEqual({ x: 10, y: 10 });
      expect(byTestId(container, 'move-notice').textContent).toContain('STAGED 1 STEP');
    }
  });

  it('ignores console:intent moves when combat is active', async () => {
    const state = runState();
    state.activeCombat = { round: 1 };
    const { container, runState: mounted } = await mountExploration({ runState: state });
    bus.dispatch('console:intent', { mode: 'gear', action: 'move_e', source: 'keyboard' });
    expect(mounted.partyPosition).toEqual({ x: 10, y: 10 });
    // Nothing staged either — stageMove refuses while combat is active.
    expect(byTestId(container, 'move-notice')?.textContent || '').not.toContain('STAGED');
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
    // The container has been torn down, so no console notice reflects new staging either.
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

  it('staging rejects walls: press against a wall records a CANNOT STAGE notice and does not extend the path', async () => {
    // Party at (10,10). Put a wall at (11,10) so ArrowRight is blocked.
    const walledFloor = floor();
    walledFloor.cells[10][11] = 0;
    const { container, runState: state } = await mountExploration({ floor: walledFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toBe('CANNOT STAGE — wall or closed corner.');
  });

  it('staging rejects a diagonal into a closed corner (both cardinal neighbors are walls)', async () => {
    // Party at (10,10). NE diagonal to (11,9). Wall both (11,10) and (10,9) → closed corner.
    const cornerFloor = floor();
    cornerFloor.cells[10][11] = 0;
    cornerFloor.cells[9][10] = 0;
    const { container, runState: state } = await mountExploration({ floor: cornerFloor });

    container.dispatch('keydown', { code: 'KeyE', key: 'e', repeat: false, preventDefault() { this.prevented = true; } });

    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toBe('CANNOT STAGE — wall or closed corner.');
  });

  it('commit loop executes n moveParty steps in order and lands the party on the final cell', async () => {
    const { container, runState: state } = await mountExploration();

    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    expect(byTestId(container, 'move-notice').textContent).toContain('STAGED 3 STEPS');

    container.dispatch('keydown', keyEvent('Enter'));
    expect(state.partyPosition).toEqual({ x: 13, y: 10 });
    // Staged path drained after commit.
    expect(byTestId(container, 'move-notice').textContent).not.toContain('STAGED');
  });

  it('hostile interrupt during commit truncates the remaining staged steps and clears the buffer', async () => {
    const hostileFloor = floor({ enemySpawns: [{ id: 0, x: 12, y: 10, archetypeId: 'drone' }] });
    const combat = [];
    const off = bus.on('state:combat-start', (payload) => combat.push(payload));
    const { container, runState: state } = await mountExploration({ floor: hostileFloor });

    // Stage 3 east steps. First commit lands (11,10) which reveals hostile at (12,10) → interrupt.
    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('Enter'));

    expect(combat).toHaveLength(1);
    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    // Staged buffer flushed regardless of interrupt.
    container.dispatch('keydown', keyEvent('Enter'));
    expect(combat).toHaveLength(1);
    off();
  });

  it('Escape clears the staged path and posts a cleared notice', async () => {
    const { container, runState: state } = await mountExploration();

    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    expect(byTestId(container, 'move-notice').textContent).toContain('STAGED 2 STEPS');

    container.dispatch('keydown', keyEvent('Escape'));
    expect(byTestId(container, 'move-notice').textContent).toBe('STAGED PATH CLEARED.');
    expect(state.partyPosition).toEqual({ x: 10, y: 10 });

    container.dispatch('keydown', keyEvent('Enter'));
    // Nothing to commit, party still at origin, no descent underfoot → NO DESCENT POINT UNDERFOOT.
    expect(state.partyPosition).toEqual({ x: 10, y: 10 });
  });

  it('UNDO button pops the last staged step', async () => {
    const { container } = await mountExploration();

    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    expect(byTestId(container, 'move-notice').textContent).toContain('STAGED 2 STEPS');

    byTestId(container, 'move-undo').click();
    expect(byTestId(container, 'move-notice').textContent).toContain('STAGED 1 STEP');

    byTestId(container, 'move-undo').click();
    // Buffer drained, but the notice reverts to a default MOVE hint (no STAGED prefix).
    expect(byTestId(container, 'move-notice').textContent).not.toContain('STAGED');
  });

  it('CLEAR button drains any staged steps immediately', async () => {
    const { container } = await mountExploration();

    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    container.dispatch('keydown', keyEvent('ArrowRight'));
    byTestId(container, 'move-clear').click();

    expect(byTestId(container, 'move-notice').textContent).toBe('STAGED PATH CLEARED.');
  });

  it('staging caps at 24 steps and shows a STAGING FULL notice on further attempts', async () => {
    // Grid is 20×32; start party high enough that 24 south steps stay in-bounds.
    const state = runState();
    state.partyPosition = { x: 10, y: 2 };
    const tallFloor = floor({ entryPoint: { x: 10, y: 2 } });
    const { container } = await mountExploration({ runState: state, floor: tallFloor });

    for (let i = 0; i < 24; i++) container.dispatch('keydown', keyEvent('ArrowDown'));
    expect(byTestId(container, 'move-notice').textContent).toContain('STAGED 24 STEPS');

    container.dispatch('keydown', keyEvent('ArrowDown'));
    expect(byTestId(container, 'move-notice').textContent).toContain('STAGING FULL');
  });
});
