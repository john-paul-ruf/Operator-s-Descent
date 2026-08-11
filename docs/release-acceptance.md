# Operator's Descent Release Acceptance

**Release date:** 2026-08-11
**Release identifier:** `operator-descent-2026-08-11-release-v1`
**Package version:** `0.1.0` / private / `UNLICENSED`
**Save wire version:** `SAVE_VERSION = 2` in `./src/state/save-encode.js`
**Run schema version:** `RUN_SCHEMA_VERSION = 2` in `./src/state/save-schema.js`
**Static data versions:** `1` across all ten `./data/*.json` files
**Symbol table version:** `1` in `./data/symbol-table.json`
**Service-worker cache:** `operator-descent-2026-08-11-release-v1` in `./service-worker.js`
**Font:** project-owned sigil WOFF2, original Glitch Forgeworks LLC outlines, 72 glyphs, 7,916 bytes

## Release Gate Commands

| Command | Result |
|---|---|
| `npm ci` | Pass; locked dev install reproduced, 49 packages audited, 0 vulnerabilities. |
| `npm audit --audit-level=moderate` | Pass; 0 vulnerabilities. |
| `npx playwright install` | Pass; browser binaries present for all configured projects. |
| `npm run validate` | Pass inside `npm run check:release`: data validation 10 files, sigil lint passed, font check passed, asset check passed, Vitest 69 files / 1,743 tests passed. |
| `python3 ./scripts/verify-font.py` | Pass; 72 glyphs, advance 1000, WOFF2 7,916 bytes. |
| `node ./scripts/stress-generation.js --seeds 250 --depths 1,10,50,100` | Pass; 1,000 floors, all 8 archetypes and 12 themes, attempts max/p95 7/3, timing max/p95/avg 1.661ms/0.218ms/0.080ms. |
| `node ./scripts/stress-saves.js` | Pass; 6 legal fixtures, max fragment 1,476 chars, p95 1,263 chars, encode max 2.651ms, decode max 0.605ms. |
| `node ./scripts/simulate-runs.js --runs 50` | Pass; 50 deterministic runs, 355 hunts, 0 deaths in sampled horizon, 30 retreats, 692 failed overclocks, 40 implants, hunt interval average 2.97 floors, half-threshold pathological false. |
| `node ./scripts/report-budget.js` | Pass; 91 assets, raw/gzip/brotli 732,560 / 201,225 / 176,504 bytes, all hot-path p95s under budget. |
| `npm run test:e2e` | Pass inside `npm run check:release`; 48 tests across Chromium portrait, Chromium phone-touch, Firefox portrait, and WebKit portrait: 40 passed, 8 expected modality/capability skips, no browser project skipped. |
| `npm run check:release` | Pass; ran the full validate/stress/simulation/budget/E2E chain. |

The only command-line warnings during E2E were Playwright web-server `NO_COLOR` notices caused by `FORCE_COLOR`; no release limit was treated as warning-only.

## Budgets and Measured Limits

| Gate | Measured value | Requirement |
|---|---:|---:|
| First-load compressed transfer | 201,225 bytes gzip / 176,504 bytes brotli | < 500,000 bytes |
| Cached production assets | 91 assets | Explicit manifest only |
| Max legal portable `#r=` fragment | 1,476 chars | < 1,500 chars |
| Max encode time | 2.651ms | < 50ms |
| Max decode time | 0.605ms | < 100ms |
| Floor generation p95 | 0.218ms stress / 0.515ms hot-path report | < 100ms |
| Shadowcast p95 | 0.027ms | No 30fps-risk regression |
| Canvas-frame proxy p95 | 0.028ms | No 30fps-risk regression |
| Combat action p95 | 0.324ms | No turn-resolution stall |
| Audio scheduling proxy p95 | 0.007ms | No synthesis scheduling stall |
| Font size | 7,916 bytes | 4–8 KB target |
| Font glyph count | 72 mapped nonempty glyphs | 72 required |

## Manual Font and Layout Review

**Reviewer:** Mu
**Date:** 2026-08-11
**Method:** Playwright screenshot audit on the repository server `http://127.0.0.1:8080/`, followed by visual inspection.

