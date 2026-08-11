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

function installDocument() {
  globalThis.document = {
    documentElement: new FakeElement('html'),
    createElement: (tagName) => tagName === 'canvas' ? new FakeCanvas() : new FakeElement(tagName),
    createTextNode: (value) => { const node = new FakeElement('#text'); node.textContent = value; return node; }
  };
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
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

beforeEach(installDocument);
afterEach(() => { delete globalThis.document; });

describe('exploration screen controller', () => {
  it('routes keyboard movement through MOVE and pushes visible proximity audio', async () => {
    const audio = [];
    const off = bus.on('audio:update-state', (payload) => audio.push(payload));
    const { container, runState: state } = await mountExploration();

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    expect(byTestId(container, 'move-notice').textContent).toContain('MOVED');
    expect(audio.at(-1).proximity).toEqual({ hostile: null, container: null });
    off();
  });

  it('requests combat on hostile discovery without mutating runtime route state directly', async () => {
    const combat = [];
    const off = bus.on('state:combat-start', (payload) => combat.push(payload));
    const hostileFloor = floor({ enemySpawns: [{ id: 0, x: 12, y: 10, archetypeId: 'drone' }] });
    const { container, runState: state } = await mountExploration({ floor: hostileFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(combat).toHaveLength(1);
    expect(combat[0]).toMatchObject({ runState: state, floor: hostileFloor, reason: 'hostile', encounter: expect.objectContaining({ kind: 'standard' }), moveResult: expect.objectContaining({ interruptType: 'hostile' }) });
    off();
  });

  it('enables LOOT only for an unopened adjacent container and emits open handoff', async () => {
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

  it('honors discovery auto-stop toggle while preserving movement', async () => {
    const farContainerFloor = floor({ containers: [{ id: 0, x: 13, y: 10 }] });
    const { container, runState: state } = await mountExploration({ floor: farContainerFloor });

    byTestId(container, 'toggle-discovery').click();
    container.dispatch('keydown', keyEvent('ArrowRight'));

    expect(state.partyPosition).toEqual({ x: 11, y: 10 });
    expect(byTestId(container, 'console-tab-loot').disabled).toBe(true);
    expect(textOf(container)).not.toContain('CONTAINER DISCOVERED');
  });

  it('requests floor transition only from confirm on the descent cell', async () => {
    const changes = [];
    const off = bus.on('state:floor-change', (payload) => changes.push(payload));
    const descentFloor = floor({ descentPoint: { x: 11, y: 10 } });
    descentFloor.cells[10][11] = 3;
    const { container, runState: state } = await mountExploration({ floor: descentFloor });

    container.dispatch('keydown', keyEvent('ArrowRight'));
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
});
