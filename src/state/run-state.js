import { dangerClockBaseRate, corruptionDangerRate } from '../rules/scaling.js';
import { createRNGCursorForRun } from '../core/rng-cursor.js';
import { GRID_W, GRID_H } from '../floor/archetypes.js';

// v6 derives fog sizing from the live floor dimensions (floor → state import
// is legal per FORGE-CONFIG). SESSION-05 flips GRID_W×GRID_H to 40×64; this
// module absorbs the change without a second schema bump because the v6 wire
// format writes fog as varUint length + bytes. Loading a pre-flip save into
// the post-flip world lands via `normalizeFog`'s reset branch below.
const GRID_WIDTH = GRID_W;
const GRID_HEIGHT = GRID_H;
export const FOG_BYTES = Math.ceil((GRID_WIDTH * GRID_HEIGHT) / 8);
const MAX_DEPTH = 255;
const MAX_INVENTORY = 100;
const MAX_ECHOES = 2;
const MAX_CORRUPT_IMPLANTS = 118;
const MAX_AFFIX_LEDGER_IDS = 12;
const MAX_EVENTS = 64;
const MAX_BITFIELD = (1n << 64n) - 1n;
const MAX_EXTENSION_BYTES = 2048;
const MAX_COMBAT_BYTES = 12288;
const ATTRIBUTE_NAMES = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneBounded(value, maxBytes) {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json === undefined || json.length > maxBytes) return undefined;
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function finiteInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function cloneExtensions(value) {
  return isPlainObject(value) ? cloneBounded(value, MAX_EXTENSION_BYTES) || {} : {};
}

function normalizeBitfield(value) {
  try {
    const bitfield = typeof value === 'bigint' ? value : BigInt(value ?? 0);
    return bitfield >= 0n && bitfield <= MAX_BITFIELD ? bitfield : null;
  } catch {
    return null;
  }
}

// v6 tolerant fog normalization. A length mismatch (e.g. loading a pre-flip
// 80-byte fog into the post-flip 320-byte world, or vice-versa) is not an
// error — the caller resets fog to a fresh zeroed buffer AND discards the
// stale party position so the lattice entry-point fallback places the party
// on a real open cell. Only genuinely malformed inputs (non-array or byte
// out of range) return null. Returned shape: { fog, reset } — reset === true
// signals the caller that partyPosition should also be reset.
function normalizeFog(value) {
  if (value === undefined) return { fog: new Uint8Array(FOG_BYTES), reset: false };
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) return null;
  if (value.length !== FOG_BYTES) return { fog: new Uint8Array(FOG_BYTES), reset: true };
  const fog = new Uint8Array(FOG_BYTES);
  for (let index = 0; index < FOG_BYTES; index++) {
    if (!finiteInteger(value[index], 0, 255)) return null;
    fog[index] = value[index];
  }
  return { fog, reset: false };
}

function normalizeAttributes(value) {
  if (!isPlainObject(value)) return null;
  const attributes = {};
  for (const name of ATTRIBUTE_NAMES) {
    if (!finiteInteger(value[name], 1, 10)) return null;
    attributes[name] = value[name];
  }
  return attributes;
}

function normalizeEquipment(value) {
  if (!isPlainObject(value)) return { weapon: null, armor: null, offhand: null };
  const equipment = {};
  for (const slot of ['weapon', 'armor', 'offhand']) {
    equipment[slot] = value[slot] == null ? null : normalizeItem(value[slot]);
    if (value[slot] != null && equipment[slot] === null) return null;
  }
  return equipment;
}

