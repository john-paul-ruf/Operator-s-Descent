import { beforeEach, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderCombat } from '../../src/ui/console/combat.js';
import { render as renderTech } from '../../src/ui/console/tech.js';
import { render as renderLoot } from '../../src/ui/console/loot.js';
import { render as renderLog } from '../../src/ui/console/log.js';
import { loadData } from '../helpers/data.js';

const data = {
  classes: loadData('classes'),
  protocols: loadData('protocols'),
  conditions: loadData('conditions'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes'),
  consumables: loadData('consumables'),
  symbolTable: loadData('symbol-table')
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
    this.value = '';
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
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, preventDefault() { this.prevented = true; }, ...event }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}

function installDocument() {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (value) => { const node = new FakeElement('#text'); node.textContent = value; return node; }
  };
  Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'https://example.test', pathname: '/play/', search: '?a=1', href: 'https://example.test/play/?a=1#old' } }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
    if (found) return found;
  }
  return null;
}

function collectByTestIdPrefix(root, prefix, matches = []) {
  if (root.dataset?.testid?.startsWith(prefix)) matches.push(root);
  for (const child of root.children || []) collectByTestIdPrefix(child, prefix, matches);
  return matches;
}

function textOf(root) {
  if (!root) return '';
  return [root.textContent, root.value, ...(root.children || []).flatMap((child) => textOf(child))].filter(Boolean).join(' ');
}

function item(id, baseType = 'sidearm', overrides = {}) {
  return { id, category: 'weapon', baseType, rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 5, junkTagged: false, ...overrides };
}

function consumable(id, count = 1, overrides = {}) {
  return { id, category: 'consumable', baseType: 'repair_patch', count, rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 2, junkTagged: false, ...overrides };
}

function character(overrides = {}) {
  return {
    id: 'operator',
    classId: 'operator',
    sigilId: 'pua-e028',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 6, foc: 5, sig: 4 },
    currentHP: 30,
    currentCHARGE: 10,
    calibrationCount: 0,
    calibrationChoices: [],
    signatureTier: 1,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [{ school: 'disrupt', tier: 1 }],
    conditions: [],
    ...overrides
  };
}

function run(inventory = [], members = [character()], options = {}) {
  return createRunState(123, members, { creationTimestamp: 1, inventory, scrapCounter: 0, corruption: 0.1, ...options });
}

function cursor(values = []) {
  return {
    calls: 0,
    nextInt(stream, max) {
      this.calls += 1;
      const value = values.length ? values.shift() : max - 1;
      return Math.max(0, Math.min(max - 1, value));
    },
    getState() { return null; }
  };
}

function renderTechWith(runState, extra = {}) {
  const container = new FakeElement('div');
  const context = { runState, data, refresh: () => renderTech(container, context), ...extra };
  renderTech(container, context);
  return { container, context };
}

function renderLootWith(runState, lootState, extra = {}) {
  const container = new FakeElement('div');
  const context = { runState, data, lootState, floor: { id: 'floor-1', themeId: 'printer_meat' }, refresh: () => renderLoot(container, context), ...extra };
  renderLoot(container, context);
  return { container, context };
}

beforeEach(installDocument);

