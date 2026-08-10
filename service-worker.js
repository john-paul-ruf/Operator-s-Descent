const CACHE_VERSION = 'od-v1';
const CACHE_NAME = `operator-descent-${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './styles/base.css',
  './styles/crt.css',
  './styles/components.css',
  './src/main.js',
  './src/state/bus.js',
  // Data files
  './data/sigils.json',
  './data/themes.json',
  './data/classes.json',
  './data/protocols.json',
  './data/enemies.json',
  './data/equipment.json',
  './data/affixes.json',
  './data/conditions.json',
  './data/consumables.json',
  './data/symbol-table.json',
  // Font
  './assets/descent-sigil.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'))
    )
  );
});