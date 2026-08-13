# State Tracker — Operator's Descent / visual-parity-v4

## Program
Operator's Descent (`operator-s-descent`) — see `./program/operator-s-descent/FORGE-CONFIG.md`.

## Feature
**visual-parity-v4** — close the visual-parity gap with `./mocks/*.html` across every screen and console pane, and introduce an in-frame scroll pattern for overflowing screens.

## Intent
The functional baseline works but drifts from the mocks in layout, tokens, typography, CRT overlays, components, and motion cadence; several screens (tutorial, library, scorecard, log, creation, gear) have content that exceeds the fixed portrait canvas and is currently clipped or squashed. This feature audits every screen against its mock via the M97 compliance scanner and the M99 parity-shot tool, then applies targeted fixes screen-by-screen, plus a shared in-frame scroll container pattern so the portrait letterbox is preserved while content becomes reachable.

## Sessions
15 sessions across 5 phases (discovery → foundations → screens → console → motion + verify).

## Session Status

| # | Session | Modules | Status | Completed | Notes |
|---|---------|---------|--------|-----------|-------|
| 01 | Discovery — run scanners, write `GAP-REPORT.md` | M97, M99 | pending | — | Gates every downstream session. |
| 02 | Scroll-container architecture (pinned strip + console, scrolling body) | M77, M79, M56, M82 | pending | — | Establishes `.screen-body` pattern used by S06–S13. |
| 03 | Design tokens & typography reconciliation | M77, M79, M97 | pending | — | Aligns CSS custom properties + type scale with mocks. |
| 04 | CRT overlay & effect parity | M78, M98, M53, M54, M55 | pending | — | Scanlines, vignette, grille, tracking bars, grain cadence. |
| 05 | Shared components parity | M56, M79 | pending | — | Buttons, tabs, cards, sliders, bars, progress meters. |
| 06 | Title screen parity | M68, M77–M79 | pending | — | Follows `./mocks/title.html`; single-state per Rule #10. |
| 07 | Creation screen parity + scroll | M69, M92, M56, M77–M79 | pending | — | 80-point buy grid; likely needs `.screen-body` scroll. |
| 08 | Exploration screen parity | M70, M58, M59, M60, M77–M79 | pending | — | Playfield + status-strip + console composition. |
| 09 | Combat screen parity | M71, M58, M59, M60, M77–M79 | pending | — | Zoomed grid, initiative, action bar. |
| 10 | Library + Scorecard parity + scroll | M72, M73, M56, M77–M79 | pending | — | Both are list/table-heavy; scroll expected. |
| 11 | Settings + Tutorial + Import parity + scroll | M74, M75, M76, M56, M77–M79 | pending | — | Tutorial is paginated but pages themselves scroll. |
| 12 | Console shell parity (tab bar, expand/collapse, framing) | M60, M79 | pending | — | Prerequisite for S13. |
| 13 | Console mode panes parity (move/combat/party/gear/tech/loot/log) + scroll | M61–M67, M56, M79 | pending | — | Pane bodies scroll; tab bar pinned. Consider splitting if >200 lines. |
| 14 | Motion & glitch cadence parity | M53, M55, M78 | pending | — | Transition timings and glitch tick cadence against mocks. |
| 15 | Final verification — full scan, parity shots, gap-report close-out | M97, M99, M95 | pending | — | No new fixes; only verification. If gaps remain, spawn follow-up sessions and stop. |

**Status legend:** `pending` | `in-progress` | `done` | `blocked` | `skipped`

## Dependency Graph

```
S01 (discovery)
 └─ S02 (scroll arch) ──┬─ S03 (tokens/typography) ──┐
                        ├─ S04 (CRT overlays) ───────┤
                        └─ S05 (shared components) ──┤
                                                     ▼
                     ┌───────────────────────────────┬───────────────────┐
                     ▼                               ▼                   ▼
                    S06 (title)   S07 (creation)   S08 (exploration)   S09 (combat)
                    S10 (library+scorecard)   S11 (settings+tutorial+import)
                                                     ▼
                                                S12 (console shell) ─── S13 (console modes)
                                                     ▼
                                                S14 (motion cadence)
                                                     ▼
                                                S15 (verify + close-out)
```

Parallelism: S03/S04/S05 may run in parallel after S02 (different files). S06–S11 may run in parallel after S02+S03+S04+S05 (each touches one screen module). S12 must complete before S13.

## Architecture Reference (feature-specific)

- **Portrait frame** is defined in `./styles/base.css` and `./index.html`. All scrolling must occur *inside* the letterboxed frame — never in the viewport itself (violates Rule #8).
- **New in this feature:** a `.screen-body` container class (owned by M79) with `overflow-y: auto`, momentum scrolling on touch, custom scrollbar styling, and a masked fade at top/bottom edges to match the CRT aesthetic. Screens that don't overflow may still use it (no-op when content is shorter than the container).
- **Pinned regions:** the status strip (M59) and the console (M60) stay pinned within their screen; only the middle body scrolls. On screens without a console (title, library, scorecard, settings, tutorial, import, creation), the whole non-strip area is the scroll body.
- **Mocks are Tailwind (Rule #3)** — do NOT copy Tailwind classes into prod. Translate to the hand-written CSS tokens in `./styles/*.css`, extending M77/M79 where a token or component is missing.

## Scope Summary — Modules Affected

Foundations: **M56, M77, M78, M79, M82, M98**
Screens: **M68, M69, M70, M71, M72, M73, M74, M75, M76, M92**
Console: **M60, M61, M62, M63, M64, M65, M66, M67**
Effects: **M53, M54, M55**
Tooling (read-only, executed): **M95, M97, M99**

## Design Decisions

1. **Discovery-first.** Runs S01's scanner + parity tool before any code change so every session has a machine-generated target list. Rationale: the last two visual-parity passes (`v2`, `v3`) drifted because they were done from memory of the mocks; the tooling in M97/M99 exists specifically to close this loop.
2. **In-frame scroll, not viewport scroll.** Custom Rule #8 forbids reflow — the portrait canvas is fixed. Scrolling lives in a `.screen-body` container inside the frame. Rationale: preserves the console's authored aesthetic; touch users get momentum scroll without breaking letterboxing.
3. **Foundations before screens.** S02–S05 (scroll, tokens, CRT, components) land before any per-screen work so screen sessions apply the new tokens/components rather than inline-patching. Rationale: avoids cross-session merge conflicts on shared CSS.
4. **Console shell before console modes.** S12 fixes the shell (M60) first so S13's per-mode work builds on a mock-accurate shell. Rationale: shell changes would otherwise ripple through every mode session.
5. **Do NOT modify FORGE-CONFIG Custom Rules** without an explicit user decision. If a rule blocks a mock-parity fix, set the session to `blocked` with the specific rule cited. Rationale: Rule #10 was already dropped once during v2 for this reason; further drops should be deliberate.

## Handoff Notes

_(Agents append after each session — most recent last.)_

---

**Template:**

```
### SESSION-NN — YYYY-MM-DD — <agent handle or "claude-code">
- **Delivered:** …
- **Verification:** `npm test` → …, `npm run design:scan` → …, `npm run parity:shots -- --screen <name>` → …
- **Surprises / deviations:** …
- **Follow-up needed:** …
- **Commit:** `<sha>`
```
