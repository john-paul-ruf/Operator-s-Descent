const DATA_FILES = [
  ['sigils', 'data/sigils.json'],
  ['themes', 'data/themes.json'],
  ['classes', 'data/classes.json'],
  ['protocols', 'data/protocols.json'],
  ['enemies', 'data/enemies.json'],
  ['equipment', 'data/equipment.json'],
  ['affixes', 'data/affixes.json'],
  ['conditions', 'data/conditions.json'],
  ['consumables', 'data/consumables.json'],
  ['symbolTable', 'data/symbol-table.json'],
];

const ATTRIBUTES = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
const ARCHETYPES = ['chambers', 'caves', 'maze', 'open', 'organic', 'bastion', 'lattice', 'ruin'];
const MODIFIERS = ['none', 'dense', 'sparse', 'dangerous'];
const CLASS_IDS = ['breacher', 'ghost', 'compiler', 'anchor', 'oracle', 'operator'];
const THEME_IDS = ['cold_storage', 'foundry', 'data_stream', 'data_cache', 'archive', 'hive', 'void', 'lattice', 'stack', 'terminal', 'nursery', 'crypt'];
const SCHOOL_IDS = ['disrupt', 'ward', 'scry', 'rewrite'];
const ENEMY_IDS = ['drone', 'warden', 'stalker', 'choir', 'null', 'construct', 'phantom', 'apex'];
const WEAPON_IDS = ['sidearm', 'heavy_melee', 'polearm', 'light_ranged', 'heavy_ranged', 'sniper', 'area_projector', 'shield'];
const ARMOR_IDS = ['none', 'light', 'medium', 'heavy'];
const AFFIX_IDS = ['reinforced', 'overcharged', 'lucky', 'phasing', 'edged', 'precise', 'extended', 'vampiric', 'conducting', 'incendiary', 'corrosive', 'jamming', 'lightweight', 'shielding', 'fortified', 'resonant'];
const CONDITION_IDS = ['jammed', 'overloaded', 'shielded', 'blinded', 'immobilized', 'corroded', 'marked', 'panicked', 'burning'];
const CONSUMABLE_IDS = ['repair_patch', 'med_kit', 'charge_cell', 'boost_cell', 'purge_spike', 'shield_capacitor', 'adrenal_injector'];
const SYMBOL_TABLE_IDS = ['class', 'sigil_id', 'sigil_codepoint', 'attribute', 'hp', 'charge', 'condition_mask', 'item_id', 'equipment', 'calibration_count', 'signature_tier', 'theme_id', 'protocol_ref', 'affix_id', 'inventory_default'];
const DICE = new Set(['d4', 'd6', 'd8', 'd10', 'd12']);
const EFFECT_TYPES = new Set(['damage', 'heal', 'condition', 'heal_over_time', 'buff', 'reveal', 'reveal_full', 'reveal_marked', 'swap', 'remove_condition', 'ap_penalty', 'reshape']);
const CONSUMABLE_EFFECT_TYPES = new Set(['heal', 'charge_restore', 'charge_restore_full', 'remove_condition', 'apply_condition', 'ap_restore']);

let activeRegistry = null;
let loadPromise = null;

function dataError(code, file, details) {
  return { code, file, details };
}

function addError(errors, code, file, details) {
  errors.push(dataError(code, file, details));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStableId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value);
}

