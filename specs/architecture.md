# Architecture — Operator's Descent

## Stack Decision

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | JavaScript (ES2022+, vanilla) | No build step, no transpiler, no runtime dependencies — hard constraint. Native ES modules served directly. |
| Framework | None (vanilla JS) | The 500 KB budget, no-dependency constraint, and no-build-step rule eliminate all framework options. The app is small enough to manage with custom module boundaries. |
| UI Rendering | Canvas 2D (playfield, grain) + DOM/CSS (console, screens, CRT effects) | Canvas for the lattice/grain where per-pixel control is needed; DOM for structured UI where layout, accessibility, and text rendering are better served by the platform. Hybrid is the simplest approach that meets both rendering and accessibility needs. |
| State Management | Custom event-bus + immutable run-state snapshot pattern | No Redux/Zustand dependency. A lightweight event bus (`src/state/bus.js`) dispatches state transitions; modules subscribe. Run state is a single serializable object that snapshots on autosave and encodes to URL. |
| Database | `localStorage` (run library, settings) + URL fragment (portable saves) | No backend, no IndexedDB needed. localStorage is synchronous and sufficient for the data volume (multiple runs, each a few KB at most). URL fragment is the portable save channel. |
| ORM / Data Layer | Direct `JSON.parse` of static data files | Data files are static JSON loaded via `fetch()` on first load, cached by the service worker. No query layer needed — they're lookup tables, not databases. |
| Build Tool | None | Hard constraint. Shipped artifact is static files. No bundler, no transpiler, no npm at runtime. |
| Test Framework | Vitest (dev-only, not shipped) | Vitest runs on Node, supports ES modules natively, and produces no runtime artifact. Tests live in `tests/` and never touch the shipped bundle. The dev toolchain does not contradict the no-build-step constraint because it produces nothing that ships. |
| Deployment Target | Static file hosting (any origin-serving host: S3, GitHub Pages, Netlify, nginx) | The entire game is static files. No server-side processing. The service worker handles caching. |

## Alternatives Considered

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Framework | None (vanilla JS) | React, Svelte, Lit, Preact | Any framework adds KB to the 500 KB budget, requires a build step (or ships a large runtime), and introduces a dependency. The UI is a fixed-layout portrait app with a single console — not a complex component tree. Vanilla JS with clear module boundaries is simpler and smaller. |
| Rendering | Hybrid (Canvas 2D + DOM/CSS) | Full Canvas, Full DOM/SVG | Full Canvas requires re-implementing text layout, accessibility, and input handling — too costly for the console UI. Full DOM can't efficiently render the 20×32 lattice with fog-of-war per-cell or the 8×16 combat grid with targeting overlays. Hybrid uses each where it's strongest. |
| State Management | Custom event bus + snapshot | Redux, Zustand, MobX | A roguelike with a single active run and deterministic state doesn't need time-travel debugging or middleware chains. The event bus is ~50 lines. Run state is one object that snapshots on transitions. |
| PRNG | xorshift128+ (custom implementation) | Math.random, Mersenne Twister, PCG | xorshift128+ is fast (~10ns/call), has a 128-bit state (4 × uint32), seeds deterministically from a single uint32 world seed, and the full state serializes compactly into the URL save. Mersenne Twister's 2.5 KB state is too large for the 1500-char URL budget. |
| Save Encoding | Field-level exhaustive lookup tables + FNV-1a hash lookup + progressive granularity compressor (1-bit → 4-bit → 8-bit → 16-bit → 32-bit passes) + XOR encryption + base64url. Save state stores only the diff (fog bitmap, opened containers, defeated enemies, party position) + persistent state (party, inventory, corruption, echoes, PRNG) — floor geometry is regenerated from seed + depth on load. | JSON.stringify + base64, Protobuf, MessagePack, single-pass DEFLATE, condensation-only, small fixed dictionary, storing full floor geometry | JSON is too verbose for 1500 chars. Storing full floor geometry wastes hundreds of bytes on data that's deterministic from seed + depth (owner insight: descent is one-way, floors regenerate from hash). Pre-built field-level symbol tables (`data/symbol-table.json`, ~8 KB, ~500 entries, ships with game) provide near-exhaustive coverage of individual state fields — class (100%), sigil (100%), attributes (95%), HP/CHARGE (95%), conditions (90%), item IDs (100%), equipment configs (100%). FNV-1a hash (10 lines, zero deps) provides O(1) lookup per field. Common field values map to short table indices (3–8 bits each); rare values use escape codes + raw bit-packing (lossless). ~90–95% of field values hit the table in typical play. Then a progressive granularity compressor applies lossless compression at increasing word sizes — each pass catches patterns the previous granularity can't see, checks the budget after each, and stops when it fits. An XOR stream cipher (xorshift128+ keystream) obfuscates the payload before base64url encoding. The entire portable state — including fog-of-war bitmap, full inventory, equipment, Echo queue, and dual PRNG states — fits in ~324 base64url characters at worst case (4.6× headroom). Protobuf/MessagePack require build tools or runtime libraries. Single-pass DEFLATE misses bit-level and nibble-level patterns that the finer-granularity passes exploit first. Condensation-only (without progressive compression) can't guarantee the budget for deep, complex saves. A small fixed dictionary (whole-state patterns, ~64 entries) was rejected in favor of field-level tables because the whole-state space (2^77 per character) is too large for exhaustive coverage, while individual fields have small, enumerable value spaces. |
| Audio | WebAudio API (synthesized) | Howler.js, Tone.js, audio files | Zero audio files and zero third-party libraries are hard constraints. The five-layer synth is custom DSP — no library fits the budget and the API surface is small enough to hand-build. |
| Service Worker | Custom (hand-written) | Workbox | Workbox adds ~30 KB+ to the cache and introduces a build dependency. A hand-written service worker is ~100 lines and does exactly one thing: cache-first for the known asset list. |
| Test Framework | Vitest | Jest, Mocha, Playwright | Vitest supports ES modules natively without transpilation. Jest requires CommonJS or a build step. Playwright is too heavy for unit testing. Tests are dev-only and never shipped. |

## Module Structure

```
src/
├── main.js                    — Entry point: bootstraps app, registers service worker, routes to title screen
├── data/                       — Static JSON data files (single source of truth for game content)
│   ├── sigils.json             — PUA codepoint ranges, safe substitution pool, sigil metadata
│   ├── themes.json             — 12 environment themes (accent, weights, audio mode, loot bias)
│   ├── classes.json            — 6 class definitions (hit die, charge base, gates, signatures)
│   ├── protocols.json          — 20 protocol definitions (4 schools × 5 tiers, costs, effects)
│   ├── enemies.json            — 8 archetype stat blocks and AI behavior profiles
│   ├── equipment.json          — Weapon/armor categories, costs, range bands, class gates
│   ├── affixes.json            — 16 affix definitions (universal, weapon-only, armor-only)
│   ├── conditions.json         — 9 condition definitions (effect, duration, save)
│   ├── consumables.json        — 7 consumable type definitions
│   └── symbol-table.json       — Pre-built field-level lookup tables (~8 KB, ~500 entries) + FNV-1a hash indexes for O(1) lookup; ships with game
├── core/                       — Pure logic, no I/O, no DOM
│   ├── prng.js                 — xorshift128+ deterministic PRNG, seed/cursor management
│   ├── hash.js                 — Stable hashing for (worldSeed, floorN, ...) → sub-seeds
│   └── rng-cursor.js           — Tracks PRNG position in save state; save/restore roll sequences
├── floor/                      — Procedural floor generation + validation
│   ├── generator.js            — Orchestrates archetype → modifier → theme → validation loop
│   ├── archetypes.js           — 8 generation algorithms (chambers, caves, mazes, etc.)
│   ├── modifiers.js            — Modifier pool application
│   └── validator.js            — 6 validation checks (connectivity, loops, cover, descent, container, open-cell)
├── rules/                      — Game rules engine (pure, no I/O)
│   ├── attributes.js           — 6 attributes, modifiers, derived stat formulas
│   ├── classes.js              — Class signature logic, gating, calibration options
│   ├── combat.js               — d20 resolution, attack/damage/save rolls, AP economy, initiative
│   ├── conditions.js           — 9 conditions: application, duration, resolution, stacking
│   ├── protocols.js            — 20 protocols: casting, overclock, CHARGE economy, effect resolution
│   ├── loot.js                 — Rarity rolls, affix selection, CORRUPT handling, item generation
│   ├── enemies.js              — Archetype stat blocks, depth scaling, AI decision logic, Echo
│   ├── equipment.js            — Weapon/armor stats, range bands, cover, FIN penalty
│   ├── consumables.js          — Consumable effects, stacking, usage rules
│   ├── inventory.js            — 100-item cap enforcement, junk tagging, salvage value, scrap counter
│   └── scaling.js               — Depth scaling formulas (enemy stats, count, loot, danger clock)
├── state/                      — Run state management
│   ├── bus.js                  — Lightweight event bus (subscribe/dispatch)
│   ├── run-state.js            — Run state object: party, depth, corruption, echoes, RNG cursor, flags
│   ├── save-encode.js          — Orchestrator: lookup-condense → progressive compress → encrypt → base64url
│   ├── save-decode.js          — Reverse: base64url → decrypt → progressive decompress → lookup-expand → deserialize
│   ├── condense.js             — Lookup table condensation: maps common state patterns to short codes
│   ├── compress/
│   │   ├── progressive.js      — Recursive multi-granularity engine (tries passes, checks budget, records layers)
│   │   ├── pass-1bit.js        — Bit-level RLE + pattern dictionary
│   │   ├── pass-4bit.js        — Nibble dictionary (4-bit word patterns)
│   │   ├── pass-8bit.js        — Byte-level compression (native CompressionStream('deflate'))
│   │   ├── pass-16bit.js       — Word dictionary (16-bit patterns, e.g. similar character blocks)
│   │   └── pass-32bit.js       — Dword dictionary (32-bit structural patterns)
│   ├── encrypt.js              — XOR stream cipher using xorshift128+ keystream
│   ├── party-configs.js         — localStorage CRUD for saved party configurations (meta-game, not run state)
│   └── library.js              — localStorage CRUD for run library + settings persistence
├── exploration/                — Floor exploration logic
│   ├── lattice.js              — 20×32 grid model, cell types, party token position
│   ├── shadowcast.js           — Shadowcast LOS algorithm, 3-state fog of war
│   └── movement.js             — 8-way movement, corner rule, auto-stop interrupts, danger clock
├── ui/                         — All UI rendering and input handling
│   ├── screens/                — Full-screen views
│   │   ├── title.js            — Title screen, START, branch to new run/library/import/tutorial/settings
│   │   ├── creation.js         — 80-point buy: characters, classes, sigils, attributes, equipment, protocols, saved config load/save
│   │   ├── exploration.js      — Exploration screen: playfield + status strip + console (MOVE mode)
│   │   ├── combat.js           — Combat screen: 8×16 zoomed grid + initiative rail + console (COMBAT mode)
│   │   ├── library.js          — Run library listing
│   │   ├── scorecard.js        — Run-end scorecard with share link
│   │   ├── import.js           — Link import + named failure screens
│   │   ├── tutorial.js         — Paginated manual
│   │   └── settings.js          — Audio sliders, glitch toggle, reduced-motion, scanline toggle
│   ├── console/                — The single console (7 modes)
│   │   ├── console.js          — Console shell: tab bar, expand/collapse, mode switching, input routing
│   │   ├── move.js             — MOVE mode: directional pad, auto-stop indicators
│   │   ├── combat.js           — COMBAT mode: action list, target selection, range/cover display
│   │   ├── party.js            — PARTY mode: member list, stat detail, conditions, AP
│   │   ├── gear.js             — GEAR mode: equipment management, equip/unequip, CORRUPT warnings, junk tag toggle, scrap counter display
│   │   ├── tech.js             — TECH mode: protocol deck, CHARGE display, cast/overclock
│   ├── loot.js             — LOOT mode: container contents, item details, take items, junk tag toggle, "Junk All Tagged"
│   │   └── log.js              — LOG mode: scrolling event log, copy-link action
│   ├── status-strip.js         — Top-pinned readout: depth, seed, party HP sigils, danger clock
│   ├── playfield.js            — Canvas 2D lattice rendering (exploration + combat zoom)
│   ├── components.js           — Shared UI: buttons, sliders, toggles, sigil tokens, HP/CHARGE bars
│   └── input.js                — Unified keyboard + touch input handler with parity guarantee
├── audio/                      — WebAudio 5-layer synthesis
│   ├── engine.js               — AudioContext manager, layer mix bus, master/per-layer volume
│   ├── drone.js                — Drone layer: theme timbre/modal set, depth detune
│   ├── pulse.js                — Pulse layer: hostile proximity → tempo/density/dissonance
│   ├── sparkle.js              — Sparkle layer: container proximity → arpeggio density/cutoff
│   ├── lead.js                 — Lead layer: bar-by-bar melody from hash, no-repeat ledger
│   └── noise-bed.js            — Noise bed: fixed tape hiss/wow/flutter
├── glitch/                     — CRT/VHS visual degradation system
│   ├── glitch.js               — Timer system, per-element intensity constants, effect dispatcher
│   ├── grain.js                — Canvas dot-scatter grain (10px grid, 15% fill, 2×2px dots, 1s re-scatter)
│   └── transitions.js          — Authored set-pieces: boot, floor descent, death animations
├── styles/                     — CSS (no preprocessor)
│   ├── base.css                — Palette tokens, typography, spacing, layout shell, portrait letterboxing
│   ├── crt.css                 — Scanlines, vignette, aperture grille, tracking band, border flicker
│   └── components.css          — Console, status strip, buttons, sliders, sigil tokens, cards
├── assets/                     — Static assets (the only authored asset)
│   └── descent-sigil.woff2     — 72-glyph sigil typeface (4–8 KB)
└── service-worker.js          — Cache-first strategy, offline-first, < 500 KB total
```

## Module Contracts

### `core/prng.js`
- **Owns:** Deterministic pseudo-random number generation. The xorshift128+ algorithm, seed initialization from a uint32 world seed (or derived sub-seed), and sequential draw calls. Two instances are created per run: one for floor generation (`seed = hash(worldSeed, "gen")`) and one for combat/events (`seed = hash(worldSeed, "combat")`). See Open Question #6 (resolved).
- **Exports:**
  - `createPRNG(seed: number) → PRNG` — Returns a PRNG instance seeded from the given uint32.
  - `PRNG.next() → number` — Returns next float in [0, 1). Advances internal state.
  - `PRNG.nextInt(max: number) → number` — Returns int in [0, max).
  - `PRNG.getState() → {a, b, c, d}` — Returns 128-bit state as 4 uint32s for serialization.
  - `PRNG.setState(state) → void` — Restores PRNG from saved state (for save-link resume).
  - `PRNG.hash(...args) → number` — Stable hash of arguments to a uint32, for deriving sub-seeds without advancing the main sequence.
- **Depends on:** None.
- **Key types:** `PRNG` interface, `PRNGState = {a: uint32, b: uint32, c: uint32, d: uint32}`.

### `core/hash.js`
- **Owns:** Stable, deterministic hashing for deriving sub-seeds from composite keys (worldSeed + floorN + containerId, etc.).
- **Exports:** `hash(...values: number[]) → number` — FNV-1a-based hash producing a uint32.
- **Depends on:** None.

### `core/rng-cursor.js`
- **Owns:** Tracking the PRNG's position in the roll sequence for both independent streams (generation and combat) so that save/resume produces identical rolls. Wraps two PRNG instances and records a monotonic cursor counter for each.
- **Exports:**
  - `createRNGCursor(genPRNG, combatPRNG) → RNGCursor`
  - `createRNGCursorForRun(worldSeed, rngState = null) → RNGCursor` — Creates the independent generation and combat streams and restores optional saved cursor/PRNG state.
  - `RNGCursor.next(stream: 'gen' | 'combat') → number` — Draws from the specified stream's PRNG, increments that stream's cursor.
  - `RNGCursor.nextInt(stream, max) → number`
  - `RNGCursor.getCursor(stream) → number` — Returns current cursor position for the specified stream.
  - `RNGCursor.syncTo(stream, cursor, prngState) → void` — Fast-forwards or restores the specified stream's PRNG to a saved position.
  - `RNGCursor.getState() → { gen: {cursor, prngState}, combat: {cursor, prngState} }` — Returns full state for save serialization.
