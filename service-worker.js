const CACHE_PREFIX = 'operator-descent-';
const CACHE_VERSION = '2026-08-23-gear-equip-save-v10';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const SHELL_ASSET = './index.html';
const FAILURE_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
const PRODUCTION_ASSETS = Object.freeze([
  './index.html',
  './service-worker.js',
  './styles/base.css',
  './styles/components.css',
  './styles/crt.css',
  './styles/icons.css',
  './styles/manual.css',
  './styles/tailwind.css',
  './styles/wide.css',
  './src/audio/chip.js',
  './src/audio/conductor.js',
  './src/audio/drone.js',
  './src/audio/engine.js',
  './src/audio/lead.js',
  './src/audio/noise-bed.js',
  './src/audio/pulse.js',
  './src/audio/sparkle.js',
  './src/core/hash.js',
  './src/core/prng.js',
  './src/core/rng-cursor.js',
  './src/data-loader.js',
  './src/exploration/lattice.js',
  './src/exploration/movement.js',
  './src/exploration/shadowcast.js',
  './src/floor/archetypes.js',
  './src/floor/generator.js',
  './src/floor/modifiers.js',
  './src/floor/validator.js',
  './src/glitch/glitch.js',
  './src/glitch/grain.js',
  './src/glitch/transitions.js',
  './src/glitch/crt-overlays.js',
  './src/main.js',
  './src/rules/attributes.js',
  './src/rules/classes.js',
  './src/rules/combat-geometry.js',
  './src/rules/combat.js',
  './src/rules/conditions.js',
  './src/rules/consumables.js',
  './src/rules/encounters.js',
  './src/rules/enemies.js',
  './src/rules/equipment.js',
  './src/rules/inventory.js',
  './src/rules/loot.js',
  './src/rules/progression.js',
  './src/rules/protocols.js',
  './src/rules/scaling.js',
  './src/router.js',
  './src/runtime.js',
  './src/state/bit-codec.js',
  './src/state/bus.js',
  './src/state/compress/pass-16bit.js',
  './src/state/compress/pass-1bit.js',
  './src/state/compress/pass-32bit.js',
  './src/state/compress/pass-4bit.js',
  './src/state/compress/pass-8bit.js',
  './src/state/compress/progressive.js',
  './src/state/condense.js',
  './src/state/encrypt.js',
  './src/state/library.js',
  './src/state/migrations/v3-to-v4.js',
  './src/state/migrations/v4-to-v5.js',
  './src/state/migrations/v5-to-v6.js',
  './src/state/party-configs.js',
  './src/state/run-state.js',
  './src/state/save-codecs.js',
  './src/state/save-decode.js',
  './src/state/save-encode.js',
  './src/state/save-migrate.js',
  './src/state/save-schema.js',
  './src/state/versions/codecs-v3.js',
  './src/state/versions/codecs-v4.js',
  './src/state/versions/codecs-v5.js',
  './src/state/versions/read-v3.js',
  './src/state/versions/read-v4.js',
  './src/state/versions/read-v5.js',
  './src/ui/components.js',
  './src/ui/console/combat.js',
  './src/ui/console/console.js',
  './src/ui/console/gear.js',
  './src/ui/console/log.js',
  './src/ui/console/loot.js',
  './src/ui/console/move.js',
  './src/ui/console/party.js',
  './src/ui/console/tech.js',
  './src/ui/creation-model.js',
  './src/ui/icon.js',
  './src/ui/input.js',
  './src/ui/layout.js',
  './src/ui/manual/manual-modal.js',
  './src/ui/manual/manual-view.js',
  './src/ui/playfield.js',
  './src/ui/screens/combat.js',
  './src/ui/screens/creation.js',
  './src/ui/screens/exploration.js',
  './src/ui/screens/import.js',
  './src/ui/screens/library.js',
  './src/ui/screens/scorecard.js',
  './src/ui/screens/settings.js',
  './src/ui/screens/title.js',
  './src/ui/screens/tutorial.js',
  './src/ui/scroll-memory.js',
  './src/ui/status-strip.js',
  './src/ui/viewport.js',
  './data/affixes.json',
  './data/classes.json',
  './data/conditions.json',
  './data/consumables.json',
  './data/enemies.json',
  './data/equipment.json',
  './data/manual.json',
  './data/protocols.json',
  './data/sigils.json',
  './data/symbol-table.json',
  './data/symbol-table.v3.json',
  './data/themes.json',
  './assets/descent-sigil.woff2',
  './assets/icons.svg',
]);

const SCOPE_URL = new URL(self.registration.scope);
const ASSET_URLS = new Set(PRODUCTION_ASSETS.map((asset) => normalizeURL(new URL(asset, SCOPE_URL))));
const SHELL_URL = normalizeURL(new URL(SHELL_ASSET, SCOPE_URL));

function normalizeURL(url) {
  const normalized = new URL(url.href);
  normalized.hash = '';
  normalized.search = '';
  return normalized.href;
}

function scopedAssetURLs() {
  return PRODUCTION_ASSETS.map((asset) => new URL(asset, SCOPE_URL).href);
}

function offlineResponse(message = 'Operator\'s Descent is offline and this request is not cached.') {
  return new Response(message, { status: 503, statusText: 'Offline', headers: FAILURE_HEADERS });
}

async function cachedShell() {
  const cached = await caches.match(SHELL_URL);
  return cached || caches.match(new URL(SHELL_ASSET, SCOPE_URL).href);
}

async function cacheFirstAsset(request) {
  const url = normalizeURL(new URL(request.url));
  const cached = await caches.match(url);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (!response || !response.ok) return response;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, response.clone());
    return response;
  } catch {
    return offlineResponse();
  }
}

async function navigationResponse(request) {
  const cached = await cachedShell();
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    return offlineResponse('Operator\'s Descent shell is unavailable offline.');
  }
}

async function networkOrSafeFailure(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineResponse();
  }
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isSameOrigin(url) {
  return url.origin === SCOPE_URL.origin;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(scopedAssetURLs()))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (isNavigationRequest(request)) {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (ASSET_URLS.has(normalizeURL(url))) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  event.respondWith(networkOrSafeFailure(request));
});
