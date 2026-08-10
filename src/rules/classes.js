import { hash } from '../core/hash.js';

function itemId(itemRef) {
  return typeof itemRef === 'string' ? itemRef : itemRef?.baseType ?? itemRef?.id;
}

function hasProficiency(proficiencies, ...ids) {
  return Array.isArray(proficiencies) && ids.some(id => proficiencies.includes(id));
}

function calibrationPool(classData, floorNumber) {
  const options = classData?.calibrationOptions ?? {};
  return options[String(floorNumber)] ?? options.default ?? [];
}

function optionOrder(pool, seed) {
  return pool
    .map((option, index) => ({ option, index, order: hash(seed, option.id ?? index) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map(({ option }) => option);
}

export function getSignatureTier(calibrationCount) {
  if (calibrationCount >= 4) return 3;
  if (calibrationCount >= 2) return 2;
  return 1;
}

export function getSignature(classData, calibrationCount) {
  return classData?.signature?.tiers?.[getSignatureTier(calibrationCount) - 1];
}

export function getSignatureCapabilities(character, classData) {
  const tier = getSignatureTier(character?.calibrationCount ?? 0);
  const effects = (classData?.signature?.effects ?? [])
    .filter(effect => Number.isInteger(effect.tier) && effect.tier <= tier)
    .map(effect => ({ ...effect, parameters: { ...(effect.parameters ?? {}) }, ...(effect.usage ? { usage: { ...effect.usage } } : {}) }));
  return { signatureId: classData?.signature?.id ?? null, tier, effects };
}

export function applySignatureModifier(hook, context = {}, capabilities = {}) {
  const usageLedger = { ...(context.usageLedger ?? {}) };
  const parameters = { ...(context.signatureParameters ?? {}) };
  const effects = [];
  for (const effect of capabilities.effects ?? []) {
    if (effect.hook !== hook || (context.effectId && effect.id !== context.effectId)) continue;
    const key = effect.usage ? `${capabilities.signatureId}:${effect.id}` : null;
    const used = key ? usageLedger[key] ?? 0 : 0;
    if (effect.usage && used >= effect.usage.limit) continue;
    if (context.consume && key) usageLedger[key] = used + 1;
    Object.assign(parameters, effect.parameters);
    effects.push({ id: effect.id, parameters: { ...(effect.parameters ?? {}) }, ...(effect.usage ? { usage: { ...effect.usage, used: context.consume ? used + 1 : used } } : {}) });
  }
  return { context: { ...context, signatureParameters: parameters, usageLedger }, effects, applied: effects.length > 0 };
}

export function canEquip(classData, itemRef, proficiencies = []) {
  const id = itemId(itemRef);
  if (typeof id !== 'string') return false;
  const category = itemRef?.category ?? itemRef?.slot;
  const gates = classData?.equipmentGates ?? {};
  const allowed = category === 'armor' ? gates.armor : category === 'weapon' || category === 'offhand' ? gates.weapons : [...(gates.weapons ?? []), ...(gates.armor ?? [])];
  return allowed?.includes(id) || hasProficiency(proficiencies, id, `${category}:${id}`, `equipment:${id}`);
}

export function canPrepareProtocol(classData, protocolRef, proficiencies = []) {
  const school = typeof protocolRef === 'string' ? protocolRef : protocolRef?.school;
  const tier = typeof protocolRef === 'object' ? protocolRef?.tier : 1;
  if (typeof school !== 'string' || !Number.isInteger(tier) || tier < 1 || tier > 5) return false;
  const gate = classData?.protocolGates ?? {};
  return (gate.schools?.includes(school) && tier <= gate.maxTier) || hasProficiency(proficiencies, `protocol:${school}`, `protocol:${school}:${tier}`);
}

export function canEquipWeapon(classData, weaponId) {
  return canEquip(classData, { baseType: weaponId, category: 'weapon' });
}

export function canEquipArmor(classData, armorId) {
  return canEquip(classData, { baseType: armorId, category: 'armor' });
}

export function canCastSchool(classData, schoolId) {
  return canPrepareProtocol(classData, { school: schoolId, tier: 1 });
}

export function maxProtocolTier(classData) {
  return classData?.protocolGates?.maxTier ?? 0;
}

export function autoUpgradeSignature(calibrationCount) {
  return calibrationCount === 2 || calibrationCount === 4;
}

export function getCalibrationOptions(classData, worldSeed, characterId, floorNumber) {
  const pool = calibrationPool(classData, floorNumber);
  if (!Array.isArray(pool) || pool.length === 0) return [];
  return optionOrder(pool, hash(worldSeed, characterId, floorNumber)).slice(0, 3);
}

export function primaryAttributeCostReduction(classData, attributeId) {
  return classData?.primaryAttribute === attributeId ? 1 : 0;
}
