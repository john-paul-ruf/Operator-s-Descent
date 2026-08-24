import { describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { getCalibrationOffer, validateCalibrationSelection, applyCalibration, beginFloorTransition, completeFloorTransition } from '../../src/rules/progression.js';
import { loadData } from '../helpers/data.js';

const data = {
  classes: loadData('classes'),
  themes: loadData('themes'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes')
};

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

describe('beginFloorTransition', () => {
  it('returns nextDepth and calibrationRequired for normal floor', () => {
    const state = run(42, 1);
    const result = beginFloorTransition(state, data);
    expect(result.nextDepth).toBe(2);
    expect(result.calibrationRequired).toBe(false);
    expect(result.offers).toEqual([]);
    expect(result.transitionToken).toBeDefined();
  });

  it('returns calibrationRequired at every 3rd floor', () => {
    const state = run(42, 2);
    const result = beginFloorTransition(state, data);
    expect(result.nextDepth).toBe(3);
    expect(result.calibrationRequired).toBe(true);
    expect(result.offers.length).toBe(1);
    expect(result.offers[0].characterId).toBe('char_a');
    expect(result.offers[0].options.length).toBe(3);
  });

  it('returns offers for all living characters', () => {
    const state = run(42, 2, [character('char_a'), character('char_b', 'ghost')]);
    const result = beginFloorTransition(state, data);
    expect(result.calibrationRequired).toBe(true);
    expect(result.offers.length).toBe(2);
  });

  it('skips dead characters in offers', () => {
    const deadChar = { ...character('char_b', 'ghost'), currentHP: 0 };
    const state = run(42, 2, [character('char_a'), deadChar]);
    const result = beginFloorTransition(state, data);
    expect(result.offers.length).toBe(1);
    expect(result.offers[0].characterId).toBe('char_a');
  });

  it('returns error at depth cap', () => {
    const state = run(42, 255);
    const result = beginFloorTransition(state, data);
    expect(result.error).toBe('depth_cap');
  });

  it('returns error for invalid runState', () => {
    expect(beginFloorTransition(null, data).error).toBe('invalid_run_state');
  });
});

describe('completeFloorTransition — non-calibration', () => {
  it('increments depth, resets diff, regenerates CHARGE, retains HP, clears conditions', () => {
    const state = run(42, 1);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.error).toBeUndefined();
    expect(result.runState.depth).toBe(2);
    expect(result.floor).toBeDefined();
    expect(result.floor.cells).toBeDefined();
    expect(result.runState.fogOfWar.every(b => b === 0)).toBe(true);
    expect(result.runState.openedContainers).toBe(0n);
    expect(result.runState.defeatedEnemies).toBe(0n);
    expect(result.runState.dangerClockProgress).toBe(0);
    expect(result.runState.activeCombat).toBeNull();
    expect(result.runState.partyPosition).toEqual(result.floor.entryPoint);
    expect(result.autosaveReason).toBe('floor-transition');

    const char = result.runState.party[0];
    expect(char.currentCHARGE).toBeGreaterThan(state.party[0].currentCHARGE);
    expect(char.currentHP).toBe(state.party[0].currentHP);
  });

  it('clears conditions on floor transition', () => {
    const state = run(42, 1);
    state.party[0].conditions = [{ id: 'burning', duration: 3 }];
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.runState.party[0].conditions).toEqual([]);
  });

  it('does not heal HP on transition', () => {
    const injured = { ...character('char_a'), currentHP: 5 };
    const state = run(42, 1, [injured]);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.runState.party[0].currentHP).toBe(5);
  });

  it('CHARGE regen = floor(RES/3), capped at chargeMax', () => {
    const char = { ...character('char_a'), attributes: { ...character('char_a').attributes, res: 7 } };
    const state = run(42, 1, [char]);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    const expectedRegen = Math.floor(7 / 3);
    expect(result.runState.party[0].currentCHARGE).toBe(char.currentCHARGE + expectedRegen);
  });

  it('Resonant armor adds its +1 CHARGE regen bonus from deriveStats on descent', () => {
    const armor = { id: 'resonant-armor', category: 'armor', baseType: 'light', rarity: 'custom', affixes: ['resonant'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
    const char = { ...character('char_a'), attributes: { ...character('char_a').attributes, res: 7 }, equipment: { weapon: null, armor, offhand: null } };
    const state = run(42, 1, [char]);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    const expectedRegen = Math.floor(7 / 3) + 1;
    expect(result.runState.party[0].currentCHARGE).toBe(char.currentCHARGE + expectedRegen);
  });

  it('Overcharged armor raises the CHARGE-max clamp so recovery lands higher than the unaffixed clamp', () => {
    const armor = { id: 'overcharged-armor', category: 'armor', baseType: 'light', rarity: 'custom', affixes: ['overcharged'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
    const attributes = { mgt: 5, fin: 5, vit: 5, res: 9, foc: 5, sig: 5 };
    const unaffixed = { ...character('char_a'), attributes, currentCHARGE: 26 };
    const affixed = { ...character('char_a'), attributes, currentCHARGE: 26, equipment: { weapon: null, armor, offhand: null } };

    const stateA = run(42, 1, [unaffixed]);
    const resultA = completeFloorTransition(stateA, beginFloorTransition(stateA, data).transitionToken, {}, { data, themesData: data.themes });
    const stateB = run(42, 1, [affixed]);
    const resultB = completeFloorTransition(stateB, beginFloorTransition(stateB, data).transitionToken, {}, { data, themesData: data.themes });

    expect(resultA.runState.party[0].currentCHARGE).toBe(27);
    expect(resultB.runState.party[0].currentCHARGE).toBe(29);
  });

  it('degrades to unaffixed regen when equipment/affixes data is unavailable (test tolerance)', () => {
    const barebonesData = { classes: data.classes, themes: data.themes };
    const char = { ...character('char_a'), attributes: { ...character('char_a').attributes, res: 7 } };
    const state = run(42, 1, [char]);
    const begin = beginFloorTransition(state, barebonesData);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data: barebonesData, themesData: barebonesData.themes });
    expect(result.error).toBeUndefined();
    const expectedRegen = Math.floor(7 / 3);
    expect(result.runState.party[0].currentCHARGE).toBe(char.currentCHARGE + expectedRegen);
  });

  it('retains corruption, credits, scrap, inventory', () => {
    const state = run(42, 1);
    state.corruption = 0.15;
    state.credits = 500;
    state.scrapCounter = 42;
    state.inventory = [{ id: 'item1', category: 'consumable', baseType: 'stim', affixes: [], stats: {}, salvageValue: 5, junkTagged: false, count: 1 }];
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.runState.corruption).toBe(0.15);
    expect(result.runState.credits).toBe(500);
    expect(result.runState.scrapCounter).toBe(42);
    expect(result.runState.inventory).toHaveLength(1);
  });

  it('increments floorsDescended stat', () => {
    const state = run(42, 1);
    const before = state.stats.floorsDescended;
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.runState.stats.floorsDescended).toBe(before + 1);
  });

  it('adds theme to themesSeen after generation', () => {
    const state = run(42, 1);
    expect(state.themesSeen.size).toBe(0);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.runState.themesSeen.size).toBeGreaterThan(0);
    expect(result.runState.themesSeen.has(result.floor.themeId)).toBe(true);
  });

  it('sets partyPosition to floor entryPoint', () => {
    const state = run(42, 1);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.runState.partyPosition).toEqual(result.floor.entryPoint);
  });

  it('stores floorSubSeed from generated floor', () => {
    const state = run(42, 1);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.runState.floorSubSeed).toBe(result.floor.floorSubSeed);
  });

  it('original state unchanged (immutable)', () => {
    const state = run(42, 1);
    const before = state.serialize();
    const begin = beginFloorTransition(state, data);
    completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(state.serialize()).toEqual(before);
  });
});

