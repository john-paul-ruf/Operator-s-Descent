import { describe, expect, it } from 'vitest';
import { applyProtocolEffect, deckSlotCapacity, deckSlotCost, protocolChargeCost, resolveProtocolAction, validateProtocolDeck } from '../../src/rules/protocols.js';
import { loadData } from '../helpers/data.js';
import { corridorReshapeFloor, reshapeFloor } from '../helpers/grids.js';

const protocolsData = loadData('protocols');
const classesData = loadData('classes');
const conditionsData = loadData('conditions');

function cursor(...rolls) {
  return { nextInt: () => rolls.shift() ?? 0 };
}

function caster(overrides = {}) {
  return {
    id: 'caster', side: 'party', classId: 'compiler', charge: 20,
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 4 },
    protocolDeck: [{ school: 'disrupt', tier: 1 }], conditions: [], position: { x: 0, y: 0 },
    ...overrides
  };
}

function enemy(overrides = {}) {
  return { id: 'enemy', side: 'enemy', attributes: { foc: 5 }, protocolDefense: 10, position: { x: 2, y: 0 }, ...overrides };
}

const context = { protocolsData, classesData, hasLineOfSight: () => true };

function effectRequest(school, tier, targets = [], extra = {}) {
  const protocol = protocolsData.schools[school].tiers[tier - 1];
  return { protocol, effectId: protocol.effectData.effectId, school, tier, effectiveTier: tier, targets, dc: 11, ...extra };
}

function effectActor(id, side, position, overrides = {}) {
  return {
    id, side, position, hp: 20, hpMax: 20,
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 4 }, conditions: [],
    ...overrides
  };
}

function applyEffect(school, tier, { actor = effectActor('caster', 'party', { x: 0, y: 0 }), targets = [], actors = [], rolls = [], extra = {} } = {}) {
  return applyProtocolEffect(actor, effectRequest(school, tier, targets, extra), {
    actors: [actor, ...actors, ...targets], conditionsData,
    isHostile: (source, target) => source.side !== target.side,
    ...extra
  }, cursor(...rolls));
}

function changed(result, id) {
  return result.stateDelta.actors.find(actor => actor.id === id);
}

describe('protocol preparation', () => {
  it('uses tier-sized deck slots with the minimum three-slot capacity', () => {
    expect(deckSlotCost(4)).toBe(4);
    expect(deckSlotCapacity(0)).toBe(3);
    expect(deckSlotCapacity(8, 2)).toBe(9);
  });

  it('rejects class-gated, unknown, and over-capacity prepared decks', () => {
    const breacher = classesData.classes.find(entry => entry.id === 'breacher');
    expect(validateProtocolDeck(caster({ classId: 'breacher', protocolDeck: [{ school: 'ward', tier: 1 }] }), breacher, protocolsData).reason).toBe('invalid-protocol');
    expect(validateProtocolDeck(caster({ protocolDeck: [{ school: 'disrupt', tier: 2 }, { school: 'disrupt', tier: 2 }] }), breacher, protocolsData).reason).toBe('deck-capacity');
  });
});

