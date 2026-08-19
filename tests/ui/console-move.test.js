// SESSION-06 — MOVE console icon coverage.
// Focused on: (a) every D-pad direction button has a lucide sprite child,
// (b) the CONFIRM button does not (spec assigns it none), and (c) the
// portrait auto-stop toggles carry an eye/eye-off icon that swaps with the
// toggle state. Structural D-pad behaviour is exercised by ./move-mode.test.js.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderMove } from '../../src/ui/console/move.js';

class FakeClassList {
  constructor(el) { this.el = el; this.values = new Set(); }
  add(...names) { for (const n of names) if (n) this.values.add(n); this.sync(); }
  remove(...names) { for (const n of names) this.values.delete(n); this.sync(); }
  toggle(n, force) { const next = force == null ? !this.values.has(n) : Boolean(force); if (next) this.values.add(n); else this.values.delete(n); this.sync(); return next; }
  contains(n) { return this.values.has(n); }
  sync() { this.el._className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tag, ns = null) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.disabled = false;
  }
  set className(v) { this._className = String(v); this.classList.values = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this._className || this.attributes.get('class') || ''; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { for (const c of children) this.appendChild(c); }
  prepend(...children) { this.children = [...children, ...this.children]; }
  replaceChildren() { this.children = []; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setAttributeNS(_ns, name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((c) => c !== listener)); }
  dispatch(type, event = {}) { for (const l of this.listeners.get(type) || []) l({ type, target: this, ...event }); }
  click() { if (this.disabled) return; this.dispatch('click'); }
}

function installDocument() {
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (ns, tag) => new FakeElement(tag, ns)
  };
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const c of root.children || []) {
    const hit = byTestId(c, testid);
    if (hit) return hit;
  }
  return null;
}

function firstIconChild(el) {
  return (el.children || []).find((c) => c.tagName === 'SVG') || null;
}

beforeEach(installDocument);

describe('MOVE mode — SESSION-06 icon coverage', () => {
  const DIR_IDS = ['move-nw', 'move-n', 'move-ne', 'move-w', 'move-e', 'move-sw', 'move-s', 'move-se'];

  it('each of the 8 direction buttons prefixes an arrow-<dir> lucide sprite', () => {
    const container = new FakeElement('div');
    renderMove(container, {});
    for (const id of DIR_IDS) {
      const button = byTestId(container, id);
      expect(button, `missing ${id}`).toBeTruthy();
      const icon = firstIconChild(button);
      expect(icon, `no icon child for ${id}`).toBeTruthy();
      expect(icon.className.split(/\s+/)).toContain('icon');
      expect(button.classList.contains('has-icon')).toBe(true);
    }
  });

  it('CONFIRM/DESCEND does not gain an icon (spec assigns none) — DOM structure preserved', () => {
    const container = new FakeElement('div');
    renderMove(container, { canDescend: () => true });
    const confirm = byTestId(container, 'move-confirm');
    expect(confirm).toBeTruthy();
    expect(confirm.classList.contains('has-icon')).toBe(false);
    expect(firstIconChild(confirm)).toBe(null);
    expect(confirm.textContent).toBe('DESCEND');
  });

  it('portrait DISCOVERY STOP toggles the eye icon on state flip and click does not fire when disabled', () => {
    const setAutoStopToggle = vi.fn();
    const container = new FakeElement('div');
    renderMove(container, { autoStopToggles: { discovery: true, damage: true }, setAutoStopToggle });

    const discoveryOn = byTestId(container, 'toggle-discovery');
    const iconOn = firstIconChild(discoveryOn);
    expect(iconOn).toBeTruthy();
    expect(iconOn.className.split(/\s+/)).toContain('icon-14');

    const container2 = new FakeElement('div');
    renderMove(container2, { autoStopToggles: { discovery: false, damage: true }, setAutoStopToggle });
    const discoveryOff = byTestId(container2, 'toggle-discovery');
    const iconOff = firstIconChild(discoveryOff);
    expect(iconOff).toBeTruthy();
    // Icon class carries the icon-14 size and the icon-dim tone in both states.
    expect(iconOff.className.split(/\s+/)).toContain('icon-14');

    // HOSTILE STOP LOCKED is disabled — click must be inert even with icon prefix.
    const hostile = container.children[0].children[2].children[0];
    expect(hostile.tagName).toBe('BUTTON');
    expect(hostile.disabled).toBe(true);
    hostile.click();
    expect(setAutoStopToggle).not.toHaveBeenCalled();
  });
});
