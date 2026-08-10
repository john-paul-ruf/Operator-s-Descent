import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteConfig, getLastUsed, listConfigs, loadConfig, saveConfig, setLastUsed, validateConfig } from '../../src/state/party-configs.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { loadData } from '../helpers/data.js';

let mock;
beforeEach(() => { mock = installMockStorage(); });
afterEach(() => { mock.uninstall(); });

const gameData = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
  protocols: loadData('protocols'),
  sigils: loadData('sigils')
};

function blueprint(overrides = {}) {
  return {
    version: 1,
    credits: 750,
    pointsSpent: 5,
    characters: [{
      classId: 'breacher',
      sigilCodepoint: 0xe000,
      attributes: { mgt: 3, fin: 3, vit: 3, res: 3, foc: 3, sig: 3 },
      equipment: { weapon: null, armor: null, offhand: null },
      protocols: []
    }],
    ...overrides
  };
}

describe('party configurations', () => {
  it('returns null for an unknown config and an empty list by default', () => {
    expect(loadConfig('unknown')).toBeNull();
    expect(listConfigs()).toEqual([]);
  });

  it('stores versioned normalized blueprints and returns their name separately', () => {
    const saved = saveConfig('  team a  ', blueprint());
    expect(saved).toMatchObject({ success: true, config: { name: 'team a', version: 1, pointsSpent: 5 } });
    expect(loadConfig('team a')).toMatchObject({ name: 'team a', credits: 750, characters: [expect.objectContaining({ equipment: { weapon: null, armor: null, offhand: null } })] });
  });

  it('requires explicit overwrite confirmation', () => {
    saveConfig('team', blueprint());
    expect(saveConfig('team', blueprint())).toEqual({ success: false, error: 'requiresConfirmation', requiresConfirmation: true });
    expect(saveConfig('team', blueprint({ credits: 730, pointsSpent: 7 }), { overwrite: true })).toMatchObject({ success: true });
  });

  it('preserves insertion order across distinct config names', () => {
    saveConfig('first', blueprint());
    saveConfig('second', blueprint());
    expect(listConfigs().map((config) => config.name)).toEqual(['first', 'second']);
  });

  it('caps distinct names at ten and clears a deleted last-used value', () => {
    for (let index = 0; index < 10; index++) expect(saveConfig(`team ${index}`, blueprint())).toMatchObject({ success: true });
    expect(saveConfig('eleven', blueprint())).toEqual({ success: false, error: 'max_reached' });
    expect(setLastUsed('team 0')).toMatchObject({ success: true });
    expect(getLastUsed()?.name).toBe('team 0');
    expect(deleteConfig('team 0')).toEqual({ success: true, deleted: true });
    expect(getLastUsed()).toBeNull();
  });

  it('contains malformed stored values without throwing', () => {
    localStorage.setItem('od_party_configs', '{bad');
    expect(listConfigs()).toEqual([]);
    globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('quota'); } };
    expect(saveConfig('safe', blueprint())).toEqual({ success: false, error: 'quota_exceeded' });
    expect(deleteConfig('safe')).toEqual({ success: false, error: 'quota_exceeded' });
  });

  it('reports no-storage without throwing', () => {
    mock.uninstall();
    expect(saveConfig('safe', blueprint())).toEqual({ success: false, error: 'no_storage' });
    expect(deleteConfig('safe')).toEqual({ success: false, error: 'no_storage' });
    expect(getLastUsed()).toBeNull();
  });

  it('migrates a legacy blueprint to version one and complete equipment fields', () => {
    localStorage.setItem('od_party_configs', JSON.stringify([{ name: 'legacy', characters: [blueprint().characters[0]] }]));
    expect(loadConfig('legacy')).toMatchObject({ version: 1, credits: 0, pointsSpent: 0, characters: [expect.objectContaining({ equipment: { weapon: null, armor: null, offhand: null } })] });
  });

  it('does not alter the list when deleting an unknown name', () => {
    saveConfig('keep', blueprint());
    expect(deleteConfig('missing')).toEqual({ success: true, deleted: false });
    expect(listConfigs()).toHaveLength(1);
  });

  it('rejects blank configuration names and non-object blueprints', () => {
    expect(saveConfig(' ', blueprint())).toEqual({ success: false, error: 'invalid_config' });
    expect(saveConfig('valid name', null)).toEqual({ success: false, error: 'invalid_config' });
  });
});

