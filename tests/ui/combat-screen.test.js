import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { createRunState } from '../../src/state/run-state.js';
import { makeCharacter, makeWeapon } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

const gameData = {
  protocols: loadData('protocols'),
  conditions: loadData('conditions'),
  consumables: loadData('consumables'),
  classes: loadData('classes'),
  themes: loadData('themes'),
  enemies: loadData('enemies')
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
  replaceWith(child) {
    const parent = this.parentNode;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1, child);
    child.parentNode = parent;
    this.parentNode = null;
  }
  replaceChild(next, old) {
    const index = this.children.indexOf(old);
    if (index >= 0) {
      this.children.splice(index, 1, next);
      next.parentNode = this;
      old.parentNode = null;
    }
    return old;
  }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, repeat: false, preventDefault() { this.prevented = true; }, ...event }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.focused = true; }
}

class FakeCanvas extends FakeElement {
  constructor() {
    super('canvas');
    this.width = 384;
    this.height = 768;
    this.context = new FakeContext();
  }
  getContext() { return this.context; }
}

class FakeContext {
  constructor() { this.calls = []; }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); }
  strokeRect(...args) { this.calls.push(['strokeRect', this.strokeStyle, ...args]); }
  fillText(...args) { this.calls.push(['fillText', this.fillStyle, ...args]); }
}

function installDocument() {
  globalThis.document = {
    documentElement: new FakeElement('html'),
    createElement: (tagName) => tagName === 'canvas' ? new FakeCanvas() : new FakeElement(tagName),
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

function keyEvent(code) {
  return { code, key: code, repeat: false, preventDefault() { this.prevented = true; } };
}

function openWindow() {
  return { originX: 0, originY: 0, width: 8, height: 16, cells: Array.from({ length: 16 }, () => Array(8).fill(1)) };
}

function floor() {
  return { cells: Array.from({ length: 32 }, () => Array(20).fill(1)), themeId: 'cold_storage', floorSubSeed: 0, entryPoint: { x: 1, y: 1 }, descentPoint: { x: 19, y: 31 }, enemySpawns: [], containers: [] };
}

function partyActor(overrides = {}) {
  return {
    id: 'hero',
    side: 'party',
    classId: 'breacher',
    attributes: { mgt: 8, fin: 6, vit: 6, res: 5, foc: 5, sig: 5 },
    hp: 30,
    hpMax: 30,
    charge: 10,
    chargeMax: 10,
    protocols: [],
    protocolDeck: [],
    weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }),
    defense: 12,
    protocolDefense: 10,
    position: { x: 1, y: 1 },
    sigilCodepoint: 0xE000,
    conditions: [],
    ap: 2,
    moveAvailable: true,
    swapAvailable: true,
    ...overrides
  };
}

function enemyActor(overrides = {}) {
  return {
    id: 0,
    side: 'enemy',
    archetypeId: 'drone',
    name: 'Drone',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    hp: 10,
    hpMax: 10,
    charge: 0,
    chargeMax: 0,
    weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }),
    defense: 8,
    protocolDefense: 10,
    position: { x: 2, y: 1 },
    sigilCodepoint: 0xE030,
    behavior: 'aggressive',
    conditions: [],
    ap: 2,
    moveAvailable: true,
    swapAvailable: true,
    ...overrides
  };
}

function combatState(actors, turnOrder = actors.map((actor) => actor.id)) {
  return {
    id: 'encounter_test',
    kind: 'standard',
    window: openWindow(),
    round: 1,
    currentTurn: 0,
    turnOrder,
    combatants: new Map(actors.map((actor) => [actor.id, actor])),
    log: [],
    ended: false,
    result: null,
    turnStarted: true,
    forfeitableLoot: ['cache-drop']
  };
}

function runState(seed = 1234, members = [makeCharacter({ id: 'hero', hp: 30, hpMax: 30, charge: 10, chargeMax: 10 })], inventory = []) {
  return createRunState(seed, members, { partyPosition: { x: 1, y: 1 }, inventory });
}

async function mountCombat({ state = runState(), combat = combatState([partyActor(), enemyActor()]), encounterActors = null } = {}) {
  const container = new FakeElement('div');
  const { mount } = await import('../../src/ui/screens/combat.js');
  const encounter = { id: combat.id, kind: 'standard', window: combat.window, actors: encounterActors || [...combat.combatants.values()], forfeitableLoot: combat.forfeitableLoot };
  const controller = mount(container, { runState: state, floor: floor(), combatState: combat, encounter, data: gameData });
  return { container, controller, runState: state, combatState: combat };
}

beforeEach(installDocument);
afterEach(() => { delete globalThis.document; });

