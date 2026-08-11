export const INVENTORY_CAP = 100;

const units = item => Number.isInteger(item?.count) ? item.count : 1;
const ITEM_FIELDS = new Set(['id', 'category', 'baseType', 'rarity', 'affixes', 'corrupt', 'corruptionValue', 'stats', 'salvageValue', 'junkTagged', 'count', 'extensions']);

const copy = item => {
  const extensions = { ...(item?.extensions ?? {}) };
  for (const [key, value] of Object.entries(item ?? {})) {
    if (!ITEM_FIELDS.has(key)) extensions[key] = value;
  }
  return {
    id: item?.id,
    category: item?.category,
    baseType: item?.baseType,
    ...(item?.rarity === undefined ? {} : { rarity: item.rarity }),
    affixes: [...(item?.affixes ?? [])],
    ...(item?.corrupt === undefined ? {} : { corrupt: Boolean(item.corrupt) }),
    ...(item?.corruptionValue === undefined ? {} : { corruptionValue: item.corruptionValue }),
    stats: { ...(item?.stats ?? {}) },
    salvageValue: item?.salvageValue,
    junkTagged: Boolean(item?.junkTagged),
    ...(item?.count === undefined ? {} : { count: item.count }),
    ...(Object.keys(extensions).length ? { extensions } : {})
  };
};

export function getInventoryCount(inventory = []) {
  return inventory.reduce((total, item) => total + units(item), 0);
}

export function addItem(inventory = [], item) {
  const count = units(item);
  if (!item || count < 1 || getInventoryCount(inventory) + count > INVENTORY_CAP) return { success: false, reason: 'inventory_full', inventory };
  const stackIndex = item.category === 'consumable' ? inventory.findIndex(entry => entry.category === 'consumable' && entry.baseType === item.baseType && !entry.junkTagged) : -1;
  if (stackIndex < 0) return { success: true, inventory: [...inventory, copy(item)], addedUnits: count };
  const next = inventory.map((entry, index) => index === stackIndex ? { ...copy(entry), count: units(entry) + count } : copy(entry));
  return { success: true, inventory: next, addedUnits: count, stackedId: next[stackIndex].id };
}

export function removeItem(inventory = [], itemId, count = 1) {
  if (!Number.isInteger(count) || count < 1) return { success: false, reason: 'invalid_count', inventory };
  const index = inventory.findIndex(item => item.id === itemId);
  if (index < 0 || units(inventory[index]) < count) return { success: false, reason: 'missing_item', inventory, removedItem: null };
  const item = inventory[index];
  const next = units(item) === count
    ? [...inventory.slice(0, index).map(copy), ...inventory.slice(index + 1).map(copy)]
    : inventory.map((entry, entryIndex) => entryIndex === index ? { ...copy(entry), count: units(entry) - count } : copy(entry));
  return { success: true, inventory: next, removedItem: copy(item), removedUnits: count };
}

export function toggleJunkTag(inventory = [], itemId) {
  const found = inventory.some(item => item.id === itemId);
  if (!found) return { success: false, reason: 'missing_item', inventory };
  const next = inventory.map(item => item.id === itemId ? { ...copy(item), junkTagged: !item.junkTagged } : copy(item));
  return { success: true, inventory: next, junkTagged: next.find(item => item.id === itemId).junkTagged };
}

export function junkAllTagged(inventory = []) {
  const tagged = inventory.filter(item => item.junkTagged);
  const destroyedUnits = tagged.reduce((total, item) => total + units(item), 0);
  const scrapGained = tagged.reduce((total, item) => total + (Number(item.salvageValue) || 0) * units(item), 0);
  return { success: true, inventory: inventory.filter(item => !item.junkTagged).map(copy), scrapGained, destroyedIds: tagged.map(item => item.id), destroyedUnits };
}

export function getSalvageValue(item) {
  return (Number(item?.salvageValue) || 0) * units(item);
}

export function isFull(inventory = []) {
  return getInventoryCount(inventory) >= INVENTORY_CAP;
}
