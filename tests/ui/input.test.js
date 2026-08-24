import { describe, expect, test } from 'vitest';
import { createInputHandler } from '../../src/ui/input.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.listeners = new Map();
    this.tabIndex = -1;
  }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      event.type = event.type || type;
      event.target = event.target || this;
      listener(event);
    }
  }
}

function keyEvent(code, overrides = {}) {
  return { code, key: code, repeat: false, preventDefault() { this.prevented = true; }, ...overrides };
}

describe('input handler', () => {
  test('maps keyboard to canonical actions and suppresses handled scrolling', () => {
    const input = createInputHandler({ legacyActions: false });
    const root = new FakeElement('div');
    const actions = [];
    input.bindToElement(root);
    input.onAction((action) => actions.push(action));
    const event = keyEvent('ArrowUp');

    root.dispatch('keydown', event);

    expect(actions).toEqual(['move_n']);
    expect(event.prevented).toBe(true);
  });

  test('top context isolates lower contexts and cleanup restores ownership', () => {
    const input = createInputHandler({ legacyActions: false });
    const seen = [];
    input.onAction((action) => seen.push(`base:${action}`));
    const popFirst = input.pushContext({ id: 'first', onAction: (action) => seen.push(`first:${action}`) });
    const popSecond = input.pushContext({ id: 'second', onAction: (action) => seen.push(`second:${action}`), actions: ['confirm'] });

    expect(input.triggerAction('move_n')).toBe(false);
    expect(input.triggerAction('confirm')).toBe(true);
    popSecond();
    expect(input.triggerAction('move_n')).toBe(true);
    popFirst();
    input.triggerAction('move_n');

    expect(seen).toEqual(['second:confirm', 'first:move_n', 'base:move_n']);
  });

  test('ignores shortcuts while typing and allows repeat only for movement', () => {
    const input = createInputHandler({ legacyActions: false });
    const root = new FakeElement('div');
    const field = new FakeElement('input');
    const actions = [];
    input.bindToElement(root);
    input.onAction((action) => actions.push(action));

    root.dispatch('keydown', keyEvent('Enter', { target: field }));
    root.dispatch('keydown', keyEvent('Enter', { repeat: true }));
    root.dispatch('keydown', keyEvent('ArrowRight', { repeat: true }));

    expect(actions).toEqual(['move_e']);
  });

  test('native click is the sole control activation path; a stray touchend performs no action and destroy() tears down the click listener', () => {
    const input = createInputHandler({ legacyActions: false });
    const root = new FakeElement('div');
    const control = new FakeElement('button');
    const actions = [];
    input.bindToElement(root);
    input.bindActionControl(control, 'move_n');
    input.onAction((action, details) => actions.push(`${details.source}:${action}`));

    // Cancelled touches, embedded WebViews, and assistive taps can still dispatch a
    // touchend ahead of the browser's native click — it must be inert on its own.
    control.dispatch('touchend', { preventDefault() { this.prevented = true; } });
    expect(actions).toEqual([]);

    // The synthetic sequence's native click still fires — and fires exactly once.
    control.dispatch('click', { preventDefault() { this.prevented = true; } });
    expect(actions).toEqual(['control:move_n']);

    // Keyboard dispatch remains a distinct, equivalent activation path.
    root.dispatch('keydown', keyEvent('ArrowUp'));
    expect(actions).toEqual(['control:move_n', 'keyboard:move_n']);

    input.destroy();
    control.dispatch('click', { preventDefault() { this.prevented = true; } });
    expect(actions).toEqual(['control:move_n', 'keyboard:move_n']);
  });
});