- **Depends on:** `core/prng.js`.
- **Usage:** Resume and combat paths use `createRNGCursorForRun` as the authoritative construction path for a run's deterministic streams.

### `floor/generator.js`
- **Owns:** Orchestrating floor generation: derive sub-seed from `(worldSeed, floorN)`, select archetype/modifiers/theme via weighted draws, generate grid, validate, regenerate with incremented sub-seed on failure.
- **Exports:**
  - `generateFloor(worldSeed, floorNumber, rngCursor, themesData) → Floor`
  - `Floor` contains: `cells` (20×32 grid of CellType), `descentPoint`, `containers[]`, `enemySpawns[]`, `themeId`, `archetypeId`, `modifiers[]`.
- **Depends on:** `core/prng.js`, `core/rng-cursor.js`, `core/hash.js`, `floor/archetypes.js`, `floor/modifiers.js`, `floor/validator.js`, `data/themes.json`.

### `floor/validator.js`
- **Owns:** Six validation checks. Returns pass/fail + reason for each.
- **Exports:** `validateFloor(floor) → { valid: boolean, failures: string[] }`.
- **Depends on:** `floor/generator.js` (type only — receives Floor object).

### `rules/combat.js`
- **Owns:** The d20 combat engine. Initiative rolling, turn order, AP economy, move actions, attack rolls (melee/ranged/protocol), damage calculation, cover determination, flanking, opportunity attacks, natural 1/20 handling, retreat, victory/wipe detection.
- **Exports:**
  - `initiateCombat(party, enemies, rngCursor) → CombatState`
  - `executeAction(combatState, action, rngCursor, context) → ActionResult` — Resolves the explicit action selected by the active actor; it never invents a player action.
  - `resolveTurn(combatState, rngCursor, context) → TurnResult` — Prepares a turn, resolves enemy AI, and advances after a party actor has spent its AP; a party turn with remaining AP stays active until another explicit `executeAction` call.
  - `checkCombatEnd(combatState) → 'ongoing' | 'victory' | 'wipe'`
- **Depends on:** `core/prng.js`, `core/rng-cursor.js`, `rules/attributes.js`, `rules/conditions.js`, `rules/equipment.js`, `rules/enemies.js`.
- **Key types:** `CombatState`, `Action`, `ActionResult` (includes log entries for LOG mode).

### `rules/attributes.js`
- **Owns:** The six core attributes, modifier calculation (`N - 5`), and all derived stat formulas (HP, CHARGE, Defense, Protocol Defense, initiative, accuracy, detection radius, overclock threshold).
- **Exports:**
  - `modifier(rank) → number` — Returns `rank - 5`.
  - `deriveStats(character, classData) → DerivedStats` — Computes HP, CHARGE, Defense, etc.
  - `attributeCost(currentRank, targetRank) → number` — Point-buy cost for attribute rank-up.
- **Depends on:** `data/classes.json`.

### `rules/enemies.js`
- **Owns:** Enemy stat blocks, depth scaling, AI decision logic (priority rules, retreat, protection), Echo construction.
- **Exports:**
  - `createEnemy(archetypeId, depth, rngCursor) → Enemy`
  - `scaleEnemyStat(baseStat, depth) → number` — Applies `1 + depth × (0.15 + 0.10 × floor(depth/10))`.
  - `enemyAI(enemy, combatState, rngCursor) → Action` — Deterministic AI decision.
  - `createEcho(deadCharacter, echoDepth) → Enemy` — Builds Echo enemy from dead character state.
- **Depends on:** `core/prng.js`, `data/enemies.json`, `rules/scaling.js`, `rules/attributes.js`.

### `rules/loot.js`
- **Owns:** Deterministic loot generation from `hash(worldSeed, depth, floorId, containerId)`. Rarity roll, affix selection, CORRUPT item handling.
- **Exports:**
  - `generateLoot(worldSeed, depth, floorId, containerId, themeLootBias) → Item[]`
  - `Item` contains: `id`, `category` (weapon/armor/consumable), `baseType`, `rarity`, `affixes[]`, `stats`, `corrupt` (boolean).
- **Depends on:** `core/hash.js`, `core/prng.js`, `data/affixes.json`, `data/equipment.json`, `data/consumables.json`, `rules/scaling.js`.

### `rules/scaling.js`
- **Owns:** All depth-scaling formulas as pure functions.
- **Exports:**
  - `enemyStatScale(baseStat, depth) → number`
  - `enemyCountScale(baseCount, depth) → number`
  - `lootRarityShift(depth) → number` — Returns rarity tier shift.
  - `dangerClockBaseRate(depth) → number`
  - `corruptionDangerRate(corruption) → number`
  - `calibrationFloor(depth) → boolean` — True if depth is divisible by 3.
  - `thresholdFloor(depth) → boolean` — True if depth is divisible by 10.
- **Depends on:** None (pure math).

### `rules/protocols.js`
- **Owns:** Protocol casting, overclock resolution, CHARGE cost/payment, effect resolution (damage, heal, condition application, duration, area).
- **Exports:**
  - `castProtocol(caster, protocolId, tier, target, rngCursor) → ProtocolResult`
  - `overclockProtocol(caster, protocolId, tier, rngCursor) → { success, corruptionAdded, result }`
  - `protocolChargeCost(tier, overclocked) → number`
  - `deckSlotCost(tier) → number`
  - `deckSlotCapacity(classChargeBase) → number`
- **Depends on:** `core/prng.js`, `data/protocols.json`, `rules/attributes.js`, `rules/conditions.js`.

### `rules/conditions.js`
- **Owns:** The nine conditions. Application (with save rolls), duration tracking, stacking (BURNING), SHIELDED consumption, condition clearing on floor transition.
- **Exports:**
  - `applyCondition(target, conditionId, source, rngCursor) → { applied, shielded }`
  - `tickConditions(target) → ConditionTickResult` — Processes start-of-turn effects (BURNING damage, duration decrement).
  - `clearAllConditions(target) → void` — Called on floor transition.
- **Depends on:** `core/prng.js`, `data/conditions.json`, `rules/attributes.js`.

### `rules/inventory.js`
- **Owns:** Inventory management: the 100-item hard cap (per FR-50), junk tagging (toggle), salvage value calculation, "Junk All Tagged" action, and scrap counter integration. This module enforces the cap that guarantees the URL save state is always encodable. It also provides the gameplay loop of converting unwanted items into scrap for scorecard credit.
- **Exports:**
  - `INVENTORY_CAP = 100` — The hard cap constant.
  - `addItem(inventory, item) → { success, inventory }` — Attempts to add an item. Returns `{ success: false }` if the cap is reached (UI shows warning, blocks pickup).
  - `removeItem(inventory, itemId) → { inventory, removedItem }` — Removes an item from inventory (e.g., when equipping).
  - `toggleJunkTag(inventory, itemId) → { inventory, isJunked }` — Toggles the junk tag on an item. Tagged items are visually marked but remain in inventory until "Junk All Tagged" is executed.
  - `junkAllTagged(inventory, scrapCounter) → { inventory, scrapGained, itemsDestroyed }` — Destroys all junk-tagged items, sums their salvage values, returns the total to add to the scrap counter. Items are permanently removed.
  - `getSalvageValue(item) → number` — Returns the salvage value of an item based on its type/category (from `data/equipment.json` or `data/consumables.json`).
  - `getInventoryCount(inventory) → number` — Returns total item count (including junk-tagged items, which still occupy space until junked).
- **Depends on:** `data/equipment.json`, `data/consumables.json`, `state/run-state.js` (for scrap counter updates).
- **Key types:** `Item` (shared with `rules/loot.js`), `InventoryResult = { success: boolean, inventory: Item[], ... }`.

### `state/run-state.js`
- **Owns:** The canonical run state object. Single source of truth for the portable save — contains ONLY what cannot be regenerated from the seed. Since descent is one-way and all floors are deterministic from `hash(worldSeed, N)`, the floor geometry, container placement, enemy placement, and environment theme are **regenerated from seed + depth on load** — never stored in the save state.
- **What IS saved (the diff + persistent state):**
  - `worldSeed` — the root of all deterministic generation
  - `depth` — current floor number (regenerates floor N on load)
  - `floorSubSeed` — if floor regeneration incremented the sub-seed during validation (rare; usually 0)
  - `partyPosition` — {x, y} on the 20×32 lattice (where the party token is right now)
  - `fogOfWar` — 640-bit bitmap (20×32 = 640 cells, 1 bit per cell: visited/not-visited). This is the player's exploration progress on the current floor — the only thing that can't be regenerated.
  - `openedContainers` — bitfield of container IDs that have been looted on this floor (prevents re-looting regenerated containers)
  - `defeatedEnemies` — bitfield of enemy IDs that have been killed on this floor (prevents respawn)
  - `dangerClockProgress` — current danger clock value (accumulates during exploration, resets on hunt)
  - `party` — 1–4 characters: class, sigil, 6 attributes, current HP, current CHARGE, calibration count, calibration choices, equipped items, protocol deck, conditions (if mid-floor)
  - `inventory` — unequipped items (weapons, armor, consumables with counts). **Hard-capped at 100 items** (per FR-50). This cap guarantees the save state is always encodable regardless of play depth or hoarding behavior.
  - `corruption` — run-wide corruption total
  - `credits` — remaining credits from unspent creation points
  - `scrapCounter` — total salvage value accumulated through the junk/salvage system (per FR-50). Displayed in PARTY/GEAR mode and on the run-end scorecard.
  - `themesSeen` — set of theme IDs encountered this run (for threshold floor "not yet seen" guarantee)
  - `echoQueue` — 0–2 pending Echoes (dead character snapshot + appearance floor)
  - `rngState` — both PRNG stream states (gen + combat) for deterministic resume
  - `flags` — version byte, calibration floors reached, etc.
- **What is NOT saved (regenerated on load):**
  - Floor geometry (cells, walls, layout) — regenerated by `floor/generator.js` from `hash(worldSeed, depth)`
  - Container positions and contents — containers placed during generation; contents generated from `hash(worldSeed, depth, containerId)`; `openedContainers` bitfield marks which are already looted
  - Enemy positions and stats — enemies spawned during generation; `defeatedEnemies` bitfield marks which are already dead
  - Environment theme — derived from `hash(worldSeed, depth)` via weighted selection from `data/themes.json`
  - Descent point position — placed during floor generation
- **Exports:**
  - `createRunState(worldSeed, party) → RunState`
  - `RunState.serialize() → object` — Plain object for save encoding (contains only the diff + persistent state listed above).
  - `RunState.deserialize(data) → RunState` — Reconstructs from decoded save data.
  - `RunState.advanceFloor() → void` — Increments depth, clears fog/containers/enemies bitfields, clears conditions.
  - `RunState.addCorruption(amount) → void`
  - `RunState.queueEcho(deadCharacter, deathFloor) → void`
  - `RunState.getDangerClockRate() → number`
  - `RunState.markContainerOpened(containerId) → void`
  - `RunState.markEnemyDefeated(enemyId) → void`
  - `RunState.markCellVisited(x, y) → void`
  - `RunState.addScrap(value) → void` — Adds salvage value to scrapCounter (called by `rules/inventory.js` when items are junked).
  - `RunState.getInventoryCount() → number` — Returns current inventory item count (for cap enforcement).
  - `RunState.isInventoryFull() → boolean` — Returns true if inventory has reached the 100-item cap.
- **Depends on:** `state/bus.js`, `core/rng-cursor.js`.
- **Load sequence:** On decode, the game calls `floor/generator.js.generateFloor(worldSeed, depth, rngCursor, themesData)` to regenerate the floor, then applies the saved diffs (fog bitmap, opened containers, defeated enemies, party position) to the regenerated floor. This produces an identical game state to what the player left.

### `state/save-encode.js`
- **Owns:** Encoding/decoding full run state to/from URL fragment using a progressive granularity compression pipeline. The entire run state — party, HP, CHARGE, inventory, equipment, position, depth, flags, corruption, Echo queue, PRNG state — must fit in a URL fragment under 1500 characters. No state is left behind in localStorage-only; the URL save is the complete portable snapshot. **Owner intent:** no matter what the state contains, it can be loaded on another machine by the shared code — the URL is the full, self-contained save. **When available:** the full-state `#r=` link is available only while the party is alive (mid-run). After party wipe, the run state is gone and only the seed-only `#w=` link is available (from the scorecard).
- **Exports:**
  - `encodeRun(runState) → string` — Returns base64url-encoded fragment string (< 1500 chars). Runs the full pipeline (see below).
  - `decodeRun(fragment) → { success, runState?, error? }` — Reverses the pipeline. Returns named failure type on error.
  - `encodeSeed(worldSeed) → string` — Seed-only encoding for share-world links.
  - `decodeSeed(fragment) → { success, seed?, error? }`
- **Depends on:** `state/run-state.js`, `state/condense.js`, `state/compress/progressive.js`, `state/encrypt.js`.
- **Key types:** `DecodeError = 'truncated' | 'version_mismatch' | 'checksum_failed' | 'malformed'`.

#### Full Encoding Pipeline

```
SAVE (encode):
  RunState → serialize → lookup-condense → progressive compress → encrypt → base64url → string

LOAD (decode):
  string → base64url decode → decrypt → progressive decompress → lookup-expand → deserialize → RunState
```

**Why compress before encrypt:** Encrypted data is high-entropy and incompressible. Compressing first maximizes the compression ratio; encrypting after ensures the compressed bytes are obfuscated without destroying compressibility.

**Why condense before compress:** The lookup table replaces common multi-field patterns (baseline character stats, empty slots, default conditions) with single short codes *before* binary serialization even produces bytes. This shrinks the input to the compression engine, so every subsequent compression pass has less data to work with and achieves better ratios. Condensation exploits semantic knowledge of the game state (which combinations are common) that generic compression cannot infer.

**Step 0 — Field-Level Lookup Table Condensation:**

Before bit-packing, the encoder consults a pre-built symbol table (`data/symbol-table.json`, ~8 KB, ~500 entries, ships with the game) to replace individual state field values with short table indices. Unlike a whole-state dictionary, the tables are **field-level** — each field (class, sigil, attribute, HP, item ID, etc.) has its own near-exhaustive lookup table. FNV-1a hash (`core/hash.js`, 10 lines, zero deps) provides O(1) lookup per field.

The symbol table is a set of field-level dictionaries compiled from game data at build time. Every machine running the same game version has the identical tables — they're compiled into the game code, not part of the save data. Each field has a forward `Map<hash, index>` (encoding) and a reverse `Array` (decoding), both built at module load.

```
SYMBOL TABLE STRUCTURE (data/symbol-table.json)
{
  "version": 1,
  "tables": {
    "class":          { "escape": 0x07, "entries": [Warrior, Ranger, Tinkerer, ...] },
    "sigil":          { "escape": 0x3F, "entries": [null, SigilA, SigilB, ...] },
    "attribute":      { "escape": 0x0F, "entries": [3, 4, 5, ..., 18] },
    "hp":             { "escape": 0x7F, "entries": [1, 2, ..., 80] },
    "charge":         { "escape": 0x7F, "entries": [1, 2, ..., 80] },
    "conditions":     { "escape": 0x3F, "entries": [0x0000, 0x0001, ...] },
    "item_id":        { "escape": 0xFF, "entries": [IronSword, LeatherArmor, ...] },
    "equipment":      { "escape": 0x7F, "entries": [[itemId, slot], ...] },
    "calamity_count": { "escape": 0x1F, "entries": [0, 1, 2, ..., 31] },
    "sigil_tier":     { "escape": 0x07, "entries": [0, 1, ..., 7] },
    "inventory_def":  { "escape": 0x07, "entries": [emptySnapshot, ...] }
  }
}

CONDENSATION ALGORITHM (state/condense.js):
  For each field in the run state:
    1. Serialize field value to canonical bytes
    2. hash = fnv1a(canonicalBytes)
    3. Look up hash in that field's Map<hash, index>
       → Hit?  Emit [table_index] (3–8 bits, field-specific width)
       → Miss?  Emit [escape_code] + [raw bit-packed value]

EXPANSION ALGORITHM (decode, reverse):
  For each field:
    1. Read code (field-specific bit width)
    2. Is it the escape code for this field?
       → Yes: Read raw bit-packed value, done
       → No:  Look up index in reverse table → reconstruct field value

  The symbol table is versioned. The version byte in the save header tells
  the decoder which symbol table version to use. If the save's version is
  newer than the running game's table, the decoder returns 'version_mismatch'.
  If the save's version is older, the decoder applies a migration map (if one
  exists) or returns 'version_mismatch'.
```

