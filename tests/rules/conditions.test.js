import { describe, expect, it } from 'vitest';
import { applyCondition, clearAllConditions, consumeShield, getConditionEffects, hasCondition, tickConditions } from '../../src/rules/conditions.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

const data = loadData('conditions');

function cursor(...values) {
  return { nextInt: () => values.shift() ?? 0 };
}

describe('condition application and saves', () => {
  it('rejects unknown conditions without mutation', () => {
    const target = makeCharacter();
    expect(applyCondition(target, 'unknown', { noSave: true }, cursor(), data)).toMatchObject({ applied: false, reason: 'invalid_condition' });
    expect(target.conditions).toEqual([]);
  });

  for (const [id, attribute] of Object.entries({ jammed: 'foc', overloaded: 'res', blinded: 'fin', immobilized: 'mgt', corroded: 'vit', panicked: 'foc', burning: 'vit' })) {
    it(`${id} resolves its ${attribute.toUpperCase()} save with a structured d20 event`, () => {
      const target = makeCharacter({ attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 } });
      const saved = applyCondition(target, id, { dc: 12 }, cursor(11), data);
      expect(saved).toMatchObject({ applied: false, saved: true, roll: { natural: 12, modifier: 0, total: 12, dc: 12, attribute, success: true } });
      const failed = applyCondition(target, id, { dc: 12 }, cursor(10), data);
      expect(failed).toMatchObject({ applied: true, roll: { natural: 11, success: false } });
      expect(hasCondition(target, id)).toBe(true);
    });
  }

  it('applies MARKED and SHIELDED without a save', () => {
    const target = makeCharacter();
    expect(applyCondition(target, 'marked', { dc: 99 }, null, data)).toMatchObject({ applied: true, roll: null });
    expect(applyCondition(target, 'shielded', {}, null, data)).toMatchObject({ applied: true, roll: null });
  });

  it('consumes SHIELDED before a condition save and emits a consumption event', () => {
    const target = makeCharacter({ conditions: [{ id: 'shielded', duration: 3, stacks: 1 }] });
    const result = applyCondition(target, 'burning', { dc: 1 }, cursor(19), data);
    expect(result).toMatchObject({ applied: false, shielded: true, events: [{ type: 'condition_consumed', conditionId: 'shielded' }] });
    expect(target.conditions).toEqual([]);
    expect(consumeShield(target)).toEqual({ consumed: false });
  });

  it('refreshes nonstackable durations and only stacks BURNING', () => {
    const target = makeCharacter();
    applyCondition(target, 'jammed', { noSave: true }, null, data);
    target.conditions[0].duration = 1;
    expect(applyCondition(target, 'jammed', { noSave: true }, null, data)).toMatchObject({ applied: true, refreshed: true });
    applyCondition(target, 'burning', { noSave: true }, null, data);
    applyCondition(target, 'burning', { noSave: true }, null, data);
    expect(target.conditions.find(entry => entry.id === 'jammed').duration).toBe(2);
    expect(target.conditions.find(entry => entry.id === 'burning')).toMatchObject({ duration: 3, stacks: 2 });
  });
});

describe('condition effects and lifecycle', () => {
  it('exposes all nine condition mechanics as data-derived effects', () => {
    const target = makeCharacter({ conditions: Object.keys(data.conditions).map(id => ({ id, duration: 3, stacks: id === 'burning' ? 2 : 1, ...(id === 'corroded' ? { elapsedTurns: 2 } : {}) })) });
    expect(getConditionEffects(target, data)).toMatchObject({
      defenseBonus: 4,
      defensePenalty: -4,
      defenseFloor: 2,
      damageMultiplier: 1.5,
      losRange: 1,
      rangedPenalty: -4,
      attackBonusAgainst: 2,
      blockProtocols: true,
      blockMove: true,
      blockAttack: true,
      forcedRetreat: true,
      alwaysVisible: true
    });
  });

  it('rolls one d6 per BURNING stack and decrements conditions only at start of turn', () => {
    const target = makeCharacter({ conditions: [{ id: 'burning', duration: 2, stacks: 2 }] });
    expect(tickConditions(target, 'end_turn', cursor(), data)).toEqual([]);
    const events = tickConditions(target, 'start_turn', cursor(0, 5), data);
    expect(events).toContainEqual({ type: 'damage', targetId: target.id, target: target.id, source: 'burning', conditionId: 'burning', rolls: [1, 6], amount: 7 });
    expect(target.conditions[0].duration).toBe(1);
  });

  it('increases CORRODED potency each elapsed turn then expires once', () => {
    const target = makeCharacter({ conditions: [{ id: 'corroded', duration: 2, stacks: 1, elapsedTurns: 0 }] });
    tickConditions(target, 'start_turn', cursor(), data);
    expect(getConditionEffects(target, data).defensePenalty).toBe(-2);
    const events = tickConditions(target, 'start_turn', cursor(), data);
    expect(events).toContainEqual({ type: 'condition_tick', conditionId: 'corroded', targetId: target.id, elapsedTurns: 2 });
    expect(events).toContainEqual({ type: 'expired', conditionId: 'corroded', targetId: target.id, target: target.id, condition: 'corroded' });
    expect(hasCondition(target, 'corroded')).toBe(false);
  });

  it('clears all saved condition entries with structured events', () => {
    const target = makeCharacter({ conditions: [{ conditionId: 'jammed', duration: 2 }, { id: 'marked', duration: 3 }] });
    expect(clearAllConditions(target)).toMatchObject({ cleared: ['jammed', 'marked'], events: [{ type: 'condition_cleared', conditionId: 'jammed' }, { type: 'condition_cleared', conditionId: 'marked' }] });
    expect(target.conditions).toEqual([]);
  });
});
