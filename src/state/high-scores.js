const KEY_HIGH_SCORES = 'od_high_scores';
export const HIGH_SCORE_CAP = 50;

function getStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value, min, max, fallback) { return Number.isInteger(value) && value >= min && value <= max ? value : fallback; }
function safeString(value, fallback = '', max = 128) { return typeof value === 'string' && value.length <= max ? value : fallback; }
function safeCodepoints(value) { return Array.isArray(value) ? value.filter((cp) => Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff).slice(0, 4) : []; }
function safeClasses(value) { return Array.isArray(value) ? value.map((id) => safeString(id, '', 64)).filter(Boolean).slice(0, 4) : []; }
function safeAccent(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#7ec8e3'; }

function normalizeEntry(entry) {
  if (!isObject(entry)) return null;
  if (!Number.isInteger(entry.worldSeed) || !Number.isInteger(entry.depth)) return null;
  const worldSeed = integer(entry.worldSeed, 0, 0xffffffff, 0);
  const endedAt = integer(entry.endedAt, 0, Number.MAX_SAFE_INTEGER, 0);
  return {
    key: `${worldSeed}_${endedAt}`,
    worldSeed,
    depth: integer(entry.depth, 1, 1_000_000, 1),
    theme: safeString(entry.theme, '', 64),
    accentSwatch: safeAccent(entry.accentSwatch),
    partySigils: safeCodepoints(entry.partySigils),
    partyClasses: safeClasses(entry.partyClasses),
    causeOfDeath: safeString(entry.causeOfDeath, 'UNKNOWN', 64),
    endedAt
  };
}

function rank(list) {
  return [...list].sort((a, b) => b.depth - a.depth || b.endedAt - a.endedAt);
}

function readList(storage) {
  try {
    const raw = storage.getItem(KEY_HIGH_SCORES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeEntry).filter(Boolean) : [];
  } catch { return []; }
}

function writeList(storage, list) {
  try { storage.setItem(KEY_HIGH_SCORES, JSON.stringify(list)); return true; } catch { return false; }
}

export function recordHighScore(runState, extra = {}) {
  if (!Number.isInteger(runState?.worldSeed) || !Number.isInteger(runState?.depth)) {
    return { success: false, error: 'invalid_run' };
  }
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  const party = Array.isArray(runState.party) ? runState.party : [];
  const entry = normalizeEntry({
    worldSeed: runState.worldSeed >>> 0,
    depth: runState.depth,
    theme: extra.theme,
    accentSwatch: extra.accentSwatch,
    // Mirrors src/state/library.js saveRun()'s entryBase derivation verbatim (lines ~270-276).
    partySigils: party.map((character) => character?.sigilCodepoint ?? character?.sigilId).filter((sigil) => Number.isInteger(sigil)),
    partyClasses: party.map((character) => character?.classId).filter((classId) => typeof classId === 'string'),
    causeOfDeath: extra.causeOfDeath,
    endedAt: Date.now()
  });
  if (!entry) return { success: false, error: 'invalid_run' };
  const ranked = rank([...readList(storage), entry]);
  const kept = ranked.slice(0, HIGH_SCORE_CAP);
  const madeCut = kept.some((item) => item.key === entry.key);
  if (!writeList(storage, kept)) return { success: false, error: 'storage_failed' };
  return { success: true, entry, madeCut, rank: madeCut ? kept.findIndex((item) => item.key === entry.key) + 1 : null };
}

export function listHighScores() {
  const storage = getStorage();
  if (!storage) return [];
  return rank(readList(storage));
}
