// SESSION-06 — LOG console icon coverage.
// The COPY LINK button prefixes a link sprite; the disabled variant (post-wipe)
// stays inert on click and still shows the icon.

import { beforeEach, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { createLogEntryElement, render as renderLog } from '../../src/ui/console/log.js';
import { loadData } from '../helpers/data.js';

const data = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes'),
  consumables: loadData('consumables'),
  symbolTable: loadData('symbol-table')
};

class FakeClassList {
  constructor(el) { this.el = el; this.values = new Set(); }
  add(...names) { for (const n of names) if (n) this.values.add(n); this.sync(); }
  remove(...names) { for (const n of names) this.values.delete(n); this.sync(); }
  toggle(n, force) { const next = force == null ? !this.values.has(n) : Boolean(force); if (next) this.values.add(n); else this.values.delete(n); this.sync(); return next; }
  contains(n) { return this.values.has(n); }
  sync() { this.el._className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tag, ns = null) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = { properties: {}, setProperty(name, value) { this.properties[name] = value; } };
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.disabled = false;
    this.parentNode = null;
  }
  set className(v) { this._className = String(v); this.classList.values = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this._className || this.attributes.get('class') || ''; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const c of children) this.appendChild(c); }
  prepend(...children) { this.children = [...children, ...this.children]; }
  replaceChildren() { this.children = []; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setAttributeNS(_ns, name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((c) => c !== listener)); }
  dispatch(type, event = {}) { for (const l of this.listeners.get(type) || []) l({ type, target: this, ...event }); }
  click() { if (this.disabled) return; this.dispatch('click'); }
}

function installDocument() {
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (ns, tag) => new FakeElement(tag, ns),
    createTextNode: (v) => Object.assign(new FakeElement('#text'), { textContent: v })
  };
  Object.defineProperty(globalThis, 'window', {
    value: { location: { origin: 'https://example.test', pathname: '/play/', search: '', href: 'https://example.test/play/#old' } },
    configurable: true
  });
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const c of root.children || []) {
    const hit = byTestId(c, testid);
    if (hit) return hit;
  }
  return null;
}

function firstIconChild(el) {
  return (el.children || []).find((c) => c.tagName === 'SVG') || null;
}

function character(overrides = {}) {
  return {
    id: 'operator', classId: 'operator', sigilId: 'pua-e028',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 6, foc: 5, sig: 4 },
    currentHP: 30, currentCHARGE: 10, calibrationCount: 0,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [], conditions: [], ...overrides
  };
}

function run(members = [character()]) {
  return createRunState(123, members, { creationTimestamp: 1, inventory: [], scrapCounter: 0, corruption: 0 });
}

beforeEach(installDocument);

describe('LOG mode — SESSION-06 icon coverage', () => {
  it('COPY LINK button prefixes a link lucide sprite in the enabled state', () => {
    const runState = run();
    const container = new FakeElement('div');
    renderLog(container, { runState, data, logEntries: [] });
    const copy = byTestId(container, 'log-copy-link');
    expect(copy).toBeTruthy();
    expect(copy.disabled).toBe(false);
    expect(firstIconChild(copy)).toBeTruthy();
    expect(copy.classList.contains('has-icon')).toBe(true);
    // SESSION-05 icon-first-ui-density: enabled COPY LINK is icon-only.
    expect(copy.classList.contains('icon-only')).toBe(true);
    // aria-label preserves the former visible label intent.
    expect(copy.getAttribute('aria-label')).toBe('Copy link');
    // Accent tone signals primary intent.
    expect(firstIconChild(copy).className.split(/\s+/)).toContain('icon-accent');
  });

  it('disabled COPY LINK (post-wipe) is inert on click and still shows the icon', () => {
    const runState = run([character({ currentHP: 0 })]);
    const container = new FakeElement('div');
    renderLog(container, { runState, data, runWiped: true });
    const copy = byTestId(container, 'log-copy-link');
    expect(copy.disabled).toBe(true);
    expect(firstIconChild(copy)).toBeTruthy();
    copy.click();
    // Nothing should render as notice/error from an inert click.
    expect(byTestId(container, 'log-notice')).toBe(null);
  });
});

