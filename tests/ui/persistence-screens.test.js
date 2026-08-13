import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { deleteRunState, listRuns, loadRun, saveRun } from '../../src/state/library.js';
import { base64urlEncode, crc32, encodeRun, encodeSeed, initEncoder, SAVE_VERSION } from '../../src/state/save-encode.js';
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

    byTestId(container, 'import-input').value = `https://example.test/play/#w=${encodeSeed(987)}`;
    await byTestId(container, 'import-submit').click();
    expect(seen.at(-1)).toEqual({ screen: 'creation', params: { preloadedSeed: 987 } });

    const runState = makeState(555, 1000, 6);
    const encoded = encodeRun(runState).fragment;
    byTestId(container, 'import-input').value = `#r=${encoded}`;
    await byTestId(container, 'import-submit').click();
    expect(byTestId(container, 'import-run-summary')).toBeTruthy();
    expect(allText(container).join(' ')).toContain('SEED 555 · DEPTH 6 · 2 MEMBERS');

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
    await byTestId(container, 'import-fresh-world').click();
    expect(seen.at(-1)).toEqual({ screen: 'creation', params: { preloadedSeed: 321 } });

    await byTestId(container, 'import-return-title-result').click();
    expect(seen.at(-1)).toEqual({ screen: 'title', params: {} });
    off();
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
    const share = byTestId(container, 'scorecard-share-link').textContent;
    expect(share).toBe(`#w=${encodeSeed(777)}`);
    expect(allText(container).join(' ')).not.toContain('#r=');
    expect(byTestId(container, 'scorecard-roster').children[0].children[0].classList.contains('sigil-dead')).toBe(true);
    expect(byTestId(container, 'scorecard-library')).toBeTruthy();

    await byTestId(container, 'scorecard-copy-world').click();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`http://127.0.0.1:8080/index.html${share}`);
    await byTestId(container, 'scorecard-restart-seed').click();
    expect(seen.at(-1)).toEqual({ screen: 'creation', params: { preloadedSeed: 777 } });
    await byTestId(container, 'scorecard-title').click();
    expect(seen.at(-1)).toEqual({ screen: 'title', params: {} });
    await byTestId(container, 'scorecard-library').click();
    expect(seen.at(-1)).toEqual({ screen: 'library', params: {} });
    off();
  });
});
