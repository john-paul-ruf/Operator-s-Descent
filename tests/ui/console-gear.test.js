// SESSION-06 — GEAR console icon coverage.
// Slot buttons (sword/shield/star), UNEQUIP (x), TAG/UNTAG JUNK (recycle),
// JUNK ALL TAGGED (recycle). Focused on presence + click gating; structural
// gear semantics live in ./party-gear.test.js.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderGear } from '../../src/ui/console/gear.js';
import { bus, validateEventPayload } from '../../src/state/bus.js';
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

  it('SESSION-03 — with a 6-item inventory every EQUIP button is a visible in-flow child of its row', () => {
    const inventory = Array.from({ length: 6 }, (_, i) => item(`inv-${i}`, 'sidearm'));
    const runState = run(inventory, [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const container = new FakeElement('div');
    const context = { runState, data, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    for (let i = 0; i < 6; i++) {
      const row = byTestId(container, `gear-item-inv-${i}`);
      expect(row, `row inv-${i} exists`).toBeTruthy();
      const equip = byTestId(row, `gear-equip-inv-${i}`);
      expect(equip, `equip button inv-${i} present`).toBeTruthy();
      // In-flow: the button is a direct descendant of its row, not detached/hidden.
      expect(equip.parentNode).toBe(row);
      expect(equip.disabled).toBe(false);
      expect(equip.className.split(/\s+/)).not.toContain('is-collapsed');
    }
  });

  it('SESSION-03 — double-activating an inventory row equips the item without the EQUIP button', () => {
    const runState = run([item('dbl-sidearm', 'sidearm')], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const container = new FakeElement('div');
    const context = { runState, data, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    const row = byTestId(container, 'gear-item-dbl-sidearm');
    row.dispatch('dblclick');
    expect(runState.party[0].equipment.weapon.id).toBe('dbl-sidearm');
    expect(runState.inventory).toHaveLength(0);
  });

  it('SESSION-03 — double-activating a corrupt inventory row surfaces the consent warning, not an equip', () => {
    const corrupt = item('dbl-corrupt', 'sidearm', { rarity: 'corrupt', corrupt: true, corruptionValue: 0.1 });
    const runState = run([corrupt], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const container = new FakeElement('div');
    const context = { runState, data, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    byTestId(container, 'gear-item-dbl-corrupt').dispatch('dblclick');
    expect(runState.party[0].equipment.weapon).toBe(null);
    expect(byTestId(container, 'gear-corrupt-warning')).toBeTruthy();
  });

  it('SESSION-03 — a successful equip dispatches state:inventory-change with the current runState', () => {
    const runState = run([item('fresh-sidearm', 'sidearm')], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const container = new FakeElement('div');
    const dispatch = vi.fn();
    const context = { runState, data, bus: { dispatch }, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    byTestId(container, 'gear-equip-fresh-sidearm').click();

    const inventoryEvents = dispatch.mock.calls.filter(([event]) => event === 'state:inventory-change');
    expect(inventoryEvents).toHaveLength(1);
    expect(inventoryEvents[0][1]).toEqual({ runState });
    // SESSION-05 — the emitted payload must satisfy the exported bus contract
    // (validateEventPayload = hasRunState) so runtime autosave never drops it.
    expect(validateEventPayload('state:inventory-change', inventoryEvents[0][1])).toBe(true);
  });

  it('SESSION-05 — a successful equip through the real bus reaches subscribers and returns true', () => {
    const runState = run([item('real-bus-sidearm', 'sidearm')], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const container = new FakeElement('div');
    const seen = [];
    const off = bus.on('state:inventory-change', (payload) => seen.push(payload));
    // Track dispatch return values so we can assert the contract accepts the
    // real payload (rejected dispatches return false and never invoke listeners).
    const results = [];
    const context = {
      runState,
      data,
      bus: { dispatch: (event, payload) => { const ok = bus.dispatch(event, payload); results.push({ event, ok }); return ok; } },
      refresh: () => renderGear(container, context)
    };
    renderGear(container, context);

    byTestId(container, 'gear-equip-real-bus-sidearm').click();

    const inventoryEvents = seen;
    expect(inventoryEvents).toHaveLength(1);
    expect(inventoryEvents[0]).toEqual({ runState });
    const inventoryResults = results.filter((entry) => entry.event === 'state:inventory-change');
    expect(inventoryResults).toHaveLength(1);
    expect(inventoryResults[0].ok).toBe(true);
    off();
  });

  it('SESSION-03 — a junk-toggle dispatches state:inventory-change on success and not on failure', () => {
    const runState = run([item('inv-junk', 'sidearm')]);
    const container = new FakeElement('div');
    const dispatch = vi.fn();
    const context = { runState, data, bus: { dispatch }, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    byTestId(container, 'gear-junk-inv-junk').click();
    let events = dispatch.mock.calls.filter(([event]) => event === 'state:inventory-change');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toEqual({ runState });
    // SESSION-05 — payload must satisfy the exported contract on every success.
    expect(validateEventPayload('state:inventory-change', events[0][1])).toBe(true);

    // Untag the same item — another successful toggle → second dispatch.
    byTestId(container, 'gear-junk-inv-junk').click();
    events = dispatch.mock.calls.filter(([event]) => event === 'state:inventory-change');
    expect(events).toHaveLength(2);
    expect(validateEventPayload('state:inventory-change', events[1][1])).toBe(true);
  });

  it('SESSION-05 — a junk-toggle failure (missing item) emits no state:inventory-change event', () => {
    // toggleJunkTag returns { success: false } when the item id is absent, so
    // requestJunkToggle takes the error branch and must NOT dispatch. Renders
    // the button by placing a matching item, then removes it from inventory
    // before clicking so the click hits a stale row.
    const runState = run([item('stale-item', 'sidearm')]);
    const container = new FakeElement('div');
    const dispatch = vi.fn();
    const context = { runState, data, bus: { dispatch }, refresh: () => renderGear(container, context) };
    renderGear(container, context);

    runState.inventory = [];

    byTestId(container, 'gear-junk-stale-item').click();
    const events = dispatch.mock.calls.filter(([event]) => event === 'state:inventory-change');
    expect(events).toHaveLength(0);
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
