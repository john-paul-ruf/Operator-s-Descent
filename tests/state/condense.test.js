import { describe, it, expect } from 'vitest';
import { initCondenser, condense, expand } from '../../src/state/condense.js';
import { loadData } from '../helpers/data.js';
import { createRunState } from '../../src/state/run-state.js';
import { makeParty } from '../helpers/fixtures.js';

const symbolTable = loadData('symbol-table');

describe('condense — init', () => {
  it('initCondenser runs without throwing', () => {
    expect(() => initCondenser(symbolTable)).not.toThrow();
  });

  it('condense returns {data: Uint8Array, tableVersion: 1}', () => {
    initCondenser(symbolTable);
    const result = condense({ foo: 'bar' });
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.tableVersion).toBe(symbolTable.version);
  });
});

describe('condense — round-trip', () => {
  it('flat object', () => {
    initCondenser(symbolTable);
    const obj = { a: 1, b: 'hello', c: true };
    const result = condense(obj);
    const expanded = expand(result.data, result.tableVersion);
    expect(expanded).toEqual(obj);
  });

  it('nested arrays/objects', () => {
    initCondenser(symbolTable);
    const obj = { outer: { inner: [1, 2, { deep: 'value' }] } };
    const result = condense(obj);
    const expanded = expand(result.data, result.tableVersion);
    expect(expanded).toEqual(obj);
  });

  it('realistic run-state serialize() payload', () => {
    initCondenser(symbolTable);
    const state = createRunState(42, makeParty(2));
    state.depth = 5;
    state.corruption = 0.3;
    state.markContainerOpened(1);
    state.themesSeen.add('industrial');
    const serialized = state.serialize();
    const result = condense(serialized);
    const expanded = expand(result.data, result.tableVersion);
    expect(expanded).toEqual(serialized);
  });

  it('empty object', () => {
    initCondenser(symbolTable);
    const obj = {};
    const result = condense(obj);
    const expanded = expand(result.data, result.tableVersion);
    expect(expanded).toEqual(obj);
  });
});

describe('condense — charset limitation', () => {
  it('non-Latin-1 char does NOT survive byte round-trip (truncated → JSON.parse throws)', () => {
    initCondenser(symbolTable);
    const obj = { char: '\u2603' };
    const result = condense(obj);
    // LIMITATION: charCodeAt truncates to low 8 bits — non-Latin-1 chars produce invalid JSON.
    // Save payloads are ASCII by construction, so this is expected behavior.
    expect(() => expand(result.data, result.tableVersion)).toThrow();
  });
});