describe('combat screen controller', () => {
  it('requires target selection and explicit confirmation before resolving an attack', async () => {
    const combat = combatState([partyActor(), enemyActor({ hp: 10, hpMax: 10 })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    byTestId(container, 'combat-target-0').click();

    expect(combat.combatants.get(0).hp).toBe(10);
    expect(byTestId(container, 'combat-confirm').disabled).toBe(false);
    byTestId(container, 'combat-confirm').click();

    expect(combat.log.some((entry) => entry.type === 'attack')).toBe(true);
    expect(combat.combatants.get('hero').ap).toBe(1);
  });

  it('cycles targets from the keyboard and confirms the selected target with Enter', async () => {
    const combat = combatState([partyActor(), enemyActor({ id: 0, hp: 10 }), enemyActor({ id: 1, hp: 10, position: { x: 2, y: 2 } })], ['hero', 0, 1]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    container.dispatch('keydown', keyEvent('Tab'));

    expect(byTestId(container, 'combat-target-1').getAttribute('aria-selected')).toBe('true');
    container.dispatch('keydown', keyEvent('Enter'));

    expect(combat.log.find((entry) => entry.type === 'attack').targetId).toBe(1);
  });

  it('moves one cell through COMBAT mode without spending AP and rejects another move that turn', async () => {
    const combat = combatState([partyActor(), enemyActor({ position: { x: 4, y: 4 } })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-move').click();
    byTestId(container, 'combat-dir-s').click();
    byTestId(container, 'combat-confirm').click();

    const hero = combat.combatants.get('hero');
    expect(hero.position).toEqual({ x: 1, y: 2 });
    expect(hero.ap).toBe(2);
    expect(hero.moveAvailable).toBe(false);
    expect(byTestId(container, 'combat-action-move').disabled).toBe(true);
  });

  it('dispatches victory completion, marks defeated enemies, and clears active combat', async () => {
    const events = [];
    const off = bus.on('state:combat-end', (payload) => events.push(payload));
    const state = runState();
    const combat = combatState([partyActor(), enemyActor({ hp: 1, hpMax: 1 })]);
    const { container } = await mountCombat({ state, combat });

    byTestId(container, 'combat-action-attack').click();
    byTestId(container, 'combat-target-0').click();
    byTestId(container, 'combat-confirm').click();

    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('victory');
    expect(events[0].completion).toMatchObject({ resolved: true, outcome: 'victory', loot: ['cache-drop'] });
    expect(state.activeCombat).toBe(null);
    expect(state.defeatedEnemies & 1n).toBe(1n);
    off();
  });

  it('routes a successful retreat back through combat-end with forfeited loot', async () => {
    const events = [];
    const off = bus.on('state:combat-end', (payload) => events.push(payload));
    const state = runState(4);
    const combat = combatState([partyActor(), enemyActor()]);
    const { container } = await mountCombat({ state, combat });

    byTestId(container, 'combat-action-retreat').click();
    byTestId(container, 'combat-confirm').click();

    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('retreat');
    expect(events[0].completion).toMatchObject({ outcome: 'retreat', loot: [], forfeitedLoot: ['cache-drop'] });
    off();
  });

  it('runs deterministic enemy turns and emits single-death Echo handoff when survivors remain', async () => {
    const deaths = [];
    const off = bus.on('state:character-death', (payload) => deaths.push(payload));
    const state = runState(1, [
      makeCharacter({ id: 'hero', hp: 1, hpMax: 30 }),
      makeCharacter({ id: 'ally', hp: 20, hpMax: 20, sigilCodepoint: 0xE001 })
    ]);
    const combat = combatState([
      partyActor({ id: 'hero', hp: 1, hpMax: 30, position: { x: 1, y: 1 } }),
      enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) }),
      partyActor({ id: 'ally', hp: 20, hpMax: 20, position: { x: 5, y: 5 }, sigilCodepoint: 0xE001 })
    ], ['hero', 0, 'ally']);
    const { container } = await mountCombat({ state, combat });

    byTestId(container, 'combat-action-end-turn').click();
    byTestId(container, 'combat-confirm').click();

    expect(deaths).toHaveLength(1);
    expect(deaths[0].character.id).toBe('hero');
    expect(state.party.map((member) => member.id)).toEqual(['ally']);
    off();
  });

  it('routes party wipe to scorecard intent and removes input on unmount', async () => {
    const wipes = [];
    const off = bus.on('state:party-wipe', (payload) => wipes.push(payload));
    const state = runState(1, [makeCharacter({ id: 'hero', hp: 1, hpMax: 30 })]);
    const combat = combatState([
      partyActor({ id: 'hero', hp: 1, hpMax: 30, position: { x: 1, y: 1 } }),
      enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) })
    ], ['hero', 0]);
    const { container, controller } = await mountCombat({ state, combat });

    byTestId(container, 'combat-action-end-turn').click();
    byTestId(container, 'combat-confirm').click();
    expect(wipes).toHaveLength(1);

    controller.unmount();
    container.dispatch('keydown', keyEvent('ArrowRight'));
    expect(wipes).toHaveLength(1);
    off();
  });
});
