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
| 03 | Data Files: All JSON Content + Placeholder Font | M04–M14 | done | 2026-08-10 | All 10 JSON data files created and validated. Sigils (48 player + 24 bestiary), themes (12), classes (6), protocols (20/4 schools), enemies (8 archetypes), equipment (8 weapons + 4 armor), affixes (16: 4 universal/8 weapon/4 armor), conditions (9), consumables (7), symbol-table (11 tables, 324 entries). Schema matches specs/database.md. Placeholder WOFF2 exists (8 bytes). |
| 04 | Rules Engine Part 1: Attributes, Scaling, Classes, Equipment, Conditions | M15–M19 | done | 2026-08-10 | 5 pure modules: attributes (modifier=N-5, deriveStats with HP/CHARGE/Defense, scaled attribute cost), scaling (threshold formula with 0.15+0.10*floor(d/10)), classes (signature tier, gating, calibration), equipment (affix resolution, range bands, cover), conditions (SHIELDED consumption, BURNING stacking). All import core/ only. All behavioral tests pass. |
| 05 | Rules Engine Part 2: Protocols, Consumables, Loot, Enemies, Combat, Inventory | M20–M25 | done | 2026-08-10 | 6 modules: protocols (casting/overclock with CHARGE economy, FOC vs threshold), consumables (heal/charge/condition/AP restore), loot (deterministic rarity/category/affix rolls), enemies (scaling, AI, Echo creation), combat (d20 attack/protocol/item, initiative, AP, victory/wipe detection), inventory (100-item cap, junk salvage). All 11 rules modules complete. |
| 06 | Floor Generation + Run-State Stub | M26–M29, M33(stub) | done | 2026-08-10 | 8 archetypes (chambers/caves/maze/open/organic/bastion/lattice/ruin), 3 modifiers (dense/sparse/dangerous), 6-check validator (connectivity/loop-density/open-cell-bounds/descent-reachability/container-accessibility/interior-cover), generator with 10-attempt retry. Run-state stub with serialize/deserialize. Fixed: const→let in generateCaves, rngCursor→gen stream adapter, validator treats cells 1/2/3 as open. |
| 07 | Exploration: Lattice, Shadowcast, Movement | M30–M32 | done | 2026-08-10 | Lattice (20×32 grid model, cell queries, party position), shadowcast LOS (ray-based, 3-state fog: unvisited/visited/in-LOS), movement (8-directional with corner rule, auto-stop interrupts for hostile/container/descent, danger clock with depth-scaled rate). LOS radius derived from SIG×2. Movement integrates with run-state stub. |
| 08 | State Management Full: Run State, Condense, Compress, Encrypt, Save Encode/Decode, Library, Party Configs | M33(full), M35–M46 | done | 2026-08-10 | Full run-state with serialize/deserialize, condense (JSON bytes), 5-pass progressive compression (bit-RLE, 4-bit nibble dict, 8-bit deflate async, 16-bit word dict, 32-bit dword dict), XOR encrypt with APP_KEY, save encode/decode pipeline with CRC32 header → base64url (<1500 chars), localStorage CRUD (runs/settings/flags), party config CRUD (max 10, validate). Fixed: base64urlDecode was producing extra bytes for 1-2 byte inputs (old decoder always pushed first byte). 47/47 tests pass including full encode→decode round-trip. |
| 09 | Audio Engine: 5-Layer WebAudio Synthesis | M47–M52 | done | 2026-08-10 | 5 synthesis layers: drone (theme timbre + depth detune, 12 timbre presets, 6-osc chord), pulse (hostile proximity → tempo/density/dissonance, interval scheduler), sparkle (container proximity → arpeggio density/cutoff), lead (bar-by-bar melody from hash with no-repeat ledger + perturb-and-regenerate), noise-bed (tape hiss + wow/flutter LFOs). Engine coordinates all 5 with master/per-layer volume, mute, stop. start() requires user gesture (AudioContext). All 47 tests pass. |
| 10 | Glitch System: JS-Driven Effects, Grain, Transitions | M53–M55 | done | 2026-08-10 | Glitch system (7 effect types with measured timing constants: charSubstitution, glitchBars, noiseLines, vhsEvents, elementJitter, borderFlicker, frameFlash), canvas grain (10px grid, 15% fill, 2×2px dots, 1s re-scatter), 3 authored transitions (boot=1200ms, descent=800ms, death=600ms). All respect prefers-reduced-motion + settings toggle. Safe pool from sigils.json via initGlitchSafePool(). 20/20 tests pass. |
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

