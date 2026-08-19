import { readSymbol, writeSymbol } from './condense.js';

const ATTRIBUTES = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
const CATEGORIES = ['weapon', 'armor', 'consumable'];
const RARITIES = ['stock', 'tuned', 'custom', 'prototype', 'corrupt'];
const SIDES = ['party', 'enemy', 'echo'];
const ENEMY_ID_TYPES = ['drone', 'stalker', 'choir', 'null', 'construct', 'apex', 'echo'];
const ENCOUNTER_TYPES = ['standard', 'hunt'];
// Pinned v5 condition enum (alphabetical for stability, mirrors the ids in
// data/conditions.json). Any drift MUST bump RUN_SCHEMA_VERSION — the
// codec-drift-guards test locks this list against the data file at every
// build. The codec writes a 1-bit known flag + 4-bit index for known ids;
// unknown ids fall through to the string escape path so future non-shipped
// conditions still decode without a schema bump wound.
export const CONDITION_IDS = ['blinded', 'burning', 'corroded', 'immobilized', 'jammed', 'marked', 'overloaded', 'panicked', 'shielded'];
const MAX_ID = 96;
const MAX_CONDITIONS = 9;
const MAX_AFFIXES = 8;
const MAX_DECK = 20;
const MAX_CALIBRATIONS = 16;
const MAX_ACTORS = 24;
// v5: initiativeOrder can hold up to 2× actors (apex actors take a second
// action slot per round via combat.js buildTurnOrder). Every actor must appear
// at least once and no more than twice.
const MAX_INITIATIVE = MAX_ACTORS * 2;
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

function writeString(writer, value, maximum = MAX_ID) {
  if (typeof value !== 'string') fail('invalid_string');
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > maximum) fail('invalid_string');
  writer.writeVarUint(bytes.length);
  writer.writeBytes(bytes);
}

function readString(reader, maximum = MAX_ID) {
  return new TextDecoder('utf-8', { fatal: true }).decode(reader.readBytes(requireInteger(reader.readVarUint(), 0, maximum, 'invalid_length')));
}

