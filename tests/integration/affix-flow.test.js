import { describe, it, expect } from 'vitest';
import { initiateCombat, executeAction } from '../../src/rules/combat.js';
import { resolveLoadout, getAffixHooks, useAffixReroll } from '../../src/rules/equipment.js';
import { createRunState } from '../../src/state/run-state.js';
import { describeEntryDetail, mount } from '../../src/ui/screens/combat.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

// Full loop, affix-flow SESSION-04 checkpoint 3: affixed gear → attack → proc/leech/reroll →
// ledger claim → the same item unavailable in the next combat on that floor. SESSION-01 wired
// the rules-layer mechanics (procs, leech, Lucky reroll); this session wires actor construction
// (defense/effectiveAttributes/luckyReroll) and log rendering. This test drives the seam between
// them with real resolved gear, not hand-authored `weapon.effects` shortcuts.

const equipmentData = loadData('equipment');
const affixesData = loadData('affixes');
const conditionsData = loadData('conditions');
const protocolsData = loadData('protocols');
const consumablesData = loadData('consumables');
const classesData = loadData('classes');
const baseContext = { protocolsData, conditionsData, consumablesData, runState: {} };

// Object-form gear exactly as produced by materializeItem → normalizeItem — the catalog owns
// damageDie/rangeBand/defenseBonus; only the affix list lives on the instance.
function corrosiveVampiricWeapon() {
  return { id: 'op_weapon_1', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: ['corrosive', 'vampiric'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
}
function luckyArmor() {
  return { id: 'op_armor_1', category: 'armor', baseType: 'light', rarity: 'stock', affixes: ['lucky'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
}

function makeEnemy(overrides = {}) {
  return {
    id: 'enemy_1', attributes: { mgt: 5, fin: 5, vit: 1, res: 5, foc: 5, sig: 5 },
    hp: 20, hpMax: 20, defense: 15, behavior: 'aggressive', retreats: false,
    side: 'enemy', conditions: [], position: { x: 1, y: 0 }, ...overrides
  };
}

// Deterministic cursor: pops `combat` values off a queue in order (mirrors
// tests/rules/combat-affixes.test.js); any read past the queue returns 0.
function fixedCursor(combatValues) {
  const queue = [...combatValues];
  return {
    next: () => 0,
    nextInt: (stream, _max) => (stream === 'combat' && queue.length > 0 ? queue.shift() : 0),
    getCursor: () => 0,
    syncTo: () => {},
    getState: () => ({})
  };
}

describe('affix flow — affixed gear through attack, log rendering, and the floor-reroll ledger', () => {
  it('procs corrosive, leeches from vampiric, auto-rerolls a missed attack via Lucky, and renders every fragment', () => {
    const weaponItem = corrosiveVampiricWeapon();
    const armorItem = luckyArmor();
    const equipped = resolveLoadout({ equipment: { weapon: weaponItem, armor: armorItem, offhand: null } }, equipmentData, affixesData);

    const hero = makeCharacter({
      id: 'hero', hp: 20, hpMax: 30, position: { x: 0, y: 0 },
      attributes: { mgt: 7, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
      weapon: equipped.weapon, armor: equipped.armor,
      luckyReroll: { available: true, itemId: armorItem.id }
    });
    const enemy = makeEnemy();

    // queue: init hero, init enemy, atk#1 (miss), atk#2/Lucky reroll (hit), damage die, VIT save (fails).
    const cursor = fixedCursor([0, 0, 4, 16, 2, 0]);
    const state = initiateCombat([hero], [enemy], cursor);
    state.currentTurn = state.turnOrder.indexOf('hero');

    const result = executeAction(state, { type: 'attack', actorId: 'hero', targetId: 'enemy_1' }, cursor, baseContext);
    expect(result.success).toBe(true);

    const atkLog = state.log.find((entry) => entry.type === 'attack');
    expect(atkLog.hit).toBe(true);

    // Lucky: the first (missed) roll auto-rerolled and kept the second (hit) roll.
    expect(atkLog.luckyReroll).toEqual({ itemId: armorItem.id, firstNatural: 5, keptNatural: 17 });
    expect(state.combatants.get('hero').luckyRerollUsed).toBe(true);

    // Vampiric: healed the attacker on the landed hit.
    expect(atkLog.leech).toBe(1);
    expect(state.combatants.get('hero').hp).toBe(21);

    // Corrosive: procs on hit, VIT save fails against a vit-1 target, condition applies.
    expect(atkLog.procs).toEqual([
      { conditionId: 'corroded', trigger: 'hit', save: { natural: 1, modifier: -4, total: -3, dc: 12, attribute: 'vit', success: false }, applied: true, shielded: false }
    ]);
    expect(state.combatants.get('enemy_1').conditions.some((c) => (c.conditionId ?? c.id) === 'corroded')).toBe(true);

    // Rendering: every affix fragment lands on the same detail line, in house voice.
    const detail = describeEntryDetail(atkLog);
    expect(detail).toContain('LUCKY 5→17');
    expect(detail).toContain('LEECH +1');
    expect(detail).toContain('▸ CORRODED applied');
  });

  it('claims the used Lucky charge onto the floor ledger, making the same item unavailable in the next combat that floor', () => {
    const weaponItem = corrosiveVampiricWeapon();
    const armorItem = luckyArmor();

    // A run whose party carries the SAME equipped items the combat above used — the claim looks
    // the item up by id across the party's live equipment, exactly like the rules layer does.
    const runState = createRunState(9001, [
      makeCharacter({ id: 'hero', hp: 21, hpMax: 30, equipment: { weapon: weaponItem, armor: armorItem, offhand: null } })
    ]);
    expect(runState.affixFloorLedger.reroll).toEqual([]);

    const claim = useAffixReroll(runState, armorItem.id, affixesData);
    expect(claim.success).toBe(true);
    expect(claim.runState.affixFloorLedger.reroll).toEqual([armorItem.id]);

    // Still a real reroll-carrying item — only the floor ledger gates availability.
    expect(getAffixHooks(armorItem.affixes, affixesData).reroll.perFloor).toBeGreaterThan(0);

    // A second combat mounted on the claimed runState must not offer the same charge again.
    const container = new FakeElement('div');
    globalThis.document = fakeDocument();
    const combatants = new Map([
      ['hero', { id: 'hero', side: 'party', classId: 'operator', hp: 21, hpMax: 30, charge: 5, chargeMax: 10, attributes: { mgt: 7, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 }, equipment: { weapon: weaponItem, armor: armorItem, offhand: null }, position: { x: 0, y: 0 }, sigilCodepoint: 0xE000, conditions: [], ap: 2, moveAvailable: true, swapAvailable: true }],
      ['enemy_1', makeEnemy()]
    ]);
    const combatState = { id: 'second-floor-combat', kind: 'standard', window: openWindow(), round: 1, currentTurn: 0, turnOrder: ['hero', 'enemy_1'], combatants, log: [], ended: false, result: null, turnStarted: true, forfeitableLoot: [] };
    const encounter = { id: 'second-floor-combat', kind: 'standard', window: combatState.window, actors: [...combatants.values()], forfeitableLoot: [] };
    const floor = { cells: Array.from({ length: 32 }, () => Array(20).fill(1)), themeId: 'cold_storage', floorSubSeed: 0, entryPoint: { x: 1, y: 1 }, descentPoint: { x: 19, y: 31 }, enemySpawns: [], containers: [] };
    const controller = mount(container, { runState: claim.runState, floor, combatState, encounter, data: { protocols: protocolsData, conditions: conditionsData, consumables: consumablesData, classes: classesData, equipment: equipmentData, affixes: affixesData } });
    expect(combatState.combatants.get('hero').luckyReroll).toBeNull();
    controller.unmount();
    delete globalThis.document;
    delete globalThis.window;
  });
});

// --- minimal DOM shim (trimmed from tests/ui/combat-screen.test.js) — just enough for
// src/ui/screens/combat.js's mount() to construct actors and render without a real browser.
class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  toggle() { return false; }
  contains(name) { return this.values.has(name); }
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
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.parentNode = null;
  }
  set className(value) { this._className = String(value); }
  get className() { return this._className || ''; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  prepend(...children) { for (const child of children.reverse()) { child.parentNode = this; this.children.unshift(child); } }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; return child; }
  replaceChildren(...children) { this.children = []; for (const child of children) this.appendChild(child); }
  remove() { this.parentNode?.removeChild?.(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener() {}
  click() {}
}
class FakeCanvas extends FakeElement {
  constructor() {
    super('canvas');
    this.width = 384; this.height = 768;
    this.context = new FakeContext();
    this._rect = { left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height };
  }
  getContext() { return this.context; }
  getBoundingClientRect() { return this._rect; }
}
class FakeContext {
  beginPath() {} arc() {} fill() {} stroke() {} clearRect() {} fillRect() {} strokeRect() {} fillText() {}
}
function fakeDocument() {
  return {
    documentElement: new FakeElement('html'),
    createElement: (tagName) => tagName === 'canvas' ? new FakeCanvas() : new FakeElement(tagName),
    createElementNS: (namespace, tagName) => new FakeElement(tagName),
    createTextNode: (value) => { const node = new FakeElement('#text'); node.textContent = value; return node; }
  };
}
function openWindow() {
  return { originX: 0, originY: 0, width: 8, height: 16, cells: Array.from({ length: 16 }, () => Array(8).fill(1)) };
}
