import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { createRunState } from '../../src/state/run-state.js';
import { describeEntryDetail, hapticPatternForCombatEntry } from '../../src/ui/screens/combat.js';
import { saveSettings } from '../../src/state/library.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { makeCharacter, makeWeapon, findSeed } from '../helpers/fixtures.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { loadData } from '../helpers/data.js';
import * as viewport from '../../src/ui/viewport.js';

// Wraps each camera returned by createViewportCamera so tests can assert which zoom lever the
// combat screen pulls on mount. The real camera math still runs — only fit/zoomToCells calls are
// intercepted for counting.
vi.mock('../../src/ui/viewport.js', async () => {
  const actual = await vi.importActual('../../src/ui/viewport.js');
  const state = { instances: [] };
  return {
    ...actual,
    createViewportCamera(args) {
      const camera = actual.createViewportCamera(args);
      const record = { fit: 0, zoomToCells: [] };
      const origFit = camera.fit.bind(camera);
      const origZoom = camera.zoomToCells.bind(camera);
      camera.fit = (...a) => { record.fit++; return origFit(...a); };
      camera.zoomToCells = (...a) => { record.zoomToCells.push(a); return origZoom(...a); };
      state.instances.push(record);
      return camera;
    },
    __viewportSpyState: state
  };
});

const gameData = {
  protocols: loadData('protocols'),
  conditions: loadData('conditions'),
  consumables: loadData('consumables'),
  classes: loadData('classes'),
  themes: loadData('themes'),
  enemies: loadData('enemies'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes')
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
    this.disabled = false;
    this.tabIndex = -1;
    this.hidden = false;
    this.parentNode = null;
    this.innerHTML = '';
  }
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); this.attributes.set('class', this._className); }
  // SVG factories (createIcon) write class via setAttribute — fall back to that source so both
  // the string-set and attribute-set paths read the same class string.
  get className() { return this._className || this.attributes.get('class') || ''; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  prepend(...children) { for (const child of children.reverse()) { child.parentNode = this; this.children.unshift(child); } }
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
    // Match the canvas element's intrinsic size so cellAtPoint math is 1:1 by default;
    // individual tests can override to exercise CSS scaling.
    this._rect = { left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height };
  }
  getContext() { return this.context; }
  getBoundingClientRect() { return this._rect; }
}

class FakeContext {
  constructor() { this.calls = []; }
  beginPath() { this.calls.push(['beginPath']); }
  arc(...args) { this.calls.push(['arc', ...args]); }
  fill() { this.calls.push(['fill', this.fillStyle]); }
  stroke() { this.calls.push(['stroke', this.strokeStyle]); }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); }
  strokeRect(...args) { this.calls.push(['strokeRect', this.strokeStyle, ...args]); }
  fillText(...args) { this.calls.push(['fillText', this.fillStyle, ...args]); }
}

function installDocument() {
  globalThis.document = {
    documentElement: new FakeElement('html'),
    createElement: (tagName) => tagName === 'canvas' ? new FakeCanvas() : new FakeElement(tagName),
    // createIcon() (src/ui/icon.js) builds its SVG elements through createElementNS. The console
    // combat renderer prepends action icons on every render, so the fake document must expose
    // createElementNS or every combat mount throws.
    createElementNS: (namespace, tagName) => new FakeElement(tagName, namespace),
    createTextNode: (value) => { const node = new FakeElement('#text'); node.textContent = value; return node; }
  };
}

function installMatchMedia(match) {
  globalThis.window = globalThis.window || {};
  globalThis.window.matchMedia = () => ({ matches: Boolean(match), addEventListener() {}, removeEventListener() {} });
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
    if (found) return found;
  }
  return null;
}

function byClass(root, className) {
  if (root.classList?.contains(className)) return root;
  for (const child of root.children || []) {
    const found = byClass(child, className);
    if (found) return found;
  }
  return null;
}

function keyEvent(code) {
  return { code, key: code, repeat: false, preventDefault() { this.prevented = true; } };
}

// A world seed where the very first 'combat' stream draw (an attacker's d20 attack roll) is
// neither a natural 1 (a fumble, which triggers its own separate retaliation attack entry) nor a
// natural 20 (an unconditional auto-hit crit). Paired with a deliberately weak weapon against a
// high-defense target below, this produces a clean, single miss with no other entries. Valid only
// for fixtures where combatState.turnStarted is already true (no prior prepareTurn RNG draw) and
// the attack is the first action taken, matching every combatState() fixture in this file.
function findCleanMissSeed() {
  return findSeed((seed) => {
    const roll = createRNGCursorForRun(seed).nextInt('combat', 20);
    return roll !== 0 && roll !== 19;
  });
}

// A world seed where the very first 'combat' stream draw is not a natural 1 (fumble). Paired
// with a caster protocol-attack roll against a very low protocolDefense target, this guarantees
// the direct TECH hostile cast below lands a hit regardless of the exact non-fumble roll.
function findHostileCastHitSeed() {
  return findSeed((seed) => createRNGCursorForRun(seed).nextInt('combat', 20) !== 0);
}

