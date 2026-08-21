import { readText } from './lib.js';
import { extractTouchTargetMinHeight } from './extract-design-spec.js';

/**
 * SESSION-06 — the blanket 48px collapsed-console exception is retired now that
 * the portrait collapsed rail meets the 96px floor. Every `min-height: Xpx`
 * declaration in styles/components.css must be at or above the spec's touch
 * floor (96px) or be zero (`min-height: 0` is a valid reset).
 */
export function checkTouchTargets() {
  const expectedPx = extractTouchTargetMinHeight();
  const css = readText('styles/components.css');
  const values = [...css.matchAll(/min-height:\s*(\d+)px/g)].map((match) => Number(match[1]));
  const findings = [];
  if (!values.some((px) => px >= expectedPx)) {
    findings.push({ level: 'error', category: 'touch-target', message: `styles/components.css declares no min-height >= ${expectedPx}px — spec requires a ${expectedPx}px minimum console row height` });
  }
  for (const px of values) {
    if (px > 0 && px < expectedPx) {
      findings.push({ level: 'warning', category: 'touch-target', message: `styles/components.css declares min-height: ${px}px, below the ${expectedPx}px touch-target minimum` });
    }
  }
  return findings;
}