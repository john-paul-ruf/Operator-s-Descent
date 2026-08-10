import { describe, expect, it } from 'vitest';
import { deckSlotCapacity, deckSlotCost, protocolChargeCost, resolveProtocolAction, validateProtocolDeck } from '../../src/rules/protocols.js';
import { loadData } from '../helpers/data.js';

const protocolsData = loadData('protocols');
const classesData = loadData('classes');

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
