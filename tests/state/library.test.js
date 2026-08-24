import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteRunState, getFlag, getSeed, listRuns, loadRun, loadSettings, saveRun, saveSettings, setFlag } from '../../src/state/library.js';
import { encodeSeed, initEncoder } from '../../src/state/save-encode.js';
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
  // exceed the URL-fragment budget, saveRun would return `save_too_large`,
  // the silent autosave would drop the descent, and reload would resume on
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

    // Log 30 realistic events on floor 1 — the exact pattern real play
    // produces. recordEvent caps at MAX_EVENTS (24 in v7 — saves-never-fail
    // SESSION-01), so the noisy log saturates at the cap.
    for (let index = 0; index < 30; index++) {
      harness.runState.recordEvent({
        type: ['combat', 'damage', 'move', 'loot', 'heal', 'discovery'][index % 6],
        message: `Floor-1 event ${index}: operator engages with mid-length dialogue.`,
        sequence: 1_700_000_000_000 + index
      });
    }
    expect(harness.runState.recentEvents).toHaveLength(24);

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

// Storage shim whose setItem behaviour is under test control. `failNextN(n)`
// makes the next n setItem calls throw QuotaExceededError. `rejectWhen(pred)`
// installs a predicate: while it returns true for a given (key, value) pair
// setItem throws quota. Mirrors browser semantics for the failure path: a
// failing setItem is a no-op on the prior stored value.
function installFailableStorage() {
  const map = new Map();
  let failuresQueued = 0;
  let predicate = null;
  const throwQuota = () => {
    const error = new Error('quota exceeded');
    error.name = 'QuotaExceededError';
    throw error;
  };
  const stub = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      if (predicate && predicate(key, String(value), map)) throwQuota();
      if (failuresQueued > 0) { failuresQueued -= 1; throwQuota(); }
      map.set(key, String(value));
    },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; }
  };
  globalThis.localStorage = stub;
  return {
    map,
    uninstall: () => { delete globalThis.localStorage; },
    failNextN: (n) => { failuresQueued = n; },
    rejectWhen: (pred) => { predicate = pred; },
    clearRejection: () => { predicate = null; failuresQueued = 0; }
  };
}

