import { describe, expect, it } from 'vitest';
import { INVENTORY_CAP, addItem, getInventoryCount, isFull, junkAllTagged, removeItem, toggleJunkTag } from '../../src/rules/inventory.js';

const consumable = (id, count = 1, extra = {}) => ({ id, category: 'consumable', baseType: 'repair_patch', count, affixes: [], stats: {}, salvageValue: 2, junkTagged: false, ...extra });

describe('stack-aware inventory', () => {
  it('counts units, not entries, against the hard cap', () => {
    // saves-never-fail SESSION-01 CP3 dropped the cap 100 → 40 so the
    // reachable apex encodes under SAVE_BUDGET without event-tail trimming.
    expect(INVENTORY_CAP).toBe(40);
    const inventory = [consumable('patches', INVENTORY_CAP - 1)];
    expect(addItem(inventory, consumable('next', 2))).toMatchObject({ success: false, reason: 'inventory_full', inventory });
    expect(getInventoryCount(inventory)).toBe(INVENTORY_CAP - 1);
    expect(isFull([consumable('full', INVENTORY_CAP)])).toBe(true);
  });

  it('merges identical consumable stacks without mutating its input', () => {
    const inventory = [consumable('patches', 2)];
    const result = addItem(inventory, consumable('new_patch', 3));
    expect(result).toMatchObject({ success: true, addedUnits: 3, stackedId: 'patches' });
    expect(result.inventory).toEqual([consumable('patches', 5)]);
    expect(inventory[0].count).toBe(2);
  });

  it('removes one unit from a stack and atomically rejects too many', () => {
    const inventory = [consumable('patches', 2)];
    expect(removeItem(inventory, 'patches')).toMatchObject({ success: true, removedUnits: 1, inventory: [consumable('patches', 1)] });
    expect(removeItem(inventory, 'patches', 3)).toMatchObject({ success: false, reason: 'missing_item', inventory });
  });

  it('toggles persistent junk tags immutably', () => {
    const inventory = [consumable('patches')];
    const result = toggleJunkTag(inventory, 'patches');
    expect(result).toMatchObject({ success: true, junkTagged: true });
    expect(result.inventory[0].junkTagged).toBe(true);
    expect(inventory[0].junkTagged).toBe(false);
  });

  it('salvages every tagged unit and returns destruction evidence', () => {
    const inventory = [consumable('patches', 3, { junkTagged: true, salvageValue: 2 }), { id: 'weapon', category: 'weapon', affixes: [], stats: {}, salvageValue: 5, junkTagged: true }];
    expect(junkAllTagged(inventory)).toMatchObject({ success: true, inventory: [], scrapGained: 11, destroyedIds: ['patches', 'weapon'], destroyedUnits: 4 });
  });
});
