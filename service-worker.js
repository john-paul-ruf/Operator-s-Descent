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
  './src/core/prng.js',
  './src/core/hash.js',
  './src/core/rng-cursor.js',
  './src/rules/attributes.js',
  './src/rules/scaling.js',
  './src/rules/classes.js',
  './src/rules/equipment.js',
  './src/rules/conditions.js',
  './src/rules/protocols.js',
  './src/rules/consumables.js',
  './src/rules/loot.js',
  './src/rules/enemies.js',
  './src/rules/combat.js',
  './src/rules/inventory.js',
  './src/floor/archetypes.js',
  './src/floor/modifiers.js',
  './src/floor/validator.js',
  './src/floor/generator.js',
  './src/exploration/lattice.js',
  './src/exploration/shadowcast.js',
  './src/exploration/movement.js',
  './src/state/run-state.js',
  './src/state/condense.js',
  './src/state/compress/progressive.js',
  './src/state/compress/pass-1bit.js',
  './src/state/compress/pass-4bit.js',
  './src/state/compress/pass-8bit.js',
  './src/state/compress/pass-16bit.js',
  './src/state/compress/pass-32bit.js',
  './src/state/encrypt.js',
  './src/state/save-encode.js',
  './src/state/save-decode.js',
  './src/state/library.js',
  './src/state/party-configs.js',
  './src/audio/drone.js',
  './src/audio/pulse.js',
  './src/audio/sparkle.js',
  './src/audio/lead.js',
  './src/audio/noise-bed.js',
  './src/audio/engine.js',
  './src/glitch/glitch.js',
  './src/glitch/grain.js',
  './src/glitch/transitions.js',
  './src/ui/components.js',
  './src/ui/input.js',
  './src/ui/playfield.js',
  './src/ui/status-strip.js',
  './src/ui/console/console.js',
  './src/ui/console/move.js',
  './src/ui/console/combat.js',
  './src/ui/console/party.js',
  './src/ui/console/gear.js',
  './src/ui/console/tech.js',
  './src/ui/console/loot.js',
  './src/ui/console/log.js',
  './src/ui/screens/title.js',
  './src/ui/screens/creation.js',
  './src/ui/screens/exploration.js',
  './src/ui/screens/combat.js',
  './src/ui/screens/library.js',
  './src/ui/screens/scorecard.js',
  './src/ui/screens/import.js',
  './src/ui/screens/tutorial.js',
  './src/ui/screens/settings.js',
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