# Requirements — Operator's Descent

**Owner:** John Ruf / Glitch Forgeworks LLC
**Source:** `specs/idea.md` (approved)
**Status:** Draft for approval
**Date:** 2026-08-09

---

## Functional Requirements

### FR-1: Title Screen & Front Door

- **User story:** As a player, I want to open the game on a static title screen that does nothing until I press START, so that the machine feels deliberately powered on and the browser's audio-gesture requirement is satisfied naturally.
- **Acceptance criteria:**
  - [ ] The game opens on a title screen showing the game title and a START control.
  - [ ] No assets load, no audio plays, no floors generate, and no RNG state initializes until START is activated.
  - [ ] START functions as the browser-required user gesture for WebAudio activation.
  - [ ] After START, three branches are available: Begin New Run, Run Library, Import Link.
  - [ ] A first-time player (no `localStorage` flag) is offered a tutorial; the offer can be declined in a single press.
  - [ ] Declining the tutorial writes a `localStorage` flag; the tutorial is never offered again unasked.
  - [ ] The tutorial is always reachable from the title screen via a dedicated control, regardless of first-time status.
  - [ ] The title screen is reachable after a run ends or via an explicit exit/abandon action mid-run.

### FR-2: Tutorial

- **User story:** As a new player, I want a manual that teaches the console interaction model, so that I understand the unfamiliar interface without a scripted level.
- **Acceptance criteria:**
  - [ ] The tutorial is a text/image walkthrough, not a playable floor.
  - [ ] It covers: the console and its seven modes, expanding/collapsing the console, movement, turn structure, the status strip readout, settings access, and the seed display.
  - [ ] It does not script a floor, place an enemy, or gate progress behind a demonstration.
  - [ ] It is accessible from the title screen at any time.
  - [ ] Declining is remembered per-device via `localStorage`; it is never re-offered unasked.

### FR-3: The 80-Point Buy (Character Creation)

- **User story:** As a player, I want to spend a single pool of 80 points across one to four characters, so that my party composition is the foundational strategic decision of the run.
- **Acceptance criteria:**
  - [ ] A single pool of 80 points is available at run creation.
  - [ ] The player may create between 1 and 4 characters.
  - [ ] Each character costs 5 points to instantiate (the "chassis").
  - [ ] Remaining points are spent on: attributes, equipment, and tech protocols. Sigil selection is free — it is included in the chassis cost and does not consume points from the pool.
  - [ ] Attributes are purchased on a 1-point-per-rank basis (see FR-37 for attribute costs and ranges).
  - [ ] Equipment is purchased from class-gated lists (see FR-42 for equipment categories and costs).
  - [ ] The creation screen shows a live readout of: points remaining, projected stats per character, and actions-per-round (equal to number of characters).
  - [ ] Unspent points convert to in-run credits at a 10:1 ratio (1 point = 10 credits).
  - [ ] The player must assign a class to each character before finalizing.
  - [ ] The player must assign a sigil to each character before finalizing; sigil selection is free (included in the 5-point chassis cost) and does not consume points from the 80-point pool. Selection is from the available pool for that character's class (8 per class).
  - [ ] No two characters in a party may share the same sigil.
  - [ ] The buy screen enforces a minimum spend of the chassis cost per character; a character with zero additional investment is valid.
  - [ ] On finalization, the party, all purchases, and remaining credits are committed to the run state; no further point-spending is possible.

### FR-4: Classes & Signatures

- **User story:** As a player, I want six distinct classes with always-on signature abilities, so that class choice produces meaningful mechanical identity rather than flavor text.
- **Acceptance criteria:**
  - [ ] Six classes are available: Breacher, Ghost, Compiler, Anchor, Oracle, Operator.
  - [ ] Each class has an always-on signature ability active from floor 1.
  - [ ] Each class gates available equipment, tech protocols, and sigil families.
  - [ ] Each class sets a hit die (see FR-39 for HP formula and per-class hit die values).
  - [ ] Calibrations (build-defining upgrades) are available every third floor (3, 6, 9, 12, …).
  - [ ] Calibrations form the in-run build arc; they are the primary post-creation character advancement.
  - [ ] A calibration offers class-specific options and is chosen at the time of reaching the threshold floor.
  - [ ] Each class has a defined signature ability (see FR-45 for per-class signatures).
  - [ ] Each class has a defined primary attribute (see FR-37 for attribute-to-class mapping).

### FR-5: Sigil Typeface (Named Deliverable — DESCENT SIGIL)

- **User story:** As the project owner, I want an original 72-glyph cyberpunk-mystical typeface shipped as a self-hosted WOFF2, so that character and enemy glyphs render identically on every device and the share-link visual contract is preserved.
- **Acceptance criteria:**
  - [ ] 72 glyphs total: 48 player (6 families × 8) + 24 bestiary (3 per enemy archetype, 8 archetypes).
  - [ ] Visual idiom: occult sigil geometry executed as circuit etching — hard geometric construction, radial/axial symmetry, sealed and broken rings. Read simultaneously as ward, rune, die trace, and logic gate.
  - [ ] No glyph legible as a Latin letter, digit, or common UI symbol.
  - [ ] Player families are visually distinct from each other: Breacher (solid/armored), Ghost (sharp/sparse), Compiler (branching/recursive), Anchor (grounded/symmetrical), Oracle (radial/open), Operator (hybrid).
  - [ ] Bestiary forms are distinguishable from player forms by construction (asymmetric, unclosed, or over-dense), not only by color.
  - [ ] Legible at 34px (initiative rail) and holds weight at 220px (creation picker) — a 6.5× range.
  - [ ] Monospaced, single advance width, optically centered on the em — drops into a 108px grid cell without per-glyph nudging.
  - [ ] Stroke weight tuned for neon bloom — counters run wide, strokes stay even.
  - [ ] Delivered as a self-hosted subsetted WOFF2, target 4–8 KB.
  - [ ] Mapped to a documented Private Use Area range enumerated in `data/sigils.json` as the single source of truth.
  - [ ] `font-display: block` — a substituted sigil is worse than a late one.
  - [ ] Owned by Glitch Forgeworks LLC — no upstream license, no attribution, no redistribution question.
  - [ ] Acceptance test: a 34px contact sheet showing all 72 glyphs; every player family visually distinct from every bestiary form at that size.

### FR-6: Reserved Sigil Banks & Lint Enforcement

- **User story:** As a developer, I want sigil bank codepoints to be reserved and enforced by lint, so that no glyph from the banks renders anywhere outside creature contexts.
- **Acceptance criteria:**
  - [ ] 48 player codepoints and 24 bestiary codepoints are enumerated in `data/sigils.json`.
  - [ ] A lint check bans any bank glyph from rendering in non-creature contexts (controls, ornaments, dividers, bullets, AP markers, etc.).
  - [ ] Carets, bullets, dividers, and AP markers are drawn with CSS and SVG, never with bank glyphs.
  - [ ] If a symbol appears on screen outside a creature context, it must not be a bank codepoint.
  - [ ] The safe substitution pool for glitch character substitution (Latin, digits, box-drawing) is declared in `data/sigils.json` alongside the banks.
  - [ ] The lint check can unambiguously distinguish bank glyphs from safe-pool glyphs using the enumerated ranges.

### FR-7: Sigil Rendering at Four Scale Tiers

- **User story:** As a player, I want sigils to render at consistent fixed sizes, so that the same glyph looks correct whether it's a combat token or a creation-picker face.
- **Acceptance criteria:**
  - [ ] Sigils render at exactly four fixed sizes: 34px (initiative rail), 72px (combat grid token), 108px (grid cell occupancy context), 220px (creation picker).
  - [ ] No intermediate or arbitrary scaling of sigil glyphs.
  - [ ] A character's sigil is the same codepoint at all four sizes.

### FR-8: Procedural Floor Generation

- **User story:** As a player, I want every floor to be deterministically generated from the world seed and floor number, so that the same seed always produces the same dungeon for anyone who visits it.
- **Acceptance criteria:**
  - [ ] Floor N is derived from `hash(worldSeed, N)` using a deterministic PRNG.
  - [ ] Eight generation archetypes are available: sprawling merged chambers, cellular caves, tight orthogonal mazes, pillared cathedrals, meandering spines, fractured floors (void-split), concentric rings, scattered shards.
  - [ ] Zero to two modifiers are applied per floor, drawn from a defined modifier pool.
  - [ ] One of twelve environment themes is assigned per floor.
  - [ ] Theme selection weights archetype and modifier draws, biases enemy mix and loot table, and sets the accent color.
  - [ ] Theme sets the audio mode (timbre and modal set for the drone and lead layers).
  - [ ] Depth influences draw weights (deeper floors bias toward harder archetypes, modifiers, and enemy mixes).
  - [ ] No hand-authored floors exist anywhere in the game.
  - [ ] Sub-seed incrementation: if a floor fails validation, the generator regenerates with an incremented sub-seed until validation passes.
  - [ ] The same `(worldSeed, N)` always yields the same validated floor for the same version of the generation algorithm.

### FR-8a: Environment Theme Table (Data Structure)

- **User story:** As a developer, I want a single data table that defines every parameter an environment theme controls, so that adding or tuning a theme is a data-file edit, not a code change.
- **Acceptance criteria:**
  - [ ] A single environment theme table exists as a data file (e.g., `data/themes.json` — exact path by Architect).
  - [ ] The table enumerates exactly twelve theme entries, named per FR-25: Cold Storage, The Foundry, Data Stream, Data Cache, The Archive, The Hive, The Void, The Lattice, The Stack, The Terminal, The Nursery, The Crypt.
  - [ ] Each theme entry must define the following fields:
    - **`id`** — a stable string identifier used in seed-derived theme selection and save-state encoding.
    - **`name`** — a human-readable display name (e.g., "Cold Storage", "The Foundry").
    - **`accentColor`** — a CSS color value applied via the single accent custom property (per FR-25).
    - **`archetypeWeights`** — a weight map over the eight generation archetypes (FR-8). Weights need not sum to 1; they are relative draw weights. Every archetype must have a weight ≥ 0; an archetype with weight 0 is excluded from that theme.
    - **`modifierWeights`** — a weight map over the modifier pool (FR-8). Same relative-weight convention as archetype weights.
    - **`enemyMixWeights`** — a weight map over enemy archetypes/types controlling which hostiles appear and in what proportion on this theme's floors. Must be compatible with the depth-scaling system (deeper floors bias harder — the depth scaler multiplies or shifts these weights, it does not replace them).
    - **`lootBias`** — a weight map or bias descriptor controlling loot table skew for this theme (e.g., higher container density, shifted rarity distribution, biased affix pool). Must be a defined structure, not a free-form string.
    - **`audioMode`** — an object or identifier selecting the drone timbre and modal set for this theme (per FR-26). Must reference a defined audio mode, not an inline definition.
  - [ ] The table is the single source of truth for theme parameters — no theme behavior is hardcoded outside the table.
  - [ ] Adding a thirteenth theme (future scope) requires only adding a row to the table; no code changes.
  - [ ] Removing a theme requires only deleting its row; seed-derived selection re-rolls to the remaining themes.
  - [ ] The table is loaded at game start and cached by the service worker (per FR-33).
  - [ ] Theme selection is deterministic given `(worldSeed, floorNumber)` — the table defines the candidate set; the PRNG draw selects from it.
  - [ ] Threshold-floor "not yet seen" guarantee (per FR-30) operates against the `id` field of themes already encountered in the run.

### FR-9: Floor Validation

- **User story:** As a player, I want every generated floor to be tactically interesting, so that I never encounter an empty arena or an unreachable area.
- **Acceptance criteria:**
  - [ ] Every floor must pass connectivity validation: all walkable cells form a single connected component.
  - [ ] Every floor must pass loop-density validation: sufficient alternative paths exist (no single-corridor-only layouts in large floors).
  - [ ] Every floor must pass interior-cover validation: large rooms contain interior obstacles; no empty-room arenas.
  - [ ] Every floor must pass descent-reachability validation: the descent point is reachable from the party's entry point.
  - [ ] Every floor must pass container-accessibility validation: all loot containers are reachable.
  - [ ] Every floor must pass open-cell-bounds validation: no excessively large open areas that would make combat trivially positional.
  - [ ] If any check fails, the floor regenerates with an incremented sub-seed.
  - [ ] There is no upper bound on regeneration attempts that produces an unvalidated floor; the game does not ship a broken floor.

### FR-10: Cell-by-Cell Exploration

- **User story:** As a player, I want to explore the floor as a single party token on a lattice, so that the descent feels like a journey through unknown terrain rather than a series of disconnected encounters.
- **Acceptance criteria:**
  - [ ] The party is represented as one token on a 20×32 cell lattice (portrait).
  - [ ] Movement is eight-directional with a corner rule (cannot move diagonally past a blocked corner).
  - [ ] Fog of war has three states per cell: unvisited (fully obscured), visited-but-not-in-LOS (dimmed/last-seen), and currently in-LOS (fully visible).
  - [ ] Line of sight uses shadowcast algorithm.
  - [ ] Auto-stop interrupts trigger on: hostile entering LOS, discovery of a container/descent point/feature, and party taking damage while moving.
  - [ ] Auto-stop can be toggled off per-interrupt-type in settings (or a quick toggle — TBD by Designer).
  - [ ] Movement input via console MOVE mode (keyboard: directional keys; touch: directional controls).
  - [ ] Each cell move consumes one step; encounters trigger based on cell contents.

