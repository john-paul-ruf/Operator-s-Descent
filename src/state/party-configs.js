import { ATTRIBUTE_BASELINE_RANK, ATTRIBUTE_KEYS, attributeCreationCost, isAttributeRank, normalizeAttributes } from '../rules/attributes.js';

const KEY_CONFIGS = 'od_party_configs';
const KEY_LAST_USED = 'od_party_config_last_used';
const MAX_CONFIGS = 10;
const TOTAL_POINTS = 80;

function getStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function storageResult(action) {
  try { return { success: true, value: action() }; } catch (error) { return { success: false, error: error?.name === 'QuotaExceededError' || /quota/i.test(error?.message || '') ? 'quota_exceeded' : 'storage_failed' }; }
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, max = 80) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null; }
function integer(value, min, max, fallback = null) { return Number.isInteger(value) && value >= min && value <= max ? value : fallback; }
function sigilIdFromCodepoint(codepoint) { return Number.isInteger(codepoint) ? `pua-${codepoint.toString(16)}` : null; }
function codepointFromSigilId(sigilId) {
  const match = typeof sigilId === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(sigilId);
  return match ? Number.parseInt(match[1], 16) : null;
}

function normalizeEquipment(equipment = {}) {
  return {
    weapon: equipment.weapon === null ? null : text(equipment.weapon, 64),
    armor: equipment.armor === null ? null : text(equipment.armor, 64),
    offhand: equipment.offhand === null ? null : text(equipment.offhand, 64)
  };
}

function normalizeCharacter(character) {
  if (!isObject(character)) return null;
  const attributes = isObject(character.attributes) ? character.attributes : {};
  const protocols = Array.isArray(character.protocols ?? character.protocolDeck) ? character.protocols ?? character.protocolDeck : [];
  const sigilCodepoint = integer(character.sigilCodepoint ?? character.sigil ?? codepointFromSigilId(character.sigilId), 0, 0x10ffff);
  const sigilId = text(character.sigilId, 64) ?? sigilIdFromCodepoint(sigilCodepoint);
  return {
    classId: text(character.classId, 64),
    sigilId,
    sigilCodepoint,
    attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, attributes[key]])),
    equipment: normalizeEquipment(isObject(character.equipment) ? character.equipment : {}),
    protocols: protocols.slice(0, 20).map((protocol) => isObject(protocol) ? { school: text(protocol.school, 64), tier: integer(protocol.tier, 1, 5) } : null).filter(Boolean)
  };
}

function normalizeBlueprint(name, blueprint) {
  if (!isObject(blueprint)) return null;
  const normalizedName = text(name ?? blueprint.name);
  const characters = Array.isArray(blueprint.characters) ? blueprint.characters.map(normalizeCharacter).filter(Boolean).slice(0, 4) : [];
  if (!normalizedName) return null;
  return {
    name: normalizedName,
    version: integer(blueprint.version, 1, 0xffff, 1),
    credits: integer(blueprint.credits, 0, 800, 0),
    pointsSpent: integer(blueprint.pointsSpent, 0, 80, 0),
    characters,
    savedAt: integer(blueprint.savedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())
  };
}

function readConfigs(storage) {
  const raw = storageResult(() => storage.getItem(KEY_CONFIGS));
  if (!raw.success) return raw;
  if (!raw.value) return { success: true, configs: [] };
  try {
    const parsed = JSON.parse(raw.value);
    if (!Array.isArray(parsed)) return { success: true, configs: [] };
    return { success: true, configs: parsed.map((config) => normalizeBlueprint(config?.name, config)).filter(Boolean).slice(0, MAX_CONFIGS) };
  } catch { return { success: true, configs: [] }; }
}

function writeConfigs(storage, configs) { return storageResult(() => storage.setItem(KEY_CONFIGS, JSON.stringify(configs))); }
function currentVersion(gameData) { return integer(gameData?.version ?? gameData?.classes?.version ?? gameData?.equipment?.version ?? gameData?.protocols?.version, 1, 0xffff, 1); }

function equipmentEntry(gameData, slot, id) {
  if (id === null) return null;
  return slot === 'armor' ? gameData?.equipment?.armor?.[id] : gameData?.equipment?.weapons?.[id];
}

