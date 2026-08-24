import { describe, expect, it } from 'vitest';
import { blueprintFromDraft, draftFromBlueprint } from '../../src/state/party-configs.js';
import { applyCreationAction, createCreationDraft, createCreationModel, finalizeCreationDraft, getQuickStartParties, reduceCreationDraft, selectCreationState, validateCreationDraft } from '../../src/ui/creation-model.js';
import { loadData } from '../helpers/data.js';

const gameData = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
  protocols: loadData('protocols'),
  sigils: loadData('sigils')
};

function character(overrides = {}) {
  return {
    classId: 'breacher',
    sigil: 0xe000,
    attributes: { mgt: 3, fin: 3, vit: 3, res: 3, foc: 3, sig: 3 },
    equipment: { weapon: null, armor: null, offhand: null },
    protocols: [],
    ...overrides
  };
}

function draft(overrides = {}) {
  return { activeSlot: 0, finalized: false, originalBlueprint: null, characters: [character()], ...overrides };
}

describe('creation draft reducer and selectors', () => {
  it('starts blank, adds a chassis-only character, and computes the live economy', () => {
    const empty = createCreationDraft();
    expect(validateCreationDraft(empty, gameData)).toMatchObject({ valid: false, pointsSpent: 0, pointsRemaining: 80 });

    let next = reduceCreationDraft(empty, { type: 'add_character' }, gameData);
    next = reduceCreationDraft(next, { type: 'set_class', classId: 'breacher' }, gameData);
    next = reduceCreationDraft(next, { type: 'set_sigil', sigil: 0xe000 }, gameData);

    const selected = selectCreationState(next, gameData);
    expect(selected.validation.valid).toBe(true);
    expect(selected).toMatchObject({ pointsSpent: 5, pointsRemaining: 75, credits: 750, actionsPerRound: 1 });
    expect(selected.characters[0].projectedStats).toMatchObject({ hpMax: 28, chargeMax: 9, chargeRegen: 1 });
  });

  it('charges exact attribute, gear, and protocol costs from one immutable 80-point pool', () => {
    let next = draft();
    next = reduceCreationDraft(next, { type: 'set_attribute', attribute: 'mgt', rank: 8 }, gameData);
    next = reduceCreationDraft(next, { type: 'equip_gear', gearSlot: 'weapon', itemId: 'heavy_melee' }, gameData);
    next = reduceCreationDraft(next, { type: 'equip_gear', gearSlot: 'armor', itemId: 'heavy' }, gameData);
    next = reduceCreationDraft(next, { type: 'equip_gear', gearSlot: 'offhand', itemId: 'shield' }, gameData);
    next = reduceCreationDraft(next, { type: 'add_protocol', school: 'disrupt', tier: 2 }, gameData);

    const selected = selectCreationState(next, gameData);
    expect(selected.pointsSpent).toBe(24);
    expect(selected.pointsRemaining).toBe(56);
    expect(selected.credits).toBe(560);
    expect(selected.characters[0].costs).toMatchObject({ chassis: 5, equipment: { weapon: 2, armor: 3, offhand: 3 }, protocols: 4 });
    expect(selected.characters[0].costs.attributes.mgt).toBe(7);
    expect(selected.characters[0].deck).toEqual({ slotsUsed: 2, capacity: 3 });
  });

  it('reconciles class changes by dropping invalid sigils, gear, and protocols predictably', () => {
    const ghost = draft({ characters: [character({ classId: 'ghost', sigil: 0xe008, equipment: { weapon: 'sniper', armor: 'light', offhand: null }, protocols: [{ school: 'scry', tier: 5 }] })] });
    const next = reduceCreationDraft(ghost, { type: 'set_class', classId: 'breacher' }, gameData);
    expect(next.characters[0]).toMatchObject({ classId: 'breacher', sigil: null, equipment: { weapon: null, armor: 'light', offhand: null }, protocols: [] });
  });

  it('loads a blueprint non-destructively and can reset to the original loaded blueprint', () => {
    const blueprint = {
      name: 'stored',
      version: 1,
      credits: 750,
      pointsSpent: 5,
      characters: [{ classId: 'ghost', sigilCodepoint: 0xe008, attributes: character().attributes, equipment: { weapon: 'sniper', armor: 'light', offhand: null }, protocols: [] }]
    };
    const loaded = applyCreationAction(createCreationDraft(), { type: 'load_blueprint', blueprint }, gameData).draft;
    const changed = reduceCreationDraft(loaded, { type: 'set_class', classId: 'breacher' }, gameData);
    expect(blueprint.characters[0]).toMatchObject({ classId: 'ghost', sigilCodepoint: 0xe008, equipment: { weapon: 'sniper' } });
    const reset = reduceCreationDraft(changed, { type: 'reset_blueprint' }, gameData);
    expect(reset.characters[0]).toMatchObject({ classId: 'ghost', sigil: 0xe008, equipment: { weapon: 'sniper', armor: 'light' } });
  });
});

