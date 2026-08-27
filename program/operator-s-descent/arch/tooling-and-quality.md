# Architecture Detail — Tooling and Release Quality

## Modules

| IDs | Area | Owns |
|---|---|---|
| M83–M85 | Dev shell | npm metadata, built-ins-only static server, start/stop lifecycle |
| M93 | Typeface tooling | Original outline recipes, WOFF2 compilation, font QA artifacts |
| M94 | Static validation | Sigil-bank lint, asset-manifest and transfer-budget checks |
| M95 | Browser acceptance | Playwright workflows for keyboard/touch/offline/import/accessibility |
| M96 | Release simulation | Deterministic gameplay sweeps and final release gate |
| M117 | Predeploy gate | Local + CI deploy-blocking verification (`npm run predeploy`); auto-installed `.githooks/pre-push` hook |

## Shipping Boundary

Only `./index.html`, `./src/`, `./styles/`, `./data/`, `./assets/descent-sigil.woff2`, and `./service-worker.js` are runtime candidates. `./tests/`, `./mocks/`, `./specs/`, `./program/`, `./font-src/`, `./tools/`, dev scripts, package caches, and browser binaries never enter the service-worker manifest or transfer budget.

## Verification APIs

```text
npm test
npm run test:e2e
python3 tools/font/build_font.py --check
node scripts/lint-sigils.js
npm run check:assets
npm run simulate
npm run check:release
npm run predeploy
```

## Release Gate

- All unit/integration/browser suites pass with no bug-tolerant branches.
- No unexpected console/page/service-worker errors.
- Cold-title network allowlist proves FR-1.
- Full 100-item/4-character/2-Echo/active-combat save is below 1500 characters and round-trips.
- Validated floor p95 is below 100ms; save encode below 50ms and decode below 100ms on the documented reference machine.
- Compressed first-load transfer is below 500 KB and offline reload completes.
- 34px and 220px contact sheets pass metrics/uniqueness review; font is 4–8 KB unless a documented quality-first exception is approved.
- Deterministic run simulations emit balance distributions without changing production rules.

## Baseline Audit (2026-08-10)

Vitest has 1,224 passing tests, but browser E2E, font tooling, bank lint, offline certification, release budgets, and balance simulations do not yet exist. Several current tests explicitly permit known acceptance failures and must be strengthened.

## Change History