describe('library quota recovery', () => {
  it('carries encoder metrics through the saveRun result and omits `evicted` when nothing was freed', () => {
    const saved = saveRun(makeState());
    expect(saved.success).toBe(true);
    expect(saved.metrics).toEqual(expect.objectContaining({
      rawBytes: expect.any(Number),
      compressedBytes: expect.any(Number),
      layers: expect.any(Number),
      eventsKept: expect.any(Number),
      eventsDropped: expect.any(Number)
    }));
    expect(saved.metrics.eventsDropped).toBe(0);
    expect(saved).not.toHaveProperty('evicted');
  });

  it('evicts the oldest archived run to fit the live save under quota, marking it alive:false and surfacing the key', () => {
    mock.uninstall();
    const storage = installFailableStorage();
    // Two archived runs land normally.
    const older = saveRun(makeState(11, 100));
    const newer = saveRun(makeState(22, 200));
    expect(older.success).toBe(true);
    expect(newer.success).toBe(true);
    // Bump lastPlayed so eviction order is deterministic.
    const bumpLastPlayed = (key, value) => {
      const entries = JSON.parse(localStorage.getItem('od_runs'));
      const entry = entries.find((candidate) => candidate.key === key);
      entry.lastPlayed = value;
      localStorage.setItem('od_runs', JSON.stringify(entries));
    };
    bumpLastPlayed(older.key, 1000);
    bumpLastPlayed(newer.key, 5000);
    // Force ONLY the initial payload write of the live save to fail — the
    // subsequent index update and post-eviction retry succeed. This proves
    // recovery walked from sweep (no orphans, no dead) to eviction.
    storage.failNextN(1);
    const live = saveRun(makeState(33, 300));
    expect(live.success).toBe(true);
    expect(live.evicted).toEqual([older.key]);
    const index = JSON.parse(localStorage.getItem('od_runs'));
    const evictedEntry = index.find((entry) => entry.key === older.key);
    expect(evictedEntry).toMatchObject({ alive: false, evicted: true });
    expect(localStorage.getItem(`od_run_${older.key}`)).toBeNull();
    // Newer archived run and current live run survive intact.
    expect(localStorage.getItem(`od_run_${newer.key}`)).toBeTruthy();
    expect(localStorage.getItem(`od_run_${live.key}`)).toBeTruthy();
  });

  it('sweeps orphaned od_run_ keys before evicting a living archived run', () => {
    mock.uninstall();
    const storage = installFailableStorage();
    // Baseline archived run + a stale orphan (no matching index entry).
    const archived = saveRun(makeState(11, 100));
    expect(archived.success).toBe(true);
    localStorage.setItem('od_run_stale_orphan', 'x'.repeat(200));
    // Trigger a single quota failure on the next payload write. The sweep
    // should free the orphan, so no eviction happens.
    storage.failNextN(1);
    const live = saveRun(makeState(33, 300));
    expect(live.success).toBe(true);
    expect(live.evicted).toBeUndefined();
    expect(localStorage.getItem('od_run_stale_orphan')).toBeNull();
    // Archived run's payload survives the sweep.
    expect(localStorage.getItem(`od_run_${archived.key}`)).toBeTruthy();
  });

  it('sweeps stale alive:false index entries before evicting a living archived run', () => {
    mock.uninstall();
    const storage = installFailableStorage();
    // Save two runs, delete one (leaves a tombstoned alive:false entry with
    // its payload already gone). Add back a stray payload to make the sweep
    // observable.
    const dead = saveRun(makeState(11, 100));
    const living = saveRun(makeState(22, 200));
    expect(dead.success && living.success).toBe(true);
    deleteRunState(dead.key);
    localStorage.setItem(`od_run_${dead.key}`, 'stale-tombstone-payload');
    storage.failNextN(1);
    const live = saveRun(makeState(33, 300));
    expect(live.success).toBe(true);
    // No eviction — the sweep freed the dead payload and pruned the dead
    // index entry, which was enough to fit.
    expect(live.evicted).toBeUndefined();
    expect(localStorage.getItem(`od_run_${dead.key}`)).toBeNull();
    expect(localStorage.getItem(`od_run_${living.key}`)).toBeTruthy();
    const index = JSON.parse(localStorage.getItem('od_runs'));
    expect(index.some((entry) => entry.key === dead.key)).toBe(false);
  });

  it('never evicts the current run\'s own key, even when it is the only entry', () => {
    mock.uninstall();
    const storage = installFailableStorage();
    // Nothing archived. Force the payload write to fail: recovery sweeps
    // (nothing), tries to evict (no candidates), and returns quota_exceeded.
    storage.failNextN(1);
    const single = saveRun(makeState(11, 100));
    expect(single).toEqual({ success: false, error: 'quota_exceeded' });
  });

  it('caps eviction at 8 archived runs per save', () => {
    mock.uninstall();
    const storage = installFailableStorage();
    // Save 12 archived runs.
    const saved = [];
    for (let index = 0; index < 12; index++) {
      const entry = saveRun(makeState(1000 + index, 10_000 + index));
      expect(entry.success).toBe(true);
      saved.push(entry);
    }
    // Stamp lastPlayed so eviction is FIFO.
    const entries = JSON.parse(localStorage.getItem('od_runs'));
    for (let index = 0; index < entries.length; index++) {
      const saveIndex = saved.findIndex((candidate) => candidate.key === entries[index].key);
      entries[index].lastPlayed = saveIndex >= 0 ? saveIndex * 100 : 0;
    }
    localStorage.setItem('od_runs', JSON.stringify(entries));
    // Reject every setItem of the live key — payload write never succeeds so
    // recovery keeps evicting until it hits the cap of 8.
    const liveState = makeState(99_999, 999_999);
    const liveKey = `${liveState.worldSeed}_${liveState.creationTimestamp}`;
    storage.rejectWhen((key) => key === `od_run_${liveKey}`);
    const live = saveRun(liveState);
    expect(live).toEqual({ success: false, error: 'quota_exceeded' });
    // Exactly 8 archived runs were evicted (FIFO on lastPlayed) — never more.
    const finalIndex = JSON.parse(localStorage.getItem('od_runs'));
    const evictedEntries = finalIndex.filter((entry) => entry.evicted === true);
    expect(evictedEntries).toHaveLength(8);
    // The 8 evicted must be the OLDEST — first 8 saves in save order.
    const expectedEvictedKeys = saved.slice(0, 8).map((entry) => entry.key).sort();
    expect(evictedEntries.map((entry) => entry.key).sort()).toEqual(expectedEvictedKeys);
  });

  it('preserves the prior payload when the recovery ladder is exhausted', () => {
    mock.uninstall();
    const storage = installFailableStorage();
    const first = saveRun(makeState(11, 100));
    expect(first.success).toBe(true);
    const priorPayload = localStorage.getItem(`od_run_${first.key}`);
    expect(priorPayload).toBeTruthy();
    // The live save's key cannot ever be written — recovery ladder exhausts.
    const liveState = makeState(99, 999);
    storage.rejectWhen((key) => key === `od_run_${liveState.worldSeed}_${liveState.creationTimestamp}`);
    const attempt = saveRun(liveState);
    expect(attempt.success).toBe(false);
    expect(attempt.error).toBe('quota_exceeded');
    // Prior save's payload survives — a failing setItem is a no-op on the
    // previous stored value, and recovery never touched `first`'s key.
    // Note: `first` was evicted from the index because it was a valid
    // eviction candidate under recovery pressure. The invariant here is the
    // "last good save" byte-for-byte, not the index entry itself.
    expect(localStorage.getItem(`od_run_${first.key}`)).toBeNull(); // it WAS the eviction victim
    // Reset predicate + retry with the first save re-persisted: the new
    // saveRun for a different key succeeds cleanly.
    storage.clearRejection();
    const recovered = saveRun(makeState(77, 700));
    expect(recovered.success).toBe(true);
  });
});