**Why this is safe for cross-machine loading:** The field-level symbol tables are compiled into the game code and ship with every copy. The save string contains only table indices and escape-coded raw values. A table index on one machine resolves to the identical field value on any other machine running the same version. Unknown or rare values use the escape code and carry their full raw encoding — no information is lost, regardless of table contents. FNV-1a hash is deterministic — the same canonical bytes always produce the same hash on every machine.

**Coverage and impact:**

| Scenario | Without condensation | With condensation | Savings | Table hit rate |
|----------|---------------------|-------------------|---------|----------------|
| Fresh party at depth 1 (4 baseline chars, empty inv, no conditions) | ~800 bits → ~108 base64url chars | ~50 bits → ~7 base64url chars | **94%** | ~99% |
| Mid-game party at depth 15 (mixed gear, some conditions, ~15 inv items) | ~2500 bits → ~340 base64url chars | ~1400 bits → ~190 base64url chars | **44%** | ~92% |
| Deep party at depth 50 (full gear, many conditions, ~50 inv items) | ~3000 bits → ~400 base64url chars | ~2400 bits → ~320 base64url chars | **20%** | ~88% |

Field-level exhaustive tables cover ~90–95% of field values in typical play. The escape rate is only 5–10%, vs. ~70% with a small whole-state dictionary. Condensation helps most when the state is simple (early game) — exactly when players are most likely to share links. For complex states, some fields escape to raw encoding, but baseline values (starting classes, common items, low condition counts) still hit the table.

**Step 1 — Serialize (bit-packed binary):**
Convert RunState to a flat byte array using field-level bit-packing:
- **Enums as bit fields:** class (3 bits, 6 values), sigil (6 bits, 48 values), rarity (3 bits, 5 values), affix ID (5 bits, 16 values), condition ID (4 bits, 9 values), archetype (3 bits, 8 values), theme ID (4 bits, 12 values).
- **Varint encoding:** depth, HP, CHARGE, credits, calibration count, danger clock progress — variable-length integers (depth 1 = 1 byte; depth 300 = 2 bytes).
- **Delta encoding for attributes:** `rank - 3` (4 bits signed, range -2 to +7). 6 attributes = 3 bytes per character.
- **Default omission:** absent conditions not stored (presence bit per slot, duration only if present). Empty equipment slots = zero byte. Zero-length inventory = zero byte.
- **Item packing:** category (3b) + base type (4b) + rarity (3b) + affix slots (4b presence mask + up to 4×5b affix IDs) + CORRUPT flag (1b) + consumable count (3b). ~4 bytes per item average.
- **Output:** flat `Uint8Array` of packed binary data.

**Step 2 — Progressive Granularity Compression (recursive, lossless):**

The compressor tries passes at increasing word sizes. Each pass catches patterns that smaller granularities can't see. After each pass, the engine checks if the output (after encryption + base64url) fits the 1500-char budget. If it fits, it stops. If a pass produces *larger* output (entropy floor at that granularity), the engine skips it and moves to the next. The number of applied passes and their granularities are recorded in a header so the decoder knows exactly how many times to reverse.

```
current = serialized_bytes
layers = []

for granularity in [1, 4, 8, 16, 32]:
    result = compress_at(current, granularity)

    if result is null:        // pass couldn't compress (would be larger)
        continue             // try next granularity
    
    if result.size >= current.size:
        continue              // no gain, skip this pass
    
    current = result.data
    layers.push({ granularity, dict: result.dict })
    
    encrypted = encrypt(current)
    output = base64url(header(layers) + encrypted)
    
    if output.length <= 1500:
        break                 // fits budget, done

// After all granularities tried (or budget met):
// final output = header + encrypted(current)
```

**Pass details:**

| Pass | Word Size | What it catches | Mechanism | Est. custom code |
|------|-----------|-----------------|-----------|-----------------|
| 1-bit | 1 bit | Runs of 0s in unused bit-packed fields, boolean flag patterns | Bit-level RLE + pattern dictionary | ~70 lines |
| 4-bit | 1 nibble | Repeated nibble values (stats 0-15, enum indices) | Nibble frequency dictionary (top-16 → 4-bit codes) | ~60 lines |
| 8-bit | 1 byte | Standard byte-level patterns (repeated item templates, zero runs) | Native `CompressionStream('deflate')` — zero custom code | 0 lines (native API) |
| 16-bit | 2 bytes | Repeated character stat blocks, similar equipment profiles | Word frequency dictionary (top-16 → 1-byte codes) | ~50 lines |
| 32-bit | 4 bytes | Large structural repeats (rare for this data) | Dword frequency dictionary (top-8 → 1-byte codes) | ~50 lines |

Each pass module has the same interface:
```js
// compress.js pass module interface
export function compress(data: Uint8Array) → { data: Uint8Array, dict: Uint8Array } | null
export function decompress(data: Uint8Array, dict: Uint8Array) → Uint8Array
```
Returns `null` from `compress()` if the pass would produce larger output (entropy floor reached at that granularity).

**Why progressive granularity beats single-pass DEFLATE:** The 1-bit and 4-bit passes pre-clean the data — collapsing bit-runs and nibble patterns — so DEFLATE's dictionary isn't wasted on patterns the finer passes already caught. DEFLATE then operates on pre-conditioned data and finds larger-scale patterns more efficiently. The 16-bit and 32-bit passes catch structural repetition (e.g. two characters with near-identical stat blocks) that byte-level compression misses because it doesn't see across 2- or 4-byte boundaries as patterns.

**Diminishing returns:** After the 8-bit (DEFLATE) pass, the data is typically near its entropy floor. The 16-bit and 32-bit passes are safety valves — they rarely fire under normal play but guarantee the full-state-in-URL contract holds for extreme edge cases (very deep runs, very large inventories). If a pass produces larger output, it's skipped. The engine never makes data bigger.

**Step 3 — Encrypt (XOR stream cipher):**
- Use xorshift128+ as a keystream generator, seeded from a fixed app key + the save's version byte.
- XOR each byte of the compressed data with the keystream.
- This is obfuscation, not security — the goal is to make the base64url output opaque (no readable strings, no recognizable patterns) so users don't manually tamper or extract meaning from save links.
- The keystream is deterministic and self-contained: the decoder regenerates it from the same fixed app key + version byte. No key exchange, no external state.
- ~20 lines of code. Zero byte overhead (no IV, no padding — XOR is stream-based).

**Step 4 — Finalize & Encode:**
1. Build header: `[version_byte (0x01)] [layer_count] [layer_descriptors... (granularity + dict per layer)]`.
2. Prepend header to encrypted data.
3. Append CRC32 checksum (4 bytes) for integrity validation.
4. Encode the full binary to base64url (no `=` padding, URL-safe alphabet).
5. **Validate:** result must be < 1500 characters.
   - If under budget: done — return the fragment string.
   - If over budget (extreme edge case): the progressive compressor has already tried all granularities. If all were exhausted and it still doesn't fit, return error `'save_too_large'`. The UI shows "this save is too complex for a share link." Under normal play (confirmed by budget analysis below), this never triggers.

**Decode (reverse pipeline):**
1. base64url decode → binary.
2. Validate length (truncated check), extract version byte (version mismatch check), verify CRC32 (checksum check). Any failure → named error, no further processing.
3. Decrypt (regenerate XOR keystream from version byte + app key, XOR payload).
4. Read header: layer count + per-layer granularity and dictionary.
5. For each layer in **reverse order**: call the corresponding pass module's `decompress(data, dict)`.
6. Lookup-expand: resolve symbol table indices to full state patterns from `data/symbol-table.json`; decode escape-coded fields as raw bit-packed values.
7. Deserialize bit-packed binary → RunState object.
8. Return `{ success: true, runState }` or `{ success: false, error: '...' }`.

**Budget analysis (worst-case estimates):**

Condensation impact varies by game state complexity. Early-game saves (baseline characters, empty inventory) condense by up to 94% with field-level exhaustive tables. Deep, complex saves see ~20% condensation gain (some fields escape to raw, but common items and baseline values still hit tables). The table below shows the **worst case** (deep run, ~88% table hit rate, minimal condensation gain):

| Component | After condense | After 1+4-bit | After 8-bit (DEFLATE) | After 16/32-bit |
|-----------|----------------|---------------|----------------------|-----------------|
| Header (version, seed, depth, sub-seed, corruption, danger clock, flags, credits, themesSeen) | ~14 | ~12 | ~10 | ~10 |
| PRNG state (2 streams × 16 B) | 32 | 32 | 32 | 32 |
| Floor diff (party pos 2B + fog bitmap 80B + opened containers ~2B + defeated enemies ~4B) | ~88 | ~52 | ~34 | ~30 |
| 4 characters (class, sigil, attrs, HP, CHARGE, cal, deck, conditions) | ~75 | ~64 | ~45 | ~42 |
| Equipment (3 items × 4 chars) | ~26 | ~22 | ~16 | ~14 |
| Inventory (100 items, hard cap per FR-50) | ~230 | ~184 | ~124 | ~108 |
| Echo queue (2 × full char) | ~38 | ~32 | ~22 | ~20 |
| Symbol table indices + escape flags | ~6 | ~5 | ~4 | ~4 |
| Dictionary headers | — | ~16 | ~20 | ~24 |
| Compress layer headers | — | 4 | 6 | 8 |
| CRC32 + version | 5 | 5 | 5 | 5 |
| **Total binary** | **~514 B** | **~394 B** | **~316 B** | **~297 B** |
| **base64url chars** | ~685 | ~525 | ~421 | ~396 |

Worst case after all compression passes (100-item inventory, the hard cap): **~396 base64url characters** — **3.8× headroom** under the 1500-char budget. Best case (early-game, heavy condensation): as low as **~7 base64url characters**. The fog-of-war bitmap (80 bytes) is the largest single component, but it compresses extremely well — visited cells cluster into contiguous regions that the 1-bit RLE pass collapses efficiently. The combination of field-level exhaustive lookup tables (semantic-level value replacement, ~90–95% coverage) and progressive granularity compression (bit/byte/word-level pattern exploitation) provides maximum safety margin. The escalating passes (1-bit → 4-bit → 8-bit → 16-bit → 32-bit) guarantee that no matter what the state contains, the encoder makes its best effort to fit the budget before reporting an error. The 100-item inventory cap (FR-50) bounds the only previously-unbounded dimension, making the save state **mathematically guaranteed to fit** under all achievable game states.

#### Maximum State Size Before Failure

The encoder fails (returns `'save_too_large'`) only when the final base64url output exceeds 1500 characters. This section computes exactly how large the game state must be to hit that limit, and how likely that is under normal play.

**The math:** 1500 base64url chars = 1500 × 6/8 = **1125 bytes** of binary payload. Subtract overhead: version byte (1) + layer headers (~8) + dictionaries (~24) + CRC32 (4) = ~37 bytes. Remaining for compressed state: **~1088 bytes**.

The progressive compressor achieves roughly a **2.5× ratio** on game state data (the data has inherent redundancy — repeated item structures, zero-runs in unused fields, similar character blocks). So 1088 compressed bytes ≈ **~2720 bytes of post-condensation serialized state**.

Condensation reduces raw serialized state by ~20% (worst case, deep run). So 2720 post-condensation bytes ≈ **~3400 bytes of raw serialized state**.

**What 3400 bytes of raw state looks like:**

| Component | Bytes per unit | Units to reach 3400 | Notes |
|-----------|---------------|---------------------|-------|
| Header (fixed) | ~14 | — | Always present |
| PRNG state (fixed) | 32 | — | Always present |
| Floor diff (fixed) | ~88 | — | Fog bitmap (80B) + position + container/enemy bitfields. Always present |
| Character (full) | ~25 | 4 | Party max is 4 — capped |
| Equipment slot | ~4 | 12 (3×4 chars) | Always filled — capped |
| Echo (full character) | ~25 | 2 | Typical max |
| Inventory item | ~4 | **~780 items** | ← THE ONLY SCALING DIMENSION |
| **Total (non-inventory)** | ~298 | — | Fixed by game design |
| **Remaining for inventory** | ~3102 | ~780 items | **780 inventory items to break** |

**The inventory is the only previously-unbounded dimension — now capped at 100 items by FR-50.** Party size (max 4), equipment slots (max 12), Echoes (typically 0–2), and all other state are bounded by game design. With the 100-item hard cap, there are **no unbounded dimensions left** — the save state is mathematically guaranteed to fit.

**How the cap was calculated:**

The cap was set by working backward from the budget: 1500 base64url chars ≈ ~1088 compressed bytes ≈ ~3400 raw bytes. Fixed overhead (header, PRNG, fog bitmap, 4 characters, equipment, echoes) ≈ ~298 bytes. Remaining for inventory: ~3102 bytes ÷ ~4 bytes/item ≈ ~775 items to break. The cap was set at 100 — well below the break point, giving 7.8× safety margin on the inventory dimension alone.

**With the 100-item cap enforced, the worst case is now calculable with certainty:**

| Scenario | Inventory size | base64url chars | Verdict |
|----------|---------------|----------------|---------|
| Normal play (depth 10–20) | ~15–25 items | ~120–160 | ✅ Vastly within budget |
| Deep run (depth 50, hoarding) | ~50 items | ~281 | ✅ 5.3× headroom |
| Maximum allowed (100 items, hard cap) | 100 items | ~396 | ✅ 3.8× headroom |
| Old theoretical max (780 items) | 780 items | ~1500 | ❌ No longer reachable — cap prevents this |

**Conclusion:** The save encoding **cannot break under any achievable game state**. The 100-item inventory cap (FR-50) eliminates the only unbounded dimension. Every component of the save state is now bounded by game design: party (max 4), equipment (max 12), Echoes (max 2), inventory (max 100), and all other fields are fixed-size. The `'save_too_large'` error is dead code — it cannot be triggered by any combination of valid gameplay.

The junk/salvage mechanic (FR-50) provides the gameplay motivation for the cap: players must make meaningful decisions about what to keep vs. what to junk for scrap value, and the scrap counter contributes to the run-end scorecard. This turns a technical constraint into a design feature.

### `state/condense.js`
- **Owns:** Field-level lookup table condensation — the first step in the save encoding pipeline. Consults `data/symbol-table.json` (field-level exhaustive tables, ~500 entries, ~8 KB, ships with game) to replace individual state field values with short table indices. Uses FNV-1a hash (`core/hash.js`) for O(1) lookup per field. Falls back to escape codes + raw bit-packing for values not in any table (~5–10% of values in typical play). Fully lossless: every state can be encoded (common values → short table code, rare values → escape + raw). The symbol table is versioned and ships with the game code — every machine running the same version has the identical table, so table indices resolve identically across machines.
- **Exports:**
  - `condense(runState) → { data: Uint8Array, tableVersion: number }` — Encodes run state field-by-field using the symbol table. For each field: serializes to canonical bytes, computes `fnv1a(canonicalBytes)`, looks up hash in that field's `Map` index. Hit → emit table index (3–8 bits). Miss → emit escape code + raw bit-packed value. Returns condensed binary + table version.
  - `expand(data, tableVersion) → RunState` — Reverses condensation. For each field: reads code. Escape code → decode raw bit-packed value. Table index → reverse-lookup in the field's array → reconstruct full value. Assembles RunState.
  - `getTableVersion() → number` — Returns the current symbol table version (for header writing).
- **Depends on:** `data/symbol-table.json`, `core/hash.js` (FNV-1a), `state/run-state.js` (for RunState type and raw serialize/deserialize).
- **Key types:** `CondensedField = { type: 'table' | 'raw', code: number, data?: Uint8Array }`.
- **FNV-1a hash function:** `fnv1a(bytes) → uint32` — 10 lines, zero dependencies. Uses `0x811c9dc5` offset basis and `0x01000193` prime. `Math.imul` for 32-bit multiplication. `>>> 0` for unsigned conversion. Collision probability with ~200 entries per table and 32-bit hash is negligible (< 10⁻³⁰).
- **Field-level table structure:**

