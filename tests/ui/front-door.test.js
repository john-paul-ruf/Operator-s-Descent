import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { getFlag, loadSettings, saveSettings } from '../../src/state/library.js';
import { installMockStorage } from '../helpers/mock-storage.js';

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }
  add(...names) {
    for (const name of names) if (name) this.values.add(name);
    this.sync();
  }
  remove(...names) {
    for (const name of names) this.values.delete(name);
    this.sync();
  }
  toggle(name, force) {
    const next = force == null ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name);
    else this.values.delete(name);
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
    this.id = '';
    this.disabled = false;
    this.checked = false;
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
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  prepend(...children) {
    for (const child of [...children].reverse()) {
      child.parentNode = this;
      this.children.unshift(child);
    }
  }
  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    child.parentNode = null;
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      await listener({ type, target: this, preventDefault() { this.prevented = true; }, ...event });
    }
  }
  click() { return this.disabled ? Promise.resolve() : this.dispatch('click'); }
  focus() { this.focused = true; }
}

function findById(root, id) {
  if (root.id === id || root.getAttribute?.('id') === id) return root;
  for (const child of root.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function installDocument() {
  const appRoot = new FakeElement('div');
  appRoot.id = 'app-root';
  const portraitFrame = new FakeElement('div');
  portraitFrame.id = 'portrait-frame';
  portraitFrame.appendChild(appRoot);
  const documentElement = new FakeElement('html');
  documentElement.appendChild(portraitFrame);
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => findById(documentElement, id),
    documentElement
  };
  return { appRoot, portraitFrame };
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
    if (found) return found;
  }
  return null;
}

function collect(root, predicate, matches = []) {
  if (predicate(root)) matches.push(root);
  for (const child of root.children || []) collect(child, predicate, matches);
  return matches;
}

function allText(root) {
  return [root.textContent, ...(root.children || []).flatMap((child) => allText(child))].filter(Boolean);
}

function installMatchMedia(match) {
  globalThis.window = globalThis.window || {};
  globalThis.window.matchMedia = () => ({ matches: Boolean(match), addEventListener() {}, removeEventListener() {} });
}

let storage;

beforeEach(() => {
  installDocument();
  storage = installMockStorage();
});

afterEach(() => {
  storage.uninstall();
  delete globalThis.document;
  delete globalThis.window;
  vi.restoreAllMocks();
});

describe('title screen', () => {
  it('renders the title with a hidden branch list that START toggles', async () => {
    const seen = [];
    const offNavigate = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/title.js');
    const container = new FakeElement('div');
    const controller = mount(container);

    expect(allText(container)).toContain("OPERATOR'S");
    expect(allText(container)).toContain('DESCENT');
    expect(allText(container)).toContain('DEPTH IS THE SCORE');
    expect(allText(container)).not.toContain('BEGIN NEW RUN');

    expect(byTestId(container, 'title-header').textContent).toBe('GLITCH FORGEWORKS');
    expect(byTestId(container, 'title-tagline').textContent).toBe('DEPTH IS THE SCORE');
    const footer = byTestId(container, 'title-footer');
    expect(allText(footer).join(' ')).toContain('v1.0');
    expect(allText(footer).join(' ')).toContain('PRESS START TO POWER ON');

    const h1s = collect(container, el => el.tagName === 'H1');
    expect(h1s).toHaveLength(2);
    expect(h1s[0].classList.contains('title-glitch')).toBe(true);
    expect(h1s[0].getAttribute('data-text')).toBe("OPERATOR'S");
    expect(h1s[1].classList.contains('title-glitch')).toBe(true);
    expect(h1s[1].getAttribute('data-text')).toBe('DESCENT');

    const start = byTestId(container, 'title-start');
    expect(start).toBeTruthy();
    await start.click();

    const branches = byTestId(container, 'title-branches');
    expect(branches.classList.contains('hidden-branches')).toBe(false);
    expect(allText(container)).toContain('◈ BEGIN NEW RUN');
    expect(byTestId(container, 'title-secondary-branches').children).toHaveLength(2);
    expect(byTestId(container, 'title-tutorial').textContent).toBe('TUTORIAL');
    expect(byTestId(container, 'title-settings').textContent).toBe('SETTINGS');

    await start.click();
    expect(branches.classList.contains('hidden-branches')).toBe(true);

    await start.click();
    await byTestId(container, 'title-run-library').click();
    expect(seen.at(-1)).toEqual({ screen: 'library', params: {} });

    controller.unmount();
    offNavigate();
  });

  it('keeps the default composition free of a first-time tutorial offer', async () => {
    const { mount } = await import('../../src/ui/screens/title.js');
    const container = new FakeElement('div');
    mount(container);

    expect(byTestId(container, 'tutorial-offer')).toBeNull();
    expect(byTestId(container, 'title-offer-tutorial')).toBeNull();
    expect(byTestId(container, 'title-tutorial')).toBeTruthy();
  });

  it('renders the wide-layout title composition with a data-wide-root and toggling branch list', async () => {
    installMatchMedia(true);
    const { mount } = await import('../../src/ui/screens/title.js');
    const container = new FakeElement('div');
    mount(container);

    const screen = container.children[0];
    expect(screen.classList.contains('wide-title-screen')).toBe(true);
    expect(screen.dataset.wideRoot).toBe('');

    const branches = byTestId(container, 'title-branches');
    expect(branches.classList.contains('wide-title-branches')).toBe(true);
    expect(branches.classList.contains('hidden-branches')).toBe(true);

    const secondary = byTestId(container, 'title-secondary-branches');
    expect(secondary.classList.contains('branch-row')).toBe(true);
    expect(secondary.children).toHaveLength(2);

    await byTestId(container, 'title-start').click();
    expect(branches.classList.contains('hidden-branches')).toBe(false);
  });
});

