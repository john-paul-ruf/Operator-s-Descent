import { describe, it, expect } from 'vitest';
import { parseFragment, buildFragment, canonicalFragmentFor, createHistoryController, ROUTES } from '../../src/router.js';
import { encodeSeed } from '../../src/state/save-encode.js';
import { decodeSeed } from '../../src/state/save-decode.js';

function fakeWindow(initialHash = '') {
  const listeners = new Map();
  const win = {
    location: { hash: initialHash },
    history: {
      calls: [],
      pushState(state, title, url) {
        this.calls.push({ type: 'push', state, title, url });
        win.location.hash = url && url.startsWith('#') ? url : `#${(url || '').replace(/^#/, '')}`;
      },
      replaceState(state, title, url) {
        this.calls.push({ type: 'replace', state, title, url });
        win.location.hash = url && url.startsWith('#') ? url : `#${(url || '').replace(/^#/, '')}`;
      }
    },
    addEventListener(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    removeEventListener(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    fire(event) {
      listeners.get(event)?.forEach((handler) => handler());
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    }
  };
  return win;
}

describe('router — parseFragment', () => {
  it('empty hash returns none', () => {
    expect(parseFragment('')).toEqual({ kind: 'none' });
    expect(parseFragment('#')).toEqual({ kind: 'none' });
  });

  it('#r=… classified as run', () => {
    const fragment = 'ABCabc123-_';
    expect(parseFragment(`#r=${fragment}`)).toEqual({ kind: 'run', fragment });
  });

  it('#w=… classified as seed with raw base32', () => {
    const seed = encodeSeed(12345);
    expect(parseFragment(`#w=${seed}`)).toEqual({ kind: 'seed', seed });
  });

  it('bare #a=title parses to route with defaults null', () => {
    expect(parseFragment('#a=title')).toEqual({ kind: 'route', route: 'title', save: null, seed: null, from: null });
  });

  it('#a=exploration&save=current&seed=… decodes seed to uint32', () => {
    const worldSeed = 60013 >>> 0;
    const b32 = encodeSeed(worldSeed);
    const parsed = parseFragment(`#a=exploration&save=current&seed=${b32}`);
    expect(parsed).toEqual({ kind: 'route', route: 'exploration', save: 'current', seed: worldSeed, from: null });
  });

  it('#a=settings&from=library parses from field', () => {
    expect(parseFragment('#a=settings&from=library')).toEqual({ kind: 'route', route: 'settings', save: null, seed: null, from: 'library' });
  });

  it('unknown route rejected', () => {
    expect(parseFragment('#a=nope')).toEqual({ kind: 'invalid' });
  });

  it('unknown key rejected', () => {
    expect(parseFragment('#a=title&extra=1')).toEqual({ kind: 'invalid' });
  });

  it('invalid from value rejected', () => {
    expect(parseFragment('#a=settings&from=nowhere')).toEqual({ kind: 'invalid' });
  });

  it('invalid save value rejected', () => {
    expect(parseFragment('#a=exploration&save=other')).toEqual({ kind: 'invalid' });
  });

  it('malformed seed rejected', () => {
    expect(parseFragment('#a=exploration&save=current&seed=!!!')).toEqual({ kind: 'invalid' });
  });

  it('undecodable seed rejected', () => {
    expect(parseFragment('#a=creation&seed=A')).toEqual({ kind: 'invalid' });
  });

  it('duplicate keys rejected', () => {
    expect(parseFragment('#a=title&from=title&from=library')).toEqual({ kind: 'invalid' });
  });

  it('empty #w= rejected', () => {
    expect(parseFragment('#w=')).toEqual({ kind: 'invalid' });
  });

  it('empty #r= rejected', () => {
    expect(parseFragment('#r=')).toEqual({ kind: 'invalid' });
  });

  it('non-recognized prefix rejected', () => {
    expect(parseFragment('#foo=bar')).toEqual({ kind: 'invalid' });
  });
});

describe('router — buildFragment', () => {
  it('bare route', () => {
    expect(buildFragment({ route: 'title' })).toBe('#a=title');
  });

  it('exploration + save + seed in fixed order', () => {
    const seed = 60013 >>> 0;
    const fragment = buildFragment({ route: 'exploration', save: 'current', seed });
    expect(fragment).toBe(`#a=exploration&save=current&seed=${encodeSeed(seed)}`);
  });

  it('settings + from', () => {
    expect(buildFragment({ route: 'settings', from: 'library' })).toBe('#a=settings&from=library');
  });

  it('invalid route returns empty', () => {
    expect(buildFragment({ route: 'nope' })).toBe('');
    expect(buildFragment({})).toBe('');
  });

  it('round-trip through parseFragment', () => {
    const seed = 0xdeadbeef >>> 0;
    const built = buildFragment({ route: 'exploration', save: 'current', seed });
    const parsed = parseFragment(built);
    expect(parsed).toEqual({ kind: 'route', route: 'exploration', save: 'current', seed, from: null });
  });

  it('seed codec round-trip matches decodeSeed', () => {
    for (const seed of [0, 1, 12345, 0xffffffff]) {
      const b32 = encodeSeed(seed >>> 0);
      expect(decodeSeed(b32)).toEqual({ success: true, seed: seed >>> 0 });
    }
  });
});

describe('router — canonicalFragmentFor', () => {
  it('exploration + runState → #a=exploration&save=current&seed=…', () => {
    const seed = 42 >>> 0;
    expect(canonicalFragmentFor('exploration', { runState: { worldSeed: seed } })).toBe(`#a=exploration&save=current&seed=${encodeSeed(seed)}`);
  });

  it('combat canonicalizes to exploration', () => {
    const seed = 99 >>> 0;
    expect(canonicalFragmentFor('combat', { runState: { worldSeed: seed } })).toBe(`#a=exploration&save=current&seed=${encodeSeed(seed)}`);
  });

  it('exploration without runState omits seed', () => {
    expect(canonicalFragmentFor('exploration', {})).toBe('#a=exploration&save=current');
  });

  it('creation with numeric preloadedSeed', () => {
    const seed = 60013 >>> 0;
    expect(canonicalFragmentFor('creation', { preloadedSeed: seed })).toBe(`#a=creation&seed=${encodeSeed(seed)}`);
  });

  it('creation with string preloadedSeed decodes via decodeSeed', () => {
    const seed = 77 >>> 0;
    const b32 = encodeSeed(seed);
    expect(canonicalFragmentFor('creation', { preloadedSeed: b32 })).toBe(`#a=creation&seed=${b32}`);
  });

  it('creation without seed', () => {
    expect(canonicalFragmentFor('creation', {})).toBe('#a=creation');
  });

  it('scorecard with seed', () => {
    const seed = 5 >>> 0;
    expect(canonicalFragmentFor('scorecard', { seed })).toBe(`#a=scorecard&seed=${encodeSeed(seed)}`);
  });

  it('settings with from', () => {
    expect(canonicalFragmentFor('settings', { from: 'library' })).toBe('#a=settings&from=library');
  });

  it('settings ignores non-route from', () => {
    expect(canonicalFragmentFor('settings', { from: 'bogus' })).toBe('#a=settings');
  });

  it('other routes produce bare fragment', () => {
    for (const route of ['title', 'library', 'tutorial', 'import']) {
      expect(canonicalFragmentFor(route)).toBe(`#a=${route}`);
    }
  });

  it('unknown screen returns empty', () => {
    expect(canonicalFragmentFor('nope')).toBe('');
  });
});

describe('router — createHistoryController', () => {
  it('start adds hashchange listener; stop removes it', () => {
    const win = fakeWindow();
    const controller = createHistoryController({ window: win, onNavigate: () => {} });
    controller.start();
    expect(win.listenerCount('hashchange')).toBe(1);
    controller.stop();
    expect(win.listenerCount('hashchange')).toBe(0);
  });

  it('sync push writes pushState with fragment', () => {
    const win = fakeWindow();
    const controller = createHistoryController({ window: win, onNavigate: () => {} });
    controller.start();
    controller.sync('title', {}, { push: true });
    expect(win.history.calls).toHaveLength(1);
    expect(win.history.calls[0]).toMatchObject({ type: 'push', url: '#a=title' });
  });

  it('sync replace writes replaceState', () => {
    const win = fakeWindow();
    const controller = createHistoryController({ window: win, onNavigate: () => {} });
    controller.start();
    controller.sync('library', {}, {});
    expect(win.history.calls).toHaveLength(1);
    expect(win.history.calls[0]).toMatchObject({ type: 'replace', url: '#a=library' });
  });

  it('sync is a no-op when fragment already matches current hash', () => {
    const win = fakeWindow('#a=title');
    const controller = createHistoryController({ window: win, onNavigate: () => {} });
    controller.start();
    controller.sync('title', {}, { push: true });
    expect(win.history.calls).toHaveLength(0);
  });

  it('sync-triggered hash update does not re-notify onNavigate', () => {
    const win = fakeWindow();
    let count = 0;
    const controller = createHistoryController({ window: win, onNavigate: () => count++ });
    controller.start();
    controller.sync('library', {}, { push: true });
    win.fire('hashchange');
    expect(count).toBe(0);
  });

  it('user hashchange after sync still fires onNavigate', () => {
    const win = fakeWindow();
    const received = [];
    const controller = createHistoryController({ window: win, onNavigate: (parsed) => received.push(parsed) });
    controller.start();
    controller.sync('title', {}, { push: false });
    win.location.hash = '#a=settings';
    win.fire('hashchange');
    expect(received).toHaveLength(1);
    expect(received[0].route).toBe('settings');
  });

  it('user hashchange fires onNavigate with parsed fragment', () => {
    const win = fakeWindow('#a=title');
    const received = [];
    const controller = createHistoryController({ window: win, onNavigate: (parsed) => received.push(parsed) });
    controller.start();
    win.location.hash = '#a=library';
    win.fire('hashchange');
    expect(received).toEqual([{ kind: 'route', route: 'library', save: null, seed: null, from: null }]);
  });

  it('start is idempotent', () => {
    const win = fakeWindow();
    const controller = createHistoryController({ window: win, onNavigate: () => {} });
    controller.start();
    controller.start();
    expect(win.listenerCount('hashchange')).toBe(1);
  });

  it('stop before start is safe', () => {
    const win = fakeWindow();
    const controller = createHistoryController({ window: win, onNavigate: () => {} });
    expect(() => controller.stop()).not.toThrow();
  });
});

describe('router — ROUTES export', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(ROUTES)).toBe(true);
  });

  it('matches the runtime route set', () => {
    expect(new Set(ROUTES)).toEqual(new Set(['title', 'creation', 'exploration', 'combat', 'library', 'highscores', 'scorecard', 'import', 'tutorial', 'settings']));
  });

  // the-manual SESSION-04 — the tutorial route is retired at the runtime layer
  // but MUST stay in ROUTES so `#a=tutorial` fragments keep classifying rather
  // than falling through to `invalid`. The runtime redirects it to title + a
  // `ui:manual-open` dispatch (covered in integration/runtime.test.js).
  it('#a=tutorial still parses as a route (runtime redirects to title + manual)', () => {
    expect(parseFragment('#a=tutorial')).toEqual({ kind: 'route', route: 'tutorial', save: null, seed: null, from: null });
    expect(canonicalFragmentFor('tutorial')).toBe('#a=tutorial');
  });
});