function isIntegerIn(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function hasFields(value, fields) {
  return isObject(value) && fields.every((field) => Object.hasOwn(value, field));
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function hasExactIds(ids, expected) {
  return ids.size === expected.length && expected.every((id) => ids.has(id));
}

function validateVersions(registry, errors) {
  for (const [key, file] of DATA_FILES) {
    if (!isObject(registry?.[key])) {
      addError(errors, 'missing_file', file, 'Expected a JSON object.');
    } else if (registry[key].version !== 1) {
      addError(errors, 'version_mismatch', file, 'Expected integer version 1.');
    }
  }
}

function validateSigils(data, errors) {
  const file = 'data/sigils.json';
  if (!hasFields(data, ['playerBank', 'bestiaryBank', 'safeSubstitutionPool'])) {
    addError(errors, 'invalid_schema', file, 'Expected playerBank, bestiaryBank, and safeSubstitutionPool.');
    return;
  }
  const banks = [data.playerBank, data.bestiaryBank];
  if (!banks.every((bank) => hasFields(bank, ['start', 'end']) && Number.isInteger(bank.start) && Number.isInteger(bank.end) && bank.start < bank.end)) {
    addError(errors, 'invalid_schema', file, 'Bank ranges must be increasing integer pairs.');
  }
  const playerFamilies = data.playerBank.families;
  const bestiaryArchetypes = data.bestiaryBank.archetypes;
  if (!isObject(playerFamilies) || !isObject(bestiaryArchetypes) || !isObject(data.safeSubstitutionPool)) {
    addError(errors, 'invalid_schema', file, 'Bank maps and safe pool must be objects.');
    return;
  }
  if (!hasExactKeys(playerFamilies, CLASS_IDS) || !hasExactKeys(bestiaryArchetypes, ENEMY_IDS)) addError(errors, 'invalid_catalog', file, 'Sigil banks must match the class and enemy catalogs.');
  const playerCodepoints = [];
  const bestiaryCodepoints = [];
  for (const [id, family] of Object.entries(playerFamilies).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isStableId(id) || !Array.isArray(family?.codepoints) || family.codepoints.length !== 8 || !family.codepoints.every((codepoint) => isIntegerIn(codepoint, data.playerBank.start, data.playerBank.end - 1))) {
      addError(errors, 'invalid_schema', file, `Invalid player family ${id}.`);
    } else {
      playerCodepoints.push(...family.codepoints);
    }
  }
  for (const [id, archetype] of Object.entries(bestiaryArchetypes).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isStableId(id) || !Array.isArray(archetype?.codepoints) || archetype.codepoints.length !== 3 || !archetype.codepoints.every((codepoint) => isIntegerIn(codepoint, data.bestiaryBank.start, data.bestiaryBank.end - 1))) {
      addError(errors, 'invalid_schema', file, `Invalid bestiary archetype ${id}.`);
    } else {
      bestiaryCodepoints.push(...archetype.codepoints);
    }
  }
  if (playerCodepoints.length !== 48 || bestiaryCodepoints.length !== 24 || new Set([...playerCodepoints, ...bestiaryCodepoints]).size !== 72) {
    addError(errors, 'invalid_catalog', file, 'Expected 48 unique player and 24 unique bestiary codepoints.');
  }
  const safeCodepoints = Object.values(data.safeSubstitutionPool).flat();
  if (!hasExactKeys(data.safeSubstitutionPool, ['latin', 'digits', 'boxDrawing']) || !safeCodepoints.every(Number.isInteger) || safeCodepoints.some((codepoint) => codepoint >= data.playerBank.start && codepoint < data.bestiaryBank.end) || safeCodepoints.some((codepoint) => new Set([...playerCodepoints, ...bestiaryCodepoints]).has(codepoint))) {
    addError(errors, 'unsafe_substitution_pool', file, 'Safe codepoints must be integer values disjoint from both sigil banks.');
  }
}

function validateThemes(data, errors, registry) {
  const file = 'data/themes.json';
  if (!Array.isArray(data?.themes) || data.themes.length !== 12) {
    addError(errors, 'invalid_catalog', file, 'Expected exactly 12 themes.');
    return;
  }
  const ids = new Set();
  const enemyIds = Object.keys(registry.enemies?.archetypes || {}).sort();
  const affixIds = Object.keys(registry.affixes?.affixes || {}).sort();
  for (const theme of data.themes) {
    if (!hasFields(theme, ['id', 'name', 'accentColor', 'archetypeWeights', 'modifierWeights', 'enemyMixWeights', 'lootBias', 'audioMode']) || !isStableId(theme.id) || !isString(theme.name) || !/^#[0-9a-fA-F]{6}$/.test(theme.accentColor) || !isString(theme.audioMode)) {
      addError(errors, 'invalid_schema', file, `Invalid theme ${theme?.id || '(unknown)'}.`);
      continue;
    }
    if (ids.has(theme.id)) addError(errors, 'duplicate_id', file, `Duplicate theme id ${theme.id}.`);
    ids.add(theme.id);
    const weightMaps = [[theme.archetypeWeights, ARCHETYPES, 'archetype'], [theme.modifierWeights, MODIFIERS, 'modifier'], [theme.enemyMixWeights, enemyIds, 'enemy']];
    for (const [weights, keys, label] of weightMaps) {
      if (!hasExactKeys(weights, keys) || !Object.values(weights).every((weight) => typeof weight === 'number' && Number.isFinite(weight) && weight >= 0)) {
        addError(errors, 'invalid_weight_map', file, `Invalid ${label} weights for ${theme.id}.`);
      }
    }
    const bias = theme.lootBias;
    if (!hasFields(bias, ['containerDensity', 'rarityShift', 'affixPoolBias']) || typeof bias.containerDensity !== 'number' || !Number.isFinite(bias.containerDensity) || bias.containerDensity <= 0 || typeof bias.rarityShift !== 'number' || !Number.isFinite(bias.rarityShift) || !isObject(bias.affixPoolBias) || Object.entries(bias.affixPoolBias).some(([id, weight]) => !affixIds.includes(id) || typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0)) {
      addError(errors, 'invalid_schema', file, `Invalid loot bias for ${theme.id}.`);
    }
  }
  if (!hasExactIds(ids, THEME_IDS)) addError(errors, 'invalid_catalog', file, 'Theme ids must match the v1 catalog.');
}

