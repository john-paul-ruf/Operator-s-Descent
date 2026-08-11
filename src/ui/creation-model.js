import { ATTRIBUTE_BASELINE_RANK, ATTRIBUTE_KEYS, ATTRIBUTE_MAX_RANK, ATTRIBUTE_MIN_RANK, attributeCreationCost, deriveStats, isAttributeRank, normalizeAttributes } from '../rules/attributes.js';
import { canEquip, canPrepareProtocol } from '../rules/classes.js';
import { deckSlotCapacity, deckSlotCost } from '../rules/protocols.js';
import { blueprintFromDraft, draftFromBlueprint } from '../state/party-configs.js';

export const CREATION_POINT_BUDGET = 80;
export const CHASSIS_POINT_COST = 5;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function classes(gameData) { return Array.isArray(gameData?.classes?.classes) ? gameData.classes.classes : []; }
function classFor(gameData, classId) { return classes(gameData).find((entry) => entry.id === classId) ?? null; }
function protocolFor(gameData, protocol) { return gameData?.protocols?.schools?.[protocol?.school]?.tiers?.find((entry) => entry.tier === protocol.tier) ?? null; }
function codepointFromSigilId(sigilId) {
  const match = typeof sigilId === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(sigilId);
  return match ? Number.parseInt(match[1], 16) : null;
}
function sigilIdFromCodepoint(codepoint) { return `pua-${codepoint.toString(16)}`; }
function sigilFamily(gameData, classData) { return gameData?.sigils?.playerBank?.families?.[classData?.sigilFamily]?.codepoints ?? []; }
function boundedSlot(index, characters) { return Math.max(0, Math.min(characters.length - 1, Number.isInteger(index) ? index : 0)); }

function emptyCharacter() {
  return {
    classId: null,
    sigil: null,
    attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, ATTRIBUTE_BASELINE_RANK])),
    equipment: { weapon: null, armor: null, offhand: null },
    protocols: []
  };
}

function normalizeCharacter(character = {}) {
  const attributes = character.attributes && typeof character.attributes === 'object' ? character.attributes : {};
  return {
    classId: typeof character.classId === 'string' ? character.classId : null,
    sigil: Number.isInteger(character.sigil ?? character.sigilCodepoint) ? character.sigil ?? character.sigilCodepoint : codepointFromSigilId(character.sigilId),
    attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, Number.isInteger(attributes[key]) ? attributes[key] : ATTRIBUTE_BASELINE_RANK])),
    equipment: {
      weapon: typeof character.equipment?.weapon === 'string' ? character.equipment.weapon : null,
      armor: typeof character.equipment?.armor === 'string' ? character.equipment.armor : null,
      offhand: typeof character.equipment?.offhand === 'string' ? character.equipment.offhand : null
    },
    protocols: (Array.isArray(character.protocols ?? character.protocolDeck) ? character.protocols ?? character.protocolDeck : [])
      .filter((protocol) => typeof protocol?.school === 'string' && Number.isInteger(protocol.tier))
      .map((protocol) => ({ school: protocol.school, tier: protocol.tier }))
  };
}

function normalizeDraft(input = null) {
  const loaded = input?.characters && input?.version ? draftFromBlueprint(input) : null;
  const source = loaded ?? input ?? {};
  const characters = (Array.isArray(source.characters) ? source.characters : []).slice(0, 4).map(normalizeCharacter);
  return {
    activeSlot: characters.length ? boundedSlot(source.activeSlot, characters) : 0,
    finalized: source.finalized === true,
    originalBlueprint: clone(source.originalBlueprint ?? loaded?.originalBlueprint ?? null),
    characters
  };
}

function equipmentEntry(gameData, slot, id) {
  if (id === null) return null;
  return slot === 'armor' ? gameData?.equipment?.armor?.[id] ?? null : gameData?.equipment?.weapons?.[id] ?? null;
}

function isLegalEquipment(gameData, classData, slot, id) {
  if (id === null) return true;
  const item = equipmentEntry(gameData, slot, id);
  if (!item) return false;
  const category = slot === 'armor' ? 'armor' : item.slot === 'offhand' ? 'offhand' : 'weapon';
  if (slot === 'weapon' && item.slot === 'offhand') return false;
  if (slot === 'offhand' && item.slot !== 'offhand' && id !== 'sidearm') return false;
  return canEquip(classData, { id, baseType: id, category, slot: category }, []);
}

function isLegalProtocol(gameData, classData, protocol) {
  return Boolean(protocolFor(gameData, protocol)) && canPrepareProtocol(classData, protocol, []);
}