function collectLogEntryRows(container) {
  // Match `log-entry-N` — NOT `log-entry-N-detail` (the detail child sits inside
  // the row and shares the `log-entry-` prefix but must not be counted as a row).
  const isRow = (id) => typeof id === 'string' && /^log-entry-\d+$/.test(id);
  const rows = [];
  function walk(node) {
    if (!node) return;
    if (isRow(node.dataset?.testid)) rows.push(node);
    for (const child of node.children || []) walk(child);
  }
  walk(container);
  return rows;
}

function messageText(row) {
  // Skip the stamp span (className "log-turn"); message span is class "log-<type>".
  return row.children.find((child) => (child.className || '').startsWith('log-') && child.className !== 'log-turn')?.textContent || '';
}

describe('LOG mode — slim persisted event rendering', () => {
  it('renders slim persisted entries as TYPE · message', () => {
    const runState = run();
    runState.recordEvent({ type: 'combat', message: 'Sidearm strikes drone.', sequence: 5 });
    runState.recordEvent({ type: 'loot', message: 'Container yields shard.', sequence: 6 });
    const container = new FakeElement('div');
    renderLog(container, { runState, data, logEntries: [] });
    const rows = collectLogEntryRows(container);
    expect(rows).toHaveLength(2);
    expect(messageText(rows[0])).toBe('COMBAT · Sidearm strikes drone.');
    expect(messageText(rows[1])).toBe('LOOT · Container yields shard.');
  });

  it('sanitizes legacy fat entries at the createRunState/load boundary so no detail row leaks in', () => {
    // A legacy save shape (timestamp + nested `entry` payload) is stripped by
    // normalizePersistedEvent on load. The row still renders — the sanitizer
    // preserves type/message/sequence — but the fat payload never reaches the
    // renderer, so no `.log-detail` line appears.
    const runState = createRunState(123, [character()], {
      creationTimestamp: 1,
      recentEvents: [{ type: 'discovery', message: 'Legacy discovery.', sequence: 1, timestamp: 999, entry: { detail: 'kept' } }]
    });
    expect(runState.recentEvents).toEqual([{ type: 'discovery', message: 'Legacy discovery.', sequence: 1 }]);
    const container = new FakeElement('div');
    renderLog(container, { runState, data, logEntries: [] });
    const rows = collectLogEntryRows(container);
    expect(rows).toHaveLength(1);
    expect(messageText(rows[0])).toBe('DISCOVERY · Legacy discovery.');
    expect(detailChild(rows[0])).toBe(null);
  });

  it('places restored persisted history before live entries when both are present', () => {
    // Post-resume mid-session: recentEvents has the historical tail (no live
    // sequence context yet), logEntries has fresh live activity from this session.
    const runState = createRunState(123, [character()], {
      creationTimestamp: 1,
      recentEvents: [
        { type: 'combat', message: 'Historical fight A.' },
        { type: 'combat', message: 'Historical fight B.' }
      ]
    });
    const liveNow = 1_700_000_000_000;
    const container = new FakeElement('div');
    renderLog(container, {
      runState,
      data,
      logEntries: [
        { type: 'loot', message: 'Live loot pickup.', sequence: liveNow + 1 },
        { type: 'move', message: 'Live footstep.', sequence: liveNow + 2 }
      ]
    });
    const rows = collectLogEntryRows(container);
    expect(rows.map(messageText)).toEqual([
      'COMBAT · Historical fight A.',
      'COMBAT · Historical fight B.',
      'LOOT · Live loot pickup.',
      'MOVE · Live footstep.'
    ]);
  });
});