function validateClasses(data, errors, registry) {
  const file = 'data/classes.json';
  if (!Array.isArray(data?.classes) || data.classes.length !== 6) {
    addError(errors, 'invalid_catalog', file, 'Expected exactly 6 classes.');
    return;
  }
  const ids = new Set();
  const weapons = registry.equipment?.weapons || {};
  const armor = registry.equipment?.armor || {};
  const schools = registry.protocols?.schools || {};
  const families = registry.sigils?.playerBank?.families || {};
  for (const entry of data.classes) {
    if (!hasFields(entry, ['id', 'name', 'primaryAttribute', 'hitDieBase', 'chargeBase', 'signature', 'equipmentGates', 'protocolGates', 'sigilFamily', 'calibrationOptions']) || !isStableId(entry.id) || !isString(entry.name) || !ATTRIBUTES.includes(entry.primaryAttribute) || !isIntegerIn(entry.hitDieBase, 6, 16) || !isIntegerIn(entry.chargeBase, 0, 8) || !isObject(entry.signature) || !isStableId(entry.signature.id) || !isString(entry.signature.name) || !Array.isArray(entry.signature.tiers) || entry.signature.tiers.length !== 3 || !entry.signature.tiers.every(isString) || !isObject(entry.equipmentGates) || !Array.isArray(entry.equipmentGates.weapons) || !Array.isArray(entry.equipmentGates.armor) || !isObject(entry.protocolGates) || !Array.isArray(entry.protocolGates.schools) || !isIntegerIn(entry.protocolGates.maxTier, 1, 5) || !isStableId(entry.sigilFamily) || !isObject(entry.calibrationOptions)) {
      addError(errors, 'invalid_schema', file, `Invalid class ${entry?.id || '(unknown)'}.`);
      continue;
    }
    if (ids.has(entry.id)) addError(errors, 'duplicate_id', file, `Duplicate class id ${entry.id}.`);
    ids.add(entry.id);
    if (!entry.equipmentGates.weapons.every((id) => Object.hasOwn(weapons, id)) || !entry.equipmentGates.armor.every((id) => Object.hasOwn(armor, id)) || !entry.protocolGates.schools.every((id) => Object.hasOwn(schools, id)) || !Object.hasOwn(families, entry.sigilFamily) || entry.sigilFamily !== entry.id) {
      addError(errors, 'invalid_reference', file, `Invalid gate or sigil family for ${entry.id}.`);
    }
  }
  if (!hasExactIds(ids, CLASS_IDS)) addError(errors, 'invalid_catalog', file, 'Class ids must match the v1 catalog.');
}

function validateProtocols(data, errors, registry) {
  const file = 'data/protocols.json';
  if (!isObject(data?.schools) || !hasExactKeys(data.schools, SCHOOL_IDS)) {
    addError(errors, 'invalid_catalog', file, 'Expected exactly 4 protocol schools.');
    return;
  }
  const conditionIds = new Set(Object.keys(registry.conditions?.conditions || {}));
  for (const [id, school] of Object.entries(data.schools).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isStableId(id) || !isString(school?.name) || !Array.isArray(school.tiers) || school.tiers.length !== 5) {
      addError(errors, 'invalid_schema', file, `Invalid protocol school ${id}.`);
      continue;
    }
    school.tiers.forEach((tier, index) => {
      if (!hasFields(tier, ['tier', 'name', 'chargeCost', 'range', 'effect', 'effectData']) || tier.tier !== index + 1 || tier.chargeCost !== (index + 1) * 2 || !isString(tier.name) || !isString(tier.range) || !isString(tier.effect) || !isObject(tier.effectData) || !EFFECT_TYPES.has(tier.effectData.type) || (tier.effectData.condition && !conditionIds.has(tier.effectData.condition)) || (tier.effectData.save && !ATTRIBUTES.includes(tier.effectData.save)) || (tier.effectData.die && !DICE.has(tier.effectData.die))) {
        addError(errors, 'invalid_schema', file, `Invalid tier ${index + 1} for ${id}.`);
      }
    });
  }
}

