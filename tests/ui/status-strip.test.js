import { afterEach, beforeEach, describe, expect, test } from 'vitest';
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
  constructor(tagName, namespaceURI = null) {
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.listeners = new Map();
    this.disabled = false;
  }
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  // SVG sprites created via createElementNS set class through setAttribute
  // (not the className setter). Fall back to the raw attribute so tests
  // reading `.className` on icon <svg>s see the sprite classes.
  get className() { return this._className || this.attributes.get('class') || ''; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  // SESSION-06 — icon prefix uses element.prepend() when available.
  prepend(...children) { this.children = [...children, ...this.children]; }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setAttributeNS(_ns, name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatchEvent(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ type, target: this, ...event });
  }
  click() { this.dispatchEvent('click'); }
}

function installDocument() {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (ns, tagName) => new FakeElement(tagName, ns)
  };
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

    // Note: the SESSION-01 (mobile-combat-density-repair) active row drops the
    // decorative "ACTIVE" caption that used to top the vertical active-group
    // column — the active actor is still the sigil/HP/CHARGE/AP/MV row (its
    // sigil carries an "active" aria-label); dropping this purely-visual
    // caption is part of collapsing that column into a single compact row.
    expect(textOf(strip)).toEqual(expect.arrayContaining(['DEPTH', '03', 'ROUND', '04', 'SEED', '◈ INITIATIVE ORDER', '1', '2', '9/12', '3/6', 'AP 2', '1 MV']));
    expect(strip.className).toContain('status-strip-combat');
    expect(findByClass(strip, 'status-active-sigil')).not.toBe(null);
    expect(findByClass(strip, 'init-rail').children).toHaveLength(2);
    expect(findByClass(strip, 'init-rail').children[0].className).toContain('active');
  });

  test('portrait combat strip renders a dedicated overview wrapper with a single horizontal active row, shrunk row-1 labels, a slim initiative rail — and readout stays complete', () => {
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 3, maxCHARGE: 6, ap: 2, moveAvailable: true }],
      ['e1', { id: 'e1', side: 'enemy', sigilCodepoint: 0xE030, hp: 5, hpMax: 5 }]
    ]);
    const strip = createStatusBar({ depth: 3 }, { combatants, turnOrder: ['p1', 'e1'], currentTurn: 0, round: 4 });

    // Compact semantic composition: one combat overview wrapper holding a
    // topline row and a single horizontal active-actor row — not the old
    // per-metric vertical stacking that drove the 226px/111px regression.
    const overview = findByClass(strip, 'status-combat-overview');
    expect(overview).not.toBe(null);
    const topline = findByClass(overview, 'status-combat-topline');
    expect(topline).not.toBe(null);
    const activeRow = findByClass(overview, 'status-combat-active');
    expect(activeRow).not.toBe(null);

    // Readout completeness: after SESSION-01 the strip is the sole copy, so
    // none of HP / CHARGE / AP / MV may be dropped, and every field lives
    // inside the single active row (no separate stacked sub-groups).
    expect(findByClass(activeRow, 'status-mini-hp')).not.toBe(null);
    expect(findByClass(activeRow, 'status-mini-charge')).not.toBe(null);
    expect(findByClass(activeRow, 'status-ap')).not.toBe(null);
    expect(findByClass(activeRow, 'status-move')).not.toBe(null);
    expect(findByClass(strip, 'init-rail')).not.toBe(null);

    // Row-1 labels (DEPTH/ROUND/SEED) and the initiative group label all
    // shrink for phone density.
    for (const groupClass of ['status-depth-combat-group', 'status-round-group', 'status-seed-combat-group', 'status-initiative-group']) {
      const label = findByClass(strip, groupClass).firstChild;
      expect(label.style.fontSize).toBe('8px');
    }

    // Initiative rail sits on a slim single line — reduced inline padding.
    expect(findByClass(strip, 'init-rail').style.padding).toBe('2px 4px');
  });

  test('portrait combat strip prefixes M107 icons onto the topline and active-row metrics while every field keeps its visible text', () => {
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 3, maxCHARGE: 6, ap: 2, moveAvailable: true }]
    ]);
    const strip = createStatusBar({ depth: 3 }, { combatants, turnOrder: ['p1'], currentTurn: 0, round: 1 });

    function svgChildren(node) {
      return (node.children || []).filter((child) => child.tagName === 'SVG');
    }

    // Topline: DEPTH/ROUND/SEED groups each carry exactly one decorative icon
    // ahead of their visible label text — the field name is never icon-only.
    const depthLabel = findByClass(strip, 'status-depth-combat-group').firstChild;
    expect(svgChildren(depthLabel)).toHaveLength(1);
    expect(depthLabel.children[0].getAttribute('aria-hidden')).toBe('true');
    expect(findByClass(strip, 'status-depth-combat').textContent).toBe('03');

    // Active row: HP/CHARGE/AP/MOVE each get a preceding icon sibling; the
    // bars/text nodes retain their existing values and classes untouched.
    const activeRow = findByClass(strip, 'status-combat-active');
    expect(svgChildren(activeRow).length).toBeGreaterThanOrEqual(4);
    expect(findByClass(activeRow, 'status-ap').textContent).toBe('AP 2');
    expect(findByClass(activeRow, 'status-move').textContent).toBe('1 MV');
    strip.cleanup();
  });

  test('portrait combat strip renders icon-free (fallback-safe) when the document lacks createElementNS', () => {
    const originalCreateElementNS = globalThis.document.createElementNS;
    delete globalThis.document.createElementNS;
    try {
      const combatants = new Map([
        ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 3, maxCHARGE: 6, ap: 2, moveAvailable: true }]
      ]);
      const strip = createStatusBar({ depth: 3 }, { combatants, turnOrder: ['p1'], currentTurn: 0, round: 1 });
      // Every value/class/label still renders — only the decorative SVG is absent.
      expect(findByClass(strip, 'status-mini-hp')).not.toBe(null);
      expect(findByClass(strip, 'status-ap').textContent).toBe('AP 2');
      function anySvg(node) {
        if (node.tagName === 'SVG') return true;
        return (node.children || []).some(anySvg);
      }
      expect(anySvg(strip)).toBe(false);
      strip.cleanup();
    } finally {
      globalThis.document.createElementNS = originalCreateElementNS;
    }
  });

  test('the status-collapse control and status-collapsed class are removed in every variant', () => {
    // Portrait-usability-regression-repair SESSION-01: hidden telemetry is no
    // longer allowed. No collapse toggle may be rendered, no `status-collapsed`
    // class may be added, and both variants must retain every critical readout
    // across repeated rebuilds — the sequence the encounter code re-mounts the
    // strip on every turn resolution.
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 3, maxCHARGE: 6, ap: 2, moveAvailable: true }],
      ['e1', { id: 'e1', side: 'enemy', sigilCodepoint: 0xE030, hp: 5, hpMax: 5 }]
    ]);
    const exploreState = { depth: 3, worldSeed: 'seed', dangerClockProgress: 0, corruption: 0, party: [{ id: 'p1', sigilCodepoint: 0xE000, currentHP: 8, maxHP: 10 }] };
    const combatState = { combatants, turnOrder: ['p1', 'e1'], currentTurn: 0, round: 1 };

    const strips = [
      createStatusBar(exploreState),
      createStatusBar({ depth: 3 }, combatState),
      createStatusBar(exploreState),
      createStatusBar({ depth: 3 }, combatState)
    ];
    for (const strip of strips) {
      expect(byTestId(strip, 'status-collapse')).toBe(null);
      expect(strip.classList.contains('status-collapsed')).toBe(false);
    }
    for (const strip of strips) strip.cleanup();
  });

  test('every exploration-critical field remains rendered across rebuilds', () => {
    const runState = {
      depth: 4, worldSeed: 'seed42', corruption: 0.4, dangerClockProgress: 0.25,
      party: [{ id: 'p1', sigilCodepoint: 0xE000, currentHP: 6, maxHP: 10 }]
    };
    for (let iteration = 0; iteration < 3; iteration++) {
      const strip = createStatusBar(runState);
      expect(findByClass(strip, 'status-depth')).not.toBe(null);
      expect(findByClass(strip, 'status-seed')).not.toBe(null);
      expect(findByClass(strip, 'status-party-list')).not.toBe(null);
      expect(findByClass(strip, 'status-mini-hp')).not.toBe(null);
      expect(findByClass(strip, 'status-corruption')).not.toBe(null);
      expect(findByClass(strip, 'status-clock')).not.toBe(null);
      strip.cleanup();
    }
  });

  test('every combat-critical field remains rendered across repeated rebuilds and active-turn changes', () => {
    // Simulates the encounter loop: same combatState identity re-passed on every
    // rebuild, currentTurn advancing between rebuilds. Every rebuild must fully
    // populate HP / CHARGE / AP / MOVE and the initiative rail — the strip is
    // now the sole owner of that telemetry in portrait.
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 3, maxCHARGE: 6, ap: 2, moveAvailable: true }],
      ['p2', { id: 'p2', side: 'party', sigilCodepoint: 0xE001, currentHP: 7, maxHP: 12, currentCHARGE: 2, maxCHARGE: 6, ap: 2, moveAvailable: true }],
      ['e1', { id: 'e1', side: 'enemy', sigilCodepoint: 0xE030, hp: 5, hpMax: 5 }]
    ]);
    const combatState = { combatants, turnOrder: ['p1', 'e1', 'p2'], currentTurn: 0, round: 1 };
    for (const currentTurn of [0, 1, 2, 0]) {
      combatState.currentTurn = currentTurn;
      const strip = createStatusBar({ depth: 3 }, combatState);
      expect(findByClass(strip, 'status-depth-combat')).not.toBe(null);
      expect(findByClass(strip, 'status-round')).not.toBe(null);
      expect(findByClass(strip, 'status-seed')).not.toBe(null);
      expect(findByClass(strip, 'init-rail')).not.toBe(null);
      expect(findByClass(strip, 'status-active-actor')).not.toBe(null);
      expect(findByClass(strip, 'status-mini-hp')).not.toBe(null);
      expect(findByClass(strip, 'status-mini-charge')).not.toBe(null);
      expect(findByClass(strip, 'status-ap')).not.toBe(null);
      expect(findByClass(strip, 'status-move')).not.toBe(null);
      strip.cleanup();
    }
  });

  test('cleanup detaches the danger-clock listener and the manual link handler', () => {
    // Confirms the tri-consumer cleanup contract survives the removal of the
    // collapse toggle: danger-clock subscription + manual chip listener still
    // both get torn down when strip.cleanup() runs.
    const runState = { depth: 1, worldSeed: 1, dangerClockProgress: 0, party: [] };
    const strip = createStatusBar(runState);
    const clock = findByClass(strip, 'status-clock');
    const chip = byTestId(strip, 'status-manual');
    expect(chip).not.toBe(null);

    strip.cleanup();

    bus.dispatch('state:danger-clock-tick', { progress: 0.42 });
    expect(clock.textContent).not.toBe('0.42');
    // Manual chip click must not raise a bus event after cleanup.
    const events = [];
    const off = bus.on('ui:manual-open', (payload) => events.push(payload));
    chip.click();
    expect(events).toEqual([]);
    off();
  });

  test('renders the manual `?` chip in exploration and combat portrait strips and dispatches ui:manual-open on click', () => {
    const explorationStrip = createStatusBar({ depth: 1, worldSeed: 1, dangerClockProgress: 0, party: [] });
    const explorationChip = byTestId(explorationStrip, 'status-manual');
    expect(explorationChip).not.toBe(null);
    expect(explorationChip.tagName).toBe('BUTTON');
    expect(explorationChip.textContent).toBe('?');
    expect(explorationChip.classList.contains('manual-term-link--chip')).toBe(true);
    // In-flow trailing item — never absolutely positioned over other readouts.
    expect(explorationChip.style.position).not.toBe('absolute');
    expect(explorationChip.style.marginLeft).toBe('auto');

    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 3, maxCHARGE: 6, ap: 2, moveAvailable: true }]
    ]);
    const combatStrip = createStatusBar({ depth: 1 }, { combatants, turnOrder: ['p1'], currentTurn: 0, round: 1 });
    const combatChip = byTestId(combatStrip, 'status-manual');
    expect(combatChip).not.toBe(null);
    expect(combatChip.classList.contains('manual-term-link--chip')).toBe(true);

    const events = [];
    const off = bus.on('ui:manual-open', (payload) => events.push(payload));
    explorationChip.click();
    combatChip.click();
    expect(events).toEqual([
      { target: null, source: 'status-strip' },
      { target: null, source: 'status-strip' }
    ]);
    off();
    explorationStrip.cleanup();
    combatStrip.cleanup();
  });

  test('exploration party HP renders the derived max when actor lacks maxHP and options.data is supplied', () => {
    // Injured party character with NO stored maxHP (the SESSION-01 bug):
    // deriveStats returns hpMax based on class VIT + attributes; the strip
    // must show the derived max, never "9/9". The classes fixture below is a
    // minimum-viable game-data registry — deriveStats only needs the base VIT
    // for the class + attribute modifiers on the character.
    const character = {
      id: 'p1', sigilCodepoint: 0xE000, classId: 'breacher', currentHP: 9,
      attributes: { mgt: 0, fin: 0, vit: 3, res: 0, foc: 0, sig: 0 }
    };
    const runState = { depth: 1, worldSeed: 1, dangerClockProgress: 0, party: [character] };
    const data = { classes: { classes: [{ id: 'breacher', name: 'Breacher', baseAttributes: { mgt: 2, fin: 1, vit: 3, res: 1, foc: 0, sig: 1 } }] }, equipment: {}, affixes: {} };

    const strip = createStatusBar(runState, null, { data });
    const bar = findByClass(strip, 'status-mini-hp');
    expect(bar).not.toBe(null);
    // createHPBar writes `${current}/${max}` into aria-valuetext + the text
    // child. Derived max MUST exceed current HP (9) — anything else means the
    // "max = current" bug survived.
    const label = bar.getAttribute('aria-valuetext') || '';
    const match = /(\d+)\s*\/\s*(\d+)/.exec(label);
    expect(match, `expected NN/MM in aria-valuetext but got "${label}"`).toBeTruthy();
    const [, cur, max] = match;
    expect(Number(cur)).toBe(9);
    expect(Number(max)).toBeGreaterThan(9);
    strip.cleanup();
  });

  test('no-data status bar keeps the pre-SESSION-02 fallback (max = current when actor lacks max)', () => {
    const character = { id: 'p1', sigilCodepoint: 0xE000, currentHP: 8 };
    const runState = { depth: 1, worldSeed: 1, dangerClockProgress: 0, party: [character] };
    const strip = createStatusBar(runState);
    const bar = findByClass(strip, 'status-mini-hp');
    const label = bar.getAttribute('aria-valuetext') || '';
    const match = /(\d+)\s*\/\s*(\d+)/.exec(label);
    expect(match).toBeTruthy();
    // Without data, hpOf falls back to current for max — legacy behavior.
    expect(match[1]).toBe(match[2]);
    strip.cleanup();
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
    // SESSION-05 icon-first-ui-density: wide dock labels are icon-only. The
    // field name now lives on `title` (pointer hover) and a `.sr-only` child
    // span (screen readers); the label element's own textContent is empty.
    const labels = findAllByClass(dock, 'wide-telemetry-label').map((el) => el.getAttribute('title'));
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

    // SESSION-05 icon-first-ui-density: label names live on `title` (see above).
    const labels = findAllByClass(dock, 'wide-telemetry-label').map((el) => el.getAttribute('title'));
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

  test('renders the manual `?` chip in the telemetry dock header and dispatches ui:manual-open on click', () => {
    const events = [];
    const off = bus.on('ui:manual-open', (payload) => events.push(payload));
    const dock = createTelemetryDock({ depth: 1, worldSeed: 1, dangerClockProgress: 0, party: [] });
    const chip = byTestId(dock, 'status-manual');
    expect(chip).not.toBe(null);
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.classList.contains('wide-telemetry-manual-chip')).toBe(true);
    expect(chip.classList.contains('manual-term-link--chip')).toBe(true);
    expect(chip.textContent).toBe('?');
    expect(chip.getAttribute('data-manual-target')).toBe('');
    // In-flow header participant — no inline absolute positioning that could
    // float over the DEPTH value; it is a direct child of the header.
    expect(chip.style.position).not.toBe('absolute');
    const header = findByClass(dock, 'wide-telemetry-header');
    expect(header.children).toContain(chip);
    chip.click();
    expect(events).toEqual([{ target: null, source: 'status-strip' }]);
    off();
    dock.cleanup();
  });

  // SESSION-06 — wide-mode field labels each lead with a lucide sprite.
  // SESSION-05 icon-first-ui-density — labels are now icon-only: the field
  // name lives on the `title` attribute (pointer hover) AND a `.sr-only`
  // child span (AT). The label span's own textContent is empty.
  test('every wide-mode telemetry field label carries a lucide sprite prefix and a sr-only + title fallback for its name', () => {
    const runState = { depth: 7, worldSeed: 'A4F29C1E', corruption: 0.1, dangerClockProgress: 0.32, party: [{ id: 'p1', sigilCodepoint: 0xE000, currentHP: 8, maxHP: 10 }] };
    const dock = createTelemetryDock(runState);
    const labels = findAllByClass(dock, 'wide-telemetry-label');
    expect(labels.map((el) => el.getAttribute('title'))).toEqual(['Depth', 'Seed', 'Party', 'Danger Clock', 'Corruption']);
    for (const label of labels) {
      // icon-only marker moves the label into density mode.
      expect(label.classList.contains('icon-only')).toBe(true);
      const svg = label.children.find((child) => child.tagName === 'SVG');
      expect(svg, `no sprite child on "${label.getAttribute('title')}"`).toBeTruthy();
      expect(svg.className.split(/\s+/)).toContain('icon');
      expect(svg.className.split(/\s+/)).toContain('icon-14');
      // AT fallback: sr-only child carries the field name for screen readers.
      const sr = label.children.find((child) => (child.className || '').split(/\s+/).includes('sr-only'));
      expect(sr, `no sr-only child on "${label.getAttribute('title')}"`).toBeTruthy();
      expect(sr.textContent).toBe(label.getAttribute('title'));
    }
    dock.cleanup();
  });

  // SESSION-05 icon-first-ui-density — Seed swaps from its chevron-right
  // placeholder to `hash` now that SESSION-02 landed the sprite id.
  test('Seed label uses the `hash` lucide sprite (dropped chevron-right placeholder)', () => {
    const runState = { depth: 1, worldSeed: 'A4F29C1E', corruption: 0, dangerClockProgress: 0, party: [] };
    const dock = createTelemetryDock(runState);
    const labels = findAllByClass(dock, 'wide-telemetry-label');
    const seed = labels.find((el) => el.getAttribute('title') === 'Seed');
    expect(seed).toBeTruthy();
    const svg = seed.children.find((c) => c.tagName === 'SVG');
    const useEl = (svg.children || []).find((c) => c.tagName === 'USE');
    expect(useEl.getAttribute('href')).toBe('assets/icons.svg#hash');
    dock.cleanup();
  });

  test('portrait createStatusBar still returns groups with no icon children (dashboard icons are wide-only)', () => {
    const strip = createStatusBar({ depth: 1, worldSeed: 1, dangerClockProgress: 0, party: [] });
    const groups = ['status-depth-group', 'status-seed-group', 'status-party-group', 'status-danger-group', 'status-clock-group'];
    for (const groupName of groups) {
      const group = findByClass(strip, groupName);
      expect(group).not.toBe(null);
      // No <svg> icons anywhere inside portrait status groups.
      function anySvg(node) {
        if (node.tagName === 'SVG') return true;
        return (node.children || []).some(anySvg);
      }
      expect(anySvg(group)).toBe(false);
    }
    strip.cleanup();
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
