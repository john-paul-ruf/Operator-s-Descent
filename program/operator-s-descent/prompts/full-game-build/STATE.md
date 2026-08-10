# State Tracker — Operator's Descent / full-game-build

## Program
- **Name:** Operator's Descent
- **Slug:** `operator-s-descent`
- **Intent:** Build a complete, buildless, static-hosted d20 dungeon roguelike rendered as a degrading CRT/VHS terminal

## Feature
- **Name:** full-game-build
- **Intent:** Build the entire game from empty repo to playable end-to-end in 15 sessions

## Sessions

## Session Status
| # | Session | Modules | Status | Completed | Notes |
|---|---------|---------|--------|-----------|-------|
| 01 | Scaffolding: HTML, CSS, Service Worker, Event Bus | M77-M80, M81, M34, M82(partial) | done | 2026-08-10 | All scaffolding files created. CRT frame renders. Event bus functional. main.js loads data and attempts title mount (expected fail). Service worker registered. Placeholder woff2 font created (8 bytes). |
| 02 | Core Logic: PRNG, Hash, RNG Cursor | M01, M02, M03 | done | 2026-08-10 | Core logic modules created: PRNG (xorshift128+), FNV-1a hash, RNG cursor with save/restore. All zero-dependency, verified for determinism. Fixed syncTo: when prngState provided, just setState+setCursor (no fast-forward). |
| 03 | Data Files: All JSON Content + Placeholder Font | M04–M14 | pending | | |
| 04 | Rules Engine Part 1: Attributes, Scaling, Classes, Equipment, Conditions | M15–M19 | pending | | |
| 05 | Rules Engine Part 2: Protocols, Consumables, Loot, Enemies, Combat, Inventory | M20–M25 | pending | | |
| 06 | Floor Generation + Run-State Stub | M26–M29, M33(stub) | pending | | |
| 07 | Exploration: Lattice, Shadowcast, Movement | M30–M32 | pending | | |
| 08 | State Management Full: Run State, Condense, Compress, Encrypt, Save Encode/Decode, Library, Party Configs | M33(full), M35–M46 | pending | | |
| 09 | Audio Engine: 5-Layer WebAudio Synthesis | M47–M52 | pending | | |
| 10 | Glitch System: JS-Driven Effects, Grain, Transitions | M53–M55 | pending | | |
| 11 | UI Foundation: Components, Input, Playfield, Status Strip | M56–M59 | pending | | |
| 12 | Console: Shell + 7 Modes | M60–M67 | pending | | |
| 13 | Primary Screens: Title, Creation, Exploration, Combat | M68–M71 | pending | | |
| 14 | Remaining Screens: Library, Scorecard, Import, Tutorial, Settings | M72–M76 | pending | | |
| 15 | Wiring & Integration: Final Assembly | M82(full) + all wiring | pending | | |

## Dependency Graph

```
SESSION-01 (scaffolding)
  ├─→ SESSION-02 (core: PRNG, hash, cursor)
  │     ├─→ SESSION-04 (rules part 1)
  │     │     └─→ SESSION-05 (rules part 2)
  │     │           └─→ SESSION-06 (floor generation + run-state stub)
  │     │                 └─→ SESSION-07 (exploration: lattice, shadowcast, movement)
  │     │                       └─→ SESSION-08 (state management full)
  │     │                             ├─→ SESSION-11 (UI foundation)
  │     │                             │     └─→ SESSION-12 (console)
  │     │                             │           └─→ SESSION-13 (primary screens)
  │     │                             │                 └─→ SESSION-14 (remaining screens)
  │     │                             │                       └─→ SESSION-15 (wiring)
  │     │                             ├─→ SESSION-09 (audio) ──────────────────┐
  │     │                             └─→ SESSION-10 (glitch) ─────────────────┤
  └─→ SESSION-03 (data files) ────────────────────────────────────────────────┘
```

**Parallel opportunities:**
- SESSION-02 and SESSION-03 can run in parallel (no dependencies on each other)
- SESSION-09 and SESSION-10 can run in parallel (both depend only on core + data)
- SESSION-09, SESSION-10 can run in parallel with SESSION-07/08

## Architecture Reference (feature-specific)

Full config in FORGE-CONFIG.md. Key points for this feature:
- **Render:** Hybrid Canvas 2D (playfield, grain) + DOM/CSS (console, screens, CRT effects)
- **State:** Event bus + serializable RunState, localStorage CRUD
- **Save:** Field-level condense → progressive compression (5 passes) → XOR encrypt → base64url (< 1500 chars)
- **PRNG:** xorshift128+ with 128-bit state, deterministic from uint32 seed
- **Audio:** WebAudio 5-layer synthesis, no files
- **Glitch:** Constant per-element intensity, no game-state-driven effects

## Scope Summary

