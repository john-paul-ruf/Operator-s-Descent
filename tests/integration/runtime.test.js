import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/skip-boot.js';
import { bus } from '../../src/state/bus.js';
import { saveSettings } from '../../src/state/library.js';
import { resetGameDataForTests } from '../../src/data-loader.js';
import { buildRealisticRun } from '../helpers/run-builder.js';
import { installMockStorage } from '../helpers/mock-storage.js';

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) { const next = force == null ? !this.values.has(name) : Boolean(force); if (next) this.values.add(name); else this.values.delete(name); this.sync(); return next; }
  contains(name) { return this.values.has(name); }
  sync() { this.element._className = [...this.values].join(' '); }
}

class FakeStyle {
  constructor() { this.properties = {}; this.cssText = ''; }
  setProperty(name, value) { this.properties[name] = String(value); }
}

function dataKey(name) {
  return name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this._className = '';
    this._innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.id = '';
    this.type = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.tabIndex = -1;
    this.parentNode = null;
  }
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return this._className; }
  set innerHTML(value) { this._innerHTML = String(value); this.replaceChildren(); }
  get innerHTML() { return this._innerHTML; }
  get firstChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode; }
  get isConnected() { return Boolean(this.parentNode) || this.tagName === 'HTML'; }
  appendChild(child) {
    if (typeof child === 'string') child = new FakeText(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  prepend(...children) {
    for (const child of [...children].reverse()) {
      const node = typeof child === 'string' ? new FakeText(child) : child;
      node.parentNode = this;
      this.children.unshift(node);
    }
  }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; return child; }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  replaceWith(child) {
    const parent = this.parentNode;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1, child);
    child.parentNode = parent;
    this.parentNode = null;
  }
  replaceChild(next, old) {
    const index = this.children.indexOf(old);
    if (index >= 0) {
      this.children.splice(index, 1, next);
      next.parentNode = this;
      old.parentNode = null;
    }
    return old;
  }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === 'id') this.id = text;
    if (name.startsWith('data-')) this.dataset[dataKey(name)] = text;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, repeat: false, preventDefault() { this.prevented = true; }, ...event }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.focused = true; }
  matches(selector) {
    return selector.split(',').some((part) => {
      const trimmed = part.trim();
      if (trimmed === this.tagName.toLowerCase()) return true;
      if (trimmed === '[role="button"]') return this.getAttribute('role') === 'button';
      if (trimmed === '[aria-disabled]') return this.attributes.has('aria-disabled');
      if (trimmed === '[data-decision-pending="true"]') return this.dataset.decisionPending === 'true';
      return false;
    });
  }
  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      if (selector === '[data-glitch]' && (element.attributes?.has('data-glitch') || Object.hasOwn(element.dataset || {}, 'glitch'))) matches.push(element);
      for (const child of element.children || []) visit(child);
    };
    visit(this);
    return matches;
  }
}

class FakeText extends FakeElement {
  constructor(value) { super('#text'); this.textContent = value; }
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

function findById(root, id) {
  if (root.id === id || root.getAttribute?.('id') === id) return root;
  for (const child of root.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function installDocument() {
  const html = new FakeElement('html');
  const portraitFrame = new FakeElement('div');
  portraitFrame.id = 'portrait-frame';
  const overlays = new FakeElement('div');
  overlays.id = 'crt-overlays';
  const appRoot = new FakeElement('div');
  appRoot.id = 'app-root';
  portraitFrame.append(appRoot, overlays);
  html.appendChild(portraitFrame);
  globalThis.document = {
    documentElement: html,
    createElement: (tagName) => tagName === 'canvas' ? new FakeCanvas() : new FakeElement(tagName),
    createTextNode: (value) => new FakeText(value),
    getElementById: (id) => findById(html, id)
  };
  return { html, appRoot, portraitFrame };
}

function installBrowserGlobals() {
  const register = vi.fn(() => Promise.resolve({ scope: './' }));
  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: { register }, clipboard: { writeText: vi.fn(() => Promise.resolve()) } },
    configurable: true
  });
  globalThis.window = {
    location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', pathname: '/', hash: '', reload: vi.fn() },
    matchMedia: vi.fn(() => ({ matches: false }))
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.fetch = async (file) => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(readFileSync(new URL(`../../${String(file)}`, import.meta.url), 'utf8'))
  });
  return { register };
}