function normalizeItem(value) {
  if (!isPlainObject(value) || typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 96) return null;
  if (typeof value.category !== 'string' || typeof value.baseType !== 'string') return null;
  if (!Array.isArray(value.affixes) || value.affixes.length > 8 || !value.affixes.every(id => typeof id === 'string' && id.length <= 64)) return null;
  if (!Number.isFinite(value.salvageValue) || value.salvageValue < 0 || value.salvageValue > 1_000_000) return null;
  if (value.count !== undefined && !finiteInteger(value.count, 1, 100)) return null;
  if (value.corruptionValue !== undefined && (!Number.isFinite(value.corruptionValue) || value.corruptionValue < 0 || value.corruptionValue > 1_000_000)) return null;
  const item = {
    id: value.id,
    category: value.category,
    baseType: value.baseType,
    rarity: typeof value.rarity === 'string' ? value.rarity : 'stock',
    affixes: [...value.affixes],
    corrupt: Boolean(value.corrupt),
    stats: cloneBounded(value.stats ?? {}, MAX_EXTENSION_BYTES) || {},
    salvageValue: value.salvageValue,
    junkTagged: Boolean(value.junkTagged)
  };
  if (value.count !== undefined) item.count = value.count;
  if (value.corruptionValue !== undefined) item.corruptionValue = value.corruptionValue;
  const known = new Set([...Object.keys(item), 'extensions']);
  const extensions = cloneExtensions(value.extensions);
  for (const [key, entry] of Object.entries(value)) {
    if (!known.has(key) && cloneBounded(entry, MAX_EXTENSION_BYTES) !== undefined) extensions[key] = cloneBounded(entry, MAX_EXTENSION_BYTES);
  }
  if (Object.keys(extensions).length) item.extensions = cloneExtensions(extensions);
  return item;
}

function sigilIdFromLegacy(value) {
  return finiteInteger(value, 0, 0x10ffff) ? `pua-${value.toString(16)}` : null;
}

function legacyCodepoint(sigilId) {
  const match = typeof sigilId === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(sigilId);
  return match ? Number.parseInt(match[1], 16) : undefined;
}

function addLegacyAliases(character) {
  const extensions = character.extensions || {};
  const alias = (name, getter, setter) => Object.defineProperty(character, name, {
    enumerable: false,
    configurable: true,
    get: getter,
    set: setter
  });
  alias('hp', () => character.currentHP, value => { character.currentHP = value; });
  alias('charge', () => character.currentCHARGE, value => { character.currentCHARGE = value; });
  alias('protocols', () => character.protocolDeck, value => { character.protocolDeck = value; });
  alias('sigilCodepoint', () => legacyCodepoint(character.sigilId) ?? extensions.sigilCodepoint, value => {
    const sigilId = sigilIdFromLegacy(value);
    if (sigilId) character.sigilId = sigilId;
  });
  alias('weapon', () => character.equipment.weapon, value => { character.equipment.weapon = value; });
  alias('armor', () => character.equipment.armor, value => { character.equipment.armor = value; });
  alias('offhand', () => character.equipment.offhand, value => { character.equipment.offhand = value; });
  for (const key of Object.keys(extensions)) {
    if (!(key in character)) alias(key, () => extensions[key], value => { extensions[key] = value; });
  }
  return character;
}

function normalizeCharacter(value, { sourceVersion, allowConstructionDefaults = false } = {}) {
  if (!isPlainObject(value) || typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 96) return null;
  const classId = typeof value.classId === 'string' && value.classId.length <= 64
    ? value.classId
    : allowConstructionDefaults ? 'legacy' : null;
  const sigilId = typeof value.sigilId === 'string' && value.sigilId.length <= 64
    ? value.sigilId
    : sigilIdFromLegacy(value.sigilCodepoint) ?? (allowConstructionDefaults ? `legacy-${value.id}` : null);
  if (!classId || !sigilId) return null;
  const attributes = normalizeAttributes(value.attributes);
  if (!attributes) return null;
  const currentHP = value.currentHP ?? value.hp;
  const currentCHARGE = value.currentCHARGE ?? value.charge;
  if (!finiteInteger(currentHP, 0, 255) || !finiteInteger(currentCHARGE, 0, 255)) return null;
  const protocolDeck = value.protocolDeck ?? value.protocols ?? [];
  if (!Array.isArray(protocolDeck) || protocolDeck.length > 20 || !protocolDeck.every(protocol => isPlainObject(protocol) && typeof protocol.school === 'string' && finiteInteger(protocol.tier, 1, 5))) return null;
  const conditions = value.conditions ?? [];
  if (!Array.isArray(conditions) || conditions.length > 9 || !conditions.every(condition => isPlainObject(condition) && typeof (condition.conditionId ?? condition.id) === 'string' && finiteInteger(condition.duration, 0, 255) && (condition.stacks === undefined || finiteInteger(condition.stacks, 1, 255)))) return null;
  const equipment = normalizeEquipment(value.equipment ?? { weapon: value.weapon, armor: value.armor, offhand: value.offhand });
  if (!equipment) return null;
  const calibrationChoices = value.calibrationChoices ?? [];
  if (!Array.isArray(calibrationChoices) || calibrationChoices.length > 16 || !calibrationChoices.every(choice => isPlainObject(choice) && finiteInteger(choice.floor, 1, MAX_DEPTH) && typeof choice.optionId === 'string' && choice.optionId.length <= 96)) return null;
  const character = {
    id: value.id,
    classId,
    sigilId,
    attributes,
    currentHP,
    currentCHARGE,
    calibrationCount: finiteInteger(value.calibrationCount ?? 0, 0, 16) ? value.calibrationCount ?? 0 : null,
    calibrationChoices: calibrationChoices.map(choice => ({ floor: choice.floor, optionId: choice.optionId })),
    signatureTier: finiteInteger(value.signatureTier ?? 1, 1, 3) ? value.signatureTier ?? 1 : null,
    equipment,
    protocolDeck: protocolDeck.map(protocol => ({ school: protocol.school, tier: protocol.tier })),
    conditions: conditions.map(condition => ({ conditionId: condition.conditionId ?? condition.id, duration: condition.duration, ...(condition.stacks === undefined ? {} : { stacks: condition.stacks }) }))
  };
  if (character.calibrationCount === null || character.signatureTier === null) return null;
  const known = new Set([...Object.keys(character), 'hp', 'charge', 'protocols', 'sigilCodepoint', 'weapon', 'armor', 'offhand', 'extensions']);
  const extensions = cloneExtensions(value.extensions);
  for (const [key, entry] of Object.entries(value)) {
    if (!known.has(key) && cloneBounded(entry, MAX_EXTENSION_BYTES) !== undefined) extensions[key] = cloneBounded(entry, MAX_EXTENSION_BYTES);
  }
  if (Object.keys(extensions).length) character.extensions = cloneExtensions(extensions);
  return addLegacyAliases(character);
}

