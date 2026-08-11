import { describe, expect, it } from 'vitest';
import { checkGlitchTimings } from '../../scripts/design-scan/check-effects.js';

describe('check-effects', () => {
  it('reports no glitch timing mismatches against the current repo', async () => {
    expect(await checkGlitchTimings()).toEqual([]);
  });
});