import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteRunState, getFlag, getSeed, listRuns, loadRun, loadSettings, saveRun, saveSettings, setFlag } from '../../src/state/library.js';
import { initEncoder } from '../../src/state/save-encode.js';
import { createRunState } from '../../src/state/run-state.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { makeParty } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';
import { createGameHarness, descend, loadGameDataFixture } from '../helpers/game-fixture.js';

beforeAll(() => initEncoder(loadData('symbol-table')));

let mock;
beforeEach(() => { mock = installMockStorage(); });
afterEach(() => { mock.uninstall(); });

function makeState(seed = 42, timestamp = 1_000_000) {
  const state = createRunState(seed, makeParty(2));
  state.creationTimestamp = timestamp;
  state.party[0].classId = 'breacher';
  state.party[1].classId = 'ghost';
  return state;
}

describe('library runs', () => {
  it('stores one portable payload and complete index metadata', () => {
    const saved = saveRun(makeState(), { accentSwatch: '#e8632a', theme: 'foundry' });
    expect(saved).toMatchObject({ success: true, key: '42_1000000' });
    expect(localStorage.getItem(`od_run_${saved.key}`)).toBeTruthy();
    expect(listRuns()).toEqual([expect.objectContaining({
      key: saved.key,
      worldSeed: 42,
      creationTimestamp: 1_000_000,
      depth: 1,
      partySigils: [0xe000, 0xe000],
      partyClasses: ['breacher', 'ghost'],
      accentSwatch: '#e8632a',
      theme: 'foundry',
      alive: true,
      lastPlayed: expect.any(Number)
    })]);
  });

  it('keeps multiple independent runs with the same world seed', () => {
    saveRun(makeState(42, 100));
    saveRun(makeState(42, 200));
    expect(listRuns().map((run) => run.key)).toEqual(['42_100', '42_200']);
  });

  it('round-trips storage through the same portable decoder', () => {
    const state = makeState();
    const saved = saveRun(state);
    expect(loadRun(saved.key)).toMatchObject({ success: true, runState: expect.any(Object) });
    expect(loadRun(saved.key).runState.serialize()).toEqual(state.serialize());
  });

  it('retains a seed tombstone and removes only the mutable run state', () => {
    const saved = saveRun(makeState());
    expect(deleteRunState(saved.key)).toEqual({ success: true, key: saved.key, tombstoned: true });
    expect(localStorage.getItem(`od_run_${saved.key}`)).toBeNull();
    expect(listRuns()).toEqual([]);
    expect(getSeed(saved.key)).toBe(42);
  });

  it('migrates legacy index fields while preserving unknown fields', () => {
    localStorage.setItem('od_runs', JSON.stringify([{ key: '7_3', worldSeed: 7, depth: 2, partySigils: [0xe000], timestamp: 3, future: 'kept' }]));
    expect(listRuns()[0]).toMatchObject({ creationTimestamp: 3, lastPlayed: 3, future: 'kept', alive: true, partyClasses: [] });
  });

  it('returns named decode failures and never deletes corrupt state', () => {
    localStorage.setItem('od_run_bad', 'not a fragment');
    expect(loadRun('bad')).toEqual({ success: false, error: 'malformed' });
    expect(localStorage.getItem('od_run_bad')).toBe('not a fragment');
  });
});

describe('library hostile storage', () => {
  it('returns no-storage from saveRun', () => {
    mock.uninstall();
    expect(saveRun(makeState())).toEqual({ success: false, error: 'no_storage' });
  });

  it('returns no-storage from loadRun', () => {
    mock.uninstall();
    expect(loadRun('any')).toEqual({ success: false, error: 'no_storage' });
  });

  it('returns an empty library without storage', () => {
    mock.uninstall();
    expect(listRuns()).toEqual([]);
  });

  it('returns no-storage when deleting without storage', () => {
    mock.uninstall();
    expect(deleteRunState('any')).toEqual({ success: false, error: 'no_storage' });
  });

  it('returns no-storage when saving settings without storage', () => {
    mock.uninstall();
    expect(saveSettings({})).toEqual({ success: false, error: 'no_storage' });
  });

  it('returns no-storage when writing flags without storage', () => {
    mock.uninstall();
    expect(setFlag('tutorialDeclined', true)).toEqual({ success: false, error: 'no_storage' });
  });

  it('returns safe defaults for malformed index, settings, and flags', () => {
    localStorage.setItem('od_runs', '{bad');
    localStorage.setItem('od_settings', '[]');
    localStorage.setItem('od_flags', '{bad');
    expect(listRuns()).toEqual([]);
    expect(loadSettings().reducedMotion).toBe('system');
    expect(getFlag('tutorialDeclined')).toBeUndefined();
  });

  it('returns quota errors without throwing', () => {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => { const error = new Error('quota exceeded'); error.name = 'QuotaExceededError'; throw error; },
      removeItem: () => { throw new Error('quota exceeded'); }
    };
    expect(saveRun(makeState())).toEqual({ success: false, error: 'quota_exceeded' });
    expect(saveSettings({})).toEqual({ success: false, error: 'quota_exceeded' });
    expect(setFlag('tutorialDeclined', true)).toEqual({ success: false, error: 'quota_exceeded' });
    expect(deleteRunState('nope')).toEqual({ success: false, error: 'quota_exceeded' });
  });

  it('contains storage read failures behind safe defaults', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} };
    expect(listRuns()).toEqual([]);
    expect(loadSettings().reducedMotion).toBe('system');
    expect(getFlag('tutorialDeclined')).toBeUndefined();
  });

  it('recovers a fresh index when saving after corrupt JSON', () => {
    localStorage.setItem('od_runs', '{bad');
    expect(saveRun(makeState())).toMatchObject({ success: true });
    expect(listRuns()).toHaveLength(1);
  });

  it('does not create a tombstone for an unknown key', () => {
    expect(deleteRunState('missing')).toEqual({ success: true, key: 'missing', tombstoned: false });
  });

  it('returns not_found for an absent run and null for its seed', () => {
    expect(loadRun('missing')).toEqual({ success: false, error: 'not_found' });
    expect(getSeed('missing')).toBeNull();
  });
});

