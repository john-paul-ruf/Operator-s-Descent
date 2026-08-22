import { beforeEach, describe, expect, test } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { createConsole } from '../../src/ui/console/console.js';
import { createInputHandler } from '../../src/ui/input.js';

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
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.tabIndex = -1;
    this.hidden = false;
    this.parentNode = null;
    this.innerHTML = '';
    this.scrollTop = 0;
    this.scrollHeight = 500;
    this.clientHeight = 100;
  }
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return this._className; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, ...event }); }
  focus(options) { this.focused = true; this.focusOptions = options; }
}

function collect(root, predicate, results = []) {
  if (predicate(root)) results.push(root);
  for (const child of root.children || []) collect(child, predicate, results);
  return results;
}

function byClass(root, className) {
  return collect(root, (el) => el.className?.split(/\s+/).includes(className))[0] || null;
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
    // SESSION-05 icon-first-ui-density: tabs are icon-only. The former visible
    // label lives on aria-label as `LABEL · Key N` and on the `title` tooltip.
    expect(root.children[1].children.map((tab) => tab.getAttribute('title'))).toEqual(['MOVE', 'CMBT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG']);
    expect(root.children[1].children.every((tab) => tab.classList.contains('icon-only'))).toBe(true);
    expect(root.children[1].children[0].getAttribute('aria-selected')).toBe('true');
    expect(root.children[1].children[1].classList.contains('disabled')).toBe(true);
    expect(root.children[2].className).toContain('scroll-area');
    expect(root.children[2].dataset.scrollOwner).toBe('console-mode');
    expect(root.getAttribute('aria-expanded')).toBe('false');
    // Portrait console seeds data-expand-state at construction time so callers
    // reading the dataset before any expand() call see 'collapsed'.
    expect(root.dataset.expandState).toBe('collapsed');
    expect(consoleShell.expandState).toBe('collapsed');
  });

  test('portrait tab-tap on the active tab cycles collapsed → half → full → collapsed → half', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000, name: 'A' }], inventory: [] } });
    const root = consoleShell.render();
    const moveTab = root.children[1].children[0];

    // Baseline: collapsed after render.
    expect(consoleShell.expandState).toBe('collapsed');
    expect(root.dataset.expandState).toBe('collapsed');
    expect(root.classList.contains('collapsed')).toBe(true);

    // Tap 1: collapsed → half.
    moveTab.dispatch('click');
    expect(consoleShell.expandState).toBe('half');
    expect(consoleShell.expanded).toBe(true);
    expect(root.dataset.expandState).toBe('half');
    expect(root.classList.contains('expanded')).toBe(true);
    expect(root.classList.contains('expanded-half')).toBe(true);
    expect(root.classList.contains('expanded-full')).toBe(false);
    expect(root.classList.contains('collapsed')).toBe(false);

    // Tap 2: half → full.
    moveTab.dispatch('click');
    expect(consoleShell.expandState).toBe('full');
    expect(root.dataset.expandState).toBe('full');
    expect(root.classList.contains('expanded-full')).toBe(true);
    expect(root.classList.contains('expanded-half')).toBe(false);

    // Tap 3: full → collapsed.
    moveTab.dispatch('click');
    expect(consoleShell.expandState).toBe('collapsed');
    expect(consoleShell.expanded).toBe(false);
    expect(root.dataset.expandState).toBe('collapsed');
    expect(root.classList.contains('collapsed')).toBe(true);
    expect(root.classList.contains('expanded')).toBe(false);

    // Tap 4: collapsed → half again (cycle wraps).
    moveTab.dispatch('click');
    expect(consoleShell.expandState).toBe('half');
  });

  test('portrait: tapping an inactive tab opens the console at half when collapsed and preserves size when expanded', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000, name: 'A' }], inventory: [] } });
    const root = consoleShell.render();
    const tabs = root.children[1].children;
    const partyTab = tabs[2];
    const gearTab = tabs[3];

    // Collapsed + tap on inactive PARTY tab → mode switches AND expands to half.
    partyTab.dispatch('click');
    expect(consoleShell.currentMode).toBe('party');
    expect(consoleShell.expandState).toBe('half');

    // Cycle PARTY tab from half → full.
    partyTab.dispatch('click');
    expect(consoleShell.expandState).toBe('full');

    // Tap on inactive GEAR tab while full → mode switches, size stays 'full'.
    gearTab.dispatch('click');
    expect(consoleShell.currentMode).toBe('gear');
    expect(consoleShell.expandState).toBe('full');
  });

  test('explicit expand({size:"full"}) jumps sizes without walking through half', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000, name: 'A' }], inventory: [] } });
    consoleShell.render();

    consoleShell.expand({ size: 'full' });
    expect(consoleShell.expandState).toBe('full');
    consoleShell.expand({ size: 'half' });
    expect(consoleShell.expandState).toBe('half');
    consoleShell.collapse();
    expect(consoleShell.expandState).toBe('collapsed');
  });

  test('renders an in-tab key badge alongside the icon-only tab, with the shortcut in aria-label and a pointer title', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000, name: 'A' }], inventory: [] } });
    const root = consoleShell.render();
    const tabs = root.children[1].children;

    tabs.forEach((tab, index) => {
      // SESSION-05 icon-first-ui-density: icon-only tabs restore a pointer
      // `title` — the visible label is now a sprite, and the mocks (SESSION-03)
      // teach that a title is what names it for hover users. AT still reads
      // aria-label, which is unchanged.
      const modeLabels = ['MOVE', 'CMBT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG'];
      expect(tab.getAttribute('title')).toBe(modeLabels[index]);
      const badge = byClass(tab, 'tab-key');
      expect(badge).not.toBe(null);
      expect(badge.textContent).toBe(String(index + 1));
      expect(badge.getAttribute('aria-hidden')).toBe('true');
    });

    // Enabled tab carries the spoken shortcut; disabled tab carries its reason.
    expect(tabs[0].getAttribute('aria-label')).toBe('MOVE · Key 1');
    expect(tabs[1].disabled).toBe(true);
    expect(tabs[1].getAttribute('aria-label')).toBe('CMBT · No active combat.');
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

  test('captures the keyed mode offset before refresh or swap, restores it after mount, and focuses without scrolling', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000, name: 'A' }], inventory: [] } });
    const root = consoleShell.render();
    const content = root.children[2];
    content.scrollTop = 73;

    consoleShell.refresh();
    expect(content.scrollTop).toBe(73);
    expect(content.dataset.scrollOwner).toBe('console-mode');
    expect(content.focusOptions).toEqual({ preventScroll: true });

    content.scrollTop = 51;
    consoleShell.setMode('party');
    content.scrollTop = 19;
    consoleShell.setMode('move');
    expect(content.scrollTop).toBe(51);
    consoleShell.setMode('party');
    expect(content.scrollTop).toBe(19);
    expect(content.dataset.mode).toBe('party');
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