| Field | Table Entries | Bits/Code | Coverage | Hash Key (canonical bytes) |
|-------|--------------|----------|----------|---------------------------|
| class | 6 | 3 | 100% | `[classId]` |
| sigil | 60 | 6 | 100% | `[sigilId]` |
| attribute (×6) | 16 each | 4 | ~95% (ranks 3–18) | `[attrRank]` |
| hp | 80 | 7 | ~95% (1–80) | `[hpValue]` |
| charge | 80 | 7 | ~95% (1–80) | `[chargeValue]` |
| conditions | 50 | 6 | ~90% | `[conditionMask]` (16-bit bitmask) |
| item_id | 200 | 8 | 100% | `[itemId]` |
| equipment config | 100 | 7 | 100% | `[itemId, slot]` |
| calamity_count | 32 | 5 | 100% | `[count]` |
| sigil_tier | 8 | 3 | 100% | `[tier]` |
| inventory_default | 8 | 3 | 100% | `[invSnapshotId]` |
| **Total** | **~500** | **3–8** | **~90–95%** | |

  Each table has a forward `Map<hash, index>` for encoding and a reverse `Array` for decoding. Both are built at module load from `data/symbol-table.json`. Total memory: ~4 KB for the `Map` indexes + ~8 KB for the table data = ~12 KB. Negligible against the 500 KB budget.

  **Why field-level tables beat whole-state tables:** A single character's full state space is 2^77 (~1.5 × 10²³ combinations). Even 0.001% coverage would require 150 trillion entries. Individual fields have small, enumerable value spaces (6 classes, 60 sigils, 200 items, etc.) that can be nearly exhaustively covered in a few hundred entries. Hash lookup makes each field resolution O(1) regardless of table size.

### `state/save-decode.js`
- **Owns:** Reversing the encoding pipeline to reconstruct a RunState from a URL fragment. The decoder is the mirror of `save-encode.js` — it reverses each step in exact opposite order.
- **Exports:**
  - `decodeRun(fragment) → { success, runState?, error? }` — Full decode with error classification.
  - `decodeSeed(fragment) → { success, seed?, error? }` — Seed-only decode.
- **Pipeline:** base64url decode → validate (length, CRC32, version) → decrypt (regenerate XOR keystream) → read compression layer headers → reverse each compression layer (decompress in reverse order) → lookup-expand (symbol table index resolution + escape-code raw decoding) → deserialize → RunState.
- **Depends on:** `state/save-encode.js` (shares header format, version constants), `state/condense.js`, `state/compress/progressive.js`, `state/encrypt.js`, `state/run-state.js`.
- **Key types:** Shares `DecodeError` type with `save-encode.js`.

### `state/compress/progressive.js`
- **Owns:** The recursive multi-granularity compression engine. Tries each pass (1-bit, 4-bit, 8-bit, 16-bit, 32-bit) in order. After each successful pass, checks if the encrypted+base64url'd output fits the budget. Records applied layers (granularity + dictionary data) for the decoder. Stops when budget is met or all granularities are exhausted.
- **Exports:**
  - `compress(data: Uint8Array, budgetCheck: (data: Uint8Array) → boolean) → { data: Uint8Array, layers: LayerInfo[] }` — Tries passes, calls `budgetCheck` after each to see if output fits. Returns compressed data + metadata about which passes were applied.
  - `decompress(data: Uint8Array, layers: LayerInfo[]) → Uint8Array` — Reverses passes in reverse order using stored layer metadata.
- **Depends on:** `state/compress/pass-1bit.js`, `pass-4bit.js`, `pass-8bit.js`, `pass-16bit.js`, `pass-32bit.js`.
- **Key types:** `LayerInfo = { granularity: number, dict: Uint8Array }`.

### `state/compress/pass-[1|4|8|16|32]bit.js` (×5)
- **Owns:** One compression granularity each. Each module implements the same interface but operates at a different word size.
- **Exports:**
  - `compress(data: Uint8Array) → { data: Uint8Array, dict: Uint8Array } | null` — Compresses at this granularity. Returns `null` if the pass would produce larger output (entropy floor reached).
  - `decompress(data: Uint8Array, dict: Uint8Array) → Uint8Array` — Reverses this pass's compression.
- **Depends on:** None (pure data transforms). `pass-8bit.js` uses native `CompressionStream('deflate')` / `DecompressionStream('inflate')`.

### `state/encrypt.js`
- **Owns:** XOR stream cipher for save obfuscation. Uses xorshift128+ as a keystream generator seeded from a fixed app key combined with the save format version byte. This is obfuscation, not cryptographic security — the goal is to make save links opaque (no readable strings, no recognizable patterns) so users don't manually tamper.
- **Exports:**
  - `encrypt(data: Uint8Array, versionByte: number) → Uint8Array`
  - `decrypt(data: Uint8Array, versionByte: number) → Uint8Array`
- **Depends on:** `core/prng.js` (keystream generation).
- **Note:** Zero byte overhead — XOR is stream-based, no IV or padding. The keystream is deterministic from (app key + version byte), so decode regenerates it identically. ~20 lines of code.

### `state/library.js`
- **Owns:** localStorage persistence for the run library (multiple runs) and settings. All writes are non-blocking (async queue).
- **Exports:**
  - `saveRun(runState) → void` — Autosaves run to library (keyed by worldSeed + creationTimestamp).
  - `loadRun(key) → RunState | null`
  - `listRuns() → LibraryEntry[]` — Returns { seed, depth, partyCount, partySigils, accentSwatch, timestamp } for each run. New entries persist the party sigil codepoints; legacy entries may omit them.
  - `deleteRunState(key) → void` — Called on party wipe. Removes the run's state from localStorage but does NOT remove the seed — the seed remains available for sharing or restarting.
  - `getSeed(key) → number | null` — Returns the world seed for a wiped run (for scorecard "share world" and "restart with same seed" actions).
  - `saveSettings(settings) → void`
  - `loadSettings() → Settings`
  - `getFlag(key) → any` — Generic localStorage flag (tutorial declined, etc.)
  - `setFlag(key, value) → void`
- **Depends on:** `state/run-state.js`, `state/save-encode.js`.

### `state/party-configs.js`
- **Owns:** localStorage persistence for saved party configurations (per FR-51). These are **meta-game blueprints** — a saved party build (classes, sigils, attributes, equipment, protocols, unspent-points-to-credits) that can be loaded into the creation screen for a quick start. They are NOT run state — they contain no depth, HP, inventory, PRNG, or any in-run data. They are not part of the URL save pipeline. They survive party wipes and run deletions. Capped at 10 named configurations. The last-used configuration is tracked so new runs default to it.
- **Exports:**
  - `saveConfig(name, partyBlueprint) → { success, configs }` — Saves a named configuration. If 10 configs already exist, returns `{ success: false }` (UI prompts to delete one first). If the name already exists, overwrites it (with confirmation from UI).
  - `loadConfig(name) → PartyBlueprint | null` — Returns the saved configuration by name.
  - `listConfigs() → ConfigEntry[]` — Returns `{ name, partySigils, partyClasses, pointsSpent, credits }` for display in the creation screen.
  - `deleteConfig(name) → void` — Removes a saved configuration. UI confirms before calling.
  - `getLastUsed() → PartyBlueprint | null` — Returns the last finalized or loaded configuration. Called by the creation screen on mount to pre-populate fields.
  - `setLastUsed(partyBlueprint) → void` — Called when the player finalizes a run or loads a config. Updates the "last used" pointer.
  - `validateConfig(partyBlueprint, currentGameData) → { valid, invalidItems[] }` — Checks a loaded configuration against current game data (class gates, equipment costs, protocol availability). Returns a list of invalid items if a game version update has changed the rules. The UI flags these for the player to adjust.
- **Depends on:** None (pure localStorage CRUD + data validation). Reads from `data/classes.json`, `data/equipment.json`, `data/protocols.json` for validation only (passed in as `currentGameData` by the caller).
- **Key types:** `PartyBlueprint = { characters: CharacterBuild[], credits: number, version: number }`, `CharacterBuild = { classId, sigilId, attributes: {mgt, fin, vit, res, foc, sig}, equipment: {weapon, armor, offhand}, protocols: {school, tier}[] }`, `ConfigEntry = { name, partySigils, partyClasses, pointsSpent, credits }`.
- **localStorage keys:** `od_party_configs` (array of configs), `od_party_config_last_used` (name string or null).

### `state/bus.js`
- **Owns:** Lightweight pub/sub event bus. Modules dispatch events; UI modules subscribe to update rendering.
- **Exports:**
  - `bus.on(event, handler) → unsubscribe`
  - `bus.dispatch(event, payload) → void`
- **Depends on:** None.
- **Key events:** `state:floor-change`, `state:combat-start`, `state:combat-end`, `state:character-death`, `state:party-wipe`, `state:corruption-change`, `state:danger-clock-tick`, `state:settings-change`, `ui:navigate`, `ui:mode-change`, `ui:console-expand`, `ui:console-collapse`.
- **Navigation contract:** `ui:navigate` carries `{ screen, params }`. Exploration navigation may include `{ runState, floor?, resume? }`; `main.js` restores a missing floor before mounting and keeps the active run and floor references synchronized.

### `exploration/lattice.js`
- **Owns:** The 20×32 grid model. Cell types (wall, floor, container, descent point, feature). Party token position. Cell queries.
- **Exports:**
  - `createLattice(floor) → Lattice`
  - `Lattice.getCell(x, y) → Cell`
  - `Lattice.isWalkable(x, y) → boolean`
  - `Lattice.setPartyPosition(x, y) → void`
  - `Lattice.getPartyPosition() → {x, y}`
- **Depends on:** `floor/generator.js` (Floor type).

### `exploration/shadowcast.js`
- **Owns:** Shadowcast line-of-sight algorithm. Computes visible cells from a position. Maintains 3-state fog of war (unvisited, visited-not-in-LOS, in-LOS).
- **Exports:**
  - `computeLOS(lattice, originX, originY, radius) → Set<{x, y}>` — Returns visible cells.
  - `updateFogOfWar(fogState, visibleCells) → void` — Updates fog states.
- **Depends on:** `exploration/lattice.js`.

### `exploration/movement.js`
- **Owns:** 8-directional movement with corner rule, auto-stop interrupt processing, danger clock advancement during exploration.
- **Exports:**
  - `moveParty(lattice, fogState, direction, rngCursor, runState) → MoveResult`
  - `MoveResult` contains: `moved`, `interruptType?`, `discoveredEntity?`.
  - `tickDangerClock(runState, stepCount) → { huntTriggered, huntData? }`
- **Depends on:** `exploration/lattice.js`, `exploration/shadowcast.js`, `state/run-state.js`, `core/rng-cursor.js`, `rules/enemies.js`.

### `ui/console/console.js`
- **Owns:** The console shell — tab bar with 7 mode buttons, expand/collapse, mode switching, keyboard shortcut routing (keys 1–7), input delegation to active mode module.
- **Exports:** `createConsole(state) → ConsoleController` — Returns object with `setMode()`, `expand()`, `collapse()`, `render()`.
- **Depends on:** `ui/console/move.js`, `ui/console/combat.js`, ... (all 7 mode modules), `ui/input.js`, `state/bus.js`.

### `ui/console/[mode].js` (×7)
- **Owns:** One console mode each. Renders mode-specific content into the console container, handles mode-specific input, reads from run state and combat state.
- **Exports:** `render(container, context) → void`, `handleInput(event, context) → void`.
- **Depends on:** `ui/components.js`, `state/bus.js`, respective rules modules.

### `ui/playfield.js`
- **Owns:** Canvas 2D rendering of the lattice (exploration mode: 20×32 with fog of war; combat mode: 8×16 zoomed with targeting overlay, range bands, initiative highlighting). Auto-pan to keep active actor visible.
- **Exports:**
  - `createPlayfield(canvas) → Playfield`
  - `Playfield.renderExploration(lattice, fogState, partyPos) → void`
  - `Playfield.renderCombat(combatState, lattice, zoomOrigin) → void`
  - `Playfield.setAccent(color) → void`
- **Depends on:** `exploration/lattice.js`, `exploration/shadowcast.js`, `data/sigils.json`.

### `ui/input.js`
- **Owns:** Unified input handler. Maps keyboard and touch events to semantic actions. Guarantees keyboard/touch parity. No action is reachable by one but not the other.
- **Exports:**
  - `createInputHandler() → InputHandler`
  - `InputHandler.onAction(callback) → void` — Registers a handler for semantic actions (move-north, confirm, cancel, tab-next, etc.).
  - `InputHandler.bindToElement(el) → void` — Attaches listeners to a DOM element.
- **Depends on:** None (platform APIs only).

### `audio/engine.js`
- **Owns:** AudioContext lifecycle (created on START gesture), layer mix bus, master volume, per-layer volume, mute. Coordinates the 5 layers.
- **Exports:**
  - `createAudioEngine() → AudioEngine`
  - `AudioEngine.start() → void` — Resumes AudioContext (called from START handler).
  - `AudioEngine.setLayerVolume(layer, volume) → void`
  - `AudioEngine.setMasterVolume(volume) → void`
  - `AudioEngine.setMute(muted) → void`
  - `AudioEngine.updateState(gameState) → void` — Pushes game state to layers for modulation.
- **Depends on:** `audio/drone.js`, `audio/pulse.js`, `audio/sparkle.js`, `audio/lead.js`, `audio/noise-bed.js`.

### `audio/[layer].js` (×5)
- **Owns:** One synthesis layer each. Each layer is a self-contained WebAudio node graph that responds to `updateState()` calls.
- **Exports:** `create[Layer](audioContext, destination) → [Layer]Controller` with `updateState(state)`, `setVolume(v)`, `start()`, `stop()`.
- **Depends on:** WebAudio API, `data/themes.json` (for audio mode selection), `core/hash.js` (lead layer melody generation).

### `glitch/glitch.js`
- **Owns:** The glitch timer system. Each glitching element registers with a per-element intensity constant and a timer. The dispatcher fires effects (character substitution, chromatic ghosts, VHS events, element jitter, border flicker, frame flash, glitch bars, noise lines) on their own free-running schedules. All timings are the measured constants from FR-23. No game-state input.
- **Exports:**
  - `createGlitchSystem() → GlitchSystem`
  - `GlitchSystem.registerElement(element, intensity) → void`
  - `GlitchSystem.start() → void`
  - `GlitchSystem.stop() → void`
  - `GlitchSystem.setEnabled(enabled) → void` — Respects settings toggle + prefers-reduced-motion.
- **Depends on:** `data/sigils.json` (safe substitution pool).

### `glitch/grain.js`
- **Owns:** Canvas dot-scatter grain. 10px cell grid, ~15% fill, 2×2px dots, re-scattered once per second via `setInterval` + canvas redraw. Independent of the glitch timer system (continuous, not event-driven).
- **Exports:** `createGrain(canvas) → GrainController` with `start()`, `stop()`, `setEnabled(bool)`.

### `glitch/transitions.js`
- **Owns:** Authored set-piece animations: boot sequence (on game start after START), floor descent (on floor transition), death (on single character death). Fixed timelines, not glitch-meter-driven. Disabled by reduced-motion (replaced with static fade).
- **Exports:**
  - `playBootSequence(container) → Promise<void>`
  - `playDescentSequence(container) → Promise<void>`
  - `playDeathSequence(container, character) → Promise<void>`
- **Depends on:** `glitch/glitch.js` (for reduced-motion check).

### `ui/screens/[screen].js` (×9)
- **Owns:** One full-screen view each. Manages screen lifecycle: mount, render, handle input, unmount. Screens are mutually exclusive — one active at a time.
- **Exports:** `mount(container, params) → ScreenController` with `unmount()`.
- **Depends on:** Respective rules/state modules, `ui/components.js`, `ui/input.js`, `state/bus.js`.

