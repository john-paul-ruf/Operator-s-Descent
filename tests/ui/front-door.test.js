import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { loadSettings, saveSettings } from '../../src/state/library.js';
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
  it('renders the title with a hidden branch list that START reveals and hides itself', async () => {
    const seen = [];
    const offNavigate = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/title.js');
    const container = new FakeElement('div');
    const controller = mount(container);

    expect(allText(container)).toContain("OPERATOR'S");
    expect(allText(container)).toContain('DESCENT');
    expect(allText(container)).toContain('DEPTH IS THE SCORE');
    // icon-first-ui-density SESSION-06 — branch list is populated at mount
    // but hidden until START; assert the hidden state on the class rather
    // than on visible text, since text-content is now shorn of the ornament
    // and asserting substring absence is fragile against label renaming.
    expect(byTestId(container, 'title-branches').classList.contains('hidden-branches')).toBe(true);

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
    expect(start.getAttribute('aria-controls')).toBe('title-branches');
    expect(start.getAttribute('aria-expanded')).toBe('false');
    await start.click();

    const branches = byTestId(container, 'title-branches');
    expect(branches.classList.contains('hidden-branches')).toBe(false);
    expect(start.style.display).toBe('none');
    expect(start.getAttribute('aria-expanded')).toBe('true');
    expect(byTestId(container, 'title-begin-new-run').focused).toBe(true);
    // icon-first-ui-density SESSION-06 — every branch keeps its former
    // visible label verbatim on aria-label; visible textContent drops the
    // ornament in favor of the sprite icon.
    expect(byTestId(container, 'title-begin-new-run').getAttribute('aria-label')).toBe('◈ BEGIN NEW RUN');
    expect(byTestId(container, 'title-begin-new-run').textContent).toBe('BEGIN NEW RUN');
    expect(byTestId(container, 'title-run-library').getAttribute('aria-label')).toBe('◈ RUN LIBRARY');
    expect(byTestId(container, 'title-import-link').getAttribute('aria-label')).toBe('◈ IMPORT LINK');
    expect(byTestId(container, 'title-secondary-branches').children).toHaveLength(2);
    expect(byTestId(container, 'title-manual').textContent).toBe('MANUAL');
    expect(byTestId(container, 'title-manual').getAttribute('aria-label')).toBe('MANUAL');
    expect(byTestId(container, 'title-tutorial')).toBeNull();
    expect(byTestId(container, 'title-settings').textContent).toBe('SETTINGS');
    expect(byTestId(container, 'title-settings').getAttribute('aria-label')).toBe('SETTINGS');

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
    expect(byTestId(container, 'title-manual')).toBeTruthy();
    expect(byTestId(container, 'title-tutorial')).toBeNull();
  });

  it('MANUAL branch dispatches ui:manual-open in portrait and wide', async () => {
    const events = [];
    const off = bus.on('ui:manual-open', (payload) => events.push(payload));
    const { mount } = await import('../../src/ui/screens/title.js');

    const portrait = new FakeElement('div');
    const portraitController = mount(portrait);
    await byTestId(portrait, 'title-start').click();
    await byTestId(portrait, 'title-manual').click();

    installMatchMedia(true);
    const wide = new FakeElement('div');
    const wideController = mount(wide);
    await byTestId(wide, 'title-start').click();
    await byTestId(wide, 'title-manual').click();

    expect(events).toEqual([
      { target: null, source: 'title' },
      { target: null, source: 'title' }
    ]);
    portraitController.unmount();
    wideController.unmount();
    off();
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
    expect(byTestId(container, 'title-manual').textContent).toBe('MANUAL');
    expect(byTestId(container, 'title-tutorial')).toBeNull();

    await byTestId(container, 'title-start').click();
    expect(branches.classList.contains('hidden-branches')).toBe(false);
  });
});

