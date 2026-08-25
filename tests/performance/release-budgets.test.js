import { describe, expect, it } from 'vitest';
import { runBudgetReport } from '../../scripts/report-budget.js';
import { runGenerationStress } from '../../scripts/stress-generation.js';
import { runSaveStress } from '../../scripts/stress-saves.js';
import { runSimulation } from '../../scripts/simulate-runs.js';
import { SAVE_BUDGET } from '../../src/state/save-encode.js';

describe('release performance and budget gates', () => {
  it('static transfer and hot paths stay within hard release budgets', () => {
    const report = runBudgetReport();
    expect(Math.min(report.transfer.totals.gzip, report.transfer.totals.brotli)).toBeLessThanOrEqual(report.transferBudgetBytes);
    expect(report.hotPaths.floorGeneration.p95).toBeLessThan(100);
    expect(report.hotPaths.shadowcast.p95).toBeLessThan(25);
    expect(report.hotPaths.canvasFrameProxy.p95).toBeLessThan(16);
    expect(report.hotPaths.combatAction.p95).toBeLessThan(50);
    expect(report.hotPaths.saveEncodeDecode.encodeMs.max).toBeLessThan(50);
    expect(report.hotPaths.saveEncodeDecode.decodeMs.max).toBeLessThan(100);
    expect(report.hotPaths.saveEncodeDecode.maxLength).toBeLessThan(SAVE_BUDGET);
    expect(report.hotPaths.audioSchedulingProxy.p95).toBeLessThan(10);
  });

  it('floor and save stress fixtures satisfy acceptance limits', () => {
    const floors = runGenerationStress({ seeds: 80, depths: [1, 10, 50, 100] });
    const saves = runSaveStress();
    expect(floors.sampleCount).toBe(320);
    expect(floors.archetypes.length).toBe(8);
    expect(floors.timingsMs.p95).toBeLessThan(100);
    expect(floors.attempts.max).toBeLessThan(100);
    expect(saves.maxLength).toBeLessThan(SAVE_BUDGET);
    const ceilings = ['caster-pack-ceiling', 'apex-pack-ceiling'];
    const names = saves.cases.map((entry) => entry.name);
    for (const name of ceilings) expect(names).toContain(name);
    const worst = saves.cases.find((entry) => entry.length === saves.maxLength);
    expect(ceilings).toContain(worst.name);
  });

  it('deterministic balance simulation covers the corruption and hunt curve', () => {
    const simulation = runSimulation({ runs: 50 });
    expect(simulation.runs).toBe(50);
    expect(simulation.strategies.length).toBe(5);
    expect(simulation.totals.hunts).toBeGreaterThan(0);
    expect(simulation.totals.failedOverclocks).toBeGreaterThan(0);
    expect(simulation.totals.implants).toBeGreaterThan(0);
    expect(simulation.halfThresholdPathological).toBe(false);
  });
});