function normalizeRngState(value) {
  if (value == null) return null;
  if (!isPlainObject(value)) return null;
  const output = {};
  for (const stream of ['gen', 'combat']) {
    const state = value[stream];
    if (!isPlainObject(state) || !finiteInteger(state.cursor, 0, Number.MAX_SAFE_INTEGER)) return null;
    const prngState = state.prngState;
    const parts = Array.isArray(prngState)
      ? prngState
      : isPlainObject(prngState) ? ['a', 'b', 'c', 'd'].map(key => prngState[key]) : null;
    if (!parts || parts.length !== 4 || !parts.every(part => finiteInteger(part, 0, 0xffffffff))) return null;
    output[stream] = { cursor: state.cursor, prngState: { a: parts[0], b: parts[1], c: parts[2], d: parts[3] } };
  }
  return output;
}

function normalizeEcho(value, sourceVersion) {
  if (!isPlainObject(value) || !finiteInteger(value.deathFloor, 1, MAX_DEPTH) || !finiteInteger(value.appearanceFloor, value.deathFloor + 2, value.deathFloor + 4)) return null;
  const character = normalizeCharacter(value.character, { sourceVersion });
  if (!character) return null;
  const echo = { character, deathFloor: value.deathFloor, appearanceFloor: value.appearanceFloor };
  if (value.consumed === true) {
    echo.consumed = true;
    echo.resolved = value.resolved === 'retreated' ? 'retreated' : 'killed';
  }
  return echo;
}

const PERSISTED_EVENT_TYPE_MAX = 16;
const PERSISTED_EVENT_MESSAGE_MAX = 72;

// Single canonical boundary for every persisted RunState event. Live combat/runtime
// entries may carry `detail`, `entry`, `timestamp`, roll fields, or other rich
// presentation payload — none of it belongs in the save. Only bounded `type` and
// `message` (plus optional finite `sequence`) survive. Applied both when recordEvent
// pushes a new event and when normalizeRunState loads an older/local save, so stale
// detail from a legacy payload never re-enters the in-memory state.
function normalizePersistedEvent(event) {
  if (!isPlainObject(event)) return undefined;
  const type = typeof event.type === 'string' && event.type.length > 0
    ? event.type.slice(0, PERSISTED_EVENT_TYPE_MAX)
    : 'info';
  const rawMessage = typeof event.message === 'string' ? event.message : undefined;
  if (rawMessage === undefined) return undefined;
  const message = rawMessage.slice(0, PERSISTED_EVENT_MESSAGE_MAX);
  const entry = { type, message };
  if (Number.isFinite(event.sequence)) entry.sequence = event.sequence;
  return entry;
}

