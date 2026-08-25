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

// SESSION-02 (mobile-ux) — the action list and direction pad must carry stable
// classes so the portrait CSS density rules (1fr grid, 48px min-height) apply
// without special-casing. Testids are preserved for touch-flow.spec.js.
describe('console/combat.js — portrait action-list + direction-pad density scaffolding (SESSION-02)', () => {
  const ALL_ACTIONS = ['move', 'attack', 'cast', 'overclock', 'item', 'retreat', 'wait', 'end-turn'];

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
      combatGetPathSteps: () => ['n', 's', 'e', 'w'],
      combatStepPath: () => {},
      protocolsData
    };
  }

  it('the action list renders every button with the `combat-action` + `console-row` classes and a stable testid', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } });
    const container = new FakeElement('div');
    renderCombat(container, makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: [] }
    }));

    const list = byTestId(container, 'combat-actions');
    expect(list).not.toBe(null);
    expect(list.className.split(/\s+/)).toContain('combat-action-list');

    for (const id of ['move', 'attack', 'cast', 'overclock', 'item', 'retreat', 'end-turn']) {
      const button = byTestId(container, `combat-action-${id}`);
      expect(button, `combat-action-${id} exists`).toBeTruthy();
      const classes = button.className.split(/\s+/);
      expect(classes, `combat-action-${id} carries .combat-action`).toContain('combat-action');
      expect(classes, `combat-action-${id} carries .console-row`).toContain('console-row');
      // No inline styles fighting the density CSS — width/min-height come from
      // components.css `.combat-action { width: 100%; min-height: 48px; ... }`.
      expect(button.style.width).toBeFalsy();
      expect(button.style.minHeight).toBeFalsy();
    }
  });

  it('the direction pad renders under `combat-direction-grid` with 8 direction buttons + a center readout', () => {
    const active = makeActive({ ap: 2 });
    const context = makePartyContext({
      active,
      legalActions: { actions: ALL_ACTIONS, legalMoveDirections: ['n', 's', 'e', 'w'] }
    });
    context.selection = { phase: 'choose-path', actionType: 'move', movePath: [] };
    const container = new FakeElement('div');
    renderCombat(container, context);

    const grid = byTestId(container, 'combat-directions');
    expect(grid).not.toBe(null);
    expect(grid.className.split(/\s+/)).toContain('combat-direction-grid');

    for (const dir of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
      const button = byTestId(container, `combat-dir-${dir}`);
      expect(button, `combat-dir-${dir} exists`).toBeTruthy();
      expect(button.className.split(/\s+/)).toContain('combat-direction');
    }
    const center = byTestId(container, 'combat-dir-center');
    expect(center).not.toBe(null);
    expect(center.className.split(/\s+/)).toContain('combat-direction');
  });
});

