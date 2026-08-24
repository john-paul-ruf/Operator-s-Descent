import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { deleteRunState, listRuns, loadRun, loadSettings, saveRun } from '../../src/state/library.js';
import { base64urlEncode, crc32, encodeRun, encodeSeed, initEncoder, SAVE_VERSION } from '../../src/state/save-encode.js';
import { decodeSeed } from '../../src/state/save-decode.js';
import { encrypt } from '../../src/state/encrypt.js';
import { createBitWriter } from '../../src/state/bit-codec.js';
import { createRunState } from '../../src/state/run-state.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { makeParty } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

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
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (!child) continue;
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
    const baseEvent = {
      type,
      target: this,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      key: event.key,
      ...event
    };
    for (const listener of this.listeners.get(type) || []) await listener(baseEvent);
  }
  click() { return this.disabled ? Promise.resolve() : this.dispatch('click'); }
  focus() { this.focused = true; }
}

function installDocument() {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_ns, tagName) => new FakeElement(tagName),
    createTextNode: (text) => ({ nodeType: 3, nodeValue: String(text) }),
    getElementById: () => null,
    documentElement: new FakeElement('html')
  };
  Object.defineProperty(globalThis, 'window', {
    value: { location: { href: 'http://127.0.0.1:8080/', origin: 'http://127.0.0.1:8080', pathname: '/index.html' } },
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: vi.fn(() => Promise.resolve()) } },
    configurable: true,
    writable: true
  });
}

function installMatchMedia(match) {
  globalThis.window = globalThis.window || {};
  globalThis.window.matchMedia = () => ({ matches: Boolean(match), addEventListener() {}, removeEventListener() {} });
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
    if (found) return found;
  }
  return null;
}

function allText(root) {
  return [root.textContent, ...(root.children || []).flatMap((child) => allText(child))].filter(Boolean);
}

function collect(root, predicate, matches = []) {
  if (predicate(root)) matches.push(root);
  for (const child of root.children || []) collect(child, predicate, matches);
  return matches;
}

// Icon assertion helper: verifies a button has an SVG child whose <use> element
// points at the expected sprite id. Icons are prefixed by components.js
// prefixIcon(); the FakeElement in this file honors createElementNS + prepend
// so the SVG structure is present.
function iconUseId(button) {
  const svg = collect(button, (el) => el.tagName === 'SVG')[0];
  if (!svg) return null;
  const use = svg.children.find((child) => child.tagName === 'USE');
  const href = use?.getAttribute('href') || '';
  const hash = href.indexOf('#');
  return hash >= 0 ? href.slice(hash + 1) : null;
}

function makeState(seed, timestamp, depth = 1) {
  const state = createRunState(seed, makeParty(2), { creationTimestamp: timestamp });
  state.depth = depth;
  state.party[0].classId = 'breacher';
  state.party[0].sigilCodepoint = 0xe000;
  state.party[1].classId = 'ghost';
  state.party[1].sigilCodepoint = 0xe008;
  state.scrapCounter = 12;
  return state;
}

function setEntryLastPlayed(key, lastPlayed) {
  const entries = JSON.parse(localStorage.getItem('od_runs'));
  const entry = entries.find((candidate) => candidate.key === key);
  entry.lastPlayed = lastPlayed;
  localStorage.setItem('od_runs', JSON.stringify(entries));
}

function writeUint32(bytes, offset, value) {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}

function writeUint16(bytes, offset, value) {
  new DataView(bytes.buffer).setUint16(offset, value, true);
}

function frameWithHeader(seed, options = {}) {
  const data = options.data || new Uint8Array();
  const frame = new Uint8Array(14 + data.length + 4);
  frame[0] = 0x4f;
  frame[1] = 0x44;
  frame[2] = options.version ?? SAVE_VERSION;
  writeUint16(frame, 3, 1);
  writeUint32(frame, 5, seed >>> 0);
  writeUint32(frame, 9, options.bitLength ?? data.length * 8);
  frame[13] = 0;
  frame.set(data, 14);
  writeUint32(frame, frame.length - 4, options.badChecksum ? 0 : crc32(frame.slice(0, -4)));
  return base64urlEncode(frame);
}