function openFloor() {
  return {
    cells: Array.from({ length: 32 }, () => Array(20).fill(1)),
    entryPoint: { x: 10, y: 0 },
    descentPoint: { x: 10, y: 31 },
    containers: [],
    enemySpawns: [],
    themeId: 'cold_storage',
    floorSubSeed: 0
  };
}

function activeCombatSnapshot(runState) {
  const hero = runState.party[0];
  return {
    arena: { originX: 0, originY: 0, contactId: 'resume-test' },
    actors: [
      { id: hero.id, side: 'party', x: 1, y: 1, hp: hero.currentHP, charge: hero.currentCHARGE, conditions: [], initiative: 12, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false },
      { id: 'enemy-0', side: 'enemy', x: 2, y: 1, hp: 8, charge: 0, conditions: [], initiative: 8, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false }
    ],
    initiativeOrder: [hero.id, 'enemy-0'],
    currentIndex: 0,
    round: 2,
    pendingEffects: [],
    encounter: { id: 'resume-test', type: 'standard' },
    eventOrder: 0
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

async function flushAsync() {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks();
}

async function waitForRoute(api, route) {
  for (let index = 0; index < 40; index++) {
    if (api.getRuntimeSnapshot().route === route) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await flushMicrotasks();
  }
}

let storage;
let browser;
let runtimeApi;

async function runtime() {
  runtimeApi ??= await import('../../src/runtime.js');
  return runtimeApi;
}

beforeEach(() => {
  vi.useRealTimers();
  resetGameDataForTests();
  installDocument();
  browser = installBrowserGlobals();
  storage = installMockStorage();
  saveSettings({ glitchEnabled: false, reducedMotion: 'reduce', scanlineGrainEnabled: true });
});

afterEach(() => {
  runtimeApi?.shutdownRuntime();
  resetGameDataForTests();
  storage?.uninstall();
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.fetch;
  delete globalThis.requestAnimationFrame;
  delete globalThis.navigator;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runtime event contracts', () => {
  it('validates known route payloads while leaving unknown events compatible', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const navigations = [];
    const unknown = [];
    const offNavigate = bus.on('ui:navigate', (payload) => navigations.push(payload));
    const offUnknown = bus.on('test:runtime-unknown', (payload) => unknown.push(payload));

    expect(bus.dispatch('ui:navigate', { screen: '../../evil', params: {} })).toBe(false);
    expect(navigations).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();

    const payload = { ok: true };
    expect(bus.dispatch('test:runtime-unknown', payload)).toBe(true);
    expect(unknown).toEqual([payload]);

    offNavigate();
    offUnknown();
  });
});

describe('runtime lifecycle and routes', () => {
  it('activates hot services once after START and tears them down cleanly', async () => {
    const api = await runtime();
    await api.activateRuntime({ initialHash: '' });

    expect(browser.register).toHaveBeenCalledTimes(1);
    expect(api.getRuntimeSnapshot()).toMatchObject({ active: true, route: 'title', hasScreen: true, hasGlitch: true, hasGrain: true, serviceWorkerStarted: true });
    expect(api.getRuntimeSnapshot().busListenerCount).toBeGreaterThan(8);
    expect(document.getElementById('grain-canvas')).toBeTruthy();

    await api.activateRuntime({ initialHash: '' });
    expect(browser.register).toHaveBeenCalledTimes(1);
    expect(api.getRuntimeSnapshot().route).toBe('title');

    api.shutdownRuntime();
    expect(api.getRuntimeSnapshot()).toMatchObject({ active: false, route: null, hasScreen: false, hasGrain: false, busListenerCount: 0 });
    expect(document.getElementById('grain-canvas')).toBeNull();
  });

  it('restores exploration without consuming gameplay RNG and resumes active combat snapshots into combat', async () => {
    const api = await runtime();
    await api.activateRuntime({ initialHash: '' });

    expect(api.getRuntimeSnapshot().busListenerCount).toBeGreaterThan(8);
    const runtimeErrors = [];
    const runtimeRoutes = [];
    const offError = bus.on('runtime:error', (payload) => runtimeErrors.push(payload));
    const offRoute = bus.on('runtime:route', (payload) => runtimeRoutes.push(payload));
    const state = buildRealisticRun(22, { depth: 2, fogCells: 10 });
    const rngBefore = JSON.stringify(state.rngState);
    expect(bus.dispatch('ui:navigate', { screen: 'exploration', params: { runState: state, resume: true } })).toBe(true);
    await waitForRoute(api, 'exploration');

    expect(runtimeErrors).toEqual([]);
    expect(runtimeRoutes.map((route) => route.screen)).toContain('exploration');
    expect(api.getRuntimeSnapshot().route).toBe('exploration');
    expect(JSON.stringify(state.rngState)).toBe(rngBefore);

    const combatRun = buildRealisticRun(23, { depth: 2, fogCells: 4 });
    combatRun.activeCombat = activeCombatSnapshot(combatRun);
    bus.dispatch('ui:navigate', { screen: 'exploration', params: { runState: combatRun, resume: true, floor: openFloor() } });
    await waitForRoute(api, 'combat');

    expect(api.getRuntimeSnapshot().route).toBe('combat');
    expect(api.getRuntimeSnapshot().currentRun.activeCombat).toEqual(combatRun.activeCombat);
    offError();
    offRoute();
  });
});

describe('runtime autosave checkpoints', () => {
  it('autosaves the committed next floor before the descent animation mounts exploration', async () => {
    vi.useFakeTimers();
    const api = await runtime();
    await api.activateRuntime({ initialHash: '' });
    const autosaves = [];
    const off = bus.on('state:autosave-complete', (payload) => autosaves.push(payload));
    const state = buildRealisticRun(77, { depth: 1, fogCells: 8 });

    bus.dispatch('state:floor-change', { runState: state, reason: 'test-descent' });

    expect(autosaves).toHaveLength(1);
    expect(autosaves[0].reason).toBe('floor-transition');
    expect(api.getRuntimeSnapshot().currentRun.depth).toBe(2);
    expect(state.depth).toBe(1);
    expect(api.getRuntimeSnapshot().route).toBe('title');

    await vi.advanceTimersByTimeAsync(900);
    await flushMicrotasks();

    expect(api.getRuntimeSnapshot().route).toBe('exploration');
    off();
  });

  it('does not autosave encounter handoff, then autosaves combat resolution once', async () => {
    const api = await runtime();
    await api.activateRuntime({ initialHash: '' });
    const autosaves = [];
    const off = bus.on('state:autosave-complete', (payload) => autosaves.push(payload));
    const state = buildRealisticRun(88, { depth: 1, fogCells: 2 });
    const floor = openFloor();

    const hero = state.party[0];
    const window = { originX: 0, originY: 0, width: 8, height: 16, cells: Array.from({ length: 16 }, () => Array(8).fill(1)) };
    const combatState = {
      id: 'handoff',
      kind: 'standard',
      window,
      round: 1,
      currentTurn: 0,
      turnOrder: [hero.id, 'enemy-0'],
      combatants: new Map([
        [hero.id, { ...hero, side: 'party', hp: hero.currentHP, hpMax: hero.currentHP, charge: hero.currentCHARGE, chargeMax: hero.currentCHARGE, position: { x: 1, y: 1 }, ap: 2, moveAvailable: true, protocols: [], weapon: null }],
        ['enemy-0', { id: 'enemy-0', side: 'enemy', hp: 8, hpMax: 8, charge: 0, chargeMax: 0, attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, position: { x: 2, y: 1 }, ap: 2, moveAvailable: true, sigilCodepoint: 0xE030, weapon: { damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 0 }, defense: 8, protocolDefense: 10, behavior: 'aggressive', conditions: [] }]
      ]),
      log: [],
      ended: false,
      result: null,
      turnStarted: true,
      forfeitableLoot: []
    };
    bus.dispatch('state:combat-start', { runState: state, floor, combatState, encounter: { id: 'handoff', kind: 'standard', window, actors: [...combatState.combatants.values()], forfeitableLoot: [] } });
    await flushAsync();
    expect(autosaves).toHaveLength(0);

    bus.dispatch('state:combat-end', { runState: state, result: 'victory', completion: { outcome: 'victory' } });

    expect(autosaves).toHaveLength(1);
    expect(autosaves[0].reason).toBe('combat-resolution');
    await waitForRoute(api, 'exploration');
    expect(api.getRuntimeSnapshot().route).toBe('exploration');
    off();
  });
});
