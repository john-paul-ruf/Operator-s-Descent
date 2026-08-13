import { beforeEach, describe, expect, test } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { createConsole } from '../../src/ui/console/console.js';
import { createInputHandler } from '../../src/ui/input.js';

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) { const next = force == null ? !this.values.has(name) : Boolean(force); if (next) this.values.add(name); else this.values.delete(name); this.sync(); return next; }
  contains(name) { return this.values.has(name); }
  sync() { this.element.className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
    this.className = '';
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.tabIndex = -1;
    this.hidden = false;
    this.parentNode = null;
    this.innerHTML = '';
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, ...event }); }
  focus() { this.focused = true; }
}

beforeEach(() => {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => { const node = new FakeElement('#text'); node.textContent = text; return node; }
  };
});

describe('console shell', () => {
  test('keeps one active mode and blocks unavailable tabs with a notice', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000, name: 'A' }] } });
    const root = consoleShell.render();

    expect(consoleShell.currentMode).toBe('move');
    expect(consoleShell.setMode('combat')).toBe(false);
    expect(root.children[3].textContent).toBe('No active combat.');
    expect(root.children[1].children[1].disabled).toBe(true);
    expect(root.children[1].children.map((tab) => tab.textContent)).toEqual(['MOVE', 'CMBT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG']);
    expect(root.children[1].children[0].getAttribute('aria-selected')).toBe('true');
    expect(root.children[1].children[1].classList.contains('disabled')).toBe(true);
    expect(root.children[2].className).toContain('scroll-area');
    expect(root.getAttribute('aria-expanded')).toBe('false');
  });

  test('switching modes destroys previous content and focuses the mode panel', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000, name: 'A' }], inventory: [] } });
    const root = consoleShell.render();
    const content = root.children[2];
    const firstRenderChildren = content.children;

    expect(consoleShell.setMode('party')).toBe(true);

    expect(consoleShell.currentMode).toBe('party');
    expect(content.focused).toBe(true);
    expect(content.children).not.toBe(firstRenderChildren);
    expect(root.children[1].children[2].getAttribute('aria-selected')).toBe('true');
  });

  test('console input context handles mode shortcuts tab and cancel teardown', () => {
    const inputHandler = createInputHandler({ legacyActions: false });
    const consoleShell = createConsole({ inputHandler, runState: { party: [{ sigilCodepoint: 0xE000 }], inventory: [] } });
    consoleShell.render();
    consoleShell.expand();
    expect(consoleShell.container.getAttribute('aria-expanded')).toBe('true');
    expect(consoleShell.container.children[2].getAttribute('aria-hidden')).toBe('false');

    inputHandler.triggerAction('mode_3');
    expect(consoleShell.currentMode).toBe('party');
    inputHandler.triggerAction('tab_next');
    expect(consoleShell.currentMode).toBe('gear');
    inputHandler.triggerAction('cancel');
    expect(consoleShell.expanded).toBe(false);
    expect(consoleShell.container.children[2].getAttribute('aria-hidden')).toBe('true');
    consoleShell.destroy();
    inputHandler.triggerAction('mode_7');
    expect(consoleShell.currentMode).toBe('gear');
  });

  test('emits fixed-geometry camera and console events on expansion', () => {
    const seen = [];
    const offExpand = bus.on('console:expand', (payload) => seen.push(['expand', payload.mode]));
    const offCamera = bus.on('ui:camera-request', (payload) => seen.push(['camera', payload.reason]));
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000 }] } });
    consoleShell.render();

    consoleShell.expand();
    consoleShell.collapse();

    expect(seen).toEqual([['expand', 'move'], ['camera', 'console-expand']]);
    expect(consoleShell.expanded).toBe(false);
    offExpand();
    offCamera();
  });
});
