import { createBitReader, createBitWriter } from './bit-codec.js';
import { getTableVersion, readSymbol, writeSymbol } from './condense.js';
import { deserializeRunState, validateRunState } from './run-state.js';
import { INVENTORY_CAP } from '../rules/inventory.js';
import { readCharacter, readCombatSnapshot, readEcho, readItem, writeCharacter, writeCombatSnapshot, writeEcho, writeItem } from './save-codecs.js';

export const RUN_SCHEMA_VERSION = 7;

// v6 widens the on-wire fog to accommodate any grid size that fits in the
// fog-of-war budget (self-sizing framing: varUint length + bytes). 4096 bytes
// caps out at a 32,768-cell world — headroom well beyond the 40×64 (320-byte)
// target that follows in the density session. Any encoded fog whose length
// disagrees with the runtime's `FOG_BYTES` (post-load) is reset by
// `normalizeFog`; the payload still loads.
const FOG_BYTES_MAX = 4096;

export const RUN_SCHEMA_FIELDS = Object.freeze([
  'schemaVersion', 'tableVersion', 'worldSeed', 'creationTimestamp', 'depth', 'floorSubSeed',
  'partyPosition', 'fogOfWar', 'openedContainers', 'defeatedEnemies', 'dangerClockProgress',
  'party', 'inventory', 'corruption', 'credits', 'scrapCounter', 'themesSeen', 'echoQueue',
  'rngState', 'calibrationFloorsReached', 'appliedCorruptItemIds', 'affixFloorLedger', 'stats', 'recentEvents', 'extensions', 'activeCombat'
]);

const MAX_DEPTH = 255;
const MAX_PARTY = 4;
// v7 caps (saves-never-fail SESSION-01 CP3) — mirror the run-state constants
// and defer to INVENTORY_CAP (M25) as the program-wide single source.
const MAX_INVENTORY = INVENTORY_CAP;
const MAX_ECHOES = 2;
const MAX_THEMES = 12;
const MAX_EVENTS = 24;
const MAX_CORRUPT_IMPLANTS = 32;
const MAX_AFFIX_LEDGER_IDS = 12;
const MAX_VALUE_DEPTH = 8;
const MAX_VALUE_ENTRIES = 2048;
const MAX_VALUE_BYTES = 2048;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function fail(code) {
  const error = new RangeError(code);
  error.code = code;
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value, minimum, maximum, code = 'invalid_run_state') {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

function writeString(writer, value, maximum = MAX_VALUE_BYTES) {
  if (typeof value !== 'string') fail('invalid_string');
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > maximum) fail('invalid_string');
  writer.writeVarUint(bytes.length);
  writer.writeBytes(bytes);
}

function readString(reader, maximum = MAX_VALUE_BYTES) {
  const length = integer(reader.readVarUint(), 0, maximum, 'invalid_length');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(reader.readBytes(length));
  } catch (error) {
    if (error?.code) throw error;
    fail('invalid_string');
  }
}

function writeNumber(writer, value) {
  if (!Number.isFinite(value)) fail('invalid_number');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  writer.writeBytes(bytes);
}

function readNumber(reader) {
  const bytes = reader.readBytes(8);
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
  if (!Number.isFinite(value)) fail('invalid_number');
  return value;
}

function writeValue(writer, value, depth = 0) {
  if (depth > MAX_VALUE_DEPTH) fail('value_depth');
  if (value === null) return writer.writeUint(0, 3);
  if (typeof value === 'boolean') return writer.writeUint(value ? 2 : 1, 3);
  if (typeof value === 'number') {
    writer.writeUint(3, 3);
    return writeNumber(writer, value);
  }
  if (typeof value === 'string') {
    writer.writeUint(4, 3);
    return writeString(writer, value);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_VALUE_ENTRIES) fail('invalid_value_array');
    writer.writeUint(5, 3);
    writer.writeVarUint(value.length);
    for (const entry of value) writeValue(writer, entry, depth + 1);
    return;
  }
  if (!isObject(value)) fail('invalid_value');
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > MAX_VALUE_ENTRIES) fail('invalid_value_object');
  writer.writeUint(6, 3);
  writer.writeVarUint(entries.length);
  for (const [key, entry] of entries) {
    writeString(writer, key);
    writeValue(writer, entry, depth + 1);
  }
}