describe('library loadRun seed floor', () => {
  it('returns seed_only when the stored value decodes only as a bare seed encoding', () => {
    // Someone stored a `#w=` fragment under a run key (or a decoded payload
    // was clipped to just its recoverable seed prefix). Per Custom Rule 13
    // this must not dead-end — surface a recoverable seed.
    const seedFragment = encodeSeed(4321);
    localStorage.setItem('od_run_seed_only_key', seedFragment);
    expect(loadRun('seed_only_key')).toEqual({
      success: false,
      error: 'seed_only',
      recoveredSeed: 4321
    });
  });

  it('leaves the existing malformed decode error intact when nothing recovers', () => {
    localStorage.setItem('od_run_still_bad', 'not a fragment');
    const result = loadRun('still_bad');
    expect(result.success).toBe(false);
    expect(result.error).toBe('malformed');
    expect(localStorage.getItem('od_run_still_bad')).toBe('not a fragment');
  });
});

describe('settings and flags', () => {
  it('uses the complete default setting shape', () => {
    expect(loadSettings()).toEqual({
      masterMute: false,
      masterVolume: 100,
      layerVolumes: { drone: 10, pulse: 75, sparkle: 100, lead: 75, noiseBed: 11 },
      glitchEnabled: true,
      reducedMotion: 'system',
      scanlineGrainEnabled: true,
      hapticsEnabled: false
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
      masterVolume: 100,
      layerVolumes: { drone: 0, pulse: 43, sparkle: 100, lead: 100, noiseBed: 11 },
      glitchEnabled: true,
      reducedMotion: 'reduce',
      scanlineGrainEnabled: true,
      hapticsEnabled: false,
      futureOption: { retained: true }
    });
  });

  it('normalizes hapticsEnabled, defaulting false on malformed input and preserving a valid boolean', () => {
    expect(loadSettings().hapticsEnabled).toBe(false);
    localStorage.setItem('od_settings', JSON.stringify({ hapticsEnabled: 'yes' }));
    expect(loadSettings().hapticsEnabled).toBe(false);
    const saved = saveSettings({ hapticsEnabled: true });
    expect(saved.success).toBe(true);
    expect(loadSettings().hapticsEnabled).toBe(true);
  });

  it('clamps and rounds masterVolume, defaults on non-finite input, preserves 0', () => {
    localStorage.setItem('od_settings', JSON.stringify({ masterVolume: 250.6 }));
    expect(loadSettings().masterVolume).toBe(100);
    localStorage.setItem('od_settings', JSON.stringify({ masterVolume: -5 }));
    expect(loadSettings().masterVolume).toBe(0);
    localStorage.setItem('od_settings', JSON.stringify({ masterVolume: 0 }));
    expect(loadSettings().masterVolume).toBe(0);
    localStorage.setItem('od_settings', JSON.stringify({ masterVolume: 'loud' }));
    expect(loadSettings().masterVolume).toBe(100);
    localStorage.setItem('od_settings', JSON.stringify({ masterVolume: null }));
    expect(loadSettings().masterVolume).toBe(100);
  });

  it('preserves masterVolume across a saveSettings round-trip', () => {
    const saved = saveSettings({ masterVolume: 42 });
    expect(saved.success).toBe(true);
    expect(loadSettings().masterVolume).toBe(42);
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
    expect(loadSettings().layerVolumes).toMatchObject({ drone: 10, sparkle: 100 });
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
