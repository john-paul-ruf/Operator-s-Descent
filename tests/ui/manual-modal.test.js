import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManualModal } from '../../src/ui/manual/manual-modal.js';
import { createManualView } from '../../src/ui/manual/manual-view.js';

const MANUAL_JSON = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/manual.json', import.meta.url)), 'utf8'));

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) {
    const next = force == null ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name); else this.values.delete(name);
    this.sync();
    return next;
  }
  contains(name) { return this.values.has(name); }
  sync() { this.element._className = [...this.values].join(' '); }
}

let currentDocument = null;

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
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
    this.hidden = false;
    this.tabIndex = -1;
    this.parentNode = null;
    this.focused = false;
    this.isConnected = true;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
  }
  set className(value) {
    this._className = String(value);
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() { return this._className; }
  appendChild(child) {
    child.parentNode = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    child.parentNode = null;
    child.isConnected = false;
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) { child.parentNode = null; child.isConnected = false; }
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener));
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, target: this, preventDefault() { this.prevented = true; }, ...event });
    }
  }
  click() { if (this.disabled) return; this.dispatch('click'); }
  focus() {
    this.focused = true;
    if (currentDocument) currentDocument.activeElement = this;
  }
  contains(node) {
    if (!node) return false;
    if (node === this) return true;
    for (const child of this.children) if (child.contains?.(node)) return true;
    return false;
  }
  querySelectorAll(selector) {
    // Extremely small subset — handles the selectors used by the modal:
    // '[data-glitch]' (with any attribute value) and the focusable set.
    const results = [];
    const walk = (node) => {
      if (matchesSelector(node, selector)) results.push(node);
      for (const child of node.children || []) walk(child);
    };
    for (const child of this.children) walk(child);
    return results;
  }
}

function matchesSelector(node, selector) {
  if (!node || !selector) return false;
  // Any single simple selector clause we care about.
  const clauses = selector.split(',').map((clause) => clause.trim());
  for (const clause of clauses) {
    if (matchesSingle(node, clause)) return true;
  }
  return false;
}

function matchesSingle(node, clause) {
  if (clause === 'button') return node.tagName === 'BUTTON';
  if (clause === 'input') return node.tagName === 'INPUT';
  if (clause === 'select') return node.tagName === 'SELECT';
  if (clause === 'textarea') return node.tagName === 'TEXTAREA';
  if (clause === '[href]') return node.hasAttribute?.('href');
  if (clause === '[tabindex]') return node.hasAttribute?.('tabindex');
  if (clause === '[data-glitch]') return Object.hasOwn(node.dataset || {}, 'glitch');
  return false;
}

function findById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
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
  const listeners = new Map();
  const doc = {
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: (id) => findById(documentElement, id),
    documentElement,
    activeElement: null,
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) || []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) || []).filter((candidate) => candidate !== handler));
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) handler({ type, ...event });
    }
  };
  globalThis.document = doc;
  currentDocument = doc;
  return { appRoot, portraitFrame, doc };
}

function byTestId(root, testid) {
  if (!root) return null;
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
    if (found) return found;
  }
  return null;
}

function collectByTestId(root, testid, matches = []) {
  if (!root) return matches;
  if (root.dataset?.testid === testid) matches.push(root);
  for (const child of root.children || []) collectByTestId(child, testid, matches);
  return matches;
}

function makeBus() {
  const events = [];
  return {
    events,
    dispatch(event, payload) { events.push([event, payload]); }
  };
}

function makeInvoker(doc) {
  const invoker = new FakeElement('button');
  invoker.id = 'invoker';
  doc.getElementById = ((original) => (id) => id === 'invoker' ? invoker : original(id))(doc.getElementById);
  doc.activeElement = invoker;
  return invoker;
}

