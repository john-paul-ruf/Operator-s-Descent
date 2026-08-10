import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  saveConfig,
  loadConfig,
  listConfigs,
  deleteConfig,
  getLastUsed,
  setLastUsed,
  validateConfig,
} from '../../src/state/party-configs.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { loadData } from '../helpers/data.js';

let mock;
beforeEach(() => { mock = installMockStorage(); });
afterEach(() => { mock.uninstall(); });

const gameData = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
};

describe('party-configs — saveConfig / loadConfig', () => {
  it('saveConfig returns {success: true}', () => {
    expect(saveConfig('team_a', { characters: [] })).toMatchObject({ success: true });
  });

  it('loadConfig returns blueprint with name and numeric savedAt', () => {
    saveConfig('team_a', { characters: [{ classId: 0 }] });
    const config = loadConfig('team_a');
    expect(config.name).toBe('team_a');
    expect(typeof config.savedAt).toBe('number');
    expect(config.characters).toEqual([{ classId: 0 }]);
  });

  it('unknown name → null', () => {
    expect(loadConfig('nonexistent')).toBeNull();
  });
});

describe('party-configs — listConfigs', () => {
  it('returns all, insertion order preserved', () => {
    saveConfig('first', {});
    saveConfig('second', {});
    saveConfig('third', {});
    const list = listConfigs();
    expect(list.map(c => c.name)).toEqual(['first', 'second', 'third']);
  });
});

describe('party-configs — cap', () => {
  it('10 distinct names succeed, 11th → max_reached', () => {
    for (let i = 0; i < 10; i++) saveConfig(`config_${i}`, {});
    const result = saveConfig('config_10', {});
    expect(result).toEqual({ success: false, error: 'max_reached' });
  });

  it('overwriting existing name at cap succeeds', () => {
    for (let i = 0; i < 10; i++) saveConfig(`config_${i}`, {});
    const result = saveConfig('config_0', { updated: true });
    expect(result.success).toBe(true);
    expect(listConfigs()).toHaveLength(10);
    expect(loadConfig('config_0').updated).toBe(true);
  });
});

describe('party-configs — deleteConfig', () => {
  it('removes only the named one', () => {
    saveConfig('keep', {});
    saveConfig('delete_me', {});
    deleteConfig('delete_me');
    expect(listConfigs().map(c => c.name)).toEqual(['keep']);
  });

  it('unknown name → no throw, list unchanged', () => {
    saveConfig('keep', {});
    expect(() => deleteConfig('nonexistent')).not.toThrow();
    expect(listConfigs()).toHaveLength(1);
  });
});

describe('party-configs — last-used', () => {
  it('setLastUsed / getLastUsed round-trip', () => {
    saveConfig('active', { characters: [] });
    setLastUsed('active');
    const last = getLastUsed();
    expect(last.name).toBe('active');
  });

  it('nothing set → null', () => {
    expect(getLastUsed()).toBeNull();
  });

  it('last-used pointing at deleted config → null', () => {
    saveConfig('doomed', {});
    setLastUsed('doomed');
    deleteConfig('doomed');
    expect(getLastUsed()).toBeNull();
  });
});

describe('party-configs — corrupt JSON', () => {
  it('listConfigs returns [] on corrupt od_party_configs', () => {
    localStorage.setItem('od_party_configs', '{not json');
    expect(listConfigs()).toEqual([]);
  });
});

describe('party-configs — validateConfig', () => {
  it('blueprint with no characters → valid', () => {
    const result = validateConfig({}, gameData);
    expect(result.valid).toBe(true);
    expect(result.invalidItems).toEqual([]);
  });

  it('unknown weapon id flagged', () => {
    const result = validateConfig({
      characters: [{ classId: 0, equipment: { weapon: 'nonexistent_weapon' } }],
    }, gameData);
    expect(result.valid).toBe(false);
    expect(result.invalidItems).toContainEqual({ field: 'weapon', value: 'nonexistent_weapon' });
  });

  it('unknown armor id flagged', () => {
    const result = validateConfig({
      characters: [{ classId: 0, equipment: { armor: 'nonexistent_armor' } }],
    }, gameData);
    expect(result.valid).toBe(false);
    expect(result.invalidItems).toContainEqual({ field: 'armor', value: 'nonexistent_armor' });
  });

  it('valid numeric classId (0–5) passes class check', () => {
    const result = validateConfig({
      characters: [{ classId: 0 }],
    }, gameData);
    expect(result.invalidItems).not.toContainEqual(expect.objectContaining({ field: 'class' }));
  });

  it('symbolic classId (e.g. "breacher") fails — array indexed, not keyed by id', () => {
    const result = validateConfig({
      characters: [{ classId: 'breacher' }],
    }, gameData);
    expect(result.invalidItems).toContainEqual({ field: 'class', value: 'breacher' });
  });

  it('multiple invalid fields accumulate', () => {
    const result = validateConfig({
      characters: [
        { classId: 'bad', equipment: { weapon: 'bad_weapon', armor: 'bad_armor' } },
        { classId: 99 },
      ],
    }, gameData);
    expect(result.invalidItems).toContainEqual({ field: 'class', value: 'bad' });
    expect(result.invalidItems).toContainEqual({ field: 'weapon', value: 'bad_weapon' });
    expect(result.invalidItems).toContainEqual({ field: 'armor', value: 'bad_armor' });
    expect(result.invalidItems).toContainEqual({ field: 'class', value: 99 });
  });
});