| Module ID Range | Subsystem | Sessions |
|----------------|-----------|----------|
| M01–M03 | Core logic | 02 |
| M04–M14 | Data files | 03 |
| M15–M25 | Rules engine | 04, 05 |
| M26–M29 | Floor generation | 06 |
| M30–M32 | Exploration | 07 |
| M33–M46 | State management | 06 (stub), 08 (full) |
| M47–M52 | Audio | 09 |
| M53–M55 | Glitch | 10 |
| M56–M59 | UI foundation | 11 |
| M60–M67 | Console | 12 |
| M68–M71 | Primary screens | 13 |
| M72–M76 | Remaining screens | 14 |
| M77–M82 | Scaffolding + entry | 01, 15 |

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| No build step, no bundler | Hard constraint from spec — native ES modules served as-is |
| 15 sessions (expanded from 12 phases) | Rules engine and state management split to stay under 30 min / 200 lines per session |
| SESSION-02 and SESSION-03 parallel | Core logic and data files have no mutual dependencies — can be built simultaneously |
| Run-state stub in SESSION-06 | movement.js needs run-state.js to compile — stub allows sequential build without forward dependency |
| Progressive compression (5 passes) | Each pass catches patterns the previous granularity can't see; budget check after each |
| Field-level symbol tables (not whole-state dictionary) | Individual fields have small, enumerable value spaces — ~90-95% table hit rate in typical play |

## Handoff Notes

### SESSION-01 → SESSION-02/03

**What was built:**
- `index.html` — portrait frame container with CSS links and font-face
- `styles/base.css` — all CSS custom properties, typography scale, spacing system, portrait letterboxing, utility classes (glow, panel, btn-crt, bar-track, scroll-area, sigil sizes)
- `styles/crt.css` — all always-on CRT layers (scanlines, grille, vignette, tracking, grain, border flicker, frame flash) + JS-driven containers (glitch bars, noise lines, VHS) + per-element text glitch `[data-glitch]` / `.text-swapping` + reduced-motion fallback
- `styles/components.css` — all component classes from design spec (console shell, mode tabs, status strip, dpad, initiative rail, combat grid, item cards, rarity tags, affix tags, condition tags, action buttons, steppers, attribute rows, sliders, toggles, tab buttons, class cards, character slots, member pills, deck slots, run rows, accent swatches, link input, share link, log entries, page dots, sigil placeholders, calibration cards, loot containers)
- `src/state/bus.js` — event bus with on/dispatch
- `service-worker.js` — cache-first strategy with asset manifest
- `src/main.js` (partial) — SW registration, data file loading, mountScreen router stub, URL fragment routing
- `assets/descent-sigil.woff2` — placeholder 8-byte file

**What differs from the session prompt:**
- Components.css includes additional classes (`action-btn`, `action-cost`, `stepper-btn`, `attr-row`, `deck-slot`, `calibration-card`, `loot-container`, `char-slot`, `class-card`, `tab-btn`, `sigil-placeholder`, `sigil-option`, `mode-indicator`) from the mock files and design spec that weren't explicitly listed but are referenced by the component inventory.
- Added `.screen-container` class in base.css for screen mount targets.
- `assets/descent-sigil.woff2` is a minimal placeholder (8 bytes) — not a real WOFF2 font. SESSION-03 should replace it if building data files + font. The session prompt mentions it belongs to SESSION-03's scope (M14), but the SW needs it in the cache manifest.

**Warnings / things to know:**
- `main.js` will console.error when attempting to import `./ui/screens/title.js` — this is expected behavior (the screen doesn't exist yet).
- The service worker will fail to cache missing data files on first install — expected since data/*.json don't exist yet (SESSION-03 creates them).
- The `#crt-overlays` div in index.html is currently empty — CRT layer DOM elements will need to be injected by the glitch system (Phase 7) or manually created at screen mount time.
- No `package.json` exists yet (by design — no runtime dependencies). Vitest config will need to be set up when tests are first written.

### SESSION-02 → SESSION-03/04

**What was built:**
- `src/core/prng.js` — xorshift128+ PRNG with `createPRNG`, `next()`, `nextInt()`, `getState()`, `setState()`, `hash()` (non-advancing)
- `src/core/hash.js` — FNV-1a hash with `Math.imul`, handles numbers, strings, bigints. Returns uint32.
- `src/core/rng-cursor.js` — Cursor wrapping two PRNG streams (gen/combat), `syncTo` for save/restore

**Notes for next session:**
- `syncTo` behavior: when `prngState` is provided, it sets state directly and sets cursor (no fast-forward needed — the saved state IS the state at that cursor). When `prngState` is null, it fast-forwards from current position by drawing values.
- PRNG `hash()` method uses FNV-1a internally and is non-advancing — same as standalone `hash()` from `hash.js`.
- PRNG seeds: use `hash(worldSeed, "gen")` and `hash(worldSeed, "combat")` to derive stream seeds.