# Build Plan — Operator's Descent

## Overview

The build is broken into sessions (phases), each sized to be completable in one working session that leaves the project in a compiling, self-consistent state. Phases are in strict dependency order: each builds on what the prior session produced. Within each phase, tasks are ordered so the project compiles at the end of every task — no dangling imports, no half-written modules.

The module structure follows `specs/architecture.md` exactly. Data files are authored content (from DB's schema), not code — they are included as a phase because the code depends on them.

---

## Phase 1: Scaffolding & Configuration

**Goal:** A working static-site shell with portrait letterboxing, CSS token system, CRT overlay structure, service worker registration, and the entry point that loads data files. The app loads, shows a blank portrait frame with CRT effects, and compiles. No game logic.

- [ ] Create `index.html` — portrait frame container, `<script type="module" src="src/main.js">`, `<link>` to all three CSS files, `@font-face` for `DESCENT SIGIL` WOFF2 (`assets/descent-sigil.woff2`), viewport meta, title.
- [ ] Create `styles/base.css` — CSS custom properties (palette tokens from `specs/design.md`), typography scale, spacing system, portrait letterboxing (1080×1920 aspect, centered, black surround), `.glow` / `.glow-strong` / `.glow-danger` / `.accent-text` / `.ornament` / `.panel` / `.panel-elevated` / `.btn-crt` / `.btn-primary` / `.sigil-mini` / `.bar-track` / `.bar-fill` / `.scroll-area` utility classes.
- [ ] Create `styles/crt.css` — All always-on CSS CRT layers: `.crt-scanlines` (1px/2px, 10% white, 4s drift), `.crt-grille` (3px RGB triad, screen blend 15%), `.crt-vignette` (radial gradient, 4s pulse 0.65↔0.92), `.crt-tracking` (28% vh, 7s loop), `.crt-grain` (radial-gradient dot-scatter, 1s steps(4) re-scatter), `.crt-border` (inset box-shadow, 0.8s steps(1) flicker), `.crt-flash` (magenta 5%, 3.2s steps(1)). Per-element text glitch classes: `[data-glitch]`, `.text-swapping`, `::before`/`::after` chromatic ghosts. Glitch bar / noise line / VHS event container classes.
- [ ] Create `styles/components.css` — Console shell (`.console-bar`, `.mode-tab`, `.mode-tab.active`, `.mode-tab.disabled`), status strip (`.status-strip`, `.theme-badge`), D-pad (`.dpad`, `.dpad-btn`, `.dpad-center`), initiative rail (`.init-rail`, `.init-slot`, `.init-sigil`), combat grid (`.combat-grid`, `.grid-cell`, `.token`, `.token-player`, `.token-enemy`), item cards (`.item-card`, `.rarity-tag`, `.affix-tag`), condition tags (`.cond-tag`), sliders (`.slider-row`, `input[type=range]` styling), toggles (`.toggle`, `.toggle-knob`), attribute rows, deck slots, run rows (`.run-row`, `.accent-swatch`), link input, share link, log entries (`.log-entry`), tutorial page dots, class cards, character slots, member pills.
- [ ] Create `src/main.js` — Entry point: registers `service-worker.js` (async, non-blocking), fetches all `data/*.json` in parallel (`Promise.all`), caches data in a module-level `gameData` object, loads settings from `localStorage` via `state/library.js`, mounts title screen (`ui/screens/title.js`). Exports `gameData` for other modules. Has a screen router function `mountScreen(name, params)` that unmounts the current screen and mounts the new one.
- [ ] Create `service-worker.js` — Cache-first strategy. On install, caches the known asset manifest (index.html, all JS modules, all CSS, WOFF2 font, all data/*.json). On fetch, serves from cache, falls back to network. Cache versioning via a `CACHE_VERSION` constant.
- [ ] Create `src/state/bus.js` — Lightweight event bus: `bus.on(event, handler) → unsubscribe`, `bus.dispatch(event, payload) → void`. Pure in-memory, zero dependencies.

**Exit criteria:** Browser loads `index.html`, sees a portrait frame with CRT CSS overlays. `main.js` runs, registers service worker, fetches data files, and calls `mountScreen('title')` (which will fail gracefully since title.js doesn't exist yet — log an error, don't crash). All CSS classes are defined and unused. No build step. No errors in console except the missing-module warning.

---

## Phase 2: Core (PRNG, Hash, RNG Cursor) + Data Files

**Goal:** All pure-logic core modules and all static JSON data files. No UI, no state, no rules. The foundation that everything else depends on.

- [ ] Create `src/core/prng.js` — `createPRNG(seed)`, `PRNG.next() → [0,1)`, `PRNG.nextInt(max)`, `PRNG.getState() → {a,b,c,d}`, `PRNG.setState(state)`, `PRNG.hash(...args) → uint32`. xorshift128+ algorithm. Zero dependencies.
- [ ] Create `src/core/hash.js` — `hash(...values: number[]) → number`. FNV-1a-based, produces uint32. Uses `Math.imul`, `>>> 0`. Zero dependencies.
- [ ] Create `src/core/rng-cursor.js` — `createRNGCursor(genPRNG, combatPRNG)`, `RNGCursor.next(stream)`, `RNGCursor.nextInt(stream, max)`, `RNGCursor.getCursor(stream)`, `RNGCursor.syncTo(stream, cursor, prngState)`, `RNGCursor.getState()`. Depends on `core/prng.js`.
- [ ] Create `data/sigils.json` — 48 player codepoints (6 families × 8), 24 bestiary codepoints (8 archetypes × 3), safe substitution pool (Latin, digits, box-drawing). Per `specs/database.md` schema.
- [ ] Create `data/themes.json` — 12 environment themes with id, name, accentColor, archetypeWeights, modifierWeights, enemyMixWeights, lootBias, audioMode. Per `specs/database.md` schema and FR-25 color table.
- [ ] Create `data/classes.json` — 6 class definitions (breacher, ghost, compiler, anchor, oracle, operator) with hitDieBase, chargeBase, signature (id, name, tiers), equipmentGates, protocolGates, sigilFamily, calibrationOptions. Per FR-45.
- [ ] Create `data/protocols.json` — 20 protocols (4 schools × 5 tiers) with name, chargeCost (tier×2), range, effect, effectData. Per FR-47.
- [ ] Create `data/enemies.json` — 8 archetype stat blocks (drone, warden, stalker, choir, null, construct, phantom, apex) with attributes, hpBonus, armored, behavior, protocolAccess, retreats, sigilCodepoints. Per FR-43.
- [ ] Create `data/equipment.json` — Weapon categories (8), armor categories (4), with damageDie, rangeBand, accuracyBonus, classGates, creationCost, slot, defenseBonus, finPenalty, salvageValue. Per FR-42.
- [ ] Create `data/affixes.json` — 16 affix definitions (4 universal, 8 weapon-only, 4 armor-only) with name, category, class (minor/major), effect, effectData. Per FR-48.
- [ ] Create `data/conditions.json` — 9 condition definitions with name, effect, duration, saveAttribute, stackable, effectData. Per FR-44.
- [ ] Create `data/consumables.json` — 7 consumable types with name, effect, effectData, minDepth, combatOnly, salvageValue. Per FR-49.
- [ ] Create `data/symbol-table.json` — Field-level lookup tables (~500 entries) for save encoding. Per `specs/database.md` schema. class (6), sigil (60), attribute (16×6), hp (80), charge (80), conditions (50), item_id (200), equipment (100), calamity_count (32), sigil_tier (8), inventory_default (8).
- [ ] Create `assets/descent-sigil.woff2` — Placeholder: an empty or minimal WOFF2 file (the real typeface is a named deliverable authored separately; placeholder ensures `@font-face` doesn't 404). Tagged for replacement.

**Exit criteria:** All `data/*.json` files are valid JSON and parseable. `core/prng.js`, `core/hash.js`, `core/rng-cursor.js` are importable and have no syntax errors. No other module imports them yet. Project still loads and shows the CRT frame.

---

## Phase 3: Rules Engine (Pure Game Logic)

**Goal:** The complete game rules engine — attributes, classes, combat, conditions, protocols, loot, enemies, equipment, consumables, inventory, scaling. All pure functions, no I/O, no DOM. Each module imports `core/` and `data/` only.

- [ ] Create `src/rules/attributes.js` — `modifier(rank)`, `deriveStats(character, classData) → DerivedStats` (HP, CHARGE, Defense, Protocol Defense, initiative, accuracy, detection radius, overclock threshold), `attributeCost(currentRank, targetRank)`. Per FR-37.
- [ ] Create `src/rules/scaling.js` — `enemyStatScale(baseStat, depth)`, `enemyCountScale(baseCount, depth)`, `lootRarityShift(depth)`, `dangerClockBaseRate(depth)`, `corruptionDangerRate(corruption)`, `calibrationFloor(depth)`, `thresholdFloor(depth)`. Per FR-40. Zero dependencies (pure math).
- [ ] Create `src/rules/classes.js` — Class signature logic, gating (equipment/protocol), calibration option selection (deterministic from seed + characterId + floorNumber), signature tier progression (auto at cal 2 and cal 4). Depends on `data/classes.json`.
- [ ] Create `src/rules/equipment.js` — Weapon/armor stats resolution from base category + affixes, range band logic, cover determination, FIN penalty application, salvage value lookup. Depends on `data/equipment.json`, `data/affixes.json`.
- [ ] Create `src/rules/conditions.js` — `applyCondition(target, conditionId, source, rngCursor)`, `tickConditions(target)`, `clearAllConditions(target)`, SHIELDED consumption logic, BURNING stacking. Depends on `data/conditions.json`, `rules/attributes.js`.
- [ ] Create `src/rules/protocols.js` — `castProtocol(caster, protocolId, tier, target, rngCursor)`, `overclockProtocol(...)`, `protocolChargeCost(tier, overclocked)`, `deckSlotCost(tier)`, `deckSlotCapacity(classChargeBase)`. Effect resolution (damage, heal, condition application, area). Depends on `data/protocols.json`, `rules/attributes.js`, `rules/conditions.js`.
- [ ] Create `src/rules/consumables.js` — Consumable effect application, stacking, usage rules, combat-only enforcement. Depends on `data/consumables.json`.
- [ ] Create `src/rules/loot.js` — `generateLoot(worldSeed, depth, floorId, containerId, themeLootBias) → Item[]`. Rarity rolls, affix selection, CORRUPT handling, item generation. Depends on `core/hash.js`, `core/prng.js`, `data/affixes.json`, `data/equipment.json`, `data/consumables.json`, `rules/scaling.js`.
- [ ] Create `src/rules/enemies.js` — `createEnemy(archetypeId, depth, rngCursor)`, `scaleEnemyStat(baseStat, depth)`, `enemyAI(enemy, combatState, rngCursor) → Action`, `createEcho(deadCharacter, echoDepth)`. Depends on `core/prng.js`, `data/enemies.json`, `rules/scaling.js`, `rules/attributes.js`.
- [ ] Create `src/rules/combat.js` — `initiateCombat(party, enemies, rngCursor) → CombatState`, `executeAction(combatState, action, rngCursor) → ActionResult`, `resolveTurn(combatState, rngCursor) → TurnResult`, `checkCombatEnd(combatState)`. d20 resolution, initiative, AP economy, cover, flanking, opportunity attacks, natural 1/20, retreat, victory/wipe. Depends on `core/prng.js`, `rules/attributes.js`, `rules/conditions.js`, `rules/equipment.js`, `rules/enemies.js`, `rules/protocols.js`.
- [ ] Create `src/rules/inventory.js` — `INVENTORY_CAP`, `addItem(...)`, `removeItem(...)`, `toggleJunkTag(...)`, `junkAllTagged(...)`, `getSalvageValue(...)`, `getInventoryCount(...)`. Depends on `data/equipment.json`, `data/consumables.json`.

**Exit criteria:** All `rules/*.js` modules importable. No syntax errors. They are not yet wired to anything. A developer could open a browser console, import a rules module, and call its functions with test data. The project still loads and shows the CRT frame.

---

## Phase 4: Floor Generation + Exploration Logic

**Goal:** Procedural floor generation, validation, the 20×32 lattice model, shadowcast LOS, and movement. All pure logic (no DOM), but they depend on `core/`, `data/`, and `rules/`.

- [ ] Create `src/floor/archetypes.js` — 8 generation algorithms (chambers, caves, mazes, cathedrals, spines, fractured, rings, shards). Each takes a PRNG and returns a 20×32 grid of cell types. Depends on `core/prng.js`.
- [ ] Create `src/floor/modifiers.js` — Modifier pool application (0–2 modifiers per floor). Takes a grid + PRNG, returns modified grid. Depends on `core/prng.js`, `data/themes.json` (modifierWeights).
- [ ] Create `src/floor/validator.js` — `validateFloor(floor) → { valid, failures[] }`. Six checks: connectivity, loop-density, interior-cover, descent-reachability, container-accessibility, open-cell-bounds. Depends on nothing but the Floor type (pure graph/geometry algorithms).
- [ ] Create `src/floor/generator.js` — `generateFloor(worldSeed, floorNumber, rngCursor, themesData) → Floor`. Orchestrates: derive sub-seed, select archetype/modifiers/theme via weighted draws, generate grid, validate, regenerate on failure with incremented sub-seed. Places containers, enemy spawns, descent point. Depends on `core/prng.js`, `core/rng-cursor.js`, `core/hash.js`, `floor/archetypes.js`, `floor/modifiers.js`, `floor/validator.js`, `data/themes.json`.
- [ ] Create `src/exploration/lattice.js` — `createLattice(floor) → Lattice`, `Lattice.getCell(x,y)`, `Lattice.isWalkable(x,y)`, `Lattice.setPartyPosition(x,y)`, `Lattice.getPartyPosition()`. Depends on `floor/generator.js` (Floor type).
- [ ] Create `src/exploration/shadowcast.js` — `computeLOS(lattice, originX, originY, radius) → Set<{x,y}>`, `updateFogOfWar(fogState, visibleCells)`. Depends on `exploration/lattice.js`.
- [ ] Create `src/exploration/movement.js` — `moveParty(lattice, fogState, direction, rngCursor, runState) → MoveResult`, `tickDangerClock(runState, stepCount)`. 8-way movement with corner rule, auto-stop interrupts (hostile in LOS, container/descent/feature discovery, damage), danger clock advancement. Depends on `exploration/lattice.js`, `exploration/shadowcast.js`, `state/run-state.js`, `core/rng-cursor.js`, `rules/enemies.js`.

**Exit criteria:** All `floor/` and `exploration/` modules importable. `generateFloor` can be called with a seed and produce a validated Floor. `movement.js` depends on `state/run-state.js` which doesn't exist yet — this is the one forward dependency. To keep the project compiling, `movement.js` will use a dynamic import or a passed-in `runState` interface (duck-typed) so it compiles without the state module. Alternatively, create a minimal stub of `state/run-state.js` in this phase if it's cleaner. **Decision: create a minimal `state/run-state.js` stub now (see Phase 5 for the full implementation) so `movement.js` compiles.**

- [ ] Create `src/state/run-state.js` (stub) — Minimal exports so `movement.js` compiles: `createRunState()`, `RunState.advanceFloor()`, `RunState.markCellVisited()`, `RunState.markContainerOpened()`, `RunState.markEnemyDefeated()`, `RunState.addCorruption()`, `RunState.getDangerClockRate()`, `RunState.serialize()`, `RunState.deserialize()`. Returns placeholder objects. Will be fully implemented in Phase 5.

**Exit criteria:** `floor/generator.js` produces valid floors. `movement.js` imports and compiles. The stub `run-state.js` is importable but non-functional. Project still loads.

---

## Phase 5: State Management (Full)

**Goal:** The complete state layer — run state (full implementation replacing the stub), save encoding pipeline (condense → compress → encrypt → base64url), localStorage CRUD for runs/settings/flags, and saved party configurations.

- [ ] Replace `src/state/run-state.js` (stub) with full implementation — `createRunState(worldSeed, party)`, `RunState.serialize()`, `RunState.deserialize(data)`, `RunState.advanceFloor()`, `RunState.addCorruption()`, `RunState.queueEcho()`, `RunState.getDangerClockRate()`, `RunState.markContainerOpened()`, `RunState.markEnemyDefeated()`, `RunState.markCellVisited()`, `RunState.addScrap()`, `RunState.getInventoryCount()`, `RunState.isInventoryFull()`. Contains ONLY the diff + persistent state per `specs/database.md`. Depends on `state/bus.js`, `core/rng-cursor.js`.
- [ ] Create `src/state/condense.js` — `condense(runState) → { data: Uint8Array, tableVersion }`, `expand(data, tableVersion) → RunState`. Field-level lookup table condensation using `data/symbol-table.json` + FNV-1a hash from `core/hash.js`. Depends on `data/symbol-table.json`, `core/hash.js`, `state/run-state.js`.
- [ ] Create `src/state/compress/pass-1bit.js` — `compress(data) → { data, dict } | null`, `decompress(data, dict)`. Bit-level RLE + pattern dictionary.
- [ ] Create `src/state/compress/pass-4bit.js` — Nibble frequency dictionary (top-16 → 4-bit codes).
- [ ] Create `src/state/compress/pass-8bit.js` — Native `CompressionStream('deflate')` / `DecompressionStream('inflate')`.
- [ ] Create `src/state/compress/pass-16bit.js` — Word frequency dictionary (top-16 → 1-byte codes).
- [ ] Create `src/state/compress/pass-32bit.js` — Dword frequency dictionary (top-8 → 1-byte codes).
- [ ] Create `src/state/compress/progressive.js` — `compress(data, budgetCheck) → { data, layers }`, `decompress(data, layers)`. Tries passes at 1/4/8/16/32-bit granularity, checks budget after each, records layers. Depends on all five pass modules.
- [ ] Create `src/state/encrypt.js` — `encrypt(data, versionByte)`, `decrypt(data, versionByte)`. XOR stream cipher using xorshift128+ keystream. Depends on `core/prng.js`.
- [ ] Create `src/state/save-encode.js` — `encodeRun(runState) → string` (< 1500 chars), `encodeSeed(worldSeed) → string`. Full pipeline: serialize → condense → compress → encrypt → base64url. Header (version byte, layer count, layer descriptors), CRC32 checksum. Depends on `state/run-state.js`, `state/condense.js`, `state/compress/progressive.js`, `state/encrypt.js`.
- [ ] Create `src/state/save-decode.js` — `decodeRun(fragment) → { success, runState?, error? }`, `decodeSeed(fragment) → { success, seed?, error? }`. Reverse pipeline: base64url decode → validate (length, CRC32, version) → decrypt → decompress (reverse layers) → expand → deserialize. Named error types: `truncated`, `version_mismatch`, `checksum_failed`, `malformed`. Depends on `state/save-encode.js`, `state/condense.js`, `state/compress/progressive.js`, `state/encrypt.js`, `state/run-state.js`.
- [ ] Create `src/state/library.js` — `saveRun(runState)`, `loadRun(key)`, `listRuns() → LibraryEntry[]`, `deleteRunState(key)`, `getSeed(key)`, `saveSettings(settings)`, `loadSettings() → Settings`, `getFlag(key)`, `setFlag(key, value)`. localStorage CRUD with defensive validation. Depends on `state/run-state.js`, `state/save-encode.js`.
- [ ] Create `src/state/party-configs.js` — `saveConfig(name, blueprint)`, `loadConfig(name)`, `listConfigs() → ConfigEntry[]`, `deleteConfig(name)`, `getLastUsed()`, `setLastUsed(blueprint)`, `validateConfig(blueprint, gameData)`. localStorage CRUD for party blueprints (max 10). Depends on `data/classes.json`, `data/equipment.json`, `data/protocols.json` (for validation only, passed in by caller).

**Exit criteria:** The full save pipeline works: create a RunState → encode → get a string < 1500 chars → decode → get back the same RunState. localStorage CRUD works. `main.js` can now load settings properly. No UI yet.

---

## Phase 6: Audio Engine (WebAudio 5-Layer Synthesis)

**Goal:** The complete audio system — engine + 5 layers. No audio files. All WebAudio synthesis. Responds to game state pushes but doesn't depend on UI.

- [ ] Create `src/audio/drone.js` — `createDrone(audioContext, destination) → DroneController`. Theme timbre/modal set, depth detune. `updateState(state)`, `setVolume(v)`, `start()`, `stop()`. Depends on `data/themes.json` (audioMode), `core/hash.js`.
- [ ] Create `src/audio/pulse.js` — `createPulse(audioContext, destination)`. Hostile proximity → tempo/density/dissonance. Same interface.
- [ ] Create `src/audio/sparkle.js` — `createSparkle(audioContext, destination)`. Container proximity → arpeggio density/cutoff. Same interface.
- [ ] Create `src/audio/lead.js` — `createLead(audioContext, destination)`. Bar-by-bar melody from `hash(worldSeed, depth, floorId, barIndex)`, no-repeat ledger with perturb-and-regenerate. Depends on `core/hash.js`.
- [ ] Create `src/audio/noise-bed.js` — `createNoiseBed(audioContext, destination)`. Fixed tape hiss/wow/flutter. Tracks nothing. Same interface.
- [ ] Create `src/audio/engine.js` — `createAudioEngine() → AudioEngine`. `start()` (resumes AudioContext — called from START gesture), `setLayerVolume(layer, volume)`, `setMasterVolume(volume)`, `setMute(muted)`, `updateState(gameState)` (pushes to all layers). Coordinates the 5 layers. Depends on all 5 layer modules.

**Exit criteria:** `createAudioEngine()` returns a working engine. `start()` resumes the AudioContext (requires user gesture — will be called from title screen START). Layers can be started/stopped independently. No DOM dependency.

---

## Phase 7: Glitch System (JS-Driven Effects)

**Goal:** The CRT/VHS glitch system's JS-driven components (CSS layers are already in `styles/crt.css` from Phase 1). Timer system, grain canvas, authored transitions.

- [ ] Create `src/glitch/glitch.js` — `createGlitchSystem() → GlitchSystem`. `registerElement(element, intensity)`, `start()`, `stop()`, `setEnabled(enabled)`. Per-element text substitution (700–1799ms heartbeat, per-element intensity gate, 120–349ms swap from safe pool), chromatic ghosts, glitch bars (350–999ms, 40% fire, 80–249ms), noise lines (1200–3499ms, 30% fire, 80–299ms), VHS events (4000–9999ms, 80–249ms), element jitter (500–1399ms, 30% fire, 70–199ms), border flicker (400–1099ms, 35% fire, 40–159ms), frame flash (1800–4499ms, 12% fire, 30–89ms). Respects `prefers-reduced-motion` + manual settings toggle. Depends on `data/sigils.json` (safe substitution pool).
- [ ] Create `src/glitch/grain.js` — `createGrain(canvas) → GrainController`. Canvas dot-scatter: 10px grid, ~15% fill, 2×2px dots, re-scatter once per second via `setInterval` + canvas redraw. `start()`, `stop()`, `setEnabled(bool)`.
- [ ] Create `src/glitch/transitions.js` — `playBootSequence(container) → Promise<void>`, `playDescentSequence(container) → Promise<void>`, `playDeathSequence(container, character) → Promise<void>`. Authored set-piece animations with fixed timelines. Disabled by reduced-motion (replaced with static fade). Depends on `glitch/glitch.js` (for reduced-motion check).

**Exit criteria:** Glitch system can be started on the portrait frame. Grain canvas renders and re-scatters. Transitions can be called and return promises. All effects respect the enabled/disabled toggle.

---

## Phase 8: UI Foundation (Components, Input, Playfield, Status Strip)

**Goal:** The shared UI infrastructure that all screens and console modes depend on. Components library, unified input handler, canvas playfield renderer, and the status strip.

- [ ] Create `src/ui/components.js` — Shared UI factory functions: `createButton(label, opts)`, `createSlider(label, value, onChange)`, `createToggle(label, value, onChange)`, `createSigilToken(codepoint, size)`, `createHPBar(current, max)`, `createChargeBar(current, max)`, `createRarityTag(rarity)`, `createAffixTag(affix, isMajor)`, `createConditionTag(conditionId, duration)`, `createEquipmentCard(item, opts)`, `createProtocolCard(protocol, opts)`, `createAttributeRow(attrName, rank, opts)`, `createPanel(opts)`, `createScrollArea()`. All return DOM elements. Uses CSS classes from `styles/components.css` and `styles/base.css`.
- [ ] Create `src/ui/input.js` — `createInputHandler() → InputHandler`. `onAction(callback)`, `bindToElement(el)`. Maps keyboard (arrows/numpad/WASD for movement, 1–7 for mode tabs, Tab for cycling, Enter for confirm, Escape for collapse) and touch events to semantic actions (`move-north`, `move-southeast`, `confirm`, `cancel`, `tab-next`, `tab-prev`, `mode-1` through `mode-7`, `collapse`). Guarantees keyboard/touch parity.
- [ ] Create `src/ui/playfield.js` — `createPlayfield(canvas) → Playfield`. `renderExploration(lattice, fogState, partyPos)`, `renderCombat(combatState, lattice, zoomOrigin)`, `setAccent(color)`. Canvas 2D rendering of the 20×32 lattice (exploration) with fog-of-war per-cell, and 8×16 zoomed grid (combat) with targeting overlays, range bands, initiative highlighting. Auto-pans to keep active actor visible. Depends on `exploration/lattice.js`, `exploration/shadowcast.js`, `data/sigils.json`.
- [ ] Create `src/ui/status-strip.js` — `createStatusBar(runState, combatState?)` returning a DOM element. Exploration variant: depth, seed, party sigils with mini HP bars, danger clock (numeric). Combat variant: depth, round number, initiative rail preview, active character sigil + HP/CHARGE. Updates on bus events. Depends on `state/bus.js`, `state/run-state.js`, `data/sigils.json`, `ui/components.js`.

**Exit criteria:** Components, input handler, playfield canvas, and status strip all importable. A developer could create a playfield, feed it a lattice + fog state, and see the rendered grid on the canvas. Input handler maps keys to semantic actions. No screens wired yet.

---

## Phase 9: Console (Shell + 7 Modes)

**Goal:** The single console — its shell (tab bar, expand/collapse, mode switching, input routing) and all 7 mode modules. This is the game's primary interaction surface.

- [ ] Create `src/ui/console/console.js` — `createConsole(state) → ConsoleController`. Tab bar with 7 mode buttons (MOVE, CMBT, PARTY, GEAR, TECH, LOOT, LOG), expand/collapse, keyboard shortcut routing (keys 1–7), input delegation to active mode module. `setMode(modeId)`, `expand()`, `collapse()`, `render()`. Depends on all 7 mode modules, `ui/input.js`, `state/bus.js`.
- [ ] Create `src/ui/console/move.js` — `render(container, context)`, `handleInput(event, context)`. D-pad (8-way), auto-stop indicators, WAIT button. Matches `mocks/exploration.html` MOVE mode layout. Depends on `ui/components.js`, `state/bus.js`.
- [ ] Create `src/ui/console/combat.js` — Action list (Attack, Cast, Item, Retreat), target selection (tap-to-select + confirm on touch, Tab/arrow + Enter on keyboard), range/cover display, active character HP/CHARGE/conditions/AP. Matches `mocks/combat.html` COMBAT mode layout. Depends on `ui/components.js`, `state/bus.js`, `rules/combat.js`.
- [ ] Create `src/ui/console/party.js` — Party member list with sigils, member selection, detail panel (attributes, HP, CHARGE, conditions, derived stats, combat status, corruption, credits). Matches `mocks/console-party.html`. Depends on `ui/components.js`, `state/bus.js`, `rules/attributes.js`.
- [ ] Create `src/ui/console/gear.js` — Character selector, equipped items (weapon/armor/offhand), inventory list with equip/unequip, CORRUPT warnings, junk tag toggle, scrap counter, "Junk All Tagged" action with confirmation, inventory cap display (x/100), consumables list. Matches `mocks/console-gear.html`. Depends on `ui/components.js`, `state/bus.js`, `rules/inventory.js`, `rules/equipment.js`.
- [ ] Create `src/ui/console/tech.js` — Character selector, CHARGE pool display, deck slots, protocol deck with cast/overclock buttons, overclock system info, available protocols (gated display). Matches `mocks/console-tech.html`. Depends on `ui/components.js`, `state/bus.js`, `rules/protocols.js`.
- [ ] Create `src/ui/console/loot.js` — Container header, item cards (stats, rarity, affixes, CORRUPT warnings), TAKE / TAKE ALL / DETAILS buttons, inventory-full warning. Matches `mocks/console-loot.html`. Depends on `ui/components.js`, `state/bus.js`, `rules/inventory.js`, `rules/loot.js`.
- [ ] Create `src/ui/console/log.js` — Scrolling event log with timestamped entries (combat, discovery, damage, death, heal, info, move), copy-link action with clipboard write + visual feedback ("LINK COPIED"). Matches `mocks/console-log.html`. Depends on `ui/components.js`, `state/bus.js`, `state/save-encode.js`.

**Exit criteria:** The console shell renders a tab bar with 7 modes. Switching modes renders the correct mode content. All modes compile and can render placeholder content. The console can expand and collapse.

---

## Phase 10: Screens (Title, Creation, Exploration, Combat)

**Goal:** The primary gameplay screens — title, character creation, floor exploration, and combat. These are the main loop screens.

- [ ] Create `src/ui/screens/title.js` — `mount(container, params) → ScreenController`. Title display with chromatic ghost glitch, START button (reveals branch buttons: Begin New Run, Run Library, Import Link, Tutorial, Settings). START triggers audio engine start (user gesture). First-time tutorial offer (checks `library.getFlag('tutorialDeclined')`). Matches `mocks/title.html`. Depends on `state/library.js`, `audio/engine.js`, `glitch/glitch.js`, `ui/components.js`, `ui/input.js`.
- [ ] Create `src/ui/screens/creation.js` — `mount(container, params) → ScreenController` where `params` optionally includes `{ preloadedSeed? }`. 80-point buy: character slots (1–4, 5pt chassis each), class selection (6 class cards), sigil selection (8 per class family, free), attribute steppers (6 attrs, 1–10 scale, cost scaling), equipment purchase (class-gated lists), protocol purchase (class-gated schools/tiers), live readout (points remaining, credits, AP/round), saved configurations row (FR-51: list, load, save, delete, last-used default). Finalize → create RunState + setLastUsed + generate floor 1 + play boot sequence → mount exploration. Matches `mocks/creation.html`. Depends on `rules/attributes.js`, `rules/classes.js`, `rules/equipment.js`, `rules/protocols.js`, `state/run-state.js`, `state/party-configs.js`, `state/library.js`, `floor/generator.js`, `glitch/transitions.js`, `ui/components.js`, `ui/input.js`.
- [ ] Create `src/ui/screens/exploration.js` — `mount(container, params) → ScreenController` where `params` includes `{ runState, floor }`. Status strip (exploration variant), playfield (20×32 lattice + fog of war + party token), console (MOVE mode active, other modes accessible). Movement via console → `exploration/movement.js` → fog update → playfield re-render. Auto-stop interrupts: hostile in LOS → dispatch `state:combat-start` → main.js mounts combat screen; container/descent/feature discovered → halt + indicator; damage → halt + indicator. Danger clock ticking. Autosave on floor transition (descent point). Matches `mocks/exploration.html`. Depends on `ui/status-strip.js`, `ui/playfield.js`, `ui/console/console.js`, `exploration/lattice.js`, `exploration/shadowcast.js`, `exploration/movement.js`, `state/run-state.js`, `state/bus.js`, `state/library.js`, `audio/engine.js`, `ui/input.js`.
- [ ] Create `src/ui/screens/combat.js` — `mount(container, params) → ScreenController` where `params` includes `{ runState, floor, combatState }`. Status strip (combat variant: depth, round, initiative preview, active character HP/CHARGE), combat playfield (8×16 zoomed grid with targeting overlay, range bands, initiative highlighting), console (COMBAT mode active). Initiative rail. Turn resolution: player issues actions via COMBAT mode → `rules/combat.js` resolves → log entries generated → playfield re-renders. Enemy AI turns. Combat end: victory → return to exploration; wipe → dispatch `state:party-wipe` → mount scorecard. Matches `mocks/combat.html`. Depends on `ui/status-strip.js`, `ui/playfield.js`, `ui/console/console.js`, `rules/combat.js`, `rules/enemies.js`, `rules/conditions.js`, `state/run-state.js`, `state/bus.js`, `state/library.js`, `ui/input.js`.

**Exit criteria:** The full primary game loop is playable: title → START → creation → finalize → exploration → move → combat → victory → exploration → descend → repeat. The game compiles and runs end-to-end with real game logic.

---

## Phase 11: Screens (Library, Scorecard, Import, Tutorial, Settings)

**Goal:** The remaining screens — library, scorecard, import, tutorial, settings. These complete the full app surface.

- [ ] Create `src/ui/screens/library.js` — `mount(container, params) → ScreenController`. Run library listing: accent swatch, seed, depth, party sigils, last played, theme name. Run row click → load run → mount exploration. "New Run" → mount creation. "Title" → mount title. Empty state. Matches `mocks/library.html`. Depends on `state/library.js`, `ui/components.js`, `ui/input.js`.
- [ ] Create `src/ui/screens/scorecard.js` — `mount(container, params) → ScreenController` where `params` includes `{ seed, depth, party, causeOfDeath, scrapCounter }`. Final depth display, party roster (dead sigils), cause of death, world seed, share-world link (seed-only `#w=` URL, copyable), run summary stats (floors, calibrations, enemies slain, echoes slain, CORRUPT items, corruption, scrap, credits), action buttons (restart same seed, new run, title, library). Matches `mocks/scorecard.html`. Depends on `state/save-encode.js`, `state/library.js`, `ui/components.js`, `ui/input.js`, `data/sigils.json`.
- [ ] Create `src/ui/screens/import.js` — `mount(container, params) → ScreenController`. Paste link textarea, IMPORT button. Success → show run summary → "RESUME RUN" → mount exploration. Failure → named failure screen (truncated, version_mismatch, checksum_failed, malformed) with specific error message. Where seed is readable: "Fresh Run in This World" → mount creation with preloadedSeed. "Return to Title" always available. Matches `mocks/import.html`. Depends on `state/save-decode.js`, `state/save-encode.js`, `ui/components.js`, `ui/input.js`.
- [ ] Create `src/ui/screens/tutorial.js` — `mount(container, params) → ScreenController`. Paginated manual (6 pages): Console overview, MOVE mode, COMBAT mode, PARTY/GEAR/TECH modes, LOOT/LOG modes, Status strip & settings. CSS-drawn illustrations per page. Prev/next navigation, page dots, "SKIP / BACK TO TITLE". Matches `mocks/tutorial.html`. Depends on `ui/components.js`, `ui/input.js`.
- [ ] Create `src/ui/screens/settings.js` — `mount(container, params) → ScreenController`. Audio section: master mute toggle, 5 per-layer volume sliders (drone, pulse, sparkle, lead, noise bed). Visual section: glitch toggle, reduced-motion toggle, scanline/grain toggle. Info section: version, build, cache, transfer. Settings persist via `state/library.js.saveSettings()`. "Back" → mount previous screen (title or exploration). Matches `mocks/settings.html`. Depends on `state/library.js`, `audio/engine.js`, `glitch/glitch.js`, `glitch/grain.js`, `ui/components.js`, `ui/input.js`.

**Exit criteria:** All 14 screens (title, creation, exploration, combat, library, scorecard, import, tutorial, settings + 5 console mode views which are part of the console, not separate screens) are implemented and navigable. The full app surface is complete.

---

## Phase 12: Wiring & Integration

**Goal:** Wire everything together in `main.js` — the screen router, bus event handling, audio state pushing, glitch system lifecycle, autosave triggers, and URL fragment handling on load.

- [ ] Update `src/main.js` — Full implementation of the screen router: `mountScreen(name, params)` unmounts current screen controller (calls `unmount()`), mounts new screen. Bus event subscriptions: `state:combat-start` → mount combat screen; `state:combat-end` (victory) → mount exploration; `state:party-wipe` → delete run state via `library.deleteRunState()` → mount scorecard. Audio state pushing: on floor change / combat start / combat end, call `audioEngine.updateState(gameState)`. Glitch system lifecycle: start glitch on app load (if enabled), stop on unmount. Autosave: on `state:floor-change` and `state:combat-end`, call `library.saveRun(runState)`. URL fragment check on load: if `#r=` present, decode and mount exploration; if `#w=` present, mount creation with preloadedSeed; else mount title. Settings application: apply audio volumes, glitch enabled, scanline enabled from `library.loadSettings()`.
- [ ] Wire `glitch/grain.js` — Ensure grain canvas is created and started on the portrait frame, respects settings toggle, and is positioned correctly (z-index 56, pointer-events none).
- [ ] Wire `glitch/glitch.js` — Ensure glitch system registers all text elements on screen mount, unregisters on unmount. Respect `prefers-reduced-motion` + settings toggle.
- [ ] Wire `audio/engine.js` — Ensure `audioEngine.start()` is called from title screen START (user gesture). Ensure `updateState()` is called on floor change, combat start, combat end, hostile proximity change, container proximity change.
- [ ] Wire `state/bus.js` events — Ensure all bus events are dispatched by the correct producers and subscribed by the correct consumers: `state:floor-change` (exploration → main), `state:combat-start` (exploration/movement → main), `state:combat-end` (combat → main), `state:character-death` (combat → scorecard/exploration), `state:party-wipe` (combat → main → scorecard), `state:corruption-change` (rules → status strip), `state:danger-clock-tick` (movement → status strip), `state:settings-change` (settings → audio/glitch), `ui:mode-change` (console → status strip), `ui:console-expand` / `ui:console-collapse` (console → playfield auto-pan).

**Exit criteria:** The entire game runs end-to-end: title → START → creation → finalize → exploration → move → combat → victory/wipe → scorecard → share/restart. Audio responds to game state. Glitch runs continuously. Autosave works. URL saves work. Settings persist. Offline-first via service worker. The project is a complete, playable game.

---

## Phase Summary

| Phase | Session Focus | Key Files | Exit State |
|-------|--------------|-----------|------------|
| 1 | Scaffolding & Config | `index.html`, `styles/*.css`, `main.js` (stub), `service-worker.js`, `state/bus.js` | CRT frame loads, data files fetched |
| 2 | Core + Data | `core/*.js`, `data/*.json`, `assets/descent-sigil.woff2` | PRNG/hash/cursor work, all data files valid |
| 3 | Rules Engine | `rules/*.js` (11 modules) | Full game logic, no UI |
| 4 | Floor + Exploration | `floor/*.js`, `exploration/*.js`, `state/run-state.js` (stub) | Validated floors generate, movement compiles |
| 5 | State Management | `state/run-state.js` (full), `state/condense.js`, `state/compress/*.js`, `state/encrypt.js`, `state/save-encode.js`, `state/save-decode.js`, `state/library.js`, `state/party-configs.js` | Save pipeline works end-to-end |
| 6 | Audio Engine | `audio/*.js` (6 modules) | 5-layer synth responds to game state |
| 7 | Glitch System | `glitch/*.js` (3 modules) | JS-driven CRT effects, grain canvas, transitions |
| 8 | UI Foundation | `ui/components.js`, `ui/input.js`, `ui/playfield.js`, `ui/status-strip.js` | Shared UI infra, canvas playfield renders |
| 9 | Console | `ui/console/*.js` (8 modules) | 7-mode console, all modes render |
| 10 | Primary Screens | `ui/screens/title.js`, `creation.js`, `exploration.js`, `combat.js` | Full game loop playable |
| 11 | Remaining Screens | `ui/screens/library.js`, `scorecard.js`, `import.js`, `tutorial.js`, `settings.js` | All screens navigable |
| 12 | Wiring & Integration | `main.js` (full), bus event wiring, audio/glitch/autosave lifecycle | Complete playable game |

## Dependency Order (Enforced)

```
Phase 1 (scaffolding)
  ↓
Phase 2 (core + data)
  ↓
Phase 3 (rules) ← depends on core + data
  ↓
Phase 4 (floor + exploration) ← depends on core + rules (stub run-state)
  ↓
Phase 5 (state) ← depends on core + rules (replaces stub)
  ↓
Phase 6 (audio) ← depends on core + data (independent of state/rules)
Phase 7 (glitch) ← depends on core + data (independent of state/rules)
  ↓ (6 and 7 can run in parallel after Phase 2, but are listed sequentially for simplicity)
Phase 8 (UI foundation) ← depends on state + exploration + data
  ↓
Phase 9 (console) ← depends on UI foundation + rules + state
  ↓
Phase 10 (primary screens) ← depends on console + exploration + combat + state + audio + glitch
  ↓
Phase 11 (remaining screens) ← depends on UI foundation + state + save encode/decode
  ↓
Phase 12 (wiring) ← depends on everything
```

## Notes

- **No build step:** All files are served as-is. No bundler, no transpiler. Native ES modules with `import`/`export`.
- **Placeholder WOFF2:** The `DESCENT SIGIL` typeface is a named deliverable authored separately. A placeholder WOFF2 is included so `@font-face` doesn't 404. The real font replaces it when available (blocks M5 per the idea doc, but does not block any code phase).
- **Sigil rendering:** Until the real font is available, sigil glyphs will render as tofu/placeholder. The code uses PUA codepoints from `data/sigils.json` regardless — when the font arrives, it just works.
- **Tailwind:** The mocks use Tailwind CDN for rapid prototyping. The production app does NOT use Tailwind — all styling is hand-written CSS in `styles/*.css`. The mocks' utility classes (flex, grid, gap, px, py, text sizes) are translated to equivalent CSS in the component classes.
- **Testing:** Vitest tests live in `tests/` (dev-only, not shipped). Tests can be written alongside any phase but are not part of the build phases. The Tester agent handles test creation.
- **Each phase compiles:** At the end of every phase, the project loads in a browser without errors. Modules that don't exist yet are simply not imported. The one exception is the `run-state.js` stub in Phase 4, which is explicitly a placeholder that compiles but returns empty objects.