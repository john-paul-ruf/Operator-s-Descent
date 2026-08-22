# State Tracker — Operator's Descent / mobile-combat-density-repair

## Program / Feature / Intent / Sessions

- **Program:** Operator's Descent (operator-s-descent)
- **Feature:** mobile-combat-density-repair
- **Intent:** Deliver the previously landed icon-first and console-density work to the real portrait combat screen, then prove that the initial phone view exposes the compact status readout and the complete primary combat action row without sacrificing any combat information, accessibility, or the 96px touch-control floor.
- **Sessions:** 2
- **Authoritative config:** ./program/operator-s-descent/FORGE-CONFIG.md (existing; reused without override)

## Current Observation

The report that several visual fixes appeared unchanged has two confirmed causes in the current 412×915 phone baseline:

| Surface | Current measurement | Consequence |
|---|---:|---|
| Combat status strip | 226px | The active actor uses the generic vertical group, so one metric cell expands to 111px and pushes initiative/manual affordances into additional rows. |
| Inactive feedback rail | 22px | Padding and borders consume space even with both message children hidden. |
| Half-tray console content | 162px visible / 627px action content | The 96px tab bar plus a two-column grid whose three primary actions each span a full row shows only one primary action at a time. |
| Service-worker release | Cache version 2026-08-22-mobile-combat-density-v8 | SESSION-01 replaced v7 and its integration test proved predecessor eviction/v8 retention. Real controlled/offline browser proof remains SESSION-02. |

## Session Status

| # | Session | Modules | Owns | Status | Checkpoint | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 01 | Recompose and release the portrait combat density contract | M59, M62, M71, M79, M81, M97, M107 | ./src/ui/status-strip.js; ./src/ui/console/combat.js; ./src/ui/screens/combat.js; ./styles/components.css; ./specs/design.md; ./service-worker.js; ./tests/ui/status-strip.test.js; ./tests/ui/console-combat.test.js; ./tests/ui/combat-screen.test.js; ./tests/integration/service-worker.test.js | done | 3/3 | 2026-08-22 | Recomposed the portrait combat status strip into a dedicated .status-combat-overview (topline row + one horizontal active-actor row + initiative rail) instead of the vertical per-metric stack that drove the 226px/111px regression; compacted combat action buttons to icon+verb+cost-chip with full phrase in aria-label and a 3-col primary row; made the feedback rail's inactive chrome zero-cost via an explicit is-active flag; bumped service-worker cache to v8. |
| 02 | Prove mobile combat density and cache refresh in a real phone browser | M95, M97, M99 | ./tests/e2e/mobile-combat-density.spec.js | pending | — | — | Depends on SESSION-01. The new dedicated spec avoids the write lease held by the pending console submenu browser session. |

## Wave Plan

| Wave | Sessions | Why serial |
|---|---|---|
| 1 | SESSION-01 | Status markup, combat action markup, feedback rail behavior, portrait CSS, design contract, and cache version are one user-visible composition and must ship together. |
| 2 | SESSION-02 | Browser assertions consume the delivered DOM, CSS, and release version from SESSION-01; it owns only a new acceptance file. |

## Granularity Note

Two sessions are deliberate rather than a split by file count:

- **SESSION-01** owns a single interlocking runtime composition. Separating status markup, action markup, feedback behavior, CSS, and the release cache would either create incompatible intermediate DOM/CSS states or risk shipping the repaired source under the old cache key.
- **SESSION-02** creates a new substantive browser acceptance surface after that composition exists. It is not a verification-only tail: it adds deterministic geometry, interaction, offline cache, and visual evidence that the current tests do not provide.

## Dependency Graph

```mermaid
flowchart TD
  S01["S01 · recompose + release"] --> S02["S02 · phone acceptance"]
```

## Architecture Reference