### FR-11: Tactical d20 Combat

- **User story:** As a player, I want turn-based combat with positioning, range bands, cover, and conditions, so that tactical decisions matter and party composition has real consequences.
- **Acceptance criteria:**
  - [ ] On contact, the view zooms to 2× magnification showing an 8×16 cell window anchored on the contact point.
  - [ ] The arena is the existing floor geometry at the contact location — no separate combat tileset or hand-placed arena.
  - [ ] Combat is turn-based with initiative order determined at encounter start.
  - [ ] Each character gets one move action plus 2 AP per turn.
  - [ ] **Move action distance:** one grid cell per move action (8-directional, corner rule applies). A character may spend their move action to move one cell, or may choose not to move. The move action is separate from AP — it cannot be converted to AP, and AP cannot be converted to a second move action.
  - [ ] **AP cost table:**
    | Action | AP Cost |
    |---|---|
    | Attack (melee or ranged) | 1 AP |
    | Cast a protocol | 1 AP |
    | Use a consumable item | 1 AP |
    | Overclock a protocol | 1 AP (in addition to the CHARGE cost) |
    | Retreat (begin retreat) | 1 AP |
    | Reload / swap weapon via GEAR mode | 0 AP (free, once per turn) |
    | Class signature active ability (if applicable) | 0 AP (free action, per signature rules in FR-45) |
  - [ ] A character with 2 AP may perform any two AP-cost actions in any order (attack twice, attack + protocol, protocol + item, etc.), plus their one move action.
  - [ ] AP does not carry over between turns — unspent AP is lost at the end of the character's turn.
  - [ ] Weapons have range bands with minimum ranges and extended-range penalties.
  - [ ] Cover is determined by edge-crossing: a line from attacker to target crossing a covered edge grants cover bonus.
  - [ ] Flanking bonus applies when two allies are on opposite sides of an enemy.
  - [ ] Opportunity attacks trigger when a character moves out of an adjacent enemy's threatened area.
  - [ ] Nine conditions are supported (enumerated in FR-44).
  - [ ] Deployment places 9–12 cells between the two bands (party and hostiles), giving a natural approach phase.
  - [ ] Combat ends when all hostiles are dead (party victory) or all party members are dead (party wipe).
  - [ ] **Character death:** A character dies when HP reaches 0. A dead character is removed from combat and the party. A single character dying triggers the Echo system (per FR-32) if other party members are still alive. The run continues.
  - [ ] **Party wipe:** When all characters in the party are dead (HP 0), the run ends immediately. The party wipe is permanent — there is no revive, no respawn, no continue. The run-end scorecard (per FR-31) is displayed.
  - [ ] Retreat is a valid combat action: the party may flee the encounter, forfeiting all loot from that encounter.
  - [ ] d20 rolls use the run's deterministic PRNG — the same run state produces the same rolls.

### FR-12: Tech Protocols (Magic System)