function validateEnemies(data, errors, registry) {
  const file = 'data/enemies.json';
  if (!isObject(data?.archetypes) || !hasExactKeys(data.archetypes, ENEMY_IDS)) {
    addError(errors, 'invalid_catalog', file, 'Expected exactly 8 enemy archetypes.');
    return;
  }
  const sigilArchetypes = registry.sigils?.bestiaryBank?.archetypes || {};
  const schools = registry.protocols?.schools || {};
  const conditionIds = new Set(Object.keys(registry.conditions?.conditions || {}));
  for (const [id, enemy] of Object.entries(data.archetypes).sort(([a], [b]) => a.localeCompare(b))) {
    const validAttributes = hasExactKeys(enemy?.attributes, ATTRIBUTES) && Object.values(enemy.attributes).every((value) => isIntegerIn(value, 1, 10));
    const access = enemy?.protocolAccess;
    const validAccess = access === null || (isObject(access) && (!access.schools || (Array.isArray(access.schools) && access.schools.every((school) => Object.hasOwn(schools, school)))) && (!access.conditions || (Array.isArray(access.conditions) && access.conditions.every((condition) => conditionIds.has(condition))) && (!access.maxTier || isIntegerIn(access.maxTier, 1, 5))));
    const expectedSigils = sigilArchetypes[id]?.codepoints || [];
    if (!isStableId(id) || !hasFields(enemy, ['name', 'role', 'attributes', 'hpBonus', 'armored', 'behavior', 'protocolAccess', 'retreats', 'sigilCodepoints']) || !isString(enemy.name) || !isString(enemy.role) || !validAttributes || typeof enemy.hpBonus !== 'number' || !Number.isFinite(enemy.hpBonus) || typeof enemy.armored !== 'boolean' || !isString(enemy.behavior) || typeof enemy.retreats !== 'boolean' || !validAccess || !Array.isArray(enemy.sigilCodepoints) || enemy.sigilCodepoints.length !== 3 || enemy.sigilCodepoints.some((codepoint, index) => codepoint !== expectedSigils[index])) {
      addError(errors, 'invalid_schema', file, `Invalid enemy ${id}.`);
    }
  }
}

function validateEquipment(data, errors, registry) {
  const file = 'data/equipment.json';
  const weapons = data?.weapons;
  const armor = data?.armor;
  const classIds = new Set(registry.classes?.classes?.map((entry) => entry.id) || []);
  if (!hasExactKeys(weapons, WEAPON_IDS) || !hasExactKeys(armor, ARMOR_IDS)) {
    addError(errors, 'invalid_catalog', file, 'Expected 8 weapons and 4 armor entries.');
    return;
  }
  for (const [id, item] of Object.entries(weapons).sort(([a], [b]) => a.localeCompare(b))) {
    const shield = id === 'shield';
    if (!isStableId(id) || !hasFields(item, ['name', 'damageDie', 'rangeBand', 'maxRange', 'accuracyBonus', 'classGates', 'creationCost', 'slot', 'salvageValue']) || !isString(item.name) || (!shield && !DICE.has(item.damageDie)) || (shield && item.damageDie !== null) || (!shield && !isString(item.rangeBand)) || (shield && item.rangeBand !== null) || !isIntegerIn(item.maxRange, 0, 16) || typeof item.accuracyBonus !== 'number' || !Number.isFinite(item.accuracyBonus) || !Array.isArray(item.classGates) || !item.classGates.every((classId) => classIds.has(classId)) || !isIntegerIn(item.creationCost, 1, 4) || item.slot !== (shield ? 'offhand' : 'weapon') || !isIntegerIn(item.salvageValue, 0, 4)) {
      addError(errors, 'invalid_schema', file, `Invalid weapon ${id}.`);
    }
  }
  for (const [id, item] of Object.entries(armor).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isStableId(id) || !hasFields(item, ['name', 'defenseBonus', 'finPenalty', 'classGates', 'creationCost', 'salvageValue']) || !isString(item.name) || !Number.isInteger(item.defenseBonus) || !Number.isInteger(item.finPenalty) || !Array.isArray(item.classGates) || !item.classGates.every((classId) => classIds.has(classId)) || !isIntegerIn(item.creationCost, 0, 3) || !isIntegerIn(item.salvageValue, 0, 3)) {
      addError(errors, 'invalid_schema', file, `Invalid armor ${id}.`);
    }
  }
}

