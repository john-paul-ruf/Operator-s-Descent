# Architecture Detail — Bootstrap, Runtime, and Offline Shell

## Modules

| IDs | Area | Owns |
|---|---|---|
| M80 | HTML shell | Cold title host, CSS links, viewport, font declaration |
| M81 | Service worker | Same-origin versioned offline cache |
| M82 | Cold entry | Pre-START title and one-shot activation boundary |
| M86 | Hot runtime | Post-START routing/services/current run/floor/combat lifecycle |

## Strict START Boundary

Before START, the browser may request only the static cold shell allowlist needed to display the title: `./index.html`, cold CSS, and `./src/main.js`. It must not fetch data, WOFF2, game modules, or service-worker assets; register a service worker; initialize RNG; create AudioContext; start grain/glitch; or restore/import a run.

```js
// ./src/main.js
export function mountColdTitle(root, activate) {}

// ./src/runtime.js
export async function activateRuntime({ initialHash }) {}
export async function mountScreen(name, params = {}) {}
export function shutdownRuntime() {}
```

START dynamically imports M86 within the trusted gesture. M86 then registers M81, loads/validates M04–M13 via M87, initializes services, applies settings, resolves the initial URL fragment, and mounts the hot title branches or destination screen.

## Runtime Ownership

- Exactly one current screen controller, RunState, generated floor, and optional combat snapshot.
- Navigation is sequence-guarded; stale imports cannot win.
- Autosave occurs after floor transition and combat resolution, and before intentional exit/abandon where appropriate.
- Returning to title shuts down per-screen listeners but may keep the activated AudioContext suspended; it does not recreate the cold pre-START state in the same page session.
- Service worker manifest is generated/validated against runtime imports and contains no dev tooling, mocks, specs, tests, or font source.

## Baseline Audit (2026-08-10)

Current M82 statically imports nearly the whole runtime, fetches all data, registers the service worker, and starts glitch/grain before START. The active lifecycle exists but omits several encounter/progression/autosave transitions.

## Change History

| Date | Change |
|---|---|
| 2026-08-11 | SESSION-55 set the final M81 cache version to `operator-descent-2026-08-11-release-v1` and verified the release offline/browser gates in `./docs/release-acceptance.md`. |
| 2026-08-11 | SESSION-53 added browser audits proving the strict cold request/API boundary and offline service-worker behavior: first-ever offline load fails, then an activated Chromium cache can reload, import, enter combat, switch console modes, render the sigil font, and save offline. |
| 2026-08-11 | SESSION-52 browser acceptance verified the cold START request boundary before runtime activation and introduced a dev-only exact static server for Playwright checks without changing the shipped M81/M82/M86 runtime boundary. |
| 2026-08-11 | SESSION-51 updated M86 floor restoration to regenerate from saved `floorSubSeed` plus the themes-seen set before the current floor theme, preserving exact geometry/theme across portable resume. |
| 2026-08-11 | SESSION-50 replaced M81 with a 91-entry explicit production manifest, versioned `operator-descent-2026-08-11-session-50` cache, subpath-scoped cache keys, cache-first app assets, cached-shell navigation fallback, same-origin/GET fetch boundary, and nonfatal M86 registration/update diagnostics after START. |
| 2026-08-11 | SESSION-49 completed M86 hot composition: route validation, active-combat resume, RNG-safe floor restore, service-worker single-registration, full teardown, and autosaves after committed floor-transition/combat-resolution checkpoints before presentation animations. |
| 2026-08-11 | SESSION-47 kept the cold `./src/main.js` START boundary intact, completed hot title branch routing, and moved injected WebAudio startup into M86 activation with the legacy `ui:audio-start` fallback retained. |
| 2026-08-09 | Initial HTML/service-worker/main modules. |
| 2026-08-10 | Added M86 and made the cold/hot split authoritative. |
| 2026-08-10 | SESSION-01 implemented the strict cold entry and deferred the active lifecycle to M86. |
| 2026-08-11 | SESSION-44 extended M86 combat resolution routing so both victory and retreat return to exploration through `state:combat-end` and autosave; wipe remains `state:party-wipe`. |
<!-- SESSION-01 cache-buster-auto-reload -->
| 2026-08-14 | cache-buster-auto-reload SESSION-01 taught M86 to close the update loop that M81 already opens: on a returning visit (page had a prior controller), `registerServiceWorkerOnce` arms a one-shot `navigator.serviceWorker.oncontrollerchange` listener that dispatches the new M34 bus event `runtime:update-applied` and calls `window.location.reload()` exactly once; on any visit, it also arms a `document.visibilitychange` listener that re-runs `registration.update()` when the tab returns to `visible`, so a tab left open across a deploy still picks up the new worker and reloads. `serviceWorkerStatus` gains a `reloading` boolean; the first-visit path (no prior controller) intentionally skips the reload listener so `clients.claim()`'s initial `controllerchange` does not trigger a pointless refresh. `service-worker.js` (M81) was not modified. |

