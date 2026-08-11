import { beforeEach, describe, expect, test } from 'vitest';
import { bus } from '../../src/state/bus.js';
import { createStatusBar } from '../../src/ui/status-strip.js';

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) this.values.add(name); this.element.className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList(this);
    this.className = '';
    this.textContent = '';
  }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
}

function installDocument() {
  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
}

function textOf(root) {
  return [root.textContent, ...root.children.flatMap((child) => textOf(child))].filter(Boolean);
}

beforeEach(installDocument);

describe('status strip', () => {
  test('displays exploration depth seed party hp corruption and numeric clock accessibly', () => {
    const strip = createStatusBar({
      depth: 7,
      worldSeed: '123456789abcdef',
      corruption: 0.25,
      dangerClockProgress: 0.5,
      party: [{ id: 'p1', sigilCodepoint: 0xE000, currentHP: 8, maxHP: 10 }]
    });

    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.getAttribute('aria-live')).toBe('polite');
    expect(textOf(strip)).toEqual(expect.arrayContaining(['D7', 'SEED 123456…cdef', '8/10', 'COR 0.25', 'CLK 0.50']));
    expect(strip.children.find((child) => child.className === 'status-seed').getAttribute('aria-label')).toBe('World seed 123456789abcdef');
  });

  test('updates live clock and cleanup removes the subscription', () => {
    const runState = { depth: 1, worldSeed: 1, dangerClockProgress: 0, party: [] };
    const strip = createStatusBar(runState);
    const clock = strip.children.find((child) => child.className === 'status-clock');

    bus.dispatch('state:danger-clock-tick', { progress: 0.75 });
    expect(clock.textContent).toBe('CLK 0.75');
    strip.cleanup();
    bus.dispatch('state:danger-clock-tick', { progress: 0.9 });
    expect(clock.textContent).toBe('CLK 0.75');
  });

  test('displays combat round initiative active resources ap and movement', () => {
    const combatants = new Map([
      ['p1', { id: 'p1', side: 'party', sigilCodepoint: 0xE000, currentHP: 9, maxHP: 12, currentCHARGE: 3, maxCHARGE: 6, ap: 2, moveAvailable: true }],
      ['e1', { id: 'e1', side: 'enemy', sigilCodepoint: 0xE030, hp: 5, hpMax: 5 }]
    ]);
    const strip = createStatusBar({ depth: 3 }, { combatants, turnOrder: ['p1', 'e1'], currentTurn: 0, round: 4 });

    expect(textOf(strip)).toEqual(expect.arrayContaining(['D3', 'R4', 'INIT p1 › e1', '9/12', '3/6', 'AP 2', 'MOVE READY']));
    expect(strip.children.some((child) => child.className.includes('status-active-sigil'))).toBe(true);
  });
});
