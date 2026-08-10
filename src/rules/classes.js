import { hash } from '../core/hash.js';

export function getSignatureTier(calibrationCount) {
  if (calibrationCount >= 4) return 3;
  if (calibrationCount >= 2) return 2;
  return 1;
}

export function getSignature(classData, calibrationCount) {
  const tier = getSignatureTier(calibrationCount);
  return classData.signature.tiers[tier - 1];
}

export function canEquipWeapon(classData, weaponId) {
  return classData.equipmentGates.weapons.includes(weaponId);
}

export function canEquipArmor(classData, armorId) {
  return classData.equipmentGates.armor.includes(armorId);
}

export function canCastSchool(classData, schoolId) {
  return classData.protocolGates.schools.includes(schoolId);
}

export function maxProtocolTier(classData) {
  return classData.protocolGates.maxTier;
}

export function autoUpgradeSignature(calibrationCount) {
  return calibrationCount === 2 || calibrationCount === 4;
}

export function getCalibrationOptions(classData, worldSeed, characterId, floorNumber) {
  const pool = classData.calibrationOptions || {};
  const floorKey = String(floorNumber);
  const floorOptions = pool[floorKey];
  if (!floorOptions || floorOptions.length === 0) return [];
  const seedVal = hash(worldSeed, characterId, floorNumber);
  const count = Math.min(3, floorOptions.length);
  const selected = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const idx = (seedVal + i * 7) % floorOptions.length;
    if (!used.has(idx)) {
      used.add(idx);
      selected.push(floorOptions[idx]);
    }
  }
  return selected;
}

export function primaryAttributeCostReduction(classData, attributeId) {
  return classData.primaryAttribute === attributeId ? 1 : 0;
}