const SAMPLE_MANUAL = {
  version: 1,
  sections: [
    {
      id: 'move_mode',
      chapter: 'interface',
      group: null,
      title: 'MOVE Mode',
      body: [[
        ['text', 'Walk the '],
        ['link', 'the_map', 'map'],
        ['text', '.']
      ]],
      seeAlso: ['the_map', 'burning']
    },
    {
      id: 'the_map',
      chapter: 'interface',
      group: null,
      title: 'The Map',
      body: [[['text', 'The map is live.']]],
      seeAlso: ['move_mode']
    },
    {
      id: 'burning',
      chapter: 'glossary',
      group: 'conditions',
      title: 'Burning',
      body: [[['text', 'Damage over time.']]],
      seeAlso: []
    },
    {
      id: 'ward',
      chapter: 'glossary',
      group: 'schools',
      title: 'Ward',
      body: [[['text', 'Defensive protocols.']]],
      seeAlso: []
    }
  ]
};

let portraitFrame;
let appRoot;
let doc;
let bus;

beforeEach(() => {
  const install = installDocument();
  appRoot = install.appRoot;
  portraitFrame = install.portraitFrame;
  doc = install.doc;
  bus = makeBus();
});

afterEach(() => {
  delete globalThis.document;
  currentDocument = null;
  vi.restoreAllMocks();
});