describe('library — end-to-end noisy-play descent regression', () => {
  // Before the SESSION-01 fix, a run that logged more than ~8 events would
  // exceed the 1500-char budget, saveRun would return `save_too_large`, the
  // silent autosave would drop the descent, and reload would resume on
  // whatever save last fit — usually floor 1 from creation. With slim
  // persisted events + trim-to-fit encode, the exact same play loop must
  // survive multiple descents and always resume on the latest floor.
  it('descends through two floors under load, saving noisily and resuming at depth 3', () => {
    loadGameDataFixture();
    const harness = createGameHarness({ seed: 9001, partySize: 2, depth: 1 });
    const key = `${harness.runState.worldSeed >>> 0}_${harness.runState.creationTimestamp}`;

    // Creation-time save: baseline, always fits.
    const creationSave = saveRun(harness.runState);
    expect(creationSave).toMatchObject({ success: true, key });

    // Log 30 realistic events on floor 1 — the exact pattern real play produces.
    for (let index = 0; index < 30; index++) {
      harness.runState.recordEvent({
        type: ['combat', 'damage', 'move', 'loot', 'heal', 'discovery'][index % 6],
        message: `Floor-1 event ${index}: operator engages with mid-length dialogue.`,
        sequence: 1_700_000_000_000 + index
      });
    }
    expect(harness.runState.recentEvents).toHaveLength(30);

    // Descend to floor 2 — the real progression pipeline, same one runtime uses.
    const first = descend(harness);
    expect(first.result.error).toBeUndefined();
    expect(harness.runState.depth).toBe(2);

    // Autosave after floor transition — this is the write that used to fail
    // silently, sending the player back to floor 1 on reload.
    const depth2Save = saveRun(harness.runState);
    expect(depth2Save).toMatchObject({ success: true, key });
    const depth2Load = loadRun(key);
    expect(depth2Load.success).toBe(true);
    expect(depth2Load.runState.depth).toBe(2);

    // Log another 30 events on floor 2, then descend again.
    for (let index = 0; index < 30; index++) {
      harness.runState.recordEvent({
        type: ['combat', 'damage', 'move', 'loot', 'heal', 'discovery'][index % 6],
        message: `Floor-2 event ${index}: operator engages with mid-length dialogue.`,
        sequence: 1_700_000_000_030 + index
      });
    }
    const second = descend(harness);
    expect(second.result.error).toBeUndefined();
    expect(harness.runState.depth).toBe(3);

    const depth3Save = saveRun(harness.runState);
    expect(depth3Save).toMatchObject({ success: true, key });
    const depth3Load = loadRun(key);
    expect(depth3Load.success).toBe(true);
    expect(depth3Load.runState.depth).toBe(3);
  });
});

describe('settings and flags', () => {
  it('uses the complete default setting shape', () => {
    expect(loadSettings()).toEqual({
      masterMute: false,
      layerVolumes: { drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 },
      glitchEnabled: true,
      reducedMotion: 'system',
      scanlineGrainEnabled: true
    });
  });

  it('deep-fills, clamps, migrates booleans, and preserves forward fields', () => {
    localStorage.setItem('od_settings', JSON.stringify({
      masterMute: 'yes',
      layerVolumes: { drone: -8, pulse: 42.7, lead: 999 },
      reducedMotion: true,
      futureOption: { retained: true }
    }));
    expect(loadSettings()).toEqual({
      masterMute: false,
      layerVolumes: { drone: 0, pulse: 43, sparkle: 75, lead: 100, noiseBed: 75 },
      glitchEnabled: true,
      reducedMotion: 'reduce',
      scanlineGrainEnabled: true,
      futureOption: { retained: true }
    });
  });

  it('normalizes explicit reduced-motion overrides and preserves unknown fields when saving', () => {
    localStorage.setItem('od_settings', JSON.stringify({ future: 1 }));
    const saved = saveSettings({ layerVolumes: { drone: 10 }, reducedMotion: false });
    expect(saved.success).toBe(true);
    expect(loadSettings()).toMatchObject({ future: 1, reducedMotion: 'full', layerVolumes: { drone: 10, pulse: 75 } });
  });

  it('retains the explicit system and full motion modes', () => {
    saveSettings({ reducedMotion: 'system' });
    expect(loadSettings().reducedMotion).toBe('system');
    saveSettings({ reducedMotion: 'full' });
    expect(loadSettings().reducedMotion).toBe('full');
  });

  it('uses defaults for non-numeric layer volumes', () => {
    saveSettings({ layerVolumes: { drone: 'loud', sparkle: NaN } });
    expect(loadSettings().layerVolumes).toMatchObject({ drone: 75, sparkle: 75 });
  });

  it('defensively reads and writes flags', () => {
    expect(getFlag('tutorialDeclined')).toBeUndefined();
    expect(setFlag('tutorialDeclined', true)).toEqual({ success: true });
    expect(getFlag('tutorialDeclined')).toBe(true);
  });

  it('keeps multiple flags in one hostile-input-safe object', () => {
    setFlag('tutorialDeclined', true);
    setFlag('futureFlag', 'retained');
    expect(JSON.parse(localStorage.getItem('od_flags'))).toEqual({ tutorialDeclined: true, futureFlag: 'retained' });
  });
});