describe('resolveProtocolAction', () => {
  it('validates preparation, JAMMED, AP, target side, range, LOS, and effect legality before CHARGE changes', () => {
    const base = caster({ classId: 'operator' });
    const cases = [
      [caster({ classId: 'operator', protocolDeck: [] }), [enemy()], {}, {}, 'unprepared'],
      [caster({ classId: 'operator', conditions: [{ id: 'jammed' }] }), [enemy()], {}, {}, 'jammed'],
      [base, [enemy()], { apAvailable: false }, {}, 'no-ap'],
      [base, [{ ...caster(), id: 'ally' }], {}, {}, 'invalid-target-side'],
      [base, [], {}, {}, 'invalid-target-count'],
      [base, [enemy({ position: { x: 9, y: 0 } })], {}, {}, 'out-of-range'],
      [base, [enemy()], {}, { hasLineOfSight: () => false }, 'blocked-los'],
      [base, [enemy()], {}, { isEffectLegal: () => false }, 'illegal-effect']
    ];
    for (const [actor, targets, options, extra, reason] of cases) {
      const result = resolveProtocolAction(actor, { school: 'disrupt', tier: 1 }, targets, options, cursor(19), { ...context, ...extra });
      expect(result).toEqual({ success: false, reason });
      expect(actor.charge).toBe(20);
    }
  });

  it('rejects a prepared protocol that violates the caster class gate', () => {
    const actor = caster({ classId: 'breacher', protocolDeck: [{ school: 'ward', tier: 1 }] });
    const result = resolveProtocolAction(actor, { school: 'ward', tier: 1 }, [{ ...caster(), id: 'ally' }], {}, cursor(19), context);
    expect(result).toEqual({ success: false, reason: 'class-gated' });
    expect(actor.charge).toBe(20);
  });

  it('does not spend CHARGE when the caster cannot afford the atomic transaction', () => {
    const actor = caster({ classId: 'operator', charge: 3, protocolDeck: [{ school: 'disrupt', tier: 2 }] });
    expect(resolveProtocolAction(actor, { school: 'disrupt', tier: 2 }, [enemy()], { overclocked: true }, cursor(19), context)).toEqual({ success: false, reason: 'insufficient-charge' });
    expect(actor.charge).toBe(3);
  });

  it('spends normal CHARGE once and returns attack telemetry plus an effect request', () => {
    const result = resolveProtocolAction(caster({ classId: 'operator' }), { school: 'disrupt', tier: 1 }, [enemy()], {}, cursor(14), context);
    expect(result).toMatchObject({ success: true, costs: { charge: 2, ap: 1 }, targets: ['enemy'], hit: true, effectiveTier: 1, corruptionDelta: 0 });
    expect(result.rolls.attack).toMatchObject({ natural: 15, modifier: 0, total: 15, target: 10, hit: true });
    expect(result.stateDelta.caster.charge).toBe(18);
    expect(result.effectRequest).toMatchObject({ school: 'disrupt', tier: 1, effectiveTier: 1, dc: 11 });
  });

  it('honors natural 1/20 protocol attack outcomes without suppressing the legal transaction', () => {
    const miss = resolveProtocolAction(caster({ classId: 'operator' }), { school: 'disrupt', tier: 1 }, [enemy({ protocolDefense: 1 })], {}, cursor(0), context);
    const critical = resolveProtocolAction(caster({ classId: 'operator' }), { school: 'disrupt', tier: 1 }, [enemy({ protocolDefense: 99 })], {}, cursor(19), context);
    expect(miss).toMatchObject({ success: true, hit: false, effectRequest: null });
    expect(critical).toMatchObject({ success: true, hit: true });
  });

  it('spends the double overclock CHARGE exactly once and adds one effective tier at tier five', () => {
    const result = resolveProtocolAction(caster({ classId: 'operator', attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 6, sig: 4 }, protocolDeck: [{ school: 'disrupt', tier: 5 }] }), { school: 'disrupt', tier: 5 }, [enemy()], { overclocked: true }, cursor(19, 19), context);
    expect(result).toMatchObject({ success: true, overclocked: true, costs: { charge: 20 }, effectiveTier: 6, corruptionDelta: 0 });
    expect(result.stateDelta.caster.charge).toBe(0);
    expect(result.effectRequest.effectiveTier).toBe(6);
  });

  it('records failed overclock corruption in a returned immutable run-state delta', () => {
    const runState = { corruption: 0.2 };
    const result = resolveProtocolAction(caster({ classId: 'operator' }), { school: 'disrupt', tier: 1 }, [enemy()], { overclocked: true }, cursor(0, 19), { ...context, runState });
    expect(result).toMatchObject({ success: true, overclocked: false, corruptionDelta: 0.05, effectRequest: null });
    expect(result.stateDelta.caster.charge).toBe(16);
    expect(result.stateDelta.runState).toEqual({ corruption: 0.25 });
    expect(runState).toEqual({ corruption: 0.2 });
  });

  it('applies every COMPILE tier: discount, clean failed overclock, and automatic two-tier overclock', () => {
    const compiler = classesData.classes.find(entry => entry.id === 'compiler');
    const discounted = resolveProtocolAction(caster(), { school: 'disrupt', tier: 1 }, [enemy()], { overclocked: true }, cursor(19, 19), { ...context, classData: compiler });
    const clean = resolveProtocolAction(caster({ calibrationCount: 2 }), { school: 'disrupt', tier: 1 }, [enemy()], { overclocked: true }, cursor(0, 19), { ...context, classData: compiler });
    const doubled = resolveProtocolAction(caster({ calibrationCount: 4 }), { school: 'disrupt', tier: 1 }, [enemy()], { overclocked: true }, cursor(19), { ...context, classData: compiler });
    expect(protocolChargeCost(1, { overclocked: true, capabilities: { signatureId: 'compile', effects: compiler.signature.effects.slice(0, 1) } })).toBe(3);
    expect(discounted).toMatchObject({ costs: { charge: 3 }, overclocked: true, effectiveTier: 2 });
    expect(clean).toMatchObject({ costs: { charge: 3 }, overclocked: false, corruptionDelta: 0 });
    expect(doubled).toMatchObject({ costs: { charge: 5 }, overclocked: true, effectiveTier: 3 });
    expect(doubled.rolls.overclock).toBeNull();
  });
});