describe('console/combat.js — direction cells + BACK icons (SESSION-05 icon-first-ui-density)', () => {
  const DIR_ICONS = {
    n: 'arrow-up', ne: 'arrow-up-right', e: 'arrow-right', se: 'arrow-down-right',
    s: 'arrow-down', sw: 'arrow-down-left', w: 'arrow-left', nw: 'arrow-up-left'
  };

  function pathContext(active) {
    return {
      combatState: { combatants: new Map([[active.id, active]]), turnOrder: [active.id], currentTurn: 0 },
      selection: { phase: 'choose-path', actionType: 'move', movePath: [{ direction: 'n' }] },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['move'], legalMoveDirections: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] }),
      combatGetPathSteps: () => ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
      combatGetTargets: () => [],
      combatGetPreview: () => null,
      combatStepPath: () => {},
      combatPopPath: () => {}
    };
  }

  it('each of the 8 direction cells prefixes an arrow-<dir> lucide sprite and drops the arrow character', () => {
    const container = new FakeElement('div');
    renderCombat(container, pathContext(makeActive({ ap: 2 })));
    for (const [dir, iconId] of Object.entries(DIR_ICONS)) {
      const cell = byTestId(container, `combat-dir-${dir}`);
      expect(cell, `combat-dir-${dir} exists`).toBeTruthy();
      const svg = svgChild(cell);
      expect(svg, `combat-dir-${dir} has an svg icon`).toBeTruthy();
      const useEl = (svg.children || []).find((c) => c.tagName === 'USE');
      expect(useEl.getAttribute('href')).toBe(`assets/icons.svg#${iconId}`);
      // Arrow character no longer painted alongside the sprite.
      expect(cell.textContent.trim()).not.toMatch(/[↑↓←→↖↗↙↘]/);
      // aria-label preserves the former direction phrasing.
      expect(cell.getAttribute('aria-label')).toBe(`Step ${dir}`);
    }
    // Center cell keeps its value chip text — no icon swap.
    const center = byTestId(container, 'combat-dir-center');
    expect(svgChild(center)).toBeFalsy();
    expect(center.textContent).toMatch(/LEFT/);
  });

  it('UNDO row (path length > 0) carries an arrow-up-left icon + text keeps', () => {
    const container = new FakeElement('div');
    renderCombat(container, pathContext(makeActive({ ap: 2 })));
    const undo = byTestId(container, 'combat-undo');
    expect(undo).toBeTruthy();
    const svg = svgChild(undo);
    expect(svg).toBeTruthy();
    expect((svg.children || []).find((c) => c.tagName === 'USE').getAttribute('href')).toBe('assets/icons.svg#arrow-up-left');
    expect(undo.textContent).toBe('UNDO');
  });

  it('BACK button (confirm phase) is icon-only with arrow-left sprite and aria-label "BACK"', () => {
    const active = makeActive({ ap: 2 });
    const container = new FakeElement('div');
    renderCombat(container, {
      combatState: { combatants: new Map([[active.id, active]]), turnOrder: [active.id], currentTurn: 0 },
      selection: { phase: 'confirm', actionType: 'attack', targetId: 'enemy' },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['attack'], legalMoveDirections: [] }),
      combatGetTargets: () => [makeEnemy({ id: 'enemy' })],
      combatGetPreview: () => ({ distance: 1, range: { band: 'adjacent', legal: true }, coverBonus: 0, flanked: false, targetLegal: true })
    });
    const back = byTestId(container, 'combat-back');
    expect(back).toBeTruthy();
    expect(back.classList.contains('icon-only')).toBe(true);
    const svg = svgChild(back);
    expect(svg).toBeTruthy();
    expect((svg.children || []).find((c) => c.tagName === 'USE').getAttribute('href')).toBe('assets/icons.svg#arrow-left');
    expect(back.getAttribute('aria-label')).toBe('BACK');
  });
});