function reconcileCharacter(character, gameData) {
  const classData = classFor(gameData, character.classId);
  if (!classData) return { ...character, classId: null, sigil: null, equipment: { weapon: null, armor: null, offhand: null }, protocols: [] };
  const family = sigilFamily(gameData, classData);
  const equipment = Object.fromEntries(['weapon', 'armor', 'offhand'].map((slot) => [slot, isLegalEquipment(gameData, classData, slot, character.equipment[slot]) ? character.equipment[slot] : null]));
  const capacity = deckSlotCapacity(classData.chargeBase);
  let slots = 0;
  const protocols = [];
  for (const protocol of character.protocols) {
    const cost = deckSlotCost(protocol.tier);
    if (isLegalProtocol(gameData, classData, protocol) && slots + cost <= capacity) {
      protocols.push({ ...protocol });
      slots += cost;
    }
  }
  return { ...character, sigil: family.includes(character.sigil) ? character.sigil : null, equipment, protocols };
}

function actionSlot(action, draft) { return boundedSlot(action.slot ?? action.index ?? draft.activeSlot, draft.characters); }

export function createCreationDraft(initial = null) {
  return normalizeDraft(initial);
}

export function reduceCreationDraft(draft, action, gameData) {
  return applyCreationAction(draft, action, gameData).draft;
}

export function applyCreationAction(draft, action = {}, gameData = {}) {
  const current = normalizeDraft(draft);
  if (current.finalized && action.type !== 'reset') return { draft: current, result: { success: false, reason: 'finalized' } };
  let characters = current.characters.map((character) => clone(character));
  let activeSlot = current.activeSlot;
  if (action.type === 'add_character') {
    if (characters.length >= 4) return { draft: current, result: { success: false, reason: 'party_full' } };
    characters.push(normalizeCharacter(action.character ?? emptyCharacter()));
    activeSlot = characters.length - 1;
  } else if (action.type === 'remove_character') {
    if (!characters.length) return { draft: current, result: { success: false, reason: 'empty_party' } };
    characters.splice(actionSlot(action, current), 1);
    activeSlot = characters.length ? boundedSlot(activeSlot, characters) : 0;
  } else if (action.type === 'select_character') {
    activeSlot = characters.length ? actionSlot(action, current) : 0;
  } else if (action.type === 'set_class' && characters.length) {
    const slot = actionSlot(action, current);
    characters[slot] = reconcileCharacter({ ...characters[slot], classId: classFor(gameData, action.classId) ? action.classId : null }, gameData);
  } else if (action.type === 'set_sigil' && characters.length) {
    characters[actionSlot(action, current)].sigil = Number.isInteger(action.sigil ?? action.sigilCodepoint) ? action.sigil ?? action.sigilCodepoint : codepointFromSigilId(action.sigilId);
  } else if (action.type === 'buy_attribute' && characters.length) {
    const slot = actionSlot(action, current);
    const key = action.attribute;
    if (ATTRIBUTE_KEYS.includes(key)) characters[slot].attributes[key] = Math.min(ATTRIBUTE_MAX_RANK, characters[slot].attributes[key] + 1);
  } else if (action.type === 'refund_attribute' && characters.length) {
    const slot = actionSlot(action, current);
    const key = action.attribute;
    if (ATTRIBUTE_KEYS.includes(key)) characters[slot].attributes[key] = Math.max(ATTRIBUTE_MIN_RANK, characters[slot].attributes[key] - 1);
  } else if (action.type === 'set_attribute' && characters.length) {
    const slot = actionSlot(action, current);
    if (ATTRIBUTE_KEYS.includes(action.attribute) && isAttributeRank(action.rank)) characters[slot].attributes[action.attribute] = action.rank;
  } else if (action.type === 'equip_gear' && characters.length) {
    const slot = actionSlot(action, current);
    if (['weapon', 'armor', 'offhand'].includes(action.gearSlot) && isLegalEquipment(gameData, classFor(gameData, characters[slot].classId), action.gearSlot, action.itemId)) characters[slot].equipment[action.gearSlot] = action.itemId;
  } else if (action.type === 'unequip_gear' && characters.length) {
    const slot = actionSlot(action, current);
    if (['weapon', 'armor', 'offhand'].includes(action.gearSlot)) characters[slot].equipment[action.gearSlot] = null;
  } else if (action.type === 'add_protocol' && characters.length) {
    const slot = actionSlot(action, current);
    const protocol = { school: action.school, tier: action.tier };
    const exists = characters[slot].protocols.some((entry) => entry.school === protocol.school && entry.tier === protocol.tier);
    if (!exists && isLegalProtocol(gameData, classFor(gameData, characters[slot].classId), protocol)) characters[slot].protocols.push(protocol);
  } else if (action.type === 'remove_protocol' && characters.length) {
    const slot = actionSlot(action, current);
    characters[slot].protocols = characters[slot].protocols.filter((protocol) => !(protocol.school === action.school && protocol.tier === action.tier));
  } else if (action.type === 'load_blueprint') {
    const loaded = draftFromBlueprint(action.blueprint);
    if (!loaded) return { draft: current, result: { success: false, reason: 'invalid_blueprint' } };
    return { draft: loaded, result: { success: true } };
  } else if (action.type === 'reset_blueprint') {
    const loaded = draftFromBlueprint(current.originalBlueprint);
    return { draft: loaded ?? createCreationDraft(), result: { success: true } };
  } else if (action.type === 'reset') {
    return { draft: createCreationDraft(), result: { success: true } };
  } else if (action.type === 'finalize') {
    const finalized = finalizeCreationDraft(current, gameData, action.options ?? {});
    return { draft: finalized.success ? finalized.draft : current, result: finalized };
  }
  return { draft: { ...current, activeSlot, characters }, result: { success: true } };
}