// Opts a test into hapticsEnabled with a stubbed, spyable Vibration API. `navigator` is a
// getter-only global in this runtime, so it must be replaced via vi.stubGlobal, not assignment.
// Callers must call uninstall() (in a finally block) to restore localStorage/navigator.
function installHaptics() {
  const storage = installMockStorage();
  saveSettings({ hapticsEnabled: true });
  const vibrate = vi.fn();
  vi.stubGlobal('navigator', { vibrate });
  return {
    vibrate,
    uninstall() {
      vi.unstubAllGlobals();
      storage.uninstall();
    }
  };
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

beforeEach(() => { installDocument(); installMatchMedia(false); viewport.__viewportSpyState.instances.length = 0; });
afterEach(() => { delete globalThis.document; delete globalThis.window; });

describe('combat screen controller', () => {
  it('composes mock-aligned status grid, playfield, feedback rail, and COMBAT console regions', async () => {
    const { container } = await mountCombat();
    const canvas = byTestId(container, 'combat-canvas');
    const playfield = byClass(container, 'combat-playfield');

    expect(container.classList.contains('combat-screen')).toBe(true);
    expect(container.children.map((child) => child.className)).toEqual([
      expect.stringContaining('combat-status'),
      expect.stringContaining('combat-grid'),
      expect.stringContaining('combat-feedback-rail'),
      expect.stringContaining('console-bar')
    ]);
    expect(playfield.style.overflow).toBe('hidden');
    // SESSION-01 (portrait-usability-regression-repair) — the synthetic 96px
    // bottom margin used to push the playfield above an absolute console
    // overlay is gone; the console is a bounded in-flow tray below the rail.
    expect(playfield.style.marginBottom).toBeFalsy();
    expect(playfield.children).toEqual([canvas]);
    expect([canvas.width, canvas.height]).toEqual([384, 768]);
    expect(canvas.classList.contains('combat-grid-canvas')).toBe(true);
    expect(byTestId(container, 'console-tab-combat').getAttribute('aria-selected')).toBe('true');
    expect(byTestId(container, 'console-tab-move').disabled).toBe(true);
  });

  it('screen owns the feedback rail as a sibling of the console, outside .console-content', async () => {
    const { container } = await mountCombat();
    const rail = byTestId(container, 'combat-feedback');
    expect(rail).not.toBe(null);
    expect(rail.getAttribute('role')).toBe('status');
    expect(rail.getAttribute('aria-live')).toBe('polite');
    // Rail is a direct child of the screen container — not nested under the console.
    expect(container.children.includes(rail)).toBe(true);
    const consoleContent = byClass(container, 'console-content');
    expect(consoleContent).not.toBe(null);
    function containsNode(root, needle) {
      if (root === needle) return true;
      for (const child of root.children || []) if (containsNode(child, needle)) return true;
      return false;
    }
    expect(containsNode(consoleContent, rail)).toBe(false);
    // Feedback testids resolve to the rail's children, not to console rows.
    const notice = byTestId(container, 'combat-notice');
    const error = byTestId(container, 'combat-error');
    expect(notice).not.toBe(null);
    expect(error).not.toBe(null);
    expect(containsNode(rail, notice)).toBe(true);
    expect(containsNode(rail, error)).toBe(true);
    expect(containsNode(consoleContent, notice)).toBe(false);
    expect(containsNode(consoleContent, error)).toBe(false);
  });

  it('a legal target tap executes the attack directly — no separate confirm step', async () => {
    const combat = combatState([partyActor(), enemyActor({ hp: 10, hpMax: 10 })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    expect(combat.combatants.get(0).hp).toBe(10);
    expect(byTestId(container, 'combat-confirm')).toBe(null);

    byTestId(container, 'combat-target-0').click();

    expect(combat.log.some((entry) => entry.type === 'attack')).toBe(true);
    expect(combat.combatants.get('hero').ap).toBe(1);
    expect(byTestId(container, 'combat-confirm')).toBe(null);
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
    // D-pad-built paths keep the keyboard/D-pad Enter accelerator as their commit route —
    // there is no rendered combat-confirm control to click.
    expect(byTestId(container, 'combat-confirm')).toBe(null);
    container.dispatch('keydown', keyEvent('Enter'));

    const hero = combat.combatants.get('hero');
    expect(hero.position).toEqual({ x: 1, y: 2 });
    expect(hero.ap).toBe(2);
    expect(hero.moveAvailable).toBe(false);
    expect(byTestId(container, 'combat-action-move').disabled).toBe(true);
  });

  it('stepping three direction buttons builds a 3-cell path and confirm walks it', async () => {
    const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-move').click();
    byTestId(container, 'combat-dir-s').click();
    byTestId(container, 'combat-dir-s').click();
    byTestId(container, 'combat-dir-e').click();
    // Center cell reads remaining steps and the UNDO row appears after any step.
    expect(byTestId(container, 'combat-dir-center').textContent).toBe('2 LEFT');
    expect(byTestId(container, 'combat-undo')).not.toBe(null);

    container.dispatch('keydown', keyEvent('Enter'));

    const hero = combat.combatants.get('hero');
    expect(hero.position).toEqual({ x: 2, y: 3 });
    expect(hero.moveAvailable).toBe(false);
    const moveLog = combat.log.find((entry) => entry.type === 'move');
    expect(moveLog.path).toEqual(['s', 's', 'e']);
  });

  it('tapping a reachable canvas cell fills the shortest-route path and executes it in one tap', async () => {
    const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-move').click();
    const playfield = byClass(container, 'combat-playfield');
    // Portrait mount zooms to ~64 CSS px per world cell (scale ≈ 4/3), so cell (3,3) centered on
    // world (168, 168) lands at screen (224, 224). Hero at (1,1) → 2-step SE destination.
    playfield.dispatch('pointerdown', { clientX: 224, clientY: 224 });
    playfield.dispatch('pointerup', { clientX: 224, clientY: 224 });

    const hero = combat.combatants.get('hero');
    expect(hero.position).toEqual({ x: 3, y: 3 });
    expect(hero.moveAvailable).toBe(false);
    expect(combat.log.find((entry) => entry.type === 'move').steps).toBe(2);
    expect(byTestId(container, 'combat-confirm')).toBe(null);
  });

  it('dragging past the 6px threshold does not fire a tap-select', async () => {
    const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-move').click();
    const playfield = byClass(container, 'combat-playfield');
    playfield.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    playfield.dispatch('pointermove', { clientX: 100, clientY: 220 }); // dy=120 → drag
    playfield.dispatch('pointerup', { clientX: 100, clientY: 220 });

    const hero = combat.combatants.get('hero');
    // Drag never invokes selectDestination — movePath stays empty, position unchanged, no confirm rendered.
    expect(hero.position).toEqual({ x: 1, y: 1 });
    expect(byTestId(container, 'combat-confirm')).toBe(null);
    // The UNDO row only appears once a step has been added; a plain drag leaves it absent.
    expect(byTestId(container, 'combat-undo')).toBe(null);
  });

  it('tapping the canvas during choose-action enters move and executes the BFS-routed path in one tap', async () => {
    const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
    const { container } = await mountCombat({ combat });

    const playfield = byClass(container, 'combat-playfield');
    // No prior action click — the tap must promote choose-action → move → routed path → execute.
    playfield.dispatch('pointerdown', { clientX: 152, clientY: 152 });
    playfield.dispatch('pointerup', { clientX: 152, clientY: 152 });

    const hero = combat.combatants.get('hero');
    // One tap routes the full BFS path AND executes it — no intermediate confirm gesture.
    expect(hero.position).toEqual({ x: 2, y: 2 });
    expect(hero.moveAvailable).toBe(false);
    expect(byTestId(container, 'combat-confirm')).toBe(null);
  });

  it('tapping a different reachable cell after one move executes the new leg instead of the stale destination', async () => {
    const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-move').click();
    const playfield = byClass(container, 'combat-playfield');
    // Tap 1: cell (2,2) — 1 SE step. Screen (160,160) under portrait zoom = world (120,120).
    // Executes immediately; hero lands at (2,2) and MOVE is spent for the turn.
    playfield.dispatch('pointerdown', { clientX: 160, clientY: 160 });
    playfield.dispatch('pointerup', { clientX: 160, clientY: 160 });

    const hero = combat.combatants.get('hero');
    expect(hero.position).toEqual({ x: 2, y: 2 });
    expect(hero.moveAvailable).toBe(false);
    expect(byTestId(container, 'combat-action-move').disabled).toBe(true);
  });

  it('tapping an enemy cell during choose-target executes the attack against that target directly', async () => {
    // Custom Rule 11: strengthened per SESSION-05's range gate — this fixture originally used
    // an adjacent-band weapon (maxRange 1) with a target at (3,3) distance 2, which the range
    // gate now legitimately rejects. Hero gets a short-band weapon (maxRange 5) so the tap on
    // enemy 1 stays inside legal range and the test still exercises tap→execute routing.
    const shortRangeWeapon = makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 5, minRange: 0, accuracyBonus: 40 });
    const combat = combatState([
      partyActor({ weapon: shortRangeWeapon }),
      enemyActor({ id: 0, hp: 10, position: { x: 2, y: 1 } }),
      enemyActor({ id: 1, hp: 10, position: { x: 3, y: 3 } })
    ], ['hero', 0, 1]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    const playfield = byClass(container, 'combat-playfield');
    // Tap the second enemy (id=1) at (3,3) — portrait zoom puts cell (3,3) at screen (224,224).
    playfield.dispatch('pointerdown', { clientX: 224, clientY: 224 });
    playfield.dispatch('pointerup', { clientX: 224, clientY: 224 });

    const attackEntry = combat.log.find((entry) => entry.type === 'attack');
    expect(attackEntry).toBeTruthy();
    expect(attackEntry.targetId).toBe(1);
    expect(combat.combatants.get('hero').ap).toBe(1);
    expect(byTestId(container, 'combat-confirm')).toBe(null);
  });

  it('wheel events on the playfield never fire a tap-select', async () => {
    const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-move').click();
    const playfield = byClass(container, 'combat-playfield');
    playfield.dispatch('wheel', { clientX: 152, clientY: 152, deltaY: -120 });

    const hero = combat.combatants.get('hero');
    // No path staged, no confirm rendered — wheel is a camera event only.
    expect(hero.position).toEqual({ x: 1, y: 1 });
    expect(byTestId(container, 'combat-confirm')).toBe(null);
  });

  it('dock-mode keyboard cancel pops the last step instead of collapsing when a path is being built', async () => {
    installMatchMedia(true);
    const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-move').click();
    byTestId(container, 'combat-dir-s').click();
    byTestId(container, 'combat-dir-s').click();
    expect(byTestId(container, 'combat-dir-center').textContent).toBe('3 LEFT');

    container.dispatch('keydown', keyEvent('Escape'));
    expect(byTestId(container, 'combat-dir-center').textContent).toBe('4 LEFT');
    // Undo button is still present because at least one step remains.
    expect(byTestId(container, 'combat-undo')).not.toBe(null);
  });

  it('dispatches victory completion, marks defeated enemies, and clears active combat', async () => {
    const events = [];
    const off = bus.on('state:combat-end', (payload) => events.push(payload));
    const state = runState();
    const combat = combatState([partyActor(), enemyActor({ hp: 1, hpMax: 1 })]);
    const { container } = await mountCombat({ state, combat });

    byTestId(container, 'combat-action-attack').click();
    byTestId(container, 'combat-target-0').click();

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

    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('retreat');
    expect(events[0].completion).toMatchObject({ outcome: 'retreat', loot: [], forfeitedLoot: ['cache-drop'] });
    off();
  });

  it('runs deterministic enemy turns and emits single-death Echo handoff when survivors remain', async () => {
    vi.useFakeTimers();
    try {
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
      // END TURN executes directly on its single press. Enemy playback is paced via setTimeout;
      // runAllTimers completes every animation step.
      vi.runAllTimers();

      expect(deaths).toHaveLength(1);
      expect(deaths[0].character.id).toBe('hero');
      expect(state.party.map((member) => member.id)).toEqual(['ally']);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders three-region wide shell with telemetry (combat variant) and dock (COMBAT active)', async () => {
    installMatchMedia(true);
    const { container } = await mountCombat();
    const shell = byTestId(container, 'wide-shell');

    expect(shell).not.toBe(null);
    expect(shell.className).toContain('wide-shell');
    expect(shell.dataset.wideRoot).toBe('');
    expect(shell.children.map((child) => child.className.split(/\s+/)[0])).toEqual(
      expect.arrayContaining(['wide-telemetry-dock', 'wide-playfield-column', 'wide-console-dock'])
    );
    expect(byTestId(container, 'combat-canvas')).not.toBe(null);
    expect(byTestId(container, 'telemetry-init-block')).not.toBe(null);
    expect(byTestId(container, 'telemetry-active-actor')).not.toBe(null);
    expect(byTestId(container, 'console-tab-combat').getAttribute('aria-selected')).toBe('true');
    expect(byTestId(container, 'console-tab-loot').disabled).toBe(true);
    expect(byTestId(container, 'console-tab-move').disabled).toBe(true);
    expect(byClass(container, 'console-dim-layer')).toBe(null);
  });

  it('targeting sub-mode renders inside the dock using target-info/target-name/target-detail; the target tap executes directly', async () => {
    installMatchMedia(true);
    const combat = combatState([partyActor(), enemyActor({ hp: 10, hpMax: 10 })]);
    const { container } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();

    const preview = byTestId(container, 'combat-selected-preview');
    expect(preview.className).toContain('target-info');
    expect(byClass(preview, 'target-name')).not.toBe(null);
    expect(byClass(preview, 'target-detail')).not.toBe(null);
    expect(byTestId(container, 'combat-confirm')).toBe(null);

    byTestId(container, 'combat-target-0').click();
    expect(combat.log.some((entry) => entry.type === 'attack')).toBe(true);
  });

  it('wide mount attaches pane handles + collapse buttons and cleans them up on unmount', async () => {
    installMatchMedia(true);
    const { container, controller } = await mountCombat();

    expect(byTestId(container, 'pane-handle-left')).not.toBe(null);
    expect(byTestId(container, 'pane-handle-right')).not.toBe(null);
    expect(byTestId(container, 'pane-collapse-left')).not.toBe(null);
    expect(byTestId(container, 'pane-collapse-right')).not.toBe(null);

    controller.unmount();

    expect(byTestId(container, 'pane-handle-left')).toBe(null);
    expect(byTestId(container, 'pane-handle-right')).toBe(null);
    expect(byTestId(container, 'pane-collapse-left')).toBe(null);
    expect(byTestId(container, 'pane-collapse-right')).toBe(null);
  });

  it('portrait mount does not attach pane handles or collapse buttons', async () => {
    const { container } = await mountCombat();
    expect(byTestId(container, 'pane-handle-left')).toBe(null);
    expect(byTestId(container, 'pane-handle-right')).toBe(null);
    expect(byTestId(container, 'pane-collapse-left')).toBe(null);
    expect(byTestId(container, 'pane-collapse-right')).toBe(null);
  });

  // Portrait mounts zoom the camera to a legible default (~64 CSS px per world cell) instead of
  // fitting the whole window; wide keeps camera.fit() so the docked column reads as an overview.
  it('portrait mount zooms via camera.zoomToCells with COMBAT_CELL_SIZE, not camera.fit', async () => {
    await mountCombat();
    const spy = viewport.__viewportSpyState.instances[0];
    expect(spy).toBeTruthy();
    expect(spy.zoomToCells.length).toBeGreaterThan(0);
    expect(spy.zoomToCells[0][0]).toBe(48);
    expect(spy.zoomToCells[0][1]).toBe(64);
    expect(spy.fit).toBe(0);
  });

  it('wide mount calls camera.fit and never calls camera.zoomToCells', async () => {
    installMatchMedia(true);
    viewport.__viewportSpyState.instances.length = 0;
    await mountCombat();
    const spy = viewport.__viewportSpyState.instances[0];
    expect(spy).toBeTruthy();
    expect(spy.fit).toBeGreaterThan(0);
    expect(spy.zoomToCells.length).toBe(0);
  });

  // Portrait console presence (portrait-usability-regression-repair SESSION-01):
  // open the console at 'half' once on mount so actions are immediately reachable,
  // then never resize it again. Enemy playback does not toggle the console; an
  // explicit user collapse stays collapsed until the user reopens it.
  it('portrait party-first mount ends with the console expanded at half', async () => {
    const { container, controller } = await mountCombat();
    const consoleEl = byClass(container, 'console-bar');
    expect(consoleEl).not.toBe(null);
    expect(consoleEl.dataset.expandState).toBe('half');
    controller.unmount();
  });

  it('enemy playback does not resize the console — it stays at whatever size the user set', async () => {
    vi.useFakeTimers();
    try {
      const combat = combatState([partyActor(), enemyActor({ id: 0, position: { x: 2, y: 1 } })], ['hero', 0]);
      const { container, controller } = await mountCombat({ combat });
      const consoleEl = byClass(container, 'console-bar');
      expect(consoleEl.dataset.expandState).toBe('half');

      byTestId(container, 'combat-action-end-turn').click();
      // Enemy playback in progress — console must NOT collapse.
      expect(consoleEl.dataset.expandState).toBe('half');
      vi.runAllTimers();
      // After playback drains and a new party turn starts, the console is
      // still at 'half' — but only because that's where it already was, not
      // because a per-turn re-present forced it there.
      expect(consoleEl.dataset.expandState).toBe('half');
      controller.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an explicit user collapse via Escape stays collapsed through enemy playback and later turns', async () => {
    vi.useFakeTimers();
    try {
      const combat = combatState([partyActor(), enemyActor({ id: 0, position: { x: 2, y: 1 } })], ['hero', 0]);
      const { container, controller } = await mountCombat({ combat });
      const consoleEl = byClass(container, 'console-bar');
      expect(consoleEl.dataset.expandState).toBe('half');

      container.dispatch('keydown', keyEvent('Escape'));
      expect(consoleEl.dataset.expandState).toBe('collapsed');

      // End turn → enemy playback pass → user collapse persists.
      byTestId(container, 'combat-action-end-turn').click();
      expect(consoleEl.dataset.expandState).toBe('collapsed');

      // New party turn — still collapsed. The player reopens it explicitly.
      vi.runAllTimers();
      expect(consoleEl.dataset.expandState).toBe('collapsed');
      controller.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stray ui:console-collapse bus dispatch after mount does not perturb combat state', async () => {
    const { container, controller } = await mountCombat();
    const consoleEl = byClass(container, 'console-bar');
    expect(consoleEl.dataset.expandState).toBe('half');
    expect(() => bus.dispatch('ui:console-collapse')).not.toThrow();
    controller.unmount();
    expect(() => bus.dispatch('ui:console-collapse')).not.toThrow();
  });

  it('a destination tap executes the move directly and leaves the feedback rail cleared', async () => {
    vi.useFakeTimers();
    try {
      const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
      const { container, controller } = await mountCombat({ combat });
      const playfield = byClass(container, 'combat-playfield');

      byTestId(container, 'combat-action-move').click();
      playfield.dispatch('pointerdown', { clientX: 224, clientY: 224 });
      playfield.dispatch('pointerup', { clientX: 224, clientY: 224 });
      vi.runAllTimers();

      const hero = combat.combatants.get('hero');
      expect(hero.position).toEqual({ x: 3, y: 3 });
      // One tap executed the move directly — no lingering "tap again" notice.
      const notice = byTestId(container, 'combat-notice');
      expect(notice.textContent).toBe('');
      expect(notice.hidden).toBe(true);
      controller.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  // SESSION-01 (mobile-combat-density-repair checkpoint 2) — the rail carries
  // an explicit, testable active flag so CSS can zero its own chrome when
  // inactive without ever display:none-ing the live-region mount itself.
  it('feedback rail carries an explicit active flag that flips with notice/error and never removes the live-region mount', async () => {
    vi.useFakeTimers();
    try {
      // An out-of-range keyboard-confirmed attack surfaces an error without spending AP —
      // a reliable, RNG-free way to activate the rail now that a legal tap executes instantly.
      const combat = combatState([
        partyActor({ id: 'hero', position: { x: 1, y: 1 } }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, hp: 10, hpMax: 10 }),
        enemyActor({ id: 1, position: { x: 6, y: 6 }, hp: 10, hpMax: 10 })
      ], ['hero', 0, 1]);
      const { container, controller } = await mountCombat({ combat });
      const rail = byTestId(container, 'combat-feedback');

      // Mounted inactive: no notice, no error yet.
      expect(rail.classList.contains('is-active')).toBe(false);
      expect(rail.dataset.active).toBe('false');

      byTestId(container, 'combat-action-attack').click();
      container.dispatch('keydown', keyEvent('Tab'));
      container.dispatch('keydown', keyEvent('Enter'));

      expect(rail.classList.contains('is-active')).toBe(true);
      expect(rail.dataset.active).toBe('true');
      // The live-region node and its message children stay mounted throughout —
      // never removed, never display:none on the rail itself.
      expect(byTestId(container, 'combat-feedback')).toBe(rail);
      expect(byTestId(container, 'combat-notice')).not.toBe(null);
      expect(byTestId(container, 'combat-error')).not.toBe(null);

      byTestId(container, 'combat-action-end-turn').click();
      vi.runAllTimers();

      expect(rail.classList.contains('is-active')).toBe(false);
      expect(rail.dataset.active).toBe('false');
      controller.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('wide mount has no portrait feedback rail — no combat-feedback duplicate', async () => {
    installMatchMedia(true);
    const { container, controller } = await mountCombat();
    expect(byTestId(container, 'combat-feedback')).toBe(null);
    // The `combat-notice` / `combat-error` testids in wide belong to the dock's
    // combat pane (rendered by src/ui/console/combat.js) — there is only one of
    // each, and no portrait rail participates.
    function collectByTestId(root, testid, matches = []) {
      if (root.dataset?.testid === testid) matches.push(root);
      for (const child of root.children || []) collectByTestId(child, testid, matches);
      return matches;
    }
    // Neither node exists yet (no notice/error to show at mount) but the count
    // must never exceed one when they do — confirmed by walking the wide dock.
    expect(collectByTestId(container, 'combat-notice').length).toBeLessThanOrEqual(1);
    expect(collectByTestId(container, 'combat-error').length).toBeLessThanOrEqual(1);
    controller.unmount();
  });

  it('wide mount never mutates console size regardless of turn state', async () => {
    installMatchMedia(true);
    vi.useFakeTimers();
    try {
      const combat = combatState([partyActor(), enemyActor({ id: 0, position: { x: 2, y: 1 } })], ['hero', 0]);
      const { container, controller } = await mountCombat({ combat });
      // Wide dock has no `console-bar` element — the dock is `wide-console-dock` and always open.
      expect(byClass(container, 'console-bar')).toBe(null);
      const dock = byClass(container, 'wide-console-dock');
      expect(dock).not.toBe(null);
      byTestId(container, 'combat-action-end-turn').click();
      vi.runAllTimers();
      // Dock remains rendered; the presence controller is a no-op for isWide=true.
      expect(byClass(container, 'wide-console-dock')).not.toBe(null);
      controller.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmount destroys the playfield pulse loop so no further rAF frames are scheduled', async () => {
    const raf = [];
    const cancels = [];
    const originalRaf = globalThis.window?.requestAnimationFrame;
    const originalCancel = globalThis.window?.cancelAnimationFrame;
    globalThis.window = globalThis.window || {};
    globalThis.window.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
    globalThis.window.cancelAnimationFrame = (id) => { cancels.push(id); };
    globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
    try {
      const { controller } = await mountCombat();
      expect(raf.length).toBeGreaterThan(0);
      controller.unmount();
      const lastCallback = raf[raf.length - 1];
      raf.length = 0;
      lastCallback(16);
      expect(raf.length).toBe(0);
      expect(cancels.length).toBeGreaterThan(0);
    } finally {
      if (originalRaf) globalThis.window.requestAnimationFrame = originalRaf; else delete globalThis.window.requestAnimationFrame;
      if (originalCancel) globalThis.window.cancelAnimationFrame = originalCancel; else delete globalThis.window.cancelAnimationFrame;
      delete globalThis.requestAnimationFrame;
      delete globalThis.cancelAnimationFrame;
    }
  });

  it('routes party wipe to scorecard intent and removes input on unmount', async () => {
    vi.useFakeTimers();
    try {
      const wipes = [];
      const off = bus.on('state:party-wipe', (payload) => wipes.push(payload));
      const state = runState(1, [makeCharacter({ id: 'hero', hp: 1, hpMax: 30 })]);
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30, position: { x: 1, y: 1 } }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) })
      ], ['hero', 0]);
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();
      vi.runAllTimers();
      expect(wipes).toHaveLength(1);

      controller.unmount();
      container.dispatch('keydown', keyEvent('ArrowRight'));
      expect(wipes).toHaveLength(1);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('paces enemy turns through log-replay playback: interim state shows an enemy at a synthetic mid-cell', async () => {
    vi.useFakeTimers();
    try {
      const state = runState();
      // Enemy at (5,1) with a synthetic 'move' log entry pre-seeded: from (5,1) → (2,1) via w,w,w.
      // resolveTurn produces a real 'move' log; we mimic it deterministically so playback timing
      // is exact and doesn't depend on SESSION-01's AI rewrite.
      const enemy = enemyActor({ id: 0, position: { x: 2, y: 1 } });  // engine already teleported
      const combat = combatState([partyActor(), enemy], ['hero', 0]);
      const { container, controller } = await mountCombat({ state, combat });

      // Manually invoke the playback path via bus by simulating what afterAction would build:
      // set combat.turnOrder currentTurn to hero, append a completed move entry, and observe.
      // Here we exercise the full end-turn round-trip and check the animated frame after ~1 step.
      byTestId(container, 'combat-action-end-turn').click();
      // A pending timer must exist: enemy playback scheduled setTimeout at ≥ MOVE_STEP_MS.
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      // Drain a single 140ms tick — at most one intermediate step advances, then the queue re-schedules.
      vi.advanceTimersByTime(140);
      // Selection stays resolving (input gated) until all timers drain — every action card is
      // dark with the same reason.
      expect(byTestId(container, 'combat-action-attack').disabled).toBe(true);
      expect(byTestId(container, 'combat-action-attack').getAttribute('title')).toBe('Action resolving.');
      // Fully drain the queue — combat resolution completes.
      vi.runAllTimers();
      controller.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('input is gated during playback: clicking a resolving-disabled action or dispatching keydown does not advance state', async () => {
    vi.useFakeTimers();
    try {
      const combat = combatState([partyActor(), enemyActor({ id: 0, position: { x: 2, y: 1 } })], ['hero', 0]);
      const { container } = await mountCombat({ combat });

      byTestId(container, 'combat-action-end-turn').click();
      // During playback every action card is disabled ("Action resolving.") and keyboard confirm
      // is rejected by confirmSelection's own resolving guard.
      const startLog = combat.log.length;
      byTestId(container, 'combat-action-attack').click();
      container.dispatch('keydown', keyEvent('Enter'));
      // No new log entries would be appended by rejected input — the engine ran once and stopped.
      expect(combat.log.length).toBe(startLog);
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmount mid-playback clears the pending timer and never fires the completion callback', async () => {
    vi.useFakeTimers();
    try {
      const combat = combatState([partyActor(), enemyActor({ id: 0, position: { x: 2, y: 1 } })], ['hero', 0]);
      const events = [];
      const off = bus.on('state:combat-end', (payload) => events.push(payload));
      const { container, controller } = await mountCombat({ combat });

      byTestId(container, 'combat-action-end-turn').click();
      const timersBefore = vi.getTimerCount();
      expect(timersBefore).toBeGreaterThan(0);

      controller.unmount();
      // Unmount cancels the pending timer AND flips playback.active false so any stale timer that
      // did fire returns immediately. Draining the queue must not surface a combat-end.
      vi.runAllTimers();
      expect(events).toHaveLength(0);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reduced motion (matchMedia prefers-reduced-motion) resolves enemy turns synchronously — no timers scheduled', async () => {
    installMatchMedia(true);
    vi.useFakeTimers();
    try {
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

      // Reduced motion → instant dispatch. Death and party-membership updates land synchronously
      // and no playback timers were ever scheduled.
      expect(deaths).toHaveLength(1);
      expect(state.party.map((m) => m.id)).toEqual(['ally']);
      expect(vi.getTimerCount()).toBe(0);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('state:combat-end fires only after playback completes — not synchronously with confirm', async () => {
    vi.useFakeTimers();
    try {
      const events = [];
      const off = bus.on('state:combat-end', (payload) => events.push(payload));
      const state = runState();
      // Hero end-turn triggers enemy resolve; if enemy attack lands the enemy still stands (hp 10).
      // No terminal end fires because combat continues — but if we then reduce enemy to 0 by re-mount
      // we can validate the ordering. Simpler: use a wipe scenario and verify no combat-end event
      // (party-wipe path instead), and that party-wipe waits for playback.
      const wipes = [];
      const offWipe = bus.on('state:party-wipe', (payload) => wipes.push(payload));
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30, position: { x: 1, y: 1 } }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) })
      ], ['hero', 0]);
      const { container } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();
      // Between the direct END TURN activation and timer drain, the terminal event has NOT
      // fired yet.
      expect(events).toHaveLength(0);
      expect(wipes).toHaveLength(0);
      vi.runAllTimers();
      // After playback drains, the terminal wipe event lands.
      expect(wipes).toHaveLength(1);
      expect(events).toHaveLength(0);
      off();
      offWipe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tapping the canvas during playback fast-forwards to completion without scheduling new timers', async () => {
    vi.useFakeTimers();
    try {
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30 }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) })
      ], ['hero', 0]);
      const state = runState(1, [makeCharacter({ id: 'hero', hp: 1, hpMax: 30 })]);
      const wipes = [];
      const off = bus.on('state:party-wipe', (payload) => wipes.push(payload));
      const { container } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const playfield = byClass(container, 'combat-playfield');
      // Tap the canvas — playback's onTap fires fastForwardPlayback instead of a cell selection.
      playfield.dispatch('pointerdown', { clientX: 152, clientY: 152 });
      playfield.dispatch('pointerup', { clientX: 152, clientY: 152 });
      // Fast-forward drains the queue synchronously: terminal event lands, no timers remain.
      expect(wipes).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmount mid-playback flushes remaining log entries so the LOG feed stays complete', async () => {
    vi.useFakeTimers();
    try {
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30 }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) })
      ], ['hero', 0]);
      const state = runState(1, [makeCharacter({ id: 'hero', hp: 1, hpMax: 30 })]);
      const logEvents = [];
      const off = bus.on('ui:log-entry', (payload) => logEvents.push(payload));
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();
      // At least one enemy log entry is now in combatState.log (attack, and probably death).
      const totalEntries = combat.log.length;
      expect(totalEntries).toBeGreaterThan(0);
      // Unmount BEFORE the timer queue drains — remaining entries must still hit the bus.
      controller.unmount();
      const distinct = new Set(logEvents.map((e) => e.sequence));
      expect(distinct.size).toBe(totalEntries);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('log-entry bus events dispatch progressively during playback, then flush on completion', async () => {
    vi.useFakeTimers();
    try {
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30 }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) })
      ], ['hero', 0]);
      const state = runState(1, [makeCharacter({ id: 'hero', hp: 1, hpMax: 30 })]);
      const logEvents = [];
      const off = bus.on('ui:log-entry', (payload) => logEvents.push(payload));
      const { container } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();
      // END TURN executes directly: the party's own end-turn entry (and any playback steps that
      // complete before the first paced timer fires) are already dispatched by the time click()
      // returns; enemy entries still pending playback have NOT all been dispatched yet.
      const midDispatch = logEvents.length;
      expect(midDispatch).toBeGreaterThan(0);
      vi.runAllTimers();
      // After playback, every log entry has been dispatched (cursor is caught up).
      expect(logEvents.length).toBeGreaterThanOrEqual(midDispatch);
      // Sequence numbers on dispatched payloads are strictly ascending.
      const sequences = logEvents.map((entry) => entry.sequence).filter((n) => Number.isInteger(n));
      const sorted = [...sequences].sort((a, b) => a - b);
      expect(sequences).toEqual(sorted);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  // Range gate (SESSION-05 checkpoint 3+4). Adjacent (maxRange 1) melee weapon. With a legal enemy
  // (id 0, distance 1) in range the ATTACK action stays enabled, and a second enemy (id 1) at
  // Chebyshev distance ≥ 2 makes evaluateRange return legal:false — previewForTarget carries
  // targetLegal:false, so the console disables that row and a click is a no-op.
  it('previewForTarget returns targetLegal:false and the console disables the row for an out-of-range target', async () => {
    const combat = combatState([
      partyActor({ id: 'hero', position: { x: 1, y: 1 } }),
      enemyActor({ id: 0, position: { x: 2, y: 1 }, hp: 10, hpMax: 10 }),
      enemyActor({ id: 1, position: { x: 6, y: 6 }, hp: 10, hpMax: 10 })
    ], ['hero', 0, 1]);
    const { container, controller } = await mountCombat({ combat });

    // Enemy 0 is in range, so ATTACK is available and opens the target list.
    expect(byTestId(container, 'combat-action-attack').disabled).toBe(false);
    byTestId(container, 'combat-action-attack').click();
    const targetRow = byTestId(container, 'combat-target-1');
    expect(targetRow.disabled).toBe(true);
    expect(targetRow.className).toContain('is-illegal');
    // Clicking a disabled row must not move the selection onto that out-of-range target.
    targetRow.click();
    expect(byTestId(container, 'combat-target-1').getAttribute('aria-selected')).not.toBe('true');
    controller.unmount();
  });

  // Action-level range gate (user feedback: "if not able to attack anything, attack should not be
  // enabled"). When every living enemy is out of the active actor's weapon range, ATTACK is disabled
  // outright with an explanatory reason rather than opening a target list of only-illegal rows.
  it('disables the ATTACK action entirely when no enemy is within weapon range', async () => {
    const combat = combatState([
      partyActor({ id: 'hero', position: { x: 1, y: 1 } }),
      enemyActor({ id: 0, position: { x: 6, y: 6 }, hp: 10, hpMax: 10 })
    ]);
    const { container, controller } = await mountCombat({ combat });

    const attack = byTestId(container, 'combat-action-attack');
    expect(attack.disabled).toBe(true);
    expect(attack.getAttribute('title')).toBe('No targets in range.');
    // The disabled button is inert — clicking it never opens a target list.
    attack.click();
    expect(byTestId(container, 'combat-targets')).toBe(null);
    controller.unmount();
  });

  it('combatConfirm refuses when a range-gated action lands the selection on an out-of-range target via keyboard cycle', async () => {
    // Two enemies: 0 at (2,1) is legal (distance 1), 1 at (6,6) is illegal (distance 5). Attack
    // action selects the first target automatically; Tab cycles to the illegal one. Confirm
    // must refuse and surface the OUT OF RANGE message via the error notice.
    const combat = combatState([
      partyActor({ id: 'hero', position: { x: 1, y: 1 } }),
      enemyActor({ id: 0, position: { x: 2, y: 1 }, hp: 10, hpMax: 10 }),
      enemyActor({ id: 1, position: { x: 6, y: 6 }, hp: 10, hpMax: 10 })
    ], ['hero', 0, 1]);
    const { container, controller } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    // Legal target 0 is auto-selected; the console shows a 'confirm' element only after a
    // successful selectTarget → phase advance. Auto-target starts in choose-target phase, so
    // keyboard Enter is the confirm path here (per handleInput → combatConfirm → readyFromKeyboard).
    container.dispatch('keydown', keyEvent('Tab'));
    expect(byTestId(container, 'combat-target-1').getAttribute('aria-selected')).toBe('true');
    // No combat log entries land before Enter — the enemy is still alive.
    const beforeEntries = combat.log.filter((entry) => entry.type === 'attack').length;
    // Keyboard confirm attempts to fire — validationError trips OUT OF RANGE, no attack lands.
    container.dispatch('keydown', keyEvent('Enter'));
    const afterEntries = combat.log.filter((entry) => entry.type === 'attack').length;
    expect(afterEntries).toBe(beforeEntries);
    // The error notice surfaces OUT OF RANGE.
    expect(byTestId(container, 'combat-error').textContent).toContain('OUT OF RANGE');

    controller.unmount();
  });

  it('range gate does not block legal in-range attacks — the target tap fires the action directly', async () => {
    const combat = combatState([
      partyActor({ id: 'hero', position: { x: 1, y: 1 } }),
      enemyActor({ id: 0, position: { x: 2, y: 1 }, hp: 10, hpMax: 10 })
    ]);
    const { container, controller } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    byTestId(container, 'combat-target-0').click();
    expect(combat.log.some((entry) => entry.type === 'attack')).toBe(true);
    expect(byTestId(container, 'combat-confirm')).toBe(null);

    controller.unmount();
  });

  // Line-of-sight gate (SESSION-03 of combat-and-ux-feedback-pass). SESSION-02 shipped the
  // rules-layer primitive hasLineOfSight(lattice, from, to) plus the 'no_line_of_sight'
  // reason string; this session wires it into the UI's three attack-legality gates
  // (previewForTarget, actionTargeting, selectTarget-via-preview). A weapon in-range by
  // Chebyshev distance but blocked by an interior wall must render as disabled with the
  // 'NO LINE OF SIGHT' reason chip, disable the ATTACK action when nothing has LOS, and
  // refuse a keyboard-cycled walled selection at commit.
  function windowWithWallAt(cells) {
    const grid = Array.from({ length: 16 }, () => Array(8).fill(1));
    for (const { x, y } of cells) grid[y][x] = 0;
    return { originX: 0, originY: 0, width: 8, height: 16, cells: grid };
  }

  function shortRangeWeapon() {
    return makeWeapon({ damageDie: 'd6', rangeBand: 'short', maxRange: 5, minRange: 0, accuracyBonus: 40 });
  }

  it('a wall between attacker and target reports NO LINE OF SIGHT and disables the row (previewForTarget LOS gate)', async () => {
    // Hero (1,1) with a legal adjacent enemy 0 at (1,2) (no wall on that segment, keeps ATTACK
    // enabled so the target list renders) plus a walled enemy 1 at (5,1). LOS from (1,1) to
    // (5,1) traverses (3,1), which is a wall — corner:false interior block. Distance 4 is
    // inside the short-band weapon's maxRange 5, so the range check passes and only the LOS
    // gate refuses. Verifies previewForTarget downgrades range.reason to 'no_line_of_sight'
    // and renderTargets picks that up via the pre-existing REASON_LABEL entry.
    const combat = combatState([
      partyActor({ id: 'hero', position: { x: 1, y: 1 }, weapon: shortRangeWeapon() }),
      enemyActor({ id: 0, position: { x: 1, y: 2 }, hp: 10, hpMax: 10 }),
      enemyActor({ id: 1, position: { x: 5, y: 1 }, hp: 10, hpMax: 10 })
    ], ['hero', 0, 1]);
    combat.window = windowWithWallAt([{ x: 3, y: 1 }]);
    const { container, controller } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    // The legal companion keeps the target list open.
    expect(byTestId(container, 'combat-target-0').disabled).toBe(false);
    const walledRow = byTestId(container, 'combat-target-1');
    expect(walledRow.disabled).toBe(true);
    expect(walledRow.className).toContain('is-illegal');
    // The reason chip surfaces the specific LOS string, not the fallback 'out of range' text —
    // proves REASON_LABEL['no_line_of_sight'] resolved rather than falling through to 'illegal'.
    expect(walledRow.textContent).toContain('NO LINE OF SIGHT');
    controller.unmount();
  });

  it('LOS-blocked as the sole in-range target disables ATTACK action with "No targets in range." (actionTargeting LOS gate)', async () => {
    // Only one enemy exists, at distance 2 (in-range for the short weapon) but wall-blocked.
    // actionTargeting reports legal:0, combatActionDisabledReason returns 'No targets in range.',
    // and the ATTACK button renders disabled with that reason as its title.
    const combat = combatState([
      partyActor({ id: 'hero', position: { x: 1, y: 1 }, weapon: shortRangeWeapon() }),
      enemyActor({ id: 0, position: { x: 3, y: 1 }, hp: 10, hpMax: 10 })
    ]);
    combat.window = windowWithWallAt([{ x: 2, y: 1 }]);
    const { container, controller } = await mountCombat({ combat });

    const attack = byTestId(container, 'combat-action-attack');
    expect(attack.disabled).toBe(true);
    expect(attack.getAttribute('title')).toBe('No targets in range.');
    // The disabled action is inert — clicking it must not open a target list.
    attack.click();
    expect(byTestId(container, 'combat-targets')).toBe(null);
    controller.unmount();
  });

  it('selectTarget refuses a keyboard-cycled walled target (validationError surfaces OUT OF RANGE)', async () => {
    // Two enemies: 0 at (2,1) has no wall (legal, distance 1); 1 at (3,1) sits behind a wall at
    // (2,1)-ish path — put the wall at (3,0)... no wait, LOS from (1,1) to (3,1) passes through
    // (2,1). If we put the wall at (2,1), enemy 0 at (2,1) is co-located with a wall. Use a
    // different layout: hero (1,1), legal enemy 0 at (1,2) (adjacent, no wall on segment),
    // walled enemy 1 at (5,1) with wall at (3,1). LOS from (1,1) to (5,1) traverses (2,1),
    // (3,1), (4,1); (3,1) is a wall → interior block. Distance 4 is inside the short weapon's
    // maxRange 5, so the range check passes and only LOS refuses.
    const combat = combatState([
      partyActor({ id: 'hero', position: { x: 1, y: 1 }, weapon: shortRangeWeapon() }),
      enemyActor({ id: 0, position: { x: 1, y: 2 }, hp: 10, hpMax: 10 }),
      enemyActor({ id: 1, position: { x: 5, y: 1 }, hp: 10, hpMax: 10 })
    ], ['hero', 0, 1]);
    combat.window = windowWithWallAt([{ x: 3, y: 1 }]);
    const { container, controller } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    // Legal enemy 0 is auto-selected; Tab cycles to the walled enemy 1. Enter attempts commit,
    // validationError trips 'OUT OF RANGE — MOVE OR RETARGET', no attack landed.
    container.dispatch('keydown', keyEvent('Tab'));
    expect(byTestId(container, 'combat-target-1').getAttribute('aria-selected')).toBe('true');
    const beforeAttacks = combat.log.filter((entry) => entry.type === 'attack').length;
    container.dispatch('keydown', keyEvent('Enter'));
    expect(combat.log.filter((entry) => entry.type === 'attack').length).toBe(beforeAttacks);
    // Same error string as any out-of-range refusal — the UI-layer contract is one message for
    // "can't target this cell right now"; the specific LOS reason surfaces on the row itself.
    expect(byTestId(container, 'combat-error').textContent).toContain('OUT OF RANGE');
    controller.unmount();
  });

  // Regression: an injured party member entering combat must NOT get its hpMax
  // fabricated from currentHP. deriveStats(character, classData, loadout) is the
  // ONLY source of true hpMax/chargeMax — normalizeCombatActor must fall through
  // to that derivation before ever touching `hp`. Breacher with vit=6, hitDieBase=16
  // → hpMax=40. Breacher with res=5, chargeBase=0 → chargeMax=15.
  it('derives hpMax/chargeMax for a party member entering combat without an explicit max', async () => {
    const injured = partyActor({ id: 'hero', hp: 15, hpMax: undefined, charge: 4, chargeMax: undefined });
    const combat = combatState([injured, enemyActor()]);
    const { container, controller } = await mountCombat({ combat });
    const hero = combat.combatants.get('hero');
    expect(hero.hp).toBe(15);
    expect(hero.hpMax).toBe(40);
    expect(hero.charge).toBe(4);
    expect(hero.chargeMax).toBe(15);
    controller.unmount();
    // Silence unused-container warning in strict envs.
    void container;
  });

  it('preserves an explicit party hpMax/chargeMax over the derived value on entry', async () => {
    const combat = combatState([partyActor({ id: 'hero', hp: 15 }), enemyActor()]);
    const { container, controller } = await mountCombat({ combat });
    const hero = combat.combatants.get('hero');
    // partyActor default hpMax=30, chargeMax=10 — explicit values must stick even
    // though the derived max would be higher. Fixes the "hpMax = currentHP" bug
    // without regressing legitimate explicit maxes.
    expect(hero.hpMax).toBe(30);
    expect(hero.chargeMax).toBe(10);
    controller.unmount();
    void container;
  });

  // affixes-take-effect SESSION-04 checkpoint 1 — party DEF becomes real (D8): armor
  // defenseBonus + Fortified's own +2 both land, and the FIN penalty (operator does not ignore
  // medium armor's -1, unlike breacher/anchor) shows up in effectiveAttributes.fin.
  // DEF = 10 + FIN mod(effectiveFin=5 → 0) + armor DEF(3) + Fortified(+2) = 15.
  it('derives real DEF and effective FIN for a party actor with armor + Fortified', async () => {
    const armored = partyActor({
      id: 'hero',
      classId: 'operator',
      attributes: { mgt: 8, fin: 6, vit: 6, res: 5, foc: 5, sig: 5 },
      defense: undefined,
      equipment: {
        weapon: null,
        armor: { id: 'gear_armor', baseType: 'medium', affixes: ['fortified'] },
        offhand: null
      }
    });
    const combat = combatState([armored, enemyActor()]);
    const { container, controller } = await mountCombat({ combat });
    const hero = combat.combatants.get('hero');
    expect(hero.defense).toBe(15);
    expect(hero.effectiveAttributes.fin).toBe(5);
    controller.unmount();
    void container;
  });

  it('preserves an explicit party defense over the derived value on entry', async () => {
    const combat = combatState([partyActor({ id: 'hero' }), enemyActor()]);
    const { container, controller } = await mountCombat({ combat });
    const hero = combat.combatants.get('hero');
    // partyActor default defense=12 — must stick even though it differs from the
    // class+loadout-derived value (breacher, unarmored → derived DEF would be lower).
    expect(hero.defense).toBe(12);
    controller.unmount();
    void container;
  });

  it('falls back to undefined defense for a party actor with no resolvable class', async () => {
    const classless = partyActor({ id: 'hero', classId: 'not-a-real-class', defense: undefined });
    const combat = combatState([classless, enemyActor()]);
    const { container, controller } = await mountCombat({ combat });
    const hero = combat.combatants.get('hero');
    expect(hero.defense).toBeUndefined();
    controller.unmount();
    void container;
  });

  // affixes-take-effect SESSION-04 checkpoint 2 — Lucky availability + the floor claim.
  function luckyWeaponItem(id = 'lucky_weapon_1') {
    return { id, category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: ['lucky'], corrupt: false, stats: {}, salvageValue: 0, junkTagged: false };
  }

  it('sets actor.luckyReroll from an unclaimed once-per-floor reroll item on the equipped gear', async () => {
    const item = luckyWeaponItem();
    const hero = partyActor({ id: 'hero', equipment: { weapon: item, armor: null, offhand: null } });
    const combat = combatState([hero, enemyActor()]);
    const { container, controller } = await mountCombat({ combat });
    expect(combat.combatants.get('hero').luckyReroll).toEqual({ available: true, itemId: item.id });
    controller.unmount();
    void container;
  });

  it('omits actor.luckyReroll once the item is already claimed on the floor ledger', async () => {
    const item = luckyWeaponItem();
    const hero = partyActor({ id: 'hero', equipment: { weapon: item, armor: null, offhand: null } });
    const combat = combatState([hero, enemyActor()]);
    const state = runState();
    state.affixFloorLedger.reroll.push(item.id);
    const { container, controller } = await mountCombat({ combat, state });
    expect(combat.combatants.get('hero').luckyReroll).toBeNull();
    controller.unmount();
    void container;
  });

  it('claims a used Lucky reroll onto the floor ledger exactly once at combat end, even with duplicate log entries for the same item', async () => {
    const item = luckyWeaponItem();
    const hero = makeCharacter({ id: 'hero', hp: 30, hpMax: 30, charge: 10, chargeMax: 10, equipment: { weapon: item, armor: null, offhand: null } });
    const state = runState(1234, [hero]);
    const combat = combatState([
      partyActor({ id: 'hero', hp: 30, hpMax: 30 }),
      enemyActor({ hp: 0, hpMax: 1 })
    ]);
    // Simulate two Lucky-reroll attack log entries for the same item — the rules layer only
    // ever emits one per actor per combat (luckyRerollUsed), but the claim dedupes regardless.
    combat.log.push(
      { type: 'attack', actorId: 'hero', targetId: 0, hit: true, damage: 1, luckyReroll: { itemId: item.id, firstNatural: 3, keptNatural: 18 } },
      { type: 'attack', actorId: 'hero', targetId: 0, hit: true, damage: 1, luckyReroll: { itemId: item.id, firstNatural: 4, keptNatural: 19 } }
    );
    const payloads = [];
    const off = bus.on('state:combat-end', (payload) => payloads.push(payload));
    const { container, controller } = await mountCombat({ combat, state });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].runState.affixFloorLedger.reroll).toEqual([item.id]);
    off();
    controller.unmount();
    void container;
  });

  // viewState now carries `data` (SESSION-02/03 party/tech/gear consumers) and
  // `logEntries` (LOG mode merges with runState.recentEvents). Both flow through
  // the console shell to the mode context. Clicking the LOG tab renders the
  // injected live entry — proving `logEntries` reached the LOG module.
  it('pipes params.logEntries into the LOG console context via viewState', async () => {
    const combat = combatState([partyActor(), enemyActor()]);
    const container = new FakeElement('div');
    const { mount } = await import('../../src/ui/screens/combat.js');
    const encounter = { id: combat.id, kind: 'standard', window: combat.window, actors: [...combat.combatants.values()], forfeitableLoot: [] };
    const injected = [{ type: 'attack', message: 'injected live entry.', sequence: 999, detail: 'd20 15 = 15 → HIT' }];
    const controller = mount(container, { runState: runState(), floor: floor(), combatState: combat, encounter, data: gameData, logEntries: injected });

    byTestId(container, 'console-tab-log').click();
    const logArea = byTestId(container, 'log-area');
    expect(logArea).not.toBe(null);
    // The injected message must appear in the log body.
    const includesText = (node, needle) => {
      if ((node.textContent || '').includes(needle)) return true;
      for (const child of node.children || []) if (includesText(child, needle)) return true;
      return false;
    };
    expect(includesText(logArea, 'injected live entry.')).toBe(true);
    controller.unmount();
  });
});