// SESSION-01 (mobile-combat-density-repair checkpoint 2) — each action button's
// visible label shrinks to a concise verb + a compact cost chip; the full
// phrase (verb + needs) moves to the accessible name instead of disappearing.
describe('console/combat.js — compact visible label + cost chip + full accessible name (SESSION-01 mobile-combat-density-repair)', () => {
  const EXPECTED = {
    move: { visible: 'MOVE', aria: 'Move · up to 5 cells', cost: '≤5' },
    attack: { visible: 'ATTACK', aria: 'Attack · 1 AP', cost: '1 AP' },
    cast: { visible: 'PROTOCOL', aria: 'Protocol · 1 AP + CHARGE', cost: '1 AP+CHG' },
    overclock: { visible: 'OVERCLOCK', aria: 'Overclock · 1 AP + overclock CHARGE', cost: '1 AP+OC' },
    item: { visible: 'ITEM', aria: 'Item · 1 AP', cost: '1 AP' },
    retreat: { visible: 'RETREAT', aria: 'Retreat · 1 AP', cost: '1 AP' },
    'end-turn': { visible: 'END TURN', aria: 'End Turn · explicit', cost: null }
  };

  it('every action button carries a concise visible verb, the full phrase as its accessible name, and a compact cost chip', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } });
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active,
      enemies: [makeEnemy()],
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    }));

    for (const [id, expected] of Object.entries(EXPECTED)) {
      const button = byTestId(container, `combat-action-${id}`);
      // Visible label is just the verb — the .textContent text run, not the
      // icon/cost siblings.
      const svg = svgChild(button);
      const costEl = (button.children || []).find((c) => (c.className || '').split(/\s+/).includes('action-cost'));
      expect(button.textContent, `${id} visible label`).toBe(expected.visible);
      expect(button.getAttribute('aria-label'), `${id} accessible name`).toBe(expected.aria);
      if (expected.cost) {
        expect(costEl, `${id} has a cost chip`).toBeTruthy();
        expect(costEl.textContent).toBe(expected.cost);
      } else {
        expect(costEl, `${id} has no cost chip`).toBeFalsy();
      }
      expect(svg, `${id} keeps its icon`).toBeTruthy();
    }
  });

  it('an enabled action button carries no title attribute — title stays reserved for the disabled reason', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } });
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active,
      enemies: [makeEnemy()],
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    }));
    expect(byTestId(container, 'combat-action-attack').getAttribute('title')).toBe(null);
    expect(byTestId(container, 'combat-action-end-turn').getAttribute('title')).toBe(null);
  });
});

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

  // SESSION-03 (combat-and-ux-feedback-pass) — previewForTarget now emits the reason string
  // `no_line_of_sight` for wall-blocked attacks. The renderTargets path is unchanged: it keys
  // off preview.range?.reason generically via REASON_LABEL, whose 'no_line_of_sight' → 'no line
  // of sight' entry has been present since SESSION-02 landed the paired constant. This test
  // proves the console reads the new reason through the existing path — no source change to
  // src/ui/console/combat.js was necessary.
  it('an LOS-blocked target row renders disabled with the NO LINE OF SIGHT reason chip', () => {
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active: makeActive(),
      enemies: [makeEnemy({ id: 'walled' })],
      selection: { phase: 'choose-target', actionType: 'attack', targetId: null },
      previewFor: () => ({ distance: 2, range: { band: 'short', legal: false, reason: 'no_line_of_sight' }, coverBonus: 0, flanked: false, targetLegal: false })
    }));

    const row = byTestId(container, 'combat-target-walled');
    expect(row.disabled).toBe(true);
    expect(row.className).toContain('is-illegal');
    expect(row.textContent).toContain('NO LINE OF SIGHT');
    const icon = svgChild(row);
    expect(icon).toBeTruthy();
    expect(icon.className).toContain('icon-danger');
    // aria-label carries the human-readable REASON_LABEL entry (not the raw enum key).
    expect(icon.getAttribute('aria-label')).toBe('no line of sight');
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

// SESSION-01 (mobile-combat-pass) — the portrait COMBAT pane hands the readout
// to the pinned status strip (M59) and emits only the slim AP + conditions row.
// Wide keeps the full pane (the wide dock has no top strip). The primary-action
// class contract (`combat-action--primary` on move/attack/end-turn) is the
// public surface S04 styles into a thumb-reachable 2-col grid.
describe('console/combat.js — portrait readout de-dup (SESSION-01)', () => {
  function hasClass(node, className) {
    return (node.className || '').split(/\s+/).includes(className);
  }

  it('portrait render (no layout set) emits only the slim active-conditions row — no init-rail, no combat-active-panel', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 }, conditions: [{ id: 'jammed', duration: 2 }] });
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active,
      enemies: [makeEnemy()],
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    }));

    const slim = collectAll(container, (n) => hasClass(n, 'combat-active-conditions'));
    expect(slim).toHaveLength(1);
    expect(slim[0].dataset.testid).toBe('combat-active');
    // AP is retained (glance-ability next to the action buttons).
    expect(slim[0].textContent).toBe('');
    const apLine = (slim[0].children || []).find((c) => hasClass(c, 'combat-ap'));
    expect(apLine).toBeTruthy();
    expect(apLine.textContent).toContain('AP 2');
    // Conditions from the strip's blind spot render inside the slim row.
    const conditionTags = collectAll(slim[0], (n) => hasClass(n, 'condition-tag'));
    expect(conditionTags.length).toBeGreaterThan(0);
    // No duplicated initiative or full active panel in portrait.
    expect(collectAll(container, (n) => hasClass(n, 'init-rail'))).toHaveLength(0);
    expect(collectAll(container, (n) => hasClass(n, 'combat-active-panel'))).toHaveLength(0);
  });

  it('wide render keeps the full initiative rail + active summary panel', () => {
    const active = makeActive({ ap: 2 });
    const context = renderContext({
      active,
      enemies: [makeEnemy()],
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    });
    context.layout = 'wide';
    const container = new FakeElement('div');
    renderCombat(container, context);

    expect(collectAll(container, (n) => hasClass(n, 'init-rail'))).toHaveLength(1);
    expect(collectAll(container, (n) => hasClass(n, 'combat-active-panel'))).toHaveLength(1);
    // Portrait's slim row must NOT appear in wide.
    expect(collectAll(container, (n) => hasClass(n, 'combat-active-conditions'))).toHaveLength(0);
  });
});