describe('creation validation', () => {
  it('flags missing class/sigil, duplicate sigils, family violations, and class gates', () => {
    const invalid = draft({ characters: [
      character({ classId: 'breacher', sigil: 0xe008, equipment: { weapon: 'sniper', armor: null, offhand: null }, protocols: [{ school: 'ward', tier: 1 }] }),
      character({ classId: 'ghost', sigil: 0xe008 })
    ] });
    expect(validateCreationDraft(invalid, gameData).errors).toEqual(expect.arrayContaining([
      { code: 'sigil_family', field: 'characters.0.sigil', value: 0xe008 },
      { code: 'equipment_gate', field: 'characters.0.equipment.weapon', value: 'sniper' },
      { code: 'protocol_gate', field: 'characters.0.protocols', value: { school: 'ward', tier: 1 } },
      { code: 'duplicate_sigil', field: 'characters.1.sigil', value: 0xe008 }
    ]));
  });

  it('flags attribute ranges, deck capacity, and total spend above 80', () => {
    const invalid = draft({ characters: [character({
      classId: 'compiler',
      sigil: 0xe010,
      attributes: { mgt: 10, fin: 10, vit: 10, res: 10, foc: 10, sig: 99 },
      protocols: [{ school: 'disrupt', tier: 3 }, { school: 'ward', tier: 3 }, { school: 'scry', tier: 1 }]
    })] });
    const result = validateCreationDraft(invalid, gameData);
    expect(result.errors).toEqual(expect.arrayContaining([
      { code: 'attribute_range', field: 'characters.0.attributes.sig', value: 99 },
      { code: 'deck_capacity', field: 'characters.0.protocols', value: 7, capacity: 6 }
    ]));
    expect(result.pointsSpent).toBeGreaterThan(80);
    expect(result.errors).toContainEqual({ code: 'point_budget', field: 'pointsSpent', value: result.pointsSpent, budget: 80 });
  });
});

describe('creation finalization and blueprint adapters', () => {
  it('finalizes once into canonical max/current HP and CHARGE without mutating the draft', () => {
    const source = draft({ characters: [character({ equipment: { weapon: 'heavy_melee', armor: 'heavy', offhand: 'shield' }, protocols: [{ school: 'disrupt', tier: 2 }] })] });
    const result = finalizeCreationDraft(source, gameData, { characterIds: ['alpha'], blueprintName: 'alpha build' });
    expect(result.success).toBe(true);
    expect(source.finalized).toBe(false);
    expect(result).toMatchObject({ credits: 630, pointsSpent: 17, remainingPoints: 63, actionsPerRound: 1 });
    expect(result.party[0]).toMatchObject({
      id: 'alpha',
      classId: 'breacher',
      sigilId: 'pua-e000',
      currentHP: 28,
      currentCHARGE: 9,
      calibrationCount: 0,
      signatureTier: 1,
      protocolDeck: [{ school: 'disrupt', tier: 2 }],
      equipment: { weapon: expect.objectContaining({ baseType: 'heavy_melee' }), armor: expect.objectContaining({ baseType: 'heavy' }), offhand: expect.objectContaining({ baseType: 'shield' }) }
    });
    expect(finalizeCreationDraft(result.draft, gameData)).toEqual({ success: false, reason: 'already_finalized' });
  });

  it('round-trips creation drafts through saved party blueprints with exact accounting', () => {
    const source = draft({ characters: [character({ classId: 'operator', sigil: 0xe028, attributes: { mgt: 3, fin: 3, vit: 3, res: 3, foc: 3, sig: 6 }, equipment: { weapon: 'heavy_ranged', armor: 'medium', offhand: 'shield' }, protocols: [{ school: 'ward', tier: 1 }] })] });
    const blueprint = blueprintFromDraft(source, gameData, 'operator shell');
    expect(blueprint).toMatchObject({ name: 'operator shell', pointsSpent: 18, credits: 620, characters: [expect.objectContaining({ sigilCodepoint: 0xe028 })] });
    const loaded = draftFromBlueprint(blueprint);
    expect(selectCreationState(loaded, gameData)).toMatchObject({ pointsSpent: 18, credits: 620 });
  });

  it('loads a valid, editable quick-start draft that mutates independently of the catalog and other loads', () => {
    const catalog = getQuickStartParties();
    expect(catalog.map((preset) => preset.id)).toEqual(['breach-drill', 'scout-pair', 'full-crew']);
    for (const preset of catalog) expect(preset.members.length).toBeGreaterThan(0);

    const empty = createCreationDraft();
    const loaded = reduceCreationDraft(empty, { type: 'load_quick_start', id: 'breach-drill' }, gameData);
    expect(selectCreationState(loaded, gameData).validation.valid).toBe(true);

    const reloaded = reduceCreationDraft(empty, { type: 'load_quick_start', id: 'breach-drill' }, gameData);
    expect(reloaded).not.toBe(loaded);
    expect(reloaded.characters[0]).not.toBe(loaded.characters[0]);

    const edited = reduceCreationDraft(loaded, { type: 'buy_attribute', attribute: 'mgt' }, gameData);
    expect(edited.characters[0].attributes.mgt).toBe(loaded.characters[0].attributes.mgt + 1);
    expect(getQuickStartParties()).toEqual(catalog);

    expect(reduceCreationDraft(empty, { type: 'load_quick_start', id: 'unknown' }, gameData)).toEqual(empty);
  });

  it('exposes a small stateful facade over the pure reducer for later UI wiring', () => {
    const model = createCreationModel(gameData);
    model.dispatch({ type: 'add_character' });
    model.dispatch({ type: 'set_class', classId: 'oracle' });
    model.dispatch({ type: 'set_sigil', sigil: 0xe020 });
    expect(model.select().validation.valid).toBe(true);
    expect(model.finalize({ characterIds: ['oracle-1'] })).toMatchObject({ success: true, party: [expect.objectContaining({ id: 'oracle-1', currentCHARGE: 17 })] });
    expect(model.dispatch({ type: 'buy_attribute', attribute: 'foc' }).result).toEqual({ success: false, reason: 'finalized' });
  });
});
