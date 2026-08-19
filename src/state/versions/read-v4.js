// FROZEN — reads schema v4 forever; never edit.
// Self-contained payload reader for RUN_SCHEMA_VERSION = 4 saves.
// Byte-copy of decodeRunPayload from save-schema.js as it was pinned when
// v4 shipped. It intentionally does NOT import the live save-schema.js or
// save-codecs.js — those will fork to v5+ in later sessions, and this
// reader must remain byte-identical to what v4 saves were encoded against
// forever. See Custom Rule 13.

import { createBitReader } from '../bit-codec.js';
import { readSymbol } from '../condense.js';
import { deserializeRunState, validateRunState } from '../run-state.js';
import {
  V4_TABLE_VERSION,
  readCharacter,
  readCombatSnapshot,
  readEcho,
  readItem,
  readNumber,
  readString
} from './codecs-v4.js';

export const V4_SCHEMA_VERSION = 4;

const MAX_DEPTH = 255;
const MAX_PARTY = 4;
const MAX_INVENTORY = 100;
const MAX_ECHOES = 2;
const MAX_THEMES = 12;
const MAX_EVENTS = 64;
const MAX_CORRUPT_IMPLANTS = 118;
const MAX_AFFIX_LEDGER_IDS = 12;
const MAX_VALUE_DEPTH = 8;
const MAX_VALUE_ENTRIES = 2048;

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

function readTopString(reader, maximum) {
  const length = integer(reader.readVarUint(), 0, maximum, 'invalid_length');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(reader.readBytes(length));
  } catch (error) {
    if (error?.code) throw error;
    fail('invalid_string');
  }
}

function readTopValue(reader, depth = 0) {
  if (depth > MAX_VALUE_DEPTH) fail('value_depth');
  switch (reader.readUint(3)) {
    case 0: return null;
    case 1: return false;
    case 2: return true;
    case 3: return readNumber(reader);
    case 4: return readTopString(reader, 2048);
    case 5: {
      const length = integer(reader.readVarUint(), 0, MAX_VALUE_ENTRIES, 'invalid_value_array');
      return Array.from({ length }, () => readTopValue(reader, depth + 1));
    }
    case 6: {
      const length = integer(reader.readVarUint(), 0, MAX_VALUE_ENTRIES, 'invalid_value_object');
      const value = {};
      for (let index = 0; index < length; index++) {
        const key = readTopString(reader, 2048);
        if (Object.hasOwn(value, key)) fail('duplicate_value_key');
        value[key] = readTopValue(reader, depth + 1);
      }
      return value;
    }
    default: fail('invalid_value_tag');
  }
}

function readBitfield(reader) {
  const low = reader.readUint(32);
  const high = reader.readUint(32);
  return ((BigInt(high) << 32n) | BigInt(low)).toString();
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

// Reads a v4 payload. Assumes the frozen v4 symbol table (V4_TABLE_VERSION)
// is registered in the condenser registry — the caller (save-decode.js
// dispatch) guarantees this because v4 shares symbol-table version 1 with
// v3 and initCondenser registers version 1 at boot.
export function readV4Payload(bytes, bitLength) {
  try {
    const reader = createBitReader(bytes, bitLength);
    const schemaVersion = reader.readUint(8);
    const tableVersion = reader.readUint(16);
    const worldSeed = reader.readUint(32);
    if (schemaVersion !== V4_SCHEMA_VERSION || tableVersion !== V4_TABLE_VERSION) fail('version_mismatch');
    const state = {
      worldSeed,
      creationTimestamp: reader.readVarUint(),
      depth: integer(reader.readUint(8), 1, MAX_DEPTH),
      floorSubSeed: reader.readUint(32),
      partyPosition: { x: reader.readUint(5), y: reader.readUint(5) },
      fogOfWar: Array.from(reader.readBytes(80)),
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
    state.themesSeen = Array.from({ length: themeLength }, () => readSymbol(reader, 'theme_id', () => readString(reader, 64), V4_TABLE_VERSION));
    if (new Set(state.themesSeen).size !== state.themesSeen.length) fail('duplicate_theme');
    const echoLength = integer(reader.readUint(2), 0, MAX_ECHOES, 'invalid_echoes');
    state.echoQueue = Array.from({ length: echoLength }, () => readEcho(reader));
    state.rngState = readRngState(reader);
    const calibrationLength = integer(reader.readUint(5), 0, 16, 'invalid_flags');
    state.flags = { version: V4_SCHEMA_VERSION, calibrationFloorsReached: Array.from({ length: calibrationLength }, () => integer(reader.readUint(8), 1, MAX_DEPTH, 'invalid_flags')) };
    const implantLength = integer(reader.readUint(7), 0, MAX_CORRUPT_IMPLANTS, 'invalid_corrupt_implants');
    state.appliedCorruptItemIds = Array.from({ length: implantLength }, () => readTopString(reader, 96));
    if (new Set(state.appliedCorruptItemIds).size !== state.appliedCorruptItemIds.length) fail('duplicate_corrupt_implant');
    state.affixFloorLedger = { floor: integer(reader.readUint(8), 1, MAX_DEPTH, 'invalid_affix_ledger'), reroll: [], floorEntry: [] };
    for (const key of ['reroll', 'floorEntry']) {
      const length = integer(reader.readUint(4), 0, MAX_AFFIX_LEDGER_IDS, 'invalid_affix_ledger');
      state.affixFloorLedger[key] = Array.from({ length }, () => readTopString(reader, 96));
      if (new Set(state.affixFloorLedger[key]).size !== state.affixFloorLedger[key].length) fail('duplicate_affix_ledger');
    }
    state.stats = Object.fromEntries(['enemiesSlain', 'echoesSlain', 'corruptItemsEquipped', 'floorsDescended'].map((key) => [key, integer(reader.readVarUint(), 0, 1_000_000_000, 'invalid_stats')]));
    const eventLength = integer(reader.readUint(7), 0, MAX_EVENTS, 'invalid_events');
    state.recentEvents = Array.from({ length: eventLength }, () => readTopValue(reader));
    if (reader.readBool()) {
      state.extensions = readTopValue(reader);
      if (!isObject(state.extensions)) fail('invalid_extensions');
    }
    if (reader.readBool()) state.activeCombat = readCombatSnapshot(reader);
    assertZeroPadding(reader);
    assertUniqueIds(state);
    const runState = deserializeRunState(state);
    if (!runState || !validateRunState(runState.serialize()).valid) fail('invalid_run_state');
    return { runState, tableVersion, worldSeed, schemaVersion };
  } catch (error) {
    if (error?.code) throw error;
    fail('malformed');
  }
}