### `ui/screens/creation.js`
- **Owns:** The 80-point buy character creation screen. Handles party building (1–4 characters, attribute/equipment/protocol purchases, sigil selection). On finalize, creates RunState and transitions to exploration. Supports being launched with a pre-loaded world seed (for "restart with same seed" from scorecard or seed-only import link `#w=<seed>`). Integrates saved party configurations (FR-51): displays a list of saved configs, allows loading a config to pre-populate the creation screen, allows saving the current config, defaults to the last used config on entry, and validates loaded configs against current game data (flagging invalid items from version mismatches).
- **Exports:** `mount(container, params) → ScreenController` where `params` optionally includes `{ preloadedSeed?: number }`. If `preloadedSeed` is provided, the creation screen uses it as the world seed instead of generating a fresh random one. On mount, the screen loads the last-used party configuration (if any) via `state/party-configs.js.getLastUsed()` and pre-populates all fields.
- **Depends on:** `rules/attributes.js`, `rules/classes.js`, `rules/equipment.js`, `rules/protocols.js`, `state/run-state.js`, `state/party-configs.js`, `data/classes.json`, `data/equipment.json`, `data/protocols.json`, `data/sigils.json`, `ui/components.js`, `ui/input.js`.

### `ui/screens/scorecard.js`
- **Owns:** The run-end scorecard. Displays: final depth, party roster with sigils, cause of death, world seed, and the eight run-summary metrics (floors descended, calibrations, enemies slain, echoes slain, CORRUPT items, corruption, scrap recovered, and credits remaining). Offers four actions: share world link (seed-only `#w=` URL), restart with same seed (mounts `creation.js` with `preloadedSeed`), start new run (mounts `creation.js` with no preloaded seed), return to title. Does NOT offer continue/retry of the dead run — the party wiped, the run state is gone.
- **Exports:** `mount(container, params) → ScreenController` where `params` includes `{ seed, depth, party, causeOfDeath, scrapCounter, runState?, summary? }`. Missing summary values render as `0` for backward compatibility.
- **Depends on:** `state/save-encode.js` (for seed-only link generation), `state/library.js` (for `getSeed`), `ui/components.js`, `ui/input.js`, `data/sigils.json`.

### `ui/screens/import.js`
- **Owns:** Link import and named failure screens. Decodes both `#r=` (full run state) and `#w=` (seed-only) fragments. For `#r=`: success → mount exploration with restored state; failure → named failure screen (truncated, version_mismatch, checksum_failed, malformed). For `#w=`: success → mount creation screen with `preloadedSeed`. Where the seed is still readable from a failed `#r=` state, offers "fresh run in this world" (mounts creation with `preloadedSeed`).
- **Depends on:** `state/save-encode.js`, `state/save-decode.js`, `ui/components.js`, `ui/input.js`.

### `service-worker.js`
- **Owns:** Cache-first offline strategy. On install, caches the known asset manifest. On fetch, serves from cache, falling back to network (should never happen after first load). Caches: HTML shell, all JS modules, all CSS, WOFF2 font, `data/*.json`.
- **Depends on:** None (runs in service worker context).

### `main.js`
- **Owns:** Application bootstrap, screen routing, active run/floor lifecycle, floor restoration, autosave dispatch, and live visual-setting application.
- **Exports:** `mountScreen(name, params) → Promise<void>` — Unmounts the current screen, imports and mounts the requested screen, and ignores stale dynamic-import results after a newer navigation wins.
- **Lifecycle:** Screen imports are guarded by a monotonically increasing mount sequence. Callers that do not await a navigation use `void mountScreen(...)`; initial URL routing awaits its mount.

## Data Flow

### Game Initialization (First Load)
1. Browser loads `index.html` → `<script type="module" src="src/main.js">`.
2. `main.js` registers `service-worker.js` (async, non-blocking).
3. `main.js` fetches all `data/*.json` files (parallel `Promise.all`), caches in memory.
4. `main.js` loads settings from `localStorage` via `library.js`.
5. `main.js` mounts the title screen (`ui/screens/title.js`). **No audio, no floor generation, no PRNG initialization occurs.**

### START Pressed → New Run
1. Title screen dispatches `ui:start` event on bus.
2. `audio/engine.js` creates `AudioContext` (user gesture satisfied) and starts layers.
3. `main.js` mounts creation screen. On mount, creation screen calls `state/party-configs.js.getLastUsed()` and pre-populates all fields if a last-used configuration exists.
4. Player builds party (1–4 characters, 80-point buy). Creation screen validates constraints in real-time via `rules/attributes.js`, `rules/classes.js`, `rules/equipment.js`, `rules/protocols.js`. Player may load a saved configuration, save the current configuration, or build from scratch.
5. On finalize: `state/run-state.js` creates `RunState` from party + purchases. `state/party-configs.js.setLastUsed(partyBlueprint)` saves the finalized build as the new default. PRNG initialized from a fresh random world seed (or user-provided seed).
6. `glitch/transitions.js` plays boot sequence.
7. `floor/generator.js` generates floor 1.
8. `main.js` mounts exploration screen with floor 1.

### Exploration Loop
1. Player inputs movement via console MOVE mode → `ui/input.js` translates to semantic action → `exploration/movement.js` executes move.
2. `exploration/shadowcast.js` recomputes LOS → fog of war updates → `ui/playfield.js` re-renders canvas.
3. `exploration/movement.js` checks auto-stop interrupts:
   - Hostile in LOS → halt, dispatch `state:combat-start`.
   - Container/descent/feature discovered → halt, dispatch `ui:discovery`.
   - Damage taken → halt, dispatch `ui:interrupt`.
4. `exploration/movement.js` ticks danger clock each step → if threshold reached, spawn hunt → dispatch `state:combat-start`.
5. `state/library.js` autosaves on floor transitions.

### Combat Loop
1. `rules/combat.js` initiates combat: roll initiative, build turn order, create `CombatState`.
2. `main.js` switches to combat screen (playfield zooms to 8×16, console switches to COMBAT mode).
3. For each character/enemy turn:
   - UI shows active actor on initiative rail.
   - Player issues actions via COMBAT console mode → `rules/combat.js` resolves → log entry generated → `state/bus.js` dispatches `ui:log-entry`.
   - `rules/conditions.js` ticks conditions at start of turn.
   - `rules/enemies.js` runs AI for enemy turns.
4. `rules/combat.js` checks end condition: all hostiles dead → victory; all party dead → wipe.
5. Victory → return to exploration. Wipe → `state/bus.js` dispatches `state:party-wipe` → `state/library.js.deleteRunState(key)` removes the run's state (but keeps the seed) → mount scorecard screen. The scorecard offers only the seed-only `#w=` link (no full-state `#r=` link — the party is dead, the run state is gone). Scorecard also offers: restart with same seed (creation screen with same worldSeed), start new run (fresh seed), return to title. **While the party is alive (mid-run),** the player can generate a full-state `#r=` link at any time (via LOG mode or a console action) to share their exact current position — same party, same depth, same inventory, same everything.

### Save/Load Flow
1. **Autosave:** On floor transition and combat resolution, `state/library.js` serializes `RunState` and writes to `localStorage`.
2. **Copy link:** `state/save-encode.js` encodes `RunState` to URL fragment → copy to clipboard.
3. **Import link:** Paste URL → `state/save-encode.js` decodes → success: mount exploration with restored state; failure: mount named failure screen.
4. **Library resume:** `state/library.js` loads run from `localStorage` → `RunState.deserialize()` → mount exploration at saved depth.

## Dependency Flow

```
                          ┌─────────────┐
                          │  service-   │
                          │  worker.js  │
                          └─────────────┘
                                (caches everything below)

┌─────────────────────────────────────────────────────────────┐
│                         main.js                              │
│                   (entry point, screen router)                │
└──────────┬──────────┬──────────┬──────────┬──────────────────┘
           │          │          │          │
     ┌─────▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼──────────────┐
     │ ui/screens│ │ audio/ │ │ glitch/│ │ state/            │
     │           │ │ engine │ │       │ │ bus, run-state,  │
     │ ┌─────────┤ │ +5    │ │       │ │ save-encode,      │
     │ │ console/│ │ layers│ │       │ │ library           │
     │ │ 7 modes │ └───┬───┘ └───┬───┘ └────┬─────────────┘
     │ └────┬────┘     │         │          │
     │      │          │         │          │
     │ ┌────▼────┐     │         │          │
     │ │playfield│     │         │          │
     │ │ input   │     │         │          │
     │ │ compo-  │     │         │          │
     │ │ nents   │     │         │          │
     │ └─────────┘     │         │          │
     └────────┬────────┘         │          │
              │                  │          │
     ┌────────▼──────────────────▼──────────▼──────┐
     │              rules/                          │
     │  combat  attributes  classes  protocols      │
     │  conditions  enemies  loot  equipment         │
     │  consumables  scaling                        │
     └────────┬─────────────────────────────────────┘
              │
     ┌────────▼────────────────────────────────────┐
     │  exploration/  floor/  core/                 │
     │  lattice    generator  prng                  │
     │  shadowcast archetypes hash                  │
     │  movement   modifiers  rng-cursor            │
     │             validator                       │
     └────────┬─────────────────────────────────────┘
              │
     ┌────────▼─────────┐
     │   data/*.json     │
     │  (static lookup   │
     │   tables)         │
     └──────────────────┘
```

**Dependency rules (enforced by module boundaries):**
- `data/*.json` depends on nothing. Pure data.
- `core/` depends on nothing but platform APIs. Pure logic.
- `floor/` depends on `core/` and `data/`. No UI, no state.
- `rules/` depends on `core/`, `data/`, and `floor/` (for Floor type). No UI, no DOM.
- `exploration/` depends on `core/`, `floor/`, `rules/`, `state/`. No UI, no DOM.
- `state/` depends on `core/`. No UI, no DOM. (library.js touches localStorage only.)
- `audio/` depends on `core/`, `data/`. No DOM (WebAudio only).
- `glitch/` depends on `core/`, `data/`. Touches canvas/DOM for effects only.
- `ui/` depends on everything below it. This is the only layer that touches the DOM.

## API Design

No HTTP API — the game is fully client-side. The only "API" surfaces are internal module contracts (documented above) and the URL fragment encoding scheme.

### URL Fragment Encoding Scheme

| Fragment Pattern | Purpose | Example |
|------------------|---------|---------|
| `#r=<base64url>` | Full run state (portable save) — available **only while the party is alive** (mid-run). The recipient resumes play from that exact point. After party wipe, this link type is not available (the run state is gone). | `#r=eyJ2IjoxLCJzIj...` |
| `#w=<base32-seed>` | World seed only (share-world link). Available both mid-run (share the world without your progress) and post-wipe (from the scorecard). Opens character creation with that seed pre-loaded — a fresh run at depth 1 in the same world. No run state carried. | `#w=ABCD1234` |

**Encoding pipeline (inside `state/save-encode.js`):**
1. Run state object → field-level lookup table condensation (`state/condense.js`): each state field is serialized to canonical bytes, hashed with FNV-1a, and looked up in that field's near-exhaustive table (`data/symbol-table.json`, ~500 entries, ~8 KB). Hits → short table index (3–8 bits). Misses → escape code + raw bit-packing. ~90–95% hit rate in typical play. Fully lossless.
2. Condensed state → bit-packed binary serialization (enum bit-fields, varints, delta encoding, default omission, item packing for escape-coded fields).
3. Progressive granularity compression (lossless, recursive): try passes at 1-bit → 4-bit → 8-bit → 16-bit → 32-bit word sizes. Each pass catches patterns the previous granularity can't see. After each pass, check if output fits budget. Skip passes that produce larger output. Record applied passes in header for decoder.
4. XOR stream cipher encryption (xorshift128+ keystream, obfuscation only).
5. Base64url encoding with version byte + CRC32 checksum.
6. Result must be < 1500 characters. If all granularity passes are exhausted and it still doesn't fit, return `'save_too_large'` error. See the `state/save-encode.js` module contract for the full algorithm and budget analysis.

## Security Posture

- **Authentication:** None. No backend, no accounts, no auth.
- **Authorization:** None. Single-user client-side app.
- **Data at rest:** `localStorage` data is unencrypted (browser-managed). Treated as untrusted on load — `library.js` validates structure on every read; malformed data fails gracefully, never crashes.
- **Data in transit:** No network requests after first load (service worker cache-first). The only "transit" is the URL fragment, which is user-controlled.
- **URL fragment parsing:** `save-encode.js` decodes in a sandboxed parser — no `eval`, no `Function()`, no `innerHTML`. The parser is a pure data deserializer: it base64url-decodes, verifies CRC32 checksum, checks version, regenerates the XOR keystream for decryption, reverses progressive compression passes in order, resolves field-level symbol table indices via reverse array lookup (and decodes escape-coded raw values), and maps the binary to a typed object. Untrusted input can produce a named error or a valid `RunState`, never arbitrary code execution. The XOR cipher is obfuscation only (fixed app key, no security claim) — it prevents casual tampering and keeps the base64url output opaque.
- **Service worker:** Only fetches from the origin. No third-party requests. No `importScripts` from external URLs.

## Deployment Architecture

- **Target:** Any static file host (S3 bucket, GitHub Pages, Netlify, nginx, Cloudflare Pages). The game is a directory of static files.
- **Build:** No build step. The `dist/` directory (if used) is a straight copy of `src/` + `index.html` + `data/` + `assets/` + `styles/`. No minification, no bundling, no transpilation. Files are served as-is.
  - *Optional dev tooling:* A dev server with live reload (e.g., `npx serve`) for development convenience. Not part of the shipped artifact.
- **Runtime:** Browser loads `index.html` → ES modules load on demand → service worker caches everything → game runs fully offline after first load.
- **Asset budget (first load):**
  | Asset | Estimated Size |
  |-------|----------------|
  | `index.html` | ~2 KB |
  | `src/**/*.js` (all modules, incl. save encoding pipeline + inventory.js + party-configs.js) | ~130 KB (uncompressed), ~44 KB (gzipped) |
  | `styles/*.css` | ~15 KB (uncompressed), ~4 KB (gzipped) |
  | `assets/descent-sigil.woff2` | 4–8 KB |
  | `data/*.json` (10 files, incl. symbol-table.json ~8 KB) | ~28 KB (uncompressed), ~10 KB (gzipped) |
  | `service-worker.js` | ~2 KB |
  | **Total (compressed)** | **~63 KB** (well under 500 KB budget) |

## Open Architectural Questions

1. **Save-state schema density — RESOLVED.** The 1500-character URL limit must carry the *entire* run state (owner decision: full portability, no localStorage-only components; owner intent: no matter what the state contains, it can be loaded on another machine by the shared code). **Key architectural insight (owner-identified):** since descent is one-way and all floors are deterministic from `hash(worldSeed, N)`, the save state does NOT store floor geometry, container contents, enemy positions, or theme — these are regenerated from seed + depth on load. The save only stores the "diff" (fog-of-war bitmap, opened containers, defeated enemies, party position) plus persistent state (party, inventory, corruption, echoes, PRNG state). This dramatically simplifies the save schema — the largest new component is the 640-bit fog-of-war bitmap (80 bytes), which compresses well due to spatial clustering of visited cells. The encoding pipeline is: field-level lookup table condensation (pre-built field-level tables with ~500 entries covering ~90–95% of field values, FNV-1a hash for O(1) lookup, escape codes for rare values) → serialize (bit-packing) → progressive compress (1-bit → 4-bit → 8-bit → 16-bit → 32-bit, lossless, recursive, checks budget after each pass) → encrypt (XOR stream cipher) → base64url. The symbol table ships with the game (~8 KB, versioned) so table indices resolve identically on every machine. Field-level tables provide near-exhaustive coverage of individual fields (class 100%, sigil 100%, items 100%, attributes 95%, HP/CHARGE 95%, conditions 90%) — far better than a small whole-state dictionary (~30% coverage). Condensation shrinks early-game saves by up to 94%; progressive compression guarantees the budget for deep, complex saves. Worst-case budget analysis (4 characters, depth 50+, **100 inventory items at the hard cap**, 2 Echoes, all compression passes applied) projects ~396 base64url characters — **3.8× headroom**. The 100-item inventory cap (FR-50) eliminates the only previously-unbounded dimension, making the save state **mathematically guaranteed to fit** under all achievable game states — the `'save_too_large'` error is dead code. The junk/salvage mechanic (FR-50) provides the gameplay motivation for the cap. **No further architectural decision needed.** The DB agent owns the specific bit-field layout and symbol table contents; Coder implements the pipeline as documented.

