import { describe, it, expect } from 'vitest';
import {
  applyCondition,
  tickConditions,
  clearAllConditions,
  hasCondition,
  getConditionBonus,
} from '../../src/rules/conditions.js';
import { makeCharacter } from '../helpers/fixtures.js';
import { loadData } from '../helpers/data.js';

const conditionsData = loadData('conditions').conditions;

describe('applyCondition — unknown id', () => {
  it('returns {applied: false}', () => {
    const target = makeCharacter();
    expect(applyCondition(target, 'nonexistent', conditionsData)).toEqual({ applied: false });
  });
});

describe('applyCondition — fresh apply', () => {
  it('pushes {id, duration, stacks: 1} with duration from data', () => {
    const target = makeCharacter();
    const result = applyCondition(target, 'burning', conditionsData);
    expect(result.applied).toBe(true);
    expect(target.conditions).toHaveLength(1);
    expect(target.conditions[0].id).toBe('burning');
    expect(target.conditions[0].duration).toBe(conditionsData.burning.duration);
    expect(target.conditions[0].stacks).toBe(1);
  });
  it('target without conditions array gets one created', () => {
    const target = { id: 'test', conditions: undefined };
    applyCondition(target, 'jammed', conditionsData);
    expect(Array.isArray(target.conditions)).toBe(true);
    expect(target.conditions).toHaveLength(1);
  });
});

describe('applyCondition — shielded absorption', () => {
  it('applying burning with shielded active removes shielded, does not add burning', () => {
    const target = makeCharacter({ conditions: [{ id: 'shielded', duration: 3, stacks: 1 }] });
    const result = applyCondition(target, 'burning', conditionsData);
    expect(result).toEqual({ applied: false, shielded: true });
    expect(target.conditions).toHaveLength(0);
  });
  it('re-applying shielded itself takes the refresh path (duration = max)', () => {
    const target = makeCharacter({ conditions: [{ id: 'shielded', duration: 2, stacks: 1 }] });
    const result = applyCondition(target, 'shielded', conditionsData);
    expect(result.applied).toBe(true);
    expect(target.conditions).toHaveLength(1);
    expect(target.conditions[0].duration).toBe(Math.max(2, conditionsData.shielded.duration));
  });
});

describe('applyCondition — stacking', () => {
  it('burning applied twice: stacks === 2, duration reset', () => {
    const target = makeCharacter();
    applyCondition(target, 'burning', conditionsData);
    applyCondition(target, 'burning', conditionsData);
    expect(target.conditions).toHaveLength(1);
    expect(target.conditions[0].stacks).toBe(2);
    expect(target.conditions[0].duration).toBe(conditionsData.burning.duration);
  });
  it('non-stackable applied twice: single entry, duration = max', () => {
    const target = makeCharacter();
    applyCondition(target, 'jammed', conditionsData);
    target.conditions[0].duration = 1;
    applyCondition(target, 'jammed', conditionsData);
    expect(target.conditions).toHaveLength(1);
    expect(target.conditions[0].duration).toBe(Math.max(1, conditionsData.jammed.duration));
  });
});

describe('tickConditions', () => {
  it('burning with stacks 2 yields damage amount 2', () => {
    const target = makeCharacter({ conditions: [{ id: 'burning', duration: 3, stacks: 2 }] });
    const results = tickConditions(target, conditionsData);
    const dmg = results.find(r => r.type === 'damage');
    expect(dmg).toBeDefined();
    expect(dmg.amount).toBe(2);
    expect(dmg.source).toBe('burning');
  });
  it('duration decrements for every condition', () => {
    const target = makeCharacter({ conditions: [
      { id: 'jammed', duration: 3, stacks: 1 },
      { id: 'marked', duration: 2, stacks: 1 },
    ] });
    tickConditions(target, conditionsData);
    expect(target.conditions[0].duration).toBe(2);
    expect(target.conditions[1].duration).toBe(1);
  });
  it('duration reaching 0 emits expired and removes entry', () => {
    const target = makeCharacter({ conditions: [{ id: 'jammed', duration: 1, stacks: 1 }] });
    const results = tickConditions(target, conditionsData);
    expect(results.some(r => r.type === 'expired' && r.condition === 'jammed')).toBe(true);
    expect(target.conditions).toHaveLength(0);
  });
  it('multiple expiring in one tick handled (reverse iteration)', () => {
    const target = makeCharacter({ conditions: [
      { id: 'jammed', duration: 1, stacks: 1 },
      { id: 'marked', duration: 1, stacks: 1 },
      { id: 'blinded', duration: 1, stacks: 1 },
    ] });
    const results = tickConditions(target, conditionsData);
    expect(results.filter(r => r.type === 'expired')).toHaveLength(3);
    expect(target.conditions).toHaveLength(0);
  });
  it('target with no conditions → []', () => {
    const target = makeCharacter({ conditions: undefined });
    expect(tickConditions(target, conditionsData)).toEqual([]);
  });
});

describe('clearAllConditions', () => {
  it('empties conditions array', () => {
    const target = makeCharacter({ conditions: [{ id: 'jammed', duration: 2, stacks: 1 }] });
    clearAllConditions(target);
    expect(target.conditions).toHaveLength(0);
  });
});

describe('hasCondition', () => {
  it('true when condition present', () => {
    const target = makeCharacter({ conditions: [{ id: 'jammed', duration: 2, stacks: 1 }] });
    expect(hasCondition(target, 'jammed')).toBe(true);
  });
  it('false when condition absent', () => {
    const target = makeCharacter({ conditions: [{ id: 'jammed', duration: 2, stacks: 1 }] });
    expect(hasCondition(target, 'burning')).toBe(false);
  });
  it('false when no conditions array', () => {
    const target = makeCharacter({ conditions: undefined });
    expect(hasCondition(target, 'jammed')).toBe(false);
  });
});

describe('getConditionBonus', () => {
  it('shielded + defense → +4', () => {
    const target = makeCharacter({ conditions: [{ id: 'shielded', duration: 3, stacks: 1 }] });
    expect(getConditionBonus(target, 'defense')).toBe(4);
  });
  it('corroded stacks 3 + defense → -6', () => {
    const target = makeCharacter({ conditions: [{ id: 'corroded', duration: 3, stacks: 3 }] });
    expect(getConditionBonus(target, 'defense')).toBe(-6);
  });
  it('marked + attack-against → +2', () => {
    const target = makeCharacter({ conditions: [{ id: 'marked', duration: 3, stacks: 1 }] });
    expect(getConditionBonus(target, 'attack-against')).toBe(2);
  });
  it('combined shielded + corroded sums', () => {
    const target = makeCharacter({ conditions: [
      { id: 'shielded', duration: 3, stacks: 1 },
      { id: 'corroded', duration: 3, stacks: 2 },
    ] });
    expect(getConditionBonus(target, 'defense')).toBe(0);
  });
  it('irrelevant bonusType → 0', () => {
    const target = makeCharacter({ conditions: [{ id: 'shielded', duration: 3, stacks: 1 }] });
    expect(getConditionBonus(target, 'attack')).toBe(0);
  });
});