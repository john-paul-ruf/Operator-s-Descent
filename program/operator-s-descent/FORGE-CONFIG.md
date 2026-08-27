# FORGE-CONFIG — Operator's Descent

## Program Info

| Field | Value |
|-------|-------|
| **Display Name** | Operator's Descent |
| **Slug** | `operator-s-descent` |
| **Root** | `./program/operator-s-descent/` |
| **Owner** | John Ruf / Glitch Forgeworks LLC |
| **Status** | Functional baseline present → acceptance-complete build planned |
| **Created** | 2026-08-09 |

## Stack

| Layer | Technology |
|-------|-----------|
| **Language** | JavaScript (ES2022+, vanilla) |
| **Runtime** | Browser (static files, no build step) |
| **Framework** | None (vanilla JS, native ES modules) |
| **Package Manager** | None (no npm at runtime, no dependencies) |
| **Build** | None (files served as-is) |
| **Test Framework** | Vitest (dev-only, not shipped; tests in `tests/`) |
| **Browser Acceptance** | Playwright (dev-only, installed during the release-certification sessions; never shipped or cached) |
| **Typeface Tooling** | Python 3 + FontTools/Brotli (dev-only compiler for original outlines → WOFF2; generated font is the only shipped output) |
| **UI Rendering** | Canvas 2D (playfield, grain) + DOM/CSS (console, screens, CRT effects) |
| **Audio** | WebAudio API (synthesized, no audio files) — conductor-driven generative chiptune: one lookahead clock + 5 render layers [AMENDED 2026-08-19 via dynamic-chiptune; landed S01–S02. NOTE: production AudioContext lifecycle restored via restore-audio-output — runtime creates the context eagerly, first gesture resumes it] |
| **State Management** | Custom event bus + immutable run-state snapshot pattern |
| **Database** | `localStorage` (run library, settings) + URL fragment (portable saves `#r=`/`#w=`; session routing `#a=` — see history-and-scroll) |
| **Deployment** | Static file hosting (S3, GitHub Pages, Netlify, nginx) |

## Architecture