describe('console/combat.js — feedback ownership (portrait-usability-regression-repair SESSION-01)', () => {
  function hasClass(node, className) {
    return (node.className || '').split(/\s+/).includes(className);
  }

  it('portrait render OMITS combat-notice and combat-error rows even when selection carries them', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } });
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active,
      enemies: [makeEnemy()],
      selection: {
        phase: 'choose-action', actionType: null, targetId: null,
        notice: 'TAP DESTINATION AGAIN TO CONFIRM.', error: 'OUT OF RANGE'
      },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    }));

    // Portrait: notice/error are the screen-owned rail's responsibility.
    expect(byTestId(container, 'combat-notice')).toBe(null);
    expect(byTestId(container, 'combat-error')).toBe(null);
  });

  it('wide render places combat-notice / combat-error at the TOP of the dock, before actions/targets', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } });
    const context = renderContext({
      active,
      enemies: [makeEnemy()],
      selection: {
        phase: 'choose-target', actionType: 'attack', targetId: null,
        notice: 'HOLD ON', error: 'BAD MOVE'
      },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    });
    context.layout = 'wide';
    const container = new FakeElement('div');
    renderCombat(container, context);

    const notice = byTestId(container, 'combat-notice');
    const error = byTestId(container, 'combat-error');
    expect(notice).not.toBe(null);
    expect(notice.textContent).toBe('HOLD ON');
    expect(error).not.toBe(null);
    expect(error.textContent).toBe('BAD MOVE');

    const actions = byTestId(container, 'combat-actions');
    const targets = byTestId(container, 'combat-targets');
    const indexOf = (needle) => container.children.indexOf(needle);
    expect(indexOf(notice)).toBeGreaterThanOrEqual(0);
    expect(indexOf(error)).toBeGreaterThanOrEqual(0);
    // Notice/error render before actions and target-list content — feedback stays glance-able.
    expect(indexOf(notice)).toBeLessThan(indexOf(actions));
    expect(indexOf(error)).toBeLessThan(indexOf(actions));
    expect(indexOf(notice)).toBeLessThan(indexOf(targets));
    expect(indexOf(error)).toBeLessThan(indexOf(targets));

    // A single instance of each testid — no duplicate feedback element in wide.
    const collectByTestId = (root, testid, matches = []) => {
      if (root.dataset?.testid === testid) matches.push(root);
      for (const child of root.children || []) collectByTestId(child, testid, matches);
      return matches;
    };
    expect(collectByTestId(container, 'combat-notice')).toHaveLength(1);
    expect(collectByTestId(container, 'combat-error')).toHaveLength(1);
  });

  it('portrait render emits zero combat-notice / combat-error nodes at all — no test-id duplicates for the screen-owned rail to fight', () => {
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active: makeActive({ ap: 2 }),
      enemies: [makeEnemy()],
      selection: { phase: 'confirm', actionType: 'attack', targetId: 'enemy', notice: 'X', error: 'Y' },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    }));
    const collectByTestId = (root, testid, matches = []) => {
      if (root.dataset?.testid === testid) matches.push(root);
      for (const child of root.children || []) collectByTestId(child, testid, matches);
      return matches;
    };
    expect(collectByTestId(container, 'combat-notice')).toHaveLength(0);
    expect(collectByTestId(container, 'combat-error')).toHaveLength(0);
  });
});

