import { describe, expect, it } from 'vitest';
import { checkScreenInventory, checkConsoleModeInventory } from '../../scripts/design-scan/check-screen-inventory.js';

describe('check-screen-inventory', () => {
  it('reports no gaps in the 9-screen inventory against the current repo', () => {
    expect(checkScreenInventory()).toEqual([]);
  });

  it('reports no gaps in the 7-console-mode inventory against the current repo', () => {
    expect(checkConsoleModeInventory()).toEqual([]);
  });
});