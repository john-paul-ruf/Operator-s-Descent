// FROZEN — reads schema v3 forever; never edit.
// Self-contained byte-copy of the read functions that decodeRunPayload
// depended on when RUN_SCHEMA_VERSION was 3. This file must NOT import
// the live save-codecs.js or save-schema.js — they will fork to v4+ in
// later sessions, and this reader must remain byte-identical to what
// v3 saves were encoded against forever.
//
// The one seam we keep to condense.js is readSymbol(reader, field, raw,
// version) — the v3 reader always passes the frozen table version (V3_TABLE_VERSION)
// so it selects the v3-snapshot table regardless of what the current table is.

import { readSymbol } from '../condense.js';

export const V3_TABLE_VERSION = 1;

const ATTRIBUTES = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
const CATEGORIES = ['weapon', 'armor', 'consumable'];
const RARITIES = ['stock', 'tuned', 'custom', 'prototype', 'corrupt'];
const SIDES = ['party', 'enemy', 'echo'];
const ENEMY_ID_TYPES = ['drone', 'stalker', 'choir', 'null', 'construct', 'apex', 'echo'];
const ENCOUNTER_TYPES = ['standard', 'hunt'];
const MAX_ID = 96;
const MAX_CONDITIONS = 9;
const MAX_AFFIXES = 8;
const MAX_DECK = 20;
const MAX_CALIBRATIONS = 16;
const MAX_ACTORS = 24;
const MAX_PENDING_EFFECTS = 32;
const MAX_VALUE_DEPTH = 8;
const MAX_VALUE_ENTRIES = 32;

