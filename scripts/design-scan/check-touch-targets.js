import { readText } from './lib.js';
import { extractTouchTargetMinHeight } from './extract-design-spec.js';

const COLLAPSED_CONSOLE_HEIGHT_PX = 48;

export function checkTouchTargets() {
  const expectedPx = extractTouchTargetMinHeight();
  const css = readText('styles/components.css');
  const values = [...css.matchAll(/min-height:\s*(\d+)px/g)].map((match) => Number(match[1]));
  const findings = [];
  if (!values.some((px) => px >= expectedPx)) {
    findings.push({ level: 'error', category: 'touch-target', message: `styles/components.css declares no min-height >= ${expectedPx}px — spec requires a ${expectedPx}px minimum console row height` });
  }
  for (const px of values) {
    if (px > 0 && px < expectedPx && px !== COLLAPSED_CONSOLE_HEIGHT_PX) {
      findings.push({ level: 'warning', category: 'touch-target', message: `styles/components.css declares min-height: ${px}px, below the ${expectedPx}px touch-target minimum` });
    }
  }
  return findings;
}