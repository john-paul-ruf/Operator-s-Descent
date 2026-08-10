import { beforeEach, afterEach, beforeAll, describe, it, expect } from 'vitest';
import {
  saveRun,
  loadRun,
  listRuns,
  deleteRunState,
  getSeed,
  saveSettings,
  loadSettings,
  getFlag,
  setFlag,
} from '../../src/state/library.js';
import { initEncoder } from '../../src/state/save-encode.js';
import { createRunState } from '../../src/state/run-state.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { makeParty, makeCharacter } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

beforeAll(() => {
  initEncoder(loadData('symbol-table'));
});

let mock;
beforeEach(() => { mock = installMockStorage(); });
afterEach(() => { mock.uninstall(); });

function makeState(seed = 42, partyN = 2) {
  const state = createRunState(seed, makeParty(partyN));
  state.creationTimestamp = 1_000_000;
  return state;
}

describe('library — no-storage branch', () => {
  it('saveRun → no_storage', () => {
    mock.uninstall();
    expect(saveRun(makeState())).toEqual({ success: false, error: 'no_storage' });
  });

  it('loadRun → no_storage', () => {
    mock.uninstall();
    expect(loadRun('any')).toEqual({ success: false, error: 'no_storage' });
  });

  it('listRuns → []', () => {
    mock.uninstall();
    expect(listRuns()).toEqual([]);
  });

  it('loadSettings → full defaults', () => {
    mock.uninstall();
    const s = loadSettings();
    expect(s).toEqual({
      masterMute: false,
      layerVolumes: { drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 },
      glitchEnabled: true,
      reducedMotion: false,
      scanlineGrainEnabled: true,
    });
  });

  it('getFlag → null', () => {
    mock.uninstall();
    expect(getFlag('anything')).toBeNull();
  });

  it('setFlag → no throw', () => {
    mock.uninstall();
    expect(() => setFlag('x', true)).not.toThrow();
  });

  it('deleteRunState → no throw', () => {
    mock.uninstall();
    expect(() => deleteRunState('x')).not.toThrow();
  });

  it('saveSettings → no throw', () => {
    mock.uninstall();
    expect(() => saveSettings({ masterMute: true })).not.toThrow();
  });
});

describe('library — saveRun', () => {
  it('returns {success: true, key, length}', () => {
    const result = saveRun(makeState());
    expect(result.success).toBe(true);
    expect(result.key).toBe('42_1000000');
    expect(typeof result.length).toBe('number');
  });

  it('stores od_run_<key> fragment and od_runs index entry', () => {
    const state = makeState();
    const result = saveRun(state);
    expect(localStorage.getItem('od_run_' + result.key)).toBeTruthy();
    const index = JSON.parse(localStorage.getItem('od_runs'));
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      key: result.key,
      worldSeed: 42,
      depth: 1,
      partyCount: 2,
      alive: true,
    });
  });

  it('partySigils keeps only integer sigilCodepoints', () => {
    const party = [
      makeCharacter({ id: 'a', sigilCodepoint: 0xE000 }),
      makeCharacter({ id: 'b', sigilCodepoint: 0xE001 }),
      makeCharacter({ id: 'c' }),
    ];
    delete party[2].sigilCodepoint;
    const state = createRunState(7, party);
    state.creationTimestamp = 500;
    saveRun(state);
    const index = JSON.parse(localStorage.getItem('od_runs'));
    expect(index[0].partySigils).toEqual([0xE000, 0xE001]);
  });

  it('saving same state again updates index (no duplicate)', () => {
    const state = makeState();
    saveRun(state);
    saveRun(state);
    const index = JSON.parse(localStorage.getItem('od_runs'));
    expect(index).toHaveLength(1);
  });
});