| Area | Evidence | Result |
|---|---|---|
| 34px contact sheet | `./docs/sigil-contact-sheet.html`; screenshot `/tmp/operator-final-audit/contact-sheet.png`; DOM count 72 glyphs in the 34px monochrome section and 72 in the 34px production-glow section. | Pass; all player families and bestiary rows distinct at rail scale. |
| 220px contact sheet | Screenshot slices `/tmp/operator-final-audit/contact-220-slice-1.png` through `/tmp/operator-final-audit/contact-220-slice-4.png`; DOM count 72 glyphs in the 220px monochrome section and 72 in the 220px production-glow section. | Pass; monospaced glyphs remain centered, original, non-Latin, and visually separated at picker scale. |
| Portrait production screens | Montage `/tmp/operator-final-audit/screen-montage.png` covers cold title, activated title, creation, tutorial, settings, exploration MOVE/PARTY/GEAR/TECH/LOG, combat, and combat COMBAT/PARTY/GEAR/TECH/LOG. | Pass; fixed 1080×1920 composition, console rows, status strip, and sigils remain legible. |
| Letterboxed production screens | Montage `/tmp/operator-final-audit-letterbox/screen-montage.png` covers the same production states at 1920×1080. | Pass; portrait frame stays centered with neutral side bars and no landscape reflow. |
| Glitch on/off/reduced motion | Montage `/tmp/operator-final-audit-motion/motion-montage.png`; spot check across `glitchEnabled: true`, `glitchEnabled: false`, and `reducedMotion: reduce`; 0 interactive controls carried `data-glitch`. | Pass; controls remain usable, text remains legible, reduced motion removes authored motion. |

A release blocker found during this audit was fixed: live glitch timers previously invoked browser `clearInterval`/`clearTimeout` as unbound object methods, causing `Illegal invocation` when navigating away from a glitching screen with full motion enabled. `./src/glitch/glitch.js` now clears timers through `globalThis`, and `./tests/glitch/glitch.test.js` covers browser-strict timer cleanup.

## FR Evidence Matrix