// A prior CP2 draft added a dedicated persisted-event codec (1-bit hasSequence
// + 1-bit type-known + 4-bit index + bounded strings). It shrank the RAW
// payload but got PARSED WORSE by the progressive compression stack: the
// generic writeValue form repeats 'type'/'message'/'sequence' key strings on
// every event, and those repetitions compress almost to zero — the compact
// form leaves nothing for the reducer to exploit. Net effect: reduces
// raw-bytes but INCREASES fragment length by ~15–30 chars per 8-event tail.
// Reverted. The verbose writeValue form is deliberately kept for recentEvents.
// (The EVENT_TYPE_IDS export in save-codecs.js is unused by this file today,
// but stays exported for a future context-aware compression pass if/when the
// compression stack learns not to penalize enums.)

function readValue(reader, depth = 0) {
  if (depth > MAX_VALUE_DEPTH) fail('value_depth');
  switch (reader.readUint(3)) {
    case 0: return null;
    case 1: return false;
    case 2: return true;
    case 3: return readNumber(reader);
    case 4: return readString(reader);
    case 5: {
      const length = integer(reader.readVarUint(), 0, MAX_VALUE_ENTRIES, 'invalid_value_array');
      return Array.from({ length }, () => readValue(reader, depth + 1));
    }
    case 6: {
      const length = integer(reader.readVarUint(), 0, MAX_VALUE_ENTRIES, 'invalid_value_object');
      const value = {};
      for (let index = 0; index < length; index++) {
        const key = readString(reader);
        if (Object.hasOwn(value, key)) fail('duplicate_value_key');
        value[key] = readValue(reader, depth + 1);
      }
      return value;
    }
    default: fail('invalid_value_tag');
  }
}

function writeBitfield(writer, value) {
  let bitfield;
  try {
    bitfield = BigInt(value);
  } catch {
    fail('invalid_bitfield');
  }
  if (bitfield < 0n || bitfield > (1n << 64n) - 1n) fail('invalid_bitfield');
  writer.writeUint(Number(bitfield & 0xffffffffn), 32);
  writer.writeUint(Number(bitfield >> 32n), 32);
}

function readBitfield(reader) {
  const low = reader.readUint(32);
  const high = reader.readUint(32);
  return ((BigInt(high) << 32n) | BigInt(low)).toString();
}

function writeRngState(writer, rngState) {
  writer.writeBool(rngState !== null);
  if (rngState === null) return;
  for (const stream of ['gen', 'combat']) {
    const state = rngState[stream];
    integer(state.cursor, 0, MAX_SAFE, 'invalid_rng_state');
    writer.writeVarUint(state.cursor);
    for (const part of ['a', 'b', 'c', 'd']) writer.writeUint(integer(state.prngState[part], 0, 0xffffffff, 'invalid_rng_state'), 32);
  }
}

function readRngState(reader) {
  if (!reader.readBool()) return null;
  return Object.fromEntries(['gen', 'combat'].map((stream) => [stream, {
    cursor: reader.readVarUint(),
    prngState: Object.fromEntries(['a', 'b', 'c', 'd'].map((part) => [part, reader.readUint(32)]))
  }]));
}

function itemIds(character, ids) {
  for (const item of Object.values(character.equipment ?? {})) {
    if (item === null || item === undefined) continue;
    if (ids.has(item.id)) fail('duplicate_item');
    ids.add(item.id);
  }
}

function assertUniqueIds(state) {
  const characterIds = new Set();
  const itemIdsSeen = new Set();
  const checkPartyCharacter = (character) => {
    if (characterIds.has(character.id)) fail('duplicate_character');
    characterIds.add(character.id);
    itemIds(character, itemIdsSeen);
  };
  for (const character of state.party) checkPartyCharacter(character);
  for (const item of state.inventory) {
    if (itemIdsSeen.has(item.id)) fail('duplicate_item');
    itemIdsSeen.add(item.id);
  }
}

function assertZeroPadding(reader) {
  while (reader.remainingBits > 0) {
    if (reader.readBool()) fail('trailing_data');
  }
}

// v7 loot-id pattern codec for top-level id lists (appliedCorruptItemIds,
// affixFloorLedger.reroll/floorEntry). Mirrors src/state/save-codecs.js
// writeItemId — the two exist independently so this file stays free of
// non-schema imports and the item writer isn't reachable from top-level id
// arrays. Newly-generated loot ids match `l<base36 up to 6>-<0..7>` and
// encode as 1 bit flag + varUint(hash) + 3 bits suffix; legacy long ids
// (v6-and-earlier's `loot-<hash>-<n>`) fall through the escape path.
const TOP_LOOT_ID_PATTERN = /^l([0-9a-z]{1,6})-([0-7])$/;
function writeCompactId(writer, id) {
  if (typeof id !== 'string') fail('invalid_string');
  const match = id.length <= 9 ? TOP_LOOT_ID_PATTERN.exec(id) : null;
  if (match) {
    const hashValue = Number.parseInt(match[1], 36);
    if (Number.isSafeInteger(hashValue) && hashValue >= 0 && hashValue <= 0x7fffffff) {
      writer.writeBool(true);
      writer.writeVarUint(hashValue);
      writer.writeUint(Number(match[2]), 3);
      return;
    }
  }
  writer.writeBool(false);
  writeString(writer, id, 96);
}
function readCompactId(reader) {
  if (reader.readBool()) {
    const hashValue = reader.readVarUint();
    const suffix = reader.readUint(3);
    return `l${hashValue.toString(36)}-${suffix}`;
  }
  return readString(reader, 96);
}

