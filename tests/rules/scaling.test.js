import { describe, it, expect } from 'vitest';
import {
  enemyStatScale,
  enemyCountScale,
  lootRarityShift,
  dangerClockBaseRate,
  corruptionDangerRate,
  calibrationFloor,
  thresholdFloor,
} from '../../src/rules/scaling.js';

describe('enemyStatScale', () => {
  it('(10, 0) === 10', () => {
    expect(enemyStatScale(10, 0)).toBe(10);
  });
  it('(10, 1) === 11', () => {
    expect(enemyStatScale(10, 1)).toBe(11);
  });
  it('(10, 5) === 17', () => {
    expect(enemyStatScale(10, 5)).toBe(17);
  });
  it('(10, 10) === 35', () => {
    expect(enemyStatScale(10, 10)).toBe(35);
  });
  it('(10, 20) === 80', () => {
    expect(enemyStatScale(10, 20)).toBe(80);
  });
  it('(0, 7) === 0', () => {
    expect(enemyStatScale(0, 7)).toBe(0);
  });
  it('is non-decreasing for d = 0..30 with base 10', () => {
    let prev = enemyStatScale(10, 0);
    for (let d = 1; d <= 30; d++) {
      const curr = enemyStatScale(10, d);
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });
});

describe('enemyCountScale', () => {
  it('(2, 0) === 2', () => {
    expect(enemyCountScale(2, 0)).toBe(2);
  });
  it('(2, 4) === 2', () => {
    expect(enemyCountScale(2, 4)).toBe(2);
  });
  it('(2, 5) === 3', () => {
    expect(enemyCountScale(2, 5)).toBe(3);
  });
  it('(2, 14) === 4', () => {
    expect(enemyCountScale(2, 14)).toBe(4);
  });
});

describe('lootRarityShift', () => {
  it('(0) === 0', () => {
    expect(lootRarityShift(0)).toBe(0);
  });
  it('(4) === 0', () => {
    expect(lootRarityShift(4)).toBe(0);
  });
  it('(5) === 1', () => {
    expect(lootRarityShift(5)).toBe(1);
  });
  it('(25) === 5', () => {
    expect(lootRarityShift(25)).toBe(5);
  });
});

describe('dangerClockBaseRate', () => {
  // Halved for 40x64 (traversal ~2x per axis → per-floor danger stays constant).
  it('(1) === 0.006', () => {
    expect(dangerClockBaseRate(1)).toBeCloseTo(0.006);
  });
  it('(5) === 0.010', () => {
    expect(dangerClockBaseRate(5)).toBeCloseTo(0.010);
  });
  it('(10) === 0.015', () => {
    expect(dangerClockBaseRate(10)).toBeCloseTo(0.015);
  });
});

describe('corruptionDangerRate', () => {
  it('(0) === 0', () => {
    expect(corruptionDangerRate(0)).toBe(0);
  });
  it('(10) ≈ 0.03', () => {
    expect(corruptionDangerRate(10)).toBeCloseTo(0.03);
  });
});

describe('calibrationFloor', () => {
  it('true for 3, 6, 9, 30', () => {
    expect(calibrationFloor(3)).toBe(true);
    expect(calibrationFloor(6)).toBe(true);
    expect(calibrationFloor(9)).toBe(true);
    expect(calibrationFloor(30)).toBe(true);
  });
  it('false for 0, 1, 2, 4, -3', () => {
    expect(calibrationFloor(0)).toBe(false);
    expect(calibrationFloor(1)).toBe(false);
    expect(calibrationFloor(2)).toBe(false);
    expect(calibrationFloor(4)).toBe(false);
    expect(calibrationFloor(-3)).toBe(false);
  });
});

describe('thresholdFloor', () => {
  it('true for 10, 20', () => {
    expect(thresholdFloor(10)).toBe(true);
    expect(thresholdFloor(20)).toBe(true);
  });
  it('false for 0, 5, -10', () => {
    expect(thresholdFloor(0)).toBe(false);
    expect(thresholdFloor(5)).toBe(false);
    expect(thresholdFloor(-10)).toBe(false);
  });
});