function characterCost(character, gameData) {
  const equipment = Object.fromEntries(['weapon', 'armor', 'offhand'].map((slot) => [slot, equipmentEntry(gameData, slot, character.equipment[slot])?.creationCost ?? 0]));
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, isAttributeRank(character.attributes[key]) ? attributeCreationCost(character.attributes[key]) : 0]));
  const protocols = character.protocols.reduce((total, protocol) => total + (Number.isInteger(protocol.tier) ? protocol.tier * 2 : 0), 0);
  return { chassis: CHASSIS_POINT_COST, attributes, equipment, protocols, total: CHASSIS_POINT_COST + Object.values(attributes).reduce((sum, cost) => sum + cost, 0) + Object.values(equipment).reduce((sum, cost) => sum + cost, 0) + protocols };
}

function statsEquipment(character, gameData) {
  return Object.fromEntries(['weapon', 'armor', 'offhand'].map((slot) => {
    const id = character.equipment[slot];
    const item = equipmentEntry(gameData, slot, id);
    return [slot, item ? { id, baseType: id, ...item } : null];
  }));
}

function characterSummary(character, gameData) {
  const classData = classFor(gameData, character.classId);
  const costs = characterCost(character, gameData);
  const slotsUsed = character.protocols.reduce((total, protocol) => total + deckSlotCost(protocol.tier), 0);
  return {
    ...clone(character),
    classData: classData ? clone(classData) : null,
    costs,
    deck: { slotsUsed, capacity: classData ? deckSlotCapacity(classData.chargeBase) : 0 },
    projectedStats: classData ? deriveStats(character, classData, statsEquipment(character, gameData)) : null
  };
}

export function selectCreationState(draft, gameData = {}) {
  const normalized = normalizeDraft(draft);
  const characters = normalized.characters.map((character) => characterSummary(character, gameData));
  const pointsSpent = characters.reduce((total, character) => total + character.costs.total, 0);
  const pointsRemaining = CREATION_POINT_BUDGET - pointsSpent;
  const validation = validateCreationDraft(normalized, gameData);
  return { ...normalized, characters, pointsSpent, pointsRemaining, credits: Math.max(0, pointsRemaining) * 10, actionsPerRound: normalized.characters.length, validation };
}