// Array-level policy: a non-array or oversized array is rejected (matches the
// prior structured-clone gate). Per-entry policy on load: an entry that fails
// the canonical sanitizer (e.g. a legacy `{containerId, count, type}` loot
// row without a `message` string that shipped in early v4 saves) is silently
// dropped so Custom Rule 13 saves keep loading. recordEvent still calls the
// per-entry sanitizer directly and rejects invalid input at that boundary.
function normalizePersistedEvents(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_EVENTS) return null;
  return value.map(normalizePersistedEvent).filter(entry => entry !== undefined);
}

function serializeCharacter(character) {
  const copy = {
    id: character.id,
    classId: character.classId,
    sigilId: character.sigilId,
    attributes: { ...character.attributes },
    currentHP: character.currentHP,
    currentCHARGE: character.currentCHARGE,
    calibrationCount: character.calibrationCount,
    calibrationChoices: character.calibrationChoices.map(choice => ({ ...choice })),
    signatureTier: character.signatureTier,
    equipment: Object.fromEntries(Object.entries(character.equipment).map(([slot, item]) => [slot, item ? serializeItem(item) : null])),
    protocolDeck: character.protocolDeck.map(protocol => ({ ...protocol })),
    conditions: character.conditions.map(condition => ({ ...condition }))
  };
  if (copy.calibrationCount === 0) delete copy.calibrationCount;
  if (copy.calibrationChoices.length === 0) delete copy.calibrationChoices;
  if (copy.signatureTier === 1) delete copy.signatureTier;
  if (copy.protocolDeck.length === 0) delete copy.protocolDeck;
  if (copy.conditions.length === 0) delete copy.conditions;
  if (Object.values(copy.equipment).every(item => item === null)) delete copy.equipment;
  if (character.extensions) copy.extensions = cloneExtensions(character.extensions);
  return copy;
}

function serializeItem(item) {
  const copy = { ...item, affixes: [...item.affixes], stats: cloneBounded(item.stats, MAX_EXTENSION_BYTES) || {} };
  if (item.extensions) copy.extensions = cloneExtensions(item.extensions);
  return copy;
}

function serializedState(state) {
  const output = {
    worldSeed: state.worldSeed,
    creationTimestamp: state.creationTimestamp,
    depth: state.depth,
    floorSubSeed: state.floorSubSeed,
    partyPosition: { ...state.partyPosition },
    fogOfWar: Array.from(state.fogOfWar),
    openedContainers: state.openedContainers.toString(),
    defeatedEnemies: state.defeatedEnemies.toString(),
    dangerClockProgress: state.dangerClockProgress,
    party: state.party.map(serializeCharacter),
    inventory: state.inventory.map(serializeItem),
    corruption: state.corruption,
    credits: state.credits,
    scrapCounter: state.scrapCounter,
    themesSeen: [...state.themesSeen],
    echoQueue: state.echoQueue.map(echo => ({
      character: serializeCharacter(echo.character),
      deathFloor: echo.deathFloor,
      appearanceFloor: echo.appearanceFloor,
      ...(echo.consumed ? { consumed: true, resolved: echo.resolved || 'killed' } : {})
    })),
    rngState: state.rngState ? cloneBounded(state.rngState, MAX_EXTENSION_BYTES) : null,
    flags: { version: 2, calibrationFloorsReached: [...state.flags.calibrationFloorsReached] }
  };
  if (state.appliedCorruptItemIds.length) output.appliedCorruptItemIds = [...state.appliedCorruptItemIds];
  if (state.affixFloorLedger.reroll.length || state.affixFloorLedger.floorEntry.length) output.affixFloorLedger = {
    floor: state.affixFloorLedger.floor,
    reroll: [...state.affixFloorLedger.reroll],
    floorEntry: [...state.affixFloorLedger.floorEntry]
  };
  if (state.activeCombat) output.activeCombat = cloneBounded(state.activeCombat, MAX_COMBAT_BYTES);
  if (state.recentEvents.length) output.recentEvents = state.recentEvents.map(event => cloneBounded(event, MAX_EXTENSION_BYTES));
  if (Object.values(state.stats).some(value => value !== 0)) output.stats = { ...state.stats };
  if (state.extensions && Object.keys(state.extensions).length) output.extensions = cloneExtensions(state.extensions);
  return output;
}

