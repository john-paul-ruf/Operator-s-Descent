const KEY_CONFIGS = 'od_party_configs';
const KEY_LAST_USED = 'od_party_config_last_used';
const MAX_CONFIGS = 10;

function getStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveConfig(name, blueprint) {
  const storage = getStorage();
  if (!storage) return { success: false, error: 'no_storage' };

  const configs = listConfigs();
  const existingIdx = configs.findIndex(c => c.name === name);

  if (existingIdx < 0 && configs.length >= MAX_CONFIGS) {
    return { success: false, error: 'max_reached' };
  }

  if (existingIdx >= 0) {
    configs[existingIdx] = { name, ...blueprint, savedAt: Date.now() };
  } else {
    configs.push({ name, ...blueprint, savedAt: Date.now() });
  }

  storage.setItem(KEY_CONFIGS, JSON.stringify(configs));
  return { success: true, configs };
}

export function loadConfig(name) {
  const configs = listConfigs();
  return configs.find(c => c.name === name) || null;
}

export function listConfigs() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    return JSON.parse(storage.getItem(KEY_CONFIGS) || '[]');
  } catch {
    return [];
  }
}

export function deleteConfig(name) {
  const storage = getStorage();
  if (!storage) return;
  const configs = listConfigs().filter(c => c.name !== name);
  storage.setItem(KEY_CONFIGS, JSON.stringify(configs));
}

export function getLastUsed() {
  const storage = getStorage();
  if (!storage) return null;
  const name = storage.getItem(KEY_LAST_USED);
  return name ? loadConfig(name) : null;
}

export function setLastUsed(name) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(KEY_LAST_USED, name);
}

export function validateConfig(blueprint, gameData) {
  const invalidItems = [];

  if (blueprint.characters) {
    for (const char of blueprint.characters) {
      if (gameData?.classes && !gameData.classes.classes?.[char.classId]) {
        invalidItems.push({ field: 'class', value: char.classId });
      }
      if (char.equipment) {
        if (char.equipment.weapon && gameData?.equipment) {
          if (!gameData.equipment.weapons?.[char.equipment.weapon]) {
            invalidItems.push({ field: 'weapon', value: char.equipment.weapon });
          }
        }
        if (char.equipment.armor && gameData?.equipment) {
          if (!gameData.equipment.armor?.[char.equipment.armor]) {
            invalidItems.push({ field: 'armor', value: char.equipment.armor });
          }
        }
      }
    }
  }

  return { valid: invalidItems.length === 0, invalidItems };
}