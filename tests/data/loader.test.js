import { afterEach, describe, expect, it } from 'vitest';
import { loadData } from '../helpers/data.js';
import { getGameData, loadGameData, resetGameDataForTests } from '../../src/data-loader.js';

const names = ['sigils', 'themes', 'classes', 'protocols', 'enemies', 'equipment', 'affixes', 'conditions', 'consumables', 'symbol-table', 'manual'];

function createFetch(overrides = {}) {
  return async (file) => {
    const name = file.slice('data/'.length, -'.json'.length);
    const value = overrides[name];
    if (value?.response) return value.response;
    return { ok: true, status: 200, json: async () => structuredClone(value ?? loadData(name)) };
  };
}

afterEach(resetGameDataForTests);

describe('data loader', () => {
  it('loads exactly once, freezes the complete registry, and exposes it after activation', async () => {
    let calls = 0;
    const fetchImpl = async (file) => {
      calls += 1;
      return createFetch()(file);
    };
    const [first, second] = await Promise.all([loadGameData(fetchImpl), loadGameData(fetchImpl)]);
    expect(calls).toBe(names.length);
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.classes.classes[0])).toBe(true);
    expect(getGameData()).toBe(first);
  });

  it('rejects fetch failures with file and code', async () => {
    await expect(loadGameData(createFetch({ themes: { response: { ok: false, status: 503 } } }))).rejects.toEqual({
      code: 'fetch_failed', file: 'data/themes.json', details: 'HTTP 503'
    });
  });

  it('rejects invalid JSON with file and code', async () => {
    await expect(loadGameData(createFetch({ classes: { response: { ok: true, status: 200, json: async () => { throw new Error('bad json'); } } } }))).rejects.toEqual({
      code: 'invalid_json', file: 'data/classes.json', details: 'bad json'
    });
  });

  it('rejects version and reference failures deterministically', async () => {
    const version = loadData('themes');
    version.version = 2;
    await expect(loadGameData(createFetch({ themes: version }))).rejects.toEqual({
      code: 'version_mismatch', file: 'data/themes.json', details: 'Expected integer version 1.'
    });
    const classes = loadData('classes');
    classes.classes[0].sigilFamily = 'unknown';
    await expect(loadGameData(createFetch({ classes }))).rejects.toEqual({
      code: 'invalid_reference', file: 'data/classes.json', details: 'Invalid gate or sigil family for breacher.'
    });
  });

  it('keeps the registry unavailable before a successful load', () => {
    expect(() => getGameData()).toThrow(expect.objectContaining({ code: 'data_not_activated' }));
  });
});
