import { describe, expect, it } from 'vitest';
import {
  extractColorTokens,
  extractCornerRadius,
  extractTouchTargetMinHeight,
  extractGlitchTimings
} from '../../scripts/design-scan/extract-design-spec.js';

describe('extract-design-spec', () => {
  it('extracts all 16 color tokens with correct values', () => {
    const tokens = extractColorTokens();
    expect(tokens).toHaveLength(16);
    expect(tokens.find((t) => t.token === '--bg-base')).toEqual({ token: '--bg-base', value: '#0a0612' });
    expect(tokens.find((t) => t.token === '--accent')).toEqual({ token: '--accent', value: '#7ec8e3' });
    expect(tokens.find((t) => t.token === '--border-active')).toEqual({ token: '--border-active', value: 'var(--accent)' });
    expect(tokens.find((t) => t.token === '--text-disabled')).toEqual({ token: '--text-disabled', value: '#71659a' });
  });

  it('extracts corner radius rules', () => {
    const rules = extractCornerRadius();
    expect(rules).toHaveLength(4);
    expect(rules.find((r) => r.target === 'Buttons')).toEqual({ target: 'Buttons', px: 4 });
    expect(rules.find((r) => r.target === 'Small controls (sliders, toggles)')).toEqual({ target: 'Small controls (sliders, toggles)', px: 2 });
  });

  it('extracts the 96px touch target minimum', () => {
    expect(extractTouchTargetMinHeight()).toBe(96);
  });

  it('extracts 7 glitch timing entries matching src/glitch/glitch.js GLITCH_TIMINGS', () => {
    const timings = extractGlitchTimings();
    expect(Object.keys(timings).sort()).toEqual(
      ['borderFlicker', 'charSubstitution', 'elementJitter', 'frameFlash', 'glitchBars', 'noiseLines', 'vhsEvents'].sort()
    );
    expect(timings.charSubstitution).toEqual({ minCadence: 700, maxCadence: 1799, minDuration: 120, maxDuration: 349 });
    expect(timings.glitchBars).toEqual({ minCadence: 350, maxCadence: 999, minDuration: 80, maxDuration: 249, firePercent: 40 });
    expect(timings.vhsEvents).toEqual({ minCadence: 4000, maxCadence: 9999, minDuration: 80, maxDuration: 249 });
  });
});