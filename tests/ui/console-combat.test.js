// Focused tests for src/ui/console/combat.js — covers SESSION-05 checkpoint 4 changes:
// icon prefixes on every combat-action button, and disabled + is-illegal target rows for
// out-of-range candidates. Broader COMBAT-mode integration lives in
// tests/ui/tech-loot-log.test.js and tests/ui/combat-screen.test.js; this file exists so the
// console-specific icon/illegal wiring has a stable home inside SESSION-05's lease.

import { beforeEach, describe, expect, it } from 'vitest';
import { render as renderCombat } from '../../src/ui/console/combat.js';

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) { const next = force == null ? !this.values.has(name) : Boolean(force); if (next) this.values.add(name); else this.values.delete(name); this.sync(); return next; }
  contains(name) { return this.values.has(name); }
  sync() { this.element._className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tagName, namespace = null) {
    this.tagName = tagName.toUpperCase();
    this.namespace = namespace;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = { properties: {}, setProperty(name, value) { this.properties[name] = value; } };
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.tabIndex = -1;
    this.hidden = false;
    this.parentNode = null;
    this.innerHTML = '';
  }
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); this.attributes.set('class', this._className); }
  // createIcon() writes to the class attribute via setAttribute (not className) because it
  // operates on SVG elements. Fall back to the attribute so both APIs read the same string.
  get className() { return this._className || this.attributes.get('class') || ''; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  prepend(...children) { for (const child of children.reverse()) { child.parentNode = this; this.children.unshift(child); } }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; return child; }
  replaceChildren(...children) { this.children = []; for (const child of children) this.appendChild(child); }
  remove() { this.parentNode?.removeChild(this); }
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
    createElementNS: (namespace, tagName) => new FakeElement(tagName, namespace),
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

function collectAll(root, predicate, matches = []) {
  if (predicate(root)) matches.push(root);
  for (const child of root.children || []) collectAll(child, predicate, matches);
  return matches;
}

function svgChild(button) {
  return (button.children || []).find((child) => child.tagName === 'SVG');
}

function makeActive(overrides = {}) {
  return {
    id: 'operator', name: 'Operator', side: 'party', sigilCodepoint: 0xE028,
    hp: 30, hpMax: 30, charge: 8, chargeMax: 10, ap: 2, moveAvailable: true,
    conditions: [], ...overrides
  };
}

function makeEnemy(overrides = {}) {
  return { id: 'enemy', name: 'Drone', side: 'enemy', hp: 10, hpMax: 10, ...overrides };
}

function renderContext({ active, enemies, selection, previewFor }) {
  const combatants = new Map();
  combatants.set(active.id, active);
  for (const enemy of enemies) combatants.set(enemy.id, enemy);
  return {
    combatState: { combatants, turnOrder: [active.id, ...enemies.map((e) => e.id)], currentTurn: 0 },
    selection,
    combatGetActiveActor: () => active,
    combatGetLegalActions: () => ({ actions: ['move', 'attack', 'cast', 'overclock', 'item', 'retreat', 'wait', 'end-turn'], legalMoveDirections: ['s'] }),
    combatGetTargets: () => enemies,
    combatGetPreview: previewFor
  };
}

beforeEach(() => installDocument());

