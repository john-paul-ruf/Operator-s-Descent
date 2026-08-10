import { describe, it, expect } from 'vitest';
import {
  INVENTORY_CAP,
  addItem,
  removeItem,
  toggleJunkTag,
  junkAllTagged,
  getSalvageValue,
  getInventoryCount,
  isFull,
} from '../../src/rules/inventory.js';

describe('INVENTORY_CAP', () => {
  it('=== 100', () => {
    expect(INVENTORY_CAP).toBe(100);
  });
});

describe('addItem', () => {
  it('returns new array (original unmodified, success: true)', () => {
    const inv = [{ id: 'a' }];
    const result = addItem(inv, { id: 'b' });
    expect(result.success).toBe(true);
    expect(result.inventory).toHaveLength(2);
    expect(inv).toHaveLength(1);
    expect(result.inventory).not.toBe(inv);
  });
  it('at 100 items → {success: false} and same array reference back', () => {
    const inv = Array.from({ length: 100 }, (_, i) => ({ id: `item_${i}` }));
    const result = addItem(inv, { id: 'new' });
    expect(result.success).toBe(false);
    expect(result.inventory).toBe(inv);
  });
});

describe('removeItem', () => {
  it('missing id → {removedItem: null} and same contents', () => {
    const inv = [{ id: 'a' }, { id: 'b' }];
    const result = removeItem(inv, 'nonexistent');
    expect(result.removedItem).toBeNull();
    expect(result.inventory).toEqual(inv);
  });
  it('found → removed item returned, new array length -1, original untouched', () => {
    const inv = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = removeItem(inv, 'b');
    expect(result.removedItem).toEqual({ id: 'b' });
    expect(result.inventory).toHaveLength(2);
    expect(result.inventory).not.toBe(inv);
    expect(inv).toHaveLength(3);
  });
});

describe('toggleJunkTag', () => {
  it('flips junked on the item in place (returns same array ref)', () => {
    const inv = [{ id: 'a', junked: false }];
    const result = toggleJunkTag(inv, 'a');
    expect(result.isJunked).toBe(true);
    expect(result.inventory).toBe(inv);
    expect(inv[0].junked).toBe(true);
  });
  it('missing id → {isJunked: false}', () => {
    const inv = [{ id: 'a' }];
    const result = toggleJunkTag(inv, 'nonexistent');
    expect(result.isJunked).toBe(false);
  });
});

describe('junkAllTagged', () => {
  it('mixed inventory: only untagged remain in order', () => {
    const inv = [
      { id: 'a', junked: true, salvageValue: 2 },
      { id: 'b', junked: false },
      { id: 'c', junked: true, salvageValue: 3 },
      { id: 'd', junked: false },
    ];
    const result = junkAllTagged(inv, 5);
    expect(result.inventory.map(i => i.id)).toEqual(['b', 'd']);
  });
  it('scrapGained = sum of salvageValue of tagged', () => {
    const inv = [
      { id: 'a', junked: true, salvageValue: 2 },
      { id: 'b', junked: true, salvageValue: 3 },
    ];
    const result = junkAllTagged(inv, 0);
    expect(result.scrapGained).toBe(5);
  });
  it('missing salvageValue counts 0', () => {
    const inv = [{ id: 'a', junked: true }];
    const result = junkAllTagged(inv, 0);
    expect(result.scrapGained).toBe(0);
  });
  it('itemsDestroyed count', () => {
    const inv = [
      { id: 'a', junked: true, salvageValue: 1 },
      { id: 'b', junked: false },
      { id: 'c', junked: true, salvageValue: 1 },
    ];
    const result = junkAllTagged(inv, 0);
    expect(result.itemsDestroyed).toBe(2);
  });
  it('scrapCounter accumulates from prior value', () => {
    const inv = [{ id: 'a', junked: true, salvageValue: 5 }];
    const result = junkAllTagged(inv, 10);
    expect(result.scrapCounter).toBe(15);
  });
  it('scrapCounter with undefined prior → gained only', () => {
    const inv = [{ id: 'a', junked: true, salvageValue: 5 }];
    const result = junkAllTagged(inv, undefined);
    expect(result.scrapCounter).toBe(5);
  });
});

describe('getInventoryCount', () => {
  it('returns inventory length', () => {
    expect(getInventoryCount([{ id: 'a' }, { id: 'b' }])).toBe(2);
  });
});

describe('isFull', () => {
  it('99 → false', () => {
    const inv = Array.from({ length: 99 }, (_, i) => ({ id: `i${i}` }));
    expect(isFull(inv)).toBe(false);
  });
  it('100 → true', () => {
    const inv = Array.from({ length: 100 }, (_, i) => ({ id: `i${i}` }));
    expect(isFull(inv)).toBe(true);
  });
});

describe('getSalvageValue', () => {
  it('{salvageValue: 3} → 3', () => {
    expect(getSalvageValue({ salvageValue: 3 })).toBe(3);
  });
  it('default 0', () => {
    expect(getSalvageValue({})).toBe(0);
  });
});