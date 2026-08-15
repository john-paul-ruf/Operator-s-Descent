import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { WIDE_MEDIA_QUERY, currentLayoutClass, initLayoutController } from '../../src/ui/layout.js';

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