| Requirement | Implementation and evidence | Result |
|---|---|---|
| FR-1 Title Screen & Front Door | Strict cold shell in `./src/main.js`; hot runtime in `./src/runtime.js`; tests `./tests/integration/start-gate.test.js`, `./tests/integration/start-boundary.test.js`, `./tests/e2e/start-boundary.spec.js`, and `./tests/ui/front-door.test.js`. | Pass |
| FR-2 Tutorial | Manual screen `./src/ui/screens/tutorial.js`; activated title routes in `./src/ui/screens/title.js`; tests `./tests/ui/front-door.test.js` and E2E title flows. | Pass |
| FR-3 80-Point Buy | Pure model `./src/ui/creation-model.js`, UI `./src/ui/screens/creation.js`; tests `./tests/ui/creation-model.test.js` and `./tests/ui/creation-screen.test.js`. | Pass |
| FR-4 Classes & Signatures | Data `./data/classes.json`; rules `./src/rules/classes.js` and `./src/rules/progression.js`; tests `./tests/rules/classes.test.js` and `./tests/rules/progression.test.js`. | Pass |
| FR-5 Sigil Typeface | Original source `./font-src/glyphs.json`, compiler `./tools/font/build_font.py`, production font `./assets/descent-sigil.woff2`; `python3 ./scripts/verify-font.py`; manual contact review. | Pass |
| FR-6 Reserved Sigil Banks | Data `./data/sigils.json`; renderer `./src/ui/components.js`; lint `./scripts/lint-sigils.js`; tests `./tests/data/sigil-lint.test.js` and `./tests/data/sigils.test.js`. | Pass |
| FR-7 Sigil Rendering | Fixed token sizes in `./src/ui/components.js`; contact sheet `./docs/sigil-contact-sheet.html`; tests `./tests/ui/components.test.js`; manual review. | Pass |
| FR-8 Procedural Floor Generation | Generator `./src/floor/generator.js`, archetypes/modifiers in `./src/floor/`; tests `./tests/floor/*.test.js`; stress-generation gate. | Pass |
| FR-8a Environment Theme Table | `./data/themes.json`; loader validation `./src/data-loader.js`; tests `./tests/data/contracts.test.js`; asset manifest includes theme data. | Pass |
| FR-9 Floor Validation | Validator `./src/floor/validator.js`; generator retry loop; tests `./tests/floor/validator.test.js`, `./tests/integration/floor-pipeline.test.js`, stress-generation gate. | Pass |
| FR-10 Cell-by-Cell Exploration | Lattice, LOS, movement in `./src/exploration/`; screen `./src/ui/screens/exploration.js`; tests `./tests/exploration/*.test.js`, `./tests/ui/exploration-screen.test.js`, E2E keyboard/touch flows. | Pass |
| FR-11 Tactical d20 Combat | Rules `./src/rules/combat.js` and `./src/rules/combat-geometry.js`; UI `./src/ui/screens/combat.js`; tests `./tests/rules/combat*.test.js`, `./tests/ui/combat-screen.test.js`, E2E combat flows. | Pass |
| FR-12 Tech Protocols | `./data/protocols.json`, `./src/rules/protocols.js`, `./src/ui/console/tech.js`; tests `./tests/rules/protocols.test.js`, `./tests/ui/tech-loot-log.test.js`. | Pass |
| FR-13 Loot System | `./src/rules/loot.js`, `./src/ui/console/loot.js`, floor containers; tests `./tests/rules/loot.test.js`, `./tests/ui/tech-loot-log.test.js`. | Pass |
| FR-14 Corruption & Danger Clock | Overclock/corruption in `./src/rules/protocols.js`, encounters/danger in `./src/rules/encounters.js` and `./src/exploration/movement.js`; tests `./tests/rules/encounters.test.js`, `./tests/rules/protocols.test.js`, simulation gate. | Pass |
| FR-15 Single Console | Shell `./src/ui/console/console.js`; CSS `./styles/components.css`; tests `./tests/ui/console.test.js`, E2E accessibility/keyboard/touch specs; manual layout review. | Pass |
| FR-16 MOVE Mode | `./src/ui/console/move.js`; movement rules; tests `./tests/exploration/movement.test.js`, `./tests/ui/exploration-screen.test.js`, E2E keyboard/touch flows. | Pass |
| FR-17 COMBAT Mode | `./src/ui/console/combat.js`; tests `./tests/ui/combat-screen.test.js` and E2E combat targeting. | Pass |
| FR-18 PARTY Mode | `./src/ui/console/party.js`; tests `./tests/ui/party-gear.test.js`; manual portrait/letterbox review. | Pass |
| FR-19 GEAR Mode | `./src/ui/console/gear.js`; inventory/equipment rules; tests `./tests/rules/inventory.test.js`, `./tests/ui/party-gear.test.js`. | Pass |
| FR-20 TECH Mode | `./src/ui/console/tech.js`; protocol rules; tests `./tests/ui/tech-loot-log.test.js`. | Pass |
| FR-21 LOOT Mode | `./src/ui/console/loot.js`; loot/inventory rules; tests `./tests/ui/tech-loot-log.test.js` and E2E journeys. | Pass |
| FR-22 LOG Mode | `./src/ui/console/log.js`; portable save encode; tests `./tests/ui/tech-loot-log.test.js`, `./tests/state/save-encode.test.js`, E2E copy-link flows. | Pass |
| FR-23 Glitch System | `./src/glitch/glitch.js`, `./src/glitch/grain.js`, `./styles/crt.css`; tests `./tests/glitch/glitch.test.js`, `./tests/e2e/accessibility.spec.js`; manual motion audit. | Pass |
| FR-24 Authored Transitions | `./src/glitch/transitions.js`; runtime transition calls in `./src/runtime.js`; tests `./tests/glitch/glitch.test.js`, `./tests/integration/runtime.test.js`. | Pass |
| FR-25 Per-Floor Accent | Theme data `./data/themes.json`; status/playfield/runtime accent application; tests `./tests/ui/playfield.test.js`, `./tests/ui/status-strip.test.js`, `./tests/integration/determinism.test.js`. | Pass |
| FR-26 Dynamic Audio Score | Engine/layers in `./src/audio/`; tests `./tests/audio/score.test.js`; no audio files in asset manifest. | Pass |
| FR-27 Run Library | Persistence `./src/state/library.js`, screen `./src/ui/screens/library.js`; tests `./tests/state/library.test.js`, `./tests/ui/persistence-screens.test.js`. | Pass |
| FR-28 URL Save | Encode/decode/schema in `./src/state/`; tests `./tests/state/save*.test.js`, `./tests/integration/save-roundtrip.test.js`, stress-saves, E2E portable-save specs. | Pass |
| FR-29 Malformed Links | Decoder errors `./src/state/save-decode.js`, import UI `./src/ui/screens/import.js`; tests `./tests/e2e/import-errors.spec.js`, `./tests/ui/persistence-screens.test.js`. | Pass |
| FR-30 Depth and Threshold Floors | Progression and encounters `./src/rules/progression.js`, `./src/rules/encounters.js`; tests `./tests/rules/progression.test.js`, `./tests/rules/encounters.test.js`, full-loop integration. | Pass |
| FR-31 Scorecard | `./src/ui/screens/scorecard.js`; runtime wipe routing; tests `./tests/ui/persistence-screens.test.js`, `./tests/integration/full-game-loop.test.js`. | Pass |
| FR-32 Echo | `./src/rules/enemies.js`, `./src/rules/encounters.js`, run-state queue; tests `./tests/rules/enemies.test.js`, `./tests/rules/encounters.test.js`, save stress two-Echo fixture. | Pass |
| FR-50 Inventory Cap & Junk | `./src/rules/inventory.js`, `./src/ui/console/gear.js`, `./src/ui/console/loot.js`; tests `./tests/rules/inventory.test.js`, save stress 100-item fixture. | Pass |
| FR-51 Saved Party Configurations | `./src/state/party-configs.js`, `./src/ui/screens/creation.js`; tests `./tests/state/party-configs.test.js`, `./tests/ui/creation-screen.test.js`. | Pass |
| FR-33 Offline-First | `./service-worker.js`, manifest validation `./scripts/verify-assets.js`, runtime registration; tests `./tests/integration/service-worker.test.js`, `./tests/e2e/offline.spec.js`. | Pass |
| FR-34 Settings | `./src/ui/screens/settings.js`, `./src/state/library.js`, audio/glitch settings dispatch; tests `./tests/ui/front-door.test.js`, `./tests/e2e/accessibility.spec.js`, motion audit. | Pass |
| FR-35 Portrait Layout | CSS `./styles/base.css` and `./styles/components.css`; tests `./tests/e2e/accessibility.spec.js`; manual portrait and letterbox review. | Pass |
| FR-36 Palette and Glow | CSS `./styles/base.css`, `./styles/crt.css`, `./styles/components.css`; sigil lint excludes bank glyph ornaments; manual layout review. | Pass |
| FR-37 Core Attributes | `./src/rules/attributes.js`; tests `./tests/rules/attributes.test.js`, creation model tests. | Pass |
| FR-38 d20 Resolution | `./src/rules/combat.js`, `./src/rules/combat-geometry.js`; tests `./tests/rules/combat.test.js`, `./tests/integration/combat-sim.test.js`. | Pass |
| FR-39 HP, CHARGE, Advancement | Attributes/classes/progression rules; tests `./tests/rules/attributes.test.js`, `./tests/rules/progression.test.js`, full-loop integration. | Pass |
| FR-40 Depth Scaling | `./src/rules/scaling.js`, enemy/loot/encounter consumers; tests `./tests/rules/scaling.test.js`, `./tests/rules/enemies.test.js`, `./tests/rules/loot.test.js`. | Pass |
| FR-41 Economy and Credits | Creation conversion and run-state credits; tests `./tests/ui/creation-model.test.js`, `./tests/state/run-state.test.js`; no vendor UI/assets. | Pass |
| FR-42 Equipment System | `./data/equipment.json`, `./src/rules/equipment.js`, `./src/ui/console/gear.js`; tests `./tests/rules/equipment.test.js`, `./tests/ui/party-gear.test.js`. | Pass |
| FR-43 Enemy System | `./data/enemies.json`, `./src/rules/enemies.js`; tests `./tests/rules/enemies.test.js`, encounters/combat integration. | Pass |
| FR-44 Conditions | `./data/conditions.json`, `./src/rules/conditions.js`; tests `./tests/rules/conditions.test.js`, combat/protocol tests. | Pass |
| FR-45 Class Signatures | `./src/rules/classes.js`, combat/progression hooks; tests `./tests/rules/classes.test.js`, `./tests/rules/combat.test.js`. | Pass |
| FR-46 Rest and Recovery | Floor transition recovery in `./src/rules/progression.js`; consumables/protocol recovery; tests `./tests/rules/progression.test.js`, `./tests/rules/consumables.test.js`. | Pass |
| FR-47 Protocol Catalog | `./data/protocols.json`, `./src/rules/protocols.js`; tests `./tests/rules/protocols.test.js`, `./tests/data/contracts.test.js`. | Pass |
| FR-48 Loot Affixes and Rarity | `./data/affixes.json`, `./src/rules/loot.js`, equipment hooks; tests `./tests/rules/loot.test.js`, `./tests/rules/equipment.test.js`. | Pass |
| FR-49 Consumables | `./data/consumables.json`, `./src/rules/consumables.js`; tests `./tests/rules/consumables.test.js`, inventory/loot UI tests. | Pass |

