import { encodeSeed } from './state/save-encode.js';
import { decodeSeed } from './state/save-decode.js';

const ROUTES = Object.freeze(['title', 'creation', 'exploration', 'combat', 'library', 'scorecard', 'import', 'tutorial', 'settings']);
const ROUTE_SET = new Set(ROUTES);
const B32_RE = /^[A-Za-z0-9_-]+$/;

function isRoute(value) {
  return typeof value === 'string' && ROUTE_SET.has(value);
}

function stripHash(value) {
  if (typeof value !== 'string') return '';
  return value.startsWith('#') ? value.slice(1) : value;
}

function parseParams(body) {
  const params = new Map();
  if (!body) return params;
  for (const segment of body.split('&')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    const key = eq === -1 ? segment : segment.slice(0, eq);
    const value = eq === -1 ? '' : segment.slice(eq + 1);
    if (params.has(key)) return null;
    params.set(key, value);
  }
  return params;
}

export function parseFragment(hash) {
  const raw = stripHash(hash);
  if (!raw) return { kind: 'none' };
  if (raw.startsWith('r=')) {
    const fragment = raw.slice(2);
    return fragment ? { kind: 'run', fragment } : { kind: 'invalid' };
  }
  if (raw.startsWith('w=')) {
    const seed = raw.slice(2);
    return seed && B32_RE.test(seed) ? { kind: 'seed', seed } : { kind: 'invalid' };
  }
  if (!raw.startsWith('a=')) return { kind: 'invalid' };
  const segments = raw.slice(2).split('&');
  const routeValue = segments[0];
  if (!isRoute(routeValue)) return { kind: 'invalid' };
  const params = parseParams(segments.slice(1).join('&'));
  if (!params) return { kind: 'invalid' };
  const allowed = new Set(['save', 'seed', 'from']);
  for (const key of params.keys()) if (!allowed.has(key)) return { kind: 'invalid' };
  const save = params.get('save');
  if (save !== undefined && save !== 'current') return { kind: 'invalid' };
  const from = params.get('from');
  if (from !== undefined && !isRoute(from)) return { kind: 'invalid' };
  const seedField = params.get('seed');
  let seed = null;
  if (seedField !== undefined) {
    if (!seedField || !B32_RE.test(seedField)) return { kind: 'invalid' };
    const decoded = decodeSeed(seedField);
    if (!decoded.success) return { kind: 'invalid' };
    seed = decoded.seed >>> 0;
  }
  return {
    kind: 'route',
    route: routeValue,
    save: save === 'current' ? 'current' : null,
    seed,
    from: from || null
  };
}

export function buildFragment({ route, save, seed, from } = {}) {
  if (!isRoute(route)) return '';
  const parts = [`a=${route}`];
  if (save === 'current') parts.push('save=current');
  if (Number.isInteger(seed)) parts.push(`seed=${encodeSeed(seed >>> 0)}`);
  if (isRoute(from)) parts.push(`from=${from}`);
  return `#${parts.join('&')}`;
}

export function canonicalFragmentFor(screen, params = {}) {
  if (!isRoute(screen)) return '';
  if (screen === 'exploration' || screen === 'combat') {
    const worldSeed = params?.runState?.worldSeed;
    return buildFragment({
      route: 'exploration',
      save: 'current',
      seed: Number.isInteger(worldSeed) ? worldSeed >>> 0 : null
    });
  }
  if (screen === 'creation') {
    const preloaded = params?.preloadedSeed;
    let seed = null;
    if (Number.isInteger(preloaded)) seed = preloaded >>> 0;
    else if (typeof preloaded === 'string' && preloaded) {
      const decoded = decodeSeed(preloaded.replace(/^#?w=/, ''));
      if (decoded.success) seed = decoded.seed >>> 0;
    }
    return buildFragment({ route: 'creation', seed });
  }
  if (screen === 'scorecard') {
    const seed = Number.isInteger(params?.seed) ? params.seed >>> 0 : null;
    return buildFragment({ route: 'scorecard', seed });
  }
  if (screen === 'settings') {
    return buildFragment({ route: 'settings', from: isRoute(params?.from) ? params.from : null });
  }
  return buildFragment({ route: screen });
}

export function createHistoryController({ window: win, onNavigate }) {
  if (!win || typeof onNavigate !== 'function') return { start() {}, stop() {}, sync() {} };
  let started = false;
  let lastSynced = null;
  let suppress = false;
  let listener = null;

  function currentHash() {
    return win.location?.hash || '';
  }

  function handleHashChange() {
    if (suppress) {
      suppress = false;
      return;
    }
    const hash = currentHash();
    if (hash === lastSynced) return;
    lastSynced = hash;
    onNavigate(parseFragment(hash));
  }

  return {
    start() {
      if (started) return;
      started = true;
      lastSynced = currentHash();
      listener = handleHashChange;
      win.addEventListener('hashchange', listener);
    },
    stop() {
      if (!started) return;
      started = false;
      if (listener) win.removeEventListener('hashchange', listener);
      listener = null;
      lastSynced = null;
      suppress = false;
    },
    sync(screen, params, options = {}) {
      const fragment = canonicalFragmentFor(screen, params);
      if (!fragment) return;
      const current = currentHash();
      if (fragment === current) {
        lastSynced = fragment;
        return;
      }
      suppress = true;
      const href = fragment;
      if (options.push) win.history.pushState(null, '', href);
      else win.history.replaceState(null, '', href);
      lastSynced = fragment;
    }
  };
}

export { ROUTES };
