const offsets = new Map();
const CAP = 64;

function schedule(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else fn();
}

function toKey(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function captureScroll(element, key) {
  const storeKey = toKey(key);
  if (!storeKey || !element) return;
  const top = Number(element.scrollTop);
  if (!Number.isFinite(top) || top < 0) return;
  if (offsets.has(storeKey)) offsets.delete(storeKey);
  offsets.set(storeKey, top);
  while (offsets.size > CAP) {
    const oldest = offsets.keys().next().value;
    if (oldest === undefined) break;
    offsets.delete(oldest);
  }
}

export function restoreScroll(element, key) {
  const storeKey = toKey(key);
  if (!storeKey || !element) return;
  if (!offsets.has(storeKey)) return;
  const stored = offsets.get(storeKey);
  const apply = () => {
    if (!element || element.isConnected === false) return;
    const max = Math.max(0, Number(element.scrollHeight || 0) - Number(element.clientHeight || 0));
    const target = Math.min(stored, Number.isFinite(max) ? max : stored);
    element.scrollTop = target < 0 ? 0 : target;
  };
  apply();
  if (Number(element.scrollTop) < stored) schedule(apply);
}

export function preserveScroll(element, key, render) {
  captureScroll(element, key);
  const result = typeof render === 'function' ? render() : undefined;
  restoreScroll(element, key);
  return result;
}

export function clearScrollMemory(prefix) {
  if (prefix === undefined || prefix === null) {
    offsets.clear();
    return;
  }
  const needle = String(prefix);
  for (const key of [...offsets.keys()]) {
    if (key.startsWith(needle)) offsets.delete(key);
  }
}