## Security and Failure Behavior Audit

| Area | Evidence | Result |
|---|---|---|
| Runtime dependencies | `./package.json` has no `dependencies`; `devDependencies` are Vitest and Playwright only. | Pass |
| No build/runtime server | Native ES modules in `./index.html` and `./src/`; no bundler/transpiler output; runtime assets are static. | Pass |
| URL fragments | `./src/state/save-decode.js` parses bounded base64url frames, versions, checksums, compression frames, and schema; named errors cover `truncated`, `version_mismatch`, `checksum_failed`, and `malformed`. | Pass |
| `localStorage` | `./src/state/library.js` normalizes/validates runs, settings, flags, and blueprints; malformed inputs quarantine or named-fail instead of crashing. | Pass |
| Code injection | Repository audit found no `eval` or `Function`; the only `innerHTML` occurrence is `element.innerHTML = ''` after child removal in `./src/ui/console/console.js`, not untrusted insertion. | Pass |
| DOM writes | User-controlled fragments and names are rendered through `textContent`, input `value`, and structured DOM nodes; no untrusted `innerHTML`. | Pass |
| Deterministic RNG | Gameplay generation, loot, combat, AI, Echoes, and d20 rolls use `./src/core/prng.js`/`./src/core/rng-cursor.js`; ambient `Math.random()` is limited to visual glitch/grain, fresh seed creation, and an unsaved floor-transition staleness nonce. | Pass |
| Service-worker scope | `./service-worker.js` handles same-origin GET/navigation only, no `importScripts`, no foreign origins, versioned Operator cache deletion only. | Pass |
| Offline cache contents | `./scripts/verify-assets.js` validates the 91 production assets and excludes `./tests/`, `./specs/`, `./program/`, `./tools/`, `./font-src/`, `./docs/`, `./node_modules/`, and package metadata. | Pass |
| Dead-run sharing | Scorecard uses seed-only `#w=` links; full-state `#r=` copy is unavailable after wipe and run state is deleted from the library. | Pass |