describe('tutorial manual', () => {
  it('paginates the complete manual and records completion as tutorial suppression', async () => {
    const seen = [];
    const offNavigate = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/tutorial.js');
    const container = new FakeElement('div');
    mount(container);

    expect(byTestId(container, 'tutorial-page').parentNode.classList.contains('screen-body')).toBe(true);

    const titles = [];
    while (byTestId(container, 'tutorial-next')) {
      titles.push(byTestId(container, 'tutorial-page-title').textContent);
      await byTestId(container, 'tutorial-next').click();
    }
    titles.push(byTestId(container, 'tutorial-page-title').textContent);

    expect(titles).toEqual([
      'Console Overview',
      'MOVE Mode',
      'The Map',
      'COMBAT Mode',
      'PARTY Mode',
      'GEAR Mode',
      'TECH Mode',
      'LOOT Mode',
      'LOG Mode',
      'Status Strip',
      'Settings',
      'Seed & Share Links'
    ]);
    expect(byTestId(container, 'tutorial-page-index').textContent).toBe('12/12');

    await byTestId(container, 'tutorial-done').click();
    expect(getFlag('tutorialDeclined')).toBe(true);
    expect(seen.at(-1)).toEqual({ screen: 'title', params: { tutorialCompleted: true } });
    offNavigate();
  });

  it('renders the wide-layout tutorial as a two-page spread with an appended summary state', async () => {
    installMatchMedia(true);
    const seen = [];
    const offNavigate = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/tutorial.js');
    const container = new FakeElement('div');
    mount(container);

    const shell = container.children[0];
    expect(shell.classList.contains('wide-tutorial-shell')).toBe(true);
    expect(shell.dataset.wideRoot).toBe('');

    // Spread 0 is the first pair — left pane holds the primary tutorial-page.
    expect(byTestId(container, 'tutorial-spread')).toBeTruthy();
    expect(byTestId(container, 'tutorial-page').classList.contains('wide-tutorial-pane')).toBe(true);
    expect(byTestId(container, 'tutorial-right-pane').classList.contains('wide-tutorial-pane')).toBe(true);
    expect(byTestId(container, 'tutorial-page-title').textContent).toBe('Console Overview');

    // 11 production pages → 6 content spreads + 1 summary; advance through them all.
    let advanced = 0;
    while (byTestId(container, 'tutorial-next')) {
      await byTestId(container, 'tutorial-next').click();
      advanced += 1;
      if (advanced > 20) throw new Error('spread advancement did not terminate');
    }
    // After 6 next-clicks the summary state renders with DONE + summary marker.
    expect(advanced).toBe(6);
    expect(byTestId(container, 'tutorial-summary')).toBeTruthy();
    expect(byTestId(container, 'tutorial-done')).toBeTruthy();

    // Prev returns to the previous content spread and re-renders NEXT.
    await byTestId(container, 'tutorial-prev').click();
    expect(byTestId(container, 'tutorial-next')).toBeTruthy();
    expect(byTestId(container, 'tutorial-summary')).toBeNull();

    offNavigate();
  });
});