describe('console dock variant (wide)', () => {
  test('renders wide-console-dock with vertical wide-mode-tabs, no dim layer, always expanded', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000 }], inventory: [] } }, { variant: 'dock' });
    const root = consoleShell.render();

    expect(consoleShell.variant).toBe('dock');
    expect(root.className).toContain('wide-console-dock');
    expect(consoleShell.expanded).toBe(true);
    expect(root.getAttribute('aria-expanded')).toBe('true');
    expect(root.children).toHaveLength(2);
    expect(root.children[0].className).toContain('wide-console-tabs');
    expect(root.children[1].className).toContain('wide-console-content');
    expect(byClass(root, 'wide-console-content-body').dataset.scrollOwner).toBe('console-mode');
    expect(byClass(root, 'console-dim-layer')).toBe(null);
    const tabs = root.children[0].children;
    expect(tabs).toHaveLength(7);
    // SESSION-05 icon-first-ui-density: icon-only tabs — title carries the
    // former visible label. aria-label keeps `LABEL · Key N` verbatim.
    expect(tabs.map((tab) => tab.getAttribute('title'))).toEqual(['MOVE', 'CMBT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG']);
    expect(tabs.every((tab) => tab.classList.contains('wide-mode-tab'))).toBe(true);
    expect(tabs.every((tab) => tab.classList.contains('icon-only'))).toBe(true);
    expect(tabs.map((tab) => tab.dataset.testid)).toEqual([
      'console-tab-move', 'console-tab-combat', 'console-tab-party', 'console-tab-gear', 'console-tab-tech', 'console-tab-loot', 'console-tab-log'
    ]);
    expect(tabs[1].disabled).toBe(true);
    expect(tabs[1].classList.contains('disabled')).toBe(true);
  });

  test('collapse() is a no-op and cancel does not collapse the dock', () => {
    const inputHandler = createInputHandler({ legacyActions: false });
    const consoleShell = createConsole({ inputHandler, runState: { party: [{ sigilCodepoint: 0xE000 }], inventory: [] } }, { variant: 'dock' });
    consoleShell.render();

    consoleShell.collapse();
    expect(consoleShell.expanded).toBe(true);
    expect(consoleShell.container.className).toContain('wide-console-dock');

    inputHandler.triggerAction('cancel');
    expect(consoleShell.expanded).toBe(true);
  });

  test('dock stays at expandState "full" regardless of tap or expand cycles', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000 }], inventory: [] } }, { variant: 'dock' });
    const root = consoleShell.render();
    const partyTab = root.children[0].children[2];

    expect(consoleShell.expandState).toBe('full');
    partyTab.dispatch('click');
    partyTab.dispatch('click');
    partyTab.dispatch('click');
    // The dock never toggles expand state; only mode changes.
    expect(consoleShell.expandState).toBe('full');
    expect(consoleShell.expanded).toBe(true);
    // No portrait-only classes leak onto the dock container.
    expect(root.classList.contains('expanded-half')).toBe(false);
    expect(root.classList.contains('expanded-full')).toBe(false);
    expect(root.classList.contains('collapsed')).toBe(false);
    expect(root.dataset.expandState).toBe(undefined);
  });

  test('emits ui:mode-change identically in the dock variant', () => {
    const seenBar = [];
    const seenDock = [];
    const offBar = bus.on('ui:mode-change', (payload) => seenBar.push(payload.mode));
    const bar = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000 }], inventory: [] } });
    bar.render();
    bar.setMode('party');
    offBar();

    const offDock = bus.on('ui:mode-change', (payload) => seenDock.push(payload.mode));
    const dock = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000 }], inventory: [] } }, { variant: 'dock' });
    dock.render();
    dock.setMode('party');
    offDock();

    expect(seenDock).toEqual(seenBar);
    expect(seenDock).toEqual(['party']);
  });

  test('tab click in dock switches mode without toggling collapse', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000 }], inventory: [] } }, { variant: 'dock' });
    const root = consoleShell.render();
    const partyTab = root.children[0].children[2];

    partyTab.dispatch('click');

    expect(consoleShell.currentMode).toBe('party');
    expect(consoleShell.expanded).toBe(true);
  });

  test('content header names the active mode label', () => {
    const consoleShell = createConsole({ runState: { party: [{ sigilCodepoint: 0xE000 }], inventory: [] } }, { variant: 'dock' });
    const root = consoleShell.render();
    const header = byClass(root, 'wide-console-content-header');

    expect(header).not.toBe(null);
    expect(header.children[0].className).toContain('wide-console-content-mode');
    expect(header.children[0].textContent).toBe('◈ MOVE MODE');

    consoleShell.setMode('party');
    expect(header.children[0].textContent).toBe('◈ PARTY MODE');
  });
});
