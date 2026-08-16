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