describe('library — loadRun', () => {
  it('decodes back — serialize() round-trip equality', () => {
    const state = makeState();
    const saved = saveRun(state);
    const loaded = loadRun(saved.key);
    expect(loaded.success).toBe(true);
    expect(loaded.runState.serialize()).toEqual(state.serialize());
  });

  it('unknown key → not_found', () => {
    expect(loadRun('nonexistent')).toEqual({ success: false, error: 'not_found' });
  });
});

describe('library — listRuns', () => {
  it('filters alive: false', () => {
    saveRun(makeState(1));
    const state2 = makeState(2);
    state2.creationTimestamp = 2_000_000;
    saveRun(state2);
    deleteRunState('1_1000000');
    const runs = listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].key).toBe('2_2000000');
  });
});

describe('library — deleteRunState', () => {
  it('removes fragment key and marks entry dead (tombstone in raw index)', () => {
    saveRun(makeState());
    deleteRunState('42_1000000');
    expect(localStorage.getItem('od_run_42_1000000')).toBeNull();
    const rawIndex = JSON.parse(localStorage.getItem('od_runs'));
    expect(rawIndex).toHaveLength(1);
    expect(rawIndex[0].alive).toBe(false);
  });

  it('listRuns omits the dead entry', () => {
    saveRun(makeState());
    deleteRunState('42_1000000');
    expect(listRuns()).toEqual([]);
  });

  it('deleting unknown key → no throw', () => {
    expect(() => deleteRunState('nonexistent')).not.toThrow();
  });
});

describe('library — getSeed', () => {
  it('returns worldSeed for known key', () => {
    saveRun(makeState(99));
    expect(getSeed('99_1000000')).toBe(99);
  });

  it('returns null for unknown key', () => {
    expect(getSeed('nonexistent')).toBeNull();
  });
});

describe('library — corrupted index', () => {
  it('listRuns returns [] on corrupt JSON', () => {
    localStorage.setItem('od_runs', '{not json');
    expect(listRuns()).toEqual([]);
  });

  it('saveRun recovers with fresh index after corruption', () => {
    localStorage.setItem('od_runs', '{not json');
    saveRun(makeState());
    const runs = listRuns();
    expect(runs).toHaveLength(1);
  });
});

describe('library — settings', () => {
  it('loadSettings with nothing stored → exact defaults', () => {
    expect(loadSettings()).toEqual({
      masterMute: false,
      layerVolumes: { drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 },
      glitchEnabled: true,
      reducedMotion: false,
      scanlineGrainEnabled: true,
    });
  });

  it('partial stored JSON merges over defaults', () => {
    saveSettings({ masterMute: true });
    const s = loadSettings();
    expect(s.masterMute).toBe(true);
    expect(s.glitchEnabled).toBe(true);
    expect(s.layerVolumes).toEqual({ drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 });
  });

  it('corrupt JSON → defaults', () => {
    localStorage.setItem('od_settings', '{not json');
    expect(loadSettings()).toEqual({
      masterMute: false,
      layerVolumes: { drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 },
      glitchEnabled: true,
      reducedMotion: false,
      scanlineGrainEnabled: true,
    });
  });

  it('saveSettings → loadSettings round-trip', () => {
    const settings = {
      masterMute: true,
      layerVolumes: { drone: 50, pulse: 60, sparkle: 70, lead: 80, noiseBed: 90 },
      glitchEnabled: false,
      reducedMotion: true,
      scanlineGrainEnabled: false,
    };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });
});

describe('library — flags', () => {
  it('setFlag then getFlag returns value', () => {
    setFlag('seen_tutorial', true);
    expect(getFlag('seen_tutorial')).toBe(true);
  });

  it('unset flag → undefined', () => {
    expect(getFlag('nonexistent')).toBeUndefined();
  });

  it('multiple flags coexist in one od_flags blob', () => {
    setFlag('flag_a', 1);
    setFlag('flag_b', 'hello');
    const blob = JSON.parse(localStorage.getItem('od_flags'));
    expect(blob).toEqual({ flag_a: 1, flag_b: 'hello' });
  });
});