| Aspect | Value |
|--------|-------|
| **Pattern** | Layered module-based monolith: core → floor → rules → exploration → state → audio/glitch → UI |
| **Dependency Flow** | core (prng, hash, rng-cursor) → data/*.json → rules → floor/exploration → state → audio/glitch → ui/screens/console → main.js |
| **DI** | None explicit; modules import directly; data passed via function parameters |
| **State Management** | Event bus (`bus.js`) for pub/sub; `RunState` as single serializable object; localStorage CRUD via `library.js` |
| **Entry Points** | `index.html` → `src/main.js` cold bootstrap; `src/runtime.js` is dynamically imported only after START and then owns data, service worker, settings, routing, audio, and effects |
| **Rendering** | Hybrid: Canvas 2D for lattice/grain; DOM/CSS for console/screens/CRT effects |

## Module Registry

| ID | Module | Path | Owns | Imports From | Key Files |
|----|--------|------|------|-------------|-----------|
| M01 | PRNG | `src/core/prng.js` | xorshift128+ deterministic PRNG | (none) | `prng.js` |
| M02 | Hash | `src/core/hash.js` | FNV-1a stable hashing | (none) | `hash.js` |
| M03 | RNG Cursor | `src/core/rng-cursor.js` | PRNG position tracking for save/restore | M01 | `rng-cursor.js` |
| M04 | Sigils Data | `data/sigils.json` | PUA codepoints, safe substitution pool | (none) | `sigils.json` |
| M05 | Themes Data | `data/themes.json` | 12 environment themes | (none) | `themes.json` |
| M06 | Classes Data | `data/classes.json` | 6 class definitions | (none) | `classes.json` |
| M07 | Protocols Data | `data/protocols.json` | 20 protocol definitions | (none) | `protocols.json` |
| M08 | Enemies Data | `data/enemies.json` | 8 archetype stat blocks | (none) | `enemies.json` |
| M09 | Equipment Data | `data/equipment.json` | Weapon/armor categories | (none) | `equipment.json` |
| M10 | Affixes Data | `data/affixes.json` | 16 affix definitions | (none) | `affixes.json` |
| M11 | Conditions Data | `data/conditions.json` | 9 condition definitions | (none) | `conditions.json` |
| M12 | Consumables Data | `data/consumables.json` | 7 consumable types | (none) | `consumables.json` |
| M13 | Symbol Table | `data/symbol-table.json` | Field-level lookup tables for save encoding — still version 1 (planned v2 bump replaced by inline codec enums in M89, saves-never-fail S01); `data/symbol-table.v6.json` is the frozen v6-paired snapshot (byte-identical to v1) | (none) | `symbol-table.json`, `symbol-table.v6.json` |
| M14 | Font Asset | `assets/descent-sigil.woff2` | Placeholder WOFF2 font | (none) | `descent-sigil.woff2` |
| M15 | Attributes Rules | `src/rules/attributes.js` | Attribute modifiers, derived stats, costs | M06 | `attributes.js` |
| M16 | Scaling Rules | `src/rules/scaling.js` | Depth scaling formulas | (none) | `scaling.js` |
| M17 | Classes Rules | `src/rules/classes.js` | Signature logic, gating, calibration | M06 | `classes.js` |
| M18 | Equipment Rules | `src/rules/equipment.js` | Weapon/armor stats, range bands, cover | M09, M10 | `equipment.js` |
| M19 | Conditions Rules | `src/rules/conditions.js` | Condition application, ticking, clearing | M11, M15 | `conditions.js` |
| M20 | Protocols Rules | `src/rules/protocols.js` | Casting, overclock, CHARGE economy, effects | M07, M15, M19 | `protocols.js` |
| M21 | Consumables Rules | `src/rules/consumables.js` | Consumable effects, stacking, usage | M12 | `consumables.js` |
| M22 | Loot Rules | `src/rules/loot.js` | Loot generation, rarity rolls, CORRUPT; v7 short generated ids `l<hash36>-<idx>` ≤9 chars (same hash inputs — determinism preserved), `rarityTier` no longer emitted (derive from `rarity`) (saves-never-fail S01) | M02, M01, M10, M09, M12, M16 | `loot.js` |
| M23 | Enemies Rules | `src/rules/enemies.js` | Enemy creation, scaling, AI, Echo | M01, M08, M16, M15 | `enemies.js` |
| M24 | Combat Rules | `src/rules/combat.js`, `src/rules/combat-geometry.js` | d20 resolution, initiative, AP, tactical geometry, cover | M01, M15, M19, M18, M23, M20 | `combat.js`, `combat-geometry.js` |
| M25 | Inventory Rules | `src/rules/inventory.js` | `INVENTORY_CAP` = **40** (v7; was 100) — program-wide single source, sized by the budget model; imported by M33/M89 (rules → state is legal flow); junk tagging, salvage (saves-never-fail S01, per D6) | M09, M12 | `inventory.js` |
| M26 | Floor Archetypes | `src/floor/archetypes.js` | 8 generation algorithms | M01 | `archetypes.js` |
| M27 | Floor Modifiers | `src/floor/modifiers.js` | Modifier pool application | M01, M05 | `modifiers.js` |
| M28 | Floor Validator | `src/floor/validator.js` | 6 validation checks | (none) | `validator.js` |
| M29 | Floor Generator | `src/floor/generator.js` | Orchestrates generation + validation loop | M01, M03, M02, M26, M27, M28, M05 | `generator.js` |
| M30 | Lattice | `src/exploration/lattice.js` | 40×64 grid model (grown from 20×32, 2026-08-20 via playtest-clarity-and-4x-floors; dims flow from `src/floor/archetypes.js` GRID_W/GRID_H), cell types, party position | M29 | `lattice.js` |
| M31 | Shadowcast | `src/exploration/shadowcast.js` | Shadowcast LOS, 3-state fog of war | M30 | `shadowcast.js` |
| M32 | Movement | `src/exploration/movement.js` | 8-way movement, auto-stop, danger clock | M30, M31, M33, M03, M23 | `movement.js` |
| M33 | Run State | `src/state/run-state.js` | Canonical run state object (diff + persistent). v7 caps: persisted events 24, corrupt ledger 32, combat 8192 B; `INVENTORY_CAP` imported from M25; `LEGACY_MAX_*` load-tolerant bounds keep frozen v3–v6 readers accepting oversized legacy state (clamped by the v6→v7 migration) (saves-never-fail S01) | M34, M03, M25 | `run-state.js` |
| M34 | Event Bus | `src/state/bus.js` | Lightweight pub/sub event bus | (none) | `bus.js` |
| M35 | Condense | `src/state/condense.js` | Version-keyed field-level lookup table registry (multiple tables coexist; `expand(data, version)` selects by version) | M13, M02, M33 | `condense.js` |
| M36 | Compress 1-bit | `src/state/compress/pass-1bit.js` | Bit-level RLE + pattern dictionary | (none) | `pass-1bit.js` |
| M37 | Compress 4-bit | `src/state/compress/pass-4bit.js` | Nibble frequency dictionary | (none) | `pass-4bit.js` |
| M38 | Compress 8-bit | `src/state/compress/pass-8bit.js` | Native CompressionStream deflate | (none) | `pass-8bit.js` |
| M39 | Compress 16-bit | `src/state/compress/pass-16bit.js` | Word frequency dictionary | (none) | `pass-16bit.js` |
| M40 | Compress 32-bit | `src/state/compress/pass-32bit.js` | Dword frequency dictionary | (none) | `pass-32bit.js` |
| M41 | Compress Progressive | `src/state/compress/progressive.js` | Multi-granularity engine | M36–M40 | `progressive.js` |
| M42 | Encrypt | `src/state/encrypt.js` | XOR stream cipher (xorshift128+) | M01 | `encrypt.js` |
| M43 | Save Encode | `src/state/save-encode.js` | Full encode pipeline → base64url string; exports `SAVE_BUDGET` = 1900 (program-wide single source per Custom Rule 6); `EVENT_TRIM_LADDER` [24,16,8,4,2,1,0] (saves-never-fail S01) | M33, M35, M41, M42 | `save-encode.js` |
| M44 | Save Decode | `src/state/save-decode.js` | Reverse pipeline: decode + validate | M43, M35, M41, M42, M33 | `save-decode.js` |
| M45 | Library | `src/state/library.js` | localStorage CRUD for runs/settings/flags | M33, M43 | `library.js` |
| M46 | Party Configs | `src/state/party-configs.js` | localStorage CRUD for saved party blueprints | M06, M09, M07 | `party-configs.js` |
| M47 | Audio Drone | `src/audio/drone.js` | Drone layer → renders conductor `bass[16]` (triangle, single-gain bass bus 0.55·v) + theme-timbre breathing pad (filter LFO 0.07 Hz, gain LFO 0.05 Hz) (upbeat-melodic-score S02; key/slider name unchanged) | M05, M109, M110 | `drone.js` |
| M48 | Audio Pulse | `src/audio/pulse.js` | Pulse layer → danger-tiered chip drum kit, dual kick(0.9)/bright(0.75) paths, unfiltered (600 Hz lowpass deleted), tick-intensity velocity, weak-beat hats halved; heartbeat removed — tier 0 is a light kick+hat groove (upbeat-melodic-score S02) | M109, M110 | `pulse.js` |
| M49 | Audio Sparkle | `src/audio/sparkle.js` | Sparkle layer → always-on evolving two-octave chord arps on the conductor grid (hash-rebuilt direction per bar/chord); container proximity brightens (cutoff 900+pressure·2600, velocity) instead of gating (upbeat-melodic-score S02) | M109, M110 | `sparkle.js` |
| M50 | Audio Lead | `src/audio/lead.js` | Lead layer → phrase melody renderer at ×4 register, duty by intensity/combat (pulse50/25/125), sustain + delayed vibrato on held notes, bus 0.22·v (upbeat-melodic-score S02; composition in M110) | M109, M110 | `lead.js` |
| M51 | Audio Noise Bed | `src/audio/noise-bed.js` | Noise bed: tape hiss demoted to texture — 0.007 base with slow drifting bandpass (0.05 Hz, center 1900 ± 700) (upbeat-melodic-score S02) | (none) | `noise-bed.js` |
| M52 | Audio Engine | `src/audio/engine.js` | AudioContext manager, 5-layer mix bus + conductor/echo lifecycle (dynamic-chiptune S02; public API frozen) | M47–M51, M109, M110 | `engine.js` |
| M53 | Glitch System | `src/glitch/glitch.js` | Timer system, per-element effects dispatcher | M04 | `glitch.js` |
| M54 | Grain | `src/glitch/grain.js` | Canvas dot-scatter grain | (none) | `grain.js` |
| M55 | Transitions | `src/glitch/transitions.js` | Authored set-pieces: boot, descent, death | M53 | `transitions.js` |
| M56 | UI Components | `src/ui/components.js` | Shared UI factory functions (buttons, sliders, bars) | (none) | `components.js` |
| M57 | UI Input | `src/ui/input.js` | Unified keyboard + touch input handler | (none) | `input.js` |
| M58 | Playfield | `src/ui/playfield.js` | Canvas 2D lattice/combat rendering | M30, M31, M04 | `playfield.js` |
| M59 | Status Strip | `src/ui/status-strip.js` | Top-pinned readout (exploration + combat) | M34, M33, M04, M56 | `status-strip.js` |
| M60 | Console Shell | `src/ui/console/console.js` | 7-mode tab bar, expand/collapse, routing | M61–M67, M57, M34 | `console.js` |
| M61 | Console Move | `src/ui/console/move.js` | MOVE mode: D-pad, auto-stop indicators | M56, M34 | `move.js` |
| M62 | Console Combat | `src/ui/console/combat.js` | COMBAT mode: actions, targeting | M56, M34, M24 | `combat.js` |
| M63 | Console Party | `src/ui/console/party.js` | PARTY mode: member list, stats | M56, M34, M15 | `party.js` |
| M64 | Console Gear | `src/ui/console/gear.js` | GEAR mode: equipment management | M56, M34, M25, M18 | `gear.js` |
| M65 | Console Tech | `src/ui/console/tech.js` | TECH mode: protocol deck, CHARGE | M56, M34, M20 | `tech.js` |
| M66 | Console Loot | `src/ui/console/loot.js` | LOOT mode: container contents, take | M56, M34, M25, M22 | `loot.js` |
| M67 | Console Log | `src/ui/console/log.js` | LOG mode: scrolling event log, copy link | M56, M34, M43 | `log.js` |
| M68 | Title Screen | `src/ui/screens/title.js` | Title, START, branch to new run/library/import/tutorial/settings | M45, M52, M53, M56, M57 | `title.js` |
| M69 | Creation Screen | `src/ui/screens/creation.js` | 80-point buy, party building, saved configs | M15, M17, M18, M20, M33, M46, M45, M29, M55, M56, M57 | `creation.js` |
| M70 | Exploration Screen | `src/ui/screens/exploration.js` | Exploration: playfield + console (MOVE) | M59, M58, M60, M30, M31, M32, M33, M34, M45, M52, M57 | `exploration.js` |
| M71 | Combat Screen | `src/ui/screens/combat.js` | Combat: zoomed grid + console (COMBAT) | M59, M58, M60, M24, M23, M19, M33, M34, M45, M57 | `combat.js` |
| M72 | Library Screen | `src/ui/screens/library.js` | Run library listing | M45, M56, M57 | `library.js` |
| M73 | Scorecard Screen | `src/ui/screens/scorecard.js` | Run-end scorecard, share link | M43, M45, M56, M57, M04 | `scorecard.js` |
| M74 | Import Screen | `src/ui/screens/import.js` | Link import + named failure screens | M44, M43, M56, M57 | `import.js` |
| M75 | Tutorial Screen | `src/ui/screens/tutorial.js` | Paginated manual | M56, M57 | `tutorial.js` |
| M76 | Settings Screen | `src/ui/screens/settings.js` | Audio sliders, glitch toggle | M45, M52, M53, M54, M56, M57 | `settings.js` |
| M77 | Base CSS | `styles/base.css` | Palette tokens, typography, spacing | (none) | `base.css` |
| M78 | CRT CSS | `styles/crt.css` | Scanlines, vignette, grille, tracking, grain, glitch | (none) | `crt.css` |
| M79 | Components CSS | `styles/components.css` | Console, status strip, cards, buttons, sliders | (none) | `components.css` |
| M80 | Index HTML | `index.html` | Entry point, portrait frame, font, CSS links | (none) | `index.html` |
| M81 | Service Worker | `service-worker.js` | Cache-first offline strategy | (none) | `service-worker.js` |
| M82 | Main Entry | `src/main.js` | Screen router, bus events, lifecycle wiring | M80, M81, M34, M45, M52, M53, M54, M68–M76 | `main.js` |
| M83 | Package Manifest | `package.json` | npm scripts, dev metadata, zero runtime deps | (none) | `package.json` |
| M84 | Dev Server | `scripts/server.js` | Built-ins-only static file server | (none) | `server.js` |
| M85 | Server Lifecycle | `scripts/start.js`, `scripts/stop.js` | Detached start + PID-tracked stop | M84 | `start.js`, `stop.js` |
| M86 | Hot Runtime | `src/runtime.js` | Post-START activation, services, routing, active run/floor lifecycle | M34, M45, M47–M55, M68–M76, M81, M87 | `runtime.js` |
| M87 | Data Loader | `src/data-loader.js` | Deferred static-data loading, schema/version validation, immutable game-data registry | M04–M13 | `data-loader.js` |
| M88 | Bit Codec | `src/state/bit-codec.js` | Bounds-checked bit writer/reader, varints, signed values, byte alignment | (none) | `bit-codec.js` |
| M89 | Save Schema | `src/state/save-schema.js`, `src/state/save-codecs.js` | Versioned binary RunState serialization and bounded value codecs. `RUN_SCHEMA_VERSION` = 7: inline `CALIBRATION_OPTION_IDS`/`EVENT_TYPE_IDS` enums, compact loot-id codec, combat actor positions packed 3+4 bits (8×16 window), corruption/salvage 1-bit fast paths; caps mirror M25/M33 (saves-never-fail S01) | M13, M33, M35, M88, M25 | `save-schema.js`, `save-codecs.js` |
| M90 | Progression | `src/rules/progression.js` | Calibration offers/application, floor-transition recovery, threshold bookkeeping | M06, M15, M17, M19, M33 | `progression.js` |
| M91 | Encounters | `src/rules/encounters.js` | Standard encounter deployment, hunts, threshold elites, Echo injection | M02, M03, M05, M08, M16, M23, M29 | `encounters.js` |
| M92 | Creation Model | `src/ui/creation-model.js` | Pure 80-point-buy model, validation, blueprint conversion | M06, M07, M09, M15, M17, M18, M20, M46 | `creation-model.js` |
| M93 | Typeface Tooling | `font-src/`, `tools/font/` | Original 72-glyph outline recipes, compiler, metrics, contact sheets | M04, M14 | `font-src/glyphs.json`, `tools/font/build_font.py` |
| M94 | Validation Tooling | `scripts/lint-sigils.js`, `scripts/validate-data.js`, `scripts/verify-assets.js`, `scripts/verify-font.py` | Reserved-bank lint plus data/font/static-manifest/transfer-budget checks | M04, M14, M81, M83 | `lint-sigils.js`, `validate-data.js`, `verify-assets.js`, `verify-font.py` |
| M95 | Browser Acceptance | `tests/e2e/`, `playwright.config.js` | Keyboard/touch flows, URL import, offline behavior, visual/accessibility assertions | M56–M82 | `playwright.config.js`, `tests/e2e/` |
| M96 | Release Simulation | `scripts/simulate-runs.js`, `scripts/stress-generation.js`, `scripts/stress-saves.js`, `scripts/report-budget.js` | Deterministic balance/performance sweeps and final release gate | M16, M22–M29, M43–M55, M83, M94 | `simulate-runs.js`, `stress-generation.js`, `stress-saves.js`, `report-budget.js` |
| M97 | Design Compliance Scanner | `scripts/scan-design-compliance.js`, `scripts/design-scan/` | Extracts design tokens, CRT/glitch timing constants, and screen/component inventory from `specs/design.md`, `specs/requirements.md`, and `mocks/*.html`; checks `src/`/`styles/` for completeness against spec and structural compliance against mocks; renders a pass/fail report | M53, M56, M60–M67, M68–M76, M77–M79 | `scan-design-compliance.js`, `lib.js`, `extract-design-spec.js`, `extract-mocks.js`, `check-tokens.js`, `check-effects.js`, `check-touch-targets.js`, `check-screen-inventory.js`, `check-mock-classes.js`, `check-mock-tokens.js`, `scan.js`, `report.js` |
| M98 | CRT Overlay Renderer | `src/glitch/crt-overlays.js` | DOM injection of 10 CRT layer divs; per-frame glitch scheduler | M34, M53 | `crt-overlays.js` |
| M99 | Screenshot Parity Tool | `scripts/screenshot-parity.js` | Playwright-driven mock↔prod side-by-side capture (both layout classes) | M83, M84, M95 | `screenshot-parity.js` |
| M100 | Layout Controller | `src/ui/layout.js` | `WIDE_MEDIA_QUERY`, `currentLayoutClass()`, `initLayoutController({bus})` → `html[data-layout]` + `ui:layout-change` dispatch | (none — bus injected) | `layout.js` |
| M101 | Wide CSS | `styles/wide.css` | ALL wide-only structural CSS inside a single `@media (min-width: 900px) and (min-aspect-ratio: 1/1)` block; `#portrait-frame:has([data-wide-root])` full-bleed gate | (none) | `wide.css` |
| M102 | Router | `src/router.js` | `#a=` fragment codec (`parseFragment`/`buildFragment`/`canonicalFragmentFor`), DI'd history controller (push/replace + hashchange), legacy `#r=`/`#w=` classification | M43, M44 | `router.js` |
| M103 | Scroll Memory | `src/ui/scroll-memory.js` | Keyed scrollTop store (`surface:pane`), `captureScroll`/`restoreScroll`/`preserveScroll`/`clearScrollMemory`, clamp + 64-entry eviction | (none) | `scroll-memory.js` |
| M104 | Viewport | `src/ui/viewport.js` | Pan/zoom camera math (`createViewportCamera`: fit/clamp/anchor-zoom/world↔screen), unified pointer gesture controller (`attachViewportGestures`: drag-pan, pinch, wheel, tap), DPR canvas sizing (`sizeCanvasToContainer`) | (none) | `viewport.js` |
| M105 | Save Migration | `src/state/save-migrate.js`, `src/state/migrations/` | Ordered `from→to` migration chain (`registerMigration`, `migrateState`); empty chain = identity; fails `no_migration_path` if a hop is missing. Every future `RUN_SCHEMA_VERSION` bump lands a new step here | (none) | `save-migrate.js`, `migrations/v3-to-v4.js`, `migrations/v4-to-v5.js`, `migrations/v6-to-v7.js` (clamping hop, D2 policy — saves-never-fail S01) |
| M106 | Version Readers | `src/state/versions/` | Frozen per-schemaVersion payload readers (`read-v3.js` + `codecs-v3.js` pinned to schema v3 forever; `read-v4.js` + `codecs-v4.js` pinned to schema v4 forever). Never edit a frozen reader; add a new one alongside on every schema bump. `data/symbol-table.v3.json` is the paired frozen symbol-table snapshot; `read-v6.js` + `codecs-v6.js` pinned to schema v6 / table v1 forever, paired with `data/symbol-table.v6.json` and fixtures `tests/fixtures/save-versions/v6-{midrun,combat,maxed}.txt` (saves-never-fail S01) | M35, M88, M33, M13 | `read-v3.js`, `codecs-v3.js`, `read-v4.js`, `codecs-v4.js`, `read-v6.js`, `codecs-v6.js` |
| M107 | Icon System | `assets/icons.svg`, `src/ui/icon.js`, `styles/icons.css`, `tools/icons/` | Static SVG symbol sprite compiled from `tools/icons/subset.json` (lucide devDep); runtime `createIcon(id, opts)` factory | (none) | `icon.js`, `icons.svg`, `icons.css`, `build-sprite.mjs` |
| M108 | Tailwind Pipeline | `styles/tailwind.css`, `tools/tailwind/` | Dev-time-compiled utility CSS (tailwindcss devDep, Preflight disabled), committed to repo, cached by service worker | (none) | `tailwind.config.mjs`, `build-css.mjs`, `input.css`, `tailwind.css` |
| M109 | Chip Voices | `src/audio/chip.js` | NES-constraint voice kit: duty-cycle PeriodicWaves (12.5/25/50%), triangle, 15-bit LFSR noise buffers, note/kick/snare/hat players, feedback-echo send (landed 2026-08-19 — dynamic-chiptune S01; playNote sustain envelope + vibrato.delay added 2026-08-20 — upbeat-melodic-score S02) | (none) | `chip.js` |
| M110 | Conductor | `src/audio/conductor.js` | Single lookahead musical clock (25ms/120ms), SCALES+ROOTS per audioMode, functional-degree progression walk (no pattern pools), seeded motif engine + AABA phrase renderer, rule-built bass/drums, game-state director (updateState merges; combat\|combatActive\|combatState accepted; intensity floor 0.35, sparkle floor 0.25, tempo 112–180), bar-quantized changes, per-floor motif no-repeat ledger cap 16; `bass[16]` added to tick payload; `melodyBar` kept as back-compat shim (landed 2026-08-20 — upbeat-melodic-score S01) | M02 | `conductor.js` |
| M111 | Manual Content | `data/manual.json` | 62 manual sections (interface/systems/glossary), loaded via M87 (landed 2026-08-18 — the-manual S01; that feature's STATE refers to this as "M107" locally) | (none) | `manual.json` |
| M112 | Manual Modal | `src/ui/manual/` | Blocking manual overlay controller + section renderer, `inert`-based focus containment (landed 2026-08-19 — the-manual S03; local alias "M108") | M56, M34, M111 | `manual-modal.js`, `manual-view.js` |
| M113 | Manual CSS | `styles/manual.css` | Manual modal/backdrop/TOC styling, z-index 50 under CRT layers (landed 2026-08-19 — the-manual S03; local alias "M109") | (none) | `manual.css` |
| M114 | Audition Harness | `scripts/audition/` | Dev-only listening rig for the audio engine — served at `http://127.0.0.1:8080/scripts/audition/`; drives `updateState`/`setLayerVolume`/`setMasterVolume`/`setMute` from a dark HTML/JS UI, polls `getGraphState()` at 250ms into a telemetry pane; five scenario presets (Calm Explore / Loot Near / Hunted / Deep Floor / Combat). Never shipped: not linked from `index.html`, not in `service-worker.js` `ASSETS`, no imports from `src/` reach it (Custom Rules 1 & 12). (landed 2026-08-20 — upbeat-melodic-score S03) | M52, M110 (`SCALES` only) | `scripts/audition/index.html`, `scripts/audition/audition.js` |
| M115 | High Scores Store | `src/state/high-scores.js` | Bounded top-`HIGH_SCORE_CAP` (50) persisted ledger of runs that ended in party wipe, ranked by depth reached (arcade high-score semantics — lowest evicted when a new entry doesn't make the cut). Independent of `od_runs`/M45's run index and its eviction/sweep; written once per death via `recordHighScore(runState, extra)`, read via `listHighScores()`. (planned — high-score-archive S01) | (none) | `high-scores.js` |
| M116 | High Scores Screen | `src/ui/screens/highscores.js` | Depth-ranked list of every dead run (seed, theme, party, cause of death, date); per-row "Restart Same Seed" → Character Creation with the world seed pre-loaded, identical contract to M73's restart action. (planned — high-score-archive S03) | M115, M56, M100, M103, M34 | `highscores.js` |
| M117 | Predeploy Gate | `.githooks/pre-push`, `.github/workflows/deploy-pages.yml` | Local + CI deploy-blocking verification gate — single source of truth (`npm run predeploy`) for everything the GitHub Pages `build` job checks before deploy; auto-installed as a `pre-push` git hook via `package.json`'s `prepare` script so a failing push is caught on the developer's machine, not discovered in Actions after the fact. (landed 2026-08-24 — predeploy-verification-gate S01, prompted by an M115 `PRODUCTION_ASSETS` manifest omission that reached `origin/main` unguarded) | M83, M94 | `pre-push`, `deploy-pages.yml`, `github-pages-workflow.test.js` |

## Conventions

### Naming
- **Files:** kebab-case (`rng-cursor.js`, `run-state.js`, `pass-1bit.js`)
- **Functions:** camelCase (`createPRNG`, `generateLoot`, `moveParty`)
- **Constants:** UPPER_SNAKE (`INVENTORY_CAP`, `CACHE_VERSION`)
- **Types/Interfaces:** PascalCase (`RunState`, `CombatState`, `Lattice`)
- **CSS classes:** kebab-case (`.combat-grid`, `.mode-tab`, `.status-strip`)
- **CSS custom properties:** kebab-case (`--accent`, `--bg-base`, `--text-primary`)
- **Bus events:** `namespace:event` (`state:floor-change`, `ui:mode-change`)
- **Module IDs:** M01–M116, stable, never reused

### Error Handling
- Pure modules (core, rules, floor, exploration) return typed results, never throw
- UI modules catch errors and log to console, never crash the app
- Save decode returns named error types: `truncated`, `version_mismatch`, `checksum_failed`, `malformed`
- localStorage reads are defensive — missing keys return defaults
- All external data (localStorage, URL fragments) is untrusted and validated on load

### Logging
- Console errors/warnings for development diagnostics
- No production logging framework — the game is static files
- Glitch system logs nothing (silent operation)

### Documentation
- No inline code comments unless explicitly requested
- Module contracts are in `specs/architecture.md`
- Data schemas are in `specs/database.md`
- Design tokens are in `specs/design.md`

### Code Style
- Native ES modules with `import`/`export`
- No build step, no transpiler, no bundler
- No third-party runtime dependencies
- `const`/`let` only, no `var`
- Arrow functions for callbacks
- Factory functions (`createXxx`) over classes for most modules
- Explicit exports, no wildcard imports

## Verification Commands

| Check | Command |
|-------|---------|
| **Unit Tests** | `npx vitest run` (dev-only; tests in `./tests/`) |
| **Syntax Check** | `node --check <file>` (per file, if Node available) |
| **Browser Load** | Run `npm start` (or `npm run serve`), open the printed `http://127.0.0.1:8080/` — no console errors except missing-module warnings |
| **JSON Validity** | `node -e "JSON.parse(require('fs').readFileSync('data/xxx.json'))"` per data file |
| **Data Contracts** | `npm test -- ./tests/data/contracts.test.js` |
| **Sigil Font** | `python3 ./tools/font/build_font.py --check && python3 ./scripts/verify-font.py && node ./scripts/lint-sigils.js` (after M93/M94 sessions) |
| **Browser E2E** | `npm run test:e2e` (after M95 is installed) |
| **Release Gate** | `npm run check:release` (after M96 is implemented) |
| **Design Compliance Scan** | `npm run design:scan` (after M97 is implemented; add `-- --json` for machine-readable output) |
| **Screenshot Parity** | `npm run parity:shots -- --screen <name>` or `--all` (after M99 lands) |
| **Build assets** | `npm run build:assets` (regenerates `styles/tailwind.css` + `assets/icons.svg` from source; commit both) |
| **Predeploy Gate** | `npm run predeploy` (composes `check:generated && check:assets && test:pages-contract && build:pages`; mandatory before every push per Custom Rule 15 — auto-enforced via the `prepare`-installed `.githooks/pre-push` hook; bypass only via `git push --no-verify`) |

**Note:** There is no build step and no type checker configured. Verification is: Vitest tests (dev-only), manual browser load over `http://` (`file://` cannot load ES modules, `fetch` data, or register the service worker), and JSON.parse checks. No `npm run lint` or `npm run typecheck` exists. `./package.json` is dev-tooling only — zero runtime `dependencies`, not shipped, not in the service worker `ASSETS` manifest — and `npx vitest run` now resolves via its `vitest` devDependency.

## Git Config

| Field | Value                                  |
|-------|----------------------------------------|
| **Commit Format** | `SESSION-NN: <brief description>`      |
| **Branch** | `main` (or feature branch per session) |
| **.gitignore** | `/.idea/`, `/.zencoder/`, `/program/`  |

## Session Defaults

| Field | Value |
|-------|-------|
| **Effort Cap** | ≤30 minutes per session |
| **Line Cap** | ≤200 lines of instructions per session |
| **State** | Valid (compiling/parseable) after every session |
| **Commit** | After each session passes verification |
| **Parallel Sessions** | Allowed when touching different subsystems (see dependency graph) |

## Custom Rules

1. **No build step** — all files served as-is. No bundler, no transpiler, no npm at runtime.
2. **No third-party runtime dependencies [AMENDED 2026-08-19 via combat-and-overworld-clarity-pass SESSION-01]** — zero runtime npm packages. Vitest and Playwright remain dev-only. **Dev-time asset generation via npm devDependencies IS permitted** (currently `tailwindcss`, `lucide`) provided (a) the generated artifacts are committed to the repo as static files under `styles/` or `assets/`, (b) no npm module is imported by anything under `src/` or `service-worker.js`, and (c) the generated artifacts are listed in `PRODUCTION_ASSETS` so first-load offline works — with the caveat that new asset types outside `data/*.json`, `styles/*.css`, and `src/**/*.js` also require `scripts/report-budget.js` `REQUIRED_SINGLETONS` to be extended so the release-budget validator remains coherent. `styles/tailwind.css` and `styles/icons.css` are cached today; `assets/icons.svg` is served from network on first load only and will join `PRODUCTION_ASSETS` when the validator is extended (follow-up).
3. **Tailwind is dev-time-compiled only [AMENDED 2026-08-19 via combat-and-overworld-clarity-pass SESSION-01]** — mocks may use the Tailwind CDN as before. Production ships `styles/tailwind.css` compiled once at dev time by `npm run build:css` (Preflight disabled so `styles/base.css` palette tokens win). Any `@apply` chains or new utilities require re-running the build and committing the updated `styles/tailwind.css`. No runtime Tailwind loader, JIT script, or `<script src="…tailwind…">` may appear in `index.html`.
4. **Sigil bank reservation** — PUA codepoints from `data/sigils.json` never render outside creature contexts.
5. **Glitch is constant** — no game-state-driven glitch intensity. Per-element intensity constants are authoring-time decisions.
6. **Save budget [AMENDED 2026-08-24 via saves-never-fail SESSION-01]** — encoded run state must be < **1900** characters (raised from 1500 by owner directive 2026-08-24 — saves are URL fragments that never traverse a server; total URL ≈ 1,950 stays under the ~2,048 universal interop floor). The budget is the sole save budget for every transport (localStorage and URL), exported as `SAVE_BUDGET` from `src/state/save-encode.js` — the import screen, LOG copy label, and release gate import it; no re-literaled budget numbers. Gameplay caps (M25 `INVENTORY_CAP` = 40; M33/M89 events 24 / corrupt ledger 32 / combat 8192 B) are sized by the budget model (`tests/state/save-budget-model.test.js`). Measured apex at landing: 1763 explore / 1794 combat — the D1 ≤1710 (10%-margin) target is **not yet met**, so the model hard-asserts `< SAVE_BUDGET` and logs the margin miss; the event trim ladder stays emergency slack (D3). Any new persisted field, cap increase, or budget change must re-run the model. [SUPERSEDED same day — SESSION-03 (blocked) measured the REACHABLE apex-omega (equipped `createLegalParty` operators, caps filled, 24-actor combat, depth 255) at 2670 chars with the event ladder empty / 3990 at full events: the budget model's stripped-party baseline (no equipment/protocols/conditions — unreachable in play) under-measured by ~1000+. The covenant is NOT currently provable at the landed caps; the M96 release gate is unrebuilt. Open Forge decision — fix the model baseline first, then respec caps / wire compaction / budget. See saves-never-fail STATE.md Handoff Notes SESSION-03.]
7. **Offline-first** — service worker caches all assets; game works without network after first load.
8. **Adaptive layouts [AMENDED 2026-08-14 ×2 via adaptive-layouts; AMENDED 2026-08-15 via adaptive-layouts-impl — "design phase only" status clause and warning-level scan-policy sentence dropped]** — by explicit owner direction, the UI targets **two layout classes**, each optimal at its resolution and fluid within its class: **`portrait`** (default — current single-column design, full-bleed on phones) and **`wide`** (`min-width: 900px` AND `min-aspect-ratio: 1/1` — three-region layout: telemetry dock | vertical playfield column | console dock, always-expanded console, full-viewport CRT effects, no letterboxing). The descent premise stays vertical in every class: the playfield column remains portrait-proportioned. Design source of truth: `specs/design.md` "Adaptive Layout System" + `mocks/*.html` (portrait) + `mocks/wide/*.html` (wide). **Status: implemented** (`adaptive-layouts-impl`, 2026-08-15) — production renders both classes (M100 layout controller + M101 wide.css; live class switch re-mounts the active route on `ui:layout-change`); wide-mock↔prod compliance findings are **error-level** (sole exception: mock-generated `deploy-p`/`deploy-e` markers stay warning-level in both layouts — production draws deployment zones on canvas). **[AMENDED 2026-08-17 via map-pan-zoom]** — by owner directive the map docks and fills the entire middle: the wide middle track absorbs all surplus width (`minmax(320px, 1fr)` in every pane state; the console dock reverts to its fixed user-chosen width `max(360px, --wide-right-w)`), `.wide-playfield-inner` is no longer 9:16-capped, and in both layout classes the canvas fills its playfield container. The descent premise stays vertical in the **content** — the 20×32 portrait world seen through the M104 viewport camera (pan/zoom) — not in column geometry. The "playfield column remains portrait-proportioned" clause is dropped; `specs/design.md` "Adaptive Layout System" is the updated source of truth.
9. **Original typeface is in scope** — replace the 8-byte placeholder with the project-owned 72-glyph `DESCENT SIGIL`; no borrowed outlines or third-party font assets.
10. **~~Strict START gate~~ [DROPPED 2026-08-12 via visual-parity-v2 SESSION-03]** — Previously forbade loading effects/audio/glitch/RNG before START; enforced a two-state title architecture that diverged from the mock. Cold shell now boots the full runtime: data, service worker, audio (silent until first user gesture per WebAudio autoplay policy), glitch/grain/transitions, and CRT overlays all load eagerly. The title screen is a single state; START toggles the branch list per `./mocks/title.html`. Anyone re-introducing a deferred-boot gate must update this rule and coordinate with M68/M82/M86.
11. **Acceptance beats the MVP baseline** — existing green tests document the current implementation but do not waive any requirement; strengthen tests rather than preserving known bug-tolerant expectations.
12. **Dev tooling never ships** — Vitest, Playwright, FontTools, generators, and release scripts are excluded from the service-worker manifest and first-load transfer calculation.
13. **Versioned saves never dead-end** — Every `RUN_SCHEMA_VERSION` or symbol-table bump MUST (a) freeze the prior payload reader under `src/state/versions/` and never edit it after landing, (b) retain a real encoded fixture in `tests/fixtures/save-versions/` that the corpus test decodes on every run, (c) register the historical symbol table via `registerCondenserTable` so the frozen reader still resolves its symbols, and (d) keep the seed-recovery floor intact — the frame's worldSeed offset (bytes 5–8 in the v2 frame) is frozen. Any well-formed save of any shipped version must always load: full restore through the frozen reader + migration chain, or seed recovery to a fresh run in the same world. Only genuine corruption (`checksum_failed` / `truncated` / `malformed`) fails.
14. **Red is reserved for hostiles [ADDED 2026-08-21 via playtest-ux-hotfix-batch]** — by owner direction, enemy-red (`--danger` `#e83a3a` and its `--sigil-enemy`/`--sigil-echo` aliases; the canvas `HOSTILE_COLOR` in `src/ui/playfield.js`) signals **enemies/echoes only**. Player-facing status "levels" (HP bars, and any future player gauge) must use a dedicated non-red token — currently `--hp` (introduced for the HP bar; the low-HP critical state uses `--warning`, not red). Semantic error/validation states (`.error`, `aria-invalid`, `.load-error`, decode-failure text) may keep red as a deliberate exception; nothing else in a player context renders in enemy-red. New "level"/gauge UI must pick a non-red fill.
15. **Predeploy gate is mandatory before every push [ADDED 2026-08-24 via predeploy-verification-gate SESSION-01]** — `npm run predeploy` (`check:generated && check:assets && test:pages-contract && build:pages`) is the single source of truth for what must pass before a deploy; both `./.github/workflows/deploy-pages.yml`'s `build` job and the auto-installed `./.githooks/pre-push` hook (wired via `package.json`'s `prepare` script) read from it, so local and CI can never silently disagree about what's required. Bypass only for a genuine emergency via `git push --no-verify`. Binding on every session touching `src/`, `styles/`, `data/`, or `service-worker.js`, via MU.md's existing checkpoint protocol (run all FORGE-CONFIG verification commands).