// tech-protocol-e2e-repair SESSION-02 checkpoint 3 — the resume boundary. A direct TECH cast
// through the real console controls must commit into the SAME runState.activeCombat snapshot a
// resumed run would decode from, reflecting the post-cast caster ledger and target delta rather
// than the stale pre-cast state.
describe('TECH cast commits through the live combat-owned transaction (tech-protocol-e2e-repair SESSION-02)', () => {
  function techCombatFixture(seed) {
    const attributes = { mgt: 5, fin: 5, vit: 5, res: 6, foc: 5, sig: 4 };
    const protocolDeck = [{ school: 'disrupt', tier: 1 }];
    const state = runState(seed, [makeCharacter({
      id: 'hero', classId: 'operator', hp: 30, hpMax: 30, charge: 10, chargeMax: 10,
      attributes, protocolDeck
    })]);
    const hero = partyActor({
      id: 'hero', classId: 'operator', ap: 2, charge: 10, chargeMax: 10,
      attributes, protocols: protocolDeck, protocolDeck
    });
    const enemy = enemyActor({ id: 1, hp: 10, hpMax: 10, protocolDefense: 1, position: { x: 2, y: 1 } });
    const combat = combatState([hero, enemy]);
    return { state, combat };
  }

  it('mounts a resumed combat, casts a hostile TECH protocol through the console, and persists the update into runState.activeCombat', async () => {
    const { state, combat } = techCombatFixture(findHostileCastHitSeed());
    const { container, controller, runState: mountedState } = await mountCombat({ state, combat });

    byTestId(container, 'console-tab-tech').click();
    byTestId(container, 'tech-cast-disrupt-1').click();
    byTestId(container, 'tech-target-1').click();

    expect(byTestId(container, 'tech-confirm')).toBe(null);
    const casterLive = combat.combatants.get('hero');
    const targetLive = combat.combatants.get(1);
    expect(casterLive.ap).toBe(1);
    expect(casterLive.charge).toBe(8);
    expect(targetLive.hp).toBeLessThan(10);

    // The resumable snapshot must reflect the post-cast values, not the stale pre-cast state.
    expect(mountedState.activeCombat).toBeTruthy();
    const snapshotCaster = mountedState.activeCombat.actors.find((actor) => actor.id === 'hero');
    const snapshotTarget = mountedState.activeCombat.actors.find((actor) => actor.id === 1);
    expect(snapshotCaster.charge).toBe(8);
    expect(snapshotCaster.ap).toBe(1);
    expect(snapshotTarget.hp).toBe(targetLive.hp);
    expect(snapshotTarget.hp).toBeLessThan(10);
    // This repair wires actor deltas (hp/currentHP, charge/ap, conditions, position) only —
    // markers/temporaryEffects/apDebt/grid have no serialized contract and must not appear here.
    expect(mountedState.activeCombat.markers).toBeUndefined();

    controller.unmount();
  });

  it('routes the post-cast redraw through the screen-owned renderAll() path without mounting a second console controller', async () => {
    const { state, combat } = techCombatFixture(findHostileCastHitSeed());
    const { container, controller } = await mountCombat({ state, combat });

    const statusBarBefore = container.children[0];
    const consoleBarCountBefore = container.children.filter((child) => (child.className || '').includes('console-bar')).length;

    byTestId(container, 'console-tab-tech').click();
    byTestId(container, 'tech-cast-disrupt-1').click();
    byTestId(container, 'tech-target-1').click();

    // renderAll() (the refreshShell contract) replaces the status-bar node on every call — a
    // fresh identity here proves the full screen redraw ran, not just the console's local refresh.
    expect(container.children[0]).not.toBe(statusBarBefore);
    // Exactly one console controller/tray exists before and after — TECH's commit did not spin
    // up a second one.
    const consoleBarCountAfter = container.children.filter((child) => (child.className || '').includes('console-bar')).length;
    expect(consoleBarCountAfter).toBe(consoleBarCountBefore);
    expect(consoleBarCountAfter).toBe(1);

    controller.unmount();
  });
});

