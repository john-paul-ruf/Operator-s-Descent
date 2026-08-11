import { describe, expect, it } from 'vitest';
import { runDesignComplianceScan } from '../../scripts/design-scan/scan.js';
import { summarize, renderReport } from '../../scripts/design-scan/report.js';

describe('design compliance scan (integration)', () => {
  it('produces zero error-level findings against the current repo', async () => {
    const findingsBySource = await runDesignComplianceScan();
    const summary = summarize(findingsBySource);
    if (summary.error > 0) {
      const errors = Object.values(findingsBySource).flat().filter((finding) => finding.level === 'error');
      throw new Error(`design compliance scan found ${summary.error} error(s):\n${errors.map((e) => `  - ${e.message}`).join('\n')}`);
    }
    expect(summary.passed).toBe(true);
  });

  it('covers all 8 check categories', async () => {
    const findingsBySource = await runDesignComplianceScan();
    expect(Object.keys(findingsBySource)).toHaveLength(8);
  });

  it('renders a report ending in PASS when there are no errors', async () => {
    const findingsBySource = await runDesignComplianceScan();
    const report = renderReport(findingsBySource);
    expect(report).toContain('PASS — no design-completeness or mock-compliance errors');
  });
});