describe('console/combat.js — primary-action contract (SESSION-01)', () => {
  function hasClass(node, className) {
    return (node.className || '').split(/\s+/).includes(className);
  }

  it('move, attack, and end-turn buttons carry combat-action--primary; cast/overclock/item/retreat do not', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } });
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active,
      enemies: [makeEnemy()],
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    }));

    for (const id of ['move', 'attack', 'end-turn']) {
      const button = byTestId(container, `combat-action-${id}`);
      expect(hasClass(button, 'combat-action--primary'), `combat-action-${id} carries --primary`).toBe(true);
      // Existing classes preserved.
      expect(hasClass(button, 'combat-action')).toBe(true);
      expect(hasClass(button, 'action-btn')).toBe(true);
      expect(hasClass(button, 'console-row')).toBe(true);
    }
    for (const id of ['cast', 'overclock', 'item', 'retreat']) {
      const button = byTestId(container, `combat-action-${id}`);
      expect(hasClass(button, 'combat-action--primary'), `combat-action-${id} is NOT --primary`).toBe(false);
    }
    // Retreat still carries its danger modifier.
    expect(hasClass(byTestId(container, 'combat-action-retreat'), 'danger')).toBe(true);
  });

  it('DOM order emits primaries first (move, attack, end-turn) then non-primaries in ACTIONS order (cast, overclock, item, retreat)', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } });
    const container = new FakeElement('div');
    renderCombat(container, renderContext({
      active,
      enemies: [makeEnemy()],
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
    }));
    const list = byTestId(container, 'combat-actions');
    const testids = (list.children || []).map((c) => c.dataset.testid);
    expect(testids).toEqual([
      'combat-action-move',
      'combat-action-attack',
      'combat-action-end-turn',
      'combat-action-cast',
      'combat-action-overclock',
      'combat-action-item',
      'combat-action-retreat'
    ]);
  });
});

describe('console/combat.js — static density markers', () => {
  it('marks noninteractive readouts as static while preserving action control classes', () => {
    const active = makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } });
    const container = new FakeElement('div');
    renderCombat(container, {
      ...renderContext({
        active,
        enemies: [makeEnemy()],
        selection: { phase: 'choose-action', actionType: 'attack', targetId: null },
        previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
      }),
      layout: 'wide'
    });

    for (const testid of ['combat-active', 'initiative-rail']) {
      const node = byTestId(container, testid);
      expect(node, `${testid} exists`).toBeTruthy();
      expect(node.classList.contains('console-static-row')).toBe(true);
      expect(node.classList.contains('console-row')).toBe(false);
    }
    for (const id of ['move', 'attack', 'cast', 'overclock', 'item', 'retreat', 'end-turn']) {
      const button = byTestId(container, `combat-action-${id}`);
      expect(button.classList.contains('console-row')).toBe(true);
      expect(button.classList.contains('console-static-row')).toBe(false);
    }
  });
});