describe('console/combat.js — action button icons (SESSION-05 checkpoint 4)', () => {
  it('every combat-action button contains an <svg> icon child with the icon class', () => {
    const active = makeActive();
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active,
      enemies: [makeEnemy()],
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    }));

    for (const id of ['move', 'attack', 'cast', 'overclock', 'item', 'retreat', 'end-turn']) {
      const button = byTestId(container, `combat-action-${id}`);
      expect(button, `combat-action-${id} exists`).toBeTruthy();
      const icon = svgChild(button);
      expect(icon, `combat-action-${id} has an svg icon`).toBeTruthy();
      expect(icon.className).toContain('icon');
    }
  });

  it('each action icon uses the id declared in ACTIONS and links to the sprite via <use href>', () => {
    const expectedIcons = {
      move: 'arrow-down-right',
      attack: 'sword',
      cast: 'wand-sparkles',
      overclock: 'zap',
      item: 'flame',
      retreat: 'arrow-up-right',
      'end-turn': 'clock'
    };
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active: makeActive(),
      enemies: [makeEnemy()],
      selection: { phase: 'choose-action' },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true }, coverBonus: 0, flanked: false, targetLegal: true })
    }));

    for (const [actionId, iconId] of Object.entries(expectedIcons)) {
      const button = byTestId(container, `combat-action-${actionId}`);
      const svg = svgChild(button);
      const useEl = (svg.children || []).find((c) => c.tagName === 'USE');
      expect(useEl, `combat-action-${actionId} has <use>`).toBeTruthy();
      expect(useEl.getAttribute('href')).toBe(`assets/icons.svg#${iconId}`);
    }
  });
});