describe('createManualModal — shell (CP1)', () => {
  function makeModal({ manual = SAMPLE_MANUAL, glitch = null, createView } = {}) {
    return createManualModal({
      bus,
      getManualData: () => manual,
      parent: portraitFrame,
      glitch,
      createView
    });
  }

  it('lazily builds DOM on first open and mounts as a sibling of #app-root', () => {
    const modal = makeModal();
    expect(modal.element).toBeNull();
    expect(portraitFrame.children).toHaveLength(1); // #app-root only

    modal.open({ target: null, source: 'test' });

    expect(modal.isOpen()).toBe(true);
    expect(modal.element).toBeTruthy();
    expect(modal.element.parentNode).toBe(portraitFrame);
    expect(portraitFrame.children).toContain(modal.element);
    expect(portraitFrame.children).toContain(appRoot);

    const modalRoot = byTestId(portraitFrame, 'manual-backdrop');
    expect(modalRoot).toBeTruthy();
    expect(modalRoot.hidden).toBe(false);
    const panel = byTestId(portraitFrame, 'manual-modal');
    expect(panel).toBeTruthy();
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe("Operator's manual");
  });

  it('sets aria-hidden on #app-root and focuses the close button on open', () => {
    const invoker = makeInvoker(doc);
    doc.activeElement = invoker;

    const modal = makeModal();
    modal.open({ target: null, source: 'test' });

    expect(appRoot.getAttribute('aria-hidden')).toBe('true');
    const closeBtn = byTestId(portraitFrame, 'manual-close');
    expect(closeBtn.focused).toBe(true);
    expect(doc.activeElement).toBe(closeBtn);
  });

  it('Escape closes the modal with reason=escape and dispatches ui:manual-close', () => {
    const modal = makeModal();
    modal.open({ target: null, source: 'test' });
    const backdrop = byTestId(portraitFrame, 'manual-backdrop');

    backdrop.dispatch('keydown', { key: 'Escape' });

    expect(modal.isOpen()).toBe(false);
    expect(bus.events).toContainEqual(['ui:manual-close', { reason: 'escape' }]);
    expect(backdrop.hidden).toBe(true);
  });

  it('close-button click closes the modal with reason=close-button', () => {
    const modal = makeModal();
    modal.open({ target: null, source: 'test' });

    byTestId(portraitFrame, 'manual-close').click();

    expect(modal.isOpen()).toBe(false);
    expect(bus.events).toContainEqual(['ui:manual-close', { reason: 'close-button' }]);
  });

  it('backdrop click closes with reason=backdrop; panel-click does NOT close', () => {
    const modal = makeModal();
    modal.open({ target: null, source: 'test' });
    const backdrop = byTestId(portraitFrame, 'manual-backdrop');
    const panel = byTestId(portraitFrame, 'manual-modal');

    // Panel clicks are inside the modal — never close.
    backdrop.dispatch('click', { target: panel });
    expect(modal.isOpen()).toBe(true);
    expect(bus.events.some(([event]) => event === 'ui:manual-close')).toBe(false);

    // Backdrop click (target === backdrop) closes.
    backdrop.dispatch('click', { target: backdrop });
    expect(modal.isOpen()).toBe(false);
    expect(bus.events).toContainEqual(['ui:manual-close', { reason: 'backdrop' }]);
  });

  it('restores focus to the invoker on close and clears aria-hidden on #app-root', () => {
    const invoker = makeInvoker(doc);
    doc.activeElement = invoker;

    const modal = makeModal();
    modal.open({ target: null, source: 'test' });
    expect(appRoot.getAttribute('aria-hidden')).toBe('true');

    // Simulate close button focus mutation
    doc.activeElement = byTestId(portraitFrame, 'manual-close');
    invoker.focused = false;

    modal.close('programmatic');

    expect(invoker.focused).toBe(true);
    expect(appRoot.getAttribute('aria-hidden')).toBeNull();
    expect(bus.events).toContainEqual(['ui:manual-close', { reason: 'programmatic' }]);
  });

  it('reopen after close reuses the same root and re-arms handlers', () => {
    const modal = makeModal();
    modal.open({ target: null, source: 'first' });
    const firstRoot = modal.element;

    byTestId(portraitFrame, 'manual-close').click();
    expect(modal.isOpen()).toBe(false);

    modal.open({ target: 'move_mode', source: 'second' });
    expect(modal.element).toBe(firstRoot);
    expect(modal.element.hidden).toBe(false);
    expect(modal.isOpen()).toBe(true);

    // Escape after reopen still works
    byTestId(portraitFrame, 'manual-backdrop').dispatch('keydown', { key: 'Escape' });
    expect(modal.isOpen()).toBe(false);
    // Two close events across the two cycles
    expect(bus.events.filter(([event]) => event === 'ui:manual-close')).toHaveLength(2);
  });

  it('destroy removes the modal DOM and detaches listeners', () => {
    const modal = makeModal();
    modal.open({ target: null });
    const root = modal.element;

    modal.destroy();

    expect(modal.element).toBeNull();
    expect(root.parentNode).toBeNull();
    expect(portraitFrame.children).not.toContain(root);
    expect(modal.isOpen()).toBe(false);
  });

  it('destroy while open dispatches a programmatic close before teardown', () => {
    const modal = makeModal();
    modal.open({ target: null });

    modal.destroy();

    expect(bus.events).toContainEqual(['ui:manual-close', { reason: 'programmatic' }]);
  });

  it('registers [data-glitch] descendants on open and unregisters on close', () => {
    const registered = new Set();
    const glitch = {
      registerElement: (el, intensity) => { registered.add(el); el._intensity = intensity; },
      unregisterElement: (el) => { registered.delete(el); }
    };
    const modal = makeModal({ glitch });

    modal.open({ target: null });
    expect(registered.size).toBeGreaterThan(0);
    for (const el of registered) expect(Object.hasOwn(el.dataset, 'glitch')).toBe(true);

    modal.close('programmatic');
    expect(registered.size).toBe(0);
  });

  it('opens directly to a specific section when target is provided', () => {
    const modal = makeModal();
    modal.open({ target: 'move_mode', source: 'link' });

    const section = byTestId(portraitFrame, 'manual-section');
    expect(section).toBeTruthy();
    expect(section.dataset.sectionId).toBe('move_mode');
    expect(byTestId(portraitFrame, 'manual-section-title').textContent).toBe('MOVE Mode');
  });

  it('opens to the TOC when no target is provided', () => {
    const modal = makeModal();
    modal.open({ target: null });
    expect(byTestId(portraitFrame, 'manual-toc')).toBeTruthy();
    expect(byTestId(portraitFrame, 'manual-section')).toBeNull();
  });

  it('accepts an injected createView (for future extensibility)', () => {
    const fake = { element: doc.createElement('div'), showSection: vi.fn(), showTOC: vi.fn(), back: vi.fn(), canBack: () => false, setManual: vi.fn(), destroy: vi.fn() };
    fake.element.dataset.testid = 'fake-view';
    const modal = makeModal({ createView: () => fake });
    modal.open({ target: 'move_mode' });
    expect(fake.showSection).toHaveBeenCalledWith('move_mode');
    expect(byTestId(portraitFrame, 'fake-view')).toBeTruthy();
    modal.destroy();
    expect(fake.destroy).toHaveBeenCalled();
  });
});

