import { describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { getCalibrationOffer, validateCalibrationSelection, applyCalibration } from '../../src/rules/progression.js';
import { loadData } from '../helpers/data.js';

const data = { classes: loadData('classes') };

function character(id, classId = 'breacher') {
  return {
    id,
    classId,
    sigilId: 'pua-e000',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    currentHP: 18,
    currentCHARGE: 4,
    calibrationCount: 0,
    calibrationChoices: [],
    signatureTier: 1,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [],
    conditions: []
  };
}

function run(seed = 42, depth = 3, party = [character('char_a')]) {
  return createRunState(seed, party, { depth, creationTimestamp: 1 });
}

describe('calibration offers', () => {
  it('returns three unique deterministic class options on threshold floors', () => {
    const state = run();
    const first = getCalibrationOffer(state, 'char_a', 3, data);
    const second = getCalibrationOffer(state, 'char_a', 3, data);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ valid: true, characterId: 'char_a', floorNumber: 3 });
    expect(first.options).toHaveLength(3);
    expect(new Set(first.options.map(option => option.id)).size).toBe(3);
  });

  it('rejects non-threshold, unknown-character, and unlisted selections', () => {
    expect(getCalibrationOffer(run(), 'char_a', 4, data)).toMatchObject({ valid: false, reason: 'not_calibration_floor' });
    expect(getCalibrationOffer(run(), 'missing', 3, data)).toMatchObject({ valid: false, reason: 'unknown_character' });
    expect(validateCalibrationSelection(getCalibrationOffer(run(), 'char_a', 3, data), 'missing')).toEqual({ valid: false, reason: 'invalid_option' });
  });
});

describe('applyCalibration', () => {
  it('applies an attribute choice as an immutable state transition with automatic HP and signature growth', () => {
    const state = run();
    const offer = getCalibrationOffer(state, 'char_a', 3, data);
    const option = offer.options.find(entry => entry.type === 'attribute');
    const before = state.serialize();
    const result = applyCalibration(state, 'char_a', option.id, data);
    expect(result.applied).toBe(true);
    expect(state.serialize()).toEqual(before);
    expect(result.runState).not.toBe(state);
    expect(result.character.attributes[option.effect.attribute]).toBe(6);
    expect(result.character.currentHP).toBe(18);
    expect(result.hpMaxIncrease).toBe(8 + (option.effect.attribute === 'vit' ? 4 : 0));
    expect(result.character.calibrationCount).toBe(1);
    expect(result.character.signatureTier).toBe(1);
    expect(result.character.calibrationChoices).toEqual([{ floor: 3, optionId: option.id }]);
    expect(result.runState.flags.calibrationFloorsReached).toEqual([3]);
  });

  it('persists deck slots and earned equipment proficiencies', () => {
    for (const expectedType of ['deck_slot', 'proficiency']) {
      let selected;
      for (let seed = 0; seed < 100 && !selected; seed++) {
        const state = run(seed);
        const option = getCalibrationOffer(state, 'char_a', 3, data).options.find(entry => entry.type === expectedType);
        if (option) selected = { state, option };
      }
      const result = applyCalibration(selected.state, 'char_a', selected.option.id, data);
      expect(result.applied).toBe(true);
      if (expectedType === 'deck_slot') expect(result.character.extensions.deckSlotBonus).toBe(1);
      else expect(result.character.extensions.proficiencies).toContain(selected.option.effect.equipment);
    }
  });

  it('upgrades signature tiers automatically at calibrations two and four', () => {
    for (const [count, tier] of [[1, 2], [3, 3]]) {
      const history = Array.from({ length: count }, (_, index) => ({ floor: (index + 1) * 3, optionId: `prior_${index}` }));
      const state = run(42, (count + 1) * 3, [{ ...character('char_a'), calibrationCount: count, calibrationChoices: history, signatureTier: 1 }]);
      const option = getCalibrationOffer(state, 'char_a', state.depth, data).options[0];
      expect(applyCalibration(state, 'char_a', option.id, data).character.signatureTier).toBe(tier);
    }
  });

  it('allows each party member one selection at a reached floor and rejects a duplicate character selection', () => {
    const state = run(42, 3, [character('char_a'), character('char_b', 'ghost')]);
    const first = getCalibrationOffer(state, 'char_a', 3, data);
    const afterFirst = applyCalibration(state, 'char_a', first.options[0].id, data);
    const second = getCalibrationOffer(afterFirst.runState, 'char_b', 3, data);
    expect(second.valid).toBe(true);
    const duplicate = applyCalibration(afterFirst.runState, 'char_a', first.options[0].id, data);
    expect(duplicate).toMatchObject({ applied: false, reason: 'already_selected', runState: afterFirst.runState });
  });
});
