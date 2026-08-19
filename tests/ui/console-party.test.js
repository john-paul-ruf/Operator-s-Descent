// SESSION-06 — PARTY console icon coverage.
// Sanity-checks that the derived-stat block, HP/CHG compact bars, and roster
// cards prefix a lucide sprite. Structural coverage lives in ./party-gear.test.js;
// this file only verifies the icon prefixes survive the render.

import { beforeEach, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderParty } from '../../src/ui/console/party.js';
import { loadData } from '../helpers/data.js';

const data = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes'),
  protocols: loadData('protocols')
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
    this.tabIndex = -1;
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
    createElementNS: (ns, tag) => new FakeElement(tag, ns)
  };
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const c of root.children || []) {
    const hit = byTestId(c, testid);
    if (hit) return hit;
  }
  return null;
}

function collectSvgs(root, out = []) {
  if (root.tagName === 'SVG') out.push(root);
  for (const c of root.children || []) collectSvgs(c, out);
  return out;
}

function character() {
  return {
    id: 'breacher',
    classId: 'breacher',
    sigilId: 'pua-e000',
    attributes: { mgt: 6, fin: 6, vit: 6, res: 6, foc: 5, sig: 5 },
    currentHP: 40, currentCHARGE: 10,
    calibrationCount: 0,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [], conditions: []
  };
}

beforeEach(installDocument);

describe('PARTY mode — SESSION-06 icon coverage', () => {
  it('derived-stat rows each expose at least one lucide sprite prefix', () => {
    const runState = createRunState(77, [character()], { creationTimestamp: 1, inventory: [], scrapCounter: 0, corruption: 0 });
    const container = new FakeElement('div');
    renderParty(container, { runState, data });

    const derived = byTestId(container, 'party-derived');
    expect(derived).toBeTruthy();
    // Six derived rows — each row now leads with an icon sprite.
    const svgs = collectSvgs(derived);
    expect(svgs.length).toBeGreaterThanOrEqual(6);
    for (const svg of svgs) {
      expect(svg.className.split(/\s+/)).toContain('icon');
    }
  });

  it('roster HP and CHG compact bars each carry a sprite prefix (heart / battery)', () => {
    const runState = createRunState(77, [character()], { creationTimestamp: 1, inventory: [], scrapCounter: 0, corruption: 0 });
    const container = new FakeElement('div');
    renderParty(container, { runState, data });

    const roster = byTestId(container, 'party-roster');
    expect(roster).toBeTruthy();
    // Roster HP + CHG bars produce two icons per card; a lone card yields ≥2.
    const svgs = collectSvgs(roster);
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders without throwing when document lacks createElementNS (icons silently skipped)', () => {
    globalThis.document = { createElement: (tag) => new FakeElement(tag) };
    const runState = createRunState(77, [character()], { creationTimestamp: 1, inventory: [], scrapCounter: 0, corruption: 0 });
    const container = new FakeElement('div');
    expect(() => renderParty(container, { runState, data })).not.toThrow();
    expect(collectSvgs(container).length).toBe(0);
  });
});