function isLegalSlot(slot, id, item) {
  if (!item) return false;
  if (slot === 'armor') return true;
  if (slot === 'weapon') return item.slot === 'weapon';
  return item.slot === 'offhand' || id === 'sidearm';
}

function draftAttributes(attributes = {}) {
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, Number.isInteger(attributes?.[key]) ? attributes[key] : ATTRIBUTE_BASELINE_RANK]));
}

function blueprintPoints(config, gameData) {
  let points = 0;
  for (const character of config.characters) {
    points += 5;
    for (const key of ATTRIBUTE_KEYS) points += isAttributeRank(character.attributes[key]) ? attributeCreationCost(character.attributes[key]) : 0;
    for (const slot of ['weapon', 'armor', 'offhand']) points += equipmentEntry(gameData, slot, character.equipment[slot])?.creationCost ?? 0;
    for (const protocol of character.protocols) points += Number.isInteger(protocol.tier) ? protocol.tier * 2 : 0;
  }
  return points;
}

function configEntry(config) {
  if (!config) return null;
  return {
    ...config,
    partySigils: config.characters.map((character) => character.sigilCodepoint).filter(Number.isInteger),
    partyClasses: config.characters.map((character) => character.classId).filter(Boolean)
  };
}

export function blueprintFromDraft(draft, gameData = {}, name = draft?.name ?? draft?.originalBlueprint?.name ?? 'draft') {
  const raw = {
    name,
    version: currentVersion(gameData),
    characters: (Array.isArray(draft?.characters) ? draft.characters : []).map((character) => ({
      classId: character.classId,
      sigilCodepoint: character.sigilCodepoint ?? character.sigil,
      attributes: draftAttributes(character.attributes),
      equipment: normalizeEquipment(character.equipment),
      protocols: Array.isArray(character.protocols) ? character.protocols.map((protocol) => ({ school: protocol.school, tier: protocol.tier })) : []
    }))
  };
  const config = normalizeBlueprint(name, raw);
  if (!config) return null;
  const pointsSpent = blueprintPoints(config, gameData);
  return { ...config, pointsSpent, credits: Math.max(0, TOTAL_POINTS - pointsSpent) * 10 };
}

export function draftFromBlueprint(blueprint) {
  const config = normalizeBlueprint(blueprint?.name ?? 'loaded', blueprint);
  if (!config) return null;
  return {
    activeSlot: 0,
    finalized: false,
    originalBlueprint: clone(config),
    characters: config.characters.map((character) => ({
      classId: character.classId,
      sigil: character.sigilCodepoint,
      attributes: normalizeAttributes(character.attributes),
      equipment: normalizeEquipment(character.equipment),
      protocols: character.protocols.map((protocol) => ({ school: protocol.school, tier: protocol.tier }))
    }))
  };
}

export function saveConfig(name, blueprint, options = {}) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  const config = normalizeBlueprint(name, blueprint);
  if (!config) return { success: false, error: 'invalid_config' };
  const listed = readConfigs(storage);
  if (!listed.success) return listed;
  const index = listed.configs.findIndex((item) => item.name === config.name);
  if (index >= 0 && options.overwrite !== true) return { success: false, error: 'requiresConfirmation', requiresConfirmation: true };
  if (index < 0 && listed.configs.length >= MAX_CONFIGS) return { success: false, error: 'max_reached' };
  if (index >= 0) listed.configs[index] = config;
  else listed.configs.push(config);
  const saved = writeConfigs(storage, listed.configs);
  return saved.success ? { success: true, config, configs: listed.configs.map(configEntry) } : saved;
}

export function loadConfig(name) {
  const storage = getStorage();
  if (!storage) return null;
  const listed = readConfigs(storage);
  return listed.success ? configEntry(listed.configs.find((config) => config.name === name) || null) : null;
}

export function listConfigs() {
  const storage = getStorage();
  if (!storage) return [];
  const listed = readConfigs(storage);
  return listed.success ? listed.configs.map(configEntry) : [];
}

export function deleteConfig(name) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  const listed = readConfigs(storage);
  if (!listed.success) return listed;
  const configs = listed.configs.filter((config) => config.name !== name);
  const saved = writeConfigs(storage, configs);
  if (!saved.success) return saved;
  const last = storageResult(() => storage.getItem(KEY_LAST_USED));
  if (last.success && last.value === name) storageResult(() => storage.removeItem(KEY_LAST_USED));
  return { success: true, deleted: configs.length !== listed.configs.length };
}