function writeEntityId(writer, value) {
  if (typeof value !== 'string') fail('invalid_string');
  const operator = value.match(/^operator_([1-4])$/);
  if (operator) {
    writer.writeUint(1, 2);
    writer.writeUint(Number(operator[1]) - 1, 2);
    return;
  }
  const enemy = value.match(/^enemy_(\d{1,3})_([a-z_]+)_(\d+)$/);
  const enemyType = enemy ? ENEMY_ID_TYPES.indexOf(enemy[2]) : -1;
  const depth = enemy ? Number(enemy[1]) : -1;
  const cursor = enemy ? Number(enemy[3]) : -1;
  if (enemyType >= 0 && Number.isInteger(depth) && depth >= 1 && depth <= 255 && Number.isSafeInteger(cursor) && cursor >= 0) {
    writer.writeUint(2, 2);
    writer.writeUint(depth, 8);
    writer.writeUint(enemyType, 3);
    writer.writeVarUint(cursor);
    return;
  }
  writer.writeUint(0, 2);
  writeString(writer, value);
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

function writeEncounterId(writer, value) {
  if (typeof value !== 'string') fail('invalid_string');
  const encounter = value.match(/^encounter_(\d{1,2})_(\d{1,2})_(\d+)$/);
  const x = encounter ? Number(encounter[1]) : -1;
  const y = encounter ? Number(encounter[2]) : -1;
  const cursor = encounter ? Number(encounter[3]) : -1;
  if (Number.isInteger(x) && x >= 0 && x <= 31 && Number.isInteger(y) && y >= 0 && y <= 31 && Number.isSafeInteger(cursor) && cursor >= 0) {
    writer.writeBool(true);
    writer.writeUint(x, 5);
    writer.writeUint(y, 5);
    writer.writeVarUint(cursor);
    return;
  }
  writer.writeBool(false);
  writeString(writer, value);
}

function readEncounterId(reader) {
  if (!reader.readBool()) return readString(reader);
  return `encounter_${reader.readUint(5)}_${reader.readUint(5)}_${reader.readVarUint()}`;
}

function writeEncounterType(writer, value) {
  const index = ENCOUNTER_TYPES.indexOf(value);
  writer.writeBool(index >= 0);
  if (index >= 0) writer.writeUint(index, 1);
  else writeString(writer, value, 64);
}

function readEncounterType(reader) {
  if (!reader.readBool()) return readString(reader, 64);
  return ENCOUNTER_TYPES[reader.readUint(1)];
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
  if (typeof value === 'boolean') {
    writer.writeUint(value ? 2 : 1, 3);
    return;
  }
  if (typeof value === 'number') {
    writer.writeUint(3, 3);
    writeNumber(writer, value);
    return;
  }
  if (typeof value === 'string') {
    writer.writeUint(4, 3);
    writeString(writer, value, 2048);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_VALUE_ENTRIES) fail('invalid_value_array');
    writer.writeUint(5, 3);
    writer.writeVarUint(value.length);
    for (const entry of value) writeValue(writer, entry, depth + 1);
    return;
  }
  if (!isObject(value) || Object.keys(value).length > MAX_VALUE_ENTRIES) fail('invalid_value_object');
  writer.writeUint(6, 3);
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  writer.writeVarUint(entries.length);
  for (const [key, entry] of entries) {
    writeString(writer, key, MAX_ID);
    writeValue(writer, entry, depth + 1);
  }
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

function symbolWriter(symbols) {
  return symbols?.writeSymbol || writeSymbol;
}

function symbolReader(symbols) {
  return symbols?.readSymbol || readSymbol;
}

function writeField(writer, symbols, field, value, raw) {
  symbolWriter(symbols)(writer, field, value, raw);
}

function readField(reader, symbols, field, raw) {
  return symbolReader(symbols)(reader, field, raw);
}

// v5 condition encoding: known ids collapse from 8-11 raw bytes to 5 bits
// (1-bit known flag + 4-bit index into CONDITION_IDS). Unknown ids fall
// through the escape path so future data-file additions decode without a
// schema bump; the codec-drift-guards test blocks a silent drift.
function writeConditions(writer, conditions, symbols) {
  if (!Array.isArray(conditions) || conditions.length > MAX_CONDITIONS) fail('invalid_conditions');
  const ids = new Set();
  writer.writeUint(conditions.length, 4);
  for (const condition of conditions) {
    if (!isObject(condition) || typeof condition.conditionId !== 'string' || ids.has(condition.conditionId)) fail('invalid_conditions');
    ids.add(condition.conditionId);
    const enumIndex = CONDITION_IDS.indexOf(condition.conditionId);
    const known = enumIndex >= 0;
    writer.writeBool(known);
    if (known) writer.writeUint(enumIndex, 4);
    else writeString(writer, condition.conditionId, 64);
    writer.writeVarUint(requireInteger(condition.duration, 0, 255, 'invalid_conditions'));
    const hasStacks = condition.stacks !== undefined;
    writer.writeBool(hasStacks);
    if (hasStacks) writer.writeVarUint(requireInteger(condition.stacks, 1, 255, 'invalid_conditions'));
  }
}

function readConditions(reader) {
  const length = reader.readUint(4);
  if (length > MAX_CONDITIONS) fail('invalid_conditions');
  const ids = new Set();
  const conditions = [];
  for (let index = 0; index < length; index++) {
    let conditionId;
    if (reader.readBool()) {
      const enumIndex = reader.readUint(4);
      if (enumIndex >= CONDITION_IDS.length) fail('invalid_conditions');
      conditionId = CONDITION_IDS[enumIndex];
    } else {
      conditionId = readString(reader, 64);
    }
    if (ids.has(conditionId)) fail('duplicate_condition');
    ids.add(conditionId);
    const duration = requireInteger(reader.readVarUint(), 0, 255, 'invalid_conditions');
    const stacks = reader.readBool() ? requireInteger(reader.readVarUint(), 1, 255, 'invalid_conditions') : undefined;
    conditions.push({ conditionId, duration, ...(stacks === undefined ? {} : { stacks }) });
  }
  return conditions;
}

export function writeItem(writer, item, symbols) {
  if (!isObject(item) || !CATEGORIES.includes(item.category) || !RARITIES.includes(item.rarity) || !Array.isArray(item.affixes) || item.affixes.length > MAX_AFFIXES || !Number.isFinite(item.salvageValue) || item.salvageValue < 0 || item.salvageValue > 1_000_000 || (item.count !== undefined && (!Number.isInteger(item.count) || item.count < 1 || item.count > 100)) || (item.corruptionValue !== undefined && (!Number.isFinite(item.corruptionValue) || item.corruptionValue < 0 || item.corruptionValue > 1_000_000))) fail('invalid_item');
  writeString(writer, item.id);
  writer.writeUint(CATEGORIES.indexOf(item.category), 2);
  writeField(writer, symbols, 'item_id', item.baseType, (value) => writeString(writer, value));
  writer.writeUint(RARITIES.indexOf(item.rarity), 3);
  writer.writeUint(item.affixes.length, 4);
  for (const affix of item.affixes) writeField(writer, symbols, 'affix_id', affix, (value) => writeString(writer, value, 64));
  writer.writeBool(Boolean(item.corrupt));
  writer.writeBool(item.corruptionValue !== undefined);
  if (item.corruptionValue !== undefined) writeNumber(writer, item.corruptionValue);
  writeNumber(writer, item.salvageValue);
  writer.writeBool(Boolean(item.junkTagged));
  writer.writeBool(item.count !== undefined);
  if (item.count !== undefined) writer.writeVarUint(item.count);
  writeValue(writer, item.stats ?? {});
  writer.writeBool(item.extensions !== undefined);
  if (item.extensions !== undefined) writeValue(writer, item.extensions);
}

export function readItem(reader, symbols) {
  const id = readString(reader);
  const category = CATEGORIES[reader.readUint(2)];
  if (!category) fail('invalid_item');
  const baseType = readField(reader, symbols, 'item_id', () => readString(reader));
  const rarity = RARITIES[reader.readUint(3)];
  if (!rarity) fail('invalid_item');
  const affixLength = reader.readUint(4);
  if (affixLength > MAX_AFFIXES) fail('invalid_item');
  const affixes = Array.from({ length: affixLength }, () => readField(reader, symbols, 'affix_id', () => readString(reader, 64)));
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

export function writeCharacter(writer, character, symbols) {
  const calibrationChoices = character?.calibrationChoices ?? [];
  const protocolDeck = character?.protocolDeck ?? [];
  if (!isObject(character) || !isObject(character.attributes) || !Array.isArray(calibrationChoices) || calibrationChoices.length > MAX_CALIBRATIONS || !Array.isArray(protocolDeck) || protocolDeck.length > MAX_DECK) fail('invalid_character');
  writeEntityId(writer, character.id);
  writeField(writer, symbols, 'class', character.classId, (value) => writeString(writer, value, 64));
  writeField(writer, symbols, 'sigil_id', character.sigilId, (value) => writeString(writer, value, 64));
  for (const attribute of ATTRIBUTES) writeField(writer, symbols, 'attribute', requireInteger(character.attributes[attribute], 1, 255, 'invalid_character'), (value) => writer.writeVarUint(value));
  writeField(writer, symbols, 'hp', requireInteger(character.currentHP, 0, 255, 'invalid_character'), (value) => writer.writeVarUint(value));
  writeField(writer, symbols, 'charge', requireInteger(character.currentCHARGE, 0, 255, 'invalid_character'), (value) => writer.writeVarUint(value));
  writeField(writer, symbols, 'calibration_count', requireInteger(character.calibrationCount ?? 0, 0, 16, 'invalid_character'), (value) => writer.writeVarUint(value));
  writer.writeUint(calibrationChoices.length, 5);
  for (const choice of calibrationChoices) {
    if (!isObject(choice)) fail('invalid_character');
    writer.writeVarUint(requireInteger(choice.floor, 1, 255, 'invalid_character'));
    writeString(writer, choice.optionId, MAX_ID);
  }
  writeField(writer, symbols, 'signature_tier', requireInteger(character.signatureTier ?? 1, 1, 3, 'invalid_character'), (value) => writer.writeVarUint(value));
  const equipment = character.equipment ?? {};
  for (const slot of ['weapon', 'armor', 'offhand']) {
    writer.writeBool(equipment[slot] != null);
    if (equipment[slot] != null) writeItem(writer, equipment[slot], symbols);
  }
  writer.writeUint(protocolDeck.length, 5);
  for (const protocol of protocolDeck) {
    if (!isObject(protocol) || !Number.isInteger(protocol.tier) || protocol.tier < 1 || protocol.tier > 5) fail('invalid_character');
    writeField(writer, symbols, 'protocol_ref', [protocol.school, protocol.tier], () => {
      writeString(writer, protocol.school, 32);
      writer.writeUint(protocol.tier, 3);
    });
  }
  writeConditions(writer, character.conditions ?? [], symbols);
  writer.writeBool(character.extensions !== undefined);
  if (character.extensions !== undefined) writeValue(writer, character.extensions);
}

export function readCharacter(reader, symbols) {
  const id = readEntityId(reader);
  const classId = readField(reader, symbols, 'class', () => readString(reader, 64));
  const sigilId = readField(reader, symbols, 'sigil_id', () => readString(reader, 64));
  const attributes = Object.fromEntries(ATTRIBUTES.map((attribute) => [attribute, requireInteger(readField(reader, symbols, 'attribute', () => reader.readVarUint()), 1, 255, 'invalid_character')]));
  const currentHP = requireInteger(readField(reader, symbols, 'hp', () => reader.readVarUint()), 0, 255, 'invalid_character');
  const currentCHARGE = requireInteger(readField(reader, symbols, 'charge', () => reader.readVarUint()), 0, 255, 'invalid_character');
  const calibrationCount = requireInteger(readField(reader, symbols, 'calibration_count', () => reader.readVarUint()), 0, 16, 'invalid_character');
  const calibrationLength = reader.readUint(5);
  if (calibrationLength > MAX_CALIBRATIONS) fail('invalid_character');
  const calibrationChoices = Array.from({ length: calibrationLength }, () => ({ floor: requireInteger(reader.readVarUint(), 1, 255, 'invalid_character'), optionId: readString(reader) }));
  const signatureTier = requireInteger(readField(reader, symbols, 'signature_tier', () => reader.readVarUint()), 1, 3, 'invalid_character');
  const equipment = Object.fromEntries(['weapon', 'armor', 'offhand'].map((slot) => [slot, reader.readBool() ? readItem(reader, symbols) : null]));
  const deckLength = reader.readUint(5);
  if (deckLength > MAX_DECK) fail('invalid_character');
  const protocolDeck = Array.from({ length: deckLength }, () => {
    const protocol = readField(reader, symbols, 'protocol_ref', () => [readString(reader, 32), reader.readUint(3)]);
    if (!Array.isArray(protocol) || protocol.length !== 2 || typeof protocol[0] !== 'string' || !Number.isInteger(protocol[1]) || protocol[1] < 1 || protocol[1] > 5) fail('invalid_character');
    return { school: protocol[0], tier: protocol[1] };
  });
  const conditions = readConditions(reader);
  const extensions = reader.readBool() ? readValue(reader) : undefined;
  if (extensions !== undefined && !isObject(extensions)) fail('invalid_character');
  return { id, classId, sigilId, attributes, currentHP, currentCHARGE, calibrationCount, calibrationChoices, signatureTier, equipment, protocolDeck, conditions, ...(extensions === undefined ? {} : { extensions }) };
}

export function writeEcho(writer, echo, symbols) {
  if (!isObject(echo)) fail('invalid_echo');
  writeCharacter(writer, echo.character, symbols);
  writer.writeVarUint(requireInteger(echo.deathFloor, 1, 255, 'invalid_echo'));
  writer.writeVarUint(requireInteger(echo.appearanceFloor, echo.deathFloor + 2, echo.deathFloor + 4, 'invalid_echo'));
}

export function readEcho(reader, symbols) {
  const character = readCharacter(reader, symbols);
  const deathFloor = requireInteger(reader.readVarUint(), 1, 255, 'invalid_echo');
  const appearanceFloor = requireInteger(reader.readVarUint(), deathFloor + 2, deathFloor + 4, 'invalid_echo');
  return { character, deathFloor, appearanceFloor };
}

const ENEMY_STAT_ATTRIBUTES = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
const ENEMY_STAT_BEHAVIORS = ['aggressive', 'defensive', 'flanking', 'artillery', 'controller', 'phasing', 'multi-action', 'echo'];
const ENEMY_STAT_ARCHETYPES = ['drone', 'warden', 'stalker', 'choir', 'null', 'construct', 'phantom', 'apex', 'echo'];
// Mirrors data/enemies.json sigilCodepoints — snapshot codec encodes known
// archetype+sigil combos as a 2-bit variant index instead of the full 21-bit
// codepoint. Any change to those pools MUST bump RUN_SCHEMA_VERSION. Exported
// so tests/state/sigil-pool-guard.test.js can assert the pools stay in lockstep
// with the enemies-data source without a schema bump.
export const ENEMY_STAT_SIGIL_POOLS = {
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

function writeEnemyBehavior(writer, value) {
  const index = ENEMY_STAT_BEHAVIORS.indexOf(value);
  const known = index >= 0;
  writer.writeBool(known);
  if (known) writer.writeUint(index, 3);
  else writeString(writer, typeof value === 'string' ? value : 'other', MAX_BEHAVIOR_STRING);
}

function readEnemyBehavior(reader) {
  if (reader.readBool()) {
    const index = reader.readUint(3);
    const behavior = ENEMY_STAT_BEHAVIORS[index];
    if (!behavior) fail('invalid_actor');
    return behavior;
  }
  return readString(reader, MAX_BEHAVIOR_STRING);
}

function writeEnemyArchetypeId(writer, value) {
  const index = ENEMY_STAT_ARCHETYPES.indexOf(value);
  const known = index >= 0;
  writer.writeBool(known);
  if (known) writer.writeUint(index, 4);
  else writeString(writer, typeof value === 'string' ? value : '', MAX_ARCHETYPE_ID);
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

// v4 enemy-stats codec. Standard archetypes (drone/warden/…/apex) are a pure
// function of (archetypeId, depth) via data/enemies.json — the runtime
// re-derives attributes/defense/behavior/protocolAccess on restore
// (deriveEnemyStats in src/rules/combat.js), so the wire format only carries
// the fields that vary per instance: hpMax, chargeMax, sigilCodepoint. Echoes
// (archetypeId === 'echo') inherit party-character attributes not derivable
// from any archetype, so their block still writes the full template inline
// after the archetype id. v3 saves keep decoding through the frozen reader.
function writeEnemyStatsTemplate(writer, stats) {
  const attributes = stats.attributes;
  if (!isObject(attributes)) fail('invalid_actor');
  for (const key of ENEMY_STAT_ATTRIBUTES) {
    writer.writeUint(requireInteger(attributes[key], 1, MAX_ENEMY_ATTRIBUTE, 'invalid_actor'), 5);
  }
  writer.writeVarUint(requireInteger(stats.defense ?? 0, 0, MAX_ENEMY_STAT_VALUE, 'invalid_actor'));
  writer.writeVarUint(requireInteger(stats.protocolDefense ?? 0, 0, MAX_ENEMY_STAT_VALUE, 'invalid_actor'));
  writeEnemyBehavior(writer, stats.behavior);
  writer.writeBool(Boolean(stats.retreats));
  writer.writeBool(stats.protocolAccess != null);
  if (stats.protocolAccess != null) writeValue(writer, stats.protocolAccess);
}

function readEnemyStatsTemplate(reader) {
  const attributes = Object.fromEntries(ENEMY_STAT_ATTRIBUTES.map((key) => [key, requireInteger(reader.readUint(5), 1, MAX_ENEMY_ATTRIBUTE, 'invalid_actor')]));
  const defense = requireInteger(reader.readVarUint(), 0, MAX_ENEMY_STAT_VALUE, 'invalid_actor');
  const protocolDefense = requireInteger(reader.readVarUint(), 0, MAX_ENEMY_STAT_VALUE, 'invalid_actor');
  const behavior = readEnemyBehavior(reader);
  const retreats = reader.readBool();
  const protocolAccess = reader.readBool() ? readValue(reader) : null;
  return { attributes, defense, protocolDefense, behavior, retreats, protocolAccess };
}

// `previous` is accepted for API compatibility with the v3 signature (dedup
// context) but v4 no longer dedups — same-archetype packs already collapse to
// a ~5-bit archetype write per enemy, so the extra bookkeeping wasn't earning
// its complexity. Caller state is passed through unchanged.
// v5: per-enemy alignToByte pair dropped — the block-level align in
// writeCombatSnapshot / readCombatSnapshot is the only alignment that fires
// now, and the per-enemy padding was pure overhead.
function writeEnemyStats(writer, stats, previous) {
  const hasStats = isObject(stats);
  writer.writeBool(hasStats);
  if (!hasStats) return previous;
  writeEnemyArchetypeId(writer, stats.archetypeId);
  if (stats.archetypeId === 'echo') writeEnemyStatsTemplate(writer, stats);
  writer.writeVarUint(requireInteger(stats.hpMax ?? 0, 0, MAX_ENEMY_HP_MAX, 'invalid_actor'));
  const chargeMax = requireInteger(stats.chargeMax ?? 0, 0, MAX_ENEMY_HP_MAX, 'invalid_actor');
  writer.writeBool(chargeMax > 0);
  if (chargeMax > 0) writer.writeVarUint(chargeMax);
  const sigilCodepoint = requireInteger(stats.sigilCodepoint ?? 0, 0, MAX_SIGIL_CODEPOINT, 'invalid_actor');
  const pool = ENEMY_STAT_SIGIL_POOLS[stats.archetypeId];
  const variant = pool ? pool.indexOf(sigilCodepoint) : -1;
  const inPool = variant >= 0;
  writer.writeBool(inPool);
  if (inPool) writer.writeUint(variant, 2);
  else writer.writeUint(sigilCodepoint, 21);
  return stats;
}

function readEnemyStats(reader, previous) {
  if (!reader.readBool()) return { stats: undefined, previous };
  const archetypeId = readEnemyArchetypeId(reader);
  const template = archetypeId === 'echo' ? readEnemyStatsTemplate(reader) : {};
  const hpMax = requireInteger(reader.readVarUint(), 0, MAX_ENEMY_HP_MAX, 'invalid_actor');
  const chargeMax = reader.readBool() ? requireInteger(reader.readVarUint(), 0, MAX_ENEMY_HP_MAX, 'invalid_actor') : 0;
  let sigilCodepoint;
  if (reader.readBool()) {
    const variant = reader.readUint(2);
    const pool = ENEMY_STAT_SIGIL_POOLS[archetypeId];
    if (!pool || variant >= pool.length) fail('invalid_actor');
    sigilCodepoint = pool[variant];
  } else {
    sigilCodepoint = requireInteger(reader.readUint(21), 0, MAX_SIGIL_CODEPOINT, 'invalid_actor');
  }
  const stats = { archetypeId, ...template, hpMax, chargeMax, sigilCodepoint };
  return { stats, previous: stats };
}

// v5: enemy IDs use a combat-local delta context so a run of enemies at the
// same floor collapses to 1-bit same-depth + 3-bit archetype + signed varInt
// cursor delta rather than the full 8+3+varUint each time. Non-enemy IDs
// (operator_N, echo_..., raw strings) still route through writeEntityId
// unchanged. The context is owned by writeCombatSnapshot / readCombatSnapshot
// so nothing else in the codec is affected.
function writeCombatActorId(writer, value, context) {
  if (typeof value !== 'string') fail('invalid_string');
  const operator = value.match(/^operator_([1-4])$/);
  if (operator) {
    writer.writeUint(1, 2);
    writer.writeUint(Number(operator[1]) - 1, 2);
    return;
  }
  const enemy = value.match(/^enemy_(\d{1,3})_([a-z_]+)_(\d+)$/);
  const enemyType = enemy ? ENEMY_ID_TYPES.indexOf(enemy[2]) : -1;
  const depth = enemy ? Number(enemy[1]) : -1;
  const cursor = enemy ? Number(enemy[3]) : -1;
  if (enemyType >= 0 && Number.isInteger(depth) && depth >= 1 && depth <= 255 && Number.isSafeInteger(cursor) && cursor >= 0) {
    if (context.previous) {
      writer.writeUint(3, 2);
      const sameDepth = depth === context.previous.depth;
      writer.writeBool(sameDepth);
      if (!sameDepth) writer.writeUint(depth, 8);
      writer.writeUint(enemyType, 3);
      writer.writeVarInt(cursor - context.previous.cursor);
    } else {
      writer.writeUint(2, 2);
      writer.writeUint(depth, 8);
      writer.writeUint(enemyType, 3);
      writer.writeVarUint(cursor);
    }
    context.previous = { depth, cursor };
    return;
  }
  writer.writeUint(0, 2);
  writeString(writer, value);
}

function readCombatActorId(reader, context) {
  switch (reader.readUint(2)) {
    case 0: return readString(reader);
    case 1: return `operator_${reader.readUint(2) + 1}`;
    case 2: {
      const depth = reader.readUint(8);
      const enemyType = ENEMY_ID_TYPES[reader.readUint(3)];
      const cursor = reader.readVarUint();
      if (!enemyType) fail('invalid_string');
      context.previous = { depth, cursor };
      return `enemy_${depth}_${enemyType}_${cursor}`;
    }
    case 3: {
      if (!context.previous) fail('invalid_string');
      const sameDepth = reader.readBool();
      const depth = sameDepth ? context.previous.depth : reader.readUint(8);
      const enemyType = ENEMY_ID_TYPES[reader.readUint(3)];
      const cursor = context.previous.cursor + reader.readVarInt();
      if (!enemyType || depth < 1 || depth > 255 || !Number.isSafeInteger(cursor) || cursor < 0) fail('invalid_string');
      context.previous = { depth, cursor };
      return `enemy_${depth}_${enemyType}_${cursor}`;
    }
    default: fail('invalid_string');
  }
}

function writeActor(writer, actor, enemyContext) {
  if (!isObject(actor) || !SIDES.includes(actor.side)) fail('invalid_actor');
  writeCombatActorId(writer, actor.id, enemyContext);
  writer.writeUint(SIDES.indexOf(actor.side), 2);
  writer.writeUint(requireInteger(actor.x, 0, 31, 'invalid_actor'), 5);
  writer.writeUint(requireInteger(actor.y, 0, 31, 'invalid_actor'), 5);
  writer.writeVarUint(requireInteger(actor.hp, 0, 255, 'invalid_actor'));
  writer.writeVarUint(requireInteger(actor.charge ?? 0, 0, 255, 'invalid_actor'));
  writeConditions(writer, actor.conditions ?? []);
  writer.writeVarInt(requireInteger(actor.initiative, -255, 255, 'invalid_actor'));
  writer.writeUint(requireInteger(actor.ap ?? 0, 0, 7, 'invalid_actor'), 3);
  writer.writeUint(requireInteger(actor.moves ?? 0, 0, 7, 'invalid_actor'), 3);
  writer.writeUint(requireInteger(actor.freeActions ?? 0, 0, 7, 'invalid_actor'), 3);
  writer.writeBool(Boolean(actor.defeated));
  writer.writeBool(Boolean(actor.retreated));
}

function readActor(reader, enemyContext) {
  const id = readCombatActorId(reader, enemyContext);
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

export function writeCombatSnapshot(writer, combat, options = {}) {
  if (!isObject(combat) || !isObject(combat.arena) || !Array.isArray(combat.actors) || combat.actors.length < 1 || combat.actors.length > MAX_ACTORS || !Array.isArray(combat.initiativeOrder) || !Array.isArray(combat.pendingEffects)) fail('invalid_combat');
  writer.writeUint(requireInteger(combat.arena.originX, 0, 31, 'invalid_combat'), 5);
  writer.writeUint(requireInteger(combat.arena.originY, 0, 31, 'invalid_combat'), 5);
  writeEncounterId(writer, combat.arena.contactId);
  writer.writeUint(combat.actors.length, 5);
  const actorIds = new Set();
  const actorIndexById = new Map();
  const enemyDeltaContext = { previous: null };
  for (const [index, actor] of combat.actors.entries()) {
    if (actorIds.has(actor.id)) fail('duplicate_actor');
    actorIds.add(actor.id);
    actorIndexById.set(actor.id, index);
    writeActor(writer, actor, enemyDeltaContext);
  }
  // Enemy stat blocks are emitted contiguously after the actor list so a run of
  // identical archetypes can dedup the body (attributes, defense, behavior, …)
  // against the previous entry and pay only for the varying sigil codepoint.
  writer.alignToByte();
  let previousStats = null;
  for (const actor of combat.actors) {
    if (actor.side !== 'party') previousStats = writeEnemyStats(writer, actor.stats, previousStats);
  }
  // v5: initiativeOrder is written as 5-bit indices into actors[] (6-bit length
  // prefix, MAX_INITIATIVE = 2×MAX_ACTORS = 48 to accommodate apex two-slot
  // actors). Duplicates are legal but each actor must be referenced 1–2 times
  // and every actor must appear at least once.
  if (combat.initiativeOrder.length < combat.actors.length || combat.initiativeOrder.length > MAX_INITIATIVE) fail('invalid_combat');
  const referenceCounts = new Map();
  for (const id of combat.initiativeOrder) {
    if (!actorIds.has(id)) fail('invalid_combat');
    const count = (referenceCounts.get(id) ?? 0) + 1;
    if (count > 2) fail('invalid_combat');
    referenceCounts.set(id, count);
  }
  if (referenceCounts.size !== combat.actors.length) fail('invalid_combat');
  writer.writeUint(combat.initiativeOrder.length, 6);
  for (const id of combat.initiativeOrder) writer.writeUint(actorIndexById.get(id), 5);
  writer.writeUint(requireInteger(combat.currentIndex, 0, combat.initiativeOrder.length - 1, 'invalid_combat'), 6);
  writer.writeVarUint(requireInteger(combat.round, 1, 255, 'invalid_combat'));
  if (combat.pendingEffects.length > MAX_PENDING_EFFECTS) fail('invalid_combat');
  writer.writeUint(combat.pendingEffects.length, 6);
  for (const effect of combat.pendingEffects) writeValue(writer, effect);
  if (!isObject(combat.encounter) || typeof combat.encounter.id !== 'string' || typeof combat.encounter.type !== 'string') fail('invalid_combat');
  // v5: encounter.id is almost always the same string as arena.contactId
  // (both come from combatState.id in toCombatSnapshot). Emit 1 bit and only
  // fall through to the full encounter-id encoding when they differ.
  const sameAsArena = combat.encounter.id === combat.arena.contactId;
  writer.writeBool(sameAsArena);
  if (!sameAsArena) writeEncounterId(writer, combat.encounter.id);
  writeEncounterType(writer, combat.encounter.type);
  writer.writeVarUint(requireInteger(combat.eventOrder, 0, Number.MAX_SAFE_INTEGER, 'invalid_combat'));
}

export function readCombatSnapshot(reader, options = {}) {
  const arena = { originX: reader.readUint(5), originY: reader.readUint(5), contactId: readEncounterId(reader) };
  const actorLength = reader.readUint(5);
  if (actorLength < 1 || actorLength > MAX_ACTORS) fail('invalid_combat');
  const enemyDeltaContext = { previous: null };
  const actors = Array.from({ length: actorLength }, () => readActor(reader, enemyDeltaContext));
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
  const initiativeLength = reader.readUint(6);
  if (initiativeLength < actorLength || initiativeLength > MAX_INITIATIVE) fail('invalid_combat');
  const referenceCounts = new Map();
  const initiativeOrder = Array.from({ length: initiativeLength }, () => {
    const index = reader.readUint(5);
    if (index >= actorLength) fail('invalid_combat');
    const id = actors[index].id;
    const count = (referenceCounts.get(id) ?? 0) + 1;
    if (count > 2) fail('invalid_combat');
    referenceCounts.set(id, count);
    return id;
  });
  if (referenceCounts.size !== actorLength) fail('invalid_combat');
  const currentIndex = requireInteger(reader.readUint(6), 0, initiativeLength - 1, 'invalid_combat');
  const round = requireInteger(reader.readVarUint(), 1, 255, 'invalid_combat');
  const pendingLength = reader.readUint(6);
  if (pendingLength > MAX_PENDING_EFFECTS) fail('invalid_combat');
  const pendingEffects = Array.from({ length: pendingLength }, () => readValue(reader));
  const sameAsArena = reader.readBool();
  const encounterId = sameAsArena ? arena.contactId : readEncounterId(reader);
  const encounter = { id: encounterId, type: readEncounterType(reader) };
  const eventOrder = reader.readVarUint();
  return { arena, actors, initiativeOrder, currentIndex, round, pendingEffects, encounter, eventOrder };
}
