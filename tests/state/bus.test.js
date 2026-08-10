import { describe, it, expect, vi, afterEach } from 'vitest';
import { bus } from '../../src/state/bus.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bus — on + dispatch', () => {
  it('delivers payload by reference', () => {
    const payload = { val: 42 };
    let received;
    bus.on('test1:ref', (p) => { received = p; });
    bus.dispatch('test1:ref', payload);
    expect(received).toBe(payload);
  });

  it('multiple handlers fire in registration order', () => {
    const order = [];
    bus.on('test2:order', () => order.push(1));
    bus.on('test2:order', () => order.push(2));
    bus.on('test2:order', () => order.push(3));
    bus.dispatch('test2:order', {});
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('bus — unsubscribe', () => {
  it('on returns unsubscribe function; handler no longer fires after', () => {
    let count = 0;
    const unsub = bus.on('test3:unsub', () => count++);
    bus.dispatch('test3:unsub', {});
    expect(count).toBe(1);
    unsub();
    bus.dispatch('test3:unsub', {});
    expect(count).toBe(1);
  });

  it('unsubscribing twice is safe', () => {
    const unsub = bus.on('test4:double', () => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });
});

describe('bus — dispatch no handlers', () => {
  it('dispatch on event with no handlers → no throw', () => {
    expect(() => bus.dispatch('test5:nope', {})).not.toThrow();
  });
});

describe('bus — error isolation', () => {
  it('first handler throws: console.error called, second handler still fires', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let secondFired = false;
    bus.on('test6:err', () => { throw new Error('boom'); });
    bus.on('test6:err', () => { secondFired = true; });
    bus.dispatch('test6:err', {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(secondFired).toBe(true);
  });
});

describe('bus — Set dedup', () => {
  it('same handler registered twice → fires once', () => {
    let count = 0;
    const handler = () => count++;
    bus.on('test7:dedup', handler);
    bus.on('test7:dedup', handler);
    bus.dispatch('test7:dedup', {});
    expect(count).toBe(1);
  });
});