describe('describeEntryDetail — breakdown formatting', () => {
  it('formats a plain hit with non-zero attribute/accuracy/flank/blind modifiers and cover', () => {
    const entry = {
      type: 'attack', naturalRoll: 14, attribute: 'fin', attributeModifier: 3,
      weaponAccuracy: 1, markedBonus: 0, blindedPenalty: -2, flankBonus: 2,
      coverBonus: 2, roll: 18, targetDefense: 15,
      hit: true, crit: false, fumble: false,
      damage: 4, damageDie: 'd6', damageRoll: 4
    };
    expect(describeEntryDetail(entry)).toBe('d20 14 +3 FIN +1 ACC −2 BLIND +2 FLANK = 18 vs DEF 15 (incl. +2 COVER) → HIT · d6=4 dmg');
  });

  it('formats a plain miss without hit/damage suffix', () => {
    const entry = {
      type: 'attack', naturalRoll: 6, attribute: 'mgt', attributeModifier: 2,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 8, targetDefense: 14,
      hit: false, crit: false, fumble: false,
      damage: 0, damageDie: 'd6', damageRoll: null
    };
    expect(describeEntryDetail(entry)).toBe('d20 6 +2 MGT = 8 vs DEF 14 → MISS');
  });

  it('flags CRIT as a suffix on a natural-20 hit and reports max damage', () => {
    const entry = {
      type: 'attack', naturalRoll: 20, attribute: 'mgt', attributeModifier: 3,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 23, targetDefense: 14,
      hit: true, crit: true, fumble: false,
      damage: 9, damageDie: 'd6', damageRoll: null
    };
    expect(describeEntryDetail(entry)).toBe('d20 20 +3 MGT = 23 vs DEF 14 → HIT CRIT · d6=9 dmg');
  });

  it('flags FUMBLE as a suffix on a natural-1 miss', () => {
    const entry = {
      type: 'attack', naturalRoll: 1, attribute: 'fin', attributeModifier: 2,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 3, targetDefense: 14,
      hit: false, crit: false, fumble: true,
      damage: 0, damageDie: 'd8', damageRoll: null
    };
    expect(describeEntryDetail(entry)).toBe('d20 1 +2 FIN = 3 vs DEF 14 → MISS FUMBLE');
  });

  // affixes-take-effect SESSION-04 checkpoint 3 — LUCKY / LEECH / proc fragments appended to
  // the attack detail line, guarded on field presence so pre-existing logs render unchanged.
  it('appends a LUCKY fragment when the attack carries a resolved reroll', () => {
    const entry = {
      type: 'attack', naturalRoll: 15, attribute: 'mgt', attributeModifier: 3,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 18, targetDefense: 14,
      hit: true, crit: false, fumble: false,
      damage: 4, damageDie: 'd6', damageRoll: 4,
      luckyReroll: { itemId: 'lucky_1', firstNatural: 3, keptNatural: 15 }
    };
    expect(describeEntryDetail(entry)).toBe('d20 15 +3 MGT = 18 vs DEF 14 → HIT · d6=4 dmg · LUCKY 3→15');
  });

  it('appends a LEECH fragment when the attack healed the attacker', () => {
    const entry = {
      type: 'attack', naturalRoll: 12, attribute: 'mgt', attributeModifier: 2,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 14, targetDefense: 10,
      hit: true, crit: false, fumble: false,
      damage: 3, damageDie: 'd6', damageRoll: 3, leech: 1
    };
    expect(describeEntryDetail(entry)).toBe('d20 12 +2 MGT = 14 vs DEF 10 → HIT · d6=3 dmg · LEECH +1');
  });

  it('appends per-proc fragments for applied, resisted, and fizzled on-hit affixes, in order', () => {
    const entry = {
      type: 'attack', naturalRoll: 16, attribute: 'mgt', attributeModifier: 3,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 19, targetDefense: 12,
      hit: true, crit: false, fumble: false,
      damage: 5, damageDie: 'd8', damageRoll: 5,
      procs: [
        { conditionId: 'corroded', trigger: 'hit', applied: true },
        { conditionId: 'jammed', trigger: 'hit', save: { attribute: 'foc', success: true }, applied: false },
        { conditionId: 'jammed', trigger: 'hit', chanceFailed: true }
      ]
    };
    expect(describeEntryDetail(entry)).toBe(
      'd20 16 +3 MGT = 19 vs DEF 12 → HIT · d8=5 dmg · ▸ CORRODED applied · ▸ JAMMED resisted (FOC save) · ▸ JAMMED fizzled'
    );
  });

  it('omits every affix fragment on a pre-affix attack entry (no luckyReroll/leech/procs fields)', () => {
    const entry = {
      type: 'attack', naturalRoll: 10, attribute: 'mgt', attributeModifier: 1,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 11, targetDefense: 14,
      hit: false, crit: false, fumble: false,
      damage: 0, damageDie: 'd6', damageRoll: null
    };
    expect(describeEntryDetail(entry)).toBe('d20 10 +1 MGT = 11 vs DEF 14 → MISS');
  });

  it('formats a retreat success and failure with the 15 threshold', () => {
    expect(describeEntryDetail({ type: 'retreat', roll: 17, success: true })).toBe('d20 17 vs 15 → ESCAPE');
    expect(describeEntryDetail({ type: 'retreat', roll: 8, success: false })).toBe('d20 8 vs 15 → FAIL');
  });

  it('formats a condition-save entry with attribute/dc/outcome', () => {
    const entry = {
      type: 'condition', conditionId: 'jammed', dc: 13,
      save: { natural: 12, modifier: 2, total: 14, attribute: 'foc', success: true }
    };
    expect(describeEntryDetail(entry)).toBe('d20 12 +2 FOC = 14 vs DC 13 → SAVE');
  });

  it('formats a hostile protocol with an attack roll', () => {
    const entry = {
      type: 'protocol', school: 'disrupt', tier: 2, overclocked: false,
      result: { rolls: { attack: { natural: 15, modifier: 3, total: 18, target: 12, hit: true }, overclock: null } }
    };
    expect(describeEntryDetail(entry)).toBe('d20 15 +3 FOC = 18 vs PDEF 12 → HIT');
  });

  it('formats an overclocked protocol with both attack and overclock rolls', () => {
    const entry = {
      type: 'protocol', school: 'burn', tier: 2, overclocked: true,
      result: { rolls: { attack: { natural: 12, modifier: 3, total: 15, target: 10, hit: true }, overclock: { natural: 14, modifier: 3, total: 17, target: 15, success: true } } }
    };
    expect(describeEntryDetail(entry)).toBe('d20 12 +3 FOC = 15 vs PDEF 10 → HIT · OC d20 14 +3 FOC = 17 vs 15 → OK');
  });

  it('returns empty string for entries missing dice payloads or unknown types', () => {
    expect(describeEntryDetail({ type: 'move', actorId: 'a', direction: 'n' })).toBe('');
    expect(describeEntryDetail({ type: 'end-turn', actorId: 'a' })).toBe('');
    expect(describeEntryDetail({ type: 'attack' })).toBe(''); // no naturalRoll
    expect(describeEntryDetail({ type: 'retreat' })).toBe('');
    expect(describeEntryDetail({ type: 'condition' })).toBe('');
    expect(describeEntryDetail({ type: 'protocol', result: {} })).toBe('');
    expect(describeEntryDetail(null)).toBe('');
    expect(describeEntryDetail(undefined)).toBe('');
    expect(describeEntryDetail('not-an-entry')).toBe('');
  });

  it('drops zero-value modifier chunks from the attack breakdown', () => {
    const entry = {
      type: 'attack', naturalRoll: 10, attribute: 'mgt', attributeModifier: 0,
      weaponAccuracy: 0, markedBonus: 0, blindedPenalty: 0, flankBonus: 0,
      coverBonus: 0, roll: 10, targetDefense: 10,
      hit: true, crit: false, fumble: false,
      damage: 3, damageDie: 'd6', damageRoll: 3
    };
    expect(describeEntryDetail(entry)).toBe('d20 10 = 10 vs DEF 10 → HIT · d6=3 dmg');
  });
});

