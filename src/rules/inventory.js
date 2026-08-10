export const INVENTORY_CAP = 100;

export function addItem(inventory, item) {
  if (inventory.length >= INVENTORY_CAP) {
    return { success: false, inventory };
  }
  return { success: true, inventory: [...inventory, item] };
}

export function removeItem(inventory, itemId) {
  const idx = inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return { inventory, removedItem: null };
  const removedItem = inventory[idx];
  const newInv = [...inventory.slice(0, idx), ...inventory.slice(idx + 1)];
  return { inventory: newInv, removedItem };
}

export function toggleJunkTag(inventory, itemId) {
  const item = inventory.find(i => i.id === itemId);
  if (!item) return { inventory, isJunked: false };
  item.junked = !item.junked;
  return { inventory, isJunked: item.junked };
}

export function junkAllTagged(inventory, scrapCounter) {
  const tagged = inventory.filter(i => i.junked);
  const remaining = inventory.filter(i => !i.junked);
  const scrapGained = tagged.reduce((sum, i) => sum + (i.salvageValue || 0), 0);
  return {
    inventory: remaining,
    scrapGained,
    itemsDestroyed: tagged.length,
    scrapCounter: (scrapCounter || 0) + scrapGained
  };
}

export function getSalvageValue(item) {
  return item.salvageValue || 0;
}

export function getInventoryCount(inventory) {
  return inventory.length;
}

export function isFull(inventory) {
  return inventory.length >= INVENTORY_CAP;
}