- **M59 — Status Strip:** Keep every combat field visible, but render the portrait combat variant as a compact, semantic overview rather than inheriting the generic stacked status-group geometry.
- **M62 — Console Combat:** Preserve gameplay decisions, disabled reasons, data-testid hooks, direction/target flows, and DOM/focus order while making the first primary-action row fit the half tray.
- **M71 — Combat Screen:** Preserve the in-flow status → playfield → feedback → console hierarchy; make an inactive feedback rail cost zero vertical space without removing its live-region node.
- **M79 — Components CSS:** Scope the recomposition to portrait combat and retain 96px minimum heights for tabs, combat actions, directions, targets, and other actual touch controls.
- **M81 — Service Worker:** Bump the cache namespace so cache-first clients receive the repaired runtime assets and verify stale v7 cache eviction.
- **M95 — Browser Acceptance:** Exercise a deterministic, real combat state at phone sizes rather than only checking classes in unit tests.
- **M97 — Design Compliance Scanner:** Update the written density contract and retain scanner compliance; the scanner is a gate, not a source rewrite.
- **M99 — Screenshot Parity Tool:** Capture the production combat composition as visual evidence. The historical ./mocks/combat.html remains a diagnostic reference, not the authority for this repair.
- **M107 — Icon System:** Reuse the shipped sprite and runtime factory. No new icon asset, build step, or icon dependency is needed.

## Scope Summary

| ID | Module | Scope |
|---|---|---|
| M59 | Status Strip | Replace the portrait combat strip’s accidental vertical stack with compact icon-plus-value metric groups and a bounded active-actor summary; retain all values and accessible names. |
| M62 | Console Combat | Remove duplicate empty/summary content, retain active condition tags only when present, and arrange primary actions in the first portrait grid row. |
| M71 | Combat Screen | Mark feedback activity on the persistent rail so inactive chrome collapses and messages expand in place. |
| M79 | Components CSS | Add portrait-only combat geometry for the status overview, zero-cost inactive feedback rail, and three-column primary action row while preserving the control floor. |
| M81 | Service Worker | Publish a new cache namespace for the changed runtime assets and assert the exact prior namespace is deleted at activation. |
| M95 | Browser Acceptance | Add deterministic 412×915 and 360×800 real-combat acceptance with geometry, reachability, action, and feedback assertions. |
| M97 | Design Compliance Scanner | Keep written rules and scan output consistent with the new no-hidden-information, 96px-control-floor contract. |
| M99 | Screenshot Parity Tool | Produce/inspect the repaired combat capture; do not use the stale mock to weaken production acceptance. |
| M107 | Icon System | Consume existing semantic SVG symbols for visible compact metrics and action controls; retain labels for assistive technology. |

## Design Decisions

1. **Repair structure, not just spacing.** The 226px strip comes from the generic column layout of the active group, so smaller gaps alone cannot solve the density regression. SESSION-01 creates a combat-specific overview that keeps every field while changing its spatial composition.
2. **Keep all combat information visible.** There is no portrait collapse state, hidden telemetry, deleted initiative, or text-only fallback. Compact visible icons and values supplement complete accessible labels; red remains reserved for hostile state.
3. **Keep controls touch-safe.** A smaller status/readout is not permission to make actions smaller. Portrait tabs, actions, directions, targets, and confirm controls continue to meet the 96px minimum; density comes from a three-column action row, static-content removal, compact internal gaps, and scrolling for secondary actions.
4. **Make empty chrome truly empty.** The feedback rail stays mounted with its existing live-region behavior, but its inactive state has zero height, padding, and border. A notice/error re-expands it without overlap or screen reordering.
5. **Treat the release path as part of the fix.** The repaired source must be cache-addressable by a version newer than v7. Otherwise a correct local/browser result can still leave installed users on the prior assets.
6. **Keep wide behavior unchanged.** Portrait-combat selectors carry the new composition. Existing wide telemetry dock and wide combat console behavior are regression-tested but not redesigned here.
7. **Use production as visual truth.** The existing ./mocks/combat.html predates the current runtime grammar and is visibly stale at phone height. SESSION-01 updates the design contract and SESSION-02 proves production geometry; mock drift is recorded by parity rather than copied into production.

## Interlocks and Handoffs

- The source commits from ./program/operator-s-descent/prompts/console-submenu-density-and-scroll/SESSION-03.md are already present even though that feature’s ./program/operator-s-descent/prompts/console-submenu-density-and-scroll/STATE.md records a blocked orchestration handle. Treat those committed renderer changes as the baseline; do not edit that feature’s planning artifacts.
- The pending ./program/operator-s-descent/prompts/console-submenu-density-and-scroll/SESSION-04.md owns several existing browser specs. SESSION-02 writes only ./tests/e2e/mobile-combat-density.spec.js and declares browser/parity resources so Jikijitsu can serialize execution safely.
- Preserve unrelated working-tree state, including the pre-existing deletion at ./program/operator-s-descent/prompts/shared-menu-primitives/STATE.md and the untracked ./.DS_Store. Neither belongs to this feature.