describe('TECH mode', () => {
  it('casts prepared protocols through explicit target confirmation and rules resolution', () => {
    const runState = run();
    const actor = { id: 'operator', side: 'party', ap: 2, charge: 10, chargeMax: 10, hp: 30, hpMax: 30, attributes: runState.party[0].attributes, protocols: runState.party[0].protocolDeck, conditions: [], position: { x: 0, y: 0 } };
    const enemy = { id: 'enemy', side: 'enemy', hp: 10, hpMax: 10, protocolDefense: 5, attributes: { foc: 5 }, conditions: [], position: { x: 2, y: 0 } };
    const combatState = { turnOrder: ['operator'], currentTurn: 0, combatants: new Map([['operator', actor], ['enemy', enemy]]) };
    const logs = [];
    const { container } = renderTechWith(runState, { combatState, rngCursor: cursor([19]), bus: { dispatch: (type, payload) => logs.push([type, payload]) } });

    expect(byTestId(container, 'tech-charge-panel').className).toContain('panel-elevated');
    expect(byTestId(container, 'tech-slot-panel').className).toContain('panel');
    expect(textOf(byTestId(container, 'tech-deck-heading'))).toBe('◈ EQUIPPED PROTOCOLS');
    expect(textOf(byTestId(container, 'tech-slots'))).toContain('1/5');
    expect(textOf(byTestId(container, 'tech-detail-disrupt-1'))).toContain('Deal 1d6');
    byTestId(container, 'tech-cast-disrupt-1').click();
    byTestId(container, 'tech-target-enemy').click();
    byTestId(container, 'tech-confirm').click();

    expect(actor.ap).toBe(1);
    expect(actor.charge).toBe(8);
    expect(runState.party[0].currentCHARGE).toBe(8);
    expect(enemy.hp).toBe(3);
    expect(logs.some(([type]) => type === 'ui:log-entry')).toBe(true);
  });

  it('previews overclock risk without consuming RNG, then records failed corruption once', () => {
    const runState = run();
    const actor = { id: 'operator', side: 'party', ap: 2, charge: 10, chargeMax: 10, hp: 30, hpMax: 30, attributes: runState.party[0].attributes, protocols: runState.party[0].protocolDeck, conditions: [], position: { x: 0, y: 0 } };
    const enemy = { id: 'enemy', side: 'enemy', hp: 10, hpMax: 10, protocolDefense: 5, attributes: { foc: 5 }, conditions: [], position: { x: 2, y: 0 } };
    const rngCursor = cursor([0, 19]);
    const combatState = { turnOrder: ['operator'], currentTurn: 0, combatants: new Map([['operator', actor], ['enemy', enemy]]) };
    const { container } = renderTechWith(runState, { combatState, rngCursor });

    byTestId(container, 'tech-overclock-disrupt-1').click();
    expect(rngCursor.calls).toBe(0);
    byTestId(container, 'tech-target-enemy').click();
    expect(textOf(byTestId(container, 'tech-preview'))).toContain('cost 4 CHARGE');
    expect(textOf(byTestId(container, 'tech-preview'))).toContain('vs 13');
    expect(textOf(byTestId(container, 'tech-preview'))).toContain('+0.05');
    expect(rngCursor.calls).toBe(0);
    byTestId(container, 'tech-confirm').click();

    expect(rngCursor.calls).toBe(2);
    expect(actor.charge).toBe(6);
    expect(runState.corruption).toBeCloseTo(0.15);
    expect(textOf(byTestId(container, 'tech-result'))).toContain('overclock failed');
  });
});