function buildRunState(data) {
  const state = {
    ...data,
    serialize() {
      return serializedState(this);
    },
    advanceFloor() {
      if (this.depth >= MAX_DEPTH) return { advanced: false, reason: 'depth_cap' };
      this.depth += 1;
      this.fogOfWar = new Uint8Array(FOG_BYTES);
      this.openedContainers = 0n;
      this.defeatedEnemies = 0n;
      this.dangerClockProgress = 0;
      this.activeCombat = null;
      this.affixFloorLedger = { floor: this.depth, reroll: [], floorEntry: [] };
      this.stats.floorsDescended += 1;
      for (const character of this.party) character.conditions = [];
      return { advanced: true, depth: this.depth };
    },
    addCorruption(amount) {
      if (!Number.isFinite(amount) || amount < 0) return { added: false, reason: 'invalid_amount' };
      this.corruption = Math.min(1_000_000, this.corruption + amount);
      return { added: true, corruption: this.corruption };
    },
    applyCorruptImplant(itemId, amount) {
      if (typeof itemId !== 'string' || itemId.length < 1 || itemId.length > 96 || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return false;
      if (this.appliedCorruptItemIds.includes(itemId)) return true;
      if (this.appliedCorruptItemIds.length >= MAX_CORRUPT_IMPLANTS) return false;
      this.appliedCorruptItemIds.push(itemId);
      this.corruption = Math.min(1_000_000, this.corruption + amount);
      return true;
    },
    claimAffixUse(kind, itemId) {
      if (!['reroll', 'floor_entry'].includes(kind) || typeof itemId !== 'string' || itemId.length < 1 || itemId.length > 96) return { claimed: false, reason: 'invalid_affix_use' };
      if (this.affixFloorLedger.floor !== this.depth) this.affixFloorLedger = { floor: this.depth, reroll: [], floorEntry: [] };
      const ledger = this.affixFloorLedger[kind === 'floor_entry' ? 'floorEntry' : kind];
      if (ledger.includes(itemId)) return { claimed: false, reason: 'already_used' };
      if (ledger.length >= MAX_AFFIX_LEDGER_IDS) return { claimed: false, reason: 'ledger_full' };
      ledger.push(itemId);
      return { claimed: true };
    },
    queueEcho(deadCharacter, deathFloor, rngCursor) {
      if (this.echoQueue.length >= MAX_ECHOES) return { queued: false, reason: 'queue_full' };
      if (!finiteInteger(deathFloor, 1, MAX_DEPTH)) return { queued: false, reason: 'invalid_floor' };
      const character = normalizeCharacter(deadCharacter, { sourceVersion: 2, allowConstructionDefaults: true });
      if (!character) return { queued: false, reason: 'invalid_character' };
      const cursor = rngCursor || createRNGCursorForRun(this.worldSeed, this.rngState);
      if (!cursor || typeof cursor.nextInt !== 'function') return { queued: false, reason: 'invalid_rng' };
      const echo = { character, deathFloor, appearanceFloor: deathFloor + 2 + cursor.nextInt('combat', 3) };
      this.echoQueue.push(echo);
      this.rngState = cursor.getState?.() || this.rngState;
      return { queued: true, echo: { character: serializeCharacter(echo.character), deathFloor: echo.deathFloor, appearanceFloor: echo.appearanceFloor } };
    },
    getDangerClockRate() {
      return dangerClockBaseRate(this.depth) + corruptionDangerRate(this.corruption);
    },
    markContainerOpened(containerId) {
      if (!finiteInteger(containerId, 0, 63)) return { marked: false, reason: 'invalid_id' };
      this.openedContainers |= 1n << BigInt(containerId);
      return { marked: true };
    },
    markEnemyDefeated(enemyId) {
      if (!finiteInteger(enemyId, 0, 63)) return { marked: false, reason: 'invalid_id' };
      this.defeatedEnemies |= 1n << BigInt(enemyId);
      this.stats.enemiesSlain += 1;
      return { marked: true };
    },
    isCellVisited(x, y) {
      if (!finiteInteger(x, 0, GRID_WIDTH - 1) || !finiteInteger(y, 0, GRID_HEIGHT - 1)) return false;
      const index = y * GRID_WIDTH + x;
      return (this.fogOfWar[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
    },
    markCellVisited(x, y) {
      if (!finiteInteger(x, 0, GRID_WIDTH - 1) || !finiteInteger(y, 0, GRID_HEIGHT - 1)) return { marked: false, reason: 'invalid_coordinate' };
      const index = y * GRID_WIDTH + x;
      this.fogOfWar[Math.floor(index / 8)] |= 1 << (index % 8);
      return { marked: true };
    },
    resetFogOfWar() {
      this.fogOfWar = new Uint8Array(FOG_BYTES);
      return { reset: true };
    },
    addScrap(value) {
      if (!finiteInteger(value, 0, 1_000_000)) return { added: false, reason: 'invalid_value' };
      this.scrapCounter = Math.min(1_000_000_000, this.scrapCounter + value);
      return { added: true, scrapCounter: this.scrapCounter };
    },
    getInventoryCount() {
      return this.inventory.reduce((count, item) => count + (item.count ?? 1), 0);
    },
    isInventoryFull() {
      return this.getInventoryCount() >= MAX_INVENTORY;
    },
    recordEvent(event) {
      const entry = normalizePersistedEvent(event);
      if (entry === undefined) return { recorded: false, reason: 'invalid_event' };
      this.recentEvents.push(entry);
      if (this.recentEvents.length > MAX_EVENTS) this.recentEvents.splice(0, this.recentEvents.length - MAX_EVENTS);
      return { recorded: true };
    },
    applyCombatResult(combatResult) {
      if (!combatResult || !combatResult.result) return { applied: false, reason: 'invalid-result' };
      if (combatResult.result === 'victory') {
        this.activeCombat = null;
        this.dangerClockProgress = 0;
        if (combatResult.victoryPayload?.defeatedSpawnIds) {
          for (const id of combatResult.victoryPayload.defeatedSpawnIds) this.stats.enemiesSlain += 1;
        }
      } else if (combatResult.result === 'retreat') {
        this.activeCombat = null;
        this.dangerClockProgress = 0;
      } else if (combatResult.result === 'wipe') {
        this.activeCombat = null;
      }
      return { applied: true, result: combatResult.result };
    },
    setActiveCombat(snapshot) {
      if (snapshot === null) { this.activeCombat = null; return { set: true }; }
      const bounded = cloneBounded(snapshot, MAX_COMBAT_BYTES);
      if (bounded === undefined) return { set: false, reason: 'invalid-snapshot' };
      this.activeCombat = bounded;
      return { set: true };
    },
    addThemeSeen(themeId) {
      if (typeof themeId !== 'string' || themeId.length < 1 || themeId.length > 64) return { added: false, reason: 'invalid_theme' };
      if (this.themesSeen.has(themeId)) return { added: false, reason: 'already_seen' };
      this.themesSeen.add(themeId);
      return { added: true };
    },
    getDueEchoes(floorNumber) {
      if (!finiteInteger(floorNumber, 1, MAX_DEPTH)) return [];
      return this.echoQueue.filter(echo => echo.appearanceFloor === floorNumber && !echo.consumed);
    },
    consumeEcho(echoIndex) {
      if (!finiteInteger(echoIndex, 0, this.echoQueue.length - 1)) return { consumed: false, reason: 'invalid_index' };
      const echo = this.echoQueue[echoIndex];
      if (echo.consumed) return { consumed: false, reason: 'already_consumed' };
      echo.consumed = true;
      echo.resolved = 'killed';
      return { consumed: true, echo };
    },
    resolveEchoRetreat(echoIndex) {
      if (!finiteInteger(echoIndex, 0, this.echoQueue.length - 1)) return { resolved: false, reason: 'invalid_index' };
      const echo = this.echoQueue[echoIndex];
      if (echo.consumed) return { resolved: false, reason: 'already_consumed' };
      echo.consumed = true;
      echo.resolved = 'retreated';
      return { resolved: true, echo };
    }
  };
  return state;
}

export function validateRunState(input) {
  const state = normalizeRunState(input, { sourceVersion: input?.flags?.version === 1 ? 1 : 2 });
  return state ? { valid: true, errors: [] } : { valid: false, errors: ['invalid_run_state'] };
}

function normalizeRunState(input, { sourceVersion, allowConstructionDefaults = false } = {}) {
  if (!isPlainObject(input) || !finiteInteger(input.worldSeed, 0, 0xffffffff)) return null;
  if (!finiteInteger(input.creationTimestamp, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!finiteInteger(input.depth, 1, MAX_DEPTH) || !finiteInteger(input.floorSubSeed, 0, 0xffffffff)) return null;
  const fogResult = normalizeFog(input.fogOfWar);
  // When fog resets (length mismatch — pre-flip save into post-flip world or
  // vice-versa) we discard the stale partyPosition too and hand a corner cell
  // to the lattice; lattice.js line 20-34 fallback resolves it to entryPoint
  // or the first open cell.
  const partyPositionInput = fogResult && fogResult.reset
    ? { x: 0, y: 0 }
    : input.partyPosition;
  if (!isPlainObject(partyPositionInput) || !finiteInteger(partyPositionInput.x, 0, GRID_WIDTH - 1) || !finiteInteger(partyPositionInput.y, 0, GRID_HEIGHT - 1)) return null;
  const openedContainers = normalizeBitfield(input.openedContainers);
  const defeatedEnemies = normalizeBitfield(input.defeatedEnemies);
  if (!fogResult || openedContainers === null || defeatedEnemies === null || !Number.isFinite(input.dangerClockProgress ?? 0) || input.dangerClockProgress < 0 || input.dangerClockProgress > 1_000_000) return null;
  const fogOfWar = fogResult.fog;
  if (!Array.isArray(input.party) || input.party.length > 4 || (!allowConstructionDefaults && input.party.length < 1)) return null;
  const party = input.party.map(character => normalizeCharacter(character, { sourceVersion, allowConstructionDefaults }));
  if (party.some(character => character === null)) return null;
  if (!Array.isArray(input.inventory) || input.inventory.length > MAX_INVENTORY) return null;
  const inventory = input.inventory.map(normalizeItem);
  if (inventory.some(item => item === null)) return null;
  if (!Number.isFinite(input.corruption ?? 0) || input.corruption < 0 || input.corruption > 1_000_000 || !finiteInteger(input.credits ?? 0, 0, 1_000_000_000) || !finiteInteger(input.scrapCounter ?? 0, 0, 1_000_000_000)) return null;
  const themesSeenRaw = input.themesSeen instanceof Set ? [...input.themesSeen] : (Array.isArray(input.themesSeen) ? input.themesSeen : []);
  if (themesSeenRaw.length > 12 || !themesSeenRaw.every(theme => typeof theme === 'string' && theme.length <= 64)) return null;
  if (!Array.isArray(input.echoQueue ?? []) || input.echoQueue.length > MAX_ECHOES) return null;
  const echoQueue = (input.echoQueue ?? []).map(echo => normalizeEcho(echo, sourceVersion));
  if (echoQueue.some(echo => echo === null)) return null;
  const rngState = normalizeRngState(input.rngState);
  if (input.rngState !== null && input.rngState !== undefined && !rngState) return null;
  const flags = input.flags ?? {};
  if (!isPlainObject(flags) || !Array.isArray(flags.calibrationFloorsReached ?? []) || flags.calibrationFloorsReached.length > 16 || !(flags.calibrationFloorsReached ?? []).every(floor => finiteInteger(floor, 1, MAX_DEPTH))) return null;
  const appliedCorruptItemIds = input.appliedCorruptItemIds ?? [];
  if (!Array.isArray(appliedCorruptItemIds) || appliedCorruptItemIds.length > MAX_CORRUPT_IMPLANTS || !appliedCorruptItemIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 96) || new Set(appliedCorruptItemIds).size !== appliedCorruptItemIds.length) return null;
  const affixFloorLedger = input.affixFloorLedger ?? { floor: input.depth, reroll: [], floorEntry: [] };
  if (!isPlainObject(affixFloorLedger) || affixFloorLedger.floor !== input.depth || !['reroll', 'floorEntry'].every(key => Array.isArray(affixFloorLedger[key]) && affixFloorLedger[key].length <= MAX_AFFIX_LEDGER_IDS && affixFloorLedger[key].every(id => typeof id === 'string' && id.length > 0 && id.length <= 96) && new Set(affixFloorLedger[key]).size === affixFloorLedger[key].length)) return null;
  const activeCombat = input.activeCombat == null ? null : cloneBounded(input.activeCombat, MAX_COMBAT_BYTES);
  if (input.activeCombat != null && activeCombat === undefined) return null;
  const stats = input.stats ?? {};
  const summary = {};
  for (const key of ['enemiesSlain', 'echoesSlain', 'corruptItemsEquipped', 'floorsDescended']) {
    if (!finiteInteger(stats[key] ?? 0, 0, 1_000_000_000)) return null;
    summary[key] = stats[key] ?? 0;
  }
  const recentEvents = normalizePersistedEvents(input.recentEvents);
  if (!recentEvents) return null;
  const known = new Set([
    'worldSeed', 'creationTimestamp', 'depth', 'floorSubSeed', 'partyPosition', 'fogOfWar', 'openedContainers', 'defeatedEnemies',
    'dangerClockProgress', 'party', 'inventory', 'corruption', 'credits', 'scrapCounter', 'themesSeen', 'echoQueue', 'rngState',
    'flags', 'activeCombat', 'stats', 'recentEvents', 'extensions', 'appliedCorruptItemIds', 'affixFloorLedger'
  ]);
  const extensions = cloneExtensions(input.extensions);
  for (const [key, value] of Object.entries(input)) {
    if (!known.has(key) && cloneBounded(value, MAX_EXTENSION_BYTES) !== undefined) extensions[key] = cloneBounded(value, MAX_EXTENSION_BYTES);
  }
  return {
    worldSeed: input.worldSeed,
    creationTimestamp: input.creationTimestamp,
    depth: input.depth,
    floorSubSeed: input.floorSubSeed,
    partyPosition: { ...partyPositionInput },
    fogOfWar,
    openedContainers,
    defeatedEnemies,
    dangerClockProgress: input.dangerClockProgress ?? 0,
    party,
    inventory,
    corruption: input.corruption ?? 0,
    credits: input.credits ?? 0,
    scrapCounter: input.scrapCounter ?? 0,
    themesSeen: new Set(input.themesSeen ?? []),
    echoQueue,
    rngState,
    flags: { version: 2, calibrationFloorsReached: [...(flags.calibrationFloorsReached ?? [])] },
    appliedCorruptItemIds: [...appliedCorruptItemIds],
    affixFloorLedger: { floor: affixFloorLedger.floor, reroll: [...affixFloorLedger.reroll], floorEntry: [...affixFloorLedger.floorEntry] },
    activeCombat,
    stats: summary,
    recentEvents,
    extensions
  };
}

export function createRunState(worldSeed, party, options = {}) {
  const candidate = {
    worldSeed,
    creationTimestamp: options.creationTimestamp ?? Date.now(),
    depth: options.depth ?? 1,
    floorSubSeed: options.floorSubSeed ?? 0,
    partyPosition: options.partyPosition ?? { x: 10, y: 0 },
    fogOfWar: options.fogOfWar ?? new Uint8Array(FOG_BYTES),
    openedContainers: options.openedContainers ?? 0n,
    defeatedEnemies: options.defeatedEnemies ?? 0n,
    dangerClockProgress: options.dangerClockProgress ?? 0,
    party,
    inventory: options.inventory ?? [],
    corruption: options.corruption ?? 0,
    credits: options.credits ?? 0,
    scrapCounter: options.scrapCounter ?? 0,
    themesSeen: new Set(options.themesSeen ?? []),
    echoQueue: options.echoQueue ?? [],
    rngState: options.rngState ?? null,
    flags: options.flags ?? { version: 2, calibrationFloorsReached: [] },
    appliedCorruptItemIds: options.appliedCorruptItemIds ?? [],
    affixFloorLedger: options.affixFloorLedger ?? { floor: options.depth ?? 1, reroll: [], floorEntry: [] },
    activeCombat: options.activeCombat ?? null,
    stats: options.stats ?? { enemiesSlain: 0, echoesSlain: 0, corruptItemsEquipped: 0, floorsDescended: 0 },
    recentEvents: options.recentEvents ?? [],
    extensions: options.extensions ?? {}
  };
  const normalized = normalizeRunState(candidate, { sourceVersion: 2, allowConstructionDefaults: true });
  return normalized ? buildRunState(normalized) : null;
}

export function deserializeRunState(input, { sourceVersion = 2 } = {}) {
  const version = sourceVersion === 2 && input?.flags?.version === 1 ? 1 : sourceVersion;
  const normalized = normalizeRunState(input, { sourceVersion: version });
  return normalized ? buildRunState(normalized) : null;
}
