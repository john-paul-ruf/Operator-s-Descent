import { deriveStats } from './attributes.js';
import { getCalibrationOptions, getSignatureTier } from './classes.js';
import { deserializeRunState } from '../state/run-state.js';

const ATTRIBUTE_IDS = new Set(['mgt', 'fin', 'vit', 'res', 'foc', 'sig']);

function classesFrom(data) {
  return data?.classes?.classes ?? data?.classes ?? [];
}

function classFor(character, data) {
  return classesFrom(data).find(entry => entry.id === character?.classId) ?? null;
}

function calibrationFloor(floorNumber) {
  return Number.isInteger(floorNumber) && floorNumber > 0 && floorNumber % 3 === 0;
}

function cloneRunState(runState) {
  return typeof runState?.serialize === 'function' ? deserializeRunState(runState.serialize()) : null;
}

function extensionValues(character) {
  return { ...(character.extensions ?? {}) };
}

function applyEffect(character, effect) {
  if (!effect || typeof effect !== 'object') return { applied: false, reason: 'invalid_effect' };
  if (effect.type === 'attribute') {
    const attribute = effect.attribute;
    if (!ATTRIBUTE_IDS.has(attribute) || !Number.isInteger(effect.amount) || effect.amount < 1) return { applied: false, reason: 'invalid_effect' };
    character.attributes[attribute] = Math.min(10, character.attributes[attribute] + effect.amount);
    return { applied: true };
  }
  const extensions = extensionValues(character);
  if (effect.type === 'deck_slot') {
    if (!Number.isInteger(effect.amount) || effect.amount < 1) return { applied: false, reason: 'invalid_effect' };
    extensions.deckSlotBonus = Math.min(16, (extensions.deckSlotBonus ?? 0) + effect.amount);
  } else if (effect.type === 'proficiency') {
    if (typeof effect.equipment !== 'string' || effect.equipment.length === 0) return { applied: false, reason: 'invalid_effect' };
    extensions.proficiencies = [...new Set([...(extensions.proficiencies ?? []), effect.equipment])].slice(0, 16);
  } else if (effect.type !== 'hp') {
    return { applied: false, reason: 'invalid_effect' };
  }
  character.extensions = extensions;
  return { applied: true };
}

export function getCalibrationOffer(runState, characterId, floorNumber, data) {
  if (!calibrationFloor(floorNumber)) return { valid: false, reason: 'not_calibration_floor', options: [] };
  const character = runState?.party?.find(entry => entry.id === characterId);
  const classData = classFor(character, data);
  if (!character || !classData) return { valid: false, reason: 'unknown_character', options: [] };
  if (character.calibrationChoices?.some(choice => choice.floor === floorNumber)) return { valid: false, reason: 'already_selected', options: [] };
  const options = getCalibrationOptions(classData, runState.worldSeed, characterId, floorNumber);
  return { valid: options.length > 0, ...(options.length > 0 ? {} : { reason: 'no_options' }), characterId, floorNumber, options: options.map(option => ({ ...option, effect: { ...(option.effect ?? {}) } })) };
}

export function validateCalibrationSelection(offer, optionId) {
  if (!offer?.valid || typeof optionId !== 'string') return { valid: false, reason: 'invalid_offer' };
  const option = offer.options?.find(entry => entry.id === optionId);
  return option ? { valid: true, option } : { valid: false, reason: 'invalid_option' };
}

export function applyCalibration(runState, characterId, optionId, data) {
  const floorNumber = runState?.depth;
  const offer = getCalibrationOffer(runState, characterId, floorNumber, data);
  const selection = validateCalibrationSelection(offer, optionId);
  if (!selection.valid) return { applied: false, reason: selection.reason === 'invalid_offer' ? offer.reason : selection.reason, runState };
  const nextState = cloneRunState(runState);
  const character = nextState?.party.find(entry => entry.id === characterId);
  const classData = classFor(character, data);
  if (!character || !classData || character.calibrationCount >= 16) return { applied: false, reason: 'calibration_limit', runState };
  const hpBefore = deriveStats(character, classData, character.equipment).hpMax;
  const effect = { type: selection.option.type, ...(selection.option.effect ?? {}) };
  const effectResult = applyEffect(character, effect);
  if (!effectResult.applied) return { applied: false, reason: effectResult.reason, runState };
  character.calibrationCount += 1;
  character.signatureTier = getSignatureTier(character.calibrationCount);
  character.calibrationChoices.push({ floor: floorNumber, optionId });
  if (!nextState.flags.calibrationFloorsReached.includes(floorNumber)) nextState.flags.calibrationFloorsReached.push(floorNumber);
  const hpMax = deriveStats(character, classData, character.equipment).hpMax;
  return { applied: true, runState: nextState, character, option: selection.option, hpMaxBefore: hpBefore, hpMax, hpMaxIncrease: hpMax - hpBefore };
}