describe('LOOT mode', () => {
  it('warns at the hard inventory cap and leaves blocked pickups in the container', () => {
    const runState = run([consumable('patches', 100)]);
    const lootState = { container: { id: 0, x: 1, y: 1 }, items: [item('loot-sidearm')] };
    const { container, context } = renderLootWith(runState, lootState);

    expect(byTestId(container, 'loot-container').className).toContain('panel-elevated');
    expect(textOf(byTestId(container, 'loot-contents-heading'))).toBe('◈ CONTENTS');
    expect(textOf(byTestId(container, 'loot-inventory-heading'))).toBe('◈ INVENTORY');
    expect(byTestId(container, 'loot-item-loot-sidearm').className).toContain('item-card');
    expect(byTestId(container, 'loot-cap-warning')).toBeTruthy();
    expect(byTestId(container, 'loot-take-loot-sidearm').disabled).toBe(true);
    byTestId(container, 'loot-take-loot-sidearm').click();
    expect(context.lootState.items.map((entry) => entry.id)).toEqual(['loot-sidearm']);
    expect(runState.inventory).toHaveLength(1);
  });

  it('applies container-icon-lg to the container header glyph in wide layout only', () => {
    const runState = run([]);
    const lootState = { container: { id: 1, x: 1, y: 1 }, items: [item('loot-sidearm')] };
    const { container } = renderLootWith(runState, lootState, { layout: 'wide' });
    const header = byTestId(container, 'loot-container');
    const glyph = header.children[0];
    expect(glyph.className.split(/\s+/)).toContain('container-icon');
    expect(glyph.className.split(/\s+/)).toContain('container-icon-lg');

    const portrait = renderLootWith(runState, lootState);
    const portraitGlyph = byTestId(portrait.container, 'loot-container').children[0];
    expect(portraitGlyph.className.split(/\s+/)).toContain('container-icon');
    expect(portraitGlyph.className.split(/\s+/)).not.toContain('container-icon-lg');
  });

  it('takes items, opens only exhausted containers, and salvages tagged inventory', () => {
    const runState = run([]);
    const lootState = { container: { id: 1, x: 1, y: 1 }, items: [item('loot-sidearm', 'sidearm', { salvageValue: 5 })] };
    const { container } = renderLootWith(runState, lootState);

    byTestId(container, 'loot-take-loot-sidearm').click();
    expect(runState.inventory.map((entry) => entry.id)).toEqual(['loot-sidearm']);
    expect((runState.openedContainers & (1n << 1n)) !== 0n).toBe(true);

    byTestId(container, 'loot-junk-loot-sidearm').click();
    expect(runState.inventory[0].junkTagged).toBe(true);
    byTestId(container, 'loot-junk-all').click();
    expect(textOf(byTestId(container, 'loot-notice'))).toContain('Confirm permanent junking');
    byTestId(container, 'loot-junk-all').click();

    expect(runState.inventory).toEqual([]);
    expect(runState.scrapCounter).toBe(5);
  });

  it('renders resolved names and descriptions on loot cards', () => {
    const runState = run([]);
    const tuned = item('loot-sidearm', 'sidearm', { rarity: 'tuned', affixes: ['precise'], salvageValue: 1 });
    const lootState = { container: { id: 2, x: 1, y: 1 }, items: [tuned] };
    const { container } = renderLootWith(runState, lootState);

    const row = byTestId(container, 'loot-item-loot-sidearm');
    expect(textOf(row)).toContain('Sidearm');
    expect(textOf(row)).not.toContain('baseType');
    const detail = byTestId(container, 'loot-detail-loot-sidearm');
    expect(textOf(detail)).toContain('d6 dmg');
    expect(textOf(detail)).toContain('adjacent range');
    expect(textOf(detail)).toContain('Precise: +1 accuracy bonus');
    expect(textOf(detail)).toContain('scrap 1');
  });
});