function canonicalInput(runState) {
  const serialized = typeof runState?.serialize === 'function' ? runState.serialize() : runState;
  if (!validateRunState(serialized).valid) fail('invalid_run_state');
  const canonical = deserializeRunState(serialized);
  if (!canonical) fail('invalid_run_state');
  const state = canonical.serialize();
  assertUniqueIds(state);
  return state;
}

export function encodeRunPayload(runState) {
  const state = canonicalInput(runState);
  const tableVersion = getTableVersion();
  integer(tableVersion, 1, 0xffff, 'invalid_table_version');
  const writer = createBitWriter();

  writer.writeUint(RUN_SCHEMA_VERSION, 8);
  writer.writeUint(tableVersion, 16);
  writer.writeUint(state.worldSeed, 32);
  writer.writeVarUint(state.creationTimestamp);
  writer.writeUint(state.depth, 8);
  writer.writeUint(state.floorSubSeed, 32);
  writer.writeUint(state.partyPosition.x, 7);
  writer.writeUint(state.partyPosition.y, 7);
  const fogBytes = Uint8Array.from(state.fogOfWar);
  if (fogBytes.length > FOG_BYTES_MAX) fail('invalid_fog');
  writer.writeVarUint(fogBytes.length);
  writer.writeBytes(fogBytes);
  writeBitfield(writer, state.openedContainers);
  writeBitfield(writer, state.defeatedEnemies);
  writeNumber(writer, state.dangerClockProgress);

  writer.writeUint(state.party.length, 3);
  for (const character of state.party) writeCharacter(writer, character);
  writer.writeUint(state.inventory.length, 7);
  for (const item of state.inventory) writeItem(writer, item);

  writeNumber(writer, state.corruption);
  writer.writeVarUint(state.credits);
  writer.writeVarUint(state.scrapCounter);
  writer.writeUint(state.themesSeen.length, 4);
  for (const themeId of state.themesSeen) writeSymbol(writer, 'theme_id', themeId, (value) => writeString(writer, value, 64));

  writer.writeUint(state.echoQueue.length, 2);
  for (const echo of state.echoQueue) writeEcho(writer, echo);
  writeRngState(writer, state.rngState);
  writer.writeUint(state.flags.calibrationFloorsReached.length, 5);
  for (const floor of state.flags.calibrationFloorsReached) writer.writeUint(floor, 8);
  const appliedCorruptItemIds = state.appliedCorruptItemIds ?? [];
  const affixFloorLedger = state.affixFloorLedger ?? { floor: state.depth, reroll: [], floorEntry: [] };
  writer.writeUint(appliedCorruptItemIds.length, 7);
  for (const itemId of appliedCorruptItemIds) writeCompactId(writer, itemId);
  writer.writeUint(affixFloorLedger.floor, 8);
  for (const key of ['reroll', 'floorEntry']) {
    writer.writeUint(affixFloorLedger[key].length, 4);
    for (const itemId of affixFloorLedger[key]) writeCompactId(writer, itemId);
  }
  for (const key of ['enemiesSlain', 'echoesSlain', 'corruptItemsEquipped', 'floorsDescended']) writer.writeVarUint(state.stats?.[key] ?? 0);
  writer.writeUint(state.recentEvents?.length ?? 0, 7);
  for (const event of state.recentEvents ?? []) writeValue(writer, event);
  const hasExtensions = Boolean(state.extensions && Object.entries(state.extensions).length);
  writer.writeBool(hasExtensions);
  if (hasExtensions) writeValue(writer, state.extensions);
  writer.writeBool(state.activeCombat !== undefined);
  if (state.activeCombat !== undefined) writeCombatSnapshot(writer, state.activeCombat, { depth: state.depth });

  return { bytes: writer.toUint8Array(), bitLength: writer.bitLength, tableVersion, worldSeed: state.worldSeed };
}

