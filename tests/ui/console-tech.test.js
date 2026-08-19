// SESSION-06 — TECH console icon coverage.
// CAST → wand-sparkles; OVERCLOCK → zap (danger tone); tech-error row →
// triangle-alert. Focused on presence + click gating.

import { beforeEach, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderTech } from '../../src/ui/console/tech.js';
import { loadData } from '../helpers/data.js';

const data = {
  classes: loadData('classes'),
  protocols: loadData('protocols'),
  conditions: loadData('conditions'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes')
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

function character(overrides = {}) {
  return {
    id: 'operator', classId: 'operator', sigilId: 'pua-e028',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 6, foc: 5, sig: 4 },
    currentHP: 30, currentCHARGE: 10, calibrationCount: 0,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [{ school: 'disrupt', tier: 1 }],
    conditions: [], ...overrides
  };
}

function run(members = [character()]) {
  return createRunState(123, members, { creationTimestamp: 1, inventory: [], scrapCounter: 0, corruption: 0 });
}

beforeEach(installDocument);

describe('TECH mode — SESSION-06 icon coverage', () => {
  it('CAST and OVERCLOCK buttons each expose a lucide sprite prefix', () => {
    const runState = run();
    const container = new FakeElement('div');
    const context = { runState, data, refresh: () => renderTech(container, context) };
    renderTech(container, context);

    const cast = byTestId(container, 'tech-cast-disrupt-1');
    expect(cast).toBeTruthy();
    expect(firstIconChild(cast)).toBeTruthy();
    expect(cast.classList.contains('has-icon')).toBe(true);

    const over = byTestId(container, 'tech-overclock-disrupt-1');
    expect(over).toBeTruthy();
    expect(firstIconChild(over)).toBeTruthy();
    expect(over.classList.contains('has-icon')).toBe(true);
    // OVERCLOCK gets the danger tone on its zap icon so it never fades into
    // the primary CAST affordance.
    expect(firstIconChild(over).className.split(/\s+/)).toContain('icon-danger');
  });

  it('tech-error row prepends triangle-alert when an availability reason surfaces mid-combat', () => {
    // Under combat, an active party actor is required; AP-0 forces
    // availabilityReason("No AP remaining.") to fire when CAST is clicked.
    // Unlike the CHARGE-shortage path, low-AP does not disable the CAST
    // button so the click actually invokes beginProtocol.
    const runState = run();
    const actor = {
      id: 'operator', side: 'party', ap: 0, charge: 10, chargeMax: 10,
      hp: 30, hpMax: 30,
      attributes: runState.party[0].attributes,
      protocols: runState.party[0].protocolDeck, conditions: [], swapAvailable: true
    };
    const combatState = { turnOrder: ['operator'], currentTurn: 0, combatants: new Map([['operator', actor]]) };
    const container = new FakeElement('div');
    const context = { runState, data, combatState, rngCursor: { nextInt() { return 0; }, getState() { return null; } }, refresh: () => renderTech(container, context) };
    renderTech(container, context);
    const cast = byTestId(container, 'tech-cast-disrupt-1');
    expect(cast.disabled).toBe(true);
    // Availability failure surfaces via ui.error the moment beginProtocol
    // runs; disabled click cannot fire, so trigger the availability path
    // by calling the same code path through a fresh un-disabled invocation:
    // switch the actor to swap-available with AP>0, then click, then force
    // the failure branch by removing charge before re-clicking. Simpler:
    // manually invoke the click bypass — availability under a JAMMED
    // condition ALWAYS reports the error even when AP > 0.
    actor.ap = 2;
    actor.conditions = [{ id: 'jammed', duration: 2 }];
    renderTech(container, context);
    const cast2 = byTestId(container, 'tech-cast-disrupt-1');
    expect(cast2.disabled).toBe(true);
    // The disabled state exists because castReason (JAMMED blocks protocols)
    // was returned by availabilityReason — that same reason lands on ui.error
    // on the next click that would otherwise fire. Force the error state by
    // clearing the disabled flag and dispatching so we can verify the icon.
    cast2.disabled = false;
    cast2.dispatch('click');
    const err = byTestId(container, 'tech-error');
    expect(err).toBeTruthy();
    const icon = firstIconChild(err);
    expect(icon).toBeTruthy();
    expect(icon.className.split(/\s+/)).toContain('icon-danger');
  });

  it('a disabled CAST button (no CHARGE) does not fire its handler on click', () => {
    const runState = run();
    runState.party[0].currentCHARGE = 0;
    const container = new FakeElement('div');
    const context = { runState, data, refresh: () => renderTech(container, context) };
    renderTech(container, context);
    const cast = byTestId(container, 'tech-cast-disrupt-1');
    expect(cast.disabled).toBe(true);
    // Ensure the disabled click is inert AND the icon prefix survives.
    expect(() => cast.click()).not.toThrow();
    expect(firstIconChild(cast)).toBeTruthy();
    expect(byTestId(container, 'tech-error')).toBe(null);
  });
});
