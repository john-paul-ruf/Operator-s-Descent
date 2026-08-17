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
  delete globalThis.window;
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

  it('hides class-gated gear and protocols while keeping legal options + resource-limited disables visible', async () => {
    const { container } = await mountCreation({ preloadedSeed: 321 });
    addBreacher(container);
    byTestId(container, 'tab-gear').click();

    // Never-choosable for breacher (class gate) — absent from DOM entirely.
    expect(byTestId(container, 'weapon-sniper')).toBeNull();
    expect(byTestId(container, 'weapon-heavy_ranged')).toBeNull();
    expect(byTestId(container, 'weapon-area_projector')).toBeNull();
    expect(byTestId(container, 'offhand-shield')).not.toBeNull(); // legal offhand for breacher

    // NONE rows always present.
    expect(byTestId(container, 'weapon-none')).not.toBeNull();
    expect(byTestId(container, 'armor-none')).not.toBeNull();
    expect(byTestId(container, 'offhand-none')).not.toBeNull();

    // Legal options present with dice/range detail chips appended.
    const heavyMelee = byTestId(container, 'weapon-heavy_melee');
    expect(heavyMelee).not.toBeNull();
    const meleeDetail = heavyMelee.children.find((child) => child.classList?.contains('card-detail'));
    expect(meleeDetail.textContent).toContain('ATK d20+MGT');
    expect(meleeDetail.textContent).toContain('DMG d10');

    byTestId(container, 'weapon-heavy_melee').click();
    byTestId(container, 'armor-heavy').click();
    byTestId(container, 'offhand-shield').click();
    expect(byTestId(container, 'spent').textContent).toBe('SPENT 13/80');

    byTestId(container, 'tab-tech').click();
    // Protocol filtering lands in checkpoint 2 — for now, class-gated protocols still render disabled.
    expect(byTestId(container, 'protocol-ward-1').disabled).toBe(true);
    expect(byTestId(container, 'protocol-disrupt-3').disabled).toBe(true);
    byTestId(container, 'protocol-disrupt-2').click();
    expect(byTestId(container, 'spent').textContent).toBe('SPENT 17/80');
    expect(byTestId(container, 'deck-summary').textContent).toContain('SLOTS USED 2 / 3');
  });

  it('re-renders legal gear/protocol lists when the class changes', async () => {
    const { container } = await mountCreation({ preloadedSeed: 424 });
    addBreacher(container);
    byTestId(container, 'tab-gear').click();
    // Baseline: breacher-legal.
    expect(byTestId(container, 'weapon-heavy_melee')).not.toBeNull();
    expect(byTestId(container, 'weapon-sniper')).toBeNull();

    // Switch to ghost — sniper becomes legal, heavy_melee falls out.
    byTestId(container, 'tab-class').click();
    byTestId(container, 'class-ghost').click();
    byTestId(container, 'tab-gear').click();
    expect(byTestId(container, 'weapon-sniper')).not.toBeNull();
    expect(byTestId(container, 'weapon-heavy_melee')).toBeNull();
    expect(byTestId(container, 'weapon-none')).not.toBeNull();
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

describe('creation screen — wide layout', () => {
  it('renders the two-pane shell with data-wide-root, readout, roster, and saved-configs list', async () => {
    installMatchMedia(true);
    const { container } = await mountCreation({ preloadedSeed: 555 });

    const shell = container.children[0];
    expect(shell.classList.contains('wide-creation-shell')).toBe(true);
    expect(shell.dataset.wideRoot).toBe('');
    expect(shell.dataset.testid).toBe('creation-root');

    const left = byTestId(container, 'wide-creation-left');
    const right = byTestId(container, 'wide-creation-right');
    const footer = byTestId(container, 'wide-creation-footer');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(byTestId(container, 'wide-editor')).not.toBeNull();
    expect(byTestId(container, 'wide-editor-empty')).not.toBeNull();

    const readout = byTestId(container, 'wide-readout');
    expect(readout).not.toBeNull();
    expect(readout.children).toHaveLength(3);
    expect(byTestId(container, 'remaining').children[1].textContent).toBe('80');
    const denom = byTestId(container, 'remaining').children[1].children[0];
    expect(denom.classList.contains('denom')).toBe(true);
    expect(denom.textContent).toBe('/80');
    expect(byTestId(container, 'credits').children[1].textContent).toBe('800');
    expect(byTestId(container, 'ap').children[1].textContent).toBe('0');
    expect(byTestId(container, 'ap').children[1].classList.contains('dim')).toBe(true);

    const roster = byTestId(container, 'wide-roster');
    expect(roster).not.toBeNull();
    expect(roster.children.find((c) => c.classList?.contains('wide-roster-row')).children).toHaveLength(4);
    expect(byTestId(container, 'add-character')).not.toBeNull();
    expect(byTestId(container, 'empty-slot-1')).not.toBeNull();
    expect(byTestId(container, 'empty-slot-3')).not.toBeNull();

    expect(byTestId(container, 'wide-saved-configs')).not.toBeNull();
    expect(byTestId(container, 'wide-save-slot')).not.toBeNull();
    expect(byTestId(container, 'wide-save-slot').disabled).toBe(true);

    expect(byTestId(container, 'back')).not.toBeNull();
    expect(byTestId(container, 'finalize')).not.toBeNull();
    expect(byTestId(container, 'finalize').disabled).toBe(true);
  });

  it('adding a character updates the wide readout and marks the slot active', async () => {
    installMatchMedia(true);
    const { container } = await mountCreation({ preloadedSeed: 42 });

    byTestId(container, 'add-character').click();
    const first = byTestId(container, 'character-slot-0');
    expect(first).not.toBeNull();
    expect(first.classList.contains('active')).toBe(true);
    // Chassis cost = 5, credits fall from 800 → 750.
    expect(byTestId(container, 'remaining').children[1].textContent).toBe('75');
    expect(byTestId(container, 'credits').children[1].textContent).toBe('750');
    expect(byTestId(container, 'ap').children[1].textContent).toBe('1');
    // Save slot enables now that we have a character.
    expect(byTestId(container, 'wide-save-slot').disabled).toBe(false);
  });

  it('renders CLASS, SIGIL, and ATTR sections stacked once a character is added', async () => {
    installMatchMedia(true);
    const { container } = await mountCreation({ preloadedSeed: 42 });

    // Empty state: only the empty placeholder in the editor.
    expect(byTestId(container, 'wide-editor-empty')).not.toBeNull();
    expect(byTestId(container, 'wide-section-class')).toBeNull();

    byTestId(container, 'add-character').click();

    // Editor now has three stacked wide-section blocks (CLASS, SIGIL, ATTR).
    const editor = byTestId(container, 'wide-editor');
    expect(editor).not.toBeNull();
    expect(byTestId(container, 'wide-editor-empty')).toBeNull();
    expect(byTestId(container, 'wide-section-class')).not.toBeNull();
    expect(byTestId(container, 'wide-section-sigil')).not.toBeNull();
    expect(byTestId(container, 'wide-section-attrs')).not.toBeNull();

    // CLASS: 6 chassis, none selected yet.
    const classSection = byTestId(container, 'wide-section-class');
    const grid = classSection.children.find((c) => c.classList?.contains('class-grid'));
    expect(grid.children).toHaveLength(6);
    expect(byTestId(container, 'wide-class-breacher')).not.toBeNull();
    expect(byTestId(container, 'wide-selected-stats')).toBeNull();

    // Select breacher — projected stats surface + class card marks selected.
    byTestId(container, 'wide-class-breacher').click();
    expect(byTestId(container, 'wide-class-breacher').classList.contains('selected')).toBe(true);
    expect(byTestId(container, 'wide-selected-stats')).not.toBeNull();
    expect(byTestId(container, 'wide-projected-hp').children[1].textContent).toBe('28');
    expect(byTestId(container, 'wide-projected-charge').children[1].textContent).toBe('9');

    // Spent updates identically to portrait chassis pricing.
    expect(byTestId(container, 'remaining').children[1].textContent).toBe('75');
    expect(byTestId(container, 'credits').children[1].textContent).toBe('750');
  });

  it('pick sigil in wide mode: preview and thumbs update via same dispatch as portrait', async () => {
    installMatchMedia(true);
    const { container } = await mountCreation({ preloadedSeed: 42 });
    byTestId(container, 'add-character').click();
    byTestId(container, 'wide-class-breacher').click();

    const preview = byTestId(container, 'wide-sigil-preview');
    expect(preview).not.toBeNull();
    expect(preview.textContent).toBe('?');
    expect(byTestId(container, 'wide-sigil-caption').textContent).toContain('SELECT A GLYPH');

    // 8 sigils per breacher family.
    const sigilThumb = byTestId(container, 'wide-sigil-e000');
    expect(sigilThumb).not.toBeNull();
    expect(sigilThumb.classList.contains('sigil-option')).toBe(true);

    sigilThumb.click();

    // Selection reflected across preview + thumb.
    expect(byTestId(container, 'wide-sigil-e000').classList.contains('selected')).toBe(true);
    expect(byTestId(container, 'wide-sigil-preview').textContent).toBe(String.fromCodePoint(0xe000));
    expect(byTestId(container, 'wide-sigil-caption').textContent).toBe('SIGIL-220 · e000');
  });

  it('wide attribute steppers mutate the model and readout like portrait', async () => {
    installMatchMedia(true);
    const { container } = await mountCreation({ preloadedSeed: 42 });
    byTestId(container, 'add-character').click();
    byTestId(container, 'wide-class-breacher').click();

    const attrGrid = byTestId(container, 'wide-section-attrs').children.find((c) => c.classList?.contains('attr-grid'));
    expect(attrGrid.children).toHaveLength(6);

    // Primary attribute row for breacher = MGT.
    const mgtRow = byTestId(container, 'wide-attribute-mgt');
    expect(mgtRow.classList.contains('primary')).toBe(true);
    const mgtHead = mgtRow.children.find((c) => c.classList?.contains('head'));
    const mgtName = mgtHead.children.find((c) => c.classList?.contains('name'));
    expect(mgtName.children[0].textContent).toBe('MIGHT');
    expect(mgtName.children[1].textContent).toBe('MGT · PRIMARY');

    // Baseline spent from chassis + primary=5 = 5+2 = 7 (breacher recipe applies).
    const spentBefore = byTestId(container, 'remaining').children[1].textContent;
    // FIN starts at 3, so bumping it costs 1 point.
    byTestId(container, 'wide-attribute-fin-inc').click();
    const spentAfter = byTestId(container, 'remaining').children[1].textContent;
    expect(Number(spentBefore) - Number(spentAfter)).toBe(1);
    // Refund brings it back.
    byTestId(container, 'wide-attribute-fin-dec').click();
    expect(byTestId(container, 'remaining').children[1].textContent).toBe(spentBefore);
  });

  it('renders saved configuration cards in the left pane sourced from party-configs.js', async () => {
    installMatchMedia(true);
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
    setLastUsed('ghost cell');

    const { container } = await mountCreation({ preloadedSeed: 12 });
    const card = byTestId(container, 'wide-saved-config-ghost cell');
    expect(card).not.toBeNull();
    expect(card.classList.contains('config-card')).toBe(true);
    expect(card.classList.contains('active')).toBe(true);
    expect(card.children.find((c) => c.classList?.contains('name')).textContent).toBe('ghost cell');
  });

  it('hides class-gated wide gear/tech options while keeping legal ones + gate note', async () => {
    installMatchMedia(true);
    const { container } = await mountCreation({ preloadedSeed: 42 });
    byTestId(container, 'add-character').click();
    byTestId(container, 'wide-class-breacher').click();

    // GEAR: 3 groups (weapon, armor, offhand), each with a NONE row + legal choices only.
    expect(byTestId(container, 'wide-section-gear')).not.toBeNull();
    expect(byTestId(container, 'wide-gear-weapon')).not.toBeNull();
    expect(byTestId(container, 'wide-gear-armor')).not.toBeNull();
    expect(byTestId(container, 'wide-gear-offhand')).not.toBeNull();
    expect(byTestId(container, 'wide-weapon-none')).not.toBeNull();
    expect(byTestId(container, 'wide-armor-none')).not.toBeNull();
    expect(byTestId(container, 'wide-offhand-none')).not.toBeNull();

    // Never-choosable for breacher — absent from DOM.
    expect(byTestId(container, 'wide-weapon-sniper')).toBeNull();
    expect(byTestId(container, 'wide-weapon-heavy_ranged')).toBeNull();
    expect(byTestId(container, 'wide-weapon-area_projector')).toBeNull();
    // Legal weapons present with chip suffix.
    const heavyMelee = byTestId(container, 'wide-weapon-heavy_melee');
    expect(heavyMelee).not.toBeNull();
    const stat = heavyMelee.children.find((c) => c.classList?.contains('info')).children.find((c) => c.classList?.contains('stat'));
    expect(stat.textContent).toContain('ATK d20+MGT');
    expect(stat.textContent).toContain('DMG d10');

    // Equip a valid weapon — selection + budget both update.
    const spentBefore = Number(byTestId(container, 'remaining').children[1].textContent);
    byTestId(container, 'wide-weapon-heavy_melee').click();
    expect(byTestId(container, 'wide-weapon-heavy_melee').classList.contains('selected')).toBe(true);
    const spentAfter = Number(byTestId(container, 'remaining').children[1].textContent);
    expect(spentBefore - spentAfter).toBeGreaterThan(0);

    // TECH: list present; protocol filtering lands in checkpoint 2 — class-gated protocols still render disabled here.
    expect(byTestId(container, 'wide-section-tech')).not.toBeNull();
    expect(byTestId(container, 'wide-tech-list')).not.toBeNull();
    const wardOne = byTestId(container, 'wide-protocol-ward-1');
    expect(wardOne).not.toBeNull();
    expect(wardOne.disabled).toBe(true);
    const disrupt3 = byTestId(container, 'wide-protocol-disrupt-3');
    expect(disrupt3.disabled).toBe(true);
    // Gate note references the breacher tier cap.
    expect(byTestId(container, 'wide-tech-gate-note').textContent).toContain('TIER ≤ 2');

    // Buy an in-gate protocol.
    const beforeTech = Number(byTestId(container, 'remaining').children[1].textContent);
    byTestId(container, 'wide-protocol-disrupt-2').click();
    expect(byTestId(container, 'wide-protocol-disrupt-2').classList.contains('selected')).toBe(true);
    expect(Number(byTestId(container, 'remaining').children[1].textContent)).toBeLessThan(beforeTech);
  });

  it('wide layout re-renders legal gear when class changes', async () => {
    installMatchMedia(true);
    const { container } = await mountCreation({ preloadedSeed: 909 });
    byTestId(container, 'add-character').click();
    byTestId(container, 'wide-class-breacher').click();
    expect(byTestId(container, 'wide-weapon-heavy_melee')).not.toBeNull();
    expect(byTestId(container, 'wide-weapon-sniper')).toBeNull();

    byTestId(container, 'wide-class-ghost').click();
    expect(byTestId(container, 'wide-weapon-sniper')).not.toBeNull();
    expect(byTestId(container, 'wide-weapon-heavy_melee')).toBeNull();
  });

  it('finalizes from the wide footer and navigates to exploration', async () => {
    installMatchMedia(true);
    vi.useFakeTimers();
    globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { container } = await mountCreation({ preloadedSeed: 4242, settings: { reducedMotion: 'reduce' } });

    // Build a valid breacher via wide controls: add character, pick class, pick sigil.
    byTestId(container, 'add-character').click();
    byTestId(container, 'wide-class-breacher').click();
    byTestId(container, 'wide-sigil-e000').click();

    // Wide footer surfaces the finalize button and it becomes enabled.
    const finalize = byTestId(container, 'finalize');
    expect(finalize).not.toBeNull();
    expect(finalize.parentNode.classList.contains('wide-creation-footer')).toBe(true);
    expect(finalize.disabled).toBe(false);

    finalize.click();
    expect(byTestId(container, 'finalize').disabled).toBe(true);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(seen).toHaveLength(1);
    expect(seen[0].screen).toBe('exploration');
    expect(seen[0].params.runState.worldSeed).toBe(4242);
    off();
  });
});
