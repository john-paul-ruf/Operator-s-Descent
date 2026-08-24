import { deriveStats } from './attributes.js';
import { getCalibrationOptions, getSignatureTier } from './classes.js';
import { applyFloorEntryAffixes, resolveLoadout } from './equipment.js';
import { deserializeRunState } from '../state/run-state.js';
import { generateFloor } from '../floor/generator.js';
import { getDueEchoes } from './encounters.js';

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

export function beginFloorTransition(runState, data) {
  if (!runState || typeof runState.serialize !== 'function') return { error: 'invalid_run_state' };
  const nextDepth = runState.depth + 1;
  if (nextDepth > 255) return { error: 'depth_cap' };

  const calRequired = calibrationFloor(nextDepth);
  const offers = [];
  if (calRequired) {
    for (const character of runState.party) {
      if (character.currentHP <= 0) continue;
      const offer = getCalibrationOffer(runState, character.id, nextDepth, data);
      if (offer.valid) offers.push({ characterId: character.id, options: offer.options });
    }
    if (offers.length === 0) return { error: 'no_calibration_targets' };
    if (offers.length !== runState.party.filter(c => c.currentHP > 0).length) return { error: 'incomplete_offers' };
  }

  const token = {
    nextDepth,
    calibrationRequired: calRequired,
    offers,
    seed: runState.worldSeed,
    timestamp: runState.creationTimestamp,
    nonce: Math.random()
  };

  return { nextDepth, calibrationRequired: calRequired, offers, transitionToken: token };
}

export function completeFloorTransition(runState, transitionToken, selections, context = {}) {
  if (!runState || typeof runState.serialize !== 'function') return { error: 'invalid_run_state' };
  if (!transitionToken || transitionToken.nextDepth !== runState.depth + 1) return { error: 'stale_token' };
  if (transitionToken.seed !== runState.worldSeed) return { error: 'seed_mismatch' };

  const nextDepth = transitionToken.nextDepth;
  const calRequired = transitionToken.calibrationRequired;

  let nextState = cloneRunState(runState);
  if (!nextState) return { error: 'clone_failed' };

  if (calRequired) {
    const livingChars = nextState.party.filter(c => c.currentHP > 0);
    if (selections && Object.keys(selections).length > 0) {
      for (const character of livingChars) {
        const optionId = selections[character.id];
        if (!optionId) return { error: 'missing_selection', characterId: character.id };
        const offer = transitionToken.offers.find(o => o.characterId === character.id);
        if (!offer) return { error: 'no_offer', characterId: character.id };
        const option = offer.options.find(o => o.id === optionId);
        if (!option) return { error: 'invalid_selection', characterId: character.id };

        const effect = { type: option.type, ...(option.effect ?? {}) };
        const effectResult = applyEffect(character, effect);
        if (!effectResult.applied) return { error: 'effect_failed', characterId: character.id, reason: effectResult.reason };

        character.calibrationCount += 1;
        character.signatureTier = getSignatureTier(character.calibrationCount);
        character.calibrationChoices.push({ floor: nextDepth, optionId });
        if (!nextState.flags.calibrationFloorsReached.includes(nextDepth)) {
          nextState.flags.calibrationFloorsReached.push(nextDepth);
        }
      }
    }
  }

  nextState.depth = nextDepth;
  nextState.fogOfWar = new Uint8Array(80);
  nextState.openedContainers = 0n;
  nextState.defeatedEnemies = 0n;
  nextState.dangerClockProgress = 0;
  nextState.activeCombat = null;
  nextState.affixFloorLedger = { floor: nextDepth, reroll: [], floorEntry: [] };
  nextState.partyPosition = { x: 10, y: 0 };
  nextState._knownHostiles = new Set();
  nextState._knownContainers = new Set();
  nextState._knownDescent = false;
  nextState.stats.floorsDescended += 1;

  for (const character of nextState.party) {
    character.conditions = [];
    const classData = classFor(character, context.data ?? context);
    if (classData) {
      const loadout = resolveLoadout(character, context.data?.equipment, context.data?.affixes);
      const stats = deriveStats(character, classData, loadout || character.equipment);
      character.currentCHARGE = Math.min(stats.chargeMax, character.currentCHARGE + stats.chargeRegen);
    }
  }

  if (context.data?.affixes) {
    const floorEntry = applyFloorEntryAffixes(nextState, context.data.affixes);
    if (floorEntry.success) nextState = floorEntry.runState;
  }

  const themesData = context.themesData ?? context.data?.themes;
  if (!themesData) return { error: 'missing_themes_data' };

  const themesSeen = [...nextState.themesSeen];
  const dueEchoes = getDueEchoes(nextState, nextDepth);
  const echoSpawns = dueEchoes.map(echo => ({
    character: echo.character,
    equipment: echo.character?.equipment || null
  }));

  let floor;
  try {
    floor = generateFloor(nextState.worldSeed, nextDepth, {
      themesSeen,
      echoSpawns
    }, themesData);
  } catch (e) {
    return { error: 'generation_failed', reason: e.message };
  }

  if (!floor) return { error: 'generation_failed' };

  nextState.floorSubSeed = floor.floorSubSeed ?? 0;
  nextState.extensions = { ...(nextState.extensions || {}), floorThemeId: floor.themeId };

  if (floor.themeId && !nextState.themesSeen.has(floor.themeId)) {
    nextState.themesSeen.add(floor.themeId);
  }

  nextState.partyPosition = { ...floor.entryPoint };

  const events = [];
  if (calRequired) events.push({ type: 'calibration', floor: nextDepth });
  if (floor.threshold) events.push({ type: 'threshold', floor: nextDepth });
  if (dueEchoes.length > 0) events.push({ type: 'echoes', count: dueEchoes.length });

  return {
    runState: nextState,
    floor,
    events,
    autosaveReason: 'floor-transition'
  };
}