export function getLastUsed() {
  const storage = getStorage();
  if (!storage) return null;
  const saved = storageResult(() => storage.getItem(KEY_LAST_USED));
  return saved.success && typeof saved.value === 'string' ? loadConfig(saved.value) : null;
}

export function setLastUsed(nameOrBlueprint, options = {}) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  if (isObject(nameOrBlueprint)) {
    const config = normalizeBlueprint(options.name ?? nameOrBlueprint.name, nameOrBlueprint);
    if (!config) return { success: false, error: 'invalid_config' };
    const saved = saveConfig(config.name, config, { overwrite: true });
    if (!saved.success) return saved;
    return storageResult(() => storage.setItem(KEY_LAST_USED, config.name));
  }
  return storageResult(() => storage.setItem(KEY_LAST_USED, String(nameOrBlueprint)));
}

export function validateConfig(blueprint, gameData) {
  const invalidItems = [];
  const config = normalizeBlueprint(blueprint?.name || 'validation', blueprint);
  if (!config) return { valid: false, invalidItems: [{ field: 'blueprint', value: blueprint }] };
  const classes = Array.isArray(gameData?.classes?.classes) ? gameData.classes.classes : [];
  const classById = new Map(classes.map((entry) => [entry.id, entry]));
  const schools = gameData?.protocols?.schools || {};
  const familyByClass = Object.fromEntries(classes.map((entry) => [entry.id, gameData?.sigils?.playerBank?.families?.[entry.sigilFamily]?.codepoints ?? []]));
  if (config.version !== currentVersion(gameData)) invalidItems.push({ field: 'version', value: config.version });
  if (config.characters.length < 1 || config.characters.length > 4) invalidItems.push({ field: 'party', value: config.characters.length });
  const usedSigils = new Set();
  let points = 0;
  for (const character of config.characters) {
    const classData = classById.get(character.classId);
    if (!classData) { invalidItems.push({ field: 'class', value: character.classId }); continue; }
    const sigil = character.sigilCodepoint;
    const family = familyByClass[character.classId] ?? [];
    if (!Number.isInteger(sigil)) invalidItems.push({ field: 'sigil', value: sigil });
    else {
      if (usedSigils.has(sigil)) invalidItems.push({ field: 'sigil', value: sigil, error: 'duplicate' });
      else usedSigils.add(sigil);
      if (family.length && !family.includes(sigil)) invalidItems.push({ field: 'sigil', value: sigil });
    }
    points += 5;
    for (const key of ATTRIBUTE_KEYS) {
      const rank = character.attributes[key];
      if (!isAttributeRank(rank)) invalidItems.push({ field: `attributes.${key}`, value: rank });
      else points += attributeCreationCost(rank);
    }
    for (const slot of ['weapon', 'armor', 'offhand']) {
      const id = character.equipment[slot];
      if (id === null) continue;
      const item = equipmentEntry(gameData, slot, id);
      if (!item) invalidItems.push({ field: slot, value: id });
      else if (!isLegalSlot(slot, id, item)) invalidItems.push({ field: slot, value: id, error: 'slot' });
      else if (!item.classGates?.includes(character.classId)) invalidItems.push({ field: slot, value: id, error: 'class_gate' });
      else points += item.creationCost || 0;
    }
    let slots = 0;
    for (const protocol of character.protocols) {
      const tier = protocol.tier;
      const school = schools[protocol.school];
      if (!school || !classData.protocolGates?.schools?.includes(protocol.school) || tier > classData.protocolGates?.maxTier || !school.tiers?.some((entry) => entry.tier === tier)) invalidItems.push({ field: 'protocol', value: protocol });
      else { points += tier * 2; slots += tier; }
    }
    if (slots > 3 + Math.floor((classData.chargeBase || 0) / 2)) invalidItems.push({ field: 'deck', value: slots });
  }
  if (config.pointsSpent !== points) invalidItems.push({ field: 'pointsSpent', value: config.pointsSpent, expected: points });
  if (points > TOTAL_POINTS || config.credits !== (TOTAL_POINTS - points) * 10) invalidItems.push({ field: 'credits', value: config.credits, expected: Math.max(0, (TOTAL_POINTS - points) * 10) });
  return { valid: invalidItems.length === 0, invalidItems, pointsSpent: points };
}
