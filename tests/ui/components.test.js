import { beforeEach, describe, expect, test } from 'vitest';
import { createAffixTag, createButton, createChargeBar, createConditionTag, createEquipmentCard, createHPBar, createManualLink, createProtocolCard, createRarityTag, createSigilToken, createSlider, createTextInput, createToggle, createUpdateToast } from '../../src/ui/components.js';

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); this.sync(); }
  toggle(name, force) {
    const next = force == null ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name); else this.values.delete(name);
    this.sync();
    return next;
  }
  sync() { this.element._className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tagName, namespaceURI = null) {
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
  }
  set className(value) { this._className = value; this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  // SVG sprites created via createElementNS set their `class` attribute
  // through setAttribute (not the className setter). Read from attributes
  // when _className is empty so both paths agree.
  get className() { return this._className || this.attributes.get('class') || ''; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  // Prepend added for SESSION-06 icon support (createButton with opts.icon).
  prepend(...children) { this.children = [...children, ...this.children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setAttributeNS(_ns, name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, ...event }); }
  // Models the DOM `HTMLElement.click()` API, which browsers invoke when the
  // user activates a focused <button> via Enter/Space. Fires click listeners
  // unless the element is disabled — matches native semantics.
  click() { if (this.disabled) return; this.dispatch('click'); }
}

function installFakeDocument() {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (ns, tagName) => new FakeElement(tagName, ns)
  };
}

beforeEach(() => installFakeDocument());

