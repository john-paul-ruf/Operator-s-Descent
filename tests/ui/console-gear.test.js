// SESSION-06 — GEAR console icon coverage.
// Slot buttons (sword/shield/star), UNEQUIP (x), TAG/UNTAG JUNK (recycle),
// JUNK ALL TAGGED (recycle). Focused on presence + click gating; structural
// gear semantics live in ./party-gear.test.js.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderGear } from '../../src/ui/console/gear.js';
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

function firstIconChild(el) {
  return (el.children || []).find((c) => c.tagName === 'SVG') || null;
}

function item(id, baseType = 'sidearm', overrides = {}) {
  return { id, category: 'weapon', baseType, rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false, ...overrides };
}

function character(overrides = {}) {
  return {
    id: 'breacher', classId: 'breacher', sigilId: 'pua-e000',
    attributes: { mgt: 6, fin: 6, vit: 6, res: 6, foc: 5, sig: 5 },
    currentHP: 40, currentCHARGE: 10, calibrationCount: 0,
    equipment: { weapon: item('equipped-sidearm'), armor: null, offhand: null },
    protocolDeck: [], conditions: [],
    ...overrides
  };
}

function run(inventory = [], members = [character()]) {
  return createRunState(77, members, { creationTimestamp: 1, inventory, scrapCounter: 0, corruption: 0 });
}

beforeEach(installDocument);

describe('GEAR mode — SESSION-06 icon coverage', () => {
  it('slot buttons carry sword/shield/star icons and preserve their testids', () => {
    const runState = run();
    const container = new FakeElement('div');
    const context = { runState, data, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    for (const slot of ['weapon', 'armor', 'offhand']) {
      const button = byTestId(container, `gear-slot-${slot}`);
      expect(button, `missing gear-slot-${slot}`).toBeTruthy();
      expect(firstIconChild(button), `no icon on gear-slot-${slot}`).toBeTruthy();
      expect(button.classList.contains('has-icon')).toBe(true);
      expect(button.classList.contains('gear-slot')).toBe(true);
    }
  });

  it('UNEQUIP prefixes an x icon and TAG JUNK prefixes recycle; JUNK ALL prefixes recycle', () => {
    const runState = run([item('fresh-sidearm')]);
    const container = new FakeElement('div');
    const context = { runState, data, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    const unequip = byTestId(container, 'gear-unequip-weapon');
    expect(firstIconChild(unequip)).toBeTruthy();

    const tag = byTestId(container, 'gear-junk-fresh-sidearm');
    expect(firstIconChild(tag)).toBeTruthy();

    const junkAll = byTestId(container, 'gear-junk-all');
    expect(firstIconChild(junkAll)).toBeTruthy();
  });

  it('SESSION-03 — .card-classes chip lists the classes that can equip the item, on both equipped and inventory rows', () => {
    const runState = run([item('fresh-polearm', 'polearm')]);
    const container = new FakeElement('div');
    const context = { runState, data, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    // Equipped weapon slot holds a sidearm — every class can equip it.
    const equippedChip = byTestId(container, 'gear-classes-weapon');
    expect(equippedChip).toBeTruthy();
    expect(equippedChip.className.split(/\s+/)).toContain('card-classes');
    for (const name of ['Breacher', 'Ghost', 'Compiler', 'Anchor', 'Oracle', 'Operator']) {
      expect(equippedChip.textContent).toContain(name);
    }

    // Inventory polearm — Ghost + Oracle do not gate it.
    const invChip = byTestId(container, 'gear-classes-fresh-polearm');
    expect(invChip).toBeTruthy();
    expect(invChip.className.split(/\s+/)).toContain('card-classes');
    expect(invChip.textContent).toContain('Breacher');
    expect(invChip.textContent).not.toContain('Ghost');
    expect(invChip.textContent).not.toContain('Oracle');
  });

  it('a disabled icon-prefixed UNEQUIP does not fire its handler on click', () => {
    // Full inventory blocks the unequip transaction — the button is rendered
    // disabled, and clicking must not call requestUnequip (icon should never
    // become a click sink independent of the host button).
    const runState = run([...Array(100)].map((_, i) => item(`c-${i}`, 'sidearm', { category: 'consumable' })));
    const container = new FakeElement('div');
    const before = runState.party[0].equipment.weapon;
    const context = { runState, data, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    const unequip = byTestId(container, 'gear-unequip-weapon');
    expect(unequip.disabled).toBe(true);
    unequip.click();
    expect(runState.party[0].equipment.weapon).toBe(before);
  });
});