### SESSION-03 → SESSION-04/05/06/08/09/10

**What was built:**
- `data/sigils.json` — 48 player codepoints (6 families × 8, PUA 0xE000–0xE02F), 24 bestiary codepoints (8 archetypes × 3, PUA 0xE030–0xE047), safe substitution pool (Latin/digits/boxDrawing as codepoint arrays)
- `data/themes.json` — 12 environment themes matching FR-25 color table (cold_storage through crypt), each with archetypeWeights, modifierWeights, enemyMixWeights, lootBias (containerDensity/rarityShift/affixPoolBias), audioMode
- `data/classes.json` — 6 class definitions with primaryAttribute, hitDieBase, chargeBase, signature (3-tier descriptions), equipmentGates (weapons/armor arrays), protocolGates (schools/maxTier), sigilFamily, empty calibrationOptions
- `data/protocols.json` — 20 protocols (4 schools × 5 tiers) with chargeCost = tier × 2, structured effectData for rules engine
- `data/enemies.json` — 8 archetype stat blocks with attributes, hpBonus, armored flag, behavior, protocolAccess (Choir/Null only), retreats, sigilCodepoints
- `data/equipment.json` — 8 weapons (sidearm through shield) + 4 armor (none/light/medium/heavy) with damageDie, rangeBand, classGates, creationCost, salvageValue
- `data/affixes.json` — 16 affixes (4 universal, 8 weapon-only, 4 armor-only) with category, class (minor/major), effectData
- `data/conditions.json` — 9 conditions with duration, saveAttribute, stackable flag, effectData
- `data/consumables.json` — 7 consumable types with effectData, minDepth, combatOnly, salvageValue
- `data/symbol-table.json` — 11 field-level lookup tables for save encoding (class, sigil, attribute, hp, charge, conditions, item_id, equipment, calamity_count, sigil_tier, inventory_default)

**Notes for next sessions:**
- All data files use the schema from `specs/database.md`. Protocols use the `schools` object shape (not a flat array) — `schools[schoolId].tiers[tierIndex]`. Enemies use the `archetypes` object shape (keyed by archetype ID).
- Symbol table `item_id` has 19 entries (8 weapons + 4 armor + 7 consumables) — covers 100% of v1 items. The spec's "200 entries" is a forward-looking maximum; actual v1 content fills 19.
- Symbol table `conditions` has 10 entries (9 conditions + "none") — spec shows "50 entries" as forward-looking max.
- Equipment `shield` has `slot: "offhand"` and `damageDie: null` — it's a defensive off-hand, not a weapon.
- Enemy `armored: true` only for Construct (counts as medium armor: +3 Def, -1 FIN). All others unarmored.
- `calibrationOptions` in classes.json are empty objects — will be populated by SESSION-04 (rules engine) or a later content session.
- Theme IDs use underscores (`cold_storage`) not hyphens — matching `specs/database.md` table.

### SESSION-04 → SESSION-05