describe('semantic components', () => {
  test('buttons are native controls with accessible state and cleanup', () => {
    let clicked = 0;
    const button = createButton('Start', { onClick: () => clicked += 1, selected: true, busy: true });

    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-selected')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');

    button.dispatch('click');
    button.cleanup();
    button.dispatch('click');
    expect(clicked).toBe(1);
  });

  test('primary buttons and meters expose mock-compatible classes', () => {
    expect(createButton('Confirm', { primary: true }).className).toBe('btn-crt btn-primary primary is-interactive');
    expect(createHPBar(3, 10).children[1].children[0].className).toContain('bar-fill-danger');
    expect(createChargeBar(3, 10).children[1].children[0].className).toContain('bar-fill-charge');
  });

  test('toggles, ranges, and text entry use labelled native inputs', () => {
    const toggle = createToggle('Glitch', false, () => {});
    const slider = createSlider('Volume', 25, () => {});
    const text = createTextInput('Import', '', () => {});

    expect(toggle.tagName).toBe('LABEL');
    expect(toggle.children[1].tagName).toBe('INPUT');
    expect(toggle.children[1].type).toBe('checkbox');
    expect(toggle.children[1].getAttribute('role')).toBe('switch');
    expect(slider.tagName).toBe('LABEL');
    expect(slider.children[1].type).toBe('range');
    expect(text.children[1].tagName).toBe('INPUT');
  });

  test('sigil tokens enforce fixed sizes and bank roles', () => {
    expect(createSigilToken(0xE000, 34, { role: 'player' }).className).toContain('sigil-34');
    expect(createSigilToken(0xE030, 220, { role: 'enemy' }).className).toContain('sigil-220');
    expect(() => createSigilToken(0xE030, 34, { role: 'player' })).toThrow(/invalid-player-bank/);
    expect(() => createSigilToken(0xE000, 35, { role: 'player' })).toThrow(/invalid-size/);
  });

  test('equipment cards render the display name and an optional description', () => {
    const bare = createEquipmentCard({ id: 'sidearm-1', name: 'Sidearm' });
    expect(bare.children[0].className).toBe('card-name');
    expect(bare.children[0].textContent).toBe('Sidearm');
    expect(bare.children.find((child) => child.className === 'card-desc')).toBeUndefined();

    const described = createEquipmentCard({ id: 'sidearm-1', name: 'Sidearm', description: 'd6 dmg · adjacent range · +1 acc · scrap 1' });
    const desc = described.children.find((child) => child.className === 'card-desc');
    expect(desc).toBeTruthy();
    expect(desc.textContent).toBe('d6 dmg · adjacent range · +1 acc · scrap 1');

    const idOnly = createEquipmentCard({ id: 'breacher-1-weapon-sidearm' });
    expect(idOnly.children[0].textContent).toBe('breacher-1-weapon-sidearm');
  });

  test('equipment cards render a stats chip row in order when opts.stats is provided', () => {
    const withStats = createEquipmentCard(
      { id: 'sidearm-1', name: 'Sidearm' },
      { stats: ['ATK d20+1+MGT', 'DMG d8↑', 'RANGE 1–1 · ADJACENT'] }
    );
    const statsRow = withStats.children.find((child) => child.className === 'card-stats');
    expect(statsRow).toBeTruthy();
    expect(statsRow.children.map((chip) => chip.className)).toEqual(['stat-chip', 'stat-chip', 'stat-chip']);
    expect(statsRow.children.map((chip) => chip.textContent)).toEqual(['ATK d20+1+MGT', 'DMG d8↑', 'RANGE 1–1 · ADJACENT']);

    const bare = createEquipmentCard({ id: 'sidearm-1', name: 'Sidearm' });
    expect(bare.children.find((child) => child.className === 'card-stats')).toBeUndefined();

    const emptyStats = createEquipmentCard({ id: 'sidearm-1', name: 'Sidearm' }, { stats: [] });
    expect(emptyStats.children.find((child) => child.className === 'card-stats')).toBeUndefined();
  });

  test('interactive factories tag their output with the .is-interactive affordance class', () => {
    const button = createButton('Start', { onClick: () => {} });
    expect(button.classList.values.has('is-interactive')).toBe(true);

    const slider = createSlider('Volume', 50, () => {});
    expect(slider.children[1].classList.values.has('is-interactive')).toBe(true);

    const toggle = createToggle('Glitch', false, () => {});
    expect(toggle.children[2].classList.values.has('is-interactive')).toBe(true);

    const clickableCard = createEquipmentCard({ id: 'sidearm-1', name: 'Sidearm' }, { onClick: () => {} });
    expect(clickableCard.classList.values.has('is-interactive')).toBe(true);

    const clickableProtocol = createProtocolCard({ id: 'purge', name: 'PURGE' }, { onClick: () => {} });
    expect(clickableProtocol.classList.values.has('is-interactive')).toBe(true);
  });

  test('static factory variants (article cards, no onClick) omit the .is-interactive class', () => {
    const staticCard = createEquipmentCard({ id: 'sidearm-1', name: 'Sidearm' });
    expect(staticCard.tagName).toBe('ARTICLE');
    expect(staticCard.classList.values.has('is-interactive')).toBe(false);

    const staticProtocol = createProtocolCard({ id: 'purge', name: 'PURGE' });
    expect(staticProtocol.tagName).toBe('ARTICLE');
    expect(staticProtocol.classList.values.has('is-interactive')).toBe(false);
  });

  test('createUpdateToast renders a testid-marked reload button that fires onReload once and cleans up', () => {
    let reloaded = 0;
    const toast = createUpdateToast({ onReload: () => { reloaded += 1; } });

    expect(toast.tagName).toBe('DIV');
    expect(toast.className).toBe('update-toast');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.dataset.testid).toBe('update-toast');

    const label = toast.children.find((child) => child.className === 'update-toast-label');
    expect(label).toBeTruthy();
    expect(label.textContent).toBe('NEW BUILD CACHED');

    const button = toast.children.find((child) => child.dataset?.testid === 'update-toast-reload');
    expect(button).toBeTruthy();
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('RELOAD');
    expect(button.getAttribute('aria-label')).toBe('Reload to apply the new build');

    button.dispatch('click');
    expect(reloaded).toBe(1);

    toast.cleanup();
    button.dispatch('click');
    expect(reloaded).toBe(1);
  });

  test('createUpdateToast without an onReload handler still renders and no-ops on click', () => {
    const toast = createUpdateToast();
    const button = toast.children.find((child) => child.dataset?.testid === 'update-toast-reload');
    expect(() => button.dispatch('click')).not.toThrow();
    expect(() => toast.cleanup?.()).not.toThrow();
  });

  test('createManualLink renders a button that dispatches ui:manual-open with target and source', () => {
    const dispatched = [];
    const link = createManualLink('burning', {
      label: 'Burning',
      source: 'party',
      dispatch: (event, payload) => dispatched.push([event, payload])
    });

    expect(link.tagName).toBe('BUTTON');
    expect(link.type).toBe('button');
    expect(link.className).toBe('manual-term-link is-interactive');
    expect(link.textContent).toBe('Burning');
    expect(link.getAttribute('aria-label')).toBe('Open manual: Burning');
    expect(link.getAttribute('data-manual-target')).toBe('burning');
    expect(link.dataset.testid).toBe('manual-link-burning');

    link.dispatch('click');
    expect(dispatched).toEqual([['ui:manual-open', { target: 'burning', source: 'party' }]]);

    link.cleanup();
    link.dispatch('click');
    expect(dispatched.length).toBe(1);
  });

  test('createManualLink with a null target opens the table of contents', () => {
    const dispatched = [];
    const link = createManualLink(null, {
      label: 'Manual',
      source: 'title',
      dispatch: (event, payload) => dispatched.push([event, payload])
    });
    expect(link.getAttribute('data-manual-target')).toBe('');
    expect(link.dataset.testid).toBe('manual-link-toc');
    expect(link.getAttribute('aria-label')).toBe('Open manual: Manual');

    link.dispatch('click');
    expect(dispatched).toEqual([['ui:manual-open', { target: null, source: 'title' }]]);
  });

  test('createManualLink chip variant carries the chip class and defaults its label to ?', () => {
    const link = createManualLink('mgt', { variant: 'chip', dispatch: () => {} });
    expect(link.className).toBe('manual-term-link manual-term-link--chip is-interactive');
    expect(link.textContent).toBe('?');
    expect(link.getAttribute('aria-label')).toBe('Open manual: mgt');
  });

  test('createManualLink without a dispatch handler is aria-disabled and click is a no-op', () => {
    const link = createManualLink('burning');
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.disabled).toBeUndefined();
    expect(() => link.dispatch('click')).not.toThrow();
    expect(() => link.cleanup?.()).not.toThrow();
  });

  test('createManualLink defaults source to "ui" when the caller omits it', () => {
    const dispatched = [];
    const link = createManualLink('affixes', { dispatch: (event, payload) => dispatched.push([event, payload]) });
    link.dispatch('click');
    expect(dispatched).toEqual([['ui:manual-open', { target: 'affixes', source: 'ui' }]]);
  });

  test('createManualLink with opts.disabled sets disabled AND aria-disabled and does not dispatch', () => {
    const dispatched = [];
    const link = createManualLink('burning', {
      dispatch: (event, payload) => dispatched.push([event, payload]),
      disabled: true
    });
    expect(link.disabled).toBe(true);
    expect(link.getAttribute('aria-disabled')).toBe('true');
    link.dispatch('click');
    expect(dispatched).toEqual([]);
  });

  test('createManualLink applies describedBy and testid overrides', () => {
    const linkWithDesc = createManualLink('burning', {
      dispatch: () => {},
      describedBy: 'burning-help'
    });
    expect(linkWithDesc.getAttribute('aria-describedby')).toBe('burning-help');

    const linkWithCustomTestid = createManualLink('burning', {
      dispatch: () => {},
      testid: 'custom-id'
    });
    expect(linkWithCustomTestid.dataset.testid).toBe('custom-id');

    const linkNoTestid = createManualLink('burning', { dispatch: () => {}, testid: false });
    expect(linkNoTestid.dataset.testid).toBeUndefined();
  });

  test('createManualLink defaults its label to the target id when no label supplied', () => {
    const link = createManualLink('mgt', { dispatch: () => {} });
    expect(link.textContent).toBe('mgt');
    expect(link.getAttribute('aria-label')).toBe('Open manual: mgt');
  });

  test('createManualLink does not throw when constructed under the jsdom-baseline FakeDocument', () => {
    expect(() => {
      const link = createManualLink(null, { variant: 'chip', dispatch: () => {} });
      link.cleanup?.();
    }).not.toThrow();
  });

  test('createConditionTag without opts renders a plain span carrying condition classes', () => {
    // SESSION-06 amended this factory to prepend a lucide icon for known
    // condition ids — text, tagName, and cond-<id> class remain stable so
    // downstream selectors still resolve. See has-icon coverage below.
    const tag = createConditionTag('burning', 3);
    expect(tag.tagName).toBe('SPAN');
    expect(tag.classList.values.has('condition-tag')).toBe(true);
    expect(tag.classList.values.has('cond-burning')).toBe(true);
    expect(tag.textContent).toBe('burning (3)');

    const noDuration = createConditionTag('jammed');
    expect(noDuration.tagName).toBe('SPAN');
    expect(noDuration.classList.values.has('condition-tag')).toBe(true);
    expect(noDuration.classList.values.has('cond-jammed')).toBe(true);
    expect(noDuration.textContent).toBe('jammed');
  });

  test('createConditionTag with opts.manualLink returns a dispatching button and keeps existing classes', () => {
    const dispatched = [];
    const tag = createConditionTag('burning', 3, {
      manualLink: { source: 'party', dispatch: (event, payload) => dispatched.push([event, payload]) }
    });
    expect(tag.tagName).toBe('BUTTON');
    expect(tag.type).toBe('button');
    expect(tag.classList.values.has('condition-tag')).toBe(true);
    expect(tag.classList.values.has('cond-burning')).toBe(true);
    expect(tag.classList.values.has('manual-term-link')).toBe(true);
    expect(tag.classList.values.has('is-interactive')).toBe(true);
    expect(tag.textContent).toBe('burning (3)');
    expect(tag.dataset.testid).toBe('manual-link-burning');
    expect(tag.getAttribute('data-manual-target')).toBe('burning');
    tag.dispatch('click');
    expect(dispatched).toEqual([['ui:manual-open', { target: 'burning', source: 'party' }]]);
  });

  test('createRarityTag without opts renders the byte-identical plain span', () => {
    const tag = createRarityTag('Tuned');
    expect(tag.tagName).toBe('SPAN');
    expect(tag.className).toBe('rarity-tag');
    expect(tag.textContent).toBe('Tuned');
    expect(tag.style.color).toBe('#2ed4c1');
  });

  test('createRarityTag with opts.manualLink defaults its target to rarity_<lower> and preserves the color style', () => {
    const dispatched = [];
    const tag = createRarityTag('Custom', {
      manualLink: { source: 'loot', dispatch: (event, payload) => dispatched.push([event, payload]) }
    });
    expect(tag.tagName).toBe('BUTTON');
    expect(tag.classList.values.has('rarity-tag')).toBe(true);
    expect(tag.classList.values.has('manual-term-link')).toBe(true);
    expect(tag.textContent).toBe('Custom');
    expect(tag.style.color).toBe('#e8c63a');
    expect(tag.dataset.testid).toBe('manual-link-rarity_custom');
    tag.dispatch('click');
    expect(dispatched).toEqual([['ui:manual-open', { target: 'rarity_custom', source: 'loot' }]]);
  });

  test('createAffixTag without opts renders the byte-identical plain span', () => {
    const minor = createAffixTag({ id: 'sharp', name: 'Sharp' }, false);
    expect(minor.tagName).toBe('SPAN');
    expect(minor.className).toBe('affix-tag');
    expect(minor.textContent).toBe('Sharp');

    const major = createAffixTag({ id: 'lucky', name: 'Lucky' }, true);
    expect(major.tagName).toBe('SPAN');
    expect(major.className).toBe('affix-tag affix-major');
  });

  test('createAffixTag with opts.manualLink defaults its target to "affixes" and preserves major class', () => {
    const dispatched = [];
    const tag = createAffixTag({ id: 'lucky', name: 'Lucky' }, true, {
      manualLink: { source: 'gear', dispatch: (event, payload) => dispatched.push([event, payload]) }
    });
    expect(tag.tagName).toBe('BUTTON');
    expect(tag.classList.values.has('affix-tag')).toBe(true);
    expect(tag.classList.values.has('affix-major')).toBe(true);
    expect(tag.classList.values.has('manual-term-link')).toBe(true);
    expect(tag.dataset.testid).toBe('manual-link-affixes');
    tag.dispatch('click');
    expect(dispatched).toEqual([['ui:manual-open', { target: 'affixes', source: 'gear' }]]);
  });

  test('nested-interactive rule: equipment cards embed only <span> tags — no manual link inside the button host', () => {
    const equipCard = createEquipmentCard(
      {
        id: 'sidearm-1',
        name: 'Sidearm',
        rarity: 'Tuned',
        affixes: [{ id: 'sharp', name: 'Sharp', category: 'minor' }, { id: 'lucky', name: 'Lucky', category: 'major' }]
      },
      { onClick: () => {} }
    );
    expect(equipCard.tagName).toBe('BUTTON');
    for (const child of equipCard.children) {
      expect(child.tagName).not.toBe('BUTTON');
    }
    const rarity = equipCard.children.find((child) => child.className === 'rarity-tag');
    expect(rarity?.tagName).toBe('SPAN');
    const affixes = equipCard.children.filter((child) => String(child.className).includes('affix-tag'));
    expect(affixes.length).toBe(2);
    for (const affix of affixes) expect(affix.tagName).toBe('SPAN');
  });

  test('createManualLink keyboard activation: browser-invoked .click() fires the dispatch handler', () => {
    // Native <button> elements fire click when the focused user presses Enter
    // or Space — the browser routes that keypress through element.click().
    // This test models that path by calling .click() directly.
    const dispatched = [];
    const link = createManualLink('mgt', { dispatch: (event, payload) => dispatched.push([event, payload]) });
    link.click();
    expect(dispatched).toEqual([['ui:manual-open', { target: 'mgt', source: 'ui' }]]);

    const inertLink = createManualLink('mgt', { dispatch: () => {}, disabled: true });
    inertLink.click();  // native disabled buttons swallow the click
    expect(inertLink.disabled).toBe(true);
  });

  test('createManualLink aria-label shape covers every (label, target) combination', () => {
    const withLabelAndTarget = createManualLink('burning', { label: 'Burning', dispatch: () => {} });
    expect(withLabelAndTarget.getAttribute('aria-label')).toBe('Open manual: Burning');

    const targetOnly = createManualLink('burning', { dispatch: () => {} });
    expect(targetOnly.getAttribute('aria-label')).toBe('Open manual: burning');

    const labelOnly = createManualLink(null, { label: 'Manual', dispatch: () => {} });
    expect(labelOnly.getAttribute('aria-label')).toBe('Open manual: Manual');

    const neither = createManualLink(null, { dispatch: () => {} });
    expect(neither.getAttribute('aria-label')).toBe('Open manual: contents');
  });

  test('createManualLink chip variant exposes the hit-target class for CSS sizing', () => {
    const chip = createManualLink('affixes', { variant: 'chip', dispatch: () => {} });
    expect(chip.classList.values.has('manual-term-link')).toBe(true);
    expect(chip.classList.values.has('manual-term-link--chip')).toBe(true);
    expect(chip.classList.values.has('is-interactive')).toBe(true);
  });

  test('nested-interactive rule: protocol cards embed only <span>/<div> tags — no manual link inside the button host', () => {
    const protocolCard = createProtocolCard(
      { id: 'purge', name: 'PURGE', school: 'disrupt', chargeCost: 2 },
      { onClick: () => {} }
    );
    expect(protocolCard.tagName).toBe('BUTTON');
    for (const child of protocolCard.children) {
      expect(child.tagName).not.toBe('BUTTON');
    }
  });

  // combat-and-overworld-clarity-pass SESSION-06 — icon prefix API on
  // createButton, createManualLink, and createConditionTag. Backwards-
  // compatible defaults: opts.icon absent → DOM identical to prior sessions.
  test('createButton without opts.icon renders identical DOM to prior sessions (no icon child, no has-icon class)', () => {
    const bare = createButton('Start');
    expect(bare.children).toEqual([]);
    expect(bare.classList.values.has('has-icon')).toBe(false);
    expect(bare.className).toBe('btn-crt is-interactive');
  });

  test('createButton with opts.icon prepends a <svg class="icon icon-16"> child and adds has-icon', () => {
    const button = createButton('Confirm', { icon: 'sword' });
    expect(button.classList.values.has('has-icon')).toBe(true);
    expect(button.children).toHaveLength(1);
    const svg = button.children[0];
    expect(svg.tagName).toBe('SVG');
    expect(svg.className).toBe('icon icon-16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    // The label survives on the button; textContent is set before the icon
    // prepend, so the fake-DOM assertion mirrors the real-DOM text-node order.
    expect(button.textContent).toBe('Confirm');
  });

  test('createButton opts.iconSize and opts.iconTone are reflected on the sprite classes', () => {
    const button = createButton('Attack', { icon: 'sword', iconSize: 20, iconTone: 'danger' });
    const svg = button.children[0];
    expect(svg.className).toBe('icon icon-20 icon-danger');
  });

  test('createButton clamps unknown iconSize back to the 16px default and drops unknown tones', () => {
    const button = createButton('Attack', { icon: 'sword', iconSize: 99, iconTone: 'rainbow' });
    expect(button.children[0].className).toBe('icon icon-16');
  });

  test('createButton with opts.icon still fires onClick and cleans up its listener', () => {
    let clicks = 0;
    const button = createButton('Fire', { icon: 'zap', onClick: () => { clicks += 1; } });
    button.click();
    expect(clicks).toBe(1);
    button.cleanup();
    button.click();
    expect(clicks).toBe(1);
  });

  test('createButton with opts.icon plus opts.disabled retains disabled semantics: click does not fire', () => {
    let clicks = 0;
    const button = createButton('Fire', { icon: 'zap', onClick: () => { clicks += 1; }, disabled: true });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click(); // FakeElement.click() no-ops when disabled, mirroring native <button>
    expect(clicks).toBe(0);
  });

  test('createManualLink with opts.icon prepends the sprite before the label', () => {
    const link = createManualLink('burning', { icon: 'flame', dispatch: () => {} });
    expect(link.classList.values.has('has-icon')).toBe(true);
    expect(link.children).toHaveLength(1);
    expect(link.children[0].tagName).toBe('SVG');
    expect(link.children[0].className).toBe('icon icon-16');
  });

  test('createManualLink without opts.icon has no sprite child (byte-identical prior behaviour)', () => {
    const link = createManualLink('burning', { dispatch: () => {} });
    expect(link.children).toEqual([]);
    expect(link.classList.values.has('has-icon')).toBe(false);
  });

  test('createConditionTag prepends the mapped sprite for known conditions and adds has-icon', () => {
    const tag = createConditionTag('burning', 3);
    expect(tag.tagName).toBe('SPAN');
    expect(tag.classList.values.has('has-icon')).toBe(true);
    expect(tag.children).toHaveLength(1);
    expect(tag.children[0].tagName).toBe('SVG');
    expect(tag.children[0].className).toBe('icon icon-14');
    // Text still reads exactly as before the prefix.
    expect(tag.textContent).toBe('burning (3)');
  });

  test('createConditionTag for unmapped conditions renders no icon child (safe fallthrough)', () => {
    const tag = createConditionTag('unknown-condition');
    expect(tag.classList.values.has('has-icon')).toBe(false);
    expect(tag.children).toEqual([]);
  });

  test('createConditionTag icon map covers every session-06 condition id', () => {
    const cases = [
      ['burning', 'icon-14'],
      ['jammed', 'icon-14'],
      ['shielded', 'icon-14'],
      ['marked', 'icon-14'],
      ['panicked', 'icon-14'],
      ['immobilized', 'icon-14'],
      ['overloaded', 'icon-14'],
      ['drained', 'icon-14'],
      ['blinded', 'icon-14']
    ];
    for (const [id] of cases) {
      const tag = createConditionTag(id);
      expect(tag.classList.values.has('has-icon'), `${id} has-icon`).toBe(true);
      expect(tag.children[0].tagName).toBe('SVG');
    }
  });

  test('createConditionTag with opts.manualLink returns a dispatching button that keeps its icon prefix', () => {
    const dispatched = [];
    const tag = createConditionTag('shielded', 2, {
      manualLink: { source: 'party-condition', dispatch: (event, payload) => dispatched.push([event, payload]) }
    });
    expect(tag.tagName).toBe('BUTTON');
    expect(tag.classList.values.has('condition-tag')).toBe(true);
    expect(tag.classList.values.has('cond-shielded')).toBe(true);
    expect(tag.classList.values.has('manual-term-link')).toBe(true);
    expect(tag.classList.values.has('has-icon')).toBe(true);
    expect(tag.children[0].tagName).toBe('SVG');
    tag.dispatch('click');
    expect(dispatched).toEqual([['ui:manual-open', { target: 'shielded', source: 'party-condition' }]]);
  });

  test('disabled controls carry aria-disabled and .is-interactive simultaneously', () => {
    const disabledButton = createButton('Locked', { onClick: () => {}, disabled: true });
    expect(disabledButton.classList.values.has('is-interactive')).toBe(true);
    expect(disabledButton.disabled).toBe(true);
    expect(disabledButton.getAttribute('aria-disabled')).toBe('true');

    const disabledSlider = createSlider('Muted', 0, () => {}, { disabled: true });
    const rangeInput = disabledSlider.children[1];
    expect(rangeInput.classList.values.has('is-interactive')).toBe(true);
    expect(rangeInput.disabled).toBe(true);
    expect(rangeInput.getAttribute('aria-disabled')).toBe('true');

    const disabledToggle = createToggle('Off', false, () => {}, { disabled: true });
    const visual = disabledToggle.children[2];
    expect(visual.classList.values.has('is-interactive')).toBe(true);
    expect(visual.getAttribute('aria-disabled')).toBe('true');
  });
});