describe('tutorial route retirement', () => {
  // SESSION-04 retires the tutorial as a reachable UX surface. The runtime
  // redirects both #a=tutorial deep-links and ui:navigate({screen: 'tutorial'})
  // to `title` + `ui:manual-open`. The physical src/ui/screens/tutorial.js
  // module stays on disk pending a follow-up session with wider lease (the
  // design-scan scanner map and its tooling test hard-reference the path);
  // the runtime never imports it. `ROUTES` MUST keep 'tutorial' so shipped
  // links continue to classify.
  it('the router still parses #a=tutorial as a route (runtime redirects to title + manual)', async () => {
    const { parseFragment, ROUTES } = await import('../../src/router.js');
    expect(ROUTES).toContain('tutorial');
    expect(parseFragment('#a=tutorial')).toEqual({ kind: 'route', route: 'tutorial', save: null, seed: null, from: null });
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

    const masterInput = byTestId(container, 'settings-master-volume-input');
    masterInput.value = '40';
    await masterInput.dispatch('input');

    const droneInput = byTestId(container, 'settings-volume-drone-input');
    droneInput.value = '23';
    await droneInput.dispatch('input');

    await byTestId(container, 'settings-motion-full').click();

    const textureInput = byTestId(container, 'settings-scanline-grain').children[1];
    textureInput.checked = false;
    await textureInput.dispatch('change');

    expect(loadSettings()).toMatchObject({
      masterMute: true,
      masterVolume: 40,
      layerVolumes: { drone: 23, pulse: 75, sparkle: 100, lead: 75, noiseBed: 11 },
      glitchEnabled: true,
      reducedMotion: 'full',
      scanlineGrainEnabled: false
    });
    // SESSION-05 — bus.js SETTING_KEYS whitelist now includes 'masterVolume',
    // so the MASTER slider input dispatches through the real bus end-to-end.
    expect(changes).toEqual(expect.arrayContaining([
      { key: 'mute', value: true },
      { key: 'masterVolume', value: 40 },
      { key: 'volume:drone', value: 23 },
      { key: 'reducedMotion', value: 'full' },
      { key: 'scanlineGrain', value: false }
    ]));
    expect(allText(container)).not.toContain('VERSION 1.0');

    const motionGroup = byTestId(container, 'settings-motion-options');
    expect(motionGroup.getAttribute('role')).toBe('radiogroup');
    expect(motionGroup.getAttribute('aria-label')).toBe('Reduced-motion override');
    for (const value of ['system', 'reduce', 'full']) {
      const option = byTestId(container, `settings-motion-${value}`);
      expect(option.getAttribute('role')).toBe('radio');
      expect(option.getAttribute('aria-selected')).toBe(String(value === 'full'));
      expect(option.getAttribute('aria-checked')).toBe(String(value === 'full'));
      expect(option.getAttribute('aria-pressed')).toBe(String(value === 'full'));
    }

    // icon-first-ui-density SESSION-06 — BACK is icon-only. aria-label
    // preserves the former visible label so getByRole(name:)/getByLabel e2e
    // (portrait-usability, keyboard-flow, navigation-history, adaptive-layout)
    // continue to resolve it. Visible text collapses to empty.
    const back = byTestId(container, 'settings-back');
    expect(back.tagName).toBe('BUTTON');
    expect(back.getAttribute('aria-label')).toBe('BACK');
    expect(back.textContent).toBe('');
    expect(back.classList.contains('icon-only')).toBe(true);
    await back.click();
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
    const master = byTestId(container, 'settings-master-volume');
    expect(master).toBeTruthy();
    let node = master.parentNode;
    while (node && node.dataset?.testid !== 'settings-audio-column') node = node.parentNode;
    expect(node?.dataset?.testid).toBe('settings-audio-column');
    expect(byTestId(container, 'settings-glitch').parentNode.classList.contains('panel')).toBe(true);
  });

  it('the OPERATOR\'S MANUAL row dispatches ui:manual-open with target=settings_help', async () => {
    const events = [];
    const off = bus.on('ui:manual-open', (payload) => events.push(payload));
    const { mount } = await import('../../src/ui/screens/settings.js');

    const portrait = new FakeElement('div');
    const portraitController = mount(portrait);
    const portraitButton = byTestId(portrait, 'settings-manual');
    expect(portraitButton).toBeTruthy();
    expect(portraitButton.textContent).toBe("OPERATOR'S MANUAL");
    await portraitButton.click();

    installMatchMedia(true);
    const wide = new FakeElement('div');
    const wideController = mount(wide);
    const wideButton = byTestId(wide, 'settings-manual');
    expect(wideButton).toBeTruthy();
    await wideButton.click();

    expect(events).toEqual([
      { target: 'settings_help', source: 'settings' },
      { target: 'settings_help', source: 'settings' }
    ]);
    portraitController.unmount();
    wideController.unmount();
    off();
  });
});

describe('runtime update surfacing', () => {
  it('dispatching runtime:update-ready mounts exactly one toast whose RELOAD button calls window.location.reload', async () => {
    let reloadCalls = 0;
    globalThis.window = globalThis.window || {};
    globalThis.window.location = { reload: () => { reloadCalls += 1; } };

    // Importing runtime.js registers the update-toast bus subscription at
    // module load. Setting __odSkipBoot keeps main.js from firing its runtime
    // dynamic-import boot path when it loads as a transitive dependency.
    globalThis.__odSkipBoot = true;
    await import('../../src/runtime.js');

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
