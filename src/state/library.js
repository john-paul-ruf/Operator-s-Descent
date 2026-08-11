import { encodeRun } from './save-encode.js';
import { decodeRun } from './save-decode.js';

const KEY_RUNS = 'od_runs';
const KEY_SETTINGS = 'od_settings';
const KEY_FLAGS = 'od_flags';
const RUN_PREFIX = 'od_run_';
const LAYERS = ['drone', 'pulse', 'sparkle', 'lead', 'noiseBed'];
const LOCAL_RUN_KEY = '__operatorDescentLocalRunKey';

function getStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function storageError(error) {
  return error?.name === 'QuotaExceededError' || /quota/i.test(error?.message || '') ? 'quota_exceeded' : 'storage_failed';
}

function read(storage, key) {
  try { return { success: true, value: storage.getItem(key) }; } catch (error) { return { success: false, error: storageError(error) }; }
}

function write(storage, key, value) {
  try { storage.setItem(key, value); return { success: true }; } catch (error) { return { success: false, error: storageError(error) }; }
}

function remove(storage, key) {
  try { storage.removeItem(key); return { success: true }; } catch (error) { return { success: false, error: storageError(error) }; }
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value, min, max, fallback) { return Number.isInteger(value) && value >= min && value <= max ? value : fallback; }
function safeString(value, fallback = '', max = 128) { return typeof value === 'string' && value.length <= max ? value : fallback; }
function safeCodepoints(value) { return Array.isArray(value) ? value.filter((codepoint) => Number.isInteger(codepoint) && codepoint >= 0 && codepoint <= 0x10ffff).slice(0, 4) : []; }
function isRunKey(value) { return typeof value === 'string' && /^\d{1,10}_\d{1,16}$/.test(value); }
function keyTimestamp(key, fallback) {
  const value = Number.parseInt(String(key).split('_')[1], 10);
  return integer(value, 0, Number.MAX_SAFE_INTEGER, fallback);
}
function attachLocalRunKey(runState, key) {
  if (!runState || !isRunKey(key)) return runState;
  Object.defineProperty(runState, LOCAL_RUN_KEY, { value: key, configurable: true, writable: true, enumerable: false });
  return runState;
}

export function assignLocalRunKey(runState, timestamp = Date.now()) {
  if (!Number.isInteger(runState?.worldSeed)) return null;
  const localTimestamp = integer(timestamp, 0, Number.MAX_SAFE_INTEGER, Date.now());
  const key = `${runState.worldSeed >>> 0}_${localTimestamp}`;
  attachLocalRunKey(runState, key);
  return key;
}

export function getRunKey(runState) {
  if (isRunKey(runState?.[LOCAL_RUN_KEY])) return runState[LOCAL_RUN_KEY];
  if (!Number.isInteger(runState?.worldSeed)) return null;
  const creationTimestamp = integer(runState.creationTimestamp, 0, Number.MAX_SAFE_INTEGER, null);
  return creationTimestamp == null ? null : `${runState.worldSeed >>> 0}_${creationTimestamp}`;
}

function normalizeEntry(entry) {
  if (!isObject(entry)) return null;
  const key = safeString(entry.key);
  if (!key) return null;
  const timestamp = integer(entry.creationTimestamp ?? entry.timestamp, 0, Number.MAX_SAFE_INTEGER, 0);
  const migrated = {
    ...entry,
    key,
    worldSeed: integer(entry.worldSeed, 0, 0xffffffff, 0),
    creationTimestamp: timestamp,
    depth: integer(entry.depth, 1, 1_000_000, 1),
    partySigils: safeCodepoints(entry.partySigils),
    partyClasses: Array.isArray(entry.partyClasses) ? entry.partyClasses.map((id) => safeString(id, '', 64)).filter(Boolean).slice(0, 4) : [],
    accentSwatch: safeString(entry.accentSwatch, '#7ec8e3', 32),
    theme: safeString(entry.theme, '', 64),
    alive: entry.alive !== false,
    lastPlayed: integer(entry.lastPlayed ?? entry.timestamp, 0, Number.MAX_SAFE_INTEGER, timestamp)
  };
  return migrated;
}

function readIndex(storage) {
  const result = read(storage, KEY_RUNS);
  if (!result.success) return result;
  if (!result.value) return { success: true, index: [] };
  try {
    const parsed = JSON.parse(result.value);
    if (!Array.isArray(parsed)) return { success: true, index: [] };
    return { success: true, index: parsed.map(normalizeEntry).filter(Boolean) };
  } catch { return { success: true, index: [] }; }
}

function writeIndex(storage, index) { return write(storage, KEY_RUNS, JSON.stringify(index)); }

function defaultSettings() {
  return {
    masterMute: false,
    layerVolumes: { drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 },
    glitchEnabled: true,
    reducedMotion: 'system',
    scanlineGrainEnabled: true
  };
}

function normalizeSettings(value) {
  const input = isObject(value) ? value : {};
  const defaults = defaultSettings();
  const layers = isObject(input.layerVolumes) ? input.layerVolumes : {};
  const reducedMotion = input.reducedMotion === true ? 'reduce'
    : input.reducedMotion === false ? 'full'
      : ['system', 'reduce', 'full'].includes(input.reducedMotion) ? input.reducedMotion : defaults.reducedMotion;
  return {
    ...input,
    masterMute: typeof input.masterMute === 'boolean' ? input.masterMute : defaults.masterMute,
    layerVolumes: {
      ...layers,
      ...Object.fromEntries(LAYERS.map((layer) => [layer, Math.max(0, Math.min(100, Number.isFinite(layers[layer]) ? Math.round(layers[layer]) : defaults.layerVolumes[layer]))]))
    },
    glitchEnabled: typeof input.glitchEnabled === 'boolean' ? input.glitchEnabled : defaults.glitchEnabled,
    reducedMotion,
    scanlineGrainEnabled: typeof input.scanlineGrainEnabled === 'boolean' ? input.scanlineGrainEnabled : defaults.scanlineGrainEnabled
  };
}

