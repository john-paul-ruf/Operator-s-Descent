import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { bus } from '../../src/state/bus.js';
import {
  WIDE_MEDIA_QUERY,
  WIDE_PANE_LEFT_BOUNDS,
  WIDE_PANE_RIGHT_BOUNDS,
  attachWidePanes,
  currentLayoutClass,
  initLayoutController
} from '../../src/ui/layout.js';

function installMatchMedia({ matches = false, subscribable = true } = {}) {
  const state = { matches };
  const listeners = new Set();
  const requested = [];
  globalThis.window = {
    matchMedia(media) {
      requested.push(media);
      const query = { media, get matches() { return state.matches; } };
      if (subscribable) {
        query.addEventListener = (type, listener) => { if (type === 'change') listeners.add(listener); };
        query.removeEventListener = (_type, listener) => { listeners.delete(listener); };
      }
      return query;
    }
  };
  return {
    requested,
    listenerCount: () => listeners.size,
    setMatches(next) {
      state.matches = next;
      for (const listener of [...listeners]) listener({ matches: next, media: WIDE_MEDIA_QUERY });
    }
  };
}

beforeEach(() => {
  globalThis.document = { documentElement: { dataset: {} } };
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

describe('currentLayoutClass', () => {
  test('resolves wide when the media query matches and portrait otherwise', () => {
    expect(WIDE_MEDIA_QUERY).toBe('(min-width: 900px) and (min-aspect-ratio: 1/1)');
    const media = installMatchMedia({ matches: true });
    expect(currentLayoutClass()).toBe('wide');
    expect(media.requested[0]).toBe(WIDE_MEDIA_QUERY);
    media.setMatches(false);
    expect(currentLayoutClass()).toBe('portrait');
  });

  test('falls back to portrait when matchMedia is unavailable', () => {
    globalThis.window = {};
    expect(currentLayoutClass()).toBe('portrait');
    delete globalThis.window;
    expect(currentLayoutClass()).toBe('portrait');
  });
});

describe('initLayoutController', () => {
  test('stamps the html layout attribute at init for both classes', () => {
    installMatchMedia({ matches: false });
    const cleanupPortrait = initLayoutController({ bus });
    expect(document.documentElement.dataset.layout).toBe('portrait');
    cleanupPortrait();

    installMatchMedia({ matches: true });
    const cleanupWide = initLayoutController({ bus });
    expect(document.documentElement.dataset.layout).toBe('wide');
    cleanupWide();
  });

  test('updates the attribute and dispatches ui:layout-change on media change', () => {
    const media = installMatchMedia({ matches: false });
    const events = [];
    const off = bus.on('ui:layout-change', (payload) => events.push(payload));
    const cleanup = initLayoutController({ bus });

    media.setMatches(true);
    expect(document.documentElement.dataset.layout).toBe('wide');
    expect(events).toEqual([{ layout: 'wide' }]);

    media.setMatches(false);
    expect(document.documentElement.dataset.layout).toBe('portrait');
    expect(events).toEqual([{ layout: 'wide' }, { layout: 'portrait' }]);

    off();
    cleanup();
  });

  test('cleanup unsubscribes the media listener and clears the attribute', () => {
    const media = installMatchMedia({ matches: true });
    const events = [];
    const off = bus.on('ui:layout-change', (payload) => events.push(payload));
    const cleanup = initLayoutController({ bus });
    expect(media.listenerCount()).toBe(1);

    cleanup();
    expect(media.listenerCount()).toBe(0);
    expect(document.documentElement.dataset.layout).toBeUndefined();

    media.setMatches(false);
    expect(events).toEqual([]);
    off();
  });

  test('still stamps the attribute when the media query is not subscribable', () => {
    installMatchMedia({ matches: false, subscribable: false });
    const cleanup = initLayoutController({ bus });
    expect(document.documentElement.dataset.layout).toBe('portrait');
    expect(() => cleanup()).not.toThrow();
    expect(document.documentElement.dataset.layout).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// attachWidePanes — pane controller for the wide 3-region shell (SESSION-05)
// ─────────────────────────────────────────────────────────────────────────────

class FakePaneElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {
      _props: {},
      setProperty(name, value) { this._props[name] = value; },
      removeProperty(name) { delete this._props[name]; },
      getPropertyValue(name) { return this._props[name] ?? ''; }
    };
    this.parentNode = null;
    this.tabIndex = -1;
    this._captured = new Set();
    this._className = '';
  }
  set className(value) { this._className = String(value); }
  get className() { return this._className; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((l) => l !== listener)); }
  dispatch(type, event = {}) {
    let prevented = false;
    let stopped = false;
    const evt = {
      type,
      target: this,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
      ...event
    };
    for (const listener of this.listeners.get(type) || []) listener(evt);
    evt.prevented = prevented;
    evt.stopped = stopped;
    return evt;
  }
  setPointerCapture(id) { this._captured.add(id); }
  releasePointerCapture(id) { this._captured.delete(id); }
  querySelector(selector) {
    if (selector !== '.wide-console-tabs') return null;
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift();
      if (String(node.className || '').split(/\s+/).includes('wide-console-tabs')) return node;
      if (node.children?.length) stack.push(...node.children);
    }
    return null;
  }
}

function installDom() {
  globalThis.document = {
    createElement: (tag) => new FakePaneElement(tag),
    documentElement: new FakePaneElement('html')
  };
}

function findChildByTestId(node, id) {
  for (const child of node.children || []) if (child.dataset?.testid === id) return child;
  return null;
}

function makeShell({ withTabs = false } = {}) {
  const shell = new FakePaneElement('div');
  shell.className = 'wide-shell';
  if (withTabs) {
    const dock = new FakePaneElement('aside');
    dock.className = 'wide-console-dock';
    const tabs = new FakePaneElement('nav');
    tabs.className = 'wide-console-tabs';
    dock.appendChild(tabs);
    shell.appendChild(dock);
  }
  return shell;
}

describe('attachWidePanes', () => {
  beforeEach(() => { installDom(); });
  afterEach(() => { delete globalThis.document; });

  test('applies defaults when no persisted settings exist and stamps handles/collapses on the shell', () => {
    const shell = makeShell();
    const cleanup = attachWidePanes({ shell, loadSettings: () => ({}), saveSettings: () => {} });

    expect(shell.dataset.paneLeft).toBe('open');
    expect(shell.dataset.paneRight).toBe('open');
    expect(shell.style._props['--wide-left-w']).toBe(`${WIDE_PANE_LEFT_BOUNDS.default}px`);
    expect(shell.style._props['--wide-right-w']).toBe(`${WIDE_PANE_RIGHT_BOUNDS.default}px`);
    expect(findChildByTestId(shell, 'pane-handle-left')).not.toBe(null);
    expect(findChildByTestId(shell, 'pane-handle-right')).not.toBe(null);
    expect(findChildByTestId(shell, 'pane-collapse-left')).not.toBe(null);
    expect(findChildByTestId(shell, 'pane-collapse-right')).not.toBe(null);

    cleanup();
  });

  test('restores persisted widths clamped to bounds and rejects bogus values', () => {
    const shell = makeShell();
    // left: below min → clamped up; right: 'garbage' → default
    const cleanup = attachWidePanes({
      shell,
      loadSettings: () => ({ widePanes: { left: 50, right: 'garbage' } }),
      saveSettings: () => {}
    });

    expect(shell.style._props['--wide-left-w']).toBe(`${WIDE_PANE_LEFT_BOUNDS.min}px`);
    expect(shell.style._props['--wide-right-w']).toBe(`${WIDE_PANE_RIGHT_BOUNDS.default}px`);

    cleanup();
  });

  test('restores a collapsed pane from settings', () => {
    const shell = makeShell();
    const cleanup = attachWidePanes({
      shell,
      loadSettings: () => ({ widePanes: { left: 'collapsed', right: 420 } }),
      saveSettings: () => {}
    });

    expect(shell.dataset.paneLeft).toBe('collapsed');
    expect(shell.dataset.paneRight).toBe('open');
    expect(shell.style._props['--wide-right-w']).toBe('420px');

    cleanup();
  });

  test('dragging the left handle updates the width var and persists on release', () => {
    const shell = makeShell();
    const saved = [];
    const cleanup = attachWidePanes({
      shell,
      loadSettings: () => ({ widePanes: { left: 300, right: 360 } }),
      saveSettings: (payload) => { saved.push(payload); }
    });

    const handle = findChildByTestId(shell, 'pane-handle-left');
    handle.dispatch('pointerdown', { pointerId: 1, clientX: 100 });
    handle.dispatch('pointermove', { pointerId: 1, clientX: 150 });
    expect(shell.style._props['--wide-left-w']).toBe('350px');
    expect(saved).toEqual([]);

    handle.dispatch('pointerup', { pointerId: 1 });
    expect(saved).toEqual([{ widePanes: { left: 350, right: 360 } }]);
    expect(handle._captured.has(1)).toBe(false);

    cleanup();
  });

  test('dragging the right handle moves inward and clamps to the maximum', () => {
    const shell = makeShell();
    const saved = [];
    const cleanup = attachWidePanes({
      shell,
      loadSettings: () => ({ widePanes: { left: 280, right: 360 } }),
      saveSettings: (payload) => { saved.push(payload); }
    });

    const handle = findChildByTestId(shell, 'pane-handle-right');
    handle.dispatch('pointerdown', { pointerId: 2, clientX: 500 });
    // drag left by 10000px → right pane grows by 10000, clamped to bounds.max
    handle.dispatch('pointermove', { pointerId: 2, clientX: -10000 });
    expect(shell.style._props['--wide-right-w']).toBe(`${WIDE_PANE_RIGHT_BOUNDS.max}px`);
    handle.dispatch('pointerup', { pointerId: 2 });
    expect(saved).toEqual([{ widePanes: { left: 280, right: WIDE_PANE_RIGHT_BOUNDS.max } }]);

    cleanup();
  });

  test('clicking a collapse button toggles the pane and persists', () => {
    const shell = makeShell();
    const saved = [];
    const cleanup = attachWidePanes({
      shell,
      loadSettings: () => ({}),
      saveSettings: (payload) => { saved.push(payload); }
    });

    const collapseLeft = findChildByTestId(shell, 'pane-collapse-left');
    collapseLeft.dispatch('click');
    expect(shell.dataset.paneLeft).toBe('collapsed');
    expect(saved.at(-1)).toEqual({ widePanes: { left: 'collapsed', right: WIDE_PANE_RIGHT_BOUNDS.default } });

    collapseLeft.dispatch('click');
    expect(shell.dataset.paneLeft).toBe('open');
    expect(saved.at(-1)).toEqual({ widePanes: { left: WIDE_PANE_LEFT_BOUNDS.default, right: WIDE_PANE_RIGHT_BOUNDS.default } });

    cleanup();
  });

  test('keyboard ArrowLeft/Right on the left handle resizes and stopPropagation shields owner input', () => {
    const shell = makeShell();
    const saved = [];
    const cleanup = attachWidePanes({
      shell,
      loadSettings: () => ({ widePanes: { left: 280, right: 360 } }),
      saveSettings: (payload) => { saved.push(payload); }
    });

    const handle = findChildByTestId(shell, 'pane-handle-left');
    const evt = handle.dispatch('keydown', { code: 'ArrowRight' });
    expect(evt.prevented).toBe(true);
    expect(evt.stopped).toBe(true);
    expect(shell.style._props['--wide-left-w']).toBe('296px');
    expect(saved.at(-1)).toEqual({ widePanes: { left: 296, right: 360 } });

    handle.dispatch('keydown', { code: 'ArrowLeft' });
    expect(shell.style._props['--wide-left-w']).toBe('280px');

    cleanup();
  });

  test('double-clicking a handle resets its pane to the default width', () => {
    const shell = makeShell();
    const saved = [];
    const cleanup = attachWidePanes({
      shell,
      loadSettings: () => ({ widePanes: { left: 460, right: 360 } }),
      saveSettings: (payload) => { saved.push(payload); }
    });
    const handle = findChildByTestId(shell, 'pane-handle-left');
    handle.dispatch('dblclick');
    expect(shell.style._props['--wide-left-w']).toBe(`${WIDE_PANE_LEFT_BOUNDS.default}px`);
    expect(saved.at(-1)).toEqual({ widePanes: { left: WIDE_PANE_LEFT_BOUNDS.default, right: 360 } });
    cleanup();
  });

  test('clicking any child of .wide-console-tabs re-expands a collapsed right pane', () => {
    const shell = makeShell({ withTabs: true });
    const saved = [];
    const cleanup = attachWidePanes({
      shell,
      loadSettings: () => ({ widePanes: { left: 280, right: 'collapsed' } }),
      saveSettings: (payload) => { saved.push(payload); }
    });

    expect(shell.dataset.paneRight).toBe('collapsed');
    const tabs = shell.children[0].children[0]; // dock > tabs
    tabs.dispatch('click');
    expect(shell.dataset.paneRight).toBe('open');
    expect(saved.at(-1)).toEqual({ widePanes: { left: 280, right: WIDE_PANE_RIGHT_BOUNDS.default } });

    cleanup();
  });

  test('cleanup removes injected nodes and clears width vars / dataset flags', () => {
    const shell = makeShell();
    const cleanup = attachWidePanes({ shell, loadSettings: () => ({}), saveSettings: () => {} });

    expect(shell.children).toHaveLength(4);
    cleanup();
    expect(shell.children).toHaveLength(0);
    expect(shell.style._props['--wide-left-w']).toBeUndefined();
    expect(shell.style._props['--wide-right-w']).toBeUndefined();
    expect(shell.dataset.paneLeft).toBeUndefined();
    expect(shell.dataset.paneRight).toBeUndefined();
  });

  test('no-ops safely without a shell', () => {
    expect(() => attachWidePanes({})).not.toThrow();
    const noop = attachWidePanes({});
    expect(() => noop()).not.toThrow();
  });
});