describe('LOG mode — static density markers', () => {
  it('keeps the named focusable log surface while marking entries and empty content static', () => {
    const container = new FakeElement('div');
    renderLog(container, { runState: run(), data, logEntries: [] });
    const logArea = byTestId(container, 'log-area');
    expect(logArea.classList.contains('scroll-area')).toBe(true);
    expect(logArea.getAttribute('aria-label')).toBe('Recent event log');
    expect(logArea.tabIndex).toBe(0);
    const empty = logArea.children[0];
    expect(empty.classList.contains('console-static-row')).toBe(true);
    expect(empty.classList.contains('console-row')).toBe(false);

    const entry = createLogEntryElement({ type: 'combat', message: 'Drone defeated.', sequence: 1 }, 0);
    expect(entry.classList.contains('console-static-row')).toBe(true);
    expect(entry.classList.contains('console-row')).toBe(false);
  });
});

function detailChild(row) {
  return (row.children || []).find((child) => (child.className || '').includes('log-detail')) || null;
}

describe('createLogEntryElement — detail second line', () => {
  it('renders entry.detail on a second line under the message when the live payload carries it', () => {
    const row = createLogEntryElement({
      type: 'attack', message: 'operator attacks 0: 3 damage.',
      detail: 'd20 14 +3 FIN = 17 vs DEF 15 → HIT · d6=3 dmg',
      sequence: 12
    }, 0);
    const detail = detailChild(row);
    expect(detail).not.toBe(null);
    expect(detail.className).toBe('log-detail micro');
    expect(detail.textContent).toBe('d20 14 +3 FIN = 17 vs DEF 15 → HIT · d6=3 dmg');
    expect(detail.style.properties?.['padding-left'] === '34px' || detail.style.paddingLeft === '34px').toBe(true);
  });

  it('derives the detail line from raw roll fields when the payload lacks a precomputed detail', () => {
    const row = createLogEntryElement({
      type: 'attack', message: 'operator attacks 0: 4 damage.', sequence: 3,
      naturalRoll: 14, attribute: 'fin', attributeModifier: 3,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 17, targetDefense: 15,
      hit: true, crit: false, fumble: false,
      damage: 4, damageDie: 'd6', damageRoll: 4
    }, 0);
    const detail = detailChild(row);
    expect(detail).not.toBe(null);
    expect(detail.textContent).toBe('d20 14 +3 FIN = 17 vs DEF 15 → HIT · d6=4 dmg');
  });

  it('derives the detail line from a nested legacy entry.entry payload', () => {
    const row = createLogEntryElement({
      type: 'attack', message: 'operator attacks 0: miss.',
      entry: {
        type: 'attack', naturalRoll: 4, attribute: 'mgt', attributeModifier: 2,
        weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
        coverBonus: 0, roll: 6, targetDefense: 14,
        hit: false, crit: false, fumble: false, damage: 0, damageDie: 'd6', damageRoll: null
      }
    }, 0);
    const detail = detailChild(row);
    expect(detail).not.toBe(null);
    expect(detail.textContent).toBe('d20 4 +2 MGT = 6 vs DEF 14 → MISS');
  });

  it('renders no detail line for slim persisted entries (no detail, no roll fields)', () => {
    const row = createLogEntryElement({ type: 'combat', message: 'Sidearm strikes drone.', sequence: 5 }, 0);
    expect(detailChild(row)).toBe(null);
  });

  it('renders no detail line for notice-only entry types like move / end-turn', () => {
    const moveRow = createLogEntryElement({ type: 'move', message: 'operator moves n.', sequence: 1 }, 0);
    const endRow = createLogEntryElement({ type: 'end-turn', message: 'operator ends turn.', sequence: 2 }, 1);
    expect(detailChild(moveRow)).toBe(null);
    expect(detailChild(endRow)).toBe(null);
  });

  it('recordEvent strips detail — a persisted row rendered from recentEvents has no detail line even when the caller passed one', () => {
    // The canonical persisted boundary drops `detail` at recordEvent time, so
    // a resume-only render (logEntries: []) shows the slim one-line form.
    const runState = run();
    runState.recordEvent({
      type: 'attack',
      message: 'operator attacks 0: 3 damage.',
      sequence: 42,
      detail: 'd20 14 +3 FIN = 17 vs DEF 15 → HIT · d6=3 dmg'
    });
    expect(runState.recentEvents[0]).not.toHaveProperty('detail');
    const container = new FakeElement('div');
    renderLog(container, { runState, data, logEntries: [] });
    const rows = collectLogEntryRows(container);
    expect(rows).toHaveLength(1);
    expect(detailChild(rows[0])).toBe(null);
  });

  it('renders a live logEntries payload with its detail intact — live diagnostics are not weakened', () => {
    // logEntries is the live in-memory list runtime maintains alongside recentEvents.
    // It preserves rich fields for the current session's log, so the row exposes a
    // `.log-detail` second line even though the equivalent persisted event is slim.
    const runState = run();
    const container = new FakeElement('div');
    renderLog(container, {
      runState,
      data,
      logEntries: [{
        type: 'attack',
        message: 'operator attacks 0: 3 damage.',
        sequence: 42,
        detail: 'd20 14 +3 FIN = 17 vs DEF 15 → HIT · d6=3 dmg'
      }]
    });
    const rows = collectLogEntryRows(container);
    expect(rows).toHaveLength(1);
    const detail = detailChild(rows[0]);
    expect(detail).not.toBe(null);
    expect(detail.textContent).toBe('d20 14 +3 FIN = 17 vs DEF 15 → HIT · d6=3 dmg');
  });
});

