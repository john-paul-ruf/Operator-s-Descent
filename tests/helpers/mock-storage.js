export function installMockStorage() {
  const map = new Map();
  const mock = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; }
  };
  globalThis.localStorage = mock;
  return { map, uninstall: () => { delete globalThis.localStorage; } };
}