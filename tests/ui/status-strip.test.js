import { beforeEach, describe, expect, test } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { createStatusBar, createTelemetryDock } from '../../src/ui/status-strip.js';

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
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
  }
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return this._className; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
}

function installDocument() {
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
}

function textOf(root) {
  return [root.textContent, ...root.children.flatMap((child) => textOf(child))].filter(Boolean);
}

function findByClass(root, className) {
  if (root.className.split(/\s+/).includes(className)) return root;
  for (const child of root.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function findAllByClass(root, className, matches = []) {
  if (root.className.split(/\s+/).includes(className)) matches.push(root);
  for (const child of root.children) findAllByClass(child, className, matches);
  return matches;
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
    if (found) return found;
  }
  return null;
}

beforeEach(installDocument);

describe('status strip', () => {
  test('displays exploration depth seed party hp corruption and numeric clock accessibly', () => {
    const strip = createStatusBar({
      depth: 7,
      worldSeed: '123456789abcdef',
      corruption: 0.25,
      dangerClockProgress: 0.5,
      party: [{ id: 'p1', sigilCodepoint: 0xE000, currentHP: 8, maxHP: 10 }]
    });

    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.getAttribute('aria-live')).toBe('polite');
    expect(textOf(strip)).toEqual(expect.arrayContaining(['DEPTH', '07', 'SEED', '123456…cdef', 'PARTY', '8/10', 'DANGER', 'COR 0.25', 'CLK', '0.50']));
    expect(findByClass(strip, 'status-seed').getAttribute('aria-label')).toBe('World seed 123456789abcdef');
    expect(['status-depth-group', 'status-seed-group', 'status-party-group', 'status-danger-group', 'status-clock-group'].every((name) => findByClass(strip, name))).toBe(true);
    expect(findByClass(strip, 'status-depth-group').style.flexDirection).toBe('column');
  });

  test('updates live clock and cleanup removes the subscription', () => {
    const runState = { depth: 1, worldSeed: 1, dangerClockProgress: 0, party: [] };
    const strip = createStatusBar(runState);
    const clock = findByClass(strip, 'status-clock');

    bus.dispatch('state:danger-clock-tick', { progress: 0.75 });
    expect(clock.textContent).toBe('0.75');
    strip.cleanup();
    bus.dispatch('state:danger-clock-tick', { progress: 0.9 });
    expect(clock.textContent).toBe('0.75');
  });

  test('displays combat round initiative active resources ap and movement', () => {
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 3, maxCHARGE: 6, ap: 2, moveAvailable: true }],
      ['e1', { id: 'e1', side: 'enemy', sigilCodepoint: 0xE030, hp: 5, hpMax: 5 }]
    ]);
    const strip = createStatusBar({ depth: 3 }, { combatants, turnOrder: ['p1', 'e1'], currentTurn: 0, round: 4 });

    expect(textOf(strip)).toEqual(expect.arrayContaining(['DEPTH', '03', 'ROUND', '04', 'SEED', '◈ INITIATIVE ORDER', '1', '2', 'ACTIVE', '9/12', '3/6', 'AP 2', '1 MV']));
    expect(strip.className).toContain('status-strip-combat');
    expect(strip.style.gridTemplateColumns).toBe('auto auto auto minmax(0, 1fr)');
    expect(findByClass(strip, 'status-active-sigil')).not.toBe(null);
    expect(findByClass(strip, 'init-rail').children).toHaveLength(2);
    expect(findByClass(strip, 'init-rail').children[0].className).toContain('active');
  });

  test('marks enemy initiative slots with the enemy class and stacks it with active', () => {
    const combatants = new Map([
      ['e1', { id: 'e1', side: 'enemy', sigilCodepoint: 0xE030, hp: 5, hpMax: 5 }],
      ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 0, maxCHARGE: 6, ap: 2, moveAvailable: true }],
      ['e2', { id: 'e2', side: 'enemy', sigilCodepoint: 0xE031, hp: 4, hpMax: 4 }]
    ]);
    const strip = createStatusBar({ depth: 3 }, { combatants, turnOrder: ['e1', 'p1', 'e2'], currentTurn: 0, round: 1 });
    const slots = findByClass(strip, 'init-rail').children;

    expect(slots).toHaveLength(3);
    expect(slots[0].classList.contains('enemy')).toBe(true);
    expect(slots[0].classList.contains('active')).toBe(true);
    expect(slots[1].classList.contains('enemy')).toBe(false);
    expect(slots[2].classList.contains('enemy')).toBe(true);
    expect(slots[2].classList.contains('active')).toBe(false);
  });
});