function fail(code) {
  const error = new RangeError(code);
  error.code = code;
  throw error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireInteger(value, minimum, maximum, code = 'invalid_value') {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

export function readString(reader, maximum = MAX_ID) {
  return new TextDecoder('utf-8', { fatal: true }).decode(reader.readBytes(requireInteger(reader.readVarUint(), 0, maximum, 'invalid_length')));
}

function readEntityId(reader) {
  switch (reader.readUint(2)) {
    case 0: return readString(reader);
    case 1: return `operator_${reader.readUint(2) + 1}`;
    case 2: {
      const depth = reader.readUint(8);
      const enemyType = ENEMY_ID_TYPES[reader.readUint(3)];
      const cursor = reader.readVarUint();
      if (!enemyType) fail('invalid_string');
      return `enemy_${depth}_${enemyType}_${cursor}`;
    }
    default: fail('invalid_string');
  }
}

function readEncounterId(reader) {
  if (!reader.readBool()) return readString(reader);
  return `encounter_${reader.readUint(5)}_${reader.readUint(5)}_${reader.readVarUint()}`;
}

function readEncounterType(reader) {
  if (!reader.readBool()) return readString(reader, 64);
  return ENCOUNTER_TYPES[reader.readUint(1)];
}

export function readNumber(reader) {
  const bytes = reader.readBytes(8);
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
  if (!Number.isFinite(value)) fail('invalid_number');
  return value;
}

function readValue(reader, depth = 0) {
  if (depth > MAX_VALUE_DEPTH) fail('value_depth');
  switch (reader.readUint(3)) {
    case 0: return null;
    case 1: return false;
    case 2: return true;
    case 3: return readNumber(reader);
    case 4: return readString(reader, 2048);
    case 5: {
      const length = requireInteger(reader.readVarUint(), 0, MAX_VALUE_ENTRIES, 'invalid_value_array');
      return Array.from({ length }, () => readValue(reader, depth + 1));
    }
    case 6: {
      const length = requireInteger(reader.readVarUint(), 0, MAX_VALUE_ENTRIES, 'invalid_value_object');
      const value = {};
      for (let index = 0; index < length; index++) {
        const key = readString(reader, MAX_ID);
        if (Object.hasOwn(value, key)) fail('duplicate_value_key');
        value[key] = readValue(reader, depth + 1);
      }
      return value;
    }
    default: fail('invalid_value_tag');
  }
}

function readField(reader, field, raw) {
  return readSymbol(reader, field, raw, V3_TABLE_VERSION);
}

function readConditions(reader) {
  const length = reader.readUint(4);
  if (length > MAX_CONDITIONS) fail('invalid_conditions');
  const ids = new Set();
  const conditions = [];
  for (let index = 0; index < length; index++) {
    const conditionId = readString(reader, 64);
    if (ids.has(conditionId)) fail('duplicate_condition');
    ids.add(conditionId);
    const duration = requireInteger(reader.readVarUint(), 0, 255, 'invalid_conditions');
    const stacks = reader.readBool() ? requireInteger(reader.readVarUint(), 1, 255, 'invalid_conditions') : undefined;
    conditions.push({ conditionId, duration, ...(stacks === undefined ? {} : { stacks }) });
  }
  return conditions;
}

export function readItem(reader) {
  const id = readString(reader);
  const category = CATEGORIES[reader.readUint(2)];
  if (!category) fail('invalid_item');
  const baseType = readField(reader, 'item_id', () => readString(reader));
  const rarity = RARITIES[reader.readUint(3)];
  if (!rarity) fail('invalid_item');
  const affixLength = reader.readUint(4);
  if (affixLength > MAX_AFFIXES) fail('invalid_item');
  const affixes = Array.from({ length: affixLength }, () => readField(reader, 'affix_id', () => readString(reader, 64)));
  if (new Set(affixes).size !== affixes.length) fail('duplicate_affix');
  const corrupt = reader.readBool();
  const corruptionValue = reader.readBool() ? readNumber(reader) : undefined;
  if (corruptionValue !== undefined && (corruptionValue < 0 || corruptionValue > 1_000_000)) fail('invalid_item');
  const salvageValue = readNumber(reader);
  if (salvageValue < 0 || salvageValue > 1_000_000) fail('invalid_item');
  const junkTagged = reader.readBool();
  const count = reader.readBool() ? requireInteger(reader.readVarUint(), 1, 100, 'invalid_item') : undefined;
  const stats = readValue(reader);
  if (!isObject(stats)) fail('invalid_item');
  const extensions = reader.readBool() ? readValue(reader) : undefined;
  if (extensions !== undefined && !isObject(extensions)) fail('invalid_item');
  return { id, category, baseType, rarity, affixes, corrupt, ...(corruptionValue === undefined ? {} : { corruptionValue }), stats, salvageValue, junkTagged, ...(count === undefined ? {} : { count }), ...(extensions === undefined ? {} : { extensions }) };
}

export function readCharacter(reader) {
  const id = readEntityId(reader);
  const classId = readField(reader, 'class', () => readString(reader, 64));
  const sigilId = readField(reader, 'sigil_id', () => readString(reader, 64));
  const attributes = Object.fromEntries(ATTRIBUTES.map((attribute) => [attribute, requireInteger(readField(reader, 'attribute', () => reader.readVarUint()), 1, 255, 'invalid_character')]));
  const currentHP = requireInteger(readField(reader, 'hp', () => reader.readVarUint()), 0, 255, 'invalid_character');
  const currentCHARGE = requireInteger(readField(reader, 'charge', () => reader.readVarUint()), 0, 255, 'invalid_character');
  const calibrationCount = requireInteger(readField(reader, 'calibration_count', () => reader.readVarUint()), 0, 16, 'invalid_character');
  const calibrationLength = reader.readUint(5);
  if (calibrationLength > MAX_CALIBRATIONS) fail('invalid_character');
  const calibrationChoices = Array.from({ length: calibrationLength }, () => ({ floor: requireInteger(reader.readVarUint(), 1, 255, 'invalid_character'), optionId: readString(reader) }));
  const signatureTier = requireInteger(readField(reader, 'signature_tier', () => reader.readVarUint()), 1, 3, 'invalid_character');
  const equipment = Object.fromEntries(['weapon', 'armor', 'offhand'].map((slot) => [slot, reader.readBool() ? readItem(reader) : null]));
  const deckLength = reader.readUint(5);
  if (deckLength > MAX_DECK) fail('invalid_character');
  const protocolDeck = Array.from({ length: deckLength }, () => {
    const protocol = readField(reader, 'protocol_ref', () => [readString(reader, 32), reader.readUint(3)]);
    if (!Array.isArray(protocol) || protocol.length !== 2 || typeof protocol[0] !== 'string' || !Number.isInteger(protocol[1]) || protocol[1] < 1 || protocol[1] > 5) fail('invalid_character');
    return { school: protocol[0], tier: protocol[1] };
  });
  const conditions = readConditions(reader);
  const extensions = reader.readBool() ? readValue(reader) : undefined;
  if (extensions !== undefined && !isObject(extensions)) fail('invalid_character');
  return { id, classId, sigilId, attributes, currentHP, currentCHARGE, calibrationCount, calibrationChoices, signatureTier, equipment, protocolDeck, conditions, ...(extensions === undefined ? {} : { extensions }) };
}

export function readEcho(reader) {
  const character = readCharacter(reader);
  const deathFloor = requireInteger(reader.readVarUint(), 1, 255, 'invalid_echo');
  const appearanceFloor = requireInteger(reader.readVarUint(), deathFloor + 2, deathFloor + 4, 'invalid_echo');
  return { character, deathFloor, appearanceFloor };
}

const ENEMY_STAT_ATTRIBUTES = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
const ENEMY_STAT_BEHAVIORS = ['aggressive', 'defensive', 'flanking', 'artillery', 'controller', 'phasing', 'multi-action', 'echo'];
const ENEMY_STAT_ARCHETYPES = ['drone', 'warden', 'stalker', 'choir', 'null', 'construct', 'phantom', 'apex', 'echo'];
const ENEMY_STAT_SIGIL_POOLS = {
  drone: [57392, 57393, 57394],
  warden: [57395, 57396, 57397],
  stalker: [57398, 57399, 57400],
  choir: [57401, 57402, 57403],
  null: [57404, 57405, 57406],
  construct: [57407, 57408, 57409],
  phantom: [57410, 57411, 57412],
  apex: [57413, 57414, 57415]
};
const MAX_ARCHETYPE_ID = 32;
const MAX_BEHAVIOR_STRING = 64;
const MAX_ENEMY_STAT_VALUE = 65_535;
const MAX_ENEMY_HP_MAX = 1_000_000;
const MAX_ENEMY_ATTRIBUTE = 31;
const MAX_SIGIL_CODEPOINT = 0x10ffff;

function readEnemyBehavior(reader) {
  if (reader.readBool()) {
    const index = reader.readUint(3);
    const behavior = ENEMY_STAT_BEHAVIORS[index];
    if (!behavior) fail('invalid_actor');
    return behavior;
  }
  return readString(reader, MAX_BEHAVIOR_STRING);
}

function readEnemyArchetypeId(reader) {
  if (reader.readBool()) {
    const index = reader.readUint(4);
    const archetype = ENEMY_STAT_ARCHETYPES[index];
    if (!archetype) fail('invalid_actor');
    return archetype;
  }
  return readString(reader, MAX_ARCHETYPE_ID);
}

function readEnemyStatsTemplate(reader) {
  const archetypeId = readEnemyArchetypeId(reader);
  const attributes = Object.fromEntries(ENEMY_STAT_ATTRIBUTES.map((key) => [key, requireInteger(reader.readUint(5), 1, MAX_ENEMY_ATTRIBUTE, 'invalid_actor')]));
  const defense = requireInteger(reader.readVarUint(), 0, MAX_ENEMY_STAT_VALUE, 'invalid_actor');
  const protocolDefense = requireInteger(reader.readVarUint(), 0, MAX_ENEMY_STAT_VALUE, 'invalid_actor');
  const behavior = readEnemyBehavior(reader);
  const retreats = reader.readBool();
  const protocolAccess = reader.readBool() ? readValue(reader) : null;
  return { archetypeId, attributes, defense, protocolDefense, behavior, retreats, protocolAccess };
}

function readEnemyStats(reader, previous) {
  reader.alignToByte();
  if (!reader.readBool()) return { stats: undefined, previous };
  const canDedup = reader.readBool();
  if (canDedup && !previous) fail('invalid_actor');
  const template = canDedup ? previous : readEnemyStatsTemplate(reader);
  const hpMax = requireInteger(reader.readVarUint(), 0, MAX_ENEMY_HP_MAX, 'invalid_actor');
  const chargeMax = reader.readBool() ? requireInteger(reader.readVarUint(), 0, MAX_ENEMY_HP_MAX, 'invalid_actor') : 0;
  let sigilCodepoint;
  if (reader.readBool()) {
    const variant = reader.readUint(2);
    const pool = ENEMY_STAT_SIGIL_POOLS[template.archetypeId];
    if (!pool || variant >= pool.length) fail('invalid_actor');
    sigilCodepoint = pool[variant];
  } else {
    sigilCodepoint = requireInteger(reader.readUint(21), 0, MAX_SIGIL_CODEPOINT, 'invalid_actor');
  }
  const stats = { ...template, hpMax, chargeMax, sigilCodepoint };
  return { stats, previous: stats };
}

function readActor(reader) {
  const id = readEntityId(reader);
  const side = SIDES[reader.readUint(2)];
  if (!side) fail('invalid_actor');
  return {
    id,
    side,
    x: reader.readUint(5),
    y: reader.readUint(5),
    hp: requireInteger(reader.readVarUint(), 0, 255, 'invalid_actor'),
    charge: requireInteger(reader.readVarUint(), 0, 255, 'invalid_actor'),
    conditions: readConditions(reader),
    initiative: requireInteger(reader.readVarInt(), -255, 255, 'invalid_actor'),
    ap: reader.readUint(3),
    moves: reader.readUint(3),
    freeActions: reader.readUint(3),
    defeated: reader.readBool(),
    retreated: reader.readBool()
  };
}

export function readCombatSnapshot(reader) {
  const arena = { originX: reader.readUint(5), originY: reader.readUint(5), contactId: readEncounterId(reader) };
  const actorLength = reader.readUint(5);
  if (actorLength < 1 || actorLength > MAX_ACTORS) fail('invalid_combat');
  const actors = Array.from({ length: actorLength }, () => readActor(reader));
  const actorIds = new Set(actors.map((actor) => actor.id));
  if (actorIds.size !== actors.length) fail('duplicate_actor');
  reader.alignToByte();
  let previousStats = null;
  for (const actor of actors) {
    if (actor.side === 'party') continue;
    const { stats, previous } = readEnemyStats(reader, previousStats);
    if (stats !== undefined) actor.stats = stats;
    previousStats = previous;
  }
  const initiativeOrder = Array.from({ length: actorLength }, () => readEntityId(reader));
  if (new Set(initiativeOrder).size !== actorLength || initiativeOrder.some((id) => !actorIds.has(id))) fail('invalid_combat');
  const currentIndex = requireInteger(reader.readUint(5), 0, actorLength - 1, 'invalid_combat');
  const round = requireInteger(reader.readVarUint(), 1, 255, 'invalid_combat');
  const pendingLength = reader.readUint(6);
  if (pendingLength > MAX_PENDING_EFFECTS) fail('invalid_combat');
  const pendingEffects = Array.from({ length: pendingLength }, () => readValue(reader));
  const encounter = { id: readEncounterId(reader), type: readEncounterType(reader) };
  const eventOrder = reader.readVarUint();
  return { arena, actors, initiativeOrder, currentIndex, round, pendingEffects, encounter, eventOrder };
}
