import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createGlitchSystem, GLITCH_TIMINGS, initGlitchSafePool, resolveMotionPolicy } from '../../src/glitch/glitch.js';
import { createGrain } from '../../src/glitch/grain.js';
import { playBootSequence } from '../../src/glitch/transitions.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.textContent = '';
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.isConnected = true;
    this.removed = false;
  }
  appendChild(child) { this.children.push(child); return child; }
  remove() { this.removed = true; }
  matches(selector) { return selector.includes(this.tagName.toLowerCase()) || selector.includes(this.tagName); }
}

class FakeContext {
  constructor() { this.calls = []; }
  clearRect(...args) { this.calls.push(['clearRect', ...args]); }
  fillRect(...args) { this.calls.push(['fillRect', ...args]); }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    getElementById: () => null
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
  initGlitchSafePool({ safeSubstitutionPool: { latin: [65], digits: [49], boxDrawing: [9472] } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete globalThis.requestAnimationFrame;
});

describe('ambient glitch', () => {
  test('draws every cadence once at registration and keeps it stable', () => {
    const element = new FakeElement();
    const glitch = createGlitchSystem();
    glitch.registerElement(element, 1);
    const cadences = glitch.getRegisteredCadences(element);

    expect(Object.keys(cadences).sort()).toEqual(Object.keys(GLITCH_TIMINGS).sort());
    expect(cadences.charSubstitution).toBeGreaterThanOrEqual(GLITCH_TIMINGS.charSubstitution.minCadence);
    vi.advanceTimersByTime(cadences.charSubstitution * 3);
    expect(glitch.getRegisteredCadences(element)).toEqual(cadences);
    glitch.destroy();
  });

  test('substitution uses safe pool and restores exact text inside bounded window', () => {
    const element = new FakeElement();
    element.textContent = 'HELLO';
    const glitch = createGlitchSystem();
    glitch.registerElement(element, 1);
    vi.advanceTimersByTime(glitch.getRegisteredCadences(element).charSubstitution);

    expect(element.textContent).not.toBe('HELLO');
    expect([...element.textContent].every((char) => ['A', '1', '─', 'H', 'E', 'L', 'O'].includes(char))).toBe(true);
    expect(element.classList.contains('text-swapping')).toBe(true);
    vi.advanceTimersByTime(GLITCH_TIMINGS.charSubstitution.maxDuration);
    expect(element.textContent).toBe('HELLO');
    expect(element.classList.contains('text-swapping')).toBe(false);
    glitch.destroy();
  });

  test('never substitutes reserved sigils and protects controls during pending decisions', () => {
    const sigil = new FakeElement();
    sigil.textContent = String.fromCodePoint(0xE000);
    const button = new FakeElement('button');
    button.textContent = 'CONFIRM';
    const glitch = createGlitchSystem();
    glitch.registerElement(sigil, 1);
    glitch.registerElement(button, 1);
    glitch.setDecisionPending(true);

    vi.advanceTimersByTime(glitch.getRegisteredCadences(sigil).charSubstitution);
    expect(sigil.textContent).toBe(String.fromCodePoint(0xE000));
    expect(button.textContent).toBe('CONFIRM');
    glitch.destroy();
  });

  test('unregister and stop cleanup scheduled element effects', () => {
    const element = new FakeElement();
    element.textContent = 'READY';
    const glitch = createGlitchSystem();
    const unregister = glitch.registerElement(element, 1);
    const cadence = glitch.getRegisteredCadences(element).charSubstitution;
    unregister();
    vi.advanceTimersByTime(cadence * 2);
    expect(element.textContent).toBe('READY');
    glitch.registerElement(element, 1);
    glitch.stop();
    vi.advanceTimersByTime(cadence * 2);
    expect(element.textContent).toBe('READY');
  });

  test('resolves motion policy and transition fallbacks without authored motion', async () => {
    expect(resolveMotionPolicy({ reducedMotion: 'reduce' }).reduced).toBe(true);
    expect(resolveMotionPolicy({ reducedMotion: 'full' }, () => ({ matches: true })).reduced).toBe(false);
    const element = new FakeElement();
    const promise = playBootSequence(element, { settings: { reducedMotion: 'reduce' } });
    vi.advanceTimersByTime(180);
    await promise;
    expect(element.style.filter || '').toBe('');
  });

  test('grain scatters 2x2 dots on 10px cells and stops cleanly', () => {
    const context = new FakeContext();
    const canvas = { width: 20, height: 20, getContext: () => context };
    const grain = createGrain(canvas, { random: () => 0.1 });
    grain.start();

    expect(context.calls.filter(([name]) => name === 'fillRect')).toHaveLength(4);
    expect(context.calls.find(([name]) => name === 'fillRect')).toEqual(['fillRect', 0, 0, 2, 2]);
    vi.advanceTimersByTime(1000);
    expect(context.calls.filter(([name]) => name === 'clearRect')).toHaveLength(2);
    grain.destroy();
    vi.advanceTimersByTime(1000);
    expect(context.calls.filter(([name]) => name === 'clearRect')).toHaveLength(2);
  });
});