export function decodeRunPayload(bytes, bitLength, options = {}) {
  try {
    const reader = createBitReader(bytes, bitLength);
    const schemaVersion = reader.readUint(8);
    const tableVersion = reader.readUint(16);
    const worldSeed = reader.readUint(32);
    if (schemaVersion !== RUN_SCHEMA_VERSION || tableVersion !== (options.tableVersion ?? getTableVersion())) fail('version_mismatch');
    const state = {
      worldSeed,
      creationTimestamp: reader.readVarUint(),
      depth: integer(reader.readUint(8), 1, MAX_DEPTH),
      floorSubSeed: reader.readUint(32),
      partyPosition: { x: reader.readUint(7), y: reader.readUint(7) },
      fogOfWar: Array.from(reader.readBytes(integer(reader.readVarUint(), 0, FOG_BYTES_MAX, 'invalid_fog'))),
      openedContainers: readBitfield(reader),
      defeatedEnemies: readBitfield(reader),
      dangerClockProgress: readNumber(reader)
    };
    const partyLength = integer(reader.readUint(3), 1, MAX_PARTY, 'invalid_party');
    state.party = Array.from({ length: partyLength }, () => readCharacter(reader));
    const inventoryLength = integer(reader.readUint(7), 0, MAX_INVENTORY, 'invalid_inventory');
    state.inventory = Array.from({ length: inventoryLength }, () => readItem(reader));
    state.corruption = readNumber(reader);
    state.credits = integer(reader.readVarUint(), 0, 1_000_000_000, 'invalid_resources');
    state.scrapCounter = integer(reader.readVarUint(), 0, 1_000_000_000, 'invalid_resources');
    const themeLength = integer(reader.readUint(4), 0, MAX_THEMES, 'invalid_themes');
    state.themesSeen = Array.from({ length: themeLength }, () => readSymbol(reader, 'theme_id', () => readString(reader, 64)));
    if (new Set(state.themesSeen).size !== state.themesSeen.length) fail('duplicate_theme');
    const echoLength = integer(reader.readUint(2), 0, MAX_ECHOES, 'invalid_echoes');
    state.echoQueue = Array.from({ length: echoLength }, () => readEcho(reader));
    state.rngState = readRngState(reader);
    const calibrationLength = integer(reader.readUint(5), 0, 16, 'invalid_flags');
    state.flags = { version: RUN_SCHEMA_VERSION, calibrationFloorsReached: Array.from({ length: calibrationLength }, () => integer(reader.readUint(8), 1, MAX_DEPTH, 'invalid_flags')) };
    const implantLength = integer(reader.readUint(7), 0, MAX_CORRUPT_IMPLANTS, 'invalid_corrupt_implants');
    state.appliedCorruptItemIds = Array.from({ length: implantLength }, () => readCompactId(reader));
    if (new Set(state.appliedCorruptItemIds).size !== state.appliedCorruptItemIds.length) fail('duplicate_corrupt_implant');
    state.affixFloorLedger = { floor: integer(reader.readUint(8), 1, MAX_DEPTH, 'invalid_affix_ledger'), reroll: [], floorEntry: [] };
    for (const key of ['reroll', 'floorEntry']) {
      const length = integer(reader.readUint(4), 0, MAX_AFFIX_LEDGER_IDS, 'invalid_affix_ledger');
      state.affixFloorLedger[key] = Array.from({ length }, () => readCompactId(reader));
      if (new Set(state.affixFloorLedger[key]).size !== state.affixFloorLedger[key].length) fail('duplicate_affix_ledger');
    }
    state.stats = Object.fromEntries(['enemiesSlain', 'echoesSlain', 'corruptItemsEquipped', 'floorsDescended'].map((key) => [key, integer(reader.readVarUint(), 0, 1_000_000_000, 'invalid_stats')]));
    const eventLength = integer(reader.readUint(7), 0, MAX_EVENTS, 'invalid_events');
    state.recentEvents = Array.from({ length: eventLength }, () => readValue(reader));
    if (reader.readBool()) {
      state.extensions = readValue(reader);
      if (!isObject(state.extensions)) fail('invalid_extensions');
    }
    if (reader.readBool()) state.activeCombat = readCombatSnapshot(reader, { depth: state.depth });
    assertZeroPadding(reader);
    assertUniqueIds(state);
    const runState = deserializeRunState(state);
    if (!runState || !validateRunState(runState.serialize()).valid) fail('invalid_run_state');
    return { runState, tableVersion, worldSeed };
  } catch (error) {
    if (error?.code) throw error;
    fail('malformed');
  }
}
