import { beforeEach, describe, expect, test } from 'vitest';
import { createButton, createSigilToken, createSlider, createTextInput, createToggle } from '../../src/ui/components.js';

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
});