describe('createManualView — TOC + section + back stack (CP2)', () => {
  function makeView({ manual = SAMPLE_MANUAL, dispatch = vi.fn(), onNavigate = vi.fn() } = {}) {
    return { view: createManualView({ manual, dispatch, onNavigate }), dispatch, onNavigate };
  }

  it('showTOC renders every section id grouped by chapter and glossary group', () => {
    const { view, onNavigate } = makeView();
    view.showTOC();

    const toc = byTestId(view.element, 'manual-toc');
    expect(toc).toBeTruthy();

    expect(byTestId(view.element, 'manual-chapter-interface')).toBeTruthy();
    expect(byTestId(view.element, 'manual-chapter-glossary')).toBeTruthy();
    expect(byTestId(view.element, 'manual-group-conditions')).toBeTruthy();
    expect(byTestId(view.element, 'manual-group-schools')).toBeTruthy();

    const links = collectByTestId(view.element, undefined);
    // Every section id should appear as a data-manual-target somewhere.
    const targets = new Set();
    (function walk(node) {
      const value = node.getAttribute?.('data-manual-target');
      if (value) targets.add(value);
      for (const child of node.children || []) walk(child);
    })(view.element);
    expect(targets).toEqual(new Set(SAMPLE_MANUAL.sections.map((section) => section.id)));

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ sectionId: null }));
  });

  it('showSection renders title, paragraphs, links, and see-also chips', () => {
    const { view, onNavigate } = makeView();
    view.showSection('move_mode');

    expect(byTestId(view.element, 'manual-section-title').textContent).toBe('MOVE Mode');
    const seeAlso = byTestId(view.element, 'manual-see-also');
    expect(seeAlso).toBeTruthy();
    // A chip for each seeAlso id — plus the "See also:" label
    expect(seeAlso.children.length).toBe(1 + 2);

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ sectionId: 'move_mode', title: 'MOVE Mode' }));
  });

  it('unknown section id falls back to TOC and does not push to the back stack', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { view } = makeView();
    view.showSection('does_not_exist');

    expect(byTestId(view.element, 'manual-toc')).toBeTruthy();
    expect(view.canBack()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('internal link click navigates without dispatching to the external bus', () => {
    const { view, dispatch } = makeView();
    view.showSection('move_mode');

    // Find the inline link in the paragraph pointing at the_map
    const link = (function find(node) {
      if (node.getAttribute?.('data-manual-target') === 'the_map' && node.tagName === 'BUTTON') return node;
      for (const child of node.children || []) { const found = find(child); if (found) return found; }
      return null;
    })(view.element);
    expect(link).toBeTruthy();
    link.dispatch('click');

    expect(byTestId(view.element, 'manual-section-title').textContent).toBe('The Map');
    // No bus dispatch — internal-only navigation.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('back stack: TOC → A → B → back returns to A, back again returns to TOC', () => {
    const { view } = makeView();
    view.showTOC();
    view.showSection('move_mode');
    view.showSection('the_map');
    expect(view.canBack()).toBe(true);

    view.back();
    expect(byTestId(view.element, 'manual-section-title').textContent).toBe('MOVE Mode');
    expect(view.canBack()).toBe(true);

    view.back();
    expect(byTestId(view.element, 'manual-toc')).toBeTruthy();
    expect(view.canBack()).toBe(false);
  });

  it('back() at empty stack is a no-op', () => {
    const { view } = makeView();
    view.showTOC();
    expect(() => view.back()).not.toThrow();
    expect(view.canBack()).toBe(false);
  });

  it('scroll positions round-trip through captureScroll/restoreScroll per section', () => {
    const { view } = makeView();
    view.showSection('move_mode');
    view.element.scrollTop = 42;
    view.element.scrollHeight = 200;
    view.element.clientHeight = 100;

    view.showSection('the_map');
    // After navigating away, capture happened; new render begins at 0
    expect(view.element.scrollTop).toBe(0);
    view.element.scrollHeight = 200;
    view.element.clientHeight = 100;

    view.back();
    // Back to move_mode — scrollTop restored to captured 42
    expect(view.element.scrollTop).toBe(42);
  });

  it('setManual re-renders with the new manual data', () => {
    const { view } = makeView({ manual: null });
    view.showTOC();
    expect(byTestId(view.element, 'manual-notice')).toBeTruthy();

    view.setManual(SAMPLE_MANUAL);
    expect(byTestId(view.element, 'manual-notice')).toBeNull();
    expect(byTestId(view.element, 'manual-toc')).toBeTruthy();
    expect(byTestId(view.element, 'manual-chapter-interface')).toBeTruthy();
  });

  it('destroy() clears listeners and back stack', () => {
    const { view } = makeView();
    view.showSection('move_mode');
    view.showSection('the_map');
    expect(view.canBack()).toBe(true);

    view.destroy();
    expect(view.canBack()).toBe(false);
  });
});