describe('console/combat.js — out-of-range target rows (SESSION-05 checkpoint 4)', () => {
  it('an illegal (targetLegal:false) target row is disabled and carries the is-illegal class', () => {
    const active = makeActive();
    const legalEnemy = makeEnemy({ id: 'near', name: 'Near' });
    const illegalEnemy = makeEnemy({ id: 'far', name: 'Far' });
    const previews = {
      near: { distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true },
      far: { distance: 5, range: { band: 'adjacent', legal: false, reason: 'beyond_maximum' }, coverBonus: 0, flanked: false, targetLegal: false }
    };
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active,
      enemies: [legalEnemy, illegalEnemy],
      selection: { phase: 'choose-target', actionType: 'attack', targetId: 'near' },
      previewFor: (id) => previews[id]
    }));

    const illegalRow = byTestId(container, 'combat-target-far');
    expect(illegalRow.disabled).toBe(true);
    expect(illegalRow.className).toContain('is-illegal');
    // The legal sibling stays interactive.
    const legalRow = byTestId(container, 'combat-target-near');
    expect(legalRow.disabled).toBe(false);
    expect(legalRow.className).not.toContain('is-illegal');
  });

  it('illegal target row shows a circle-x tone-danger icon with the reason as accessible label', () => {
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active: makeActive(),
      enemies: [makeEnemy({ id: 'far' })],
      selection: { phase: 'choose-target', actionType: 'attack', targetId: null },
      previewFor: () => ({ distance: 6, range: { band: 'adjacent', legal: false, reason: 'beyond_maximum' }, coverBonus: 0, flanked: false, targetLegal: false })
    }));

    const row = byTestId(container, 'combat-target-far');
    const icon = svgChild(row);
    expect(icon).toBeTruthy();
    expect(icon.className).toContain('icon-14');
    expect(icon.className).toContain('icon-danger');
    // aria-label is set when the caller passes `label` (createIcon writes role="img" + aria-label).
    expect(icon.getAttribute('aria-label')).toBe('out of range');
    // Row text mentions the reason for sighted users.
    expect(row.textContent).toContain('OUT OF RANGE');
  });

  it('clicking a disabled illegal target row does NOT invoke combatSelectTarget', () => {
    const calls = [];
    const container = new FakeElement('div');
    const context = renderContext({
      active: makeActive(),
      enemies: [makeEnemy({ id: 'far' })],
      selection: { phase: 'choose-target', actionType: 'attack', targetId: null },
      previewFor: () => ({ distance: 6, range: { band: 'adjacent', legal: false, reason: 'beyond_maximum' }, coverBonus: 0, flanked: false, targetLegal: false })
    });
    context.combatSelectTarget = (id) => calls.push(id);
    renderCombat(container, context);

    const row = byTestId(container, 'combat-target-far');
    row.click();
    expect(calls).toEqual([]);
  });

  it('legal target row still invokes combatSelectTarget on click', () => {
    const calls = [];
    const container = new FakeElement('div');
    const context = renderContext({
      active: makeActive(),
      enemies: [makeEnemy({ id: 'near' })],
      selection: { phase: 'choose-target', actionType: 'attack', targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    });
    context.combatSelectTarget = (id) => calls.push(id);
    renderCombat(container, context);

    byTestId(container, 'combat-target-near').click();
    expect(calls).toEqual(['near']);
  });

  it('item action does not gate targets by range (targetLegal is always true)', () => {
    // Item targets are always party members and never carry a range restriction — the range
    // gate is scoped to attack/cast/overclock only. This test guards the boundary so a future
    // change doesn't accidentally disable a party-heal button.
    const active = makeActive({ id: 'operator' });
    const ally = { id: 'ally', name: 'Ally', side: 'party', hp: 5, hpMax: 30, sigilCodepoint: 0xE001, conditions: [] };
    const container = new FakeElement('div');
    const combatants = new Map([[active.id, active], [ally.id, ally]]);
    renderCombat(container, {
      combatState: { combatants, turnOrder: [active.id, ally.id], currentTurn: 0 },
      selection: { phase: 'choose-target', actionType: 'item', targetId: 'ally', itemId: 'repair_patch' },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['move', 'attack', 'item'], legalMoveDirections: [] }),
      combatGetTargets: () => [ally],
      combatGetPreview: () => ({ distance: 4, range: { band: 'self-or-adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    });

    const row = byTestId(container, 'combat-target-ally');
    expect(row.disabled).toBe(false);
    expect(row.className).not.toContain('is-illegal');
  });
});

describe('console/combat.js — double-activate + effect-aware picker (SESSION-03)', () => {
  it('double-activating a legal target row selects then confirms in one gesture', () => {
    const calls = [];
    const container = new FakeElement('div');
    const context = renderContext({
      active: makeActive(),
      enemies: [makeEnemy({ id: 'near', name: 'Near' })],
      selection: { phase: 'choose-target', actionType: 'attack', targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    });
    context.combatSelectTarget = (id) => calls.push(['select', id]);
    context.combatConfirm = () => calls.push(['confirm']);
    renderCombat(container, context);

    byTestId(container, 'combat-target-near').dispatch('dblclick');
    expect(calls).toEqual([['select', 'near'], ['confirm']]);
  });

  it('double-activating an illegal target row neither selects nor confirms', () => {
    const calls = [];
    const container = new FakeElement('div');
    const context = renderContext({
      active: makeActive(),
      enemies: [makeEnemy({ id: 'far' })],
      selection: { phase: 'choose-target', actionType: 'attack', targetId: null },
      previewFor: () => ({ distance: 6, range: { band: 'adjacent', legal: false, reason: 'beyond_maximum' }, coverBonus: 0, flanked: false, targetLegal: false })
    });
    context.combatSelectTarget = (id) => calls.push(['select', id]);
    context.combatConfirm = () => calls.push(['confirm']);
    renderCombat(container, context);

    byTestId(container, 'combat-target-far').dispatch('dblclick');
    expect(calls).toEqual([]);
  });

  it('a resolving turn does not double-activate a target row', () => {
    const calls = [];
    const container = new FakeElement('div');
    const context = renderContext({
      active: makeActive(),
      enemies: [makeEnemy({ id: 'near' })],
      selection: { phase: 'confirm', actionType: 'attack', targetId: 'near', resolving: true },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    });
    context.combatSelectTarget = (id) => calls.push(['select', id]);
    context.combatConfirm = () => calls.push(['confirm']);
    renderCombat(container, context);

    byTestId(container, 'combat-target-near').dispatch('dblclick');
    expect(calls).toEqual([]);
  });

  it('the combat protocol picker renders the authored effect + range line', () => {
    const active = makeActive({ protocols: [{ school: 'disrupt', tier: 1 }] });
    const container = new FakeElement('div');
    renderCombat(container, {
      combatState: { combatants: new Map([[active.id, active]]), turnOrder: [active.id], currentTurn: 0 },
      selection: { phase: 'choose-protocol', actionType: 'cast', targetId: null },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['cast'], legalMoveDirections: [] }),
      combatGetTargets: () => [],
      combatGetPreview: () => null,
      protocolsData: { schools: { disrupt: { tiers: [{ name: 'Spark', chargeCost: 2, effect: 'Deal 1d6 disrupt', range: '3' }] } } }
    });

    const card = byTestId(container, 'combat-protocol-disrupt-1');
    expect(card).toBeTruthy();
    const effect = (card.children || []).find((c) => c.className.split(/\s+/).includes('card-effect'));
    expect(effect).toBeTruthy();
    expect(effect.textContent).toContain('Deal 1d6 disrupt');
    expect(effect.textContent).toContain('Range: 3');
  });

  it('double-activating a protocol card selects it without confirming (cast needs a target)', () => {
    const calls = [];
    const active = makeActive({ protocols: [{ school: 'disrupt', tier: 1 }] });
    const container = new FakeElement('div');
    const context = {
      combatState: { combatants: new Map([[active.id, active]]), turnOrder: [active.id], currentTurn: 0 },
      selection: { phase: 'choose-protocol', actionType: 'cast', targetId: null },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['cast'], legalMoveDirections: [] }),
      combatGetTargets: () => [],
      combatGetPreview: () => null,
      protocolsData: { schools: { disrupt: { tiers: [{ name: 'Spark', chargeCost: 2, effect: 'Deal 1d6', range: '3' }] } } },
      combatSelectProtocol: (p) => calls.push(['select', p.school, p.tier]),
      combatConfirm: () => calls.push(['confirm'])
    };
    renderCombat(container, context);

    byTestId(container, 'combat-protocol-disrupt-1').dispatch('dblclick');
    expect(calls).toEqual([['select', 'disrupt', 1]]);
  });
});

