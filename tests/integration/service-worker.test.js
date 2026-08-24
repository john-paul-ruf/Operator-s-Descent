import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SERVICE_WORKER_SOURCE = readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8');

class FakeResponse {
  constructor(body = '', init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.statusText = init.statusText || '';
    this.headers = init.headers || {};
    this.ok = this.status >= 200 && this.status < 300;
  }
  clone() { return new FakeResponse(this.body, { status: this.status, statusText: this.statusText, headers: this.headers }); }
  async text() { return this.body; }
}

class FakeCache {
  constructor() { this.entries = new Map(); }
  async addAll(urls) {
    for (const url of urls) this.entries.set(cacheKey(url), new FakeResponse(`cached:${cacheKey(url)}`));
  }
  async put(request, response) { this.entries.set(cacheKey(request), response); }
  async match(request) { return this.entries.get(cacheKey(request)); }
}

class FakeCaches {
  constructor() { this.stores = new Map(); }
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name);
  }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
  async match(request) {
    const key = cacheKey(request);
    for (const cache of this.stores.values()) {
      const match = await cache.match(key);
      if (match) return match;
    }
    return undefined;
  }
}

function cacheKey(request) {
  return typeof request === 'string' ? request : request.url;
}

function extractManifest() {
  const match = SERVICE_WORKER_SOURCE.match(/const\s+PRODUCTION_ASSETS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function extractCacheName() {
  const prefixMatch = SERVICE_WORKER_SOURCE.match(/const\s+CACHE_PREFIX\s*=\s*'([^']+)';/);
  const versionMatch = SERVICE_WORKER_SOURCE.match(/const\s+CACHE_VERSION\s*=\s*'([^']+)';/);
  return `${prefixMatch[1]}${versionMatch[1]}`;
}

const CACHE_NAME_PATTERN = /^operator-descent-\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/;

function createEvent(request) {
  const pending = [];
  const responses = [];
  return {
    request,
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    respondWith(promise) { responses.push(Promise.resolve(promise)); },
    async settle() { await Promise.all(pending); },
    async response() { return responses.length ? responses[0] : undefined; },
    get responded() { return responses.length > 0; }
  };
}

function loadWorker() {
  const listeners = new Map();
  const caches = new FakeCaches();
  const fetch = vi.fn((request) => {
    const url = cacheKey(request);
    if (url.includes('/missing')) return Promise.reject(new Error('offline'));
    return Promise.resolve(new FakeResponse(`network:${url}`));
  });
  const self = {
    registration: { scope: 'https://example.test/game/' },
    clients: { claim: vi.fn(() => Promise.resolve()), matchAll: vi.fn(() => Promise.resolve([])) },
    skipWaiting: vi.fn(() => Promise.resolve()),
    addEventListener(type, handler) { listeners.set(type, handler); }
  };
  vm.runInNewContext(SERVICE_WORKER_SOURCE, { self, caches, fetch, Response: FakeResponse, URL, console });
  return { listeners, caches, fetch, self };
}

function createMessageEvent(data, source) {
  const pending = [];
  return {
    data,
    source,
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    async settle() { await Promise.all(pending); }
  };
}