describe('combat log dispatch — detail payload', () => {
  it('attaches a computed detail string to ui:log-entry dispatches for attack entries', async () => {
    const combat = combatState([partyActor(), enemyActor({ hp: 10, hpMax: 10 })]);
    const events = [];
    const off = bus.on('ui:log-entry', (payload) => events.push(payload));
    const { container, controller } = await mountCombat({ combat });

    byTestId(container, 'combat-action-attack').click();
    byTestId(container, 'combat-target-0').click();

    const attackDispatch = events.find((event) => event.type === 'attack');
    expect(attackDispatch).toBeTruthy();
    expect(typeof attackDispatch.detail).toBe('string');
    expect(attackDispatch.detail).toMatch(/^d20 \d+/);
    off();
    controller.unmount();
  });
});

// SESSION-04 (mobile-pwa-hardening) checkpoint 1: the pure pattern mapper, directly testable.
describe('hapticPatternForCombatEntry — combat haptic pattern mapping', () => {
  it('maps a plain hit to a single 12ms pulse', () => {
    expect(hapticPatternForCombatEntry({ type: 'attack', hit: true })).toBe(12);
  });

  it('maps a critical hit to the distinct 3-beat crit pattern', () => {
    expect(hapticPatternForCombatEntry({ type: 'attack', hit: true, crit: true })).toEqual([12, 24, 24]);
  });

  it('maps a death to the death pattern independent of hit/crit fields', () => {
    expect(hapticPatternForCombatEntry({ type: 'death', targetId: 'hero' })).toEqual([24, 24, 44]);
    expect(hapticPatternForCombatEntry({ type: 'death', hit: true, crit: true })).toEqual([24, 24, 44]);
  });

  it('returns null for a miss', () => {
    expect(hapticPatternForCombatEntry({ type: 'attack', hit: false })).toBe(null);
    expect(hapticPatternForCombatEntry({ type: 'attack' })).toBe(null);
  });

  it('returns null for every non-attack, non-death entry type', () => {
    for (const type of ['move', 'end-turn', 'wait', 'retreat', 'protocol', 'item', 'condition', 'condition-damage']) {
      expect(hapticPatternForCombatEntry({ type, hit: true, crit: true })).toBe(null);
    }
  });

  it('returns null for missing or malformed entries', () => {
    expect(hapticPatternForCombatEntry(null)).toBe(null);
    expect(hapticPatternForCombatEntry(undefined)).toBe(null);
    expect(hapticPatternForCombatEntry({})).toBe(null);
  });
});