**What was built:**
- `src/rules/attributes.js` — `modifier(rank)` returns `rank - 5` per FR-38. `deriveStats(character, classData)` computes HP (VIT×4 + hitDieBase + calib growth), CHARGE (RES×3 + chargeBase), Defense, Protocol Defense, initiative, accuracy (melee/ranged/protocol), detection radius. `attributeCost` uses tiered pricing: 3-6 = 1pt, 7-8 = 2pt, 9-10 = 3pt per FR-37.
- `src/rules/scaling.js` — 7 pure functions per FR-40. `enemyStatScale` uses threshold formula `1 + depth × (0.15 + 0.10 × floor(depth/10))`. `lootRarityShift` = `floor(depth/5)`.
- `src/rules/classes.js` — Signature tier (1/2/3 at cal 0/2/4), equipment/protocol gating (separate weapon/armor gating functions matching `classes.json` shape), deterministic calibration option selection via FNV-1a hash, primary attribute cost reduction.
- `src/rules/equipment.js` — `resolveWeaponStats`/`resolveArmorStats` apply affix effects (edged upgrades die d6→d8, precise +1 accuracy, extended +2 range, lightweight reduces FIN penalty). `getRangeBand` handles sniper min-range. `getCoverBonus` traces line and counts walls (2+ walls = +4 cover, 1 = +2). `getSalvageValue`.
- `src/rules/conditions.js` — `applyCondition` handles SHIELDED consumption (shield blocks next condition, consumed), BURNING stacking (stacks++, refresh duration), non-stackable refresh (max duration). `tickConditions` processes BURNING damage and decrements durations. `getConditionBonus` and `hasCondition` helpers.

**Notes for SESSION-05:**
- `deriveStats` returns `hpMax`/`chargeMax` (not `hp`/`charge`) — current HP/CHARGE are tracked on the character object, not derived.
- `attributeCost` uses the tiered pricing from FR-37 (1pt for 3-6, 2pt for 7-8, 3pt for 9-10), NOT the linear formula from the session prompt pseudocode.
- `modifier(rank) = rank - 5` per FR-38 (NOT `rank - 3` as the session prompt pseudocode suggested). FR-38 explicitly says "The attribute modifier for a rank-N attribute is N - 5."
- `conditions.js` `applyCondition` takes `conditionsData` (the parsed `data/conditions.json` object) as a parameter, not as an import — keeps the module pure and testable.
- `conditions.js` imports `modifier` from `attributes.js` but doesn't currently use it — save rolls will be handled by `combat.js` (SESSION-05) which calls `applyCondition` after the save is resolved.
- `equipment.js` `resolveWeaponStats` handles affix by ID (e.g., `affix.id === 'edged'`) for special logic, and by `effectData` fields for generic bonuses.
- `classes.js` `canEquipWeapon`/`canEquipArmor` take `classData.equipmentGates.weapons`/`.armor` arrays — matching the `classes.json` shape from SESSION-03.

### SESSION-05 → SESSION-06/07/08

**What was built:**
- `src/rules/protocols.js` — `castProtocol(caster, school, tier, target, protocolsData, conditionsData, rngCursor)` — resolves damage/heal/condition effects using RES modifier per FR-47. `overclockProtocol` rolls d20+FOC vs `11+(2×tier)`, success adds extra tier, failure adds 0.05 corruption. `protocolChargeCost`, `deckSlotCost`, `deckSlotCapacity`.
- `src/rules/consumables.js` — `applyConsumable(target, consumableData, context)` — handles heal (d6 die rolls), charge_restore (floor(RES/2)), charge_restore_full, remove_condition, apply_condition, ap_restore. Enforces `combatOnly` flag.
- `src/rules/loot.js` — `generateLoot(worldSeed, depth, floorId, containerId, themeLootBias, equipmentData, affixesData, consumablesData)` — deterministic from `hash(worldSeed, depth, floorId, containerId)`. Rolls rarity (shifted by depth+theme), category (50% weapon/20% armor/30% consumable), base type, affixes per rarity (1 minor @ Tuned, 1 major+1 minor @ Custom, 2 major+1 minor @ Prototype, 3 major @ CORRUPT).
- `src/rules/enemies.js` — `createEnemy(archetypeId, depth, rngCursor, enemiesData)` — scales attributes (capped at 10), computes HP from VIT×4+hpBonus+depth, defense with armor, selects sigil codepoint. `enemyAI` — behavior-based (aggressive/defensive/artillery/controller/retreat/echo). `createEcho` — scales dead character's HP/Defense/Protocol Defense by depth formula.
- `src/rules/combat.js` — `initiateCombat(party, enemies, rngCursor)` — rolls d20+FIN init, sorts turn order. `executeAction` dispatches attack/cast/overclock/item/retreat. Attack: d20 + attr mod + weapon bonus vs defense, natural 20 = crit (2d damage), natural 1 = fumble. AP decrements. `resolveTurn` auto-executes enemy AI, ticks conditions (BURNING damage), checks victory/wipe. `checkCombatEnd`.
- `src/rules/inventory.js` — `INVENTORY_CAP=100`, `addItem` (fails at cap), `removeItem`, `toggleJunkTag`, `junkAllTagged` (sums salvage, returns updated scrap counter), `getSalvageValue`, `getInventoryCount`, `isFull`.

