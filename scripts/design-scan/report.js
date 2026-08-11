const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };

export function summarize(findingsBySource) {
  const all = Object.values(findingsBySource).flat();
  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of all) counts[finding.level] = (counts[finding.level] || 0) + 1;
  return { total: all.length, ...counts, passed: counts.error === 0 };
}

export function renderReport(findingsBySource) {
  const lines = ["Design Compliance Scan — Operator's Descent", '='.repeat(44)];
  for (const [source, findings] of Object.entries(findingsBySource)) {
    lines.push('', `${source} (${findings.length} finding${findings.length === 1 ? '' : 's'})`);
    if (findings.length === 0) {
      lines.push('  OK — no gaps found');
      continue;
    }
    const sorted = [...findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    for (const finding of sorted) lines.push(`  [${finding.level.toUpperCase()}] ${finding.message}`);
  }
  const summary = summarize(findingsBySource);
  lines.push(
    '',
    '-'.repeat(44),
    `${summary.total} finding(s) — ${summary.error} error(s), ${summary.warning} warning(s), ${summary.info} info`,
    summary.passed ? 'PASS — no design-completeness or mock-compliance errors' : 'FAIL — resolve error-level findings above'
  );
  return lines.join('\n');
}