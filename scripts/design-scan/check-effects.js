import { extractGlitchTimings } from './extract-design-spec.js';

const TIMING_FIELDS = ['minCadence', 'maxCadence', 'minDuration', 'maxDuration', 'firePercent'];

export async function checkGlitchTimings() {
  const spec = extractGlitchTimings();
  const { GLITCH_TIMINGS: actual } = await import('../../src/glitch/glitch.js');
  const findings = [];
  for (const [effect, expected] of Object.entries(spec)) {
    const implementation = actual[effect];
    if (!implementation) {
      findings.push({ level: 'error', category: 'glitch-timing', effect, message: `GLITCH_TIMINGS has no entry for "${effect}"` });
      continue;
    }
    for (const field of TIMING_FIELDS) {
      if (expected[field] === undefined && implementation[field] === undefined) continue;
      if (expected[field] !== implementation[field]) {
        findings.push({ level: 'error', category: 'glitch-timing', effect, field, message: `${effect}.${field}: spec has ${expected[field]}, GLITCH_TIMINGS has ${implementation[field]}` });
      }
    }
  }
  for (const effect of Object.keys(actual)) {
    if (!spec[effect]) findings.push({ level: 'warning', category: 'glitch-timing', effect, message: `GLITCH_TIMINGS defines "${effect}" with no matching FR-23 timing line` });
  }
  return findings;
}