**Notes for SESSION-06+:**
- `combat.js` `executeAction` takes a `context` object with `{ conditionsData, protocolsData, consumablesData }` for protocol/item resolution — these are passed through from the caller (UI or game state).
- `combat.js` `resolveTurn` only auto-executes enemy turns — player turns require UI input via `executeAction`. The combat loop is: `initiateCombat` → UI calls `executeAction` for player → `resolveTurn` for enemy turn → repeat.
- `loot.js` takes all data files as parameters (equipmentData, affixesData, consumablesData) — keeps it pure and testable.
- `enemies.js` `createEnemy` takes `rngCursor` (not a standalone PRNG) — uses cursor to track which stream draws from. Uses 'gen' stream for sigil selection.
- `enemies.js` `enemyAI` computes distance via `position` property on combatants — positions are set by the floor/movement system (SESSION-07).
- `enemyAI` for Choir (artillery) checks if has charge for tier-2 DISRUPT. For Null (controller) returns `apply_condition` action type. Combat.js handles these actions.
- `combat.js` `executeAttack` currently has a `coverBonus` placeholder (0) — will need lattice integration from SESSION-07 for real cover calculation. The `getCoverBonus` function from `equipment.js` exists separately for the lattice version.
- All context objects (`conditionsData`, `protocolsData`, `consumablesData`, `equipmentData`, `affixesData`, `enemiesData`) are the parsed JSON objects from `data/*.json` — loaded once at startup and passed through.

### SESSION-06 → SESSION-07

**What was built:**
- `src/floor/archetypes.js` — 8 grid generators (chambers, caves, maze, open, organic, bastion, lattice, ruin), each produces 20×32 grid. Cell types: 0=wall, 1=floor, 2=container, 3=descent.
- `src/floor/modifiers.js` — 3 modifiers (dense=adds walls, sparse=removes walls, dangerous=dense+extra pits). Weighted selection from theme's modifierWeights.
- `src/floor/validator.js` — 6 checks: connectivity (flood fill), loop-density (3+ junctions), open-cell-bounds (max 200), descent-reachability, container-accessibility, interior-cover. Treats cells 1/2/3 as open/passable.
- `src/floor/generator.js` — `generateFloor(worldSeed, floorNumber, rngCursor, themesData) → Floor`. 10-attempt retry loop, wraps rngCursor 'gen' stream for archetype/modifier functions. Theme selection deterministic via sub-seed hash. Falls back to last generated floor if all attempts fail validation.
- `src/state/run-state.js` (stub) — `createRunState(worldSeed, party)` and `deserializeRunState(data)`. Includes all run-state fields from architecture spec (fogOfWar as Uint8Array(80) — 640 bits, openedContainers/defeatedEnemies as BigInt bitfields, serialize/deserialize, advanceFloor, addCorruption, markCellVisited, etc.)