describe('LOG mode — persisted + live dedupe', () => {
  it('renders a single row when the same event appears in both recentEvents and logEntries', () => {
    // Runtime pushes every combat entry to both stores; collectLogs must dedupe by
    // (type, sequence, message) so LOG mode doesn't show two identical rows for a
    // single event.
    const runState = createRunState(123, [character()], {
      creationTimestamp: 1,
      recentEvents: [{ type: 'attack', message: 'Operator strikes drone.', sequence: 5 }]
    });
    const container = new FakeElement('div');
    renderLog(container, {
      runState,
      data,
      logEntries: [{ type: 'attack', message: 'Operator strikes drone.', sequence: 5, detail: 'd20 14 = 14 vs DEF 12 → HIT · d6=3 dmg' }]
    });
    const rows = collectLogEntryRows(container);
    expect(rows).toHaveLength(1);
    // The richer entry (with detail) wins — its detail line must be present.
    const detail = detailChild(rows[0]);
    expect(detail).not.toBe(null);
    expect(detail.textContent).toBe('d20 14 = 14 vs DEF 12 → HIT · d6=3 dmg');
  });

  it('sanitizes persisted-side detail on load — a legacy detail-carrying recentEvent is stripped and the plain live duplicate wins with no detail line', () => {
    // After the SESSION-03 boundary change, persisted recentEvents can never carry
    // `detail` (the sanitizer strips it on both recordEvent and load). A single-row
    // dedupe with no detail is the expected outcome when the live copy is also plain.
    const runState = createRunState(123, [character()], {
      creationTimestamp: 1,
      recentEvents: [{ type: 'attack', message: 'Operator strikes drone.', sequence: 5, detail: 'd20 20 = 20 → HIT CRIT · d6=6 dmg' }]
    });
    expect(runState.recentEvents[0]).not.toHaveProperty('detail');
    const container = new FakeElement('div');
    renderLog(container, {
      runState,
      data,
      logEntries: [{ type: 'attack', message: 'Operator strikes drone.', sequence: 5 }]
    });
    const rows = collectLogEntryRows(container);
    expect(rows).toHaveLength(1);
    expect(detailChild(rows[0])).toBe(null);
  });
});
