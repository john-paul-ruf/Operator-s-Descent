const KEY_CONFIGS = 'od_party_configs';
const KEY_LAST_USED = 'od_party_config_last_used';
const MAX_CONFIGS = 10;
const ATTRIBUTE_KEYS = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];

function getStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function storageResult(action) {
  try { return { success: true, value: action() }; } catch (error) { return { success: false, error: error?.name === 'QuotaExceededError' || /quota/i.test(error?.message || '') ? 'quota_exceeded' : 'storage_failed' }; }
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, max = 80) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null; }
function integer(value, min, max, fallback = null) { return Number.isInteger(value) && value >= min && value <= max ? value : fallback; }

function normalizeCharacter(character) {
  if (!isObject(character)) return null;
  const attributes = isObject(character.attributes) ? character.attributes : {};
  const equipment = isObject(character.equipment) ? character.equipment : {};
  const protocols = Array.isArray(character.protocols) ? character.protocols : [];
  return {
    classId: text(character.classId, 64),
    sigilId: text(character.sigilId, 64),
    sigilCodepoint: integer(character.sigilCodepoint, 0, 0x10ffff),
    attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, attributes[key]])),
    equipment: {
      weapon: character.equipment?.weapon === null ? null : text(equipment.weapon, 64),
      armor: character.equipment?.armor === null ? null : text(equipment.armor, 64),
      offhand: character.equipment?.offhand === null ? null : text(equipment.offhand, 64)
    },
    protocols: protocols.slice(0, 20).map((protocol) => isObject(protocol) ? { school: text(protocol.school, 64), tier: integer(protocol.tier, 1, 5) } : null).filter(Boolean)
  };
}

function normalizeBlueprint(name, blueprint) {
  if (!isObject(blueprint)) return null;
  const normalizedName = text(name ?? blueprint.name);
  const characters = Array.isArray(blueprint.characters) ? blueprint.characters.map(normalizeCharacter).filter(Boolean).slice(0, 4) : [];
  if (!normalizedName) return null;
  return {
    ...blueprint,
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
function costFromRank(rank) { return Math.max(0, Math.min(rank, 6) - 3) + Math.max(0, Math.min(rank, 8) - 6) * 2 + Math.max(0, rank - 8) * 3; }

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
  return saved.success ? { success: true, config, configs: listed.configs } : saved;
}

export function loadConfig(name) {
  const storage = getStorage();
  if (!storage) return null;
  const listed = readConfigs(storage);
  return listed.success ? listed.configs.find((config) => config.name === name) || null : null;
}

export function listConfigs() {
  const storage = getStorage();
  if (!storage) return [];
  const listed = readConfigs(storage);
  return listed.success ? listed.configs : [];
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

export function setLastUsed(name) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };
  return storageResult(() => storage.setItem(KEY_LAST_USED, String(name)));
}

export function validateConfig(blueprint, gameData) {
  const invalidItems = [];
  const config = normalizeBlueprint(blueprint?.name || 'validation', blueprint);
  if (!config) return { valid: false, invalidItems: [{ field: 'blueprint', value: blueprint }] };
  const classes = Array.isArray(gameData?.classes?.classes) ? gameData.classes.classes : [];
  const classById = new Map(classes.map((entry) => [entry.id, entry]));
  const weapons = gameData?.equipment?.weapons || {};
  const armor = gameData?.equipment?.armor || {};
  const schools = gameData?.protocols?.schools || {};
  const validSigils = new Set(Object.values(gameData?.sigils?.playerBank?.families || {}).flatMap((family) => family.codepoints || []));
  if (config.version !== currentVersion(gameData)) invalidItems.push({ field: 'version', value: config.version });
  if (config.characters.length < 1 || config.characters.length > 4) invalidItems.push({ field: 'party', value: config.characters.length });
  const usedSigils = new Set();
  let points = 0;
  for (const character of config.characters) {
    const classData = classById.get(character.classId);
    if (!classData) { invalidItems.push({ field: 'class', value: character.classId }); continue; }
    const sigil = character.sigilId ?? character.sigilCodepoint;
    if (sigil === null || sigil === undefined || (Number.isInteger(sigil) && validSigils.size && !validSigils.has(sigil))) invalidItems.push({ field: 'sigil', value: sigil });
    else if (usedSigils.has(sigil)) invalidItems.push({ field: 'sigil', value: sigil, error: 'duplicate' });
    else usedSigils.add(sigil);
    points += 5;
    for (const key of ATTRIBUTE_KEYS) {
      const rank = character.attributes[key];
      if (!Number.isInteger(rank) || rank < 1 || rank > 10) invalidItems.push({ field: `attributes.${key}`, value: rank });
      else points += costFromRank(rank);
    }
    for (const [slot, collection] of [['weapon', weapons], ['armor', armor], ['offhand', weapons]]) {
      const id = character.equipment[slot];
      if (id === null) continue;
      const item = collection[id];
      if (!item) invalidItems.push({ field: slot, value: id });
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
  if (points > 80 || config.credits !== (80 - points) * 10) invalidItems.push({ field: 'credits', value: config.credits, expected: Math.max(0, (80 - points) * 10) });
  return { valid: invalidItems.length === 0, invalidItems, pointsSpent: points };
}
