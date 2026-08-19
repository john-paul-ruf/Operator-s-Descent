// SESSION-06 — LOG console icon coverage.
// The COPY LINK button prefixes a link sprite; the disabled variant (post-wipe)
// stays inert on click and still shows the icon.

import { beforeEach, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderLog } from '../../src/ui/console/log.js';
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