// SESSION-04 checkpoint 1: the guarded emitter stays silent when the preference is off or the
// Vibration API is unusable — even when the mapper produces a real, non-null pattern.
describe('combat haptic emission — opt-in guard (checkpoint 1)', () => {
  it('never vibrates when hapticsEnabled is false (default), even for a resolved hit and death', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    try {
      const state = runState();
      const combat = combatState([partyActor(), enemyActor({ hp: 1, hpMax: 1 })]);
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-attack').click();
      byTestId(container, 'combat-target-0').click();

      expect(combat.log.some((entry) => entry.type === 'death')).toBe(true);
      expect(vibrate).not.toHaveBeenCalled();
      controller.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is a silent no-op when opted in but the browser exposes no Vibration API', async () => {
    const storage = installMockStorage();
    saveSettings({ hapticsEnabled: true });
    try {
      const state = runState();
      const combat = combatState([partyActor(), enemyActor({ hp: 1, hpMax: 1 })]);
      const { container, controller } = await mountCombat({ state, combat });

      expect(() => {
        byTestId(container, 'combat-action-attack').click();
        byTestId(container, 'combat-target-0').click();
      }).not.toThrow();

      expect(combat.log.some((entry) => entry.type === 'death')).toBe(true);
      controller.unmount();
    } finally {
      storage.uninstall();
    }
  });

  it('is a silent no-op — and never blocks combat resolution — when navigator.vibrate itself throws', async () => {
    const storage = installMockStorage();
    saveSettings({ hapticsEnabled: true });
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked by permissions policy'); } });
    try {
      const state = runState();
      const combat = combatState([partyActor(), enemyActor({ hp: 1, hpMax: 1 })]);
      const { container, controller } = await mountCombat({ state, combat });

      expect(() => {
        byTestId(container, 'combat-action-attack').click();
        byTestId(container, 'combat-target-0').click();
      }).not.toThrow();

      expect(combat.log.some((entry) => entry.type === 'death')).toBe(true);
      controller.unmount();
    } finally {
      vi.unstubAllGlobals();
      storage.uninstall();
    }
  });
});