describe('createManualView — real data/manual.json coverage (CP2)', () => {
  function makeView() {
    return createManualView({ manual: MANUAL_JSON, dispatch: vi.fn(), onNavigate: vi.fn() });
  }

  it('renders every one of the shipped 62 sections without throwing', () => {
    const view = makeView();
    for (const section of MANUAL_JSON.sections) {
      expect(() => view.showSection(section.id)).not.toThrow();
      const title = byTestId(view.element, 'manual-section-title');
      expect(title).toBeTruthy();
      expect(title.textContent).toBe(section.title);
      expect(byTestId(view.element, 'manual-section').dataset.sectionId).toBe(section.id);
    }
  });

  it('TOC contains every section id from the shipped manual', () => {
    const view = makeView();
    view.showTOC();
    const targets = new Set();
    (function walk(node) {
      const value = node.getAttribute?.('data-manual-target');
      if (value) targets.add(value);
      for (const child of node.children || []) walk(child);
    })(view.element);
    expect(targets).toEqual(new Set(MANUAL_JSON.sections.map((section) => section.id)));
    expect(targets.size).toBe(62);
  });

  it('every internal link target resolves inside the manual', () => {
    const ids = new Set(MANUAL_JSON.sections.map((section) => section.id));
    for (const section of MANUAL_JSON.sections) {
      for (const paragraph of section.body || []) {
        for (const run of paragraph || []) {
          if (Array.isArray(run) && run[0] === 'link') expect(ids.has(run[1])).toBe(true);
        }
      }
      for (const target of section.seeAlso || []) expect(ids.has(target)).toBe(true);
    }
  });

  it('every rendered section-body link click navigates without dispatching to the external bus', () => {
    const dispatch = vi.fn();
    const view = createManualView({ manual: MANUAL_JSON, dispatch, onNavigate: vi.fn() });
    for (const section of MANUAL_JSON.sections) {
      view.showSection(section.id);
      const linkNodes = [];
      (function walk(node) {
        if (node.getAttribute?.('data-manual-target') && node.tagName === 'BUTTON') linkNodes.push(node);
        for (const child of node.children || []) walk(child);
      })(view.element);
      for (const link of linkNodes) {
        expect(() => link.dispatch('click')).not.toThrow();
      }
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('bus event contracts — ui:manual-open / ui:manual-close (CP3)', () => {
  it('ui:manual-open validates target as sectionId|null and source as non-empty string', async () => {
    const { EVENT_CONTRACTS } = await import('../../src/state/bus.js');
    const contract = EVENT_CONTRACTS['ui:manual-open'];
    expect(contract).toBeTruthy();
    expect(contract.validate({ target: 'move_mode', source: 'party' })).toBe(true);
    expect(contract.validate({ target: null, source: 'title' })).toBe(true);
    expect(contract.validate({ target: '', source: 'title' })).toBe(false);
    expect(contract.validate({ target: 42, source: 'title' })).toBe(false);
    expect(contract.validate({ target: 'x' })).toBe(false);
    expect(contract.validate({ target: 'x', source: '' })).toBe(false);
    expect(contract.validate(null)).toBe(false);
  });

  it('ui:manual-close validates the reason enum', async () => {
    const { EVENT_CONTRACTS } = await import('../../src/state/bus.js');
    const contract = EVENT_CONTRACTS['ui:manual-close'];
    expect(contract).toBeTruthy();
    for (const reason of ['escape', 'close-button', 'backdrop', 'programmatic']) {
      expect(contract.validate({ reason })).toBe(true);
    }
    expect(contract.validate({ reason: 'other' })).toBe(false);
    expect(contract.validate({})).toBe(false);
    expect(contract.validate(null)).toBe(false);
  });
});