describe('COMBAT mode', () => {
  it('groups mock-compatible actions and shows selected target range and cover', () => {
    const active = { id: 'operator', name: 'Operator', side: 'party', sigilCodepoint: 0xE028, hp: 30, hpMax: 30, charge: 8, chargeMax: 10, ap: 2, moveAvailable: true, conditions: [] };
    const enemy = { id: 'enemy', name: 'Drone', side: 'enemy', hp: 10, hpMax: 10 };
    const container = new FakeElement('div');
    renderCombat(container, {
      combatState: { combatants: new Map([['operator', active], ['enemy', enemy]]), turnOrder: ['operator', 'enemy'], currentTurn: 0 },
      selection: { phase: 'choose-target', actionType: 'attack', targetId: 'enemy' },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['move', 'attack', 'retreat'], legalMoveDirections: ['s'] }),
      combatGetTargets: () => [enemy],
      combatGetPreview: () => ({ distance: 3, range: { band: 'short', legal: true }, coverBonus: 2, flanked: false })
    });

    expect(byTestId(container, 'combat-action-attack').className).toContain('action-btn');
    expect(textOf(byTestId(container, 'combat-selected-preview'))).toContain('range short 3 · cover +2');
  });

  it('never lets the combat-target- prefix match the non-interactive selected-target preview', () => {
    const active = { id: 'operator', name: 'Operator', side: 'party', sigilCodepoint: 0xE028, hp: 30, hpMax: 30, charge: 8, chargeMax: 10, ap: 2, moveAvailable: true, conditions: [] };
    const enemyA = { id: 'enemy-a', name: 'Drone A', side: 'enemy', hp: 10, hpMax: 10 };
    const enemyB = { id: 'enemy-b', name: 'Drone B', side: 'enemy', hp: 12, hpMax: 12 };
    const container = new FakeElement('div');
    const selectedIds = [];
    renderCombat(container, {
      combatState: { combatants: new Map([['operator', active], ['enemy-a', enemyA], ['enemy-b', enemyB]]), turnOrder: ['operator', 'enemy-a', 'enemy-b'], currentTurn: 0 },
      selection: { phase: 'choose-target', actionType: 'attack', targetId: 'enemy-a' },
      combatGetActiveActor: () => active,
      combatGetLegalActions: () => ({ actions: ['move', 'attack', 'retreat'], legalMoveDirections: ['s'] }),
      combatGetTargets: () => [enemyA, enemyB],
      combatGetPreview: () => ({ distance: 3, range: { band: 'short', legal: true }, coverBonus: 2, flanked: false }),
      combatSelectTarget: (id) => selectedIds.push(id)
    });

    const preview = byTestId(container, 'combat-selected-preview');
    expect(preview.dataset.testid.startsWith('combat-target-')).toBe(false);

    const prefixMatches = collectByTestIdPrefix(container, 'combat-target-');
    expect(prefixMatches.length).toBe(2);
    for (const match of prefixMatches) expect(match.tagName).toBe('BUTTON');

    prefixMatches[0].click();
    expect(selectedIds).toEqual(['enemy-a']);
  });
});

describe('LOG mode', () => {
  it('renders ordered entries and copies the live full-state #r link', async () => {
    const runState = run([]);
    const copied = [];
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (value) => copied.push(value) } }, configurable: true });
    const container = new FakeElement('div');

    renderLog(container, { runState, data, logEntries: [{ sequence: 2, type: 'damage', message: 'HP -4' }, { sequence: 1, type: 'discovery', message: 'CONTAINER FOUND' }] });
    expect(textOf(byTestId(container, 'log-entry-0'))).toContain('[E:001] DISCOVERY');
    expect(byTestId(container, 'log-share').className).toContain('panel-elevated');
    expect(textOf(byTestId(container, 'log-area'))).toContain('DAMAGE');
    byTestId(container, 'log-copy-link').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copied[0]).toContain('https://example.test/play/?a=1#r=');
    expect(copied[0].split('#r=')[1].length).toBeLessThan(1500);
    expect(textOf(byTestId(container, 'log-notice'))).toContain('LINK COPIED');
  });

  it('does not expose a full-state link after wipe', () => {
    const runState = run([], [character({ currentHP: 0 })]);
    const container = new FakeElement('div');

    renderLog(container, { runState, data, runWiped: true });

    expect(byTestId(container, 'log-copy-link').disabled).toBe(true);
    expect(byTestId(container, 'log-link-text')).toBe(null);
  });

  it('wide layout renders log-history-header, share-panel, and share-input', async () => {
    const runState = run([]);
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
    const container = new FakeElement('div');

    renderLog(container, { runState, data, layout: 'wide', logEntries: [{ sequence: 1, type: 'info', message: 'boot' }] });

    const heading = container.children[0];
    expect(heading.className).toContain('log-history-header');
    expect(heading.className.split(/\s+/)).not.toContain('mode-indicator');
    const share = byTestId(container, 'log-share');
    expect(share.className.split(/\s+/)).toContain('share-panel');

    byTestId(container, 'log-copy-link').click();
    await Promise.resolve();
    await Promise.resolve();
    const link = byTestId(container, 'log-link-text');
    expect(link).not.toBe(null);
    expect(link.className.split(/\s+/)).toContain('share-input');
  });
});