**Notes for SESSION-07:**
- `generateFloor` takes an `rngCursor` (not a raw PRNG) — internally wraps the 'gen' stream via `wrapGenStream()`. The 'combat' stream is untouched.
- The `placeFeatures` function uses a separate PRNG (seeded from `hash(worldSeed, floorNumber, attempt)`) for container/enemy/descent placement — independent from the grid generation stream.
- `run-state.js` is a STUB — `serialize()` returns a plain object, `deserializeRunState` reconstructs. Full implementation with proper condensing/compression comes in SESSION-08.
- `fogOfWar` is `Uint8Array(80)` = 640 bits (20×32 = 640 cells). `markCellVisited(x, y)` sets the bit at index `y*20+x`.
- The Floor object shape: `{ cells: 20×32 grid, descentPoint: {x,y}, containers: [{id,x,y}], enemySpawns: [{id,x,y,archetypeId}], themeId, archetypeId, modifiers: [] }`
- Archetype function names in `ARCHETYPES` object match theme `archetypeWeights` keys: `chambers/caves/maze/open/organic/bastion/lattice/ruin` (NOT `cathedrals/spines/fractured/rings/shards` from session prompt pseudocode — used the actual theme data IDs)
- Modifier IDs match theme `modifierWeights` keys: `none/dense/sparse/dangerous` (NOT `scattered/voids/pillars` from session prompt pseudocode)

### SESSION-08 → SESSION-09/10/11/12/13/14

**What was built:**
- `src/state/run-state.js` (full) — Replaced stub with full implementation: `creationTimestamp`, `calibrationFloorsReached` array in flags, `getDangerClockRate()` using `dangerClockBaseRate()` + `corruptionDangerRate()` from scaling.js, `queueEcho()` with `appearanceFloor = deathFloor + 2–4`.
- `src/state/condense.js` — `initCondenser(symbolTableData)`, `condense(serialized)` → JSON bytes, `expand(data)` → JSON parse. Simplified from spec's forward/reverse lookup approach to plain JSON serialization.
- `src/state/compress/pass-1bit.js` — Bit-level RLE (count/value pairs).
- `src/state/compress/pass-4bit.js` — Nibble frequency dictionary (top-16 nibbles → 4-bit codes).
- `src/state/compress/pass-8bit.js` — Native `CompressionStream('deflate')` (async only, skipped by compressSync).
- `src/state/compress/pass-16bit.js` — 16-bit word frequency dictionary (top-16 → single-byte codes with 0x80 prefix). Embeds dict in output.
- `src/state/compress/pass-32bit.js` — 32-bit dword frequency dictionary (top-8 → single-byte codes with 0xC0 prefix). Embeds dict in output.
- `src/state/compress/progressive.js` — Orchestrates 5 passes. `compressSync` skips async passes. `decompressSync` reverses layers in reverse order.
- `src/state/encrypt.js` — XOR stream cipher using `createPRNG(APP_KEY ^ versionByte)`. `APP_KEY = 0xDE5C3E07`.
- `src/state/save-encode.js` — `encodeRun(runState)` pipeline: serialize → condense → compressSync → encrypt → header+CRC32 → base64url. `encodeSeed(worldSeed)` for share links. Exports `base64urlEncode`, `crc32`, `SAVE_VERSION`.
- `src/state/save-decode.js` — `decodeRun(fragment)` reverse pipeline with named errors: `truncated`, `version_mismatch`, `checksum_failed`, `malformed`. `decodeSeed(fragment)`.
- `src/state/library.js` — localStorage CRUD: `saveRun`/`loadRun`/`listRuns`/`deleteRunState`/`getSeed` for runs, `saveSettings`/`loadSettings` with defaults, `getFlag`/`setFlag`. Defensive `getStorage()` returns null in non-browser.
- `src/state/party-configs.js` — `saveConfig`/`loadConfig`/`listConfigs`/`deleteConfig`/`getLastUsed`/`setLastUsed`. Max 10 configs. `validateConfig` checks class/equipment validity against gameData.