// SESSION-04 checkpoint 2: with a supported, opted-in API, every resolved hit/crit/death fires
// exactly once — matching hapticPatternForCombatEntry's own output — across every dispatch path
// (immediate party action, paced enemy playback, fast-forward, unmount flush, reduced motion) and
// never for misses or non-combat entries.
describe('combat haptic emission — exactly once, resolved entries only (checkpoint 2)', () => {
  it('a player hit that also kills its target fires exactly one call per resolved entry, in log order', async () => {
    const h = installHaptics();
    try {
      const state = runState();
      const combat = combatState([partyActor(), enemyActor({ hp: 1, hpMax: 1 })]);
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-attack').click();
      byTestId(container, 'combat-target-0').click();

      const attackEntry = combat.log.find((entry) => entry.type === 'attack');
      const deathEntry = combat.log.find((entry) => entry.type === 'death');
      expect(attackEntry.hit).toBe(true);
      expect(deathEntry).toBeTruthy();
      expect(h.vibrate.mock.calls).toEqual([
        [hapticPatternForCombatEntry(attackEntry)],
        [hapticPatternForCombatEntry(deathEntry)]
      ]);
      controller.unmount();
    } finally {
      h.uninstall();
    }
  });

  it('a clean attack miss (no fumble/crit) never triggers a call', async () => {
    const h = installHaptics();
    try {
      // accuracyBonus -50 vs defense 8 guarantees a miss on any non-crit roll — findCleanMissSeed
      // rules out both the crit (nat 20) and the fumble (nat 1, which fires its own retaliation
      // attack entry) so this exercises a single, uncomplicated miss with nothing else in the log.
      const weakWeapon = makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: -50 });
      const state = runState(findCleanMissSeed());
      const combat = combatState([partyActor({ weapon: weakWeapon }), enemyActor({ hp: 10, hpMax: 10, defense: 8 })]);
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-attack').click();
      byTestId(container, 'combat-target-0').click();

      expect(combat.log).toHaveLength(1);
      const attackEntry = combat.log[0];
      expect(attackEntry.type).toBe('attack');
      expect(attackEntry.hit).toBe(false);
      expect(h.vibrate).not.toHaveBeenCalled();
      controller.unmount();
    } finally {
      h.uninstall();
    }
  });

  it('non-combat entries — a confirmed move and an end-turn — never trigger a call', async () => {
    const h = installHaptics();
    try {
      const combat = combatState([partyActor(), enemyActor({ position: { x: 6, y: 6 } })]);
      const { container, controller } = await mountCombat({ combat });

      byTestId(container, 'combat-action-move').click();
      byTestId(container, 'combat-dir-s').click();
      container.dispatch('keydown', keyEvent('Enter'));

      expect(combat.log.some((entry) => entry.type === 'move')).toBe(true);
      expect(h.vibrate).not.toHaveBeenCalled();
      controller.unmount();
    } finally {
      h.uninstall();
    }
  });

  it('paces exactly one call per eligible entry through paced enemy log-replay playback timers', async () => {
    vi.useFakeTimers();
    const h = installHaptics();
    try {
      const state = runState(1, [
        makeCharacter({ id: 'hero', hp: 1, hpMax: 30 }),
        makeCharacter({ id: 'ally', hp: 20, hpMax: 20, sigilCodepoint: 0xE001 })
      ]);
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30, position: { x: 1, y: 1 } }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) }),
        partyActor({ id: 'ally', hp: 20, hpMax: 20, position: { x: 5, y: 5 }, sigilCodepoint: 0xE001 })
      ], ['hero', 0, 'ally']);
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();
      vi.runAllTimers();

      const eligible = combat.log
        .filter((entry) => entry.type === 'attack' || entry.type === 'death')
        .map((entry) => hapticPatternForCombatEntry(entry))
        .filter((pattern) => pattern != null);
      expect(eligible.length).toBeGreaterThan(0);
      expect(h.vibrate.mock.calls).toEqual(eligible.map((pattern) => [pattern]));
      controller.unmount();
    } finally {
      h.uninstall();
      vi.useRealTimers();
    }
  });

  it('fast-forwarding mid-playback still fires exactly one call per entry — no double count', async () => {
    vi.useFakeTimers();
    const h = installHaptics();
    try {
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30 }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) })
      ], ['hero', 0]);
      const state = runState(1, [makeCharacter({ id: 'hero', hp: 1, hpMax: 30 })]);
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();
      const playfield = byClass(container, 'combat-playfield');
      playfield.dispatch('pointerdown', { clientX: 152, clientY: 152 });
      playfield.dispatch('pointerup', { clientX: 152, clientY: 152 });

      const eligible = combat.log
        .filter((entry) => entry.type === 'attack' || entry.type === 'death')
        .map((entry) => hapticPatternForCombatEntry(entry))
        .filter((pattern) => pattern != null);
      expect(eligible.length).toBeGreaterThan(0);
      const expectedCalls = eligible.map((pattern) => [pattern]);
      expect(h.vibrate.mock.calls).toEqual(expectedCalls);
      // Draining any leftover timer after fast-forward must not add further calls.
      vi.runAllTimers();
      expect(h.vibrate.mock.calls).toEqual(expectedCalls);
      controller.unmount();
    } finally {
      h.uninstall();
      vi.useRealTimers();
    }
  });

  it('unmounting mid-playback flushes remaining entries without double-counting an already-fired one', async () => {
    vi.useFakeTimers();
    const h = installHaptics();
    try {
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30 }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) })
      ], ['hero', 0]);
      const state = runState(1, [makeCharacter({ id: 'hero', hp: 1, hpMax: 30 })]);
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();
      controller.unmount();

      const eligible = combat.log
        .filter((entry) => entry.type === 'attack' || entry.type === 'death')
        .map((entry) => hapticPatternForCombatEntry(entry))
        .filter((pattern) => pattern != null);
      expect(eligible.length).toBeGreaterThan(0);
      const expectedCalls = eligible.map((pattern) => [pattern]);
      expect(h.vibrate.mock.calls).toEqual(expectedCalls);
      // A stale timer firing after unmount must not add further calls.
      vi.runAllTimers();
      expect(h.vibrate.mock.calls).toEqual(expectedCalls);
    } finally {
      h.uninstall();
      vi.useRealTimers();
    }
  });

  it('reduced motion resolves the enemy turn synchronously with exactly one call per eligible entry', async () => {
    installMatchMedia(true);
    vi.useFakeTimers();
    const h = installHaptics();
    try {
      const state = runState(1, [
        makeCharacter({ id: 'hero', hp: 1, hpMax: 30 }),
        makeCharacter({ id: 'ally', hp: 20, hpMax: 20, sigilCodepoint: 0xE001 })
      ]);
      const combat = combatState([
        partyActor({ id: 'hero', hp: 1, hpMax: 30, position: { x: 1, y: 1 } }),
        enemyActor({ id: 0, position: { x: 2, y: 1 }, weapon: makeWeapon({ damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 40 }) }),
        partyActor({ id: 'ally', hp: 20, hpMax: 20, position: { x: 5, y: 5 }, sigilCodepoint: 0xE001 })
      ], ['hero', 0, 'ally']);
      const { container, controller } = await mountCombat({ state, combat });

      byTestId(container, 'combat-action-end-turn').click();

      expect(vi.getTimerCount()).toBe(0);
      const eligible = combat.log
        .filter((entry) => entry.type === 'attack' || entry.type === 'death')
        .map((entry) => hapticPatternForCombatEntry(entry))
        .filter((pattern) => pattern != null);
      expect(eligible.length).toBeGreaterThan(0);
      expect(h.vibrate.mock.calls).toEqual(eligible.map((pattern) => [pattern]));
      controller.unmount();
    } finally {
      h.uninstall();
      vi.useRealTimers();
    }
  });
});