describe('completeFloorTransition — Shielding floor entry', () => {
  it('grants SHIELDED (duration 3) and claims the ledger for a Shielding-equipped member; unaffixed member gets nothing', () => {
    const armor = { id: 'shielding-armor', category: 'armor', baseType: 'light', rarity: 'custom', affixes: ['shielding'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
    const shielded = { ...character('char_a'), equipment: { weapon: null, armor, offhand: null } };
    const plain = character('char_b', 'ghost');
    const state = run(42, 1, [shielded, plain]);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    const partyA = result.runState.party.find(c => c.id === 'char_a');
    const partyB = result.runState.party.find(c => c.id === 'char_b');
    expect(partyA.conditions).toEqual([{ conditionId: 'shielded', duration: 3 }]);
    expect(partyB.conditions).toEqual([]);
    expect(result.runState.affixFloorLedger.floorEntry).toEqual([armor.id]);
  });

  it('re-grants Shielding on a second descent since the per-floor ledger resets', () => {
    const armor = { id: 'shielding-armor', category: 'armor', baseType: 'light', rarity: 'custom', affixes: ['shielding'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
    const shielded = { ...character('char_a'), equipment: { weapon: null, armor, offhand: null } };
    const state = run(42, 1, [shielded]);
    const begin1 = beginFloorTransition(state, data);
    const result1 = completeFloorTransition(state, begin1.transitionToken, {}, { data, themesData: data.themes });
    expect(result1.runState.affixFloorLedger.floorEntry).toEqual([armor.id]);

    const begin2 = beginFloorTransition(result1.runState, data);
    const result2 = completeFloorTransition(result1.runState, begin2.transitionToken, {}, { data, themesData: data.themes });
    expect(result2.runState.party[0].conditions).toEqual([{ conditionId: 'shielded', duration: 3 }]);
    expect(result2.runState.affixFloorLedger.floorEntry).toEqual([armor.id]);
  });

  it('does not duplicate SHIELDED when two Shielding items on the same member both claim floor entry', () => {
    const armor = { id: 'shielding-armor', category: 'armor', baseType: 'light', rarity: 'custom', affixes: ['shielding'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
    const weapon = { id: 'shielding-sidearm', category: 'weapon', baseType: 'sidearm', rarity: 'custom', affixes: ['shielding'], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
    const doubleShielded = { ...character('char_a'), equipment: { weapon, armor, offhand: null } };
    const state = run(42, 1, [doubleShielded]);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.runState.party[0].conditions).toEqual([{ conditionId: 'shielded', duration: 3 }]);
    expect([...result.runState.affixFloorLedger.floorEntry].sort()).toEqual([armor.id, weapon.id].sort());
  });
});

describe('completeFloorTransition — calibration', () => {
  it('applies calibration selections for all living characters', () => {
    const state = run(42, 2, [character('char_a'), character('char_b', 'ghost')]);
    const begin = beginFloorTransition(state, data);
    expect(begin.calibrationRequired).toBe(true);

    const selections = {};
    for (const offer of begin.offers) {
      selections[offer.characterId] = offer.options[0].id;
    }
    const result = completeFloorTransition(state, begin.transitionToken, selections, { data, themesData: data.themes });
    expect(result.error).toBeUndefined();
    expect(result.runState.depth).toBe(3);
    expect(result.runState.party[0].calibrationCount).toBe(1);
    expect(result.runState.party[1].calibrationCount).toBe(1);
    expect(result.runState.party[0].calibrationChoices).toContainEqual({ floor: 3, optionId: selections.char_a });
    expect(result.runState.party[1].calibrationChoices).toContainEqual({ floor: 3, optionId: selections.char_b });
    expect(result.runState.flags.calibrationFloorsReached).toContain(3);
    expect(result.events.some(e => e.type === 'calibration')).toBe(true);
  });

  it('allows transition without selections (no calibration applied)', () => {
    const state = run(42, 2);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.error).toBeUndefined();
    expect(result.runState.depth).toBe(3);
    expect(result.runState.party[0].calibrationCount).toBe(0);
  });
});

describe('completeFloorTransition — token security', () => {
  it('rejects stale token (wrong depth)', () => {
    const state = run(42, 1);
    const begin = beginFloorTransition(state, data);
    state.depth = 5;
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.error).toBe('stale_token');
  });

  it('rejects seed mismatch', () => {
    const state = run(42, 1);
    const begin = beginFloorTransition(state, data);
    const fakeState = run(99, 1);
    const result = completeFloorTransition(fakeState, begin.transitionToken, {}, { data, themesData: data.themes });
    expect(result.error).toBe('seed_mismatch');
  });

  it('rejects null token', () => {
    const state = run(42, 1);
    const result = completeFloorTransition(state, null, {}, { data, themesData: data.themes });
    expect(result.error).toBe('stale_token');
  });
});

describe('completeFloorTransition — determinism', () => {
  it('same seed produces identical floor on repeat transition', () => {
    const stateA = run(42, 1);
    const beginA = beginFloorTransition(stateA, data);
    const resultA = completeFloorTransition(stateA, beginA.transitionToken, {}, { data, themesData: data.themes });

    const stateB = run(42, 1);
    const beginB = beginFloorTransition(stateB, data);
    const resultB = completeFloorTransition(stateB, beginB.transitionToken, {}, { data, themesData: data.themes });

    expect(resultA.floor).toEqual(resultB.floor);
    expect(resultA.runState.depth).toBe(resultB.runState.depth);
    expect(resultA.runState.partyPosition).toEqual(resultB.runState.partyPosition);
  });

  it('save/resume mid-transition produces identical floor', async () => {
    const { deserializeRunState } = await import('../../src/state/run-state.js');
    const state = run(42, 1);
    const begin = beginFloorTransition(state, data);
    const result = completeFloorTransition(state, begin.transitionToken, {}, { data, themesData: data.themes });
    const encoded = result.runState.serialize();
    const restored = deserializeRunState(encoded);

    const begin2 = beginFloorTransition(restored, data);
    const result2 = completeFloorTransition(restored, begin2.transitionToken, {}, { data, themesData: data.themes });

    const stateC = run(42, 1);
    const beginC = beginFloorTransition(stateC, data);
    const resultC = completeFloorTransition(stateC, beginC.transitionToken, {}, { data, themesData: data.themes });
    const encodedC = resultC.runState.serialize();
    const restoredC = deserializeRunState(encodedC);
    const beginC2 = beginFloorTransition(restoredC, data);
    const resultC2 = completeFloorTransition(restoredC, beginC2.transitionToken, {}, { data, themesData: data.themes });

    expect(result2.floor).toEqual(resultC2.floor);
    expect(result2.runState.partyPosition).toEqual(resultC2.runState.partyPosition);
  });
});