describe('blueprint validation', () => {
  it('accepts a legal exact 80-point accounting blueprint', () => {
    expect(validateConfig(blueprint(), gameData)).toEqual({ valid: true, invalidItems: [], pointsSpent: 5 });
  });

  it('validates versions, unique sigils, attribute bounds, gates, protocol cost, and deck capacity', () => {
    const invalid = blueprint({
      version: 2,
      characters: [
        { ...blueprint().characters[0], attributes: { mgt: 11, fin: 3, vit: 3, res: 3, foc: 3, sig: 3 }, equipment: { weapon: 'sniper', armor: 'heavy', offhand: 'shield' }, protocols: [{ school: 'ward', tier: 5 }] },
        { ...blueprint().characters[0] }
      ]
    });
    const result = validateConfig(invalid, gameData);
    expect(result.valid).toBe(false);
    expect(result.invalidItems).toEqual(expect.arrayContaining([
      { field: 'version', value: 2 },
      { field: 'attributes.mgt', value: 11 },
      { field: 'weapon', value: 'sniper', error: 'class_gate' },
      { field: 'protocol', value: { school: 'ward', tier: 5 } },
      { field: 'sigil', value: 0xe000, error: 'duplicate' }
    ]));
  });

  it('rejects mismatched points, credits, and over-capacity decks', () => {
    const compiler = blueprint({
      credits: 0,
      pointsSpent: 0,
      characters: [{
        classId: 'compiler', sigilCodepoint: 0xe010,
        attributes: { mgt: 3, fin: 3, vit: 3, res: 3, foc: 3, sig: 3 },
        equipment: { weapon: null, armor: null, offhand: null },
        protocols: [{ school: 'disrupt', tier: 3 }, { school: 'ward', tier: 3 }, { school: 'scry', tier: 1 }]
      }]
    });
    const result = validateConfig(compiler, gameData);
    expect(result.invalidItems).toEqual(expect.arrayContaining([
      { field: 'deck', value: 7 },
      { field: 'pointsSpent', value: 0, expected: 19 },
      { field: 'credits', value: 0, expected: 610 }
    ]));
  });

  it('accounts for equipped gear and protocol purchases exactly', () => {
    const equipped = blueprint({
      credits: 690,
      pointsSpent: 11,
      characters: [{
        ...blueprint().characters[0],
        equipment: { weapon: 'heavy_melee', armor: 'none', offhand: null },
        protocols: [{ school: 'disrupt', tier: 2 }]
      }]
    });
    expect(validateConfig(equipped, gameData)).toMatchObject({ valid: true, pointsSpent: 11 });
  });

  it('rejects an unknown sigil codepoint', () => {
    const result = validateConfig(blueprint({ characters: [{ ...blueprint().characters[0], sigilCodepoint: 123 }] }), gameData);
    expect(result.invalidItems).toContainEqual({ field: 'sigil', value: 123 });
  });

  it('rejects a party outside the one-to-four character range', () => {
    expect(validateConfig(blueprint({ characters: [] }), gameData).invalidItems).toContainEqual({ field: 'party', value: 0 });
  });

  it('rejects a protocol over its class tier gate', () => {
    const result = validateConfig(blueprint({
      credits: 650,
      pointsSpent: 15,
      characters: [{ ...blueprint().characters[0], protocols: [{ school: 'disrupt', tier: 5 }] }]
    }), gameData);
    expect(result.invalidItems).toContainEqual({ field: 'protocol', value: { school: 'disrupt', tier: 5 } });
  });

  it('rejects a protocol from a class-forbidden school', () => {
    const result = validateConfig(blueprint({
      credits: 730,
      pointsSpent: 7,
      characters: [{ ...blueprint().characters[0], protocols: [{ school: 'ward', tier: 1 }] }]
    }), gameData);
    expect(result.invalidItems).toContainEqual({ field: 'protocol', value: { school: 'ward', tier: 1 } });
  });

  it('rejects an equipment identifier missing from the current data', () => {
    const result = validateConfig(blueprint({ characters: [{ ...blueprint().characters[0], equipment: { weapon: 'missing', armor: null, offhand: null } }] }), gameData);
    expect(result.invalidItems).toContainEqual({ field: 'weapon', value: 'missing' });
  });

  it('rejects an offhand outside the class gate', () => {
    const result = validateConfig(blueprint({ characters: [{ ...blueprint().characters[0], classId: 'ghost', sigilCodepoint: 0xe008, equipment: { weapon: null, armor: null, offhand: 'shield' } }], credits: 720, pointsSpent: 8 }), gameData);
    expect(result.invalidItems).toContainEqual({ field: 'offhand', value: 'shield', error: 'class_gate' });
  });

  it('does not accept a stale game-data version', () => {
    expect(validateConfig(blueprint({ version: 2 }), gameData).invalidItems).toContainEqual({ field: 'version', value: 2 });
  });

  it('rejects a missing class identifier', () => {
    const result = validateConfig(blueprint({ characters: [{ ...blueprint().characters[0], classId: null }] }), gameData);
    expect(result.invalidItems).toContainEqual({ field: 'class', value: null });
  });
});