describe('service worker manifest', () => {
  it('lists only production assets needed for offline play', () => {
    const manifest = extractManifest();
    expect(manifest.length).toBeGreaterThan(0);
    expect(manifest.every((asset) => asset.startsWith('./'))).toBe(true);
    expect(manifest).toContain('./index.html');
    expect(manifest).toContain('./service-worker.js');
    expect(manifest).toContain('./src/runtime.js');
    expect(manifest).toContain('./src/state/bit-codec.js');
    expect(manifest).toContain('./src/rules/progression.js');
    expect(manifest).toContain('./src/ui/console/gear.js');
    expect(manifest).toContain('./styles/components.css');
    expect(manifest).toContain('./data/sigils.json');
    expect(manifest).toContain('./assets/descent-sigil.woff2');
    expect(manifest).toContain('./data/symbol-table.v6.json');
    expect(manifest).toContain('./src/state/migrations/v6-to-v7.js');
    expect(manifest).toContain('./src/state/versions/codecs-v6.js');
    expect(manifest).toContain('./src/state/versions/read-v6.js');
    expect(manifest.some((asset) => /^(\.\/)?(tests|program|specs|mocks|tools|font-src|node_modules|docs)\//.test(asset))).toBe(false);
    expect(new Set(manifest).size).toBe(manifest.length);
  });
});

describe('service worker cache version — v15 → v16 release', () => {
  const PREDECESSOR_CACHE = 'operator-descent-2026-08-24-direct-actions-v15';

  it('install precaches the full v16 manifest immediately and never calls skipWaiting automatically; activation deletes the exact v15 predecessor and claims clients', async () => {
    const manifest = extractManifest();
    const expectedCacheName = extractCacheName();
    expect(expectedCacheName).toBe('operator-descent-2026-08-24-manifest-drift-hotfix-v16');
    expect(expectedCacheName).toMatch(CACHE_NAME_PATTERN);
    const worker = loadWorker();
    await worker.caches.open(PREDECESSOR_CACHE);

    const install = createEvent();
    worker.listeners.get('install')(install);
    await install.settle();

    const namesAfterInstall = await worker.caches.keys();
    expect(namesAfterInstall).toContain(expectedCacheName);
    expect(worker.caches.stores.get(expectedCacheName).entries.size).toBe(manifest.length);
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    expect(worker.self.clients.claim).not.toHaveBeenCalled();

    const activate = createEvent();
    worker.listeners.get('activate')(activate);
    await activate.settle();

    const namesAfterActivate = await worker.caches.keys();
    expect(namesAfterActivate).toContain(expectedCacheName);
    expect(namesAfterActivate).not.toContain(PREDECESSOR_CACHE);
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
  });

  it('v16 precaches at install without disturbing the still-active v15 cache; a v15-style isolated lookup on its own cache name never sees v16 bytes', async () => {
    const worker = loadWorker();
    const v15Cache = await worker.caches.open(PREDECESSOR_CACHE);
    await v15Cache.put('https://example.test/game/index.html', new FakeResponse('v15-shell'));

    const install = createEvent();
    worker.listeners.get('install')(install);
    await install.settle();

    // The real active v15 worker's cacheFirstAsset()/cachedShell() read only from its
    // own closed-over CACHE_NAME (v15's), so it can never observe v16's waiting bytes.
    const v15Match = await v15Cache.match('https://example.test/game/index.html');
    expect(await v15Match.text()).toBe('v15-shell');

    const v16Cache = await worker.caches.open(extractCacheName());
    expect(v16Cache.entries.size).toBe(extractManifest().length);
  });

  it('cache-first and navigation fetch paths read only from the versioned CACHE_NAME, never a foreign cache', async () => {
    const worker = loadWorker();
    const install = createEvent();
    worker.listeners.get('install')(install);
    await install.settle();
    const activate = createEvent();
    worker.listeners.get('activate')(activate);
    await activate.settle();

    const staleCache = await worker.caches.open('operator-descent-stale-version');
    await staleCache.put('https://example.test/game/src/main.js', new FakeResponse('stale-content'));
    await staleCache.put('https://example.test/game/index.html', new FakeResponse('stale-shell'));

    const asset = createEvent({ method: 'GET', url: 'https://example.test/game/src/main.js', mode: 'same-origin', destination: 'script' });
    worker.listeners.get('fetch')(asset);
    await expect(asset.response().then((response) => response.text())).resolves.not.toBe('stale-content');

    const navigation = createEvent({ method: 'GET', url: 'https://example.test/game/depth/2', mode: 'navigate', destination: 'document' });
    worker.listeners.get('fetch')(navigation);
    await expect(navigation.response().then((response) => response.text())).resolves.not.toBe('stale-shell');
  });

  it('the v16 manifest ships the PWA manifest and every launcher icon as production/offline assets', () => {
    const manifest = extractManifest();
    for (const asset of ['./manifest.webmanifest', './assets/app-icon.svg', './assets/app-icon-180.png', './assets/app-icon-192.png', './assets/app-icon-512.png']) {
      expect(manifest).toContain(asset);
    }
    expect(new Set(manifest).size).toBe(manifest.length);
  });
});

describe('service worker lifecycle', () => {
  it('deletes only older Operator caches on activation, leaving unrelated caches untouched', async () => {
    const worker = loadWorker();
    await worker.caches.open('operator-descent-old');
    await worker.caches.open('unrelated-cache');

    const install = createEvent();
    worker.listeners.get('install')(install);
    await install.settle();

    const activate = createEvent();
    worker.listeners.get('activate')(activate);
    await activate.settle();

    const namesAfterActivate = await worker.caches.keys();
    expect(namesAfterActivate).toContain(extractCacheName());
    expect(namesAfterActivate).toContain('unrelated-cache');
    expect(namesAfterActivate).not.toContain('operator-descent-old');
  });
});

describe('service worker fetch strategy', () => {
  it('uses cache-first assets, navigation fallback, and ignores foreign or non-GET requests', async () => {
    const worker = loadWorker();
    const install = createEvent();
    worker.listeners.get('install')(install);
    await install.settle();
    const activate = createEvent();
    worker.listeners.get('activate')(activate);
    await activate.settle();

    const asset = createEvent({ method: 'GET', url: 'https://example.test/game/src/main.js?rev=1', mode: 'same-origin', destination: 'script' });
    worker.listeners.get('fetch')(asset);
    await expect(asset.response().then((response) => response.text())).resolves.toContain('/game/src/main.js');
    expect(worker.fetch).not.toHaveBeenCalled();

    const navigation = createEvent({ method: 'GET', url: 'https://example.test/game/depth/2', mode: 'navigate', destination: 'document' });
    worker.listeners.get('fetch')(navigation);
    await expect(navigation.response().then((response) => response.text())).resolves.toContain('/game/index.html');

    const post = createEvent({ method: 'POST', url: 'https://example.test/game/data/sigils.json', mode: 'same-origin', destination: '' });
    worker.listeners.get('fetch')(post);
    expect(post.responded).toBe(false);

    const foreign = createEvent({ method: 'GET', url: 'https://cdn.example.test/game/src/main.js', mode: 'cors', destination: 'script' });
    worker.listeners.get('fetch')(foreign);
    expect(foreign.responded).toBe(false);
  });

  it('returns a safe offline response for uncached same-origin GET failures', async () => {
    const worker = loadWorker();
    const miss = createEvent({ method: 'GET', url: 'https://example.test/game/missing.dat', mode: 'same-origin', destination: '' });
    worker.listeners.get('fetch')(miss);
    const response = await miss.response();

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toContain('offline');
  });
});

describe('service worker consent-gated activation', () => {
  it('ignores any message that is not SKIP_WAITING', async () => {
    const worker = loadWorker();
    const event = createMessageEvent({ type: 'PING' });
    worker.listeners.get('message')(event);
    await event.settle();

    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
  });

  it('activates when exactly one in-scope app window is open', async () => {
    const worker = loadWorker();
    worker.self.clients.matchAll = vi.fn(() => Promise.resolve([
      { url: 'https://example.test/game/', postMessage: vi.fn() }
    ]));
    const source = { postMessage: vi.fn() };

    const event = createMessageEvent({ type: 'SKIP_WAITING' }, source);
    worker.listeners.get('message')(event);
    await event.settle();

    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it('defers and reports the client count when more than one in-scope app window is open', async () => {
    const worker = loadWorker();
    worker.self.clients.matchAll = vi.fn(() => Promise.resolve([
      { url: 'https://example.test/game/', postMessage: vi.fn() },
      { url: 'https://example.test/game/depth/2', postMessage: vi.fn() }
    ]));
    const source = { postMessage: vi.fn() };

    const event = createMessageEvent({ type: 'SKIP_WAITING' }, source);
    worker.listeners.get('message')(event);
    await event.settle();

    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenCalledWith({ type: 'UPDATE_DEFERRED_MULTI_CLIENT', clientCount: 2 });
  });

  it('ignores windows outside the registration scope when counting in-scope clients', async () => {
    const worker = loadWorker();
    worker.self.clients.matchAll = vi.fn(() => Promise.resolve([
      { url: 'https://example.test/game/', postMessage: vi.fn() },
      { url: 'https://example.test/other-app/', postMessage: vi.fn() }
    ]));
    const source = { postMessage: vi.fn() };

    const event = createMessageEvent({ type: 'SKIP_WAITING' }, source);
    worker.listeners.get('message')(event);
    await event.settle();

    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    expect(source.postMessage).not.toHaveBeenCalled();
  });
});