## Handoff Notes (Jikijitsu writes here after each session — from Mu's handoff JSON, verbatim)

<!-- SESSION-01 -->
```json
{
  "session": "01",
  "status": "done",
  "checkpoint": 3,
  "notes": "Recomposed the portrait combat status strip into a dedicated .status-combat-overview (topline row + one horizontal active-actor row + initiative rail) instead of the vertical per-metric stack that drove the 226px/111px regression; compacted combat action buttons to icon+verb+cost-chip with full phrase in aria-label and a 3-col primary row; made the feedback rail's inactive chrome zero-cost via an explicit is-active flag; bumped service-worker cache to v8.",
  "delivered": "src/ui/status-strip.js: new status-combat-overview/topline/active-row composition with M107 icon prefixes (gauge/sparkles/hash/heart/battery/zap/footprints), all prior fields/classes/testids preserved. src/ui/console/combat.js: action buttons now show a concise verb + icon + compact cost chip (≤5, 1 AP, 1 AP+CHG, 1 AP+OC) with the full phrase moved to aria-label; title stays reserved for the disabled reason. styles/components.css: .combat-action-list is a 3-col grid (2-col fallback below 340px) with combat-action--primary as a semantic-only class; .combat-feedback-rail:not(.is-active) collapses padding/border to zero; new .status-combat-* rules scoped to portrait combat. src/ui/screens/combat.js: syncFeedbackRail now sets rail.classList('is-active')/dataset.active, live region and children stay mounted. specs/design.md: portrait combat section rewritten with the new composition, budgets, and rail contract. service-worker.js: CACHE_VERSION → 2026-08-22-mobile-combat-density-v8 (manifest unchanged, already covers all 4 changed runtime assets).",
  "verification": "npx vitest run (targeted 4 files) → 125/125 pass; npx vitest run (full suite) → 2817/2819 pass, 2 pre-existing failures in tests/ui/exploration-screen.test.js confirmed present on a clean stash of main (outside this session's lease, unrelated to combat/status-strip/service-worker); node --check on all 4 touched source files → OK; npm run design:scan → PASS (0 errors, 2 pre-existing INFO findings unrelated to this session); npm run check:assets → within 512000-byte budget (334535 brotli bytes); git diff --check → clean.",
  "surprises": "Checkpoint 2 bullet 3 asked to stop the portrait conditions row from duplicating AP/move telemetry already on the status strip. I kept `.combat-ap` (AP N · MOVE READY/SPENT) rendering unconditionally in src/ui/console/combat.js's activeConditions row because tests/e2e/combat-touch.spec.js and tests/e2e/portrait-usability.spec.js — outside this session's lease, unmodifiable — hard-assert `.combat-ap` text at every step of a portrait move regardless of whether the active actor carries a condition; removing it would break those untouchable specs. I did apply the literal 'conditions readout only when actual conditions exist' instruction to the condition-tag list itself, which already rendered nothing for zero conditions (no code change was needed there) — documented this reasoning inline. Did not measure actual rendered px heights in a live/Playwright browser (Playwright is dev-only and not part of this session's Verification commands); the CSS budget math is reasoned from box-model arithmetic, not measured — SESSION-02 owns real-browser proof per the Wave Plan.",
  "followUp": "SESSION-02 should capture actual 412×915 and 360×800 measurements (status height, feedback height, canvas height, first action-row geometry) in a real/Playwright browser and confirm against the ≤128px/≤136px budget now documented in specs/design.md; if the 3-column action grid or status overview run over budget on real font metrics, the fix is a CSS-only follow-up (gap/padding trim), not a structural change. Also worth flagging to Forge: the `.combat-ap` AP/move duplication between the status strip and the portrait console pane is now a known, deliberately-kept redundancy pinned by e2e — a future session could retire it by first updating tests/e2e/combat-touch.spec.js and portrait-usability.spec.js to read AP/move from the status strip instead.",
  "filesTouched": ["src/ui/status-strip.js", "src/ui/console/combat.js", "src/ui/screens/combat.js", "styles/components.css", "specs/design.md", "service-worker.js", "tests/ui/status-strip.test.js", "tests/ui/console-combat.test.js", "tests/ui/combat-screen.test.js", "tests/integration/service-worker.test.js"],
  "blockedReason": null
}
```