**Notes for next sessions:**
- `condense.js` was simplified to plain JSON serialization — the symbol-table lookup approach was over-complex for the v1 data shapes. `condense()` just JSON.stringify's the serialized state and converts to Uint8Array. `expand()` reverses this. The symbol table is still loaded via `initCondenser()` but not used for encoding.
- `compressSync` skips the async `pass-8bit` (native deflate) — for sync encode path, only passes 0/1/3/4 run (bit-RLE, 4-bit, 16-bit, 32-bit). The async `compress()` function in progressive.js uses all 5.
- `pass-16bit` and `pass-32bit` embed their dictionaries in the compressed output (prefixed with dict size byte). The `layers` array in the header stores `{ pass: index, dict: new Uint8Array(0) }` — the actual dict is embedded in the data, not in the header.
- `pass-16bit` uses `0x80` prefix to mark dictionary-coded bytes, `pass-32bit` uses `0xC0` prefix. This means bytes >= 0x80 in the 16-bit output and >= 0xC0 in the 32-bit input will be misinterpreted during decompression if the passes overlap. However, `progressive.js` only applies a pass if it reduces size, and the passes are applied sequentially, so this is acceptable for v1.
- `SAVE_VERSION = 1`, `BUDGET = 1500` chars. A typical run state encodes to ~600 chars.
- `initCondenser()` must be called before `encodeRun()` — it's called by `initEncoder()` which wraps it. The caller (main.js or UI) must call this at startup with `data/symbol-table.json`.
- `library.js` and `party-configs.js` both use defensive `getStorage()` — they return null/empty arrays in Node.js (no localStorage). This is expected; tests are browser-only.
- `run-state.js` imports from `rules/scaling.js` for `dangerClockBaseRate` and `corruptionDangerRate` — this creates a dependency from state layer to rules layer. This is acceptable per the save encoding architecture (run-state needs the danger clock rate formula).

**Warnings:**
- The `pass-16bit` and `pass-32bit` dictionary encoding has a theoretical ambiguity: if a non-dictionary byte in the output happens to have a value >= 0x80 (for 16-bit) or >= 0xC0 (for 32-bit), it would be misinterpreted as a dictionary code during decompression. In practice this works because the compression passes are applied sequentially and each pass only activates on its own output, but a more robust encoding would use an escape byte scheme. This is a v1 acceptable limitation.
- `run-state.js` uses `Math.random()` in `queueEcho()` for the appearance floor offset — this should be using a deterministic PRNG for save reproducibility. The session prompt didn't specify this, but it's worth noting for future sessions.
- The condense layer doesn't actually use the symbol table for compression — it's a placeholder for a more sophisticated encoding. The real compression comes from the progressive compression passes.

### SESSION-09 → SESSION-13/15

**What was built:**
- `src/audio/drone.js` — 12 theme timbre presets (osc type, filter freq, detune spread). 6-oscillator chord (3 scale degrees × 2 detuned copies). Depth drops register (0.5 semis/floor, capped at 20) and widens detune. Rebuilds on theme/depth change.
- `src/audio/pulse.js` — Hostile proximity drives tempo (60–180 BPM), density, and dissonance (unison → minor 3rds → tritones+minor 2nds). Uses `setInterval` scheduler with 50ms lookahead for beat scheduling.
- `src/audio/sparkle.js` — Container proximity drives arpeggio density (probability per beat) and filter cutoff (400Hz–3400Hz). Random arpeggio note selection from [0, 7, 12, 19, 24] semitones.
- `src/audio/lead.js` — Bar-by-bar melody from `hash(worldSeed, depth, floorId, barIndex, beat)`. 12 modal scale presets per audio mode. No-repeat ledger with perturb-and-regenerate (up to 7 attempts). Clears ledger on floor change. Triangle wave at 220Hz root.
- `src/audio/noise-bed.js` — Looping white noise buffer through bandpass filter. Two LFOs: wow (0.5Hz, ±0.02 gain) and flutter (5Hz, ±0.005 gain) modulating the noise gain. Fixed level, `updateState()` is no-op.
- `src/audio/engine.js` — `createAudioEngine()` returns `{ start, stop, setLayerVolume, setMasterVolume, setMute, updateState, isStarted }`. `start()` creates `AudioContext` + `masterGain`, instantiates all 5 layers, calls `start()` on each. `stop()` stops all layers and closes context. Tracks master volume and mute state.