function validateAffixes(data, errors, registry) {
  const file = 'data/affixes.json';
  if (!hasExactKeys(data?.affixes, AFFIX_IDS)) {
    addError(errors, 'invalid_catalog', file, 'Expected exactly 16 affixes.');
    return;
  }
  const conditions = new Set(Object.keys(registry.conditions?.conditions || {}));
  for (const [id, affix] of Object.entries(data.affixes).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isStableId(id) || !hasFields(affix, ['name', 'category', 'class', 'effect', 'effectData']) || !isString(affix.name) || !['universal', 'weapon', 'armor'].includes(affix.category) || !['minor', 'major'].includes(affix.class) || !isString(affix.effect) || !isObject(affix.effectData) || (affix.effectData.conditionOnCrit && !conditions.has(affix.effectData.conditionOnCrit)) || (affix.effectData.conditionOnHit && !conditions.has(affix.effectData.conditionOnHit)) || (affix.effectData.save && !ATTRIBUTES.includes(affix.effectData.save))) {
      addError(errors, 'invalid_schema', file, `Invalid affix ${id}.`);
    }
  }
}

function validateConditions(data, errors) {
  const file = 'data/conditions.json';
  if (!hasExactKeys(data?.conditions, CONDITION_IDS)) {
    addError(errors, 'invalid_catalog', file, 'Expected exactly 9 conditions.');
    return;
  }
  for (const [id, condition] of Object.entries(data.conditions).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isStableId(id) || !hasFields(condition, ['name', 'effect', 'duration', 'saveAttribute', 'stackable', 'effectData']) || !isString(condition.name) || !isString(condition.effect) || !isIntegerIn(condition.duration, 1, 3) || !(condition.saveAttribute === null || ATTRIBUTES.includes(condition.saveAttribute)) || typeof condition.stackable !== 'boolean' || !isObject(condition.effectData) || (condition.stackable !== (id === 'burning')) || (condition.effectData.damagePerTurn && !DICE.has(condition.effectData.damagePerTurn))) {
      addError(errors, 'invalid_schema', file, `Invalid condition ${id}.`);
    }
  }
}

function validateConsumables(data, errors, registry) {
  const file = 'data/consumables.json';
  if (!hasExactKeys(data?.consumables, CONSUMABLE_IDS)) {
    addError(errors, 'invalid_catalog', file, 'Expected exactly 7 consumables.');
    return;
  }
  const conditions = new Set(Object.keys(registry.conditions?.conditions || {}));
  for (const [id, item] of Object.entries(data.consumables).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isStableId(id) || !hasFields(item, ['name', 'effect', 'effectData', 'minDepth', 'combatOnly', 'salvageValue']) || !isString(item.name) || !isString(item.effect) || !isObject(item.effectData) || !CONSUMABLE_EFFECT_TYPES.has(item.effectData.type) || (item.effectData.condition && !conditions.has(item.effectData.condition)) || (item.effectData.die && !DICE.has(item.effectData.die)) || !isIntegerIn(item.minDepth, 1, 10) || typeof item.combatOnly !== 'boolean' || !isIntegerIn(item.salvageValue, 0, 3)) {
      addError(errors, 'invalid_schema', file, `Invalid consumable ${id}.`);
    }
  }
}

