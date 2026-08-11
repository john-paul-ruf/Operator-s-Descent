#!/usr/bin/env node
import { runDesignComplianceScan } from './design-scan/scan.js';
import { renderReport, summarize } from './design-scan/report.js';

async function main() {
  const findingsBySource = await runDesignComplianceScan();
  const summary = summarize(findingsBySource);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ findingsBySource, summary }, null, 2));
  } else {
    console.log(renderReport(findingsBySource));
  }
  process.exitCode = summary.passed ? 0 : 1;
}

main();