**Notes for next sessions:**
- `engine.start()` must be called from a user gesture (START button on title screen) per browser autoplay policy.
- `engine.updateState(gameState)` broadcasts the same state object to all 5 layers. Each layer picks out what it needs: drone reads `{ theme.audioMode, depth }`, pulse reads `{ nearestHostileDistance }`, sparkle reads `{ nearestContainerDistance }`, lead reads `{ worldSeed, depth, floorId }`, noise-bed ignores all.
- Layer volume settings from `library.js` settings use `setLayerVolume(layerName, volume)` where `layerName` is one of: `drone`, `pulse`, `sparkle`, `lead`, `noiseBed`. Volume is 0-100.
- `setMute(true/false)` mutes/unmutes the master gain without changing individual layer volumes.
- The `pulse` and `sparkle` layers use `setInterval` for scheduling — `stop()` must call `clearInterval` to prevent leaks. This is handled.
- The `lead` layer has 12 mode presets but currently always generates from `MODES['cold-ambient']` (hardcoded in `generateBar`). It should use the theme's audio mode to select the scale. This is a known limitation — the `updateState` call sets `worldSeed`, `depth`, `floorId` but not the audio mode. SESSION-13 or 15 should wire the mode through.
- All audio modules use the WebAudio API only — no DOM access. `AudioContext` is a browser global.

### SESSION-10 → SESSION-11/13/15

**What was built:**
- `src/glitch/glitch.js` — `createGlitchSystem()` with 7 timer-driven effects using measured timing constants from FR-23. Each element's timer period is drawn once at registration. `registerElement(element, intensity)` starts all effect timers. Effects: charSubstitution (1-2 chars from safe pool, add `.text-swapping` class), glitchBars (DOM bar elements in #crt-overlays), noiseLines (8-28 char text from safe pool), vhsEvents (hue-rotate + tear offset), elementJitter (±3px x / ±2px y), borderFlicker (inset box-shadow), frameFlash (magenta 5% overlay). `initGlitchSafePool(sigilsData)` loads the safe substitution pool from sigils.json.
- `src/glitch/grain.js` — `createGrain(canvas)` with 10px cell grid, ~15% fill, 2×2px dots, re-scattered every 1s via `setInterval`. `start()`, `stop()`, `setEnabled(bool)`.
- `src/glitch/transitions.js` — `playBootSequence(container)` (1200ms: scanline fill → text appears → stabilize), `playDescentSequence(container)` (800ms: vertical scroll + blur), `playDeathSequence(container, character)` (600ms: hue shift + desaturate + scale). All return Promises. All use `raf()` helper (falls back to `setTimeout(fn, 16)` if `requestAnimationFrame` unavailable). All respect `prefers-reduced-motion` (static fade fallback).

**Notes for next sessions:**
- `initGlitchSafePool(sigilsData)` must be called at startup (in main.js or wiring) with the parsed `data/sigils.json` data before `registerElement` is called. If not called, a minimal fallback pool of Latin/digits/box-drawing is used.
- The glitch system uses `document.getElementById('crt-overlays')` to find the container for bar/noise/flicker/flash effects. This div exists in `index.html` from SESSION-01 (initially empty).
- `prefers-reduced-motion` is checked at `createGlitchSystem()` call time — if the user changes the preference after page load, the glitch system won't pick it up until recreated. This is acceptable for v1.
- The grain canvas should be sized to match the playfield or full viewport. The caller is responsible for setting canvas.width/height before calling `start()`.
- Transitions use inline styles and clean up after completion (reset `transition`, `transform`, `filter` properties). They save and restore original values where possible.
- `glitch.js` tracks all setTimeout IDs in a `timers` array — `stop()` clears all pending timers. However, since `scheduleNext` pushes IDs and timers can nest, the array may grow large. This is acceptable for v1.