2. **Canvas vs DOM for combat grid.** The 8×16 combat grid with targeting overlays, range bands, and initiative highlighting could be Canvas (consistent with the exploration playfield) or DOM/CSS (easier for accessibility and interactive targeting). Current plan: Canvas for rendering, DOM overlay for targeting UI. This needs validation at M1 against the combat mock.

3. **Audio CPU budget on mid-range mobile.** Five simultaneous WebAudio synthesis layers with per-sample modulation (drone detune, pulse dissonance, sparkle filter cutoff, lead melody) may exceed the CPU budget on low-end devices. If profiling at M7 shows problems, the architecture supports graceful degradation: reduce voice count per layer, or disable the lead layer first (it's the most CPU-intensive and the least essential for atmosphere). **No architectural change needed for this fallback** — each layer is independently start/stop-able.

4. **Module loading strategy.** Native ES modules load on demand via the browser's module graph. For a ~120 KB JS payload this is fast, but on slow connections the waterfall of module requests could add latency. The service worker mitigates this after first load. For first load, an optional optimization is to inline critical-path modules (main.js, title screen, state/bus) into `index.html` and lazy-load the rest. **Recommendation:** Measure first; optimize only if first-load time exceeds expectations. The 500 KB budget suggests the owner expects this to be fast.

5. **Data file loading timing.** All `data/*.json` files are fetched at game start (before title screen renders). If this causes a perceptible delay, they can be loaded lazily — e.g., `themes.json` only when floor generation begins. **Recommendation:** Preload all at start since the total is ~20 KB; the title screen is static and can render while data loads in parallel. No architectural change needed.

6. **Deterministic PRNG cross-contamination — RESOLVED.** The PRNG uses two independent streams: one for floor generation (`hash(worldSeed, "gen")`) and one for combat/event rolls (`hash(worldSeed, "combat")`). This prevents a regenerated floor from silently shifting all subsequent combat rolls — a subtle determinism bug that would be very difficult to diagnose. Both states serialize compactly (2 × 16 bytes = 32 bytes) in the save encoding. The `core/rng-cursor.js` module manages both streams; the save state stores both cursors. **No further decision needed.** Coder implements dual streams as specified.

<!-- SESSION-01 (history-and-scroll) -->

### M102 Router (new)

**Path:** `src/router.js`
**Owns:** URL fragment codec (`#a=`, `#r=`, `#w=`) and the browser-history controller that drives `hashchange`-based navigation and history sync.
**Imports:** M43 `state/save-encode.js` (`encodeSeed`), M44 `state/save-decode.js` (`decodeSeed`).
**Consumed by:** M86 `runtime.js`.

**Public exports:**
- `parseFragment(hash)` → discriminated union:
  - `{ kind: 'none' }` — empty hash
  - `{ kind: 'run', fragment }` — `#r=<base64url>`
  - `{ kind: 'seed', seed }` — `#w=<base32>`, `seed` is the raw base32 string
  - `{ kind: 'route', route, save, seed, from }` — `#a=<route>[&save=current][&seed=<b32>][&from=<route>]`; `seed` is a decoded `uint32` or `null`; `save` is `'current' | null`; `from` is a validated route or `null`
  - `{ kind: 'invalid' }` — anything else (unknown route, unknown key, malformed seed, duplicate keys, unknown top-level prefix)
- `buildFragment({ route, save, seed, from })` → `#a=…` string with parameters in the fixed order `a,save,seed,from`. Returns `''` for an invalid route.
- `canonicalFragmentFor(screen, params)` → the canonical `#a=` fragment for the given mount:
  - `exploration` / `combat` → `#a=exploration&save=current[&seed=…]` (combat canonicalizes to exploration)
  - `creation` with numeric or base32 `preloadedSeed` → `#a=creation&seed=<b32>`; without → `#a=creation`
  - `scorecard` with `seed` → `#a=scorecard&seed=<b32>`
  - `settings` with a valid `from` → `#a=settings&from=<route>`
  - all other routes → `#a=<route>`
- `createHistoryController({ window, onNavigate })` → factory that returns `{ start(), stop(), sync(screen, params, { push }) }`. DI'd on `window` (no import-time DOM access). `sync` writes `pushState`/`replaceState` and suppresses the resulting hashchange; `start` attaches the single `hashchange` listener; `stop` detaches it. Feature-detects `addEventListener`/`history` so it degrades cleanly in test harnesses with stub `window` objects.
- `ROUTES` — frozen route-name tuple mirrored in `runtime.js`.

**Invariants:**
- No DOM globals at import time — everything runs through the injected `window`.
- No third-party dependencies; factory functions only; no wildcard exports.
- Duplicate `#a=` keys, unknown keys, or an undecodable `seed` all classify as `invalid` — the boot resolver then falls back to `title` and rewrites the fragment.

### M86 Hot Runtime — public behavior delta

- `activateRuntime({ initialHash })` now parses `initialHash` through `parseFragment` and dispatches to `resolveParsedFragment`, which handles `#r=` (import), `#w=` (creation), `#a=<route>` (see M102 canonical policy), and the resume-from-library flow for `#a=exploration&save=current[&seed=…]` (uses M45 `listRuns`/`loadRun`, newest `alive`-run wins, seed-filtered when present, `title` fallback on miss).
- The runtime installs an M102 history controller against the real `window`. Every successful `mountScreen` synchronizes the URL to the canonical fragment for the mounted screen unless the mount was itself triggered by a hashchange (in which case it echoes the URL exactly once). User-driven `ui:navigate` route changes push; combat handoff, floor transitions, party wipe, layout re-mount, and hashchange re-mounts replace. In-run fragments (`#a=exploration&save=current&seed=…`) are constant across re-mounts so the write is a no-op.
- `shutdownRuntime` now also calls `historyController.stop()` and clears the push/history-mount flags alongside the existing `layoutControllerCleanup` teardown.
- No changes to bus event contracts, `runtime:route` payload shape, or the autosave lifecycle.

### M82 Main Entry — public behavior delta

- Unchanged. `main.js` still passes `window.location.hash` into `activateRuntime({ initialHash })` — the boot fragment interpretation now lives entirely in the runtime + router.

<!-- SESSION-02 (history-and-scroll) -->

### M103 Scroll Memory (new)

**Path:** `src/ui/scroll-memory.js`
**Owns:** Keyed scroll-offset store plus capture/restore helpers that preserve `scrollTop` across `replaceChildren`-style re-renders and re-mounts of the same surface.
**Imports:** none.
**Consumed by:** M60 `ui/console/console.js`, M69 `ui/screens/creation.js`, M72 `ui/screens/library.js`.

**Public exports:**
- `captureScroll(element, key)` → stores `element.scrollTop` under `key` (string). No-op on missing element, empty key, or a non-finite/negative scrollTop. Re-capturing an existing key refreshes recency for the LRU eviction pass.
- `restoreScroll(element, key)` → schedules a `requestAnimationFrame(() => requestAnimationFrame(...))` (double-rAF, so layout completes between destroy and read) that clamps the stored offset to `max(0, scrollHeight - clientHeight)` and writes `element.scrollTop`. No-op when the key is unknown, the element is null, or `element.isConnected === false`. Falls through to synchronous application when `requestAnimationFrame` is unavailable (Vitest environment).
- `preserveScroll(element, key, render)` → `captureScroll` → invoke `render()` → `restoreScroll`; returns `render()`'s return value.
- `clearScrollMemory(prefix?)` → drop every stored offset when called without arguments; when given a string, delete only keys that start with the prefix.

**Key convention:** `'<surface>:<pane>'` — the shipped call-sites use `console:${modeId}` (one entry per console mode, seven total), `creation:editor` (shared by portrait `.creation-body` and wide `.wide-editor`), and `library:list` (shared by portrait `.screen-body` and wide `.wide-library-body`).

**Invariants:**
- No DOM globals at import time (no `document` / `window` reads).
- No bus dependency; callers hold the lifetime and choose whether to `clearScrollMemory` on shutdown.
- Module-level `Map` capped at 64 entries; oldest insertion evicted first when the cap is exceeded — stale entries self-correct via the clamp on restore.
- Factory-free plain functions; no third-party dependencies.

### M60 Console Shell — public behavior delta

- The mode-context `refresh` callback exposed to the seven mode modules is now `refreshCurrentMode` (captures `console:<currentMode>` before delegating to `renderCurrentMode`); mode modules see no signature change.
- `renderCurrentMode` calls `restoreScroll(contentArea, 'console:<currentMode>')` after mounting the new content so re-entry to a mode reinstates its remembered scroll position.
- `setMode(nextMode)` captures the outgoing mode's `contentArea.scrollTop` under `console:<outgoingMode>` before switching, so switching modes remembers each mode's position for the life of the console.
- No changes to bus events, tab layout, expand/collapse behavior, or the input contract.

### M69 Creation Screen — public behavior delta

- The internal `render()` function captures the active scroll pane under `creation:editor` before `clear(container)` and restores it after the new subtree mounts. The tracked pane is `.wide-editor` in the wide layout and `.creation-body` (the `.screen-body`) in portrait — assigned inside `renderWide`/`renderPortrait` respectively.
- Same key is used across both layouts so a layout-switch re-mount or a route-history re-mount lands at the previous scroll position.

### M72 Library Screen — public behavior delta

- The internal `render()` function captures the active list-scroll container under `library:list` before `container.replaceChildren()` and restores it after the new screen mounts. The tracked pane is the `.screen-body` returned by `createScreenBody` in both layouts (`data-testid="library-list"`); wide layout uses the `wide-library-body` variant, portrait uses the `s-3` variant — both scroll.
- Restore-on-mount covers hashchange-driven re-mounts (SESSION-01's back/forward via M102) without any additional wiring.

<!-- SESSION-01 (control-and-polish) -->

# SESSION-01 (control-and-polish) — architecture delta

## M24 Combat Rules (`src/rules/combat.js`)

Bounded path movement replaces the one-cell `executeMove`. The public function signatures are unchanged; three new named exports and one action-shape extension carry the new capability.

### New exports

- `MOVE_RANGE = 5` — hard cap on a single MOVE action's step count.
- `reachableMoveCells(combatState, actorId, maxSteps = MOVE_RANGE) → Map<'x,y', { x, y, steps, path }>` — BFS from the actor's position over the 8 movement directions. Each expansion honors `legalStep` (walls + diagonal corner rule) and rejects destinations occupied by any living actor. `path` is the shortest ordered direction list from the origin. The origin cell is intentionally excluded. Returns an empty map when the actor, position, or window is missing.
- `isLegalMoveStep(combatState, actorId, from, direction) → boolean` — single-step legality (walls, corner rule, occupancy) from an arbitrary `from` cell. Exposed so the UI can gate incremental path-stepping without duplicating the rules internals.

### Action-shape extension

`executeAction` and `executeMove` now accept a `path` field on the move action alongside the existing `direction`/`targetId`. Precedence: `panicked` (single-step `fleeDirection` override) → `path` (array, length 1..MOVE_RANGE) → `direction` wrapped to `[direction]` (back-compat with `enemyAI` `stepToward`) → `targetId` fallback (`[stepToward(target)]`). The whole path is pre-validated (walls, corner, occupancy); a single illegal step rejects the entire request with `illegal-cell`/`invalid-direction` and moves nothing. On success the walk executes step-by-step, resolving `getOpportunityAttackers` per threatened departure; a lethal OA stops the walk on the last cell actually reached (`actor.position` reflects the last successful landing; `moveAvailable` is only cleared on a fully completed walk).

Overlength paths (`path.length > MOVE_RANGE`) reject with `illegal-cell`. `phasing` (Ghost signature) exemption preserved — the whole walk skips OA resolution.

### `getLegalActions` shape

The returned object gains `moveRange: MOVE_RANGE`. `legalMoveDirections` is unchanged (still the 1-step legal directions from the actor's current position — used only by callers that want first-step hints).

### Move log entry

`{ type: 'move', actorId, direction, path, steps, from, to, triggeredAttacks[, cancelled] }`.
- `direction` = `path[0]` — kept so `formatLog` and older pins that read `entry.direction` stay valid.
- `path` — the direction sequence: full attempted path on success, walked partial (excludes the fatal step) on cancelled.
- `steps` — `path.length` in the recorded entry.
- `to: null` when cancelled (matches the pre-session single-step convention); actor's own `position` field is authoritative for where it died.

`toCombatSnapshot` still serializes only `log.length`, so path arrays never enter the save budget.

## M58 Playfield (`src/ui/playfield.js`)

New pure export:

- `cellAtPoint({ canvas, camera, cellSize }, clientX, clientY) → { x, y } | null` — client-coord → grid-cell hit test. Reads `canvas.getBoundingClientRect()` and scales by `canvas.width / rect.width` (canvases render at intrinsic width but display at `width: 100%`), then adds `camera.x/y` so callers get a world-space cell. Returns `null` when the point is outside the rect, when the canvas has no measurable rect, or when `cellSize` is falsy.

Existing exports, camera math, wall-line pass, and canvas `pointer-events: none` guarantee are unchanged.

## M62 Console Combat (`src/ui/console/combat.js`)

Move action label: `MOVE · UP TO 5 CELLS` (was `MOVE · MOVE ACTION`).

The direction grid is now a **path stepper**, not a one-shot direction pick. Same `.combat-direction-grid` / `.combat-direction` class names and `combat-dir-<direction>` testids. The center cell is a non-interactive `.dpad-center` element whose text reads `${remaining} LEFT` (`remaining = MOVE_RANGE − movePath.length`). A `.combat-undo` row-button (`combat-undo` testid) appears below the grid whenever `movePath.length > 0`.

Direction-button enablement now comes from `context.combatGetPathSteps()` (legal next-step directions from the current cursor endpoint), not the pre-session `context.combatGetDirections()`. Clicks call `context.combatStepPath(direction)`; the UNDO button calls `context.combatPopPath()`.

`handleInput` routing:
- `ACTION_TO_DIRECTION[action]` → `context.combatStepPath(direction)` when the selected action is `move` (was `combatSelectDirection`).
- `cancel` action → `context.combatPopPath()` when a move path is being built (movePath non-empty); falls through to `context.combatCancel()` otherwise. The console shell owns portrait `cancel` (collapses the tab bar) and only delegates cancel to modes in dock (wide) variant, so keyboard-undo is a wide-mode capability; the on-screen UNDO row-button covers portrait.

## M71 Combat Screen (`src/ui/screens/combat.js`)

Public `mount(container, params) → { unmount }` shape unchanged.

### Selection state

`selection.movePath: string[]` replaces `selection.direction` as the source of truth for move actions. `selection.direction` is retained as a `movePath[0]` mirror for legacy console/log consumers. `chooseAction`, `syncSelectionActor`, and the full-cancel branch of `cancelSelection` all reset `movePath` to `[]`.

`actionFromSelection` for `move` now emits `{ type: 'move', actorId, path: [...movePath] }` (was `{ direction }`). `validationError` checks `movePath.length ∈ [1, MOVE_RANGE]` and that the walked endpoint is in `reachableMoveCells`. `canConfirm` / `confirmSelection` accept a move-path early-confirm (no explicit `confirm` phase transition required once at least one step is stepped).

### viewState bindings (delta)

Removed: `combatSelectDirection`, `combatGetDirections`.
Added: `combatStepPath`, `combatPopPath`, `combatSelectDestination`, `combatGetMoveRange`, `combatGetPathSteps`.

- `combatStepPath(direction)` — append one legal single step to `movePath` (walls/corner/occupancy via `isLegalMoveStep`), capped at MOVE_RANGE. Users may zig-zag; not restricted to BFS shortest.
- `combatPopPath()` — remove the last step; drop back to `choose-path` phase when the path empties.
- `combatSelectDestination(cell)` — replace `movePath` with the BFS-shortest route (`reachableMoveCells(...).get(key).path`); enter `confirm` phase.
- `combatGetMoveRange()` — the reachable map for the active actor.
- `combatGetPathSteps()` — legal single-step directions from the current cursor endpoint (used by `renderDirections` to enable/disable buttons).

### Pointer wiring

`pointerdown` / `pointermove` / `pointerup` / `pointercancel` attach to `playfieldBody` (canvas remains `pointer-events: none`, per M58). A press whose cursor travels less than `DRAG_THRESHOLD_PX = 6` is a **tap** — `cellAtPoint` resolves the world cell and dispatches to `selectDestination` (move) or `selectTarget` (attack/cast/overclock/item, matching the cell against `targetsForSelection().position`). Anything past the threshold is a **drag** — `manualCamera` shifts on the Y axis, clamped to the vertical overflow (`combat window height − visible rows`; horizontal is a no-op because window width matches camera width). `manualCamera` is threaded through `renderCombat` via `overlayOptions().camera`, so the drag preview honors the existing camera pipeline instead of introducing a second transform. `syncSelectionActor` clears `manualCamera` on turn change so auto-centering resumes.

### Overlay options

`rangeCells` now doubles as the movement highlight during move mode (`selection.actionType === 'move'` in `choose-path` or `confirm`): the full `reachableMoveCells` key set. `pathCells` marks the cells along the current `movePath`. Existing target-mode semantics (single-cell `rangeCells` around the selected target, cover indicator, valid-target frames) are unchanged.

<!-- SESSION-02 (control-and-polish) -->

# SESSION-02 (control-and-polish) — architecture delta

## M70 Exploration Screen (`src/ui/screens/exploration.js`)

Two owner-directed additions extend M70 without changing its public export shape (`mount(container, params) → { unmount }`).

### Drag/touch pan with party auto-follow

- The rendered canvas is CSS-scaled inside `.exploration-playfield` (`overflow: hidden`); on small viewports the lower rows fall off. M70 now translates the canvas within the clipped body via `canvas.style.transform = translate3d(panX, panY, 0)` — no re-render, no camera on the render path (the canvas bitmap is still drawn at 20×32 full-lattice; fog gates visibility).
- `panOffset` is clamped so the canvas edge never detaches from the body edge: `min = min(0, bodySize - canvasScaledSize)`, `max = 0`, per axis. Sizes are read live from `getBoundingClientRect()` (with a fall-back to intrinsic `canvas.width/height`), so the same math handles portrait and wide.
- Pointer handlers live on `playfieldBody` (the canvas keeps `pointer-events: none` from M58 `src/ui/playfield.js:125`): `pointerdown` captures a start position, `pointermove` past a 6-pixel threshold pans and calls `setPointerCapture`, `pointerup`/`pointercancel` end. A non-passive `touchmove` listener calls `preventDefault()` while a drag is active to stop the page from scrolling under the finger. Cursor toggles inline between `grab` and `grabbing`.
- `ensurePartyVisible()` shifts `panOffset` minimally when the party's canvas-pixel position leaves a two-cell margin inside the visible body. It runs from a `requestAnimationFrame` on mount (so `getBoundingClientRect` sees post-layout sizes) and after every successful move in `handleMoveResult`. A manual drag sets `suppressFollow = true`; the flag clears on the next successful move so the player can look around freely without being yanked back mid-look. Layout switches remount M70 already (M86 runtime `ui:layout-change` handler); the mount-time follow re-runs against the new sizes.

### Arrow keys always move — focus hardening and `console:intent` fallback

- After `inputHandler.bindToElement(container)` the mount now calls `container.focus({ preventScroll: true })`. On `pointerdown` inside `playfieldBody`, if `document.activeElement` is not the container and not contained by it (checked with `container.contains(active)` so a focused console button keeps its focus), M70 refocuses the container. This eliminates the macOS/Safari failure where clicking the map leaves nothing focused and subsequent keydowns never reach the input handler.
- M70 subscribes to `bus.on('console:intent', …)` and routes `move_(n|s|w|e|nw|ne|sw|se)` actions to `onMove(direction)` when combat is not active. `console:intent` is dispatched by M60 (`src/ui/console/console.js:244`) only when the active pane's `handleInput` declined the action, so MOVE and COMBAT panes keep first refusal — GEAR/PARTY/TECH/LOOT/LOG panes no longer eat movement keys. The subscription lives in the existing `unsubscribers` array and is cleaned up on unmount; it also short-circuits when `runState.activeCombat` is truthy.

### Behavior invariants preserved

- No bus events added or renamed; no changes to `mount`'s parameter or return contract.
- Movement is still routed through M32 `moveParty` — the fallback path shares `onMove` with the direct keydown path.
- Canvas dimensions (480×768), overflow, and DOM order under `playfieldBody` are unchanged; the only new inline style is `playfieldBody.style.cursor`.
- `unmount()` now also removes the pointer/touch listeners and the `console:intent` subscription; no leaked handlers persist across route changes or layout remounts.

<!-- SESSION-03 (control-and-polish) -->

# SESSION-03 (control-and-polish) — architecture delta

## M18 Equipment Rules (`src/rules/equipment.js`)

New public exports (render-time only — display strings are never persisted; save codec at `src/state/save-codecs.js:281` round-trips a fixed item field set):

- `itemDisplayName(item, data) → string` — resolves in order: explicit `item.name` → category-catalog lookup (`weapon`→`data.equipment.weapons[baseType].name`, `armor`→`data.equipment.armor[baseType].name`, `consumable`→`data.consumables.consumables[baseType].name`) → prettified `baseType` (`heavy_melee` → `Heavy Melee`) → `item.id`. When `item.baseType` is missing, the trailing segment of `item.id` (creation ids end in `-{baseType}`, `src/ui/creation-model.js:246`) is used as the lookup key. Pure, never throws, tolerates `data = {}`.
- `describeItem(item, data) → string` — ` · `-joined summary line. Weapon → `d6 dmg · adjacent range · +1 acc`; armor → `+3 DEF · FIN -1` (FIN only when non-zero); consumable → catalog `effect` verbatim. Appends each affix as `AffixName: effect` (from `data.affixes.affixes[id]` for string affixes, or from the affix object directly), then `CORRUPT +0.10` when `item.corrupt`, then `scrap N` when `getSalvageValue(item) > 0`. Rarity is deliberately omitted — the card's rarity tag already carries it.

## M56 UI Components (`src/ui/components.js`)

`createEquipmentCard(item, opts)` now also renders a `.card-desc` element when `item.description` (or `opts.description`) is a non-empty string. Card remains data-free; callers pass a wrapped display item (`{ ...item, name: itemDisplayName(item, data), description: describeItem(item, data) }`) — never mutate inventory items.

## Consumers

- M64 Console Gear (`src/ui/console/gear.js`) — `itemName(item, data)` delegates to `itemDisplayName`; equipped-row + inventory-row cards receive the wrapped display item.
- M66 Console Loot (`src/ui/console/loot.js`) — local `itemName`/`itemDetail` deleted; both delegate to the shared resolvers; junk-toggle notice now resolves the display name from inventory instead of leaking raw ids.

## CSS

- M79 (`styles/components.css`) — adds `.card-desc` (small `--text-secondary` line under `.card-name`). Mock class parity is mock→prod (`scripts/design-scan/check-mock-classes.js`); a production-only class defined in production CSS cannot regress the scan and no mock edits are required.

<!-- SESSION-04 (control-and-polish) -->

## SESSION-04 (control-and-polish) — M93 grows: compiler grammar primitives

### M93 — Typeface Tooling (`tools/font/build_font.py`, `font-src/glyphs.json`)

The recipe compiler in `tools/font/build_font.py` gains four schema-additive primitives and two node kinds. The old four-primitive grammar (rings-with-gaps, radial strokes, axis-aligned bars, square/diamond nodes) drew every mark as a boxy plus-sign; the extended vocabulary lets each family carry its own construction.

**Added primitives** (all optional; recipes that never mention them keep prior behavior):

- **`rings[].cx`, `rings[].cy`** — full ring center offsets (default 0, 0). The interior `arc_segment` was refactored to accept explicit center coordinates so `ring()` can dispatch to any center.
- **`arcs[]`** — offset arc segments as their own top-level list. Each entry: `{cx?, cy?, radius, width, start, sweep, steps?=6}`. Emits one arc_segment; steps default is intentionally low to keep the byte budget tight.
- **`bars[].angle`** — optional rotation angle (degrees) for the axis-aligned bar, rotated about the bar's own center. When absent or 0, the axis-aligned `rect()` fast path is taken (unchanged output for old recipes).
- **`traces[]`** — width-stroked open polylines. Each entry: `{points: [[x,y], …], width}`. Emitted as one rotated rectangle per segment (all rectangles share consistent winding so overlaps merge cleanly under non-zero fill). Points are relative to CENTER, matching the `bars` coordinate convention.
- **`nodes[].kind = 'circle'`** — 8-sided regular polygon (rotated 22.5° so it never aligns with the axis-aligned bar grammar).
- **`nodes[].kind = 'tick'`** — short bar oriented tangential to the placement angle (thickness = max(8, 0.6 × size)).

**Determinism preserved.** All new primitives round all coordinates to integers at emission and use fixed `steps` counts (default 6 for offset arcs, 10 for full rings). `python3 tools/font/build_font.py --check-deterministic` builds twice and compares bytes; verified green at 6,988 bytes.

**Byte discipline.** Rev-2 WOFF2 is 6,988 bytes (rev 1 was 7,916), inside the 4–8 KB acceptance range with ~1.2 KB headroom.

**Recipe schema is additive.** Every existing recipe field still works with the new draw pipeline; the new fields are simply ignored when absent. All 72 recipes in `font-src/glyphs.json` were re-authored to exploit the extended grammar, keeping the frozen codepoint/family/archetype ordering from `data/sigils.json` intact.

### M14 — Font Asset (`assets/descent-sigil.woff2`)

Rebuilt from rev-2 recipes; deterministic; passes `python3 scripts/verify-font.py` (72 glyphs, advance 1000, fixed-pitch, hhea 850/-150/0).

### M81 — Service Worker (`service-worker.js`)

`CACHE_VERSION` bumped to `2026-08-16-control-and-polish-v1`. No manifest additions (font asset and all docs/font-src/tools paths remain excluded per Custom Rule 12).

<!-- SESSION-05 -->
### SESSION-05 (control-and-polish) — wide-layout dock resize + collapse (2026-08-16)

**M100 — Layout Controller: new export `attachWidePanes({ shell, saveSettings, loadSettings })`**

Owns pane state on the wide 3-region shell. Idempotent per-mount: returns a `cleanup()` that removes injected DOM, drops the CSS variables (`--wide-left-w`, `--wide-right-w`), and clears `data-pane-left`/`data-pane-right`. Portrait mounts do not invoke it; screens gate on `isWide`.

Injected DOM (children of `shell`, absolutely positioned over the grid gaps):
- `button.pane-collapse-btn.pane-collapse-{left,right}` — `data-testid="pane-collapse-{side}"`; click toggles collapse.
- `div.pane-resize-handle.pane-resize-{left,right}` — `role="separator"`, `aria-orientation="vertical"`, `aria-valuemin/max/now`, `tabIndex=0`, `data-testid="pane-handle-{side}"`.

Bounds (px; mirror the outer `.wide-shell` grid floors so a request never asks for a track narrower than CSS renders):
- Left (telemetry): min 280, max 480, default 280, collapsed rail 48.
- Right (console): min 360, max 640, default 360, collapsed rail 96.

Persistence (rides `src/state/library.js` settings passthrough — no schema change):
- `settings.widePanes = { left: <px number | 'collapsed'>, right: <px number | 'collapsed'> }`.
- Read via injected `loadSettings()`, written via injected `saveSettings({ widePanes })`. Defensive: non-object/NaN/out-of-range values fall back to defaults on read; clamped on write.

Interactions:
- Drag on a handle: `pointerdown` seeds `startX + startWidth`, uses `setPointerCapture`; `pointermove` updates the width var; `pointerup`/`pointercancel` releases and persists.
- Double-click on a handle: resets to default and persists.
- Keyboard on a focused handle: `ArrowLeft`/`ArrowRight` resize by 16px, direction inverted per side (left+Right widens; right+Right narrows). `preventDefault + stopPropagation` so the enclosing screen's move-input never sees them.
- Collapse button: toggles between `default` and `'collapsed'`; persists.
- Tab column click (right side only): `.wide-console-tabs` inside the shell auto-expands the right pane if collapsed.

**M101 — Wide CSS: var-driven grid + collapsed-rail templates**

`.wide-shell` grid-template-columns now `minmax(280px, var(--wide-left-w, 280px)) minmax(320px, calc(100vh * 9 / 16)) minmax(360px, var(--wide-right-w, 360px))`. Playfield middle track invariant (Rule 8: 9:16 portrait proportion).
- `.wide-shell[data-pane-left="collapsed"]` swaps the left track to `48px`.
- `.wide-shell[data-pane-right="collapsed"]` swaps the right track to `96px` — tab column (`.wide-console-tabs`) stays visible; `.wide-console-content` is hidden.
- Handle hit-area 8px with accent hover glow; collapse buttons meet the 44px touch-target minimum per design.md.

**M70/M71 — Screen integration (unchanged shell assembly, new post-mount hookup)**

Both `src/ui/screens/exploration.js` and `src/ui/screens/combat.js` call `attachWidePanes({ shell, saveSettings, loadSettings })` in the `isWide` branch after the shell + telemetry dock + console dock are assembled. The returned `cleanup()` is added to the unmount teardown path; `ui:layout-change` remount re-runs it. Portrait mounts do not create pane controls.

**Accepted mock drift**

The two in-run wide mocks (`mocks/wide/exploration.html`, `mocks/wide/combat.html`) carry the handles + collapse chevrons in lockstep with production (Rule 8 error-level parity). The console-mode wide mocks (`mocks/wide/console-*.html`) remain uncollapsed — matches the playfield-palette precedent for standalone console mocks; no scan finding.

**Design-scan surface**

No new errors introduced (0 errors / 7 warnings / 2 info — baseline unchanged). Production-only classes `.pane-resize-handle`, `.pane-collapse-btn`, `.pane-resize-{left,right}`, `.pane-collapse-{left,right}` are safe under `check-mock-classes.js` (mock→prod scan direction: production-only classes never fail). The scan-relevant classes on the two wide mocks all exist in production CSS.

**Test surface**

- `tests/ui/layout.test.js` — pane controller unit pins (default apply, defensive clamp on bogus persisted values, drag persists, collapse persists, keyboard resize persists, cleanup removes injected DOM).
- `tests/ui/exploration-screen.test.js` / `tests/ui/combat-screen.test.js` — integration pins (handles + collapse buttons present in wide mount, absent in portrait mount, absent after unmount).
- `tests/e2e/wide-panes.spec.js` — 3 acceptance tests in the `chromium-portrait` project with a per-test widened viewport (1440×900): drag-and-persist, collapse-and-persist, keyboard-does-not-move-party. Other projects skip.

No `service-worker.js` manifest change (M100 lives in an existing file). No new M-ID.

<!-- clarity-and-fit SESSION-02 -->

### M103 Scroll Memory — restore timing contract (clarity-and-fit SESSION-02)

`restoreScroll(element, key)` now applies the stored offset **synchronously**
in the same task as the call. The prior double-`requestAnimationFrame` schedule
painted one–two frames at `scrollTop = 0` after every pane re-render, which
manifested as a top-flash on every console mode click. Because
`renderCurrentMode()` (M60) mounts children before invoking `restoreScroll`,
the element is connected and its `scrollHeight`/`clientHeight` are measurable
in the same task — setting `scrollTop` immediately means no frame ever paints
at the top.

For content whose height settles late (async layout, image reflow, deferred
child rendering), `restoreScroll` schedules **one** `requestAnimationFrame`
retry — but only when the synchronous clamp produced an actual value less than
the stored offset (`element.scrollTop < stored`), i.e. the extent was too
short at call time. The retry re-runs the same clamp with the updated
`scrollHeight`. Detached elements still bail from both the sync apply and the
retry.

Public API is unchanged: `captureScroll`, `restoreScroll`, `preserveScroll`,
`clearScrollMemory` keep their exact signatures; the 64-entry LRU is
untouched. M60/M69/M72 call sites required no edits.

<!-- clarity-and-fit SESSION-03 -->

# SESSION-03 arch delta — clarity-and-fit / staged movement + near-black lattice

## M58 Playfield (`src/ui/playfield.js`) — public contract

- Palette constants now exported: `FLOOR_COLOR = '#101010'`, `FLOOR_DIM_COLOR = '#0a0a0a'`, `TICK_DIM_ALPHA = 0.45`, `WALL_COLOR = '#000000'`, `HIDDEN_COLOR = '#000000'`, `GRID_COLOR = '#3a3a3a'`, `WALL_LINE_COLOR = '#7ec8e3'`. The removed `VISITED_OVERLAY` constant no longer exists (fog-1 is expressed by `FLOOR_DIM_COLOR` + dim-alpha ticks).
- `renderExploration(lattice, fogState, partyPos, options?)` — signature extended with an optional 4th `options` argument. Currently reads `options.stagedPath` — an array of `{ direction, x, y }` step descriptors. When present and non-empty, the renderer draws a `#d8d8d8` 5×5 preview square at 55 % globalAlpha centered on each staged cell, then a 1 px `#d8d8d8` inset outline on the tail cell. Absent/empty stagedPath yields no preview marks. Callers passing 3 arguments (existing behavior) are unchanged.
- Internal: floor fills use `FLOOR_DIM_COLOR` when `fog === 1`; a new `drawGridTicks` pass replaces the per-cell `strokeRect` gridline — it draws `-|-` corner ticks (arm ≈ ⌈cellSize / 6⌉ px) at interior intersections touched by ≥ 1 revealed floor cell, at `TICK_DIM_ALPHA` when all 4 touching revealed cells are dim (fog 1). `renderCombat` uses the same tick pass with `isDim: () => false` (combat is always lit).

## M61 Move Console (`src/ui/console/move.js`) — behavior change

- The D-pad no longer executes movement on press. Direction buttons/keys now call `context.stageMove(direction)` when available (falls back to legacy `context.onMove` only if the host does not provide `stageMove`).
- Center-button label logic — `CONFIRM (n)` (enabled, `n` = staged count) overrides `DESCEND` / `WAIT` whenever `context.stagedPath.length > 0`.
- `handleInput({ action: 'confirm' })` — commits staged buffer via `context.onCommitStagedMoves()` when `stagedPath` is non-empty; otherwise falls back to descent confirmation.
- New actions handled by `handleInput` — `undo_stage` → `context.onUndoStagedMove()`; `clear_stage` → `context.onClearStagedMoves()`.
- Two new toggle-row buttons — `move-undo` and `move-clear`, enabled iff `stagedPath.length > 0`.
- Notice string reflects staged count and tail coordinates when staged: `STAGED n STEP(S) → x:y — CONFIRM to execute.`; `CANNOT STAGE — wall or closed corner.` on illegal stage; `STAGED PATH CLEARED.` on drain.

## M70 Exploration Screen (`src/ui/screens/exploration.js`) — behavior change

- Exposes on `viewState` (the shared context passed to console modes) — `stageMove(direction)`, `onCommitStagedMoves()`, `onUndoStagedMove()`, `onClearStagedMoves()`, and a read-only `stagedPath` getter that returns a snapshot copy.
- `stageMove` is pure simulation — it walks a local 8-direction delta map + `lattice.isWalkable` / mirrored closed-corner check (matches `src/exploration/movement.js`) and refuses illegal stages, capped at `STAGE_MAX_STEPS = 24`. It never mutates `runState`, the lattice, the RNG cursor, or the fog buffer.
- `onCommitStagedMoves` snapshots the staged buffer, drains it, then iterates each step through the existing `onMove(direction)` (`moveParty` semantics unchanged — danger clock, auto-stop toggles, interrupt discovery, LOS + fog updates all preserved). The loop stops on `!result.moved` or any real interrupt (`hostile`, `hunt`, `container`, `descent`, `damage`) or if `runState.activeCombat` becomes truthy mid-loop.
- `console:intent` bus subscription now routes `move_*` actions from panes that decline the input into `stageMove` (previously `onMove`). Combat-active state still refuses.
- New keydown listener on the screen container — Escape drains any staged buffer (`onClearStagedMoves`) and calls `preventDefault`; it is a no-op when nothing is staged. Registered alongside pointer listeners and cleaned up on unmount.
- `renderExploration` invocations pass a fresh `stagedPath` copy every frame.
- Map-tap-to-stage is **not** implemented — deferred per session prompt (BFS pathing is out of scope). Pointer taps on the canvas still only drive pan; there is no cell-tap-to-stage handler.

## Data flow

Input surface (d-pad button / keyboard arrow / WASD / non-MOVE pane) → console dispatch → MOVE `handleInput` → exploration `stageMove` → path grows → `renderPlayfield()` redraws preview overlay → user presses `CONFIRM` (or Enter) → MOVE `handleInput` sees staged → exploration `onCommitStagedMoves()` → per-step `moveParty()` via existing `onMove()` (all runtime side-effects unchanged) → interrupt or exhaustion → buffer drained → normal notice cycle resumes.

<!-- clarity-and-fit SESSION-05 -->

# SESSION-05 arch delta — clarity-and-fit / equipment tells you the dice

## M18 Equipment Rules (`src/rules/equipment.js`) — public surface grows

- New export: `describeItemStats(item, { equipmentData, affixesData } = {})` → `string[]`.
  Render-time resolver used by GEAR and LOOT to render dice/range/defense chips on
  equipment cards. Runs the live inventory/equipped item through
  `resolveWeaponStats` / `resolveArmorStats` so affix effects surface as final
  values. Never throws; returns `[]` for consumables, malformed items, unknown
  `baseType`, or missing catalog data.
- Chip vocabulary is stable and mirrors `src/rules/combat.js:458-469`
  `performAttackRoll` — the only intrinsic pieces of the attack roll on the card:
  - **Weapon with damage die** → `['ATK d20<±acc>+<MGT|FIN>', 'DMG <die>[↑]',
    'RANGE <min>–<max> · <BAND>[ (MIN <min>)]']`.
    - `MGT` when `rangeBand === 'adjacent'` (matches combat.js:450 `isMelee`),
      otherwise `FIN`.
    - Accuracy chunk `+N` / `-N` is omitted when accuracy is 0 (e.g.
      `ATK d20+MGT`).
    - `↑` suffix appears iff `resolveWeaponStats.damageDie` differs from the
      catalog base — surfaces `edged` affix upgrades.
    - `MIN` suffix appears iff `minRange > 1` (sniper).
    - Combat-time bonuses (marked, blinded, flank, cover) are intentionally NOT
      on the chip; they belong to the combat log where they are already surfaced.
  - **Weapon with no damage die but positive defenseBonus** (e.g. shield) →
    `['DEF +<n>']` only.
  - **Armor** → `['DEF <±n>']`, `['FIN <±n>']` when non-zero and
    `!ignoreFinPenalty`, `['CHG <±n> MAX · <±n> REGEN']` (either part omitted
    when zero). Whole chip omitted if both charge fields are zero.
  - **Consumable / malformed / unknown** → `[]`.
- Data shape convention: `equipmentData = data.equipment` (the JSON blob root),
  `affixesData = data.affixes` (the affixes.json root). Matches the shape
  already accepted by `resolveWeaponStats`/`resolveArmorStats`.

## M56 UI Components (`src/ui/components.js`) — card contract grows

- `createEquipmentCard(item, opts?)` accepts a new optional `opts.stats: string[]`.
  When provided and non-empty, the card appends a `<div class="card-stats">`
  child containing one `<span class="stat-chip">` per string. Chip strings are
  set via `textContent` (no HTML). When `opts.stats` is missing, empty, or not
  an array, no `.card-stats` node is emitted — legacy call-sites unchanged.
- Insertion order stays: `card-name` → `card-desc` (optional) → `card-stats`
  (optional) → rarity tag (optional) → affix tags (optional). New node slots
  between the description and rarity tag.

## M64 Console Gear (`src/ui/console/gear.js`) — wired

- Every `createEquipmentCard` call on this screen (equipped weapon/armor/offhand
  rows and inventory rows) now passes `stats: describeItemStats(item,
  { equipmentData: data.equipment, affixesData: data.affixes })`. No signature
  changes to `render` or `handleInput`.

## M66 Console Loot (`src/ui/console/loot.js`) — wired

- Container-content cards now pass the same `stats: describeItemStats(...)` bag
  through to `createEquipmentCard`. Existing text-only `.loot-detail` and
  `.loot-compare` rows remain — the chip row is additive.

## Downstream consumers

- SESSION-06 (creation screen) consumes `describeItemStats` verbatim through
  the same `{ equipmentData, affixesData }` shape when it filters class-gated
  equipment options.

<!-- clarity-and-fit SESSION-04 -->

### M101 (Wide CSS) — grid-track contract shift

The wide-shell three-region grid template changes so the console-dock column absorbs surplus viewport width instead of pinning to a fixed width. New base template:

```
grid-template-columns:
  minmax(280px, var(--wide-left-w, 280px))
  minmax(320px, calc(100vh * 9 / 16))
  minmax(max(360px, var(--wide-right-w, 360px)), 1fr);
```

`justify-content: center` on `.wide-shell` centers the track group symmetrically when no track is `1fr` (i.e. any `data-pane-right="collapsed"` variant); with `1fr` in play the grid always fills the viewport-right edge (no dead gutter). The `data-pane-left="collapsed"` variant keeps `1fr` on the third column; the `data-pane-right="collapsed"` and both-collapsed variants use fixed 96px rails and rely on `justify-content: center`.

Playfield middle track stays aspect-locked at `calc(100vh * 9 / 16)` (Custom Rule 8 — descent premise is vertical).

### M100 (Layout Controller) — CSS-variable semantics shift (JS unchanged)

`--wide-left-w` unchanged: fixed telemetry-column width (280–480 px, default 280).

`--wide-right-w` — semantics widen from "console-column fixed width" to "console-column **user-chosen minimum share**" (still 360–640 px, default 360). The console column always grows past this floor to fill surplus width; the var only guarantees the dock cannot render narrower than the drag/keyboard state records. `attachWidePanes` continues to write both vars unchanged (drag, keyboard, double-click reset, persistence, and bounds pins all preserved) — no JS change was required, only the CSS grid template it feeds.

Helper var introduced in `.wide-shell`: `--wide-middle-w` computes the actual rendered middle-track width `min(calc(100vh * 9 / 16), max(320px, calc(100vw - <effective-left> - max(360px, --wide-right-w))))`. The right resize handle repositions to `right: calc(100vw - --wide-left-effective - --wide-middle-w - 4px)` so it tracks the actual playfield/console-dock boundary, which is no longer `--wide-right-w` from the viewport-right.

<!-- clarity-and-fit SESSION-07 -->

### clarity-and-fit SESSION-07 — Interaction Affordance Grammar + Token Contrast

**M56 — UI Components (grown factory contract)**
- `createButton`, `createSlider`, `createToggle` — always tag their primary interactive DOM node with `is-interactive`. Button → the `<button>`. Slider → the `input[type="range"]`. Toggle → the visual `.toggle` span (input stays hidden; the visual also mirrors `aria-disabled="true"` from the input when `opts.disabled`).
- `createEquipmentCard`, `createProtocolCard` — tag with `is-interactive` **only** when `opts.onClick` is provided (the `<button>` variant). The static `<article>` variant omits it — static article cards must not read as clickable.
- `applyControlState` — when `opts.disabled` it now sets both `element.disabled = true` and `element.setAttribute('aria-disabled', 'true')`. Uniform disabled semantics: the affordance grammar's `[disabled], [aria-disabled="true"]` selector matches native form controls and non-form elements alike.

**M77 — Base CSS (contrast-raised palette tokens)**
- `--border-dim` `#2a1a4a` → `#453370` (measured 1.78:1 non-text on `--bg-panel` — panel edges perceptible)
- `--text-secondary` `#8a7aa8` → `#a89ac6` (measured 7.36:1 text on `--bg-panel`)
- `--text-dim` `#5a4a78` → `#8878a8` (measured 4.82:1 text on `--bg-panel`)
- Pinned `--accent #7ec8e3` and `--bg-base #0a0612` unchanged. `specs/design.md` color palette table + all 28 mock `:root` blocks synced to the new canonical values (`check-mock-tokens` clean).

**M79 — Components CSS (affordance grammar + reconciled hovers)**
- New `.is-interactive` grammar defined near the top of `styles/components.css`: rest border `1px solid var(--interactive-border)` + `cursor: pointer`; hover (excluding disabled) sets `border-color: var(--accent)` and a color-mixed accent glow; `:focus-visible` gives a 2px accent outline; active adds `translateY(1px)`; `[disabled]` / `[aria-disabled="true"]` gives `opacity: 0.45`, `cursor: not-allowed`, dashed border.
- `--interactive-border: #5a89a0` (measured 5.02:1 non-text on `--bg-panel`) is declared **inside** the `.is-interactive` selector, not in `styles/base.css :root` — CSS custom-property inheritance carries it into descendants without exposing it to the design-tokens palette scanner (which only reads `styles/base.css`).
- Superseded ad-hoc rules removed: `.item-card:hover`, `.item-card { cursor: pointer }`, `.action-btn:hover`, `.action-btn { cursor: pointer }`. Component-specific state styling kept: `.item-card.equipped`, `.item-card.corrupt`, `.action-btn.selected`, `.action-btn.danger`, `.mode-tab.active`, all `.selected` / `.active` variants.

**M81 — Service Worker**
- `CACHE_VERSION` bumped `2026-08-16-clarity-and-fit-v1` → `2026-08-16-clarity-and-fit-v2` (feature-final; ships SESSIONS 02–07's `src/` and `styles/` deltas to offline clients).

**Design contract addition (specs/design.md, new subsection under "Shadow / Glow System" and before "Derived Surface Tokens")**
- "### Interaction Affordance" — grammar table (rest/hover/focus/active/disabled rules), factory list, `--interactive-border` scoping rationale. Rule: **interactive ⇔ `.is-interactive`**; factories own application, screens must never per-style hovers.

<!-- walls-npc-docks SESSION-01 -->
### M58 Playfield — thick outside walls, interior-only ticks, pulse loop (SESSION-01, walls-npc-docks)

Public API grew by `setPulse(enabled)`, `destroy()`, and helper `wallThickness(size)`
plus the pulse-timing constants `WALL_PULSE_PERIOD_MS = 2400`, `WALL_PULSE_FPS = 30`,
`WALL_GLOW_BLUR = [4, 12]`, `WALL_GLOW_ALPHA = [0.7, 1]` (all exported from
`src/ui/playfield.js`). `wallThickness = max(3, round(size/8))` → 3px @ 24px
exploration cells, 6px @ 48px combat cells. Wall lines now paint OUTSIDE the
traversable square along the wall side of each shared edge with 4×`t`×`t` corner
joints so adjacent walls read as a continuous run; `-|-` intersection ticks fire
only when ALL FOUR touching cells are revealed traversable floor (never poke
across a wall boundary). `createPlayfield` retains its cached last-render
(`{kind, args}`) and runs a `requestAnimationFrame` loop throttled to ~30 fps
while `enabled && lastRender`, replaying the cached render with a fresh glow
level (`0.5 + 0.5 * sin(2π t / PERIOD)` for blur/alpha lerp between the two
range constants); `setPulse(false)` — or `destroy()` — cancels the pending frame
and holds walls at the static midpoint `g = 0.7`. Screens (M70/M71) resolve
`loadSettings().reducedMotion` via runtime.js semantics (`'reduce'` OR `'system'`
+ `prefers-reduced-motion: reduce`) into `setPulse(!reduce)` after
`createPlayfield`, and call `playfield.destroy()` in their unmount cleanup.

<!-- walls-npc-docks SESSION-02 -->
### M24 Combat Rules — public helper `pathToward` (SESSION-02, walls-npc-docks)

`pathToward(combatState, actor, targetId, maxSteps, desiredRange)` — greedy geometric
path builder used by `executeMove`'s `targetId` fallback and available to any external
caller that needs a legal step sequence toward a combatant. Consumes no RNG (determinism
preserved). Returns an ordered array of direction names (length 1..maxSteps) or `null`
when no forward progress is possible from the origin (already within `desiredRange`,
blocked, or missing target/actor position).

### M23 Enemies Rules — `enemyAI` move action carries `desiredRange`

Every move action returned by `enemyAI` now includes `desiredRange: OPTIMAL_RANGE[behavior]`
(fallback 1). Combined with `MOVE_RANGE = 5` in M24, NPCs — including echoes, hunts, and
threshold elites, which all route through the same `resolveTurn` → `enemyAI` → `executeAction`
fallback — traverse up to 5 legal cells per move action instead of a single step. Panicked
flee stays single-step. Display semantics ("1 MV" = one move ACTION) are unchanged.
