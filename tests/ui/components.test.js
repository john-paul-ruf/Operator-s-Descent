import { beforeEach, describe, expect, test } from 'vitest';
import { createButton, createChargeBar, createEquipmentCard, createHPBar, createManualLink, createProtocolCard, createSigilToken, createSlider, createTextInput, createToggle, createUpdateToast } from '../../src/ui/components.js';

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
  }
  set className(value) { this._className = value; this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return this._className; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, ...event }); }
}

function installFakeDocument() {
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
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