describe('protocol effect handlers', () => {
  const target = effectActor('target', 'enemy', { x: 2, y: 0 });
  const ally = effectActor('ally', 'party', { x: 2, y: 0 }, { hp: 10, hpMax: 20 });
  const nearby = effectActor('nearby', 'enemy', { x: 3, y: 0 });

  const scenarios = [
    ['SPARK deals tier-scaled d6 damage', () => {
      const result = applyEffect('disrupt', 1, { targets: [target] });
      expect(changed(result, 'target').hp).toBe(19);
    }],
    ['SURGE damages the target and adjacent hostiles', () => {
      const result = applyEffect('disrupt', 2, { targets: [target], actors: [nearby] });
      expect(changed(result, 'target').hp).toBe(18);
      expect(changed(result, 'nearby').hp).toBe(19);
    }],
    ['STORM selects hostile targets in its Chebyshev area', () => {
      const result = applyEffect('disrupt', 3, { targets: [target], actors: [nearby] });
      expect(result.events.filter(event => event.type === 'damage').map(event => event.targetId)).toEqual(['target', 'nearby']);
    }],
    ['CASCADE chains to the nearest hostile only after a kill', () => {
      const first = effectActor('target', 'enemy', { x: 2, y: 0 }, { hp: 1 });
      const second = effectActor('second', 'enemy', { x: 3, y: 0 }, { hp: 20 });
      const result = applyEffect('disrupt', 4, { targets: [first], actors: [second] });
      expect(changed(result, 'target').hp).toBe(0);
      expect(changed(result, 'second').hp).toBe(16);
    }],
    ['OBLITERATE emits its defense-ignoring damage event', () => {
      const result = applyEffect('disrupt', 5, { targets: [target] });
      expect(result.events[0]).toMatchObject({ type: 'damage_ignore_defense', amount: 5 });
    }],
    ['PATCH clamps healing at the target maximum', () => {
      const result = applyEffect('ward', 1, { targets: [ally] });
      expect(changed(result, 'ally').hp).toBe(11);
    }],
    ['BARRIER applies SHIELDED', () => {
      const result = applyEffect('ward', 2, { targets: [ally] });
      expect(changed(result, 'ally').conditions[0].id).toBe('shielded');
    }],
    ['BULWARK shields allies and returns a timed defense delta', () => {
      const actor = effectActor('caster', 'party', { x: 0, y: 0 });
      const closeAlly = effectActor('ally', 'party', { x: 1, y: 0 });
      const result = applyEffect('ward', 3, { actor, actors: [closeAlly] });
      expect(result.stateDelta.temporaryEffects.ally).toEqual({ defenseBonus: 2, duration: 2 });
      expect(changed(result, 'ally').conditions[0].id).toBe('shielded');
    }],
    ['REGEN returns a tier-duration ongoing heal formula', () => {
      const result = applyEffect('ward', 4, { targets: [ally] });
      expect(result.stateDelta.temporaryEffects.ally).toEqual({ regen: { die: 'd6', modifier: 0, duration: 4 } });
    }],
    ['FORTRESS returns area condition immunity and defense', () => {
      const actor = effectActor('caster', 'party', { x: 0, y: 0 });
      const closeAlly = effectActor('ally', 'party', { x: 1, y: 0 });
      const result = applyEffect('ward', 5, { actor, actors: [closeAlly] });
      expect(result.stateDelta.temporaryEffects.ally).toEqual({ defenseBonus: 4, conditionImmunity: true, duration: 2 });
    }],
    ['PING returns revealed enemies without LOS', () => {
      const result = applyEffect('scry', 1, { actors: [target, nearby] });
      expect(result.stateDelta.markers).toMatchObject({ revealedEnemies: ['target', 'nearby'], revealDuration: 1 });
    }],
    ['TAG applies MARKED without a save', () => {
      const result = applyEffect('scry', 2, { targets: [target] });
      expect(changed(result, 'target').conditions[0].id).toBe('marked');
    }],
    ['BLIND respects the FIN save', () => {
      const result = applyEffect('scry', 3, { targets: [target], rolls: [0] });
      expect(changed(result, 'target').conditions[0].id).toBe('blinded');
    }],
    ['REVEAL returns explicit whole-floor markers', () => {
      const result = applyEffect('scry', 4);
      expect(result.stateDelta.markers).toEqual({ revealFloor: true, revealContainers: true, revealDescent: true });
    }],
    ['ORACLE marks and reveals every hostile', () => {
      const result = applyEffect('scry', 5, { actors: [target, nearby] });
      expect(result.stateDelta.markers.revealedEnemies).toEqual(['target', 'nearby']);
      expect(changed(result, 'nearby').conditions[0].id).toBe('marked');
    }],
    ['FLIP swaps two legal ally cells', () => {
      const actor = effectActor('caster', 'party', { x: 0, y: 0 });
      const result = applyEffect('rewrite', 1, { actor, targets: [ally] });
      expect(changed(result, 'caster').position).toEqual({ x: 2, y: 0 });
      expect(changed(result, 'ally').position).toEqual({ x: 0, y: 0 });
    }],
    ['PURGE removes one condition only', () => {
      const afflicted = effectActor('ally', 'party', { x: 2, y: 0 }, { conditions: [{ id: 'jammed' }, { id: 'burning' }] });
      const result = applyEffect('rewrite', 2, { targets: [afflicted] });
      expect(changed(result, 'ally').conditions).toEqual([{ id: 'burning' }]);
    }],
    ['OVERRIDE applies PANICKED when the FOC save fails', () => {
      const result = applyEffect('rewrite', 3, { targets: [target], rolls: [0] });
      expect(changed(result, 'target').conditions[0].id).toBe('panicked');
    }],
    ['NULLIFY returns AP debt for each hostile in the area', () => {
      const result = applyEffect('rewrite', 4, { actors: [target, nearby] });
      expect(result.stateDelta.apDebt).toEqual({ target: 2, nearby: 2 });
    }],
    ['REFORMAT returns only a connected, unoccupied 3×3 mutation', () => {
      const floor = reshapeFloor();
      const actor = effectActor('caster', 'party', { x: 0, y: 0 });
      const result = applyEffect('rewrite', 5, { actor, extra: { floor, areaCenter: { x: 3, y: 3 }, reshapeMode: 'floor' } });
      expect(result.stateDelta.grid[3][3]).toBe(1);
      expect(result.events).toEqual([{ type: 'reshape', areaCenter: { x: 3, y: 3 }, mode: 'floor' }]);
      expect(floor.cells[3][3]).toBe(0);
      const blocked = applyEffect('rewrite', 5, { actor, extra: { floor: corridorReshapeFloor(), areaCenter: { x: 3, y: 3 }, reshapeMode: 'wall' } });
      expect(blocked.events).toEqual([{ type: 'reshape_rejected', reason: 'connectivity' }]);
      const occupied = applyEffect('rewrite', 5, { actor: effectActor('caster', 'party', { x: 3, y: 3 }), extra: { floor: reshapeFloor(), areaCenter: { x: 3, y: 3 }, reshapeMode: 'floor' } });
      expect(occupied.events).toEqual([{ type: 'reshape_rejected', reason: 'occupied' }]);
    }]
  ];

  it.each(scenarios)('%s', (_, run) => run());
});

describe('HP alias invariant', () => {
  it('keeps hp and currentHP coherent when healing a dual-shaped actor', () => {
    const dualAlly = effectActor('ally', 'party', { x: 2, y: 0 }, { hp: 10, currentHP: 10, hpMax: 20 });
    const result = applyEffect('ward', 1, { targets: [dualAlly] });
    const healed = changed(result, 'ally');
    expect(healed.hp).toBe(11);
    expect(healed.currentHP).toBe(11);
  });
});