| Date | Change |
|---|---|
| 2026-08-24 | predeploy-verification-gate SESSION-01 added M117: `npm run predeploy` (`check:generated && check:assets && test:pages-contract && build:pages`) as the single source of truth both `./.github/workflows/deploy-pages.yml`'s `build` job and a new auto-installed `./.githooks/pre-push` hook (wired via `package.json`'s `prepare` script) read from — local and CI can no longer silently disagree about what's required before a deploy. Also landed the live-incident fix that prompted the feature: `service-worker.js`'s `PRODUCTION_ASSETS` manifest was missing `./src/state/high-scores.js` (M115), causing the GitHub Pages `build` job to fail `check:assets`. |
| 2026-08-15 | adaptive-layouts SESSION-06 made M97 layout-aware: scans `mocks/` + `mocks/wide/`, findings carry a `layout` field, wide↔prod class gaps report as `[wide — unimplemented]` warnings (97 at introduction — the implementation feature's starting backlog), wide-internal token drift is error-level, the `wide-*` namespace is excluded from prod comparison, mock class extraction strips CSS comments, and the spec extractor exports layout-class + screen-matrix metadata (`extractLayoutClasses`, `extractScreenLayoutsByClass`). M99 gained `--layout portrait\|wide` with per-class default viewports (portrait 450×800, wide 1440×900); wide runs capture mocks only into `<screen>-wide-mock.png` + `report-wide.json` and print an explicit wide-not-implemented-in-prod note instead of a side-by-side. Scan/report consumed interfaces unchanged. |
| 2026-08-11 | SESSION-55 added the final release acceptance report, strengthened `validate`/`check:release`, upgraded dev-only Vitest to 4.1.10 to clear audit, and recorded full gate evidence: 69 Vitest files/1,743 tests, 48 Playwright checks, transfer/save/performance/simulation/font/manual-review results. |
| 2026-08-11 | SESSION-54 added M96 release scripts for floor generation stress, portable-save stress, deterministic corruption/hunt simulation, and transfer/hot-path reporting plus `./tests/performance/release-budgets.test.js` and `./docs/balance-report.md`; full suite is now 69 files/1,742 tests. |
| 2026-08-11 | SESSION-53 added M95 Playwright specs for strict pre-START auditing, portable full-state/future equivalence, seed-only sharing, import diagnostics, and Chromium offline play; focused suite ran 20 tests with 18 passed/2 skipped and full E2E ran 48 tests with 40 passed/8 skipped. |
| 2026-08-11 | SESSION-52 added M95 Playwright acceptance via `./playwright.config.js`, `./tools/serve.mjs`, and `./tests/e2e/` for Chromium/Firefox/WebKit portrait plus Pixel 7 touch journeys; Vitest now excludes Playwright specs through dev-only `./vitest.config.js`. |
| 2026-08-11 | SESSION-50 added M94 `./scripts/verify-assets.js` and `npm run check:assets`, validating manifest completeness/exclusions/import graph/CSS references and reporting 724,946 raw, 199,450 gzip, and 174,872 brotli transfer bytes under the 512,000-byte compressed budget. |
| 2026-08-09 | Initial dev server/test configuration. |
| 2026-08-10 | SESSION-35 added reserved-bank lint and strict production font verification. |
| 2026-08-10 | Added M93–M96 for the confirmed release-ready completion scope. |
| 2026-08-10 | SESSION-28 added parametric recipes, pinned font compiler dependencies, and WOFF2 verification. |

<!-- adaptive-layouts-impl feature-end (Jikijitsu) -->

## Adaptive layouts: tooling graduation — adaptive-layouts-impl

- **M97 scanner:** wide↔prod findings are ERROR-level; `PRODUCTION_CSS_FILES` includes `styles/wide.css`; `WIDE_ONLY_PREFIX` skip removed; sole exception `MOCK_GENERATED_MARKERS = {deploy-p, deploy-e}` stays warning-level in BOTH layouts (canvas-drawn in production). `DERIVED_SURFACE_TOKENS` allowlist (5 scrollbar/fade tokens) documented in specs/design.md `### Derived Surface Tokens` (placed outside all six extractor anchors). Post-graduation scan baseline: 9 findings (0 error / 7 warning / 2 info).
- **M99 parity:** wide graduated from mock-only to true side-by-side — `captureSideBySide` is layout-aware; `setupProdPage`/`buildParty` drive wide-class-*/wide-sigil-* testids in wide; 15/15 wide screens capture with prod.
- **M95 acceptance:** 3 wide chromium projects (1440×900, 1920×1080, 1024×1024 + hasTouch) `testMatch`-scoped to `tests/e2e/adaptive-layout.spec.js` (FR-35 battery); the 4 legacy portrait projects are unmodified and serve as the portrait regression guard. CRT-assert quirk: `.crt-scanlines` needs `toBeAttached()` + boundingBox (no layout content → `toBeVisible()` false); `scanlineGrainEnabled: false` hides the whole `#crt-overlays` container.
- **Known debt (surfaced 2026-08-15, unowned by any session):** legacy e2e failures at accessibility.spec.js:56 (asserts retired letterbox), keyboard-flow.spec.js:89 (asserts pre-toggle title branches), import-errors.spec.js:40 (uninvestigated); `scripts/lint-sigils.js` SKIP_DIRS lacks `test-results/` (Playwright artifacts trip sigil-lint during concurrent e2e runs).
