import { beforeEach, describe, expect, test } from 'vitest';
import { createButton, createChargeBar, createEquipmentCard, createHPBar, createProtocolCard, createSigilToken, createSlider, createTextInput, createToggle } from '../../src/ui/components.js';

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