<!-- adaptive-layouts-impl feature-end (Jikijitsu) -->

## Adaptive layouts: runtime + offline — adaptive-layouts-impl

- **Runtime (M86):** subscribes `ui:layout-change` (from M100 `initLayoutController({bus})`) and re-mounts the current route with its original params (`currentRouteParams`). RunState is canonical, so nothing user-durable is lost on a class cross.
- **Service worker (M81):** `PRODUCTION_ASSETS` += `styles/wide.css`, `src/ui/layout.js` (S01; 94 assets, manifest↔disk↔reference verified). `CACHE_VERSION` → `2026-08-15-adaptive-layouts-v1` (S05 — one bump for the whole feature). service-worker.test.js pins both the cache-name and the 94-entry manifest length.
- **Boot note:** `ui:layout-change` is not in bus.js `EVENT_CONTRACTS` (unknown events pass validation by design; bus.js was in no session's lease).

<!-- mobile-ux-and-combat-readout feature-end (Jikijitsu) -->

## Combat-resume rehydrate + log pipeline — mobile-ux-and-combat-readout

- **Runtime (M86) → M15 (S01):** `actorFromSnapshot` derives party `hpMax`/`chargeMax` from the base character's class + resolved loadout when the persisted stats block lacks explicit maxes, so combat-resume no longer copies `currentHP` into `hpMax`. Import of `deriveStats` added.
- **Runtime log detail (M86):** `appendRuntimeLogEntry` now propagates the bounded `detail` string into both `runtimeLogEntries` and `recordEvent(payload)`, so the LOG feed shows full d20 breakdowns live or resumed.
- **Persisted event schema (M33 run-state):** `normalizePersistedEvent` keeps a string `detail` bounded to 96 chars (`PERSISTED_EVENT_DETAIL_MAX`); non-string/empty/missing dropped. Non-breaking — the save-encode event trimmer still absorbs budget pressure; `stress:saves` max fragment 1360 < 1500 (Custom Rule 6 intact, no v7 bump — Design Decision 2).

<!-- SESSION-01 -->

<!-- mobile-pwa-hardening SESSION-01 (Jikijitsu append) -->
### M80 (HTML shell) — installable PWA identity

`./index.html` gains `<link rel="manifest" href="manifest.webmanifest">`, `<link rel="icon" href="assets/app-icon.svg" type="image/svg+xml">`, `<link rel="apple-touch-icon" href="assets/app-icon-180.png">`, `theme-color`, and `apple-mobile-web-app-*` metadata. All new hrefs are bare-relative (no `./` prefix) to satisfy the M94 reference validator, which prefixes them itself. The viewport meta drops `maximum-scale`/`user-scalable=no` and gains `viewport-fit=cover`; `width=device-width, initial-scale=1` is unchanged. New root singleton `./manifest.webmanifest` (`display: standalone`, `orientation: portrait`, relative `id`/`start_url`/`scope`, 192/512 `any maskable` PNG icons) plus `./assets/app-icon.svg` and its three committed PNG variants (180/192/512).

### M81 (Service worker) — version-scoped cache reads, v13 bridge, consent-gated activation

`CACHE_VERSION` → `2026-08-23-mobile-pwa-hardening-v13`. Every cache read (`cachedShell`, `cacheFirstAsset`) now goes through `caches.open(CACHE_NAME).match(...)` instead of the global `caches.match()` — a worker can never resolve another cache version's response. One-time v12→v13 bridge: `install` no longer calls `cache.addAll()` or `self.skipWaiting()`; precaching moves into `activate` (`cache.open(CACHE_NAME).then(addAll).then(cleanup old caches).then(clients.claim())`, chained so a precache failure blocks cleanup/claim). Consent gate (permanent going forward, not bridge-specific): a new `message` listener accepts only `{ type: 'SKIP_WAITING' }`; before calling `self.skipWaiting()` it calls `self.clients.matchAll({ type: 'window', includeUncontrolled: true })`, filters to `self.registration.scope`, and only proceeds when exactly one in-scope window exists — otherwise it replies to `event.source` with `{ type: 'UPDATE_DEFERRED_MULTI_CLIENT', clientCount }` and leaves the worker waiting. `PRODUCTION_ASSETS` += `./manifest.webmanifest`, `./assets/app-icon.svg`, `./assets/app-icon-{180,192,512}.png` (123 entries total).

### M86 (Hot runtime) — waiting-worker detection and consent-only reload

`./src/runtime.js` public surface (`activateRuntime`, `mountScreen`, `shutdownRuntime`, `getRuntimeSnapshot`) is unchanged; internal update-handling is rebuilt. New `requestWaitingWorkerActivation()` posts `{ type: 'SKIP_WAITING' }` to `registration.waiting` (no-op if none, or if already pending) — this is the *only* path that can trigger `self.skipWaiting()`. `dispatchUpdateReadyOnce()` fires `runtime:update-ready` from either an already-present `registration.waiting` at registration time, or an `updatefound` → installing worker `statechange === 'installed'` while `navigator.serviceWorker.controller` already exists — dispatched on every route now, not gated to in-run surfaces (`isInRunSurface`/`IN_RUN_SURFACES` removed, both now dead). `controllerchange` reloads *only* when `serviceWorkerReloadPending` is true (set solely by `requestWaitingWorkerActivation`); an unsolicited controllerchange (e.g. a first install's `clients.claim()`) never reloads. A new `message` listener on `navigator.serviceWorker` handles `UPDATE_DEFERRED_MULTI_CLIENT`: clears `serviceWorkerReloadPending` and dispatches `runtime:update-deferred` with `clientCount`. The update-toast bus wiring (`runtime:update-ready` / new `runtime:update-deferred`) now tracks the mounted toast in a `WeakMap` (was `WeakSet`) so the deferred event can mutate the same toast via `toast.setDeferred(true)` instead of reloading unilaterally.

### M56 (UI components) — `createUpdateToast` mutation API

`./src/ui/components.js`'s `createUpdateToast({ onReload })` return value gains `toast.setDeferred(deferred: boolean)`: swaps the label/button copy between `NEW BUILD CACHED`/`RELOAD` and `CLOSE OTHER GAME TABS — THEN RETRY`/`RETRY` (and the button's `aria-label`) in place — no duplicate toast or live region. `onReload` still fires on every click regardless of deferred state, so RETRY re-requests activation through the same handler.

### M77/M101 (Base/Wide CSS) — safe-area frame

`./styles/base.css` `:root` gains `--safe-area-{top,right,bottom,left}: env(safe-area-inset-*, 0px)`; `#app-root` (the content frame) is padded with them under the existing global border-box rule. `#crt-overlays` is untouched — stays edge-to-edge. `.in-run-screen` (`./styles/components.css`) and `.wide-shell` + its child `.wide-console-dock` (`./styles/wide.css`) switch their `100vh`/`100dvh`/`100vw` fills to `100%`, so they track the now-safe-area-shrunk `#app-root` content box instead of bypassing it. `.update-toast` gains `bottom: calc(24px + var(--safe-area-bottom))` and a `max-width` clamped by the left/right insets.

### M94/M96 (Static/release validation) — PWA assets are required singletons

`./scripts/verify-assets.js` and `./scripts/report-budget.js` both add `./manifest.webmanifest`, `./assets/app-icon.svg`, `./assets/app-icon-{180,192,512}.png` to `REQUIRED_SINGLETONS`, and `.webmanifest` to `TEXT_EXTENSIONS` (compressed like other text assets for the transfer budget). `./scripts/server.js` / `./tools/serve.mjs` map `.webmanifest` → `application/manifest+json`.

### M95 (Browser acceptance) — `./tests/e2e/pwa-shell.spec.js`

New spec: fetches `manifest.webmanifest` through the Playwright server, asserts its MIME type and parsed install fields; asserts the viewport meta has no `maximum-scale`/`user-scalable` and keeps `viewport-fit=cover`; fetches every linked manifest/icon href and confirms same-origin `2xx`.

### Known follow-up (not this session's lease)

- `./tests/ui/front-door.test.js` still asserts the pre-consent contract (`RELOAD` click → immediate `window.location.reload()`); it now fails because `onReload` requests `SKIP_WAITING` instead. Needs updating to the consent flow.
- `./tests/tooling/check-tokens.test.js` now reports 4 warning-level findings: the new `--safe-area-*` custom properties are undocumented in `specs/design.md`'s color palette table. These are structural/derived tokens, not palette colors — same category as the existing `DERIVED_SURFACE_TOKENS` allowlist (5 scrollbar/fade tokens) documented outside the extractor anchors in `specs/design.md`. A future session should add `--safe-area-{top,right,bottom,left}` to that same allowlist.
- `./scripts/lint-sigils.js` `SKIP_DIRS` still lacks `test-results/` (pre-existing debt, noted in `arch/tooling-and-quality.md`) — a concurrent/leftover Playwright run can trip the sigil lint until it's cleaned up manually.


<!-- SESSION-05 — combat-and-ux-feedback-pass, 2026-08-24 -->

### M86 Hot Runtime — visibility-driven audio lifecycle

- `activateRuntime` installs a `visibilitychange` document listener via new
  internal `installVisibilityAudioControl()` (mirrors the existing
  `installGestureResume` shape). On `document.hidden` / `visibilityState ===
  'hidden'` the runtime calls `audioEngine.suspend()`; on any other value it
  calls `audioEngine.resume()`. `shutdownRuntime` invokes the stored
  `visibilityAudioCleanup` to remove the listener.
- This is a second, independent `visibilitychange` listener alongside the
  existing service-worker update re-check inside `registerServiceWorkerOnce`;
  both are additive and non-interacting.