describe('settings screen', () => {
  it('persists only final enumerated settings and previews them through hot services', async () => {
    const changes = [];
    const navigations = [];
    const offSettings = bus.on('state:settings-change', (payload) => changes.push(payload));
    const offNavigate = bus.on('ui:navigate', (payload) => navigations.push(payload));
    saveSettings({ reducedMotion: 'system' });
    const { mount } = await import('../../src/ui/screens/settings.js');
    const container = new FakeElement('div');
    mount(container, { from: 'exploration' });

    expect(byTestId(container, 'settings-master-mute').parentNode.classList.contains('panel')).toBe(true);

    const eyebrow = collect(container, (el) => el.classList.contains('micro') && el.textContent.includes('SETTINGS'))[0];
    expect(eyebrow.getAttribute('role')).toBe('heading');
    expect(eyebrow.getAttribute('aria-level')).toBe('1');

    const muteInput = byTestId(container, 'settings-master-mute').children[1];
    muteInput.checked = true;
    await muteInput.dispatch('change');

    const droneInput = byTestId(container, 'settings-volume-drone-input');
    droneInput.value = '23';
    await droneInput.dispatch('input');

    await byTestId(container, 'settings-motion-full').click();

    const textureInput = byTestId(container, 'settings-scanline-grain').children[1];
    textureInput.checked = false;
    await textureInput.dispatch('change');

    expect(loadSettings()).toMatchObject({
      masterMute: true,
      layerVolumes: { drone: 23, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 },
      glitchEnabled: true,
      reducedMotion: 'full',
      scanlineGrainEnabled: false
    });
    expect(changes).toEqual(expect.arrayContaining([
      { key: 'mute', value: true },
      { key: 'volume:drone', value: 23 },
      { key: 'reducedMotion', value: 'full' },
      { key: 'scanlineGrain', value: false }
    ]));
    expect(allText(container)).not.toContain('VERSION 1.0');

    await byTestId(container, 'settings-back').click();
    expect(navigations.at(-1)).toEqual({ screen: 'exploration', params: {} });

    offSettings();
    offNavigate();
  });

  it('renders the wide-layout settings composition with two settings columns and a wide root', async () => {
    installMatchMedia(true);
    const { mount } = await import('../../src/ui/screens/settings.js');
    const container = new FakeElement('div');
    mount(container);

    const screen = container.children[0];
    expect(screen.classList.contains('wide-settings-shell')).toBe(true);
    expect(screen.dataset.wideRoot).toBe('');

    expect(byTestId(container, 'settings-audio-column').classList.contains('wide-settings-column')).toBe(true);
    expect(byTestId(container, 'settings-visual-column').classList.contains('wide-settings-column')).toBe(true);
    expect(byTestId(container, 'settings-master-mute').parentNode.classList.contains('panel')).toBe(true);
    expect(byTestId(container, 'settings-glitch').parentNode.classList.contains('panel')).toBe(true);
  });
});

describe('runtime update surfacing', () => {
  it('dispatching runtime:update-ready mounts exactly one toast whose RELOAD button calls window.location.reload', async () => {
    let reloadCalls = 0;
    globalThis.window = globalThis.window || {};
    globalThis.window.location = { reload: () => { reloadCalls += 1; } };

    // Importing main.js registers the bus subscription (side effect on load).
    // With no <div id="crt-overlays"> in the fake document, the CRT-overlays
    // import path stays quiescent; the in-run boot gate only fires when
    // window.location is well-formed and __odSkipBoot is unset — set the
    // sentinel so the runtime dynamic import stays out of this test.
    globalThis.__odSkipBoot = true;
    await import('../../src/main.js');

    bus.dispatch('runtime:update-ready', {});
    bus.dispatch('runtime:update-ready', {});

    const portraitFrame = document.getElementById('portrait-frame');
    const toasts = collect(portraitFrame, (el) => el.dataset?.testid === 'update-toast');
    expect(toasts).toHaveLength(1);

    const button = byTestId(toasts[0], 'update-toast-reload');
    expect(button).toBeTruthy();
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toBe('RELOAD');

    await button.dispatch('click');
    expect(reloadCalls).toBe(1);

    delete globalThis.__odSkipBoot;
  });
});