function validateSymbolTable(data, errors, registry) {
  const file = 'data/symbol-table.json';
  if (!hasExactKeys(data?.tables, SYMBOL_TABLE_IDS)) {
    addError(errors, 'invalid_schema', file, 'Expected a tables object.');
    return;
  }
  for (const [name, table] of Object.entries(data.tables).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isStableId(name) || !hasFields(table, ['width', 'escape', 'entries']) || !isIntegerIn(table.width, 1, 32) || !Number.isInteger(table.escape) || table.escape < 0 || table.escape >= 2 ** table.width || !Array.isArray(table.entries) || table.entries.length > table.escape || new Set(table.entries.map((entry) => JSON.stringify(entry))).size !== table.entries.length) {
      addError(errors, 'invalid_schema', file, `Invalid symbol table ${name}.`);
    }
  }
  const table = data.tables;
  const expectedItems = [...Object.keys(registry.equipment?.weapons || {}), ...Object.keys(registry.equipment?.armor || {}), ...Object.keys(registry.consumables?.consumables || {})].sort();
  const expectedEquipment = [...Object.entries(registry.equipment?.weapons || {}).map(([id, item]) => [id, item.slot]), ...Object.keys(registry.equipment?.armor || {}).map((id) => [id, 'armor'])];
  if (!table.class?.entries || table.class.entries.join('|') !== (registry.classes?.classes || []).map((entry) => entry.id).join('|')) addError(errors, 'invalid_reference', file, 'Class table must match class catalog order.');
  const expectedCodepoints = [...CLASS_IDS.flatMap((id) => registry.sigils?.playerBank?.families?.[id]?.codepoints || []), ...ENEMY_IDS.flatMap((id) => registry.sigils?.bestiaryBank?.archetypes?.[id]?.codepoints || [])];
  if (!table.sigil_codepoint?.entries || table.sigil_codepoint.entries.join('|') !== expectedCodepoints.join('|') || !table.sigil_id?.entries || table.sigil_id.entries.join('|') !== expectedCodepoints.map((codepoint) => `pua-${codepoint.toString(16)}`).join('|')) addError(errors, 'invalid_reference', file, 'Sigil tables must match both sigil banks.');
  if (!table.item_id?.entries || table.item_id.entries.slice().sort().join('|') !== expectedItems.join('|')) addError(errors, 'invalid_reference', file, 'Item table must match equipment and consumables.');
  if (!table.equipment?.entries || table.equipment.entries.length !== expectedEquipment.length || expectedEquipment.some(([id, slot]) => !table.equipment.entries.some((entry) => Array.isArray(entry) && entry[0] === id && entry[1] === slot))) addError(errors, 'invalid_reference', file, 'Equipment table must match equipment slots.');
  if (!table.theme_id?.entries || table.theme_id.entries.join('|') !== THEME_IDS.join('|') || !table.protocol_ref?.entries || SCHOOL_IDS.some((school) => ![1, 2, 3, 4, 5].every((tier) => table.protocol_ref.entries.some((entry) => Array.isArray(entry) && entry[0] === school && entry[1] === tier))) || !table.affix_id?.entries || table.affix_id.entries.join('|') !== AFFIX_IDS.join('|')) addError(errors, 'invalid_reference', file, 'Symbol tables must match theme, protocol, and affix catalogs.');
}

export function validateGameData(registry) {
  const errors = [];
  validateVersions(registry, errors);
  if (errors.some((error) => error.code === 'missing_file')) return { valid: false, errors };
  validateSigils(registry.sigils, errors);
  validateConditions(registry.conditions, errors);
  validateAffixes(registry.affixes, errors, registry);
  validateProtocols(registry.protocols, errors, registry);
  validateEnemies(registry.enemies, errors, registry);
  validateEquipment(registry.equipment, errors, registry);
  validateClasses(registry.classes, errors, registry);
  validateConsumables(registry.consumables, errors, registry);
  validateThemes(registry.themes, errors, registry);
  validateSymbolTable(registry.symbolTable, errors, registry);
  return { valid: errors.length === 0, errors };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

async function loadFile(fetchImpl, key, file) {
  let response;
  try {
    response = await fetchImpl(file);
  } catch (error) {
    throw dataError('fetch_failed', file, error instanceof Error ? error.message : String(error));
  }
  if (!response?.ok) throw dataError('fetch_failed', file, `HTTP ${response?.status ?? 'unknown'}`);
  try {
    return [key, await response.json()];
  } catch (error) {
    throw dataError('invalid_json', file, error instanceof Error ? error.message : String(error));
  }
}

export async function loadGameData(fetchImpl = fetch) {
  if (activeRegistry) return activeRegistry;
  if (loadPromise) return loadPromise;
  if (typeof fetchImpl !== 'function') return Promise.reject(dataError('invalid_fetch', 'data', 'fetchImpl must be a function.'));
  loadPromise = Promise.all(DATA_FILES.map(([key, file]) => loadFile(fetchImpl, key, file)))
    .then((entries) => Object.fromEntries(entries))
    .then((registry) => {
      const result = validateGameData(registry);
      if (!result.valid) throw result.errors[0];
      activeRegistry = deepFreeze(registry);
      return activeRegistry;
    })
    .catch((error) => {
      loadPromise = null;
      throw error;
    });
  return loadPromise;
}

export function getGameData() {
  if (!activeRegistry) {
    const error = new Error('Game data has not been activated.');
    error.code = 'data_not_activated';
    throw error;
  }
  return activeRegistry;
}

export function resetGameDataForTests() {
  activeRegistry = null;
  loadPromise = null;
}
