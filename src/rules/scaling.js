export function enemyStatScale(baseStat, depth) {
  const multiplier = 0.15 + 0.10 * Math.floor(depth / 10);
  return Math.floor(baseStat * (1 + depth * multiplier));
}

export function enemyCountScale(baseCount, depth) {
  return baseCount + Math.floor(depth / 5);
}

export function lootRarityShift(depth) {
  return Math.floor(depth / 5);
}

export function dangerClockBaseRate(depth) {
  return 0.01 + depth * 0.002;
}

export function corruptionDangerRate(corruption) {
  return corruption * 0.003;
}

export function calibrationFloor(depth) {
  return depth > 0 && depth % 3 === 0;
}

export function thresholdFloor(depth) {
  return depth > 0 && depth % 10 === 0;
}