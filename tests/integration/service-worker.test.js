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
    clients: { claim: vi.fn(() => Promise.resolve()) },
    skipWaiting: vi.fn(() => Promise.resolve()),
    addEventListener(type, handler) { listeners.set(type, handler); }
  };
  vm.runInNewContext(SERVICE_WORKER_SOURCE, { self, caches, fetch, Response: FakeResponse, URL, console });
  return { listeners, caches, fetch, self };
}

describe('service worker manifest', () => {
  it('lists only production assets needed for offline play', () => {
    const manifest = extractManifest();
    expect(manifest).toHaveLength(91);
    expect(manifest).toContain('./index.html');
    expect(manifest).toContain('./service-worker.js');
    expect(manifest).toContain('./src/runtime.js');
    expect(manifest).toContain('./src/state/bit-codec.js');
    expect(manifest).toContain('./src/rules/progression.js');
    expect(manifest).toContain('./data/sigils.json');
    expect(manifest).toContain('./assets/descent-sigil.woff2');
    expect(manifest.some((asset) => /^(\.\/)?(tests|program|specs|mocks|tools|font-src|node_modules|docs)\//.test(asset))).toBe(false);
    expect(new Set(manifest).size).toBe(manifest.length);
  });
});

describe('service worker lifecycle', () => {
  it('precaches the full versioned manifest and deletes only older Operator caches', async () => {
    const manifest = extractManifest();
    const worker = loadWorker();
    await worker.caches.open('operator-descent-old');
    await worker.caches.open('unrelated-cache');

    const install = createEvent();
    worker.listeners.get('install')(install);
    await install.settle();

    const namesAfterInstall = await worker.caches.keys();
    const cacheName = namesAfterInstall.find((name) => name.startsWith('operator-descent-') && name !== 'operator-descent-old');
    expect(cacheName).toMatch(/^operator-descent-2026-08-11-release-v1$/);
    expect(worker.caches.stores.get(cacheName).entries.size).toBe(manifest.length);
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();

    const activate = createEvent();
    worker.listeners.get('activate')(activate);
    await activate.settle();

    const namesAfterActivate = await worker.caches.keys();
    expect(namesAfterActivate).toContain('operator-descent-2026-08-11-release-v1');
    expect(namesAfterActivate).toContain('unrelated-cache');
    expect(namesAfterActivate).not.toContain('operator-descent-old');
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
  });
});

describe('service worker fetch strategy', () => {
  it('uses cache-first assets, navigation fallback, and ignores foreign or non-GET requests', async () => {
    const worker = loadWorker();
    const install = createEvent();
    worker.listeners.get('install')(install);
    await install.settle();

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
