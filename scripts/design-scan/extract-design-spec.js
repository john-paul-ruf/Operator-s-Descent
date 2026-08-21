import { readText, parseBacktickTableRows, assertCount } from './lib.js';

export function extractColorTokens(designMd = readText('specs/design.md')) {
  const rows = parseBacktickTableRows(designMd, {
    startMarker: '### Color Palette',
    endMarker: '### Typography'
  });
  assertCount(rows, 16, 'design.md color palette tokens');
  return rows.map(([token, value]) => ({ token, value }));
}

export function extractCornerRadius(designMd = readText('specs/design.md')) {
  const section = designMd.slice(designMd.indexOf('### Corner Radius'), designMd.indexOf('### Shadow / Glow System'));
  const rows = [...section.matchAll(/-\s*([^:\n]+):\s*\*\*(\d+)px\*\*/g)].map(([, target, px]) => ({
    target: target.trim(),
    px: Number(px)
  }));
  assertCount(rows, 4, 'design.md corner radius rules');
  return rows;
}

export function extractTouchTargetMinHeight(designMd = readText('specs/design.md')) {
  const match = designMd.match(/Console row height:\s*\*\*(\d+)px\s*minimum\*\*/);
  if (!match) throw new Error('design.md: console row height constant not found — spec text may have changed shape');
  return Number(match[1]);
}

const GLITCH_EFFECT_LABELS = {
  charSubstitution: 'Character substitution',
  vhsEvents: 'VHS event',
  elementJitter: 'Element jitter',
  borderFlicker: 'Border flicker',
  frameFlash: 'Frame flash',
  glitchBars: 'Glitch bars',
  noiseLines: 'Noise lines'
};

export function extractGlitchTimings(requirementsMd = readText('specs/requirements.md')) {
  const timings = {};
  for (const [key, label] of Object.entries(GLITCH_EFFECT_LABELS)) {
    const lineMatch = requirementsMd.match(new RegExp(`\\*\\*${label}:\\*\\*([^\\n]+)`));
    if (!lineMatch) throw new Error(`requirements.md FR-23: "${label}" line not found — spec text may have changed shape`);
    const line = lineMatch[1];
    const msPairs = [...line.matchAll(/(\d+)[-–](\d+)ms/g)].map((m) => [Number(m[1]), Number(m[2])]);
    if (msPairs.length < 2) throw new Error(`requirements.md FR-23: "${label}" line has fewer than 2 ms-ranges (cadence + duration)`);
    const [cadence, duration] = msPairs;
    const fireMatch = line.match(/(\d+)%\s*fire/);
    timings[key] = {
      minCadence: cadence[0],
      maxCadence: cadence[1],
      minDuration: duration[0],
      maxDuration: duration[1],
      ...(fireMatch ? { firePercent: Number(fireMatch[1]) } : {})
    };
  }
  assertCount(Object.keys(timings), 7, 'requirements.md FR-23 timed glitch effects');
  return timings;
}

export function extractLayoutClasses(designMd = readText('specs/design.md')) {
  const start = designMd.indexOf('**Layout classes and selection**');
  if (start === -1) throw new Error('design.md: "**Layout classes and selection**" table not found — spec text may have changed shape');
  const section = designMd.slice(start, designMd.indexOf('**Full-viewport CRT.**', start));
  const rows = [...section.matchAll(/^\|\s*(portrait|wide)\s*\|([^|\n]+)\|([^|\n]+)\|/gm)]
    .map(([, name, selection, defaultUse]) => ({ name, selection: selection.trim(), defaultUse: defaultUse.trim() }));
  return assertCount(rows, 2, 'design.md layout classes');
}

export function extractScreenLayoutsByClass(designMd = readText('specs/design.md')) {
  const start = designMd.indexOf('### Screen Layouts by Class');
  if (start === -1) throw new Error('design.md: "### Screen Layouts by Class" section not found — spec text may have changed shape');
  const section = designMd.slice(start, designMd.indexOf('## Prototype Navigation Notes', start));
  const rows = [];
  for (const line of section.split('\n')) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.replace(/\\\|/g, '|').trim());
    const file = cells[1]?.match(/`mocks\/([\w.-]+\.html)`/)?.[1];
    if (!file) continue;
    rows.push({ file, portrait: cells[2], wide: cells[3], shared: cells[4] });
  }
  return assertCount(rows, 15, 'design.md screen-layouts-by-class matrix rows');
}

export function extractDesignSpec() {
  return {
    colorTokens: extractColorTokens(),
    cornerRadius: extractCornerRadius(),
    touchTargetMinHeightPx: extractTouchTargetMinHeight(),
    glitchTimings: extractGlitchTimings(),
    layoutClasses: extractLayoutClasses(),
    screenLayoutsByClass: extractScreenLayoutsByClass()
  };
}