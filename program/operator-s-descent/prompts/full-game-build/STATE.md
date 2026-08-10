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