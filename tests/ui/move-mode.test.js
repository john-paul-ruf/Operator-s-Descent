import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderMove, handleInput } from '../../src/ui/console/move.js';

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) { const next = force == null ? !this.values.has(name) : Boolean(force); if (next) this.values.add(name); else this.values.delete(name); this.sync(); return next; }
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
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return this._className; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; return child; }
  replaceChildren(...children) { this.children = []; for (const child of children) this.appendChild(child); }
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
    createTextNode: (value) => { const node = new FakeElement('#text'); node.textContent = value; return node; }
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

function textOf(root) {
  return [root.textContent, ...(root.children || []).flatMap((child) => textOf(child))].filter(Boolean).join(' ');
}

function collect(root, predicate, results = []) {
  if (predicate(root)) results.push(root);
  for (const child of root.children || []) collect(child, predicate, results);
  return results;
}

beforeEach(installDocument);

describe('MOVE mode', () => {
  describe('render()', () => {
    it('renders exactly 9 D-pad buttons with the expected testids', () => {
      const container = new FakeElement('div');
      renderMove(container, {});

      const DPAD_IDS = new Set(['move-confirm', 'move-e', 'move-n', 'move-ne', 'move-nw', 'move-s', 'move-se', 'move-sw', 'move-w']);
      const dpadButtons = collect(container, (el) => el.tagName === 'BUTTON' && DPAD_IDS.has(el.dataset?.testid));
      expect(dpadButtons).toHaveLength(9);
      expect(dpadButtons.map((button) => button.dataset.testid).sort()).toEqual([...DPAD_IDS].sort());
    });

    it('renders the center button as DESCEND and enabled when canDescend is true', () => {
      const container = new FakeElement('div');
      renderMove(container, { canDescend: () => true });

      const confirmButton = byTestId(container, 'move-confirm');
      expect(confirmButton.textContent).toBe('DESCEND');
      expect(confirmButton.disabled).toBe(false);
    });

    it('renders the center button as WAIT and disabled when canDescend is false or omitted', () => {
      const container = new FakeElement('div');
      renderMove(container, {});

      const confirmButton = byTestId(container, 'move-confirm');
      expect(confirmButton.textContent).toBe('WAIT');
      expect(confirmButton.disabled).toBe(true);
    });

    it('does not render UNDO or CLEAR buttons — staging is gone', () => {
      const container = new FakeElement('div');
      renderMove(container, {});

      expect(byTestId(container, 'move-undo')).toBe(null);
      expect(byTestId(container, 'move-clear')).toBe(null);
    });

    it('always disables HOSTILE STOP LOCKED and reflects live discovery/damage toggle state', () => {
      const setAutoStopToggle = vi.fn();
      const container = new FakeElement('div');
      renderMove(container, { autoStopToggles: { discovery: false, damage: true }, setAutoStopToggle });

      const hostileToggle = collect(container, (el) => el.tagName === 'BUTTON' && el.textContent === 'HOSTILE STOP LOCKED')[0];
      expect(hostileToggle.disabled).toBe(true);

      const discoveryToggle = byTestId(container, 'toggle-discovery');
      expect(discoveryToggle.textContent).toBe('DISCOVERY STOP OFF');
      expect(discoveryToggle.classList.contains('selected')).toBe(false);

      const damageToggle = byTestId(container, 'toggle-damage');
      expect(damageToggle.textContent).toBe('DAMAGE STOP ON');
      expect(damageToggle.classList.contains('selected')).toBe(true);

      discoveryToggle.click();
      expect(setAutoStopToggle).toHaveBeenCalledWith('discovery', true);
    });

    it('shows the descent-point notice when canDescend is true', () => {
      const container = new FakeElement('div');
      renderMove(container, { canDescend: () => true });

      expect(textOf(byTestId(container, 'move-notice'))).toBe('DESCENT POINT — press CONFIRM to request descent.');
    });

    it('shows the hostile-contact notice', () => {
      const container = new FakeElement('div');
      renderMove(container, { lastMoveResult: { moved: true, interruptType: 'hostile', position: { x: 3, y: 4 } } });

      expect(textOf(byTestId(container, 'move-notice'))).toBe('HOSTILE CONTACT — combat requested.');
    });

    it('shows the blocked notice', () => {
      const container = new FakeElement('div');
      renderMove(container, { lastMoveResult: { moved: false } });

      expect(textOf(byTestId(container, 'move-notice'))).toBe('BLOCKED — wall or closed corner.');
    });

    it('shows the default MOVED TO x:y notice', () => {
      const container = new FakeElement('div');
      renderMove(container, { lastMoveResult: { moved: true, position: { x: 5, y: 9 } } });

      expect(textOf(byTestId(container, 'move-notice'))).toBe('MOVED TO 5:9.');
    });

    it('portrait layout omits the wide autostop-row block entirely', () => {
      const container = new FakeElement('div');
      renderMove(container, { autoStopToggles: { discovery: true, damage: true } });

      expect(byTestId(container, 'autostop-hostile')).toBe(null);
      expect(collect(container, (el) => el.className?.split?.(/\s+/).includes('autostop-row'))).toHaveLength(0);
    });

    it('wide layout appends three autostop-row entries with the correct pill state', () => {
      const container = new FakeElement('div');
      renderMove(container, { layout: 'wide', autoStopToggles: { discovery: false, damage: true } });

      const hostile = byTestId(container, 'autostop-hostile');
      const discovery = byTestId(container, 'autostop-discovery');
      const damage = byTestId(container, 'autostop-damage');
      expect(hostile).toBeTruthy();
      expect(discovery).toBeTruthy();
      expect(damage).toBeTruthy();
      expect(hostile.className).toContain('autostop-row');
      const hostilePill = collect(hostile, (el) => el.className?.split?.(/\s+/).includes('autostop-pill'))[0];
      const discoveryPill = collect(discovery, (el) => el.className?.split?.(/\s+/).includes('autostop-pill'))[0];
      const damagePill = collect(damage, (el) => el.className?.split?.(/\s+/).includes('autostop-pill'))[0];
      expect(hostilePill.textContent).toBe('ON');
      expect(discoveryPill.textContent).toBe('OFF');
      expect(discoveryPill.className.split(/\s+/)).toContain('off');
      expect(damagePill.textContent).toBe('ON');
      expect(damagePill.className.split(/\s+/)).not.toContain('off');
    });
  });

  describe('handleInput()', () => {
    const directions = [
      ['move_n', 'n'], ['move_s', 's'], ['move_e', 'e'], ['move_w', 'w'],
      ['move_ne', 'ne'], ['move_nw', 'nw'], ['move_se', 'se'], ['move_sw', 'sw']
    ];

    it.each(directions)('%s resolves to onMove(%s, { source: "console" })', (action, direction) => {
      const onMove = vi.fn();
      handleInput({ action }, { onMove });
      expect(onMove).toHaveBeenCalledWith(direction, { source: 'console' });
    });

    it("uses the event's own source when provided instead of the console default", () => {
      const onMove = vi.fn();
      handleInput({ action: 'move_n', source: 'keyboard' }, { onMove });
      expect(onMove).toHaveBeenCalledWith('n', { source: 'keyboard' });
    });

    const legacyDirections = [
      ['move-north', 'n'], ['move-south', 's'], ['move-east', 'e'], ['move-west', 'w'],
      ['move-northeast', 'ne'], ['move-northwest', 'nw'], ['move-southeast', 'se'], ['move-southwest', 'sw']
    ];

    it.each(legacyDirections)('legacy action %s maps to the same direction as its current-format equivalent', (legacyAction, direction) => {
      const onMove = vi.fn();
      handleInput({ action: legacyAction }, { onMove });
      expect(onMove).toHaveBeenCalledWith(direction, { source: 'console' });
    });

    it('directions call onMove even when a legacy stageMove is provided — staging is gone', () => {
      const stageMove = vi.fn();
      const onMove = vi.fn();
      handleInput({ action: 'move_e' }, { stageMove, onMove });
      expect(onMove).toHaveBeenCalledWith('e', { source: 'console' });
      expect(stageMove).not.toHaveBeenCalled();
    });

    it('confirm calls onConfirmDescent when canDescend() is true', () => {
      const onConfirmDescent = vi.fn();
      handleInput({ action: 'confirm' }, { canDescend: () => true, onConfirmDescent });
      expect(onConfirmDescent).toHaveBeenCalled();
    });

    it('confirm returns false and does not call onConfirmDescent when canDescend() is false', () => {
      const onConfirmDescent = vi.fn();
      const result = handleInput({ action: 'confirm' }, { canDescend: () => false, onConfirmDescent });
      expect(result).toBe(false);
      expect(onConfirmDescent).not.toHaveBeenCalled();
    });

    it('confirm returns false and does not call onConfirmDescent when canDescend is absent', () => {
      const onConfirmDescent = vi.fn();
      const result = handleInput({ action: 'confirm' }, { onConfirmDescent });
      expect(result).toBe(false);
      expect(onConfirmDescent).not.toHaveBeenCalled();
    });

    it('an unrecognized action returns null and calls neither onMove nor onConfirmDescent', () => {
      const onMove = vi.fn();
      const onConfirmDescent = vi.fn();
      const result = handleInput({ action: 'nonsense' }, { onMove, onConfirmDescent });
      expect(result).toBeNull();
      expect(onMove).not.toHaveBeenCalled();
      expect(onConfirmDescent).not.toHaveBeenCalled();
    });
  });
});