## Non-Goals Rechecked

- **No backend/accounts/telemetry/analytics/cloud sync:** no runtime network target other than same-origin static assets and service-worker cache fills.
- **No runtime dependencies/CDNs/font services:** zero `dependencies`, no external URLs in the production manifest.
- **No build step:** source files are served directly as native ES modules.
- **No third-party fonts/audio/sprite assets:** only `./assets/descent-sigil.woff2` ships; audio is synthesized; visuals are Canvas/CSS/SVG.
- **No hand-authored floors/tutorial level:** floor generation is deterministic procedural code; tutorial is a manual.
- **No landscape layout/responsive reflow:** portrait frame is fixed and letterboxed.
- **No meta-progression/vendors/shops:** credits are fixed creation leftovers only.

## Documented Nonblocking Limitations

- Playwright offline acceptance is executed in Chromium service-worker contexts; Firefox and WebKit still run the rest of the browser acceptance suite but skip the Chromium-specific offline control path by explicit capability annotation.
- Touch-only E2E scenarios run in the Chromium phone-touch project and are skipped in non-touch browser projects by modality annotation; every browser project still executes its applicable keyboard/accessibility/import/portable/cold-start coverage.
- The 50-run balance simulation is deterministic release evidence, not a replacement for future human playtest tuning.
