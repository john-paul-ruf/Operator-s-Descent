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
  // Halved from 0.01+0.002*depth: traversal doubles at 40x64, so per-floor
  // danger accrual stays ~constant with the pre-flip 20x32 budget.
  return 0.005 + depth * 0.001;
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