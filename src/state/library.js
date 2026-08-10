import { encodeRun } from './save-encode.js';
import { decodeRun } from './save-decode.js';

const KEY_RUNS = 'od_runs';
const KEY_SETTINGS = 'od_settings';
const KEY_FLAGS = 'od_flags';
const RUN_PREFIX = 'od_run_';

function getStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readIndex() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    return JSON.parse(storage.getItem(KEY_RUNS) || '[]');
  } catch {
    return [];
  }
}

function writeIndex(index) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(KEY_RUNS, JSON.stringify(index));
}

export function saveRun(runState) {
  const result = encodeRun(runState);
  if (!result.success) return result;

  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };

  const key = `${runState.worldSeed}_${runState.creationTimestamp || Date.now()}`;
  storage.setItem(RUN_PREFIX + key, result.fragment);

  const index = readIndex();
  const entry = {
    key,
    worldSeed: runState.worldSeed,
    depth: runState.depth,
    partyCount: runState.party?.length || 0,
    partySigils: Array.isArray(runState.party)
      ? runState.party.map(character => character?.sigilCodepoint).filter(Number.isInteger)
      : [],
    alive: true,
    timestamp: Date.now()
  };

  const existing = index.findIndex(e => e.key === key);
  if (existing >= 0) index[existing] = entry;
  else index.push(entry);
  writeIndex(index);

  return { success: true, key, length: result.length };
}

export function loadRun(key) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };

  const raw = storage.getItem(RUN_PREFIX + key);
  if (!raw) return { success: false, error: 'not_found' };

  const result = decodeRun(raw);
  return result;
}

export function listRuns() {
  return readIndex().filter(e => e.alive);
}

export function deleteRunState(key) {
  const storage = getStorage();
  if (!storage) return;

  storage.removeItem(RUN_PREFIX + key);
  const index = readIndex();
  const entry = index.find(e => e.key === key);
  if (entry) {
    entry.alive = false;
    writeIndex(index);
  }
}

export function getSeed(key) {
  const index = readIndex();
  const entry = index.find(e => e.key === key);
  return entry?.worldSeed || null;
}

export function saveSettings(settings) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(KEY_SETTINGS, JSON.stringify(settings));
}

export function loadSettings() {
  const storage = getStorage();
  if (!storage) return defaultSettings();
  const raw = storage.getItem(KEY_SETTINGS);
  if (!raw) return defaultSettings();
  try {
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

export function getFlag(key) {
  const storage = getStorage();
  if (!storage) return null;
  const flags = JSON.parse(storage.getItem(KEY_FLAGS) || '{}');
  return flags[key];
}

export function setFlag(key, value) {
  const storage = getStorage();
  if (!storage) return;
  const flags = JSON.parse(storage.getItem(KEY_FLAGS) || '{}');
  flags[key] = value;
  storage.setItem(KEY_FLAGS, JSON.stringify(flags));
}

function defaultSettings() {
  return {
    masterMute: false,
    layerVolumes: { drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 },
    glitchEnabled: true,
    reducedMotion: false,
    scanlineGrainEnabled: true
  };
}