export function validateCreationDraft(draft, gameData = {}) {
  const normalized = normalizeDraft(draft);
  const errors = [];
  if (normalized.characters.length < 1 || normalized.characters.length > 4) errors.push({ code: 'party_size', field: 'characters', value: normalized.characters.length });
  const usedSigils = new Set();
  for (let index = 0; index < normalized.characters.length; index++) {
    const character = normalized.characters[index];
    const field = `characters.${index}`;
    const classData = classFor(gameData, character.classId);
    if (!classData) errors.push({ code: 'class_required', field: `${field}.classId`, value: character.classId });
    const family = sigilFamily(gameData, classData);
    if (!Number.isInteger(character.sigil)) errors.push({ code: 'sigil_required', field: `${field}.sigil`, value: character.sigil });
    else {
      if (usedSigils.has(character.sigil)) errors.push({ code: 'duplicate_sigil', field: `${field}.sigil`, value: character.sigil });
      else usedSigils.add(character.sigil);
      if (classData && !family.includes(character.sigil)) errors.push({ code: 'sigil_family', field: `${field}.sigil`, value: character.sigil });
    }
    for (const key of ATTRIBUTE_KEYS) if (!isAttributeRank(character.attributes[key])) errors.push({ code: 'attribute_range', field: `${field}.attributes.${key}`, value: character.attributes[key] });
    for (const slot of ['weapon', 'armor', 'offhand']) {
      const id = character.equipment[slot];
      if (id !== null && !equipmentEntry(gameData, slot, id)) errors.push({ code: 'equipment_unknown', field: `${field}.equipment.${slot}`, value: id });
      else if (id !== null && !isLegalEquipment(gameData, classData, slot, id)) errors.push({ code: 'equipment_gate', field: `${field}.equipment.${slot}`, value: id });
    }
    let slotsUsed = 0;
    for (const protocol of character.protocols) {
      slotsUsed += deckSlotCost(protocol.tier);
      if (!protocolFor(gameData, protocol)) errors.push({ code: 'protocol_unknown', field: `${field}.protocols`, value: protocol });
      else if (!isLegalProtocol(gameData, classData, protocol)) errors.push({ code: 'protocol_gate', field: `${field}.protocols`, value: protocol });
    }
    const capacity = classData ? deckSlotCapacity(classData.chargeBase) : 0;
    if (slotsUsed > capacity) errors.push({ code: 'deck_capacity', field: `${field}.protocols`, value: slotsUsed, capacity });
  }
  const pointsSpent = normalized.characters.reduce((total, character) => total + characterCost(character, gameData).total, 0);
  if (pointsSpent > CREATION_POINT_BUDGET) errors.push({ code: 'point_budget', field: 'pointsSpent', value: pointsSpent, budget: CREATION_POINT_BUDGET });
  return { valid: errors.length === 0, errors, pointsSpent, pointsRemaining: CREATION_POINT_BUDGET - pointsSpent };
}

function materializeItem(characterId, slot, baseType, gameData) {
  if (baseType === null || (slot === 'armor' && baseType === 'none')) return null;
  const data = equipmentEntry(gameData, slot, baseType);
  if (!data) return null;
  return { id: `${characterId}-${slot}-${baseType}`, category: slot === 'armor' ? 'armor' : 'weapon', baseType, rarity: 'stock', affixes: [], corrupt: false, stats: clone(data), salvageValue: data.salvageValue ?? 0, junkTagged: false };
}

export function finalizeCreationDraft(draft, gameData = {}, options = {}) {
  const normalized = normalizeDraft(draft);
  if (normalized.finalized) return { success: false, reason: 'already_finalized' };
  const validation = validateCreationDraft(normalized, gameData);
  if (!validation.valid) return { success: false, reason: 'invalid_draft', validation };
  const party = normalized.characters.map((character, index) => {
    const classData = classFor(gameData, character.classId);
    const id = options.characterIds?.[index] ?? `${character.classId}-${index + 1}`;
    const equipment = Object.fromEntries(['weapon', 'armor', 'offhand'].map((slot) => [slot, materializeItem(id, slot, character.equipment[slot], gameData)]));
    const stats = deriveStats(character, classData, statsEquipment(character, gameData));
    return {
      id,
      classId: character.classId,
      sigilId: sigilIdFromCodepoint(character.sigil),
      attributes: { ...character.attributes },
      currentHP: stats.hpMax,
      currentCHARGE: stats.chargeMax,
      calibrationCount: 0,
      calibrationChoices: [],
      signatureTier: 1,
      equipment,
      protocolDeck: character.protocols.map((protocol) => ({ ...protocol })),
      conditions: []
    };
  });
  const blueprint = blueprintFromDraft(normalized, gameData, options.blueprintName ?? normalized.originalBlueprint?.name ?? 'last finalized');
  return { success: true, party, credits: validation.pointsRemaining * 10, pointsSpent: validation.pointsSpent, remainingPoints: validation.pointsRemaining, actionsPerRound: party.length, blueprint, draft: { ...normalized, finalized: true } };
}

export function createCreationModel(gameData, initial = null) {
  let draft = createCreationDraft(initial);
  return {
    get draft() { return draft; },
    dispatch(action) {
      const result = applyCreationAction(draft, action, gameData);
      draft = result.draft;
      return result;
    },
    select() { return selectCreationState(draft, gameData); },
    validate() { return validateCreationDraft(draft, gameData); },
    finalize(options = {}) {
      const result = finalizeCreationDraft(draft, gameData, options);
      if (result.success) draft = result.draft;
      return result;
    }
  };
}
