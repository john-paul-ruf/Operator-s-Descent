import { beforeEach, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderParty } from '../../src/ui/console/party.js';
import { render as renderGear } from '../../src/ui/console/gear.js';
import { loadData } from '../helpers/data.js';

const data = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes'),
  protocols: loadData('protocols')
};

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
    this.innerHTML = '';
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
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, preventDefault() { this.prevented = true; }, ...event }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.focused = true; }
}

function installDocument() {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
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

function item(id, baseType = 'sidearm', overrides = {}) {
  const source = overrides.category === 'armor' ? data.equipment.armor[baseType] : data.equipment.weapons[baseType];
  return {
    id,
    category: overrides.category || (source?.defenseBonus != null && source?.damageDie == null ? 'armor' : 'weapon'),
    baseType,
    rarity: 'stock',
    affixes: [],
    corrupt: false,
    stats: {},
    salvageValue: source?.salvageValue ?? 1,
    junkTagged: false,
    ...overrides
  };
}

function consumable(id, count = 1, overrides = {}) {
  return { id, category: 'consumable', baseType: 'repair_patch', count, rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 2, junkTagged: false, ...overrides };
}

function character(overrides = {}) {
  return {
    id: 'breacher',
    classId: 'breacher',
    sigilId: 'pua-e000',
    attributes: { mgt: 6, fin: 6, vit: 6, res: 6, foc: 5, sig: 5 },
    currentHP: 40,
    currentCHARGE: 10,
    calibrationCount: 2,
    calibrationChoices: [{ floor: 3, optionId: 'breacher_mgt' }],
    signatureTier: 2,
    equipment: { weapon: item('equipped-sidearm'), armor: null, offhand: null },
    protocolDeck: [{ school: 'disrupt', tier: 1 }],
    conditions: [{ conditionId: 'shielded', duration: 2 }],
    ...overrides
  };
}

function run(inventory = [], members = [character()]) {
  return createRunState(77, members, { creationTimestamp: 1, inventory, scrapCounter: 3, corruption: 0.05 });
}

function renderGearWith(runState, extraContext = {}) {
  const container = new FakeElement('div');
  const context = { runState, data, refresh: () => renderGear(container, context), ...extraContext };
  renderGear(container, context);
  return { container, context };
}

beforeEach(installDocument);

describe('PARTY mode', () => {
  it('shows roster details, derived stats, conditions, equipment, deck, and combat resources', () => {
    const runState = run();
    const combatState = { turnOrder: ['breacher'], currentTurn: 0, combatants: new Map([['breacher', { id: 'breacher', side: 'party', hp: 35, hpMax: 40, charge: 8, chargeMax: 18, ap: 1, moveAvailable: false, swapAvailable: true, conditions: [{ id: 'burning', duration: 1 }] }]]) };
    const container = new FakeElement('div');

    renderParty(container, { runState, combatState, data });

    expect(byTestId(container, 'party-member-breacher')).toBeTruthy();
    expect(textOf(byTestId(container, 'party-combat-resources'))).toContain('AP 1');
    expect(textOf(byTestId(container, 'party-combat-resources'))).toContain('MOVE SPENT');
    expect(textOf(byTestId(container, 'party-defense'))).toContain('Defense');
    expect(textOf(byTestId(container, 'party-conditions'))).toContain('burning');
    expect(textOf(byTestId(container, 'party-equipment'))).toContain('sidearm');
    expect(textOf(byTestId(container, 'party-deck'))).toContain('SPARK');
  });
});

describe('GEAR mode', () => {
  it('equips and unequips through atomic run-state transactions', () => {
    const runState = run([item('fresh-sidearm')], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const { container } = renderGearWith(runState);

    byTestId(container, 'gear-equip-fresh-sidearm').click();
    expect(runState.party[0].equipment.weapon.id).toBe('fresh-sidearm');
    expect(runState.inventory).toHaveLength(0);

    byTestId(container, 'gear-unequip-weapon').click();
    expect(runState.party[0].equipment.weapon).toBe(null);
    expect(runState.inventory.map((entry) => entry.id)).toContain('fresh-sidearm');
  });

  it('disables class-illegal equipment with a visible reason', () => {
    const runState = run([item('sniper', 'sniper')]);
    const { container } = renderGearWith(runState);

    expect(byTestId(container, 'gear-equip-sniper').disabled).toBe(true);
    expect(byTestId(container, 'gear-equip-sniper').getAttribute('aria-description')).toBe('Class gate blocks this item.');
  });

  it('requires CORRUPT consent once and never refunds or double-charges the implant', () => {
    const corrupt = item('corrupt-sidearm', 'sidearm', { rarity: 'corrupt', corrupt: true, corruptionValue: 0.1, affixes: ['lucky'], salvageValue: 5 });
    const runState = run([corrupt], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const { container } = renderGearWith(runState);

    byTestId(container, 'gear-equip-corrupt-sidearm').click();
    expect(runState.party[0].equipment.weapon).toBe(null);
    expect(byTestId(container, 'gear-corrupt-warning')).toBeTruthy();
    byTestId(container, 'gear-confirm-corrupt').click();

    expect(runState.party[0].equipment.weapon.id).toBe('corrupt-sidearm');
    expect(runState.corruption).toBeCloseTo(0.15);
    byTestId(container, 'gear-unequip-weapon').click();
    byTestId(container, 'gear-equip-corrupt-sidearm').click();
    expect(runState.corruption).toBeCloseTo(0.15);
  });

  it('preserves the inventory cap when unequipping', () => {
    const runState = run([consumable('patches', 100)]);
    const { container } = renderGearWith(runState);

    expect(byTestId(container, 'gear-unequip-weapon').disabled).toBe(true);
    expect(runState.party[0].equipment.weapon.id).toBe('equipped-sidearm');
  });

  it('toggles junk tags, confirms destruction, and adds exact scrap', () => {
    const runState = run([item('junk-sidearm', 'sidearm', { salvageValue: 7 }), item('keeper', 'sidearm', { salvageValue: 3 })], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const { container } = renderGearWith(runState);

    byTestId(container, 'gear-junk-junk-sidearm').click();
    expect(runState.inventory.find((entry) => entry.id === 'junk-sidearm').junkTagged).toBe(true);
    byTestId(container, 'gear-junk-all').click();
    expect(textOf(byTestId(container, 'gear-notice'))).toContain('Confirm permanent junking');
    byTestId(container, 'gear-junk-all').click();

    expect(runState.inventory.map((entry) => entry.id)).toEqual(['keeper']);
    expect(runState.scrapCounter).toBe(10);
  });

  it('enforces the once-per-turn combat swap without spending AP', () => {
    const runState = run([item('fresh-sidearm'), item('backup-sidearm')]);
    const actor = { id: 'breacher', side: 'party', ap: 2, swapAvailable: true, weapon: runState.party[0].equipment.weapon, equipment: { ...runState.party[0].equipment } };
    const combatState = { turnOrder: ['breacher'], currentTurn: 0, combatants: new Map([['breacher', actor]]) };
    const { container } = renderGearWith(runState, { combatState });

    byTestId(container, 'gear-equip-fresh-sidearm').click();

    expect(actor.ap).toBe(2);
    expect(actor.swapAvailable).toBe(false);
    expect(runState.party[0].equipment.weapon.id).toBe('fresh-sidearm');
    expect(byTestId(container, 'gear-equip-backup-sidearm').disabled).toBe(true);
    expect(byTestId(container, 'gear-equip-backup-sidearm').getAttribute('aria-description')).toBe('Free combat swap already spent.');
  });
});