describe('telemetry dock (wide)', () => {
  test('renders exploration fields, numeric clock accessible label, and no combat blocks', () => {
    const runState = { depth: 7, worldSeed: 'A4F29C1E', corruption: 0.1, dangerClockProgress: 0.32, party: [{ id: 'p1', sigilCodepoint: 0xE000, currentHP: 8, maxHP: 10 }] };
    const dock = createTelemetryDock(runState);

    expect(dock.className).toContain('wide-telemetry-dock');
    expect(dock.getAttribute('role')).toBe('status');
    expect(findByClass(dock, 'wide-telemetry-header')).not.toBe(null);
    const labels = findAllByClass(dock, 'wide-telemetry-label').map((el) => el.textContent);
    expect(labels).toEqual(['Depth', 'Seed', 'Party', 'Danger Clock', 'Corruption']);
    const clock = byTestId(dock, 'telemetry-clock');
    expect(clock.textContent).toBe('0.32');
    expect(clock.getAttribute('aria-label')).toBe('Danger clock 0.32');
    expect(byTestId(dock, 'telemetry-init-block')).toBe(null);
    expect(byTestId(dock, 'telemetry-active-actor')).toBe(null);
    dock.cleanup();
  });

  test('live-updates the clock through the danger-clock bus event and cleanup removes it', () => {
    const runState = { depth: 3, worldSeed: 1, dangerClockProgress: 0, party: [] };
    const dock = createTelemetryDock(runState);
    const clock = byTestId(dock, 'telemetry-clock');

    bus.dispatch('state:danger-clock-tick', { progress: 0.65 });
    expect(clock.textContent).toBe('0.65');
    dock.cleanup();
    bus.dispatch('state:danger-clock-tick', { progress: 0.99 });
    expect(clock.textContent).toBe('0.65');
  });

  test('adds combat round, initiative rail with spent marker, and active-actor block', () => {
    const combatants = new Map([
      ['p1', { id: 'p1', name: 'Breacher', side: 'party', sigilCodepoint: 0xE000, hp: 24, hpMax: 36, charge: 0, chargeMax: 9, ap: 2, moveAvailable: true, conditions: [{ id: 'burning', duration: 3 }] }],
      ['e1', { id: 'e1', name: 'Drone', side: 'enemy', sigilCodepoint: 0xE030, hp: 4, hpMax: 9 }],
      ['e2', { id: 'e2', name: 'Ghost', side: 'party', sigilCodepoint: 0xE001, hp: 0, hpMax: 22 }]
    ]);
    const combatState = { combatants, turnOrder: ['p1', 'e1', 'e2'], currentTurn: 0, round: 3 };
    const runState = { depth: 7, worldSeed: 'A4F29C1E', dangerClockProgress: 0.32, corruption: 0.1, party: [] };
    const dock = createTelemetryDock(runState, combatState);

    const labels = findAllByClass(dock, 'wide-telemetry-label').map((el) => el.textContent);
    expect(labels).toEqual(['Depth', 'Round', 'Seed', 'Party', 'Danger Clock', 'Corruption']);
    const init = byTestId(dock, 'telemetry-init-block');
    expect(init).not.toBe(null);
    const rail = findByClass(init, 'wide-init-rail');
    expect(rail.children).toHaveLength(3);
    expect(rail.children[0].className).toContain('active');
    expect(rail.children[2].className).toContain('spent');
    expect(findByClass(init, 'init-order')).not.toBe(null);
    const active = byTestId(dock, 'telemetry-active-actor');
    expect(active).not.toBe(null);
    expect(findByClass(active, 'wide-active-name').textContent).toBe('BREACHER · ACTIVE');
    expect(findByClass(active, 'wide-active-ap').textContent).toBe('2 AP · 1 MV');
    dock.cleanup();
  });

  test('renders sticky feed header, mirrors LOG entry classes, and appends new bus entries with autoscroll', () => {
    const runState = { depth: 7, worldSeed: 1, dangerClockProgress: 0, party: [], recentEvents: [{ sequence: 1, type: 'discovery', message: 'CONTAINER at (5,8)' }] };
    const dock = createTelemetryDock(runState);
    const feed = byTestId(dock, 'telemetry-log-feed');

    expect(findByClass(dock, 'wide-log-feed-header').textContent).toBe('◈ Event Log — Floor 07');
    expect(feed.children).toHaveLength(1);
    expect(feed.children[0].className).toContain('log-entry');
    expect(feed.children[0].className).toContain('log-discovery');
    expect(feed.children[0].children[0].className).toContain('log-turn');
    expect(feed.children[0].children[0].textContent).toBe('[E:001]');

    // Simulate scroll dimensions so autoscroll writes scrollTop.
    feed.scrollHeight = 512;
    bus.dispatch('ui:log-entry', { sequence: 2, type: 'combat', message: 'Attack lands' });
    expect(feed.children).toHaveLength(2);
    expect(feed.children[1].className).toContain('log-combat');
    expect(feed.scrollTop).toBe(feed.scrollHeight);

    dock.cleanup();
    bus.dispatch('ui:log-entry', { sequence: 3, type: 'combat', message: 'Should not append' });
    expect(feed.children).toHaveLength(2);
  });

  test('marks wide telemetry enemy slots with the enemy class and stacks it with active', () => {
    const combatants = new Map([
      ['e1', { id: 'e1', name: 'Drone', side: 'enemy', sigilCodepoint: 0xE030, hp: 4, hpMax: 9 }],
      ['p1', { id: 'p1', name: 'Breacher', side: 'party', sigilCodepoint: 0xE000, hp: 24, hpMax: 36, charge: 0, chargeMax: 9, ap: 2, moveAvailable: true }],
      ['e2', { id: 'e2', name: 'Ghost', side: 'enemy', sigilCodepoint: 0xE031, hp: 3, hpMax: 6 }]
    ]);
    const combatState = { combatants, turnOrder: ['e1', 'p1', 'e2'], currentTurn: 0, round: 1 };
    const runState = { depth: 7, worldSeed: 'A4F29C1E', dangerClockProgress: 0.32, corruption: 0.1, party: [] };
    const dock = createTelemetryDock(runState, combatState);

    const e1Slot = byTestId(dock, 'telemetry-init-e1');
    const p1Slot = byTestId(dock, 'telemetry-init-p1');
    const e2Slot = byTestId(dock, 'telemetry-init-e2');

    expect(e1Slot.classList.contains('enemy')).toBe(true);
    expect(e1Slot.classList.contains('active')).toBe(true);
    expect(p1Slot.classList.contains('enemy')).toBe(false);
    expect(p1Slot.classList.contains('active')).toBe(false);
    expect(e2Slot.classList.contains('enemy')).toBe(true);
    expect(e2Slot.classList.contains('active')).toBe(false);
    dock.cleanup();
  });
});
