import { describe, it, expect, vi, afterEach } from 'vitest';
import { bus, isKnownEvent, validateEventPayload, EVENT_CONTRACTS } from '../../src/state/bus.js';

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

describe('bus — SESSION-05 event contracts', () => {
  const validRunState = { runState: { worldSeed: 77, depth: 1 } };

  it('isKnownEvent discovers the state:inventory-change contract and unknown events remain undiscovered', () => {
    expect(isKnownEvent('state:inventory-change')).toBe(true);
    expect(Object.hasOwn(EVENT_CONTRACTS, 'state:inventory-change')).toBe(true);
    expect(isKnownEvent('state:definitely-not-a-real-event')).toBe(false);
  });

  it('valid state:inventory-change dispatch reaches the listener and returns true', () => {
    const seen = [];
    const off = bus.on('state:inventory-change', (payload) => seen.push(payload));
    expect(bus.dispatch('state:inventory-change', validRunState)).toBe(true);
    expect(seen).toEqual([validRunState]);
    off();
  });

  it('state:inventory-change rejects a missing runState and warns once; listener does not fire', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = [];
    const off = bus.on('state:inventory-change', (payload) => seen.push(payload));
    expect(bus.dispatch('state:inventory-change', {})).toBe(false);
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    off();
  });

  it('state:inventory-change rejects a malformed runState (missing depth/worldSeed) without firing the listener', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = [];
    const off = bus.on('state:inventory-change', (payload) => seen.push(payload));
    expect(bus.dispatch('state:inventory-change', { runState: { worldSeed: 'not-an-integer', depth: 1 } })).toBe(false);
    expect(bus.dispatch('state:inventory-change', { runState: { worldSeed: 5 } })).toBe(false);
    expect(bus.dispatch('state:inventory-change', { runState: null })).toBe(false);
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
    off();
  });

  it('validateEventPayload accepts the whitelisted masterVolume setting key and rejects unknown keys', () => {
    expect(validateEventPayload('state:settings-change', { key: 'masterVolume', value: 40 })).toBe(true);
    expect(validateEventPayload('state:settings-change', { key: 'nope-not-a-setting', value: 1 })).toBe(false);
    expect(validateEventPayload('state:settings-change', { key: 'volume:drone', value: 25 })).toBe(true);
  });

  it('state:settings-change with key masterVolume reaches its listener and returns true', () => {
    const seen = [];
    const off = bus.on('state:settings-change', (payload) => seen.push(payload));
    expect(bus.dispatch('state:settings-change', { key: 'masterVolume', value: 40 })).toBe(true);
    expect(seen).toEqual([{ key: 'masterVolume', value: 40 }]);
    off();
  });

  it('state:settings-change with an unknown key is rejected and its listener never fires', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = [];
    const off = bus.on('state:settings-change', (payload) => seen.push(payload));
    expect(bus.dispatch('state:settings-change', { key: 'not-a-real-setting', value: 1 })).toBe(false);
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    off();
  });
});