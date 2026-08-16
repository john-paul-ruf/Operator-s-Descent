import { beforeEach, describe, expect, test } from 'vitest';
import { captureScroll, clearScrollMemory, preserveScroll, restoreScroll } from '../../src/ui/scroll-memory.js';

function makeElement({ scrollTop = 0, scrollHeight = 1000, clientHeight = 400 } = {}) {
  return {
    scrollTop,
    scrollHeight,
    clientHeight
  };
}

beforeEach(() => {
  clearScrollMemory();
  delete globalThis.requestAnimationFrame;
});

describe('scroll-memory', () => {
  test('captureScroll and restoreScroll round-trip preserves offset', () => {
    const source = makeElement({ scrollTop: 240 });
    captureScroll(source, 'console:gear');
    const target = makeElement({ scrollTop: 0 });
    restoreScroll(target, 'console:gear');
    expect(target.scrollTop).toBe(240);
  });

  test('restoreScroll clamps to element scroll extent', () => {
    captureScroll(makeElement({ scrollTop: 5000 }), 'console:gear');
    const short = makeElement({ scrollTop: 0, scrollHeight: 500, clientHeight: 200 });
    restoreScroll(short, 'console:gear');
    expect(short.scrollTop).toBe(300);
  });

  test('missing key restores no-op', () => {
    const target = makeElement({ scrollTop: 12 });
    restoreScroll(target, 'never:seen');
    expect(target.scrollTop).toBe(12);
  });

  test('null element never throws in any helper', () => {
    expect(() => captureScroll(null, 'x')).not.toThrow();
    expect(() => restoreScroll(null, 'x')).not.toThrow();
    expect(() => preserveScroll(null, 'x', () => 'v')).not.toThrow();
  });

  test('preserveScroll captures before render and restores after', () => {
    const element = makeElement({ scrollTop: 88 });
    const order = [];
    const returned = preserveScroll(element, 'creation:editor', () => {
      order.push(`during scrollTop=${element.scrollTop}`);
      element.scrollTop = 0;
      return 'render-result';
    });
    expect(returned).toBe('render-result');
    expect(order).toEqual(['during scrollTop=88']);
    expect(element.scrollTop).toBe(88);
  });

  test('preserveScroll returns render() return value even when no offset stored', () => {
    const element = makeElement({ scrollTop: 0 });
    const value = preserveScroll(element, 'library:list', () => 42);
    expect(value).toBe(42);
  });

  test('CAP evicts oldest entry once 65 keys exist', () => {
    for (let i = 0; i < 65; i++) {
      captureScroll(makeElement({ scrollTop: i + 1 }), `k:${i}`);
    }
    const first = makeElement({ scrollTop: 0 });
    restoreScroll(first, 'k:0');
    expect(first.scrollTop).toBe(0);
    const latest = makeElement({ scrollTop: 0 });
    restoreScroll(latest, 'k:64');
    expect(latest.scrollTop).toBe(65);
  });

  test('re-capturing the same key refreshes recency (evicts older neighbours first)', () => {
    for (let i = 0; i < 64; i++) captureScroll(makeElement({ scrollTop: i + 1 }), `k:${i}`);
    captureScroll(makeElement({ scrollTop: 250 }), 'k:0');
    captureScroll(makeElement({ scrollTop: 300 }), 'k:new');
    const stillThere = makeElement({ scrollTop: 0 });
    restoreScroll(stillThere, 'k:0');
    expect(stillThere.scrollTop).toBe(250);
    const evicted = makeElement({ scrollTop: 7 });
    restoreScroll(evicted, 'k:1');
    expect(evicted.scrollTop).toBe(7);
  });

  test('clearScrollMemory with prefix deletes matching keys only', () => {
    captureScroll(makeElement({ scrollTop: 10 }), 'console:gear');
    captureScroll(makeElement({ scrollTop: 20 }), 'console:log');
    captureScroll(makeElement({ scrollTop: 30 }), 'creation:editor');
    clearScrollMemory('console:');
    const g = makeElement({ scrollTop: 0 });
    restoreScroll(g, 'console:gear');
    expect(g.scrollTop).toBe(0);
    const c = makeElement({ scrollTop: 0 });
    restoreScroll(c, 'creation:editor');
    expect(c.scrollTop).toBe(30);
  });

  test('clearScrollMemory with no arg drops everything', () => {
    captureScroll(makeElement({ scrollTop: 10 }), 'console:gear');
    captureScroll(makeElement({ scrollTop: 20 }), 'library:list');
    clearScrollMemory();
    const a = makeElement({ scrollTop: 0 });
    const b = makeElement({ scrollTop: 0 });
    restoreScroll(a, 'console:gear');
    restoreScroll(b, 'library:list');
    expect(a.scrollTop).toBe(0);
    expect(b.scrollTop).toBe(0);
  });

  test('empty key is ignored on capture and restore', () => {
    captureScroll(makeElement({ scrollTop: 100 }), '');
    const target = makeElement({ scrollTop: 5 });
    restoreScroll(target, '');
    expect(target.scrollTop).toBe(5);
  });

  test('detached elements skip restore (isConnected === false)', () => {
    captureScroll(makeElement({ scrollTop: 250 }), 'console:gear');
    const detached = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400, isConnected: false };
    restoreScroll(detached, 'console:gear');
    expect(detached.scrollTop).toBe(0);
  });

  test('uses requestAnimationFrame when available', () => {
    const scheduled = [];
    globalThis.requestAnimationFrame = (fn) => { scheduled.push(fn); return 1; };
    captureScroll(makeElement({ scrollTop: 60 }), 'console:party');
    const target = makeElement({ scrollTop: 0 });
    restoreScroll(target, 'console:party');
    expect(target.scrollTop).toBe(0);
    scheduled.forEach((fn) => fn());
    expect(target.scrollTop).toBe(60);
  });
});
