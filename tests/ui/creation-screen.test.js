import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { blueprintFromDraft, saveConfig, setLastUsed } from '../../src/state/party-configs.js';
import { listRuns } from '../../src/state/library.js';
import { initEncoder } from '../../src/state/save-encode.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { loadData } from '../helpers/data.js';

const gameData = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
  protocols: loadData('protocols'),
  sigils: loadData('sigils'),
  themes: loadData('themes'),
  symbolTable: loadData('symbol-table')
};

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) {
    const next = force == null ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name); else this.values.delete(name);
    this.sync();
    return next;
  }
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
    this.style = {};
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = -1;
    this.parentNode = null;
  }
  set className(value) {
    this._className = String(value);
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
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
}

function installDocument() {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: () => null,
    documentElement: new FakeElement('html')
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

function allText(root) {
  return [root.textContent, ...(root.children || []).flatMap((child) => allText(child))].filter(Boolean);
}

function mountCreation(params = {}) {
  const container = new FakeElement('div');
  return import('../../src/ui/screens/creation.js').then(({ mount }) => ({ container, controller: mount(container, { data: gameData, ...params }) }));
}

function addBreacher(root) {
  byTestId(root, 'add-character').click();
  byTestId(root, 'class-breacher').click();
  byTestId(root, 'tab-sigil').click();
  byTestId(root, 'sigil-e000').click();
}

let storage;

beforeEach(() => {
  installDocument();
  storage = installMockStorage();
  initEncoder(gameData.symbolTable);
});

afterEach(() => {
  storage.uninstall();
  vi.useRealTimers();
  delete globalThis.requestAnimationFrame;
  delete globalThis.document;
});

describe('creation screen workflow', () => {
  it('matches the mock header, four-slot character rail, and tab frame', async () => {
    const { container, controller } = await mountCreation({ preloadedSeed: 123 });
    expect(byTestId(container, 'remaining').children[1].textContent).toBe('80/80');
    expect(byTestId(container, 'spent').textContent).toBe('SPENT 0/80');
    expect(byTestId(container, 'seed').textContent).toBe('SEED 123');
    expect(byTestId(container, 'creation-body').className).toContain('screen-body');
    expect(byTestId(container, 'empty-slot-3')).not.toBeNull();
    expect(byTestId(container, 'tab-attrs').textContent).toBe('ATTRS');
    expect(byTestId(container, 'tab-class').getAttribute('aria-selected')).toBe('true');

    addBreacher(container);

    expect(byTestId(container, 'spent').textContent).toBe('SPENT 5/80');
    expect(byTestId(container, 'remaining').children[1].textContent).toBe('75/80');
    expect(byTestId(container, 'credits').children[1].textContent).toBe('750');
    expect(byTestId(container, 'ap').children[1].textContent).toBe('1');
    expect(byTestId(container, 'character-slot-0').className).toContain('active');
    expect(byTestId(container, 'sigil-e000').children.some((child) => child.className.includes('sigil-220'))).toBe(true);
    byTestId(container, 'tab-class').click();
    expect(byTestId(container, 'selected-stats')).not.toBeNull();
    expect(byTestId(container, 'projected-hp').children[1].textContent).toBe('28');
    controller.unmount();
  });

  it('exposes gated gear and protocols with visible disabled reasons', async () => {
    const { container } = await mountCreation({ preloadedSeed: 321 });
    addBreacher(container);
    byTestId(container, 'tab-gear').click();

    expect(byTestId(container, 'weapon-sniper').disabled).toBe(true);
    expect(byTestId(container, 'weapon-sniper').getAttribute('aria-description')).toBe('class gate');
    byTestId(container, 'weapon-heavy_melee').click();
    byTestId(container, 'armor-heavy').click();
    byTestId(container, 'offhand-shield').click();
    expect(byTestId(container, 'spent').textContent).toBe('SPENT 13/80');

    byTestId(container, 'tab-tech').click();
    expect(byTestId(container, 'protocol-ward-1').disabled).toBe(true);
    expect(byTestId(container, 'protocol-disrupt-3').disabled).toBe(true);
    byTestId(container, 'protocol-disrupt-2').click();
    expect(byTestId(container, 'spent').textContent).toBe('SPENT 17/80');
    expect(byTestId(container, 'deck-summary').textContent).toContain('SLOTS USED 2 / 3');
  });

  it('loads last-used blueprints and requires overwrite confirmation', async () => {
    const draft = {
      characters: [{
        classId: 'ghost',
        sigil: 0xe008,
        attributes: { mgt: 3, fin: 3, vit: 3, res: 3, foc: 3, sig: 3 },
        equipment: { weapon: 'sniper', armor: 'light', offhand: null },
        protocols: []
      }]
    };
    const blueprint = blueprintFromDraft(draft, gameData, 'ghost cell');
    expect(saveConfig('ghost cell', blueprint)).toMatchObject({ success: true });
    expect(saveConfig('bad gate', { ...blueprint, name: 'bad gate', characters: [{ ...blueprint.characters[0], classId: 'breacher', sigilCodepoint: 0xe000, equipment: { weapon: 'sniper', armor: null, offhand: null } }] })).toMatchObject({ success: true });
    setLastUsed('ghost cell');

    const { container } = await mountCreation({ preloadedSeed: 99 });
    expect(allText(container)).toContain('LOADED LAST USED — ghost cell');
    expect(byTestId(container, 'saved-config-strip')).not.toBeNull();
    expect(byTestId(container, 'saved-strip-ghost cell')).not.toBeNull();
    byTestId(container, 'tab-blueprints').click();
    expect(byTestId(container, 'config-bad gate').className).toContain('invalid');

    byTestId(container, 'save-config').click();
    expect(allText(container).join(' ')).toContain('CONFIRM OVERWRITE — ghost cell');
    byTestId(container, 'save-config').click();
    expect(allText(container).join(' ')).toContain('SAVED CONFIG — ghost cell');
  });

  it('groups gear, tech, saved configurations, and footer actions like the mock', async () => {
    const { container } = await mountCreation({ preloadedSeed: 64 });
    addBreacher(container);
    byTestId(container, 'tab-gear').click();
    expect(byTestId(container, 'panel-gear').children.filter((child) => child.classList?.contains('gear-slot-group'))).toHaveLength(3);

    byTestId(container, 'tab-tech').click();
    expect(byTestId(container, 'deck-summary').textContent).toContain('SLOTS USED 0 / 3');
    expect(byTestId(container, 'saved-config-strip')).not.toBeNull();
    expect(byTestId(container, 'back').parentNode.className).toBe('creation-footer-row');
    expect(byTestId(container, 'finalize').parentNode).toBe(byTestId(container, 'back').parentNode);

    byTestId(container, 'open-blueprints').click();
    expect(byTestId(container, 'panel-blueprints')).not.toBeNull();
  });

  it('finalizes once into a persisted run and navigates with floor one', async () => {
    vi.useFakeTimers();
    globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { container } = await mountCreation({ preloadedSeed: 777, settings: { reducedMotion: 'reduce' } });
    addBreacher(container);

    byTestId(container, 'finalize').click();
    expect(byTestId(container, 'finalize').disabled).toBe(true);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ screen: 'exploration', params: { runState: expect.objectContaining({ worldSeed: 777, credits: 750 }), floor: expect.objectContaining({ floorSubSeed: expect.any(Number) }) } });
    expect(seen[0].params.runState.party[0]).toMatchObject({ sigilId: 'pua-e000', currentHP: 28, currentCHARGE: 9, protocolDeck: [] });
    expect(listRuns()).toHaveLength(1);
    byTestId(container, 'finalize')?.click();
    expect(seen).toHaveLength(1);
    off();
  });

  it('class-card buttons retain class-card and btn-crt classes after render', async () => {
    const { container } = await mountCreation({ preloadedSeed: 42 });
    byTestId(container, 'add-character').click();
    const card = byTestId(container, 'class-breacher');
    expect(card).not.toBeNull();
    expect(card.classList.contains('class-card')).toBe(true);
    expect(card.classList.contains('btn-crt')).toBe(true);
    const cardName = card.children.find((c) => c.classList?.contains('card-name'));
    expect(cardName).toBeTruthy();
    expect(cardName.textContent).toBe('BREACHER');
    const cardDetail = card.children.find((c) => c.classList?.contains('card-detail'));
    expect(cardDetail).toBeTruthy();
    expect(card.children.find((c) => c.classList?.contains('class-marker'))?.textContent).toBe('B');
    expect(byTestId(container, 'panel-class').children.find((c) => c.classList?.contains('class-card-row')).children).toHaveLength(6);

    byTestId(container, 'tab-attrs').click();
    expect(byTestId(container, 'attribute-mgt').style.minHeight).toBe('96px');
    expect(byTestId(container, 'attribute-mgt').getAttribute('aria-label')).toContain('MIGHT rank 3');
  });
});