function readObject(storage, key) {
  const result = read(storage, key);
  if (!result.success) return result;
  if (!result.value) return { success: true, value: {} };
  try {
    const parsed = JSON.parse(result.value);
    return { success: true, value: isObject(parsed) ? parsed : {} };
  } catch { return { success: true, value: {} }; }
}

export function saveRun(runState, metadata = {}) {
  let encoded;
  try { encoded = encodeRun(runState); } catch (error) { return { success: false, error: error?.message === 'save_budget_exceeded' ? 'save_too_large' : 'encode_failed' }; }
  if (!encoded.success) return encoded;
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  const creationTimestamp = integer(runState?.creationTimestamp, 0, Number.MAX_SAFE_INTEGER, Date.now());
  const key = getRunKey(runState) || `${runState.worldSeed >>> 0}_${creationTimestamp}`;
  attachLocalRunKey(runState, key);
  const localCreationTimestamp = keyTimestamp(key, creationTimestamp);
  const stateWrite = write(storage, RUN_PREFIX + key, encoded.fragment);
  if (!stateWrite.success) return stateWrite;
  const indexResult = readIndex(storage);
  if (!indexResult.success) return indexResult;
  const now = Date.now();
  const party = Array.isArray(runState?.party) ? runState.party : [];
  const entry = {
    ...(isObject(metadata) ? metadata : {}),
    key,
    worldSeed: runState.worldSeed >>> 0,
    creationTimestamp: localCreationTimestamp,
    depth: integer(runState.depth, 1, 1_000_000, 1),
    partySigils: party.map((character) => character?.sigilCodepoint ?? character?.sigilId).filter((sigil) => Number.isInteger(sigil)),
    partyClasses: party.map((character) => character?.classId).filter((classId) => typeof classId === 'string'),
    accentSwatch: safeString(metadata?.accentSwatch ?? metadata?.accent, '#7ec8e3', 32),
    theme: safeString(metadata?.theme ?? metadata?.themeId, '', 64),
    alive: true,
    lastPlayed: now
  };
  const index = indexResult.index;
  const existing = index.findIndex((item) => item.key === key);
  if (existing >= 0) index[existing] = { ...index[existing], ...entry };
  else index.push(entry);
  const indexWrite = writeIndex(storage, index);
  return indexWrite.success ? { success: true, key, length: encoded.length, metadata: normalizeEntry(entry) } : indexWrite;
}

export function loadRun(key) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  const safeKey = safeString(key);
  const raw = read(storage, RUN_PREFIX + safeKey);
  if (!raw.success) return raw;
  if (!raw.value) return { success: false, error: 'not_found' };
  const decoded = decodeRun(raw.value);
  if (decoded.success) attachLocalRunKey(decoded.runState, safeKey);
  return decoded;
}

export function listRuns() {
  const storage = getStorage();
  if (!storage) return [];
  const result = readIndex(storage);
  return result.success ? result.index.filter((entry) => entry.alive) : [];
}

export function deleteRunState(key) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  const removed = remove(storage, RUN_PREFIX + safeString(key));
  if (!removed.success) return removed;
  const indexResult = readIndex(storage);
  if (!indexResult.success) return indexResult;
  const entry = indexResult.index.find((item) => item.key === key);
  if (!entry) return { success: true, key, tombstoned: false };
  entry.alive = false;
  entry.lastPlayed = Date.now();
  const saved = writeIndex(storage, indexResult.index);
  return saved.success ? { success: true, key, tombstoned: true } : saved;
}

export function getSeed(key) {
  const storage = getStorage();
  if (!storage) return null;
  const result = readIndex(storage);
  return result.success ? result.index.find((entry) => entry.key === key)?.worldSeed ?? null : null;
}

export function saveSettings(settings) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  const existing = readObject(storage, KEY_SETTINGS);
  if (!existing.success) return existing;
  const normalized = normalizeSettings({ ...existing.value, ...(isObject(settings) ? settings : {}) });
  const result = write(storage, KEY_SETTINGS, JSON.stringify(normalized));
  return result.success ? { success: true, settings: normalized } : result;
}

export function loadSettings() {
  const storage = getStorage();
  if (!storage) return defaultSettings();
  const result = readObject(storage, KEY_SETTINGS);
  return result.success ? normalizeSettings(result.value) : defaultSettings();
}

export function getFlag(key) {
  const storage = getStorage();
  if (!storage) return null;
  const result = readObject(storage, KEY_FLAGS);
  return result.success && typeof key === 'string' ? result.value[key] : undefined;
}

export function setFlag(key, value) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  if (typeof key !== 'string' || !key) return { success: false, error: 'invalid_key' };
  const current = readObject(storage, KEY_FLAGS);
  if (!current.success) return current;
  const result = write(storage, KEY_FLAGS, JSON.stringify({ ...current.value, [key]: value }));
  return result.success ? { success: true } : result;
}