// SESSION-03 (direct-actions-and-quick-starts) — the generic combat-confirm row is gone. A
// disabled action's reason is now visible text inside the card (not title/aria-description
// only), and BACK is the only control that survives, rendered whenever an action is selected
// and nothing is resolving — not just the old single 'confirm' phase.
describe('console/combat.js — direct-action contract (SESSION-03 direct-actions-and-quick-starts)', () => {
  it('never renders a combat-confirm control, in any phase', () => {
    for (const selection of [
      { phase: 'choose-action', actionType: null, targetId: null },
      { phase: 'choose-target', actionType: 'attack', targetId: null },
      { phase: 'confirm', actionType: 'attack', targetId: 'enemy' }
    ]) {
      const container = new FakeElement('div');
      renderCombat(container, renderContext({
        active: makeActive({ ap: 2, weapon: { damageDie: 'd6', maxRange: 1 } }),
        enemies: [makeEnemy({ id: 'enemy' })],
        selection,
        previewFor: () => ({ distance: 1, range: { band: 'adjacent', legal: true, reason: 'in_range' }, coverBonus: 0, flanked: false, targetLegal: true })
      }));
      expect(byTestId(container, 'combat-confirm'), `phase ${selection.phase}`).toBe(null);
    }
  });

  it('a disabled action button carries a visible action-blocked-reason span derived from the real reason, in addition to title/aria-description', () => {
    const active = makeActive({ ap: 1, weapon: null });
    const context = {
      combatState: { combatants: new Map([[active.id, active]]), turnOrder: [active.id], currentTurn: 0 },
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['move', 'attack', 'cast', 'overclock', 'item', 'retreat', 'wait', 'end-turn'], legalMoveDirections: [] }),
      combatGetTargets: () => [],
      combatGetPreview: () => null,
      combatGetItems: () => [],
      protocolsData: { schools: {} }
    };
    const container = new FakeElement('div');
    renderCombat(container, context);
    const button = byTestId(container, 'combat-action-attack');
    expect(button.disabled).toBe(true);
    const reasonSpan = (button.children || []).find((c) => (c.className || '').split(/\s+/).includes('action-blocked-reason'));
    expect(reasonSpan, 'visible blocked-reason span').toBeTruthy();
    expect(reasonSpan.textContent).toBe('NO WEAPON EQUIPPED');
    // title/aria-description stay intact for pointer tooltip + assistive tech.
    expect(button.getAttribute('title')).toBe('No weapon equipped.');
    expect(button.getAttribute('aria-description')).toBe('No weapon equipped.');
  });

  it('an enabled action button carries no action-blocked-reason span', () => {
    const active = makeActive({ ap: 1 });
    const context = {
      combatState: { combatants: new Map([[active.id, active]]), turnOrder: [active.id], currentTurn: 0 },
      selection: { phase: 'choose-action', actionType: null, targetId: null },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['wait', 'end-turn'], legalMoveDirections: [] }),
      combatGetTargets: () => [],
      combatGetPreview: () => null
    };
    const container = new FakeElement('div');
    renderCombat(container, context);
    const button = byTestId(container, 'combat-action-end-turn');
    const reasonSpan = (button.children || []).find((c) => (c.className || '').split(/\s+/).includes('action-blocked-reason'));
    expect(reasonSpan).toBeFalsy();
  });

  it('BACK renders during choose-target, choose-protocol, and choose-item browsing — not only the old confirm phase', () => {
    const active = makeActive({ ap: 2, protocols: [{ school: 'disrupt', tier: 1 }] });
    for (const selection of [
      { phase: 'choose-target', actionType: 'attack', targetId: null },
      { phase: 'choose-protocol', actionType: 'cast', targetId: null },
      { phase: 'choose-item', actionType: 'item', targetId: null }
    ]) {
      const container = new FakeElement('div');
      renderCombat(container, {
        combatState: { combatants: new Map([[active.id, active]]), turnOrder: [active.id], currentTurn: 0 },
        selection,
        combatGetActiveActor: () => active,
        combatGetLegalActions: () => ({ actions: ['attack', 'cast', 'item'], legalMoveDirections: [] }),
        combatGetTargets: () => [],
        combatGetPreview: () => null,
        combatGetItems: () => [],
        protocolsData: { schools: { disrupt: { tiers: [{ name: 'Spark', chargeCost: 2 }] } } }
      });
      expect(byTestId(container, 'combat-back'), `phase ${selection.phase}`).toBeTruthy();
    }
  });

  it('BACK is absent while resolving — nothing to cancel mid-execution', () => {
    const active = makeActive({ ap: 2 });
    const container = new FakeElement('div');
    renderCombat(container, {
      combatState: { combatants: new Map([[active.id, active]]), turnOrder: [active.id], currentTurn: 0 },
      selection: { phase: 'confirm', actionType: 'attack', targetId: 'enemy', resolving: true },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['attack'], legalMoveDirections: [] }),
      combatGetTargets: () => [makeEnemy({ id: 'enemy' })],
      combatGetPreview: () => ({ distance: 1, range: { band: 'adjacent', legal: true }, coverBonus: 0, flanked: false, targetLegal: true })
    });
    expect(byTestId(container, 'combat-back')).toBe(null);
  });
});