// SESSION-02 (Issue C): every non-END-TURN action carries an explicit disabled
// reason. The test context varies per action to make one precondition fail at a
// time; each assertion checks the DOM's `disabled` flag, the reason exposed via
// `title` (tooltip) and `aria-description` (createButton), AND that clicking
// the disabled button is inert.
describe('console/combat.js — action button disabled reasons (SESSION-02)', () => {
  function makePartyContext({ active, legalActions, items = [], protocolsData = { schools: {} } }) {
    const combatants = new Map([[active.id, active]]);
    return {
      combatState: { combatants, turnOrder: [active.id], currentTurn: 0 },
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => legalActions,
      combatGetTargets: () => [],
      combatGetPreview: () => null,
      combatGetItems: () => items,
      combatChooseAction: () => {},
      protocolsData
    };
  }

  const ALL_ACTIONS = ['move', 'attack', 'cast', 'overclock', 'item', 'retreat', 'wait', 'end-turn'];

  it('ATTACK — disabled when the active actor has no weapon equipped', () => {
    const active = makeActive({ ap: 1, weapon: null });
    const context = makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: [] }
    });
    const container = new FakeElement('div');
    renderCombat(container, context);
    const button = byTestId(container, 'combat-action-attack');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('No weapon equipped.');
    expect(button.getAttribute('aria-description')).toBe('No weapon equipped.');
  });

  it('ATTACK — disabled with "No targets in range." when combatActionTargeting reports 0 legal targets', () => {
    const active = makeActive({ ap: 1, weapon: { damageDie: 'd6', maxRange: 1 } });
    const context = makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: [] }
    });
    context.combatActionTargeting = () => ({ total: 2, legal: 0 });
    const container = new FakeElement('div');
    renderCombat(container, context);
    const button = byTestId(container, 'combat-action-attack');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('No targets in range.');
  });

  it('ATTACK — disabled with "No targets." when there are no enemy targets at all', () => {
    const active = makeActive({ ap: 1, weapon: { damageDie: 'd6', maxRange: 1 } });
    const context = makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: [] }
    });
    context.combatActionTargeting = () => ({ total: 0, legal: 0 });
    const container = new FakeElement('div');
    renderCombat(container, context);
    const button = byTestId(container, 'combat-action-attack');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('No targets.');
  });

  it('ATTACK — enabled when at least one enemy is within range', () => {
    const active = makeActive({ ap: 1, weapon: { damageDie: 'd6', maxRange: 1 } });
    const context = makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: [] }
    });
    context.combatActionTargeting = () => ({ total: 2, legal: 1 });
    const container = new FakeElement('div');
    renderCombat(container, context);
    const button = byTestId(container, 'combat-action-attack');
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('title')).toBe(null);
  });

  it('CAST — disabled when no prepared protocol is affordable at current CHARGE', () => {
    const active = makeActive({
      ap: 1, charge: 0,
      protocols: [{ school: 'signal', tier: 1 }]
    });
    const protocolsData = { schools: { signal: { tiers: [{ chargeCost: 3 }] } } };
    const container = new FakeElement('div');
    renderCombat(container, makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: [] },
      protocolsData
    }));
    const button = byTestId(container, 'combat-action-cast');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Not enough CHARGE for any prepared protocol.');
  });

  it('OVERCLOCK — disabled with "Not legal this turn." when rules exclude it from legalActions', () => {
    const active = makeActive({ ap: 1, protocols: [{ school: 'signal', tier: 1 }] });
    const container = new FakeElement('div');
    renderCombat(container, makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS.filter((id) => id !== 'overclock'), legalMoveDirections: [] },
      protocolsData: { schools: { signal: { tiers: [{ chargeCost: 0 }] } } }
    }));
    const button = byTestId(container, 'combat-action-overclock');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Not legal this turn.');
  });

  it('ITEM — disabled when the consumables list is empty', () => {
    const active = makeActive({ ap: 1 });
    const container = new FakeElement('div');
    renderCombat(container, makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: [] },
      items: []
    }));
    const button = byTestId(container, 'combat-action-item');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('No consumables.');
  });

  it('RETREAT — disabled with "No AP." when the active actor has 0 AP', () => {
    const active = makeActive({ ap: 0 });
    const container = new FakeElement('div');
    renderCombat(container, makePartyContext({
      active,
      // At 0 AP, src/rules/combat.js excludes retreat from legalActions; the
      // console reason chain hits the "Not legal this turn." branch first. The
      // legacy `combat-action-${id}` check for AP still guarantees the button
      // is disabled — which is what the user cares about.
      legalActions: { actions: ALL_ACTIONS.filter((id) => id !== 'retreat'), legalMoveDirections: [] }
    }));
    const button = byTestId(container, 'combat-action-retreat');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Not legal this turn.');
  });

  it('END TURN — never disabled, even when active actor has 0 AP', () => {
    const active = makeActive({ ap: 0 });
    const container = new FakeElement('div');
    renderCombat(container, makePartyContext({
      active,
      legalActions: { actions: ['wait', 'end-turn'], legalMoveDirections: [] }
    }));
    const button = byTestId(container, 'combat-action-end-turn');
    expect(button.disabled).toBe(false);
    // No reason → no title attribute set. aria-description similarly absent.
    expect(button.getAttribute('title')).toBe(null);
  });

  it('disabled action button does NOT invoke combatChooseAction on click', () => {
    const calls = [];
    const active = makeActive({ ap: 1, weapon: null });
    const context = makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: [] }
    });
    context.combatChooseAction = (id) => calls.push(id);
    const container = new FakeElement('div');
    renderCombat(container, context);
    byTestId(container, 'combat-action-attack').click();
    expect(calls).toEqual([]);
  });
});