- **User story:** As a player, I want to cast tech protocols as the game's magic system, so that I have a resource-management layer beyond equipment and positioning.
- **Acceptance criteria:**
  - [ ] Four schools: DISRUPT, WARD, SCRY, REWRITE.
  - [ ] Five tiers per school (tier 1–5).
  - [ ] Protocols are paid for in CHARGE (a per-character resource).
  - [ ] Protocol capacity is limited by deck slots; each protocol occupies `tier × 1` deck slot.
  - [ ] Deck slot capacity per character = `3 + classChargeBase ÷ 2` (rounded down, minimum 3). A Breacher (charge base 0) has 3 slots. An Oracle (charge base 8) has 7 slots.
  - [ ] Protocols are purchased at creation from the class-gated school list (per FR-45) at a cost of `tier × 2` points each.
  - [ ] Calibrations may grant additional deck slots (per FR-39).
  - [ ] Overclocking is available: spend a tier of extra effect at double CHARGE cost, with a corruption risk (adds to the run's corruption total).
  - [ ] Protocols are purchased at character creation and can be found/modified via calibrations in-run.
  - [ ] CHARGE regenerates per the game's rest/resource model: `floor(RES / 3)` CHARGE per floor descent (see FR-39 and FR-46).

### FR-13: Loot System

- **User story:** As a player, I want loot with meaningful rarity and affix variety, so that floor rewards feel worth the risk and gear choices matter.
- **Acceptance criteria:**
  - [ ] Five rarity tiers exist: Stock, Tuned, Custom, Prototype, CORRUPT (see FR-48 for definitions).
  - [ ] A sixteen-entry affix pool is available (enumerated in FR-48).
  - [ ] Items are generated from `hash(worldSeed, depth, floorId, containerId)` — deterministic per seed.
  - [ ] CORRUPT items are strictly stronger than non-corrupt equivalents.
  - [ ] Equipping a CORRUPT item permanently raises the run's danger clock rate.
  - [ ] Corruption is a mechanical cost only — it has no visual effect on the screen (glitch takes no game-state input).
  - [ ] Loot containers are placed during floor generation and validated for accessibility.
  - [ ] Loot is accessed via the LOOT console mode.

### FR-14: Corruption & Danger Clock

- **User story:** As a player, I want corruption to be a real strategic cost, so that using CORRUPT items and overcasting protocols has consequences I can feel in gameplay.
- **Acceptance criteria:**
  - [ ] Each failed overclock adds 0.05 to the run's corruption total.
  - [ ] CORRUPT item implants add a baseline corruption value per item.
  - [ ] Corruption raises the danger clock rate — hunts arrive sooner at higher corruption.
  - [ ] **Hunt (ambush):** When the danger clock reaches its threshold, a hunt triggers. A hunt is an ambush encounter:
    - The party is surrounded: enemies spawn on multiple sides of the party's current position, within 4–6 cells, using valid floor geometry.
    - Hunt enemies are drawn from the current floor's environment theme enemy mix, scaled to the current depth (per FR-40).
    - A hunt always includes at least one enemy of a higher tier than the floor's standard mix (minimum one Stalker, Choir, Null, or Construct).
    - The hunt triggers immediately during exploration (not during combat) — the party is forced into a combat encounter.
    - After the hunt is resolved (victory or retreat), the danger clock resets to 0 and begins accumulating again.
    - The danger clock does not tick during combat — it only advances during exploration.
    - If the party is already in combat when the threshold is reached, the hunt is deferred until the current combat ends and the party resumes exploration.
  - [ ] The danger clock threshold of 0.5 is a tuning reference point (per Open Question 5, needs distribution data).
  - [ ] Corruption has zero visual effect — it is never reflected in glitch intensity or any screen effect.
  - [ ] The current corruption value is readable somewhere in the UI (status strip or PARTY mode — placement by Designer).

### FR-15: The Single Console

- **User story:** As a player, I want every game action routed through one bottom-pinned console, so that the interface is consistent, thumb-reachable on mobile, and fully keyboard-navigable on desktop.
- **Acceptance criteria:**
  - [ ] One console is pinned to the bottom of the screen at all times during play.
  - [ ] The console has seven mutually exclusive modes: MOVE, COMBAT, PARTY, GEAR, TECH, LOOT, LOG.
  - [ ] Switching modes swaps the console content; only one mode is active at a time.
  - [ ] The console expands to a fixed expanded height (does not shift based on content; the height is constant per mode).
  - [ ] When expanded, the console dims the playfield behind it.
  - [ ] When expanded, the console auto-pans the playfield so the active actor remains visible.
  - [ ] Every action reachable by keyboard is also reachable by touch, and vice versa — full parity.
  - [ ] No gameplay affordance exists outside the console (no context menus, floating panels, hover tooltips, or map-tap movement).
  - [ ] The playfield is a readout, not a control surface.
  - [ ] 96px minimum hit height on every console row (touch target).
  - [ ] The console can be collapsed to a minimal height to maximize playfield visibility.

### FR-16: Console Mode — MOVE

- **User story:** As a player, I want to move my party through the floor via the console, so that exploration happens through the same input surface as everything else.
- **Acceptance criteria:**
  - [ ] MOVE mode provides directional input (8-way with corner rule).
  - [ ] Keyboard: arrow keys / numpad / WASD (specific mapping by Designer).
  - [ ] Touch: directional controls within the console area.
  - [ ] Auto-stop interrupts are processed during movement.
  - [ ] The active mode indicator clearly shows MOVE is active.

### FR-17: Console Mode — COMBAT

- **User story:** As a player, I want to issue combat commands through the console, so that tactical decisions happen through the same surface as movement and everything else.
- **Acceptance criteria:**
  - [ ] COMBAT mode is active during combat encounters.
  - [ ] Shows initiative order with sigil glyphs at 34px.
  - [ ] Provides actions for the active character: move, attack (select target), use protocol, use item, retreat.
  - [ ] Target selection uses tap-to-select with a confirm step on touch; keyboard navigate + confirm on desktop.
  - [ ] Shows the active character's HP, charge, conditions, and available actions.
  - [ ] Range bands and cover status for the current target are displayed.

### FR-18: Console Mode — PARTY

- **User story:** As a player, I want to inspect my party members, so that I can see stats, conditions, and status for each character.
- **Acceptance criteria:**
  - [ ] PARTY mode lists all party members with their sigils.
  - [ ] Selecting a member shows: attributes, HP, charge, conditions, class, level/calibration count, corruption contribution.
  - [ ] Shows current AP and move action availability during combat.

### FR-19: Console Mode — GEAR

- **User story:** As a player, I want to manage equipment through the console, so that I can equip, unequip, and compare items without leaving the single input surface.
- **Acceptance criteria:**
  - [ ] GEAR mode shows each character's equipped items.
  - [ ] Allows equipping and unequipping items from inventory.
  - [ ] Shows item stats, rarity tier, affixes, and CORRUPT status.
  - [ ] CORRUPT items display a warning before equipping.

### FR-20: Console Mode — TECH

- **User story:** As a player, I want to manage and cast tech protocols through the console, so that the magic system uses the same input surface as everything else.
- **Acceptance criteria:**
  - [ ] TECH mode shows equipped protocols (deck) for the active character.
  - [ ] Shows CHARGE available and CHARGE cost per protocol.
  - [ ] Allows casting a protocol (select target if required).
  - [ ] Overclock option is presented with its double-cost and corruption-risk warning.
  - [ ] Shows deck slot usage and capacity.

### FR-21: Console Mode — LOOT

- **User story:** As a player, I want to loot containers through the console, so that item acquisition uses the same input surface.
- **Acceptance criteria:**
  - [ ] LOOT mode activates when the party is adjacent to or standing on a container.
  - [ ] Shows container contents.
  - [ ] Allows taking items into inventory.
  - [ ] Shows item details (stats, rarity, affixes, CORRUPT status) before taking.

### FR-22: Console Mode — LOG

- **User story:** As a player, I want a readable log of recent events, so that I can review what happened without replaying.
- **Acceptance criteria:**
  - [ ] LOG mode shows a scrolling log of recent game events (combat rolls, discoveries, damage, deaths, etc.).
  - [ ] Log entries are timestamped by turn or event order.
  - [ ] The log is readable within the console's fixed expanded height.

### FR-23: CRT/VHS Presentation — Glitch System

- **User story:** As a player, I want the screen to look like a degrading CRT/VHS terminal, so that the aesthetic is immersive and consistent throughout the run.
- **Acceptance criteria:**
  - [ ] Glitch is constant — no `glitchLevel` variable, no game-state input, no depth ramp, no HP spike, no natural-1 trigger.
  - [ ] Every glitching element declares its own per-element intensity constant at authoring time (the per-element dial, ported from the tarot).
  - [ ] No element may read its intensity from game state.
  - [ ] Each timer's period is drawn once at element construction, not re-rolled per tick — each element has its own fixed heartbeat.
  - [ ] Effect timings are the following measured constants (ported literally, not re-derived):
    - **Character substitution:** 700–1799ms between attempts, gated by per-element constant; 120–349ms swapped then reverts; 1–2 chars; ±3px x, ±1px y displacement.
    - **Text chromatic ghosts:** Only during a swap window; same 120–349ms; ±2px, red and blue at 47%.
    - **VHS event:** 4000–9999ms between events; 80–249ms; chroma ±2–4px, tear 2–6px tall offset ±5–15px, content jitter ±2px.
    - **Element jitter:** 500–1399ms, 30% fire; 70–199ms; ±3px x, ±2px y.
    - **Border flicker:** 400–1099ms, 35% fire; 40–159ms; opacity 0.5–0.9.
    - **Frame flash:** 1800–4499ms, 12% fire; 30–89ms; magenta at 5%.
    - **Glitch bars:** 350–999ms, 40% fire; 80–249ms; 1–4px tall, ±8px offset, alpha 0.1–0.5.
    - **Noise lines:** 1200–3499ms, 30% fire; 80–299ms; 8–28 chars at 8px.
    - **Scanlines:** 1px line every 2px, white at 10%; continuous; drifts 2px over 4000ms, wrapping.
    - **Tracking band:** 7s linear loop; 28% of viewport height, screen blend, 5% white-blue.
    - **Vignette:** 4s ease-in-out pulse; opacity 0.65 ↔ 0.92.
    - **Aperture grille:** static; 3px RGB triad, screen blend at 50%.
  - [ ] Character substitution draws only from the enumerated safe pool (Latin, digits, box-drawing) declared in `data/sigils.json`.
  - [ ] Sigil glyphs are never substituted — they may split, invert, or degrade to noise, but never swap to a different codepoint.
  - [ ] Glitch never obscures actionable information for longer than 400ms.
  - [ ] Glitch never touches an interactive control while a decision is pending.
  - [ ] Grain is a canvas dot-scatter re-scattered once per second (10px cell grid, ~15% fill, 2×2px dots) — not SVG turbulence.
  - [ ] No SVG is used for glitch effects anywhere.
  - [ ] Glitch is fully disabled by: `prefers-reduced-motion` media query, and a manual settings toggle.
  - [ ] Disabling glitch costs the player no information (status is carried by color and audio, not by glitch).

### FR-24: Authored Transitions (Set-Piece Animations)

- **User story:** As a player, I want boot, descent, and death to have scripted visual sequences, so that these moments feel distinct from the ambient noise.
- **Acceptance criteria:**
  - [ ] Boot sequence: scripted animation with a fixed timeline on game start (after START).
  - [ ] Floor descent: scripted animation with a fixed timeline on moving to a new floor.
  - [ ] Death (single character): scripted animation with a fixed timeline.
  - [ ] These are authored set-pieces, not glitch-meter-driven — they fire on an event and run a known duration.
  - [ ] They are also disabled by `prefers-reduced-motion` and the glitch toggle (replaced with a static transition or fade).

### FR-25: Per-Floor Accent & Re-Skinning

- **User story:** As a player, I want each environment theme to visually re-skin the screen via a single accent color, so that I can read what floor I'm on from the color before reading a number.
- **Acceptance criteria:**
  - [ ] Each of the twelve environment themes has a defined accent color.
  - [ ] The accent color flows through a single CSS custom property.
  - [ ] Changing the custom property re-skins the entire screen (glow color, accent borders, UI tints).
  - [ ] The twelve environment themes and their accent colors:
    | # | Name | Accent Color | Mood |
    |---|---|---|---|
    | 1 | Cold Storage | `#7ec8e3` (pale blue) | Vast, quiet, sparse — long sight lines, few enemies |
    | 2 | The Foundry | `#e8632a` (orange) | Cramped, violent, dense — tight corridors, many enemies |
    | 3 | Data Stream | `#2ed4c1` (cyan) | Flowing, open — channels and rivers, movement-oriented |
    | 4 | Data Cache | `#e8d23a` (yellow) | Dense, compressed — tight rooms, high container density |
    | 5 | The Archive | `#c4a04e` (amber) | Labyrinthine, dim — winding passages, Warden-heavy |
    | 6 | The Hive | `#8ec44a` (sickly green) | Organic, clustered — Drone swarms, irregular geometry |
    | 7 | The Void | `#b026d4` (magenta) | Empty, abyssal — sparse but dangerous, Phantom-heavy |
    | 8 | The Lattice | `#a8e8ff` (white-cyan) | Geometric, grid — open sight lines, ranged-combat favored |
    | 9 | The Stack | `#6a2eb8` (deep purple) | Vertical, layered — multi-level, Construct-heavy |
    | 10 | The Terminal | `#e83a3a` (red) | Corrupted, end-of-line — high-tier enemies, hostile terrain |
    | 11 | The Nursery | `#3ae8a8` (bioluminescent teal) | Growth, organic — Stalker ambushes, irregular growth |
    | 12 | The Crypt | `#d4d0c8` (bone-white) | Ancient, decay — Phantom and Null heavy, tomb-like |
  - [ ] The accent is set on floor load and does not change mid-floor.

### FR-26: Dynamic Audio Score

- **User story:** As a player, I want a five-layer synthesized score that responds to game state, so that audio carries the tactical and atmospheric information that the visuals do not.
- **Acceptance criteria:**
  - [ ] Five audio layers, zero audio files — everything synthesized via WebAudio.
  - [ ] **Drone layer:** sets the floor's ground; environment theme picks timbre and modal set; depth drops register and widens detune. Same theme at depth 4 and depth 24 is recognizable but under different pressure.
  - [ ] **Pulse layer:** tightens tempo and density as nearest hostile closes; injects dissonance (tritones, minor seconds, shortened note values) scaled by distance.
  - [ ] **Sparkle layer:** upper-register arpeggio; density and filter cutoff open as nearest container (treasure) nears.
  - [ ] **Lead layer:** carries the melody, generated bar by bar from `hash(worldSeed, depth, floorId, barIndex)` in the mode the theme selected.
  - [ ] **Noise bed:** tape hiss, wow, flutter at a fixed level — a machine property, not a readout. Tracks nothing.
  - [ ] No melodic bar repeats within a run — enforced by a rolling hash ledger with perturb-and-regenerate on collision.
  - [ ] Combat does not change the music; it transforms it — the same floor material at higher intensity. Continuity of theme, change of state.
  - [ ] The pitch-bias mechanism from the tarot ports to depth: one scalar, a slow glide (1.2s), a fixed subset of voices that follow (drone, pulse, sparkle) and a fixed subset that never do (noise bed, boot sequence).
  - [ ] Audio is fully disabled until the START gesture (browser requirement).
  - [ ] Audio is mutable per-layer and globally (see FR-31).

### FR-27: Run Library (Save System)

- **User story:** As a player, I want multiple runs to persist side by side, so that I can keep several parties going at once and choose which to continue.
- **Acceptance criteria:**
  - [ ] Any number of runs may persist in `localStorage` simultaneously.
  - [ ] Each run is saved as its **world seed + full run state** in `localStorage`. The seed is the primary key; the state is the resumable snapshot.
  - [ ] Each run is displayed in a library listing: seed, depth reached, party composition (sigils), accent swatch.
  - [ ] A run autosaves on combat start (pre-fight), on combat resolution, on loot pickup, and on floor transition.
  - [ ] A run persists until its party wipes; a live run is never automatically deleted.
  - [ ] There is no single save slot, no overwrite of one run by another, and no undo within a run.
  - [ ] The player can choose which run to open from the library.
  - [ ] On party wipe, the run's **state** is removed from the library, but the **seed remains accessible** — the player can share the seed as a world link (per FR-31) or restart at depth 1 with the same seed and a new party (per FR-31).
  - [ ] The same world seed may be used to start multiple independent runs (e.g., trying different party builds against the same dungeon). Each run is tracked separately by its seed + creation timestamp.

### FR-28: URL Save (Portable Save)

- **User story:** As a player, I want to copy my entire run state into a URL, so that I can resume on any device by pasting a link.
- **Acceptance criteria:**
  - [ ] Full run state encodes into a URL fragment: party, current HP and charge, inventory (max 100 items per FR-50), position, depth, flags, corruption, Echo queue, RNG cursor, scrap counter.
  - [ ] The URL fragment is under 1500 characters (survives any chat client).
  - [ ] Pasting the URL on any machine reconstructs the run bit-for-bit.
  - [ ] The encoding includes a checksum for integrity validation.
  - [ ] The encoding includes a version identifier for forward/backward compatibility handling.
  - [ ] **While the party is alive (mid-run), the player can share their full current state** via a "copy link" action (placement by Designer — LOG mode or a console action). The recipient pastes the link on any machine and resumes play from that exact point — same party, same depth, same inventory, same everything. This is the `#r=` (full run state) link.
  - [ ] After party wipe, full-state sharing is NOT available — the run state is gone (the party is dead). The scorecard (FR-31) offers only the seed-only `#w=` link.
  - [ ] The world-seed-only link (`#w=<seed>`) opens the character creation screen with that seed pre-loaded — a fresh run at depth 1 in the same world. No run state is carried. This link is available both mid-run (share the world without your progress) and post-wipe (from the scorecard).

### FR-29: Malformed Link Handling

- **User story:** As a player, I want to know why a pasted link failed, so that I can distinguish a corrupted link from a broken game.
- **Acceptance criteria:**
  - [ ] A truncated fragment produces a named failure screen: "Truncated — the link was cut short."
  - [ ] A version mismatch produces a named failure screen: "Version mismatch — this link was made by a different version."
  - [ ] A failed checksum produces a named failure screen: "Checksum failed — the link was corrupted in transit."
  - [ ] A hand-edited/malformed blob produces a named failure screen: "Malformed — the link is not a valid save."
  - [ ] No failure produces a silent reset to the title screen without explanation.
  - [ ] Where the seed is still readable from the failed state, the failure screen offers a fresh run in that same world.
  - [ ] The failure screen offers a return to the title screen.

### FR-30: Depth as Score & Threshold Floors

- **User story:** As a player, I want infinite depth with no win condition, so that the game is about how far I can get, not whether I can finish it.
- **Acceptance criteria:**
  - [ ] Depth is infinite — there is no final floor.
  - [ ] There is no win condition; a run resolves exactly one way: party wipe.
  - [ ] The depth reached at wipe is the entire score/result.
  - [ ] Threshold floors occur every tenth level (10, 20, 30, …).
  - [ ] Threshold floors guarantee: at least one elite enemy, at least one vault (high-value container), and a theme not yet seen in the run.
  - [ ] "Not yet seen" means a theme that has not appeared on any prior floor in this run; if all twelve have been seen, this guarantee is waived.

### FR-31: Run-End Screen (Scorecard)

- **User story:** As a player, I want a scorecard when my party dies, so that I can see how far I got and share the world that killed me.
  - **Acceptance criteria:**
  - [ ] On party wipe, the run is removed from the library.
  - [ ] A scorecard screen displays: final depth, party roster with sigils, cause of death, seed, scrap recovered.
  - [ ] The scorecard includes a share-the-world link carrying the seed alone (no run state).
  - [ ] The share link is copyable.
  - [ ] The scorecard offers: share world link, **restart with same seed** (same dungeon, new party creation at depth 1), start new run (fresh seed), return to title screen.
  - [ ] "Restart with same seed" sends the player to the character creation screen with the same world seed pre-loaded. The dungeon (floors, loot, enemies, themes) is identical; the party is new.
  - [ ] The scorecard does not offer a continue or retry of the dead run (no mid-run state restoration — the party wiped).
  - [ ] "Scrap Recovered" displays the total scrap value accumulated through the junk/salvage system (per FR-50).

### FR-32: The Echo

- **User story:** As a player, I want dead characters to return as enemies, so that death has a mechanical consequence and a chance at reclaiming lost gear.
- **Acceptance criteria:**
  - [ ] When a single character dies (not a party wipe), an Echo is queued in the run state.
  - [ ] The Echo appears 2–4 floors deeper than the death floor.
  - [ ] The Echo wears the dead character's sigil in red.
  - [ ] The Echo carries the dead character's equipment at the moment of death.
  - [ ] The Echo uses the dead character's class signature.
  - [ ] Killing the Echo reclaims the carried equipment.
  - [ ] The Echo is the only enemy that draws from the player sigil bank.
  - [ ] The Echo is the only reason the player sigil bank reservation rule has an exception.
  - [ ] Maximum two concurrent Echoes are queued at any time.
  - [ ] Echoes are deterministic given the run state (reconstructable from a save link).

### FR-50: Inventory Cap & Junk System

- **User story:** As a player, I want a hard inventory cap and a junk/salvage mechanic, so that inventory management is a meaningful decision and the save state stays portable.
- **Acceptance criteria:**
  - [ ] The party inventory is capped at **100 items** total (across all characters' unequipped items). This is a hard cap — no item can be picked up if inventory is full.
  - [ ] When inventory is full, the LOOT console mode warns the player and blocks item pickup until space is freed.
  - [ ] The player may **tag items as "junk"** in the LOOT or GEAR console mode. Tagging is a toggle — an item can be un-tagged.
  - [ ] A **"Junk All Tagged"** action destroys all tagged items and converts them to **scrap value**.
  - [ ] Each item has a `salvageValue` defined in `data/equipment.json` and `data/consumables.json` (by item type/category). The total scrap value of junked items is added to a run-wide **scrap counter**.
  - [ ] The scrap counter is displayed in the PARTY or GEAR console mode (placement by Designer).
  - [ ] The scrap counter contributes to the run-end scorecard (per FR-31) as a **"Scrap Recovered"** metric.
  - [ ] Junking an item is permanent — it cannot be undone. A confirmation prompt appears before "Junk All Tagged" executes.
  - [ ] The scrap counter is saved in the run state and reconstructable from a save link.
  - [ ] Consumable items have a salvage value equal to half their rarity-equivalent value (since consumables have no rarity tiers, a flat value per type is used).
  - [ ] The 100-item cap is a **design constraint**, not a technical limitation — it guarantees the URL save state is always encodable regardless of play depth or hoarding behavior.

### FR-51: Saved Party Configurations

- **User story:** As a player, I want to save party builds so I don't have to rebuild the same party from scratch every run, so that I can quickly re-run a favorite build or iterate on a concept without repeating the full 80-point buy each time.
- **Acceptance criteria:**
  - [ ] The player may **save the current party configuration** from the character creation screen before or after finalizing. A saved configuration captures: number of characters, each character's class, sigil, attributes, equipment, protocols, and the unspent-points-to-credits conversion. It does NOT capture any run state (depth, HP, inventory, etc.) — it is a creation blueprint only.
  - [ ] Saved configurations persist in `localStorage` (device-local, not part of the URL save pipeline).
  - [ ] The player may save up to **10 named configurations**. Names are player-assigned (text input).
  - [ ] Saved configurations are listed on the character creation screen with: name, party composition (sigils + classes), and points spent.
  - [ ] **New runs default to the last used configuration** — when the player enters character creation, the last finalized or loaded configuration is pre-loaded. The player can modify it, discard it, or select a different saved configuration.
  - [ ] Selecting a saved configuration loads it into the creation screen (all fields populated). The player may then modify it before finalizing — loading a configuration is non-destructive (the original save is not overwritten unless the player explicitly saves over it).
  - [ ] Saved configurations can be **deleted** from the creation screen. Deletion requires confirmation.
  - [ ] If a saved configuration becomes invalid due to a game version update (e.g., class-gate changes, equipment cost changes), the creation screen flags the invalid items and lets the player adjust before finalizing. The configuration is not silently discarded.
  - [ ] Saved configurations are **meta-game data** — they are not part of the run state, not saved in the URL fragment, and not affected by party wipe or run deletion.
  - [ ] A first-time player (no saved configurations) starts with a blank creation screen as before.

### FR-33: Offline-First / Service Worker

- **User story:** As a player, I want the game to work fully offline after first load, so that I can play on a plane, a subway, or anywhere without signal.
  - **Acceptance criteria:**
  - [ ] A service worker is registered on first load.
  - [ ] Cache-first strategy: all assets are served from cache on subsequent loads.
  - [ ] The game is fully playable offline after the first successful load.
  - [ ] Total transfer on first load is under 500 KB.
  - [ ] The service worker caches: the HTML shell, all JS modules, all CSS, the sigil WOFF2, and `data/sigils.json`.
  - [ ] No third-party CDN or external request is made at any point.

### FR-34: Settings

- **User story:** As a player, I want control over audio levels and visual effects, so that I can tailor the experience to my preference and accessibility needs.
- **Acceptance criteria:**
  - [ ] Settings are accessible from the title screen and during play (via console or a dedicated control — placement by Designer).
  - [ ] **Master mute:** toggles all audio on/off.
  - [ ] **Per-layer volume:** five sliders (drone, pulse, sparkle, lead, noise bed), each 0–100%.
  - [ ] **Glitch toggle:** disables all glitch effects (substitution, ghosts, VHS events, jitter, flicker, flash, bars, noise lines).
  - [ ] **Reduced-motion override:** manually enables or disables reduced-motion mode (independent of `prefers-reduced-motion` media query). When reduced-motion is active, all glitch and transition animations are disabled.
  - [ ] **Scanline/grain toggle:** independently disables scanlines and grain (separate from the glitch toggle — some players want the CRT frame without the texture).
  - [ ] Settings persist in `localStorage` across sessions.
  - [ ] The settings list is final and enumerated — no additional settings are in scope for v1.

### FR-35: Adaptive Layout System

- **User story:** As a player, I want the UI to be optimal at whatever resolution I'm playing at — a phone-shaped column on a phone, a three-region desktop dock on a desktop — so that the vertical-descent premise reads on any screen and no viewport is wasted on dead margins.
- **Acceptance criteria:**
  - [ ] The UI has exactly two layout classes: `portrait` (default) and `wide`.
  - [ ] `wide` is selected by the media query `(min-width: 900px) and (min-aspect-ratio: 1/1)`. All other viewports use `portrait`.
  - [ ] There is exactly one breakpoint (the class switch). No other breakpoint reflows the layout within a class.
  - [ ] Within a class the layout is **fluid**: the portrait frame fills the viewport width up to the class boundary (no fixed 450px cap in production); the wide grid regions flex around their minmax bounds.
  - [ ] Class-independent design tokens: palette, typography scale, sigil sizes, spacing scale, corner radii, shadow/glow levels, CRT/glitch timing constants (per FR-23), and bus event names are identical in both classes.
  - [ ] Wide game screens (exploration, combat) use a three-region grid: **telemetry dock** (left) · **playfield column** (center, portrait-proportioned 9:16 aspect anchored to viewport height) · **console dock** (right). Grid template columns: `minmax(280px, 1fr) minmax(320px, calc(100vh * 9 / 16)) minmax(360px, 1.2fr)` (canonical definition in `specs/design.md` §Adaptive Layout System).
  - [ ] The wide playfield column preserves the portrait 9:16 aspect ratio so the vertical-descent premise reads in every class.
  - [ ] The wide console dock is **always expanded**; the collapse state does not exist in `wide`.
  - [ ] The wide console dock's seven mode tabs (MOVE, COMBAT, PARTY, GEAR, TECH, LOOT, LOG) stack vertically along the dock's inner edge; disabled-tab behavior (COMBAT during exploration, LOOT during combat, etc.) is preserved.
  - [ ] Every action reachable in the portrait bottom-pinned expanded console is reachable in the wide right-anchored console dock — full parity, upholding the parity criteria in FR-15 (§lines 249–260) in both classes.
  - [ ] Every action is reachable by keyboard and by touch in both classes (per FR-15).
  - [ ] The `ui:mode-change` bus event fires identically in both classes; a single subscriber contract serves both class UIs.
  - [ ] The wide telemetry dock stacks the status-strip fields vertically at the top (same fields, same accessibility guarantees — danger clock stays numeric, never color-only) and streams a **persistent live LOG feed** below (same `.log-entry` container, same log-severity classes, same `[T:NNN]` timestamp prefix, same sticky "◈ Event Log — Floor NN" header, same auto-scroll-to-newest behavior as FR-22 LOG mode).
  - [ ] The full LOG history and the copy-link action remain reachable via LOG mode in the console dock (the telemetry-dock feed is a live tail, not a replacement for LOG mode).
  - [ ] The CRT/VHS effect overlay (scanlines, vignette, aperture grille, tracking band, grain, border flicker, frame flash, glitch bars, noise lines, VHS events, per-element text glitch) covers the **full viewport** in both classes — no letterboxed column and no dead margins in `wide`.
  - [ ] Touch-capable rows keep the 96px minimum hit height in **both** classes (per FR-15 and the Spacing System floor in `specs/design.md`).
  - [ ] Pointer-only affordances in `wide` may densify to a 44px minimum hit height — never below.
  - [ ] Wide non-game screens each use the width purposefully per the per-screen matrix in `specs/design.md` §Screen Layouts by Class: title = centered column with wider ornament field; creation = roster/editor two-pane; library = run-card grid; scorecard = summary/share two-pane; settings = two-column form; tutorial = two-page spread; import = centered column (unchanged width).
  - [ ] The `wide-` CSS class prefix is reserved for wide-only structures (e.g. `.wide-shell`, `.wide-telemetry-dock`, `.wide-console-dock`, `.wide-mode-tab`) so tooling can distinguish planned-only structures from portrait-shipped ones.
  - [ ] The playfield remains a readout, not a control surface, in both classes (per FR-15).

### FR-36: Neon-on-Violet Palette & Glow

- **User story:** As a player, I want a neon-on-violet visual palette with glow on every element, so that the CRT aesthetic is cohesive.
- **Acceptance criteria:**
  - [ ] Base palette: neon-on-violet, ported from Universal Operator's Tarot.
  - [ ] Glow effect on every rendered element (text, borders, sigils, UI controls).
  - [ ] The `◈` ornament is the signature decorative element.
  - [ ] The `◈` ornament is drawn with CSS/SVG, never with a bank glyph.
  - [ ] Per-floor accent color overrides the accent portions of the palette via a single CSS custom property.

### FR-37: Core Attributes

- **User story:** As a player, I want a small set of attributes that govern all mechanical outcomes, so that my point-buy decisions have legible, predictable effects on combat, magic, and survival.
- **Acceptance criteria:**
  - [ ] Six core attributes exist, each on a 1–10 scale:
    - **MIGHT (MGT)** — physical force: melee damage, carrying capacity, forced-movement resistance, athletics checks.
    - **FINESSE (FIN)** — precision and speed: ranged accuracy, initiative modifier, stealth, reflex-based saves.
    - **VITALITY (VIT)** — endurance: HP base, HP growth per calibration, poison/disease resistance, stamina.
    - **RESONANCE (RES)** — attunement to tech systems: CHARGE pool, protocol power (tier-effect scaling), CHARGE regen rate.
    - **FOCUS (FOC)** — mental acuity: protocol accuracy (protocol attack rolls), perception, save vs. mental conditions, overclock success chance.
    - **SIGNAL (SIG)** — reach and influence: protocol range, detection radius, social/command checks, deployment awareness.
  - [ ] Each attribute starts at rank 3 (baseline human) and is raised via point-buy at creation and via calibrations in-run.
  - [ ] Attribute rank costs scale: ranks 3→6 cost 1 point each; ranks 7→8 cost 2 points each; ranks 9→10 cost 3 points each.
  - [ ] No attribute may exceed rank 10 at character creation (hard cap).
  - [ ] No attribute may be reduced below rank 1 at character creation.
  - [ ] Each class designates one primary attribute (see FR-45); the primary attribute's calibration upgrades cost 1 fewer point (minimum 1).
  - [ ] The attribute-to-mechanic mapping is exhaustive — every die roll in the game resolves against one of these six attributes.
  - [ ] Derived stats computed from attributes at all times:
    - **HP** = `(VIT × 4) + classHitDieBase` (see FR-39).
    - **CHARGE pool** = `(RES × 3) + classChargeBase` (see FR-39).
    - **CHARGE regen** = `floor(RES / 3)` per floor descent (applied on floor transition, not per-turn).
    - **Initiative modifier** = `FIN modifier` (i.e., `FIN - 5`; added to d20 initiative roll). See FR-38.
    - **Defense** = `10 + FIN modifier + armor bonus + shield bonus + cover bonus + condition modifiers` (where FIN modifier = `FIN - 5`). See FR-38 for the full resolution formula.
    - **Protocol save DC** = `10 + FOC modifier + protocol tier` (where FOC modifier = `FOC - 5`; the DC hostile enemies roll against). This uses the modifier, consistent with all other d20 resolution in the game.
    - **Melee accuracy** = `MGT modifier` (i.e., `MGT - 5`; added to d20 attack roll for melee weapons). See FR-38.
    - **Ranged accuracy** = `FIN modifier` (i.e., `FIN - 5`; added to d20 attack roll for ranged weapons). See FR-38.
    - **Protocol accuracy** = `FOC modifier` (i.e., `FOC - 5`; added to d20 attack roll for hostile-targeted protocols). See FR-38.
    - **Overclock success threshold** = `11 + (2 × tier)` on a d20 roll, modified by `+FOC modifier` (where FOC modifier = `FOC - 5`); a successful overclock adds the extra tier; a failed overclock adds 0.05 corruption (per FR-14).
    - **Detection radius** = `SIG × 2` cells (the radius in which hostiles become aware of the party during exploration; also the radius in which the party detects containers/features via auto-stop).

### FR-38: Resolution Mechanics (d20 Core)

- **User story:** As a player, I want a transparent d20 resolution system, so that I can predict outcomes and plan tactical decisions without hidden math.
- **Acceptance criteria:**
  - [ ] All attack rolls, save rolls, and contested checks use a d20 + attribute modifier vs. a target number.
  - [ ] The attribute modifier for a rank-N attribute is `N - 5` (so rank 5 = +0, rank 8 = +3, rank 10 = +5, rank 1 = -4).
  - [ ] **Attack roll (melee):** `d20 + MGT modifier + weapon accuracy bonus` vs. target Defense. If roll ≥ Defense, the attack hits.
  - [ ] **Attack roll (ranged):** `d20 + FIN modifier + weapon accuracy bonus` vs. target Defense, modified by range band penalties (see FR-11, FR-42).
  - [ ] **Attack roll (protocol):** `d20 + FOC modifier` vs. target Protocol Defense (see FR-39 for hostile Protocol Defense). If roll ≥ target's Protocol Defense, the protocol hits.
  - [ ] **Damage (melee weapon):** weapon damage die + MGT modifier.
  - [ ] **Damage (ranged weapon):** weapon damage die (no attribute modifier to damage; precision, not force, governs ranged).
  - [ ] **Damage (protocol — DISRUPT):** `protocol base damage × tier + RES modifier`, where "protocol base damage" is the die listed at tier 1 in FR-47 (d6 for SPARK). The FR-47 table lists the *total* effect at each tier (already incorporating the tier multiplier), so STORM (tier 3) deals `d6 × 3 = 3d6 + RES modifier` total. Overclock adds one extra tier of effect (so overclocked STORM = 4d6 + RES modifier).
  - [ ] **Healing (protocol — WARD):** `protocol base heal × tier + RES modifier`, where "protocol base heal" is the die listed at tier 1 in FR-47 (d6 for PATCH). The FR-47 table lists the total heal at each tier. REGEN is a special case: it heals `1d6 + RES modifier` per turn for a number of turns equal to the protocol's tier (so REGEN at tier 4 heals for 4 turns). The per-turn heal does not multiply by tier — only the duration scales.
  - [ ] **Duration/effect (protocol — SCRY/REWRITE):** `protocol base duration × tier` for timed effects (e.g., PING at tier 1 reveals for 1 turn; at tier 3 it would reveal for 3 turns). Untimed effects (REVEAL, REFORMAT) scale by area or target count rather than duration — see FR-47 table for per-tier specifics.
  - [ ] **Save roll:** `d20 + relevant attribute modifier` vs. effect DC. The relevant attribute is specified per effect (VIT for poison, FOC for mental, FIN for area/blast, MGT for forced movement).
  - [ ] **Natural 1:** an attack roll of natural 1 is an automatic miss and triggers an opportunity attack from any adjacent enemy (fumble).
  - [ ] **Natural 20:** an attack roll of natural 20 is an automatic hit and deals maximum weapon/protocol damage (critical).
  - [ ] **Defense** is the target number for incoming attacks: `10 + FIN modifier + armor bonus + shield bonus + cover bonus + condition modifiers`.
  - [ ] **Protocol Defense** is the target number for incoming hostile-targeted protocols: `10 + FOC modifier + any WARD protocol bonus`. Hostiles use their own FOC equivalent (see FR-43).
  - [ ] All rolls use the run's deterministic PRNG — the same run state produces the same roll sequence.
  - [ ] The LOG (FR-22) records every d20 roll, the attribute used, the modifier, the target, and the outcome (hit/miss, damage dealt).

### FR-39: HP, CHARGE, and Advancement

- **User story:** As a player, I want clear HP and CHARGE pools that grow as I descend, so that my character feels stronger at depth 20 than depth 1 without a traditional leveling system.
- **Acceptance criteria:**
  - [ ] **HP formula:** `HP = (VIT × 4) + classHitDieBase`.
  - [ ] **Class hit die bases:** Breacher 16, Anchor 14, Operator 12, Ghost 10, Compiler 8, Oracle 6.
  - [ ] **HP growth per calibration:** on each calibration, the character gains HP equal to their class hit die base ÷ 2 (rounded down, minimum 2). This is the in-run HP scaling.
  - [ ] **HP is not restored on calibration** — calibrations raise the maximum; current HP does not auto-fill.
  - [ ] **CHARGE pool formula:** `CHARGE = (RES × 3) + classChargeBase`.
  - [ ] **Class charge bases:** Oracle 8, Compiler 6, Operator 4, Ghost 2, Breacher 0, Anchor 0.
  - [ ] **CHARGE regen:** `floor(RES / 3)` CHARGE restored on each floor descent (applied at floor transition, not per combat turn).
  - [ ] **CHARGE cannot exceed the pool maximum.** Regen that would exceed the cap is lost.
  - [ ] **Calibration count replaces "level"** throughout the system. A character's effective level for scaling purposes is `calibrationCount + 1`.
  - [ ] **Calibration options** (chosen every 3rd floor, per FR-4) offer a mix of:
    - Attribute rank increase (cost handled internally by calibration, not the point-buy pool).
    - HP maximum increase (hit die ÷ 2).
    - New protocol slot or deck expansion.
    - Class-specific signature upgrade (the signature ability improves at calibrations 2 and 4).
    - Equipment proficiency expansion (unlock a weapon/armor category outside class default).
  - [ ] A calibration presents 3 options; the player chooses 1. Options are deterministic given `(worldSeed, characterId, floorNumber)`.
  - [ ] There is no XP, no kill-based leveling, and no external advancement trigger other than reaching a calibration floor.

### FR-40: Depth Scaling

- **User story:** As a player, I want the dungeon to get meaningfully harder as I descend, so that depth is a real measure of skill and build quality, not just time spent.
- **Acceptance criteria:**
  - [ ] **Enemy stat scaling:** all enemy base stats scale with depth using the formula: `scaledStat = baseStat × (1 + depth × 0.15)`. This applies to HP, attack bonus, defense, and protocol defense.
  - [ ] **Enemy count scaling:** the number of enemies per encounter scales as: `baseCount + floor(depth / 5)`. Base count is set by the environment theme's `enemyMixWeights` and the floor's archetype.
  - [ ] **Loot quality scaling:** loot rarity rolls shift upward with depth. At depth 1, common items are most likely. Every 5 floors, the rarity distribution shifts one tier toward rare. At depth 20+, CORRUPT items become possible in standard containers (not just vaults).
  - [ ] **Danger clock base rate:** the danger clock's base rate (before corruption modifiers) scales as: `baseRate × (1 + depth × 0.05)`. Deeper floors are inherently more dangerous even without corruption.
  - [ ] **CHARGE regen does not scale with depth** — it remains `floor(RES / 3)` per floor descent regardless of depth. This creates increasing resource pressure.
  - [ ] **HP does not auto-scale with depth** — it only grows via calibrations. The depth-scaling enemy stats outpace natural HP growth, creating the core difficulty curve.
  - [ ] **Calibration floors (3, 6, 9, …)** are the inflection points where the player gains ground against the scaling curve. Between calibrations, the curve steepens.
  - [ ] **Threshold floors (10, 20, 30, …)** apply an additional difficulty spike: the enemy stat scaling multiplier increases by +0.10 cumulatively at each threshold. At depth 10, the multiplier increases from 0.15 to 0.25 (formula: `1 + depth × 0.25`). At depth 20, it increases to 0.35 (formula: `1 + depth × 0.35`). At depth 30, it increases to 0.45 (formula: `1 + depth × 0.45`). The general formula at threshold floors is: `scaledStat = baseStat × (1 + depth × (0.15 + 0.10 × floor(depth / 10)))`.
  - [ ] All scaling is deterministic and computable from depth alone — no hidden difficulty variables.
  - [ ] The scaling curve is designed so that a well-built party can reach approximately depth 20–30 with strong play, and depth 50+ requires exceptional builds and play. These targets are balance assumptions to be validated at playtest (per Open Questions 4 and 5).

### FR-41: Economy & Credits

- **User story:** As a player, I want the point-buy economy to be the only economy, so that the game has no shops, no vendors, and no grind — just the initial build decision and what I find in the dark.
- **Acceptance criteria:**
  - [ ] Unspent creation points convert to credits at a 10:1 ratio (1 point = 10 credits), as per FR-3.
  - [ ] Credits have no in-run use other than the conversion at character creation. There are no shops, no vendors, no credit sinks.
  - [ ] Credits are included in the run state and saved to the URL fragment, but their value is fixed at creation.
  - [ ] Credits are displayed in the PARTY or GEAR console mode (placement by Designer) but have no interactive affordance.
  - [ ] The absence of vendors and shops is a hard constraint (per the idea doc's non-goals) — not a deferred feature.

### FR-42: Equipment System

- **User story:** As a player, I want weapon and armor categories with distinct mechanical profiles, so that equipment choices create real tactical trade-offs rather than flat stat upgrades.
- **Acceptance criteria:**
  - [ ] **Weapon categories** (each with a damage die, range band, accuracy bonus, and class-gate list):
    | Category | Damage Die | Range Band | Accuracy Bonus | Gated To |
    |---|---|---|---|---|
    | Sidearm (melee) | d6 | adjacent (1 cell) | +1 | All classes |
    | Heavy melee | d10 | adjacent (1 cell) | +0 | Breacher, Anchor |
    | Polearm (melee) | d8 | reach (2 cells) | +0 | Breacher, Anchor, Operator |
    | Light ranged | d6 | short (1–4 cells) | +1 | All classes |
    | Heavy ranged | d10 | medium (1–8 cells) | +0 | Ghost, Operator |
    | Sniper | d8 | long (3–16 cells) | -1 (at short range), +1 (at long range) | Ghost |
    | Area projector | d6 × target | blast (1–3 cells, AoE) | +0 | Compiler, Oracle |
    | Shield (off-hand) | — | — | — (grants +2 Defense, occupies a hand) | Breacher, Anchor, Operator |
  - [ ] **Range bands** (per FR-11): adjacent (1 cell), short (1–4), medium (1–8), long (3–16), blast (AoE within 1–3 cells). Weapons fired outside their maximum range miss automatically. Weapons fired below their minimum range (for sniper) take a penalty.
  - [ ] **Armor categories:**
    | Category | Defense Bonus | Max FIN Penalty | Gated To |
    |---|---|---|---|
    | None | +0 | 0 | All |
    | Light | +1 | 0 | All |
    | Medium | +3 | -1 FIN | All (Breacher, Anchor ignore penalty) |
    | Heavy | +5 | -2 FIN | Breacher, Anchor only |
  - [ ] The FIN penalty from armor reduces the character's effective FIN for Defense, initiative, and ranged accuracy purposes.
  - [ ] **Equipment costs at creation:**
    | Tier | Cost (points) | Example |
    |---|---|---|
    | Basic | 1 | Sidearm, light armor, light ranged |
    | Standard | 2 | Heavy melee, medium armor, polearm |
    | Advanced | 3 | Heavy ranged, heavy armor, shield |
    | Specialist | 4 | Sniper, area projector |
  - [ ] A character may equip one weapon and one armor at a time (plus one off-hand: shield or secondary sidearm).
  - [ ] Equipment is class-gated at creation. In-run, calibrations can expand proficiency (per FR-39).
  - [ ] Loot items (per FR-13) override the base stats with affix-modified values. A CORRUPT heavy ranged weapon retains its category (d10, medium range) but has enhanced affix-driven stats.
  - [ ] Equipment swapping is available via GEAR mode (FR-19) and does not consume combat time outside of the character's turn.

### FR-43: Enemy System

- **User story:** As a player, I want enemies with distinct archetypes and stat blocks, so that combat encounters require reading the enemy and adapting tactics, not just out-stating them.
- **Acceptance criteria:**
  - [ ] Each enemy archetype has a full six-attribute array (MGT, FIN, VIT, RES, FOC, SIG) on a 1–10 scale, same as player characters. All derived stats (Defense, Protocol Defense, HP, initiative, accuracy, save modifiers) use the same formulas as player characters (per FR-37 and FR-38).
  - [ ] **Eight enemy archetypes** exist (matching the eight floor-generation archetypes for thematic coherence — not a 1:1 mapping, but thematically linked):
    | Archetype | Role | MGT | FIN | VIT | RES | FOC | SIG | HP Bonus | Behavior |
    |---|---|---|---|---|---|---|---|---|---|
    | Drone | Swarm minion | 3 | 5 | 2 | 1 | 2 | 3 | +0 | Pack tactics; swarms in groups, low individual threat |
    | Warden | Guard defender | 6 | 3 | 6 | 1 | 3 | 2 | +4 | Holds position, high defense, blocks corridors |
    | Stalker | Ambush skirmisher | 4 | 7 | 3 | 2 | 4 | 4 | +2 | High mobility, flanks, retreats when isolated |
    | Choir | Caster artillery | 2 | 4 | 3 | 7 | 5 | 4 | +0 | Casts protocols at range, low HP, high priority target |
    | Null | Disruptor controller | 3 | 4 | 4 | 3 | 7 | 5 | +2 | Applies conditions, debuffs, area denial; high save DC |
    | Construct | Tank bruiser | 7 | 2 | 8 | 2 | 2 | 2 | +8 | Slow, high HP, high damage, melee only |
    | Phantom | Ghost elusive | 4 | 6 | 3 | 3 | 4 | 7 | +2 | Phasing movement (ignores some terrain), hard to hit |
    | Apex | Elite boss | 6 | 6 | 7 | 5 | 5 | 5 | +12 | Threshold-floor guardian; multi-action, high all-around |
  - [ ] **Enemy HP** = `(VIT × 4) + archetypeHPBonus`, then scaled by depth per FR-40. (Same HP formula as player characters, plus an archetype-specific HP bonus to differentiate roles.)
  - [ ] **Enemy attack rolls** use the same d20 system as players: `d20 + relevant attribute modifier` (MGT for melee, FIN for ranged, FOC for protocol) vs. target Defense.
  - [ ] **Enemy Defense** = `10 + FIN modifier` (same formula as players; no armor bonus unless the archetype is defined as armored — Drones and Constructs count as having medium armor (+3 Defense, −1 FIN penalty to effective FIN). All other archetypes are unarmored.
  - [ ] **Enemy Protocol Defense** = `10 + FOC modifier`, scaled by depth (per FR-40).
  - [ ] **Enemy initiative** = `d20 + FIN modifier` (same as players).
  - [ ] Enemies do not have CHARGE or protocols, except Choir (casts protocols using RES) and Null (applies conditions using FOC). Their protocol effects use the same tier/damage math as player protocols.
  - [ ] **Choir protocol access:** The Choir has a CHARGE pool equal to `(Choir's RES × 2) + depth` (so it scales with depth). It may cast DISRUPT and SCRY protocols only, up to tier 3. Protocol attack rolls use the Choir's FOC modifier (same as player characters, per FR-38): `d20 + FOC modifier` vs. target Protocol Defense. Protocol damage uses the Choir's RES modifier (same as player characters): `base die × tier + RES modifier`. The Choir selects targets using the same AI priority rules (nearest character, tiebreaker to lowest HP). CHARGE regenerates at 1 per turn for the Choir (not per-floor like the player). If the Choir lacks sufficient CHARGE for any protocol, it falls back to a melee attack using its MGT modifier.
  - [ ] **Null condition application:** The Null does not cast protocols. Instead, it applies conditions directly via a `d20 + FOC modifier` roll (where FOC modifier = `Null's FOC - 5`) vs. the target's save (using the condition's specified save attribute per FR-44). The Null may apply any of the following conditions: JAMMED, OVERLOADED, IMMOBILIZED, PANICKED, and MARKED. The condition selection is deterministic via the run's PRNG, weighted toward JAMMED and OVERLOADED. Applying a condition costs the Null 1 AP (it has 2 AP per turn like all enemies). The Null has a cooldown of 1 turn between condition applications (it cannot apply conditions on consecutive turns). On cooldown turns, the Null uses its melee attack.
  - [ ] **Apex enemies** appear on threshold floors (per FR-30) and are always present as the guaranteed elite. They have 2 AP, one move action, and may act twice per round (double initiative).
  - [ ] **Echo enemies** (per FR-32) use the dead character's full stat block (attributes, class, equipment, signature) at the moment of death. The Echo is treated as an enemy for scaling purposes: all derived stats (HP, attack bonus, Defense, Protocol Defense, initiative, CHARGE if applicable) are scaled using the enemy depth-scaling formula from FR-40: `scaledStat = originalStat × (1 + encounterDepth × (0.15 + 0.10 × floor(encounterDepth / 10)))`, where `encounterDepth` is the floor where the Echo appears. Raw attributes (1–10) remain frozen at the death values — only derived stats are scaled. The Echo retains the dead character's class signature ability (including tier progression at time of death) and equipment (with their affixes). The Echo does not have access to consumable items or calibrations the character never used.
  - [ ] Enemy AI follows simple, deterministic priority rules (not complex behavior trees):
    - If hostile to party in LOS: close to optimal range, attack.
    - If below 25% HP: attempt to retreat (except Drones, Constructs, and Apex).
    - If allied with a Choir/Null: protect them at medium priority.
    - Priority target selection: nearest character, with tiebreaker to lowest-HP character.
  - [ ] Enemy AI decisions are deterministic given the run's PRNG state — a loaded save produces identical AI behavior.

### FR-44: Conditions (Nine)

- **User story:** As a player, I want a fixed set of nine conditions that create tactical decisions beyond raw damage, so that positioning, timing, and party composition interact with a shared status vocabulary.
- **Acceptance criteria:**
  - [ ] Exactly nine conditions exist. No tenth condition is in scope for v1.
  - [ ] Each condition has: a name, an effect, a duration model, a source (what applies it), and a save (what resists it).
  - [ ] The nine conditions:
    | # | Name | Effect | Duration | Applied By | Save |
    |---|---|---|---|---|---|
    | 1 | JAMMED | Target cannot use protocols (CHARGE spending blocked). | 2 turns | Null, overclock failure (self) | FOC |
    | 2 | OVERLOADED | Target takes +50% damage from all sources. | 2 turns | DISRUPT protocols, area projector | RES |
    | 3 | SHIELDED | Target gains +4 Defense and immunity to the next condition applied. Consumed on use. | Until consumed or 3 turns | WARD protocols | — |
    | 4 | BLINDED | Target's LOS reduced to 1 cell. Ranged attacks take -4. | 2 turns | SCRY protocols, environment hazard | FIN |
    | 5 | IMMOBILIZED | Target cannot move (move action consumed). Can still act with AP. | 1 turn | Heavy melee critical, polearm, WARD protocols | MGT |
    | 6 | CORRODED | Target loses 2 Defense per turn (cumulative, min Defense 2). | 3 turns | Environment hazard, CORRUPT weapon hit | VIT |
    | 7 | MARKED | Target is visible to all hostiles regardless of LOS. Hostiles gain +2 to attack rolls against MARKED target. | 3 turns | SCRY protocols, Stalker ability | — (no save) |
    | 8 | PANICKED | Target must move away from nearest hostile on its turn (forced retreat). Cannot attack. | 1 turn | Null, environment hazard | FOC |
    | 9 | BURNING | Target takes d6 damage at the start of its turn for 3 turns. Stacks (renewing duration). | 3 turns | Area projector, CORRUPT weapon, environment | VIT |
  - [ ] Conditions are displayed in the COMBAT and PARTY console modes using text labels (not color alone, per accessibility NFRs).
  - [ ] A SHIELDED target consumes the shield on the next condition applied, then the SHIELDED condition is removed.
  - [ ] BURNING is the only stackable condition; each application refreshes duration and adds a stacking d6.
  - [ ] Conditions do not persist between floors — all conditions are cleared on floor transition.
  - [ ] Conditions are saved in the run state and reconstructable from a save link.

### FR-45: Class Signatures

- **User story:** As a player, I want each class to have a mechanically distinct identity from floor 1, so that my class choice changes how I play, not just what numbers I have.
- **Acceptance criteria:**
  - [ ] Each class has a signature ability active from floor 1 (no unlock required).
  - [ ] Each class signature improves at calibration 2 (floor 6) and calibration 4 (floor 12), creating a three-tier progression within the run.
  - [ ] **Class definitions:**

  - [ ] **Breacher** — Primary attribute: MGT. Hit die: 16. Charge base: 0.
    - *Signature: BREACH* — The Breacher ignores cover when attacking (cover bonus does not apply against Breacher attacks). At tier 2 (cal 2): Breacher attacks also ignore SHIELDED. At tier 3 (cal 4): Breacher gains a free melee attack after moving (one per turn, does not consume AP).
    - *Gates:* Heavy melee, heavy armor, polearm, shield. No protocols above tier 2. No light ranged.
    - *Role:* Frontline damage and armor penetration. The answer to Warden-blocked corridors and cover-camping enemies.

  - [ ] **Ghost** — Primary attribute: FIN. Hit die: 10. Charge base: 2.
    - *Signature: PHASE* — The Ghost may move through one wall cell per move action (phasing). Phased movement does not trigger opportunity attacks. At tier 2: Ghost gains +2 to initiative. At tier 3: Ghost may phase through 2 wall cells per move action.
    - *Gates:* Sniper, heavy ranged, light armor only. No heavy melee, no shield. Protocols: SCRY and DISRUPT only.
    - *Role:* Positioning, ranged burst, flanking. The answer to tight mazes and enemies that hide behind Wardens.

  - [ ] **Compiler** — Primary attribute: RES. Hit die: 8. Charge base: 6.
    - *Signature: COMPILE* — The Compiler's protocol overclocks cost 1 CHARGE less (minimum 1). At tier 2: Compiler's failed overclocks do not add corruption (the only class immune to overclock corruption). At tier 3: Compiler may overclock two tiers at once (triple CHARGE cost, no corruption roll needed — automatic success).
    - *Gates:* Area projector, light armor, polearm. No heavy armor, no shield, no sniper. Protocols: all four schools.
    - *Role:* Magic powerhouse, overclock economy. The answer to dense enemy formations and high-defense targets.

  - [ ] **Anchor** — Primary attribute: VIT. Hit die: 14. Charge base: 0.
    - *Signature: HOLD* — The Anchor and all allies within 2 cells gain +2 Defense. At tier 2: The bonus extends to 4 cells and allies in range also gain +1 to saves. At tier 3: The Anchor may project HOLD as a WARD protocol (applies SHIELDED to one ally at CHARGE cost 2).
    - *Gates:* Heavy melee, polearm, shield, medium/heavy armor. No ranged weapons above light. Protocols: WARD only.
    - *Role:* Defensive anchor, party protection, corridor control. The answer to Choir artillery and Null debuffs.

  - [ ] **Oracle** — Primary attribute: FOC. Hit die: 6. Charge base: 8.
    - *Signature: FORESEE* — The Oracle sees all enemies within SIG × 3 cells regardless of LOS (telepathic detection). At tier 2: The Oracle may reroll one d20 per combat (attack or save) and keep the higher result. At tier 3: The Oracle reveals all containers and the descent point on floor entry (no exploration required to find them).
    - *Gates:* Area projector, light ranged, light armor only. No melee above sidearm, no shield. Protocols: SCRY and REWRITE.
    *Role:* Information, save support, condition caster. The answer to ambush Stalkers and hidden containers.

  - [ ] **Operator** — Primary attribute: SIG. Hit die: 12. Charge base: 4.
    - *Signature: OVERLAY* — The Operator boosts one ally's next attack roll by +3 (once per round, free action, does not consume AP). At tier 2: The Operator may instead boost a protocol roll. At tier 3: The Operator grants all allies +1 to all d20 rolls for one turn (once per combat).
    - *Gates:* Polearm, light/heavy ranged, light/medium armor, shield. No heavy melee, no heavy armor. Protocols: DISRUPT and WARD.
    - *Role:* Support, buff economy, flexible coverage. The answer to coordination-dependent builds and mixed-range parties.

  - [ ] The primary attribute designation means: that attribute's rank-up cost in calibrations is reduced by 1 (minimum 1 point). This is the only class-specific calibration cost effect.
  - [ ] Signature upgrades at calibrations 2 and 4 are automatic — they do not consume a calibration choice. The player still chooses a calibration option (per FR-39) and separately receives the signature upgrade.
  - [ ] The class-gate lists constrain equipment and protocol purchases at character creation. In-run calibrations can expand these (per FR-39: "Equipment proficiency expansion").
  - [ ] The six classes are final — no seventh class is in scope for v1.

### FR-46: Rest & Resource Recovery

- **User story:** As a player, I want a resource recovery model that creates pressure without frustration, so that each floor feels like a self-contained tactical challenge within a longer resource war.
- **Acceptance criteria:**
  - [ ] **HP does not regen passively.** HP is only restored by WARD protocols, items with healing affixes, or consumable items found in containers.
  - [ ] **CHARGE regen:** `floor(RES / 3)` per floor descent (per FR-39). This is the only CHARGE recovery mechanism.
  - [ ] **Conditions clear on floor transition** (per FR-44). Moving to a new floor removes all conditions from all characters.
  - [ ] **No "rest" action exists.** There is no camp, no wait, no sleep mechanic. The only resource reset is floor descent.
  - [ ] **No full-heal on floor transition.** HP carries over between floors. A wounded party descending is wounded on the next floor.
  - [ ] **Consumable items** found in loot containers may restore HP, CHARGE, remove conditions, or provide combat buffs. These are single-use and consumed on use. See FR-49 for the full consumable item system.
  - [ ] The resource model creates a death-spiral risk: a party that takes heavy damage on one floor carries that damage to the next. This is intentional and is the primary non-combat pressure mechanic.

### FR-47: Protocol Catalog

- **User story:** As a player, I want to know what each protocol does, so that my CHARGE spending and deck-building decisions are informed by concrete effects rather than abstract school names.
- **Acceptance criteria:**
  - [ ] Twenty protocols exist: four schools × five tiers.
  - [ ] CHARGE cost per protocol = `tier × 2`.
  - [ ] Overclocking a protocol costs double CHARGE (`tier × 4`) and requires a `d20 + FOC modifier` roll vs. `11 + (2 × tier)` (per FR-37). Success adds one extra tier of effect; failure adds 0.05 corruption (per FR-14).
  - [ ] Protocol range = `SIG × 2` cells for targeted protocols (unless otherwise noted). AoE protocols use a fixed radius listed per protocol.
  - [ ] Protocols are class-gated at creation per FR-45 (e.g., Breacher: DISRUPT only, max tier 2; Oracle: SCRY and REWRITE; etc.).

  **DISRUPT (offensive — deal damage, apply conditions)**

  All DISRUPT damage = `base die × tier + RES modifier`. The die shown below is the tier-1 base; multiply by tier for the actual roll.
  | Tier | Name | CHARGE | Range | Effect |
  |---|---|---|---|---|
  | 1 | SPARK | 2 | SIG×2 | Deal 1d6 + RES modifier damage to one target. |
  | 2 | SURGE | 4 | SIG×2 | Deal 2d6 + RES modifier to one target; d4 splash to all enemies adjacent to target. |
  | 3 | STORM | 6 | 3-cell radius | Deal 3d6 + RES modifier to all enemies in radius. |
  | 4 | CASCADE | 8 | SIG×2 | Deal 4d6 + RES modifier to one target; if target dies, chain 4d6 to nearest enemy (repeats until no kill). |
  | 5 | OBLITERATE | 10 | SIG×2 | Deal 5d6 + RES modifier to one target; ignores Defense bonuses (armor, cover, SHIELDED). |

  **WARD (defensive — heal, shield, buff)**

  All WARD healing = `base die × tier + RES modifier`. The die shown below is the tier-1 base; multiply by tier for the actual roll.
  | Tier | Name | CHARGE | Range | Effect |
  |---|---|---|---|---|
  | 1 | PATCH | 2 | adjacent | Heal 1d6 + RES modifier HP to one ally. |
  | 2 | BARRIER | 4 | SIG×2 | Apply SHIELDED to one ally. |
  | 3 | BULWARK | 6 | 3-cell radius | Apply SHIELDED to all allies in radius; +2 Defense for 2 turns. |
  | 4 | REGEN | 8 | SIG×2 | Target ally heals 1d6 + RES modifier HP at start of each turn for a number of turns equal to the protocol's tier (4 turns). Per-turn heal does not multiply by tier — only duration scales. |
  | 5 | FORTRESS | 10 | 4-cell radius | All allies in radius gain +4 Defense and condition immunity for 2 turns. |

  **SCRY (information & control — reveal, mark, blind)**
  | Tier | Name | CHARGE | Range | Effect |
  |---|---|---|---|---|
  | 1 | PING | 2 | 5 cells | Reveal all enemies in range (ignores LOS) for 1 turn. |
  | 2 | TAG | 4 | SIG×2 | Apply MARKED to one enemy. |
  | 3 | BLIND | 6 | SIG×2 | Apply BLINDED to one enemy (FIN save negates). |
  | 4 | REVEAL | 8 | full floor | Reveal entire floor layout, all containers, and descent point. |
  | 5 | ORACLE | 10 | full floor | All enemies revealed and MARKED for 3 turns. |

  **REWRITE (manipulation — move, purge, control, reshape)**
  | Tier | Name | CHARGE | Range | Effect |
  |---|---|---|---|---|
  | 1 | FLIP | 2 | 4 cells | Swap positions with one ally. |
  | 2 | PURGE | 4 | SIG×2 | Remove one condition from one ally. |
  | 3 | OVERRIDE | 6 | SIG×2 | Apply PANICKED to one enemy (FOC save negates). |
  | 4 | NULLIFY | 8 | 4-cell radius | All enemies in radius lose 2 AP on their next turn. |
  | 5 | REFORMAT | 10 | 3×3 cells | Reshape one 3×3 area: convert wall cells to floor or floor to wall. Cannot create disconnected areas. |

  - [ ] All protocol effects (damage rolls, save outcomes) are deterministic given the run's PRNG state.
  - [ ] The protocol catalog is final for v1 — no additional protocols are in scope.

### FR-48: Loot Affixes & Rarity Tiers

- **User story:** As a player, I want named rarity tiers and a known affix pool, so that loot discoveries have clear mechanical meaning and I can evaluate gear at a glance.
- **Acceptance criteria:**
  - [ ] **Five rarity tiers**, in ascending order of power:
    | Tier | Name | Affixes | Description |
    |---|---|---|---|
    | 1 | Stock | 0 | Baseline item, no affixes. Common at shallow depth. |
    | 2 | Tuned | 1 minor | One minor affix. Appears from depth 1. |
    | 3 | Custom | 1 major + 1 minor | Significant affix combination. Appears from depth 5. |
    | 4 | Prototype | 2 major + 1 minor | High-power item. Appears from depth 10; more common in vaults. |
    | 5 | CORRUPT | 3 major | Strictly strongest. Permanently raises danger clock rate when equipped. Appears from depth 15+, or in vaults from depth 10. |

  - [ ] **Sixteen affixes** divided into universal, weapon-only, and armor-only:

  **Universal (may appear on any item):**
  | # | Name | Effect | Class |
  |---|---|---|---|
  | 1 | Reinforced | +1 to core stat (weapon: +1 accuracy; armor: +1 Defense) | Minor |
  | 2 | Overcharged | +2 CHARGE pool while equipped | Minor |
  | 3 | Lucky | Once per floor, reroll one d20 (keep either result) | Major |
  | 4 | Phasing | Ignores cover on attacks (weapon); ignores FIN penalty (armor) | Major |

  **Weapon-only:**
  | # | Name | Effect | Class |
  |---|---|---|---|
  | 5 | Edged | Upgrade damage die one step (d6→d8, d8→d10, d10→d12; capped at d12) | Major |
  | 6 | Precise | +1 accuracy bonus | Minor |
  | 7 | Extended | +2 cells max range | Minor |
  | 8 | Vampiric | Heal 1 HP on hit | Major |
  | 9 | Conducting | +1 to protocol damage while equipped | Minor |
  | 10 | Incendiary | Applies BURNING on critical hit (natural 20) | Major |
  | 11 | Corrosive | Applies CORRODED on hit (VIT save negates) | Major |
  | 12 | Jamming | 25% chance to apply JAMMED on hit (FOC save negates) | Major |

  **Armor-only:**
  | # | Name | Effect | Class |
  |---|---|---|---|
  | 13 | Lightweight | Reduces FIN penalty by 1 (minimum 0) | Minor |
  | 14 | Shielding | Grants SHIELDED on floor entry (once per floor) | Major |
  | 15 | Fortified | +2 Defense | Major |
  | 16 | Resonant | +1 to CHARGE regen while equipped | Minor |

  - [ ] Minor affixes are single-effect modifiers; major affixes are significant mechanical changes.
  - [ ] CORRUPT items always roll from the major affix pool only.
  - [ ] Affixes are deterministic given `hash(worldSeed, depth, floorId, containerId)` (per FR-13).
  - [ ] The affix pool is final for v1 — no additional affixes are in scope.

### FR-49: Consumable Items

- **User story:** As a player, I want to find single-use consumable items in loot containers, so that I have a limited resource-recovery option that supplements the floor-descent CHARGE regen and WARD healing without removing the resource pressure.
- **Acceptance criteria:**
  - [ ] Consumables are a distinct loot category alongside weapons and armor, appearing in containers per the same deterministic generation (`hash(worldSeed, depth, floorId, containerId)`).
  - [ ] A container may contain any mix of weapons, armor, and consumables — the mix is determined by the environment theme's `lootBias` and depth scaling.
  - [ ] **Consumable types:**
    | Type | Effect | Rarity Availability |
    |---|---|---|
    | Repair Patch | Restore d6 HP to one character. | All depths |
    | Med Kit | Restore 2d6 HP to one character. | Depth 5+ |
    | Charge Cell | Restore `floor(RES / 2)` CHARGE to one character (minimum 2). | All depths |
    | Boost Cell | Restore full CHARGE to one character. | Depth 10+ |
    | Purge Spike | Remove one condition from one character. | Depth 3+ |
    | Shield Capacitor | Apply SHIELDED to one character. | Depth 8+ |
    | Adrenal Injector | Restore 1 AP to the active character (usable only in combat). | Depth 5+ |
  - [ ] Consumables are single-use — they are consumed on use and removed from inventory.
  - [ ] Consumables are used via the GEAR or PARTY console mode (placement by Designer), or via the COMBAT mode action list during combat.
  - [ ] Using a consumable in combat costs 1 AP (per the AP cost table in FR-11).
  - [ ] Using a consumable outside combat is free (no AP cost — AP only exists in combat).
  - [ ] Consumables do not have rarity tiers or affixes — they are fixed-effect items.
  - [ ] Consumables stack in inventory (display count per type, e.g., "Repair Patch ×3").
  - [ ] Consumables are saved in the run state and reconstructable from a save link.
  - [ ] Consumable drop rates are lower than weapon/armor drop rates — they are supplementary, not primary loot. The exact ratio is a tuning parameter validated at playtest.

## Non-Functional Requirements

### Performance
- **First load:** Under 500 KB total transfer (compressed). Includes HTML, JS, CSS, WOFF2 sigil font, and `data/sigils.json`.
- **Runtime — floor generation:** A validated floor generates in under 100ms on a mid-range mobile device. Regeneration loops must not produce perceptible load times.
- **Runtime — rendering:** 60fps target on mid-range mobile. The 20×32 lattice with shadowcast LOS must not drop below 30fps. Combat at 8×16 with effects must not drop below 30fps.
- **Runtime — audio:** WebAudio synthesis must not produce audible glitches, dropouts, or xruns on a mid-range mobile device. Five simultaneous layers must remain within CPU budget.
- **Runtime — save:** Encoding the full run state to a URL fragment under 1500 chars must complete in under 50ms (no perceptible delay on "copy link").
- **Runtime — save decode:** Decoding a pasted link must complete in under 100ms.
- **localStorage:** Autosave writes must be non-blocking and complete in under 50ms per write.

### Security
- No backend, no server, no network requests after first load. The service worker is the only network layer, and it only fetches from the origin.
- URL fragments are decoded in a sandboxed parser that cannot execute arbitrary code. No `eval`, no `Function()`, no `innerHTML` from untrusted input.
- `localStorage` data is treated as untrusted on load — malformed save data must fail gracefully, not crash the app.

### Accessibility
- **`prefers-reduced-motion`:** Automatically disables all glitch effects and authored transitions. The game remains fully playable.
- **Manual reduced-motion override:** A settings toggle for players who want reduced motion regardless of OS setting (or full motion despite the OS setting).
- **Keyboard parity:** Every action is reachable via keyboard. No keyboard trap — the player can always return to a previous mode or exit.
- **Touch parity:** Every action is reachable via touch. 96px minimum hit height on console rows.
- **Color:** Status is never communicated by color alone — the accent color is atmospheric, not informational. Status (HP, conditions, corruption) is numeric or iconic.
- **Glitch safety:** Glitch never obscures actionable information for longer than 400ms and never touches an interactive control during a pending decision. Disabling glitch costs no information.
- **Audio:** Full per-layer volume control and master mute. The game is playable with audio disabled (information loss is intentional but the game is not broken).

### Platform
- **Target:** Modern mobile and desktop browsers supporting ES modules, WebAudio, Canvas 2D, Service Workers, and `localStorage`.
- **No build step:** No bundler, no transpiler, no npm at runtime. Native ES modules served directly.
- **No third-party runtime dependencies:** Zero external libraries loaded at runtime.
- **Adaptive-first:** Two layout classes selected by media query — `portrait` (default, mobile-optimized, fluid width) and `wide` (`(min-width: 900px) and (min-aspect-ratio: 1/1)`, three-region desktop/tablet-landscape shell). Per FR-35.

---

## Constraints

- **Budget:** 500 KB total first-load transfer. The sigil WOFF2 target is 4–8 KB. Everything else is generated at runtime — no sprite assets, no audio files.
- **No build step at runtime:** The shipped artifact is static files served directly. No server-side processing.
- **No backend:** The entire game is client-side. No accounts, no telemetry, no analytics, no cloud sync.
- **No third-party runtime dependencies:** No CDN, no font service, no external library.
- **No third-party fonts:** Body and interface type is system monospace. The only font asset is `DESCENT SIGIL`, self-hosted.
- **No sprite art:** All visuals are Canvas 2D, SVG, or CSS.
- **No audio files:** All audio is synthesized via WebAudio.
- **No hand-authored floors:** All content is procedural. The tutorial is a manual, not a level.
- **Adaptive layout system:** Two layout classes — `portrait` (default) and `wide` (`(min-width: 900px) and (min-aspect-ratio: 1/1)`). No third class; no per-screen or per-component breakpoint. See FR-35.
- **No meta-progression:** No run-to-run carryover of any kind.
- **No vendor nodes:** Credits exist only as the 10:1 unspent-points conversion. No shops, no vendors.
- **Sigil font is the sole authored asset:** Everything else is code or data files.
- **URL save must be under 1500 characters:** This constrains the save-state schema density.

---

## Dependencies

- **Universal Operator's Tarot (sibling project):** Source of the glitch timing constants, the per-element intensity dial model, the pitch-bias audio mechanism, and the neon-on-violet palette. These are ported behaviors, not runtime dependencies.
- **`DESCENT SIGIL` typeface:** An original asset authored for this project. Delivery as WOFF2 is a prerequisite for the share-link visual contract. Blocks M5 and all sigil-dependent features.
- **`data/sigils.json`:** The single source of truth for: PUA codepoint ranges (player bank, bestiary bank), safe substitution pool for glitch, and any sigil metadata. A data dependency for rendering, glitch, and lint.
- **WebAudio API:** Required for all audio synthesis. No fallback to audio files.
- **Canvas 2D API:** Required for grain rendering (dot-scatter) and playfield rendering.
- **Service Worker API:** Required for offline-first caching.
- **`localStorage` API:** Required for run library persistence and settings persistence.

---

## Assumptions

- The 80-point buy produces viable solo (1-character) and full-party (4-character) builds. Solo-build balance is a playtest gate (Open Question 4).
- The 20×32 lattice with 8-way movement provides enough tactical space for meaningful exploration without being tedious. To be validated at M1.
- The 8×16 combat window at 2× zoom provides enough space for the three-act engagement (approach, contact, resolution) given 9–12 cells of deployment separation. To be validated at M1.
- The expanded console overlaying the playfield (leaving ~1024px visible band) is sufficient for targeting decisions without additional panning. To be validated at M1 (Open Question 3).
- The 1500-character URL limit is sufficient to encode the full save state of a 4-character party at any depth. This constrains the save schema; Architect/DB must design within it.
- The glitch timing constants from the tarot translate to the larger playfield without re-tuning. They are visual constants, not resolution-dependent. To be validated visually.
- The five-layer WebAudio synthesis fits within the CPU budget of a mid-range mobile device. To be validated at M7.
- The deterministic PRNG (seeded by `worldSeed`) is sufficient for both floor generation and combat rolls without cross-contamination. The RNG cursor in the save state tracks position.
- System monospace renders acceptably across all target platforms for body and interface type. No web font fallback is needed for non-sigil text.
- `font-display: block` for the sigil font does not cause a perceptible delay on mid-range mobile, because the font is under 8 KB and cached by the service worker.

---

## Glossary

- **80-point buy:** The character creation system where 80 points are spent across 1–4 characters for chassis, attributes, equipment, and protocols. Sigil selection is free (included in the chassis cost). The foundational strategic decision of a run.
- **AP (Action Point):** A per-turn resource in combat. Each character gets 2 AP per turn plus one move action.
- **Accent:** The per-floor color, set by the environment theme, flowing through a single CSS custom property to re-skin the screen.
- **Archetype:** One of eight floor generation patterns (sprawling chambers, caves, mazes, cathedrals, spines, fractured, rings, shards).
- **Calibration:** A build-defining upgrade available every third floor; the in-run character advancement.
- **Chassis:** The 5-point base cost to instantiate a character in the 80-point buy.
- **Charge:** The resource spent to cast tech protocols. Per-character.
- **Console:** The single input surface with seven modes through which all game actions are routed. Bottom-pinned in `portrait` (collapsible); a right-anchored, always-expanded dock in `wide` — the same seven modes, same content, same bus events in both classes. See FR-15 and FR-35.
- **Console dock:** The right region of the wide game-screen shell. Always expanded, with the seven mode tabs stacked vertically along its inner edge. Portrait's collapse state does not exist in `wide`. Defined in FR-35.
- **Layout class:** One of two structural UI configurations selected by media query — `portrait` (default) or `wide` (`(min-width: 900px) and (min-aspect-ratio: 1/1)`). Governs composition (single-column frame vs. three-region shell) but never re-tunes typography, sigil scales, spacing, corner radii, shadow/glow, or CRT/glitch timing constants. Defined in FR-35.
- **Playfield column:** The center region of the wide game-screen shell. Preserves the portrait 9:16 aspect ratio so the vertical-descent premise reads in every layout class. Defined in FR-35.
- **Telemetry dock:** The left region of the wide game-screen shell. Stacks the status-strip fields vertically at the top and streams a persistent live LOG feed (same entry format as FR-22 LOG mode) below. Defined in FR-35.
- **CORRUPT:** An item rarity tier. CORRUPT items are strictly stronger and permanently raise the run's danger clock rate.
- **Danger clock:** The mechanism by which special hunts are scheduled; rate increases with corruption.
- **Descent point:** The cell on a floor that leads to the next deeper floor.
- **DESCENT SIGIL:** The original 72-glyph cyberpunk-mystical typeface authored for this project. Self-hosted, subsetted WOFF2.
- **Echo:** A dead character returned as an enemy 2–4 floors deeper, wearing their sigil and gear. Capped at 2 concurrent.
- **Environment theme:** One of twelve thematic floor types that sets accent color, weights archetype/modifier draws, biases enemy mix and loot, and selects audio mode.
- **Environment theme table:** The single data file (e.g., `data/themes.json`) that enumerates all twelve themes and their generation parameters — archetype weights, modifier weights, enemy mix weights, loot bias, accent color, and audio mode. The single source of truth for theme-driven generation behavior.
- **Glitch:** The CRT/VHS visual degradation system. Constant (not state-driven), ported from the tarot. Per-element intensity constants, free-running timers.
- **Hostile:** An enemy creature in combat or on the floor.
- **Initiative:** The turn order in combat, determined at encounter start.
- **Lattice:** The 20×32 portrait grid on which floor exploration occurs. Cell size: 108px.
- **Modifier:** Zero-to-two per-floor generation modifiers that alter the archetype.
- **Party wipe:** The death of all party members. Ends the run.
- **Per-element intensity dial:** The authoring-time constant each glitching element declares (e.g., 0.06 for body copy, 0.20 for depth readout). Ported from the tarot. No element reads this from game state.
- **Pitch bias:** The tarot's depth-equivalent mechanism — one scalar, a slow 1.2s glide, a fixed subset of voices that follow and a fixed subset that don't. Ported for depth-driven audio.
- **Protocol:** A tech spell. One of four schools (DISRUPT, WARD, SCRY, REWRITE) across five tiers.
- **Pulse:** The audio layer that tightens with hostile proximity. One of the three "moving" layers.
- **RNG cursor:** The position in the deterministic PRNG sequence, saved in run state so that a loaded link resumes the exact same roll sequence.
- **Safe pool:** The enumerated set of codepoints (Latin, digits, box-drawing) that glitch character substitution may draw from. Declared in `data/sigils.json`.
- **Scanlines:** The CRT horizontal-line overlay. 1px line every 2px, white at 10%, drifting 2px over 4000ms.
- **Shadowcast:** The line-of-sight algorithm used for fog of war.
- **Sigil:** A single glyph representing a character or enemy. Drawn from the reserved banks in `DESCENT SIGIL`.
- **Sigil bank:** A reserved set of PUA codepoints (48 player, 24 bestiary) that may only render in creature contexts.
- **Sparkle:** The audio layer that brightens with treasure proximity. One of the three "moving" layers.
- **Sub-seed:** An incremented value used to regenerate a floor when validation fails. Appended to the floor seed.
- **Threshold floor:** Every tenth floor (10, 20, 30, …). Guarantees an elite, a vault, and a new theme.
- **VHS event:** A periodic glitch effect with chroma offset, tear, and content jitter. 4000–9999ms between events.
- **World seed:** The deterministic seed for a run. The same seed always yields the same dungeon. Shared alone in the run-end link.
- **MIGHT (MGT):** One of six core attributes. Governs melee damage, carrying capacity, forced-movement resistance, and athletics checks.
- **FINESSE (FIN):** One of six core attributes. Governs ranged accuracy, initiative, stealth, and reflex-based saves.
- **VITALITY (VIT):** One of six core attributes. Governs HP base, HP growth, poison/disease resistance, and stamina.
- **RESONANCE (RES):** One of six core attributes. Governs CHARGE pool, protocol power, and CHARGE regen rate.
- **FOCUS (FOC):** One of six core attributes. Governs protocol accuracy, perception, mental saves, and overclock success chance.
- **SIGNAL (SIG):** One of six core attributes. Governs protocol range, detection radius, and social/command checks.
- **Attribute modifier:** The value `N - 5` for a rank-N attribute, used in all d20 resolution (per FR-38).
- **Defense:** The target number for incoming attacks: `10 + FIN modifier + armor + shield + cover + conditions`.
- **Protocol Defense:** The target number for incoming hostile-targeted protocols: `10 + FOC modifier + WARD bonus`.
- **Hit die base:** The per-class HP base value (Breacher 16, Anchor 14, Operator 12, Ghost 10, Compiler 8, Oracle 6). Used in HP formula and HP growth per calibration.
- **Charge base:** The per-class CHARGE base value (Oracle 8, Compiler 6, Operator 4, Ghost 2, Breacher 0, Anchor 0). Added to RES-derived CHARGE pool.
- **Calibration count:** The effective level of a character. Equals the number of calibrations taken + 1. Used for scaling purposes.
- **Enemy archetype:** One of eight enemy types (Drone, Warden, Stalker, Choir, Null, Construct, Phantom, Apex), each with a defined stat block and AI behavior pattern.
- **Apex:** The elite enemy archetype. Appears on threshold floors. Has double initiative (acts twice per round). The guaranteed elite per FR-30.
- **JAMMED:** A condition preventing protocol use (CHARGE spending blocked). Lasts 2 turns. Resisted by FOC.
- **OVERLOADED:** A condition causing +50% damage from all sources. Lasts 2 turns. Resisted by RES.
- **SHIELDED:** A condition granting +4 Defense and immunity to the next condition. Consumed on use or after 3 turns.
- **BLINDED:** A condition reducing LOS to 1 cell and imposing -4 on ranged attacks. Lasts 2 turns. Resisted by FIN.
- **IMMOBILIZED:** A condition preventing movement while allowing AP actions. Lasts 1 turn. Resisted by MGT.
- **CORRODED:** A condition reducing Defense by 2 per turn (cumulative, min 2). Lasts 3 turns. Resisted by VIT.
- **MARKED:** A condition making the target visible to all hostiles regardless of LOS and granting +2 attack against them. Lasts 3 turns. No save.
- **PANICKED:** A condition forcing retreat from nearest hostile and preventing attacks. Lasts 1 turn. Resisted by FOC.
- **BURNING:** A condition dealing d6 damage at start of turn for 3 turns. Stackable (refreshes duration, adds stacking d6). Resisted by VIT.
- **BREACH (Breacher signature):** Ignores cover on attacks. Tier 2 ignores SHIELDED. Tier 3 grants free melee attack after moving.
- **PHASE (Ghost signature):** Move through one wall cell per move action. Tier 2 adds +2 initiative. Tier 3 allows 2 wall cells per move.
- **COMPILE (Compiler signature):** Overclock costs 1 less CHARGE. Tier 2 grants immunity to overclock corruption. Tier 3 allows two-tier overclock with automatic success.
- **HOLD (Anchor signature):** Self and allies within 2 cells gain +2 Defense. Tier 2 extends range and adds save bonus. Tier 3 projects as WARD protocol.
- **FORESEE (Oracle signature):** Telepathic detection of enemies within SIG × 3 cells. Tier 2 allows one reroll per combat. Tier 3 reveals all containers and descent point on floor entry.
- **OVERLAY (Operator signature):** Boost one ally's next attack by +3, once per round. Tier 2 allows boosting protocol rolls. Tier 3 grants party-wide +1 for one turn.
- **Protocol catalog:** The full set of 20 protocols (4 schools × 5 tiers) enumerated in FR-47. Each has a name, CHARGE cost (`tier × 2`), range, and effect.
- **SPARK / SURGE / STORM / CASCADE / OBLITERATE:** The five DISRUPT protocols (tiers 1–5). Offensive damage-dealing protocols.
- **PATCH / BARRIER / BULWARK / REGEN / FORTRESS:** The five WARD protocols (tiers 1–5). Defensive healing and shielding protocols.
- **PING / TAG / BLIND / REVEAL / ORACLE:** The five SCRY protocols (tiers 1–5). Information and enemy-debuff protocols.
- **FLIP / PURGE / OVERRIDE / NULLIFY / REFORMAT:** The five REWRITE protocols (tiers 1–5). Manipulation and battlefield-control protocols.
- **Hunt:** An ambush encounter triggered when the danger clock reaches its threshold. The party is surrounded by enemies on multiple sides. Resets the danger clock to 0 after resolution.
- **Stock / Tuned / Custom / Prototype / CORRUPT:** The five loot rarity tiers, in ascending order of power. Stock has no affixes; CORRUPT has three major affixes and raises the danger clock rate.
- **Affix:** A permanent modifier on a loot item. Sixteen exist (4 universal, 8 weapon-only, 4 armor-only), divided into minor (single-effect) and major (significant mechanical change).
- **Cold Storage / The Foundry / Data Stream / Data Cache / The Archive / The Hive / The Void / The Lattice / The Stack / The Terminal / The Nursery / The Crypt:** The twelve environment themes, each with a unique accent color, mood, and generation parameters (enumerated in FR-25 and FR-8a).
- **AP cost table:** The defined cost in Action Points for each combat action: attack 1 AP, cast protocol 1 AP, use item 1 AP, overclock 1 AP, retreat 1 AP, weapon swap 0 AP (once per turn), signature ability 0 AP (per FR-45).
- **Move action (combat):** One grid cell of movement per turn, separate from AP. Cannot be converted to AP; AP cannot buy a second move.
- **Threshold scaling formula:** The cumulative depth-scaling formula at threshold floors: `scaledStat = baseStat × (1 + depth × (0.15 + 0.10 × floor(depth / 10)))`. Each threshold adds +0.10 to the scaling multiplier.
- **Choir:** An enemy archetype that casts DISRUPT and SCRY protocols (up to tier 3) using a CHARGE pool of `(RES × 2) + depth`. Attack rolls use FOC modifier; damage scales with RES modifier. Falls back to melee when out of CHARGE.
- **Null:** An enemy archetype that applies conditions directly (JAMMED, OVERLOADED, IMMOBILIZED, PANICKED, MARKED) via a d20 + FOC roll vs. target save. Has a 1-turn cooldown between condition applications.
- **Consumable:** A single-use item found in loot containers that restores HP, CHARGE, removes conditions, or provides combat buffs. Seven types exist (Repair Patch, Med Kit, Charge Cell, Boost Cell, Purge Spike, Shield Capacitor, Adrenal Injector). No rarity tiers or affixes. Enumerated in FR-49.
- **Inventory cap:** The hard limit of 100 unequipped items in the party inventory. Items cannot be picked up when the cap is reached. Enforced per FR-50.
- **Junk (verb):** The act of tagging items for destruction and converting them to scrap value via the "Junk All Tagged" action. Permanent and irreversible. Enabled by FR-50.
- **Scrap counter:** A run-wide accumulator tracking the total salvage value of all items junked during the run. Displayed in PARTY/GEAR mode and on the run-end scorecard. Saved in the run state. Enforced by FR-50.
- **Salvage value:** The scrap value of an item, defined per item type/category in the data files. Added to the scrap counter when the item is junked. Enforced by FR-50.
- **Character death:** A character dies when HP reaches 0. A single death triggers the Echo system if the party survives. Party wipe (all characters at HP 0) ends the run permanently.
- **Party wipe:** The death of all party members (all characters at HP 0). Ends the run immediately and permanently. The run-end scorecard is displayed. The run's state is removed from localStorage, but the seed remains accessible for sharing or restarting.
- **Restart with same seed:** A scorecard action that sends the player to character creation with the same world seed pre-loaded. The dungeon (floors, loot, enemies, themes) is identical; the party is new. Enabled by FR-31.
- **Seed persistence:** The world seed survives a party wipe. The run's mutable state (party, inventory, progress) is removed from localStorage on wipe, but the seed remains so it can be shared as a world link or used to restart. The same seed can support multiple independent runs (tracked by seed + creation timestamp).
- **Saved party configuration:** A player-defined blueprint of a party build (classes, sigils, attributes, equipment, protocols, credits) stored in localStorage. Not part of the run state or URL save. Used to quickly start a new run with a previous build. New runs default to the last used configuration. Capped at 10 named configurations. Enabled by FR-51.