// A well-formed v2 frame whose payload advertises a schemaVersion no reader
// is registered for; exercises the payload-level seed-recovery path.
function futureSchemaFragment(seed, futureSchemaVersion) {
  const writer = createBitWriter();
  writer.writeUint(futureSchemaVersion, 8);
  writer.writeUint(1, 16);
  writer.writeUint(seed >>> 0, 32);
  writer.writeUint(0, 8);
  const payload = writer.toUint8Array();
  const bitLength = writer.bitLength;
  const encrypted = encrypt(payload, SAVE_VERSION);
  const frame = new Uint8Array(14 + encrypted.length + 4);
  frame[0] = 0x4f;
  frame[1] = 0x44;
  frame[2] = SAVE_VERSION;
  writeUint16(frame, 3, 1);
  writeUint32(frame, 5, seed >>> 0);
  writeUint32(frame, 9, bitLength);
  frame[13] = 0;
  frame.set(encrypted, 14);
  writeUint32(frame, frame.length - 4, crc32(frame.slice(0, -4)));
  return base64urlEncode(frame);
}

beforeAll(() => initEncoder(loadData('symbol-table')));

let storage;

beforeEach(() => {
  installDocument();
  storage = installMockStorage();
});

afterEach(() => {
  storage?.uninstall?.();
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.navigator;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('run library screen', () => {
  it('sorts living runs, quarantines broken saves, resumes, and deletes local state', async () => {
    const first = saveRun(makeState(111, 100, 3), { accentSwatch: '#112233', theme: 'archive' });
    const second = saveRun(makeState(222, 200, 7), { accentSwatch: '#445566', theme: 'foundry' });
    const dead = saveRun(makeState(333, 300, 9));
    deleteRunState(dead.key);
    setEntryLastPlayed(first.key, 1000);
    setEntryLastPlayed(second.key, 2000);
    const entries = JSON.parse(localStorage.getItem('od_runs'));
    entries.push({ key: '999_9', worldSeed: 999, creationTimestamp: 9, depth: 4, partySigils: [0xe000], partyClasses: ['oracle'], accentSwatch: '#abcdef', alive: true, lastPlayed: 3000 });
    localStorage.setItem('od_runs', JSON.stringify(entries));
    localStorage.setItem('od_run_999_9', 'broken-state');

    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/library.js');
    const container = new FakeElement('div');
    mount(container);

    const eyebrow = collect(container, (el) => el.classList.contains('micro') && el.textContent.includes('RUN LIBRARY'))[0];
    expect(eyebrow.getAttribute('role')).toBe('heading');
    expect(eyebrow.getAttribute('aria-level')).toBe('1');

    const text = allText(container).join(' ');
    expect(text).toContain('QUARANTINED — MALFORMED');
    expect(text).toContain('SEED 222');
    expect(text).toContain('DEPTH 7');
    expect(text).toContain('CLASSES BREACHER / GHOST');
    expect(text).not.toContain('SEED 333');
    expect(allText(byTestId(container, 'library-list')).join(' ')).toMatch(/SEED 999.*SEED 222.*SEED 111/);
    expect(byTestId(container, 'library-list').classList.contains('screen-body')).toBe(true);
    expect(byTestId(container, `run-row-${second.key}`).classList.contains('run-row')).toBe(true);
    expect(byTestId(container, `run-resume-${second.key}`).classList.contains('primary')).toBe(true);

    const portraitResume = byTestId(container, `run-resume-${second.key}`);
    expect(portraitResume.classList.contains('icon-only')).toBe(true);
    expect(portraitResume.getAttribute('aria-label')).toBe('RESUME');
    expect(iconUseId(portraitResume)).toBe('chevron-right');
    const portraitDelete = byTestId(container, `run-delete-${second.key}`);
    expect(portraitDelete.classList.contains('has-icon')).toBe(true);
    expect(portraitDelete.classList.contains('btn-danger')).toBe(true);
    expect(portraitDelete.getAttribute('aria-label')).toBe('DELETE LOCAL STATE');
    expect(iconUseId(portraitDelete)).toBe('x');
    const portraitNewRun = byTestId(container, 'library-new-run');
    expect(portraitNewRun.getAttribute('aria-label')).toBe('NEW RUN');
    expect(iconUseId(portraitNewRun)).toBe('chevron-right');
    const portraitTitle = byTestId(container, 'library-title');
    expect(portraitTitle.classList.contains('icon-only')).toBe(true);
    expect(portraitTitle.getAttribute('aria-label')).toBe('TITLE');
    expect(iconUseId(portraitTitle)).toBe('arrow-left');

    await byTestId(container, `run-resume-${second.key}`).click();
    expect(seen.at(-1)).toMatchObject({ screen: 'exploration', params: { resume: true, runState: expect.objectContaining({ worldSeed: 222, depth: 7 }) } });

    await byTestId(container, `run-delete-${second.key}`).click();
    expect(loadRun(second.key)).toEqual({ success: false, error: 'not_found' });
    expect(listRuns().map((entry) => entry.key)).not.toContain(second.key);
    off();
  });

  it('shows an explicit empty state when no living runs remain', async () => {
    const saved = saveRun(makeState(444, 400));
    deleteRunState(saved.key);
    const { mount } = await import('../../src/ui/screens/library.js');
    const container = new FakeElement('div');
    mount(container);

    expect(byTestId(container, 'library-empty')).toBeTruthy();
    expect(allText(container)).toContain('NO LIVING RUNS');
  });

  it('renders the wide-layout library as a run-card grid with explicit resume and delete buttons', async () => {
    installMatchMedia(true);
    const first = saveRun(makeState(111, 100, 3), { accentSwatch: '#112233', theme: 'archive' });
    const second = saveRun(makeState(222, 200, 7), { accentSwatch: '#445566', theme: 'foundry' });
    setEntryLastPlayed(first.key, 1000);
    setEntryLastPlayed(second.key, 2000);

    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/library.js');
    const container = new FakeElement('div');
    mount(container);

    const screen = container.children[0];
    expect(screen.classList.contains('wide-library-shell')).toBe(true);
    expect(screen.dataset.wideRoot).toBe('');

    const grid = byTestId(container, 'library-grid');
    expect(grid).toBeTruthy();
    expect(grid.classList.contains('wide-library-grid')).toBe(true);
    // Two run-cards + one no-limit hint card.
    expect(grid.children).toHaveLength(3);
    const card = byTestId(container, `run-row-${second.key}`);
    expect(card.classList.contains('run-card')).toBe(true);
    const resumeButton = byTestId(container, `run-resume-${second.key}`);
    expect(resumeButton.classList.contains('primary')).toBe(true);
    const deleteButton = byTestId(container, `run-delete-${second.key}`);
    expect(deleteButton.classList.contains('btn-danger')).toBe(true);

    expect(resumeButton.classList.contains('icon-only')).toBe(true);
    expect(resumeButton.getAttribute('aria-label')).toBe('◈ RESUME');
    expect(iconUseId(resumeButton)).toBe('chevron-right');
    expect(deleteButton.classList.contains('has-icon')).toBe(true);
    expect(deleteButton.getAttribute('aria-label')).toBe('DELETE');
    expect(iconUseId(deleteButton)).toBe('x');
    const wideNewRun = byTestId(container, 'library-new-run');
    expect(wideNewRun.getAttribute('aria-label')).toBe('◈ NEW RUN');
    expect(iconUseId(wideNewRun)).toBe('chevron-right');
    const wideTitle = byTestId(container, 'library-title');
    expect(wideTitle.classList.contains('icon-only')).toBe(true);
    expect(wideTitle.getAttribute('aria-label')).toBe('◀ TITLE');
    expect(iconUseId(wideTitle)).toBe('arrow-left');

    await resumeButton.click();
    expect(seen.at(-1)).toMatchObject({ screen: 'exploration', params: { resume: true, runState: expect.objectContaining({ worldSeed: 222, depth: 7 }) } });
    off();
  });
});

describe('import screen', () => {
  it('parses seed URLs and full run links without injecting pasted text', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/import.js');
    const container = new FakeElement('div');
    mount(container);

    expect(byTestId(container, 'import-input').parentNode.classList.contains('screen-body')).toBe(true);

    const eyebrow = collect(container, (el) => el.classList.contains('micro') && el.textContent.includes('IMPORT LINK'))[0];
    expect(eyebrow.getAttribute('role')).toBe('heading');
    expect(eyebrow.getAttribute('aria-level')).toBe('1');

    const importBtn = byTestId(container, 'import-submit');
    expect(importBtn.classList.contains('icon-only')).toBe(true);
    expect(importBtn.getAttribute('aria-label')).toBe('IMPORT');
    expect(iconUseId(importBtn)).toBe('download');
    const returnTitle = byTestId(container, 'import-return-title');
    expect(returnTitle.getAttribute('aria-label')).toBe('RETURN TO TITLE');
    expect(iconUseId(returnTitle)).toBe('arrow-left');

    byTestId(container, 'import-input').value = `https://example.test/play/#w=${encodeSeed(987)}`;
    await byTestId(container, 'import-submit').click();
    expect(seen.at(-1)).toEqual({ screen: 'creation', params: { preloadedSeed: 987 } });

    const runState = makeState(555, 1000, 6);
    const encoded = encodeRun(runState).fragment;
    byTestId(container, 'import-input').value = `#r=${encoded}`;
    await byTestId(container, 'import-submit').click();
    expect(byTestId(container, 'import-run-summary')).toBeTruthy();
    expect(allText(container).join(' ')).toContain('SEED 555 · DEPTH 6 · 2 MEMBERS');

    const resumeRun = byTestId(container, 'import-resume');
    expect(resumeRun.getAttribute('aria-label')).toBe('RESUME RUN');
    expect(iconUseId(resumeRun)).toBe('chevron-right');

    await byTestId(container, 'import-resume').click();
    expect(seen.at(-1)).toMatchObject({ screen: 'exploration', params: { resume: true, imported: true, originalCreationTimestamp: 1000, runState: expect.objectContaining({ worldSeed: 555, creationTimestamp: 1000 }) } });
    expect(listRuns().some((entry) => entry.key === '555_5000')).toBe(true);
    off();
  });

  it('surfaces all named failures and offers recovered-seed fresh runs only when authenticated', async () => {
    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/import.js');
    const container = new FakeElement('div');
    mount(container);

    const cases = [
      ['truncated', base64urlEncode(Uint8Array.of(0x4f, 0x44)), 'Truncated — the link was cut short.', false],
      ['version_mismatch', base64urlEncode(Uint8Array.of(0x4f, 0x44, 99)), 'Version mismatch — this link was made by a different version.', false],
      ['checksum_failed', frameWithHeader(123, { badChecksum: true }), 'Checksum failed — the link was corrupted in transit.', true],
      ['malformed', 'not-valid-*', 'Malformed — the link is not a valid save.', false]
    ];

    for (const [code, fragment, message, recoversSeed] of cases) {
      byTestId(container, 'import-input').value = `#r=${fragment}`;
      await byTestId(container, 'import-submit').click();
      expect(byTestId(container, `import-failure-${code}`)).toBeTruthy();
      expect(allText(container)).toContain(message);
      expect(Boolean(byTestId(container, 'import-fresh-world'))).toBe(recoversSeed);
    }

    byTestId(container, 'import-input').value = `#r=${frameWithHeader(321, { bitLength: 16, data: Uint8Array.of(1) })}`;
    await byTestId(container, 'import-submit').click();
    expect(byTestId(container, 'import-failure-malformed')).toBeTruthy();
    expect(byTestId(container, 'import-fresh-world')).toBeTruthy();
    const freshWorld = byTestId(container, 'import-fresh-world');
    expect(freshWorld.getAttribute('aria-label')).toBe('FRESH RUN IN THIS WORLD');
    expect(iconUseId(freshWorld)).toBe('chevron-right');
    const resultTitle = byTestId(container, 'import-return-title-result');
    expect(resultTitle.getAttribute('aria-label')).toBe('RETURN TO TITLE');
    expect(iconUseId(resultTitle)).toBe('arrow-left');
    await byTestId(container, 'import-fresh-world').click();
    expect(seen.at(-1)).toEqual({ screen: 'creation', params: { preloadedSeed: 321 } });

    await byTestId(container, 'import-return-title-result').click();
    expect(seen.at(-1)).toEqual({ screen: 'title', params: {} });
    off();
  });

  it('routes a future-schemaVersion save straight to creation with its recovered seed (never a version dead-end)', async () => {
    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/import.js');
    const container = new FakeElement('div');
    mount(container);

    byTestId(container, 'import-input').value = `#r=${futureSchemaFragment(654321, 99)}`;
    await byTestId(container, 'import-submit').click();
    expect(seen.at(-1)).toEqual({ screen: 'creation', params: { preloadedSeed: 654321 } });
    // No error panel and no "fresh run" button — the routing is direct.
    expect(byTestId(container, 'import-failure-version_mismatch')).toBeNull();
    expect(byTestId(container, 'import-fresh-world')).toBeNull();
    off();
  });
});

describe('settings screen', () => {
  it('renders a false-by-default, accessible haptics toggle and persists the changed value', async () => {
    const { mount } = await import('../../src/ui/screens/settings.js');
    const container = new FakeElement('div');
    mount(container);

    const haptics = byTestId(container, 'settings-haptics');
    expect(haptics).toBeTruthy();
    expect(haptics.classList.contains('toggle-row')).toBe(true);
    const hapticsInput = haptics.children[1];
    expect(hapticsInput.getAttribute('role')).toBe('switch');
    expect(hapticsInput.getAttribute('aria-label')).toBe('HAPTIC FEEDBACK');
    expect(hapticsInput.checked).toBe(false);
    expect(loadSettings().hapticsEnabled).toBe(false);

    hapticsInput.checked = true;
    await hapticsInput.dispatch('change');

    expect(loadSettings().hapticsEnabled).toBe(true);
  });
});

describe('scorecard screen', () => {
  it('deletes dead run state, displays wipe truth, and shares only seed links', async () => {
    const runState = makeState(777, 700, 12);
    runState.stats.floorsDescended = 11;
    runState.stats.enemiesSlain = 8;
    const saved = saveRun(runState);
    expect(loadRun(saved.key).success).toBe(true);

    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    mount(container, {
      runState,
      summary: { scrapRecovered: 42, creditsRemaining: 99 },
      causeOfDeath: 'Party Wipe'
    });

    expect(loadRun(saved.key)).toEqual({ success: false, error: 'not_found' });
    expect(listRuns()).toEqual([]);
    expect(allText(container)).toEqual(expect.arrayContaining([
      '12',
      'MUTABLE RUN STATE DELETED',
      'CAUSE OF DEATH: Party Wipe',
      'WORLD SEED: 777',
      'Scrap recovered',
      '42'
    ]));
    const shareField = byTestId(container, 'scorecard-share-link');
    const shareUrl = `http://127.0.0.1:8080/index.html#w=${encodeSeed(777)}`;
    expect(shareField.value).toBe(shareUrl);
    expect(shareField.getAttribute('readonly')).toBe('readonly');
    expect(allText(container).join(' ')).not.toContain('#r=');
    expect(byTestId(container, 'scorecard-roster').children[0].children[0].classList.contains('sigil-dead')).toBe(true);
    expect(byTestId(container, 'scorecard-library')).toBeTruthy();

    const copyBtn = byTestId(container, 'scorecard-copy-world');
    expect(copyBtn.getAttribute('aria-label')).toBe('SHARE WORLD LINK');
    expect(iconUseId(copyBtn)).toBe('link');
    const restartBtn = byTestId(container, 'scorecard-restart-seed');
    expect(restartBtn.getAttribute('aria-label')).toBe('RESTART SAME SEED');
    expect(iconUseId(restartBtn)).toBe('recycle');
    const scNewRun = byTestId(container, 'scorecard-new-run');
    expect(scNewRun.getAttribute('aria-label')).toBe('NEW RUN');
    expect(iconUseId(scNewRun)).toBe('chevron-right');
    const scTitle = byTestId(container, 'scorecard-title');
    expect(scTitle.classList.contains('icon-only')).toBe(true);
    expect(scTitle.getAttribute('aria-label')).toBe('TITLE');
    expect(iconUseId(scTitle)).toBe('arrow-left');
    const scLibrary = byTestId(container, 'scorecard-library');
    expect(scLibrary.classList.contains('icon-only')).toBe(true);
    expect(scLibrary.getAttribute('aria-label')).toBe('LIBRARY');
    expect(iconUseId(scLibrary)).toBe('archive');

    await byTestId(container, 'scorecard-copy-world').click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(shareUrl);
    await byTestId(container, 'scorecard-restart-seed').click();
    expect(seen.at(-1)).toEqual({ screen: 'creation', params: { preloadedSeed: 777 } });
    await byTestId(container, 'scorecard-title').click();
    expect(seen.at(-1)).toEqual({ screen: 'title', params: {} });
    await byTestId(container, 'scorecard-library').click();
    expect(seen.at(-1)).toEqual({ screen: 'library', params: {} });
    off();
  });

  it('renders the wide scorecard as a two-pane split with summary left and share right', async () => {
    installMatchMedia(true);
    const runState = makeState(777, 700, 12);
    const seen = [];
    const off = bus.on('ui:navigate', (payload) => seen.push(payload));
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    mount(container, {
      runState,
      summary: { scrapRecovered: 42 },
      causeOfDeath: 'Party Wipe'
    });

    const screen = container.children[0];
    expect(screen.classList.contains('wide-scorecard-shell')).toBe(true);
    expect(screen.dataset.wideRoot).toBe('');

    const summaryPane = byTestId(container, 'scorecard-summary-pane');
    const sharePane = byTestId(container, 'scorecard-share-pane');
    expect(summaryPane.classList.contains('wide-scorecard-summary')).toBe(true);
    expect(sharePane.classList.contains('wide-scorecard-share')).toBe(true);

    // Roster + cause + seed live inside the summary pane; share link and copy live inside the share pane.
    expect(byTestId(summaryPane, 'scorecard-roster')).toBeTruthy();
    expect(byTestId(summaryPane, 'scorecard-cause')).toBeTruthy();
    expect(byTestId(summaryPane, 'scorecard-seed')).toBeTruthy();
    expect(byTestId(sharePane, 'scorecard-share-link')).toBeTruthy();
    expect(byTestId(sharePane, 'scorecard-copy-world')).toBeTruthy();
    expect(byTestId(sharePane, 'scorecard-restart-seed')).toBeTruthy();
    off();
  });

  it('exposes the world seed in a selectable fallback field that round-trips through decodeSeed', async () => {
    const runState = makeState(777, 700, 12);
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    mount(container, { runState, causeOfDeath: 'Party Wipe' });

    const shareField = byTestId(container, 'scorecard-share-link');
    expect(shareField).toBeTruthy();
    expect(shareField.tagName).toBe('INPUT');
    expect(shareField.getAttribute('readonly')).toBe('readonly');
    expect(shareField.value).toContain(`#w=${encodeSeed(777)}`);
    expect(decodeSeed(encodeSeed(777))).toEqual({ success: true, seed: 777 });
  });

  it('reports honest success when the clipboard API resolves', async () => {
    const runState = makeState(777, 700, 12);
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    mount(container, { runState, causeOfDeath: 'Party Wipe' });

    const status = byTestId(container, 'scorecard-copy-status');
    expect(status).toBeTruthy();
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');

    await byTestId(container, 'scorecard-copy-world').click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `http://127.0.0.1:8080/index.html#w=${encodeSeed(777)}`
    );
    expect(status.textContent).toBe('WORLD LINK COPIED');
    expect(status.textContent).not.toContain('UNAVAILABLE');
  });

  it('reports clipboard-unavailable and keeps a selectable fallback when the API is absent', async () => {
    // Remove clipboard API entirely to simulate insecure context / permission block.
    delete globalThis.navigator.clipboard;

    const runState = makeState(777, 700, 12);
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    mount(container, { runState, causeOfDeath: 'Party Wipe' });

    const status = byTestId(container, 'scorecard-copy-status');
    const shareField = byTestId(container, 'scorecard-share-link');

    await byTestId(container, 'scorecard-copy-world').click();
    expect(status.textContent).toBe('CLIPBOARD UNAVAILABLE — SELECT LINK');
    expect(status.textContent).not.toContain('COPIED');
    expect(shareField.focused).toBe(true);
    expect(shareField.value).toContain(`#w=${encodeSeed(777)}`);
  });

  it('shares the exact seed-only link via the native share sheet when available, without touching the clipboard', async () => {
    const shareSpy = vi.fn(() => Promise.resolve());
    globalThis.navigator.share = shareSpy;

    const runState = makeState(777, 700, 12);
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    mount(container, { runState, causeOfDeath: 'Party Wipe' });

    const status = byTestId(container, 'scorecard-copy-status');
    const shareUrl = `http://127.0.0.1:8080/index.html#w=${encodeSeed(777)}`;

    await byTestId(container, 'scorecard-copy-world').click();
    expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ url: shareUrl }));
    expect(shareSpy.mock.calls[0][0]).not.toHaveProperty('files');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(status.textContent).toBe('WORLD LINK SHARED');
  });

  it('reports cancellation on AbortError without falling back to the clipboard', async () => {
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    globalThis.navigator.share = vi.fn(() => Promise.reject(abortError));

    const runState = makeState(777, 700, 12);
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    mount(container, { runState, causeOfDeath: 'Party Wipe' });

    const status = byTestId(container, 'scorecard-copy-status');

    await byTestId(container, 'scorecard-copy-world').click();
    expect(status.textContent).toBe('SHARE CANCELLED');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard on a non-cancel share failure', async () => {
    globalThis.navigator.share = vi.fn(() => Promise.reject(new Error('share target missing')));

    const runState = makeState(777, 700, 12);
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    mount(container, { runState, causeOfDeath: 'Party Wipe' });

    const status = byTestId(container, 'scorecard-copy-status');
    const shareUrl = `http://127.0.0.1:8080/index.html#w=${encodeSeed(777)}`;

    await byTestId(container, 'scorecard-copy-world').click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(shareUrl);
    expect(status.textContent).toBe('WORLD LINK COPIED');
  });

  it('clears the pending label-reset timer on unmount instead of leaking it', async () => {
    vi.useFakeTimers();
    const runState = makeState(777, 700, 12);
    const { mount } = await import('../../src/ui/screens/scorecard.js');
    const container = new FakeElement('div');
    const screen = mount(container, { runState, causeOfDeath: 'Party Wipe' });

    const copyBtn = byTestId(container, 'scorecard-copy-world');
    await copyBtn.click();
    expect(copyBtn.textContent).toBe('WORLD LINK COPIED');

    screen.unmount();
    vi.advanceTimersByTime(5000);
    // The label swap after unmount would throw/no-op against a torn-down
    // button if the timer were not cleared; asserting the pre-unmount text
    // is unchanged proves the timeout never fired.
    expect(copyBtn.textContent).toBe('WORLD LINK COPIED');
  });
});
