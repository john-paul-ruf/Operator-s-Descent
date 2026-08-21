# Design Spec — Operator's Descent

## Design Language

### Color Palette

The base is neon-on-violet, ported from Universal Operator's Tarot. A single CSS custom property `--accent` carries the per-floor environment theme color and re-skins the entire screen on change.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#0a0612` | Screen background (near-black violet) |
| `--bg-panel` | `#13092a` | Console, panels, cards |
| `--bg-panel-elevated` | `#1a0e36` | Raised surfaces, active mode |
| `--border-dim` | `#453370` | Inactive borders, dividers |
| `--border-active` | `var(--accent)` | Active/focused element borders |
| `--text-primary` | `#e0d8f0` | Body text, labels, values |
| `--text-secondary` | `#a89ac6` | Muted labels, captions, hints |
| `--text-dim` | `#8878a8` | Disabled, far-muted |
| `--text-disabled` | `#71659a` | Disabled controls, illegal targets — ≥4.5:1 on `--bg-panel` |
| `--accent` | `#7ec8e3` (default — Cold Storage) | Per-floor accent; flows through glow, borders, UI tints |
| `--danger` | `#e83a3a` | HP loss, death, The Terminal theme |
| `--warning` | `#e8632a` | CORRUPT items, overclock risk, The Foundry theme |
| `--heal` | `#3ae8a8` | Healing, positive effects, The Nursery theme |
| `--sigil-player` | `var(--accent)` | Player sigil color (inherits floor accent) |
| `--sigil-enemy` | `#e83a3a` | Enemy sigil color (red) |
| `--sigil-echo` | `#e83a3a` | Echo sigil (red, per spec) |

#### Playfield Palette

Canvas-side lattice palette; not tokenized in `:root` because the playfield renders on `<canvas>` in production, driven by exported constants in `src/ui/playfield.js` (FLOOR_COLOR, FLOOR_DIM_COLOR, WALL_COLOR, HIDDEN_COLOR, GRID_COLOR, WALL_LINE_COLOR, TICK_DIM_ALPHA, WALL_PULSE_PERIOD_MS, WALL_PULSE_FPS, WALL_GLOW_BLUR, WALL_GLOW_ALPHA, `wallThickness(size)`). Owner directive (clarity-and-fit 2026-08-16, amended by walls-npc-docks 2026-08-17) — the surface reads as a near-black vector display: thick pulsing cyan walls painted on the wall side of the traversable edge, near-black walkable interior with light-grey `-|-` corner ticks strictly inside walkable space, pure black everywhere else.

| Surface | Value | Notes |
|---------|-------|-------|
| Wall boundary line | #7ec8e3 | The design-system cyan. Thickness = `max(3, round(size/8))`px (3px @ 24px exploration, 6px @ 48px combat), drawn OUTSIDE the traversable square along the wall side of each shared edge, with 4×`t`×`t` corner joints so adjacent walls read as continuous runs. Pulses via a 2.4s sine on `shadowBlur` [4→12] and `globalAlpha` [0.7→1] (WALL_PULSE_PERIOD_MS / WALL_GLOW_BLUR / WALL_GLOW_ALPHA), driven by a cached-args rAF loop in `createPlayfield` throttled to ~30 fps (WALL_PULSE_FPS). Fixed hue — does NOT re-tint per floor theme; party token and UI accent still do. Owner directive (walls-npc-docks 2026-08-17). |
| Reduced-motion wall glow | static `g = 0.7` (blur ≈ 9.6, alpha ≈ 0.91) | When `loadSettings().reducedMotion === 'reduce'` — or `'system'` with `prefers-reduced-motion: reduce` — screens call `playfield.setPulse(false)` and the rAF loop never schedules; walls hold at the midpoint glow. Owner directive (walls-npc-docks 2026-08-17). |
| Traversable fill (OPEN / CONTAINER / DESCENT), currently visible (fog 2) | #101010 | Near-black — the walkable field. Owner directive: "almost black gray". |
| Traversable fill, seen-not-visible (fog 1) | #0a0a0a | Slightly darker than #101010 so fog-of-war reads without a superimposed overlay pass. |
| Intersection ticks (`-|-`) | #3a3a3a, arm ≈ ⌈size/6⌉px, 1px stroke | Drawn ONLY at interior corners whose ALL FOUR touching cells are revealed traversable floor — ticks never poke past a wall boundary. No full-cell gridlines. Owner directive (walls-npc-docks 2026-08-17). |
| Intersection ticks (dim) | #3a3a3a at 45% globalAlpha (TICK_DIM_ALPHA) | Ticks whose all four touching cells are fog-1 dim; keeps the intersection legible without stealing focus from currently-visible geometry. |
| Inaccessible surfaces (wall interior, out-of-bounds, unexplored fog) | #000000 | Exact hex per directive; unexplored and unwalkable intentionally read the same, so the cyan boundary is the only geometry signal. |
| Tap-to-move route trail marker | #d8d8d8 at 55% globalAlpha | 5×5 square centered in each cell along the previewed route; the destination cell adds a 1px inset outline at full opacity (PATH_COLOR). Rendered during the brief route-flash on exploration tap-to-move (owner directive, map-pan-zoom 2026-08-17) and during combat's tap-to-route preview before the confirm tap. |

Wall lines are keyed on the traversable cell's own fog state, so unexplored geometry never leaks. In combat, neighbor lookups sample the full grid (not the camera window) so a cell at the window border whose true neighbor is floor receives no spurious cyan frame. The old rgba(0,0,0,0.55) visited-overlay pass has been removed — fog-1 is expressed by the dim floor + dim ticks, both of which sit above the near-black base without needing a superimposed layer.

#### Movement Interaction (AMENDED 2026-08-17 via map-pan-zoom)

Owner directive (2026-08-17): the map pans and zooms on mobile and desktop on both surfaces
(exploration and combat) via the M104 viewport camera (`src/ui/viewport.js`); the previous
stage → CONFIRM buffer is retired.

- **Exploration (overworld) — instant execution.** Every d-pad press, keyboard arrow/WASD/
  numpad step, and map tap moves the party immediately. The center D-pad button reverts to
  `DESCEND`/`WAIT` and never relabels to `CONFIRM`. Tap-to-move over a revealed, walkable
  cell runs a pure BFS path (`findExplorationPath` in `src/exploration/movement.js`) through
  `moveParty` step-by-step, so the existing auto-stop interrupts (`hostile`, `hunt`,
  `container`, `descent`, `damage`) and the danger-clock tick pipeline behave identically to
  keyboard walking. A brief route-flash renders the tap-to-move-path preview marker
  (`#d8d8d8`/55%) as the steps execute.
- **Combat — tap-to-route, tap-again-to-confirm.** The first tap on a reachable cell shows
  the route preview (BFS via `selectDestination`, same marker as exploration); tapping the
  same destination cell again executes the move. The COMBAT console retains its `CONFIRM`
  affordance so the keyboard flow (Tab/arrow to cycle → Enter to confirm) is unchanged and
  a `GO` frame highlights the endpoint cell.
- **Pan and zoom (both surfaces).** Drag pans the camera; pinch (touch) and mouse wheel
  zoom. The camera clamps between fit-entire-world (floor) and 4× fit (ceiling). Tap and
  drag are separated by a 6px movement threshold — releases within 6px of the press count
  as taps and route via the movement pipelines above; releases past the threshold pan the
  camera without moving the party or routing combat.

### Typography

| Role | Family | Notes |
|------|--------|-------|
| Body / UI | `ui-monospace, 'SF Mono', 'Cascadia Code', 'Roboto Mono', Consolas, monospace` | System monospace only — no web font |
| Sigil glyphs | `DESCENT SIGIL` (WOFF2, self-hosted) | 72 glyphs at 34px / 72px / 108px / 220px only |
| Title display | System monospace, uppercase, letter-spaced | Title screen, section headers |

**Type scale:**
- Display: 48px, 700 weight, letter-spacing 0.15em
- Heading: 24px, 700 weight, uppercase, letter-spacing 0.1em
- Subheading: 18px, 600 weight, uppercase
- Body: 14px, 400 weight
- Caption: 12px, 400 weight, `--text-secondary`
- Micro: 10px, 400 weight, `--text-dim`
- Sigil-34: 34px (initiative rail)
- Sigil-72: 72px (combat grid token)
- Sigil-108: 108px (grid cell context)
- Sigil-220: 220px (creation picker)

### Spacing System

Base unit: **4px**. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.

Console row height: **96px minimum** (touch target per FR-15).

### Corner Radius

Terminal aesthetic — sharp edges dominate.
- Panels / console: **0px** (sharp)
- Buttons: **4px**
- Small controls (sliders, toggles): **2px**
- Sigil cells: **0px**

### Shadow / Glow System

Neon glow on every rendered element, intensity by layer:

| Level | Value | Usage |
|-------|-------|-------|
| Subtle | `0 0 4px var(--accent)` | Borders, dividers |
| Standard | `0 0 8px var(--accent)` | Text, labels, values |
| Strong | `0 0 16px var(--accent)` | Active controls, buttons |
| Sigil | `0 0 12px var(--accent), 0 0 24px var(--accent)` | Sigil glyphs at all sizes |
| Danger | `0 0 8px var(--danger)` | HP bars, death indicators |

### Interaction Affordance

One affordance grammar for every interactive control (clarity-and-fit 2026-08-16). Owner directive: users must be able to tell which elements are clickable at a glance, without hovering. The grammar is a single CSS class `.is-interactive` applied by the factories in `src/ui/components.js` (never per-screen). Interactive ⇔ `.is-interactive`.

| Layer | Rule | Purpose |
|-------|------|---------|
| Rest | `border: 1px solid var(--interactive-border)` + `cursor: pointer` | Baseline "you can click this" affordance — findable by border alone |
| Hover (non-disabled) | `border-color: var(--accent)` + `box-shadow: 0 0 6px color-mix(in oklab, var(--accent) 35%, transparent)` | Signals pointer engagement |
| Focus-visible | `outline: 2px solid var(--accent)` + `outline-offset: 2px` | Keyboard-navigation anchor |
| Active (non-disabled) | `transform: translateY(1px)` | Press feedback |
| Disabled (`[disabled]` or `[aria-disabled="true"]`) | `opacity: 0.45` + `cursor: not-allowed` + `border-style: dashed` | Uniform "can't click this right now" |

The custom property `--interactive-border: #5a89a0` is scoped inside `.is-interactive` in `styles/components.css` (not in the Color Palette table, not in `styles/base.css :root`) so it inherits through the affordance grammar without appearing in the tokens-palette scanner surface. Contrast: `#5a89a0` on `--bg-panel #13092a` measures 5.02:1 (target ≥3:1 for non-text; controls must be findable by border alone).

Factories that add `.is-interactive`:

- `createButton` — every button
- `createSlider` — the `input[type="range"]`
- `createToggle` — the visual `.toggle` span (also mirrors `aria-disabled` from the input)
- `createEquipmentCard` — only when `opts.onClick` is provided (static article variants omit it)
- `createProtocolCard` — same rule as equipment cards

Disabled controls set `disabled` (for native form controls) AND `aria-disabled="true"` simultaneously so the grammar's disabled styling applies uniformly to both native and non-native elements. Ad-hoc `:hover` rules the grammar supersedes were removed from `.item-card` and `.action-btn`; component-specific active-state styling (`.active`, `.selected`, `.mode-tab.active`, `.item-card.equipped`, `.item-card.corrupt`) stays.

### Derived Surface Tokens

Non-palette surface tokens declared in `styles/base.css :root` — dimensional and mix values that support the scroll surface. They are not colors in the Color Palette sense (no per-floor accent flow, no `#value` swatch), so they sit here rather than in that table. The design compliance scanner exempts exactly this set from the "declared in base.css but absent from spec palette" warning.

| Token | Value | Purpose |
|-------|-------|---------|
| `--screen-body-fade` | `32px` | Edge-fade mask height at scroll container top/bottom |
| `--scrollbar-track` | `transparent` | Custom scrollbar track surface |
| `--scrollbar-thumb` | `color-mix(in oklab, var(--accent) 40%, transparent)` | Custom scrollbar thumb surface (accent-tinted) |
| `--scrollbar-thumb-hover` | `color-mix(in oklab, var(--accent) 70%, transparent)` | Custom scrollbar thumb hover surface |
| `--scrollbar-width` | `6px` | Custom scrollbar width |

### CRT / VHS Effects (Visual Texture)

All effects are CSS-based in mocks; production uses canvas grain + JS timers. The visual *feel* for mocks:

**Always-on CSS layers (all mocks):**
- **Scanlines:** 1px line every 2px, white at 10% opacity, repeating-linear-gradient, drifts 2px vertically over 4s
- **Vignette:** radial gradient (transparent 30% → rgba(0,0,0,0.65) at edges), 4s ease-in-out pulse, opacity 0.65 ↔ 0.92
- **Aperture grille:** 3px RGB triad stripes, screen blend at 15% opacity (50% per-channel per spec, reduced in mock for legibility)
- **Tracking band:** 28% viewport height, 5% white-blue, screen blend, 7s linear top-to-bottom loop
- **Grain:** 30-point dot-scatter using radial-gradient backgrounds, ~15% fill, 2×2px dots, re-scattered (translate jitter) every 1s via steps(4) animation
- **Border flicker:** inset box-shadow CRT bezel (accent-tinted inner glow + dark vignette), 0.8s steps(1) animation flickering opacity 0.5–0.9
- **Frame flash:** full-screen magenta at 5% opacity, 3.2s steps(1) animation, fires at 86% of cycle for ~89ms

**JS-driven glitch effects (all mocks, per FR-23 timing constants):**
- **Glitch bars:** 350–999ms schedule, 40% fire probability, 80–249ms duration, 1–4px tall, ±8px horizontal offset, alpha 0.1–0.5, screen blend
- **Noise lines:** 1200–3499ms schedule, 30% fire probability, 80–299ms duration, 8–28 chars at 8px monospace, drawn from safe pool (Latin, digits, box-drawing)
- **VHS events:** 4000–9999ms schedule, 80–249ms duration, chroma offset ±2–4px (red/blue gradient), horizontal tear 4px at 30% height, content jitter ±2px
- **Element jitter:** 500–1399ms schedule, 30% fire probability per element, 70–199ms duration, ±3px x / ±2px y displacement (applied to status strip sigils)
- **Chromatic ghosts (title):** Red/blue ::before/::after pseudo-elements at 47% opacity, ±2px offset, 3s cycle with 15% visible window

**Glow system:**
- Glow (`text-shadow: 0 0 8px var(--accent)`) on all text labels and values
- Strong glow (`0 0 8px, 0 0 16px`) on depth readout, START button, active mode tabs
- Danger glow (`0 0 8px var(--danger)`) on HP bars, alerts, death indicators
- Border glow (`box-shadow: 0 0 8px var(--accent)`) on interactive controls, active cards
- Console shadow (`0 -2px 12px rgba(0,0,0,0.6), 0 -1px 4px rgba(126,200,227,0.1)`) for depth separation

**Disabling:** All glitch and CRT effects respond to `prefers-reduced-motion` and the manual settings toggle. In mocks, effects run continuously to demonstrate the aesthetic.

### The `◈` Ornament

Signature decorative element, drawn with CSS (never a sigil bank glyph). Used as:
- Title separator
- Section header prefix
- List bullet replacement
- Branding mark

---

## Component Inventory

| Component | Description | States |
|-----------|-------------|--------|
| **CRT Frame** | Portrait container with scanline/vignette/grain overlays | Always-on background layer |
| **Status Strip** | Top-pinned readout: depth, seed, party HP sigils, danger clock | Exploration + combat variants |
| **Playfield** | Canvas lattice (20×32 exploration / 8×16 combat), fog of war, party token | Exploration, combat-zoom |
| **Console** | Bottom-pinned input surface, 7 modes, expand/collapse | Collapsed, expanded (per mode) |
| **Console Tab Bar** | Row of 7 mode buttons: MOVE, COMBAT, PARTY, GEAR, TECH, LOOT, LOG | Active, inactive, disabled |
| **Directional Pad** | 8-way movement control in MOVE mode | Default, pressed, disabled |
| **Initiative Rail** | Horizontal/vertical list of 34px sigils in turn order | Active highlighted, others dimmed |
| **Combat Grid** | 8×16 cell grid at 2× zoom, sigil tokens at 72px | Targeting overlay, range overlay |
| **Sigil Token** | Character/enemy glyph at 34/72/108/220px | Player, enemy, echo (red), dead (dimmed) |
| **HP Bar** | Numeric HP + thin bar, danger glow | Healthy, wounded, critical, dead |
| **CHARGE Bar** | Numeric CHARGE + thin bar, accent glow | Full, partial, depleted |
| **Attribute Row** | Attribute name + rank number + +/- steppers | Default, at-cap, at-min |
| **Equipment Card** | Item name, rarity tag, affix list, stats | Equipped, unequipped, CORRUPT (warning) |
| **Protocol Card** | Protocol name, school, tier, CHARGE cost, deck slot | Available, insufficient-charge, overclock-available |
| **Rarity Tag** | Color-coded label: Stock, Tuned, Custom, Prototype, CORRUPT | 5 tiers |
| **Condition Tag** | Text label for active condition | 9 types, with duration indicator |
| **Button** | Primary action trigger, neon glow | Default, hover, active, disabled |
| **Slider** | Range input for audio volumes | 0–100% |
| **Toggle** | Binary switch (settings) | On, off |
| **Run Row** | Library entry: accent swatch, seed, depth, party sigils | Active, wiped (removed) |
| **Link Input** | Text field for URL paste/import | Empty, entered, error |
| **Share Link** | Copyable URL display with copy button | Default, copied |
| **Calibration Card** | 3-option choice at threshold floors | Offered, selected |
| **Loot Container** | Container contents display in LOOT mode | Unopened, opened, empty |
| **Log Entry** | Timestamped event line in LOG mode | Combat, discovery, damage, death |
| **Tutorial Page** | Manual content card with illustration area | Current, navigated-away |
| **Mode Indicator** | Label showing current console mode | 7 modes |
| **Manual Modal** | Blocking overlay: eyebrow header, TOC or section body, back stack, focus trap (z 50, under CRT layers) | Closed, TOC, section, wide two-pane |

---

## Screen Inventory

| Screen | Mock File | Purpose |
|--------|-----------|---------|
| Title / Front Door | `mocks/title.html` | Machine power-on; START → New Run / Library / Import / Tutorial / Settings |
| Character Creation | `mocks/creation.html` | 80-point buy across 1–4 characters; class, sigil, attributes, equipment, protocols |
| Floor Exploration | `mocks/exploration.html` | Lattice view, fog of war, MOVE console mode, status strip |
| Combat | `mocks/combat.html` | 8×16 grid, initiative rail, COMBAT console mode, targeting |
| Console — PARTY | `mocks/console-party.html` | Party member detail view (stats, HP, CHARGE, conditions, corruption) |
| Console — GEAR | `mocks/console-gear.html` | Equipment management, equip/unequip, CORRUPT warnings |
| Console — TECH | `mocks/console-tech.html` | Protocol deck, CHARGE display, cast/overclock |
| Console — LOOT | `mocks/console-loot.html` | Container contents, item details, take items |
| Console — LOG | `mocks/console-log.html` | Scrolling event log, timestamped |
| Run Library | `mocks/library.html` | List of persisted runs with seed, depth, sigils, accent swatch |
| Settings | `mocks/settings.html` | Audio sliders, glitch toggle, reduced-motion, scanline toggle |
| Run-End Scorecard | `mocks/scorecard.html` | Final depth, roster, cause of death, seed, share link |
| Link Import | `mocks/import.html` | Paste link + named failure screens |
| Manual (modal) | see Component Inventory → "Manual Modal" (the-manual SESSION-03/04) | Hyperlinked always-available manual; blocking overlay. Reachable via title MANUAL branch, settings row, in-play status-strip `?` chip. `#a=tutorial` deep-links redirect here. |
| Prototype Hub | `mocks/index.html` | Index linking all mocks for navigation |

---

## User Flows

### 1. Primary Flow — New Run
1. **Title Screen** → press START
2. → select **Begin New Run**
3. → **Character Creation** (80-point buy)
   - Add 1–4 characters → assign class → pick sigil → buy attributes → buy equipment → buy protocols
   - Watch live readout (points remaining, projected stats, AP/round)
   - → Finalize
4. → **Boot sequence** (authored transition)
5. → **Floor Exploration** (floor 1)
   - Move via MOVE console mode (8-way directional)
   - Auto-stop on discovery / hostile / damage
   - Descend via descent point → **Floor Descent transition** → next floor
6. → **Combat** (on hostile contact)
   - View zooms to 8×16 grid
   - Initiative rail shows turn order
   - COMBAT console mode: select action → select target → confirm
   - Victory → return to exploration | Wipe → scorecard
7. Continue descent until **Party Wipe**
8. → **Run-End Scorecard** → share world link / new run / title

### 2. Resume Flow
1. **Title Screen** → START → **Run Library**
2. → select run → **Floor Exploration** (at saved depth)

### 3. Import Link Flow
1. **Title Screen** → START → **Import Link**
2. → paste URL → Import
3. → Success: **Floor Exploration** (reconstructed state)
4. → Failure: **Named failure screen** → fresh run in same world / title

### 4. Manual Flow (the-manual SESSION-04 supersedes Tutorial Flow)
1. **Any surface** → open the manual: title MANUAL branch, settings `OPERATOR'S MANUAL` row, or the persistent `?` status-strip chip (exploration + combat, portrait + wide).
2. → hyperlinked sections + internal back stack → close (Esc, backdrop, or close button).
3. `#a=tutorial` deep-links redirect to title + manual open; the retired paginated tutorial screen no longer mounts.

### 5. Settings Flow
1. **Title Screen** → Settings, OR during play via console
2. → adjust sliders/toggles → back

### 6. Calibration Flow (in-run)
1. Reach threshold floor (3, 6, 9, …)
2. → **Calibration overlay** presents 3 options
3. → choose 1 → resume play
4. Signature upgrade at cal 2 and cal 4 is automatic (separate from the choice)

### 7. Echo Flow (in-run)
1. Character dies (HP 0) → death animation → party continues
2. 2–4 floors deeper → Echo appears wearing dead character's sigil in red
3. Kill Echo → reclaim gear

---

## Interaction Notes

### Console Interaction Model
- The console is the **primary input surface** for mode-scoped actions (attack, cast, item,
  descend, wait). The map itself accepts pan/zoom gestures and movement taps directly via
  the M104 viewport camera (AMENDED 2026-08-17 via map-pan-zoom) — see **Movement
  Interaction**. No context menus, no floating panels.
- Seven mutually exclusive modes selected via a tab bar.
- **Collapsed state:** Shows only the tab bar + minimal info (~48px tall). Maximizes playfield.
- **Expanded state:** Fixed height per mode. Dims playfield behind it. The M104 viewport
  camera keeps the active actor in view via user pan/zoom in every class (the console no
  longer auto-pans the playfield).
- **Mode switching:** Tap/click tab, or keyboard shortcut (1–7 keys mapped to modes).
- **Keyboard parity:** Arrow keys / numpad / WASD for MOVE. Tab to cycle modes. Enter to confirm. Escape to collapse.
- **Touch parity:** 96px minimum row height. Tap-to-select + confirm step for combat targeting; map surfaces accept tap-to-move (overworld) and tap-to-route + tap-again-to-confirm (combat) per **Movement Interaction**.

### Combat Targeting
- COMBAT mode lists available actions (Attack, Cast, Item, Retreat).
- Selecting "Attack" enters **targeting sub-mode**: playfield shows valid targets highlighted, range overlay visible.
- **Touch:** tap a target → confirm button appears → tap confirm to execute. Movement in
  combat uses the same tap-to-route + tap-again-to-confirm pattern on the map per
  **Movement Interaction** (map-pan-zoom 2026-08-17).
- **Keyboard:** Tab/arrow to cycle targets → Enter to confirm.
- Range band and cover status displayed for current target.

### Status Strip (Top)
- **Exploration:** Depth number · seed (truncated) · party sigils (34px) with mini HP bars · danger clock indicator (numeric, not color-only).
- **Combat:** Depth · round number · initiative rail preview · active character sigil + HP/CHARGE.
- Danger clock shown as numeric value (e.g., `CLK 0.32`) — never color-only per accessibility.

### Floor Accent Re-Skinning
- On floor load, `--accent` CSS custom property is set to the environment theme's color.
- Everything using `var(--accent)` — glow, borders, sigil player color, UI tints — updates instantly.
- The player reads the floor from color before reading the depth number.

### Auto-Stop Interrupts
- Movement halts on: hostile entering LOS, container/descent/feature discovery, damage taken.
- Each interrupt type can be toggled in settings (quick-toggle accessible from MOVE mode).
- An interrupt shows a brief indicator in the status strip ("HOSTILE DETECTED", "CONTAINER FOUND", etc.).

### Share Link Access
- "Copy Link" available in LOG mode and on the scorecard.
- Encodes full run state to URL fragment under 1500 chars.
- Copy button provides visual feedback ("LINK COPIED").

### Malformed Link Screens
- Four named failure types: Truncated, Version mismatch, Checksum failed, Malformed.
- Each shows a specific error message.
- If seed is still readable: offers "Fresh run in this world" button.
- Always offers "Return to title."

### Settings Access
- From title screen: dedicated Settings control.
- During play: accessible via a console action (long-press mode tab or dedicated button in collapsed console).
- Settings persist in `localStorage`.

### Tutorial Design
- Paginated manual, not a playable level.
- Pages: Console overview → MOVE mode → COMBAT mode → PARTY mode → GEAR/TECH modes → LOOT mode → LOG mode → Status strip → Settings & seed.
- Navigation: prev/next buttons, page indicator.
- Visual: illustration area (CSS-drawn mock of the console in each mode) + text explanation.
- Decline button on first offer; remembered in `localStorage`.

### Adaptive Layout System

Owner directive (2026-08-14, superseding the earlier "no responsive reflow" premise; AMENDED
2026-08-17 via map-pan-zoom — the map docks and fills the entire middle; the vertical descent
premise now lives in the content, not in column geometry): the UI targets **two layout
classes**, each optimal at its resolution and fluid within its class. Selection is by a single
media-query rule; there is no per-screen or per-component breakpoint.

**Layout classes and selection**

| Class | Selection rule | Default use |
|-------|----------------|-------------|
| portrait | Anything not matching wide (default) | Phones, tablets in portrait, narrow desktop windows |
| wide | (min-width: 900px) AND (min-aspect-ratio: 1/1) | Desktop, tablet-landscape, any viewport with room for the three-region shell |

The breakpoint switches **structure**, not just scale. Within a class the layout is **fluid** —
the portrait frame fills the viewport width up to the class boundary; the wide grid regions
flex around their minmax bounds. Typography, sigil scales, spacing, corner radii, shadow/glow
levels, and CRT/glitch timing constants are class-independent — the class switch reshapes
composition, never re-tunes the design tokens.

**Full-viewport CRT.** In every class the CRT/VHS overlay (scanlines, vignette, aperture
grille, tracking band, grain, border flicker, frame flash, glitch bars, noise lines, VHS
events, per-element text glitch) covers the entire viewport. No letterboxed column, no dead
black margins outside a portrait frame — the machine IS the screen. Portrait fills the
viewport width up to the class boundary and has no fixed max-width cap in production; the
450px max-width in the current mocks is a preview convenience, not a design constraint.

**Wide game-screen shell (exploration, combat).** A three-region grid running the full
viewport height. Region names are the CSS grid-area identifiers; region proportions are
derived from the current portrait dimensions in `styles/components.css` (`.console-tab-bar`
min-height 96px, `.console-bar.expanded` height 720px, `.status-strip` min-height 48px) — the
playfield column preserves the portrait aspect, the docks receive the width the portrait
design would have letterboxed away.

| Grid area | CSS grid-template-columns value | Contents |
|-----------|--------------------------------|----------|
| telemetry | minmax(280px, var(--wide-left-w, 280px)) | Status-strip fields (depth, seed, party HP sigils, danger clock, corruption; round/initiative/AP in combat) stacked vertically at the top; persistent live LOG feed occupies the remainder |
| playfield | minmax(320px, 1fr) | Canvas playfield fills the middle (AMENDED 2026-08-17 via map-pan-zoom); the descent premise stays vertical in the **content** — the 20×32 world seen through the M104 pan/zoom viewport camera — not in column geometry |
| console | max(360px, var(--wide-right-w, 360px)) | Console dock — always expanded, seven vertical mode tabs on the inner edge, mode content in the remainder; **fixed user-chosen width** |

The grid template is `grid-template-columns: minmax(280px, var(--wide-left-w, 280px)) minmax(320px, 1fr) max(360px, var(--wide-right-w, 360px));` with `grid-template-rows: 100vh;` on the shell. At the 900px minimum breakpoint the three regions sum to their floors (960px, matching the breakpoint — see the collapsed rail values below for the compact-mode floor). The middle playfield track always holds 1fr and absorbs surplus width; the docks are fixed at their user-chosen widths.

**Surplus-width distribution (AMENDED 2026-08-17 via map-pan-zoom).** The playfield column absorbs ALL surplus viewport width in every pane state via the middle track's 1fr — the map docks and fills the entire center. The telemetry column stays at its user-chosen width (unbounded growth adds nothing to a stacked readout), and the console dock is fixed at `max(360px, --wide-right-w)` — `--wide-right-w` is again the dock's fixed user-chosen width (not a floor), so a drag to 500px sets the dock at exactly 500px. Tracks always sum to 100vw so both rails stay flush to their viewport edges at every pane combination — collapsed (48px / 96px) or open. The `--wide-middle-w` helper var is retired; the right resize handle is re-anchored from the viewport-right by the dock's own fixed width (`max(360px, --wide-right-w) - 4px`).

**Wide dock sizing and collapse (M100).** Both docks are user-resizable and user-collapsible. The M100 pane controller (`attachWidePanes` in `src/ui/layout.js`) owns `--wide-left-w`, `--wide-right-w`, `data-pane-left`, and `data-pane-right` on the wide shell.

| Pane | Bounds (open) | Default | Collapsed rail width | Persisted key |
|------|---------------|---------|----------------------|---------------|
| Telemetry (left) | 280–480px | 280px | 48px (chevron-only) | `settings.widePanes.left` |
| Console (right) | 360–640px | 360px | 96px (tab column stays usable) | `settings.widePanes.right` |

The open-state minimums (280 / 360) match the outer `.wide-shell` grid floors so the CSS never renders a track narrower than the pane state can request; users widen from the default, and collapse handles the compact rail state instead.

Behavior:

- **Resize.** Pointer-drag an 8px handle straddling each dock/playfield gap. Keyboard-focus a handle (`role="separator"`, `aria-orientation="vertical"`, `tabindex="0"`) and press ArrowLeft/Right to nudge by 16px; the handler `stopPropagation()`s so the screen's move-input never sees the arrow.
- **Reset.** Double-click a handle to restore the default (280 / 360).
- **Collapse.** Click a `.pane-collapse-btn` chevron. Collapsed telemetry hides its content behind a 48px rail; the chevron flips to point outward and re-expands on click. Collapsed console hides `.wide-console-content`; the 96px `.wide-console-tabs` column stays visible and interactive, so clicking any tab re-expands the content pane to the persisted (or default) width.
- **Persistence.** Persisted through the existing settings passthrough (`saveSettings({ widePanes: { left, right } })`, values are numeric px or the string `'collapsed'`); read defensively via `loadSettings()` — non-finite values fall back to the default, out-of-range values clamp to bounds.
- **Bounds guarantee (AMENDED 2026-08-17 via map-pan-zoom).** At every valid pane combination the middle playfield track stays ≥ 320px, the console dock stays ≥ 360px (open) or exactly 96px (collapsed), the telemetry stays ≥ 280px (open) or exactly 48px (collapsed), and both rails sit flush against their viewport edges. The 9:16 invariant on the playfield column is retired — the descent premise now lives in the content behind the M104 viewport camera.

**Wide flow-screen layouts.** Non-game screens each use the width purposefully. Full per-screen
matrix in **Screen Layouts by Class** below; summary:

- **title** — centered column, wider ornament field, branch list unchanged
- **creation** — two-pane: roster + saved configs (left) / editor (right)
- **library** — run-card grid
- **tutorial** — two-page spread
- **settings** — two-column form
- **scorecard** — two-pane: summary (left) / share panel (right)
- **import** — centered column (unchanged width)

**Console dock (wide).** Same seven mode content, same bus events, same keyboard shortcuts,
same touch parity — only the container changes:

- Always expanded — the collapse state does not exist in wide; the dock is a fixed shell.
- The seven mode tabs (MOVE, COMBAT, PARTY, GEAR, TECH, LOOT, LOG) stack **vertically** along
  the dock's inner edge. Each tab still uses the `.mode-tab` visual language (accent underline
  becomes an accent left-border in vertical orientation; active state, hover state, and
  `.disabled` behavior unchanged).
- The disabled-tab convention from portrait (COMBAT during exploration, LOOT during combat,
  etc.) applies identically.
- Expanded content fills the remainder of the dock at the mode's native layout — no scaling,
  no reflow between mode swaps.
- The `.console-dim-layer` overlay does NOT apply in wide — the playfield is not dimmed
  because the dock does not overlap it.
- Mode-switch bus event `ui:mode-change` is emitted identically; portrait and wide subscribers
  share the handler.

**Telemetry dock (wide).** The status-strip fields — currently a single horizontal row in
portrait per **Status Strip (Top)** above — rearrange into a vertical stack at the top of the
dock. Same fields, same content, same accessibility guarantees (danger clock stays numeric,
never color-only). Below the fields, a **persistent live LOG feed** streams the same entries
LOG mode displays: same `.log-entry` container class, same log-severity classes
(`.log-combat`, `.log-discovery`, `.log-damage`, `.log-death`, `.log-heal`, `.log-info`,
`.log-move`), same `[T:NNN]` timestamp prefix, same sticky "◈ Event Log — Floor NN" header,
same auto-scroll-to-newest behavior as `mocks/console-log.html`. The feed does not require
opening the LOG mode tab; LOG mode remains reachable in the console dock for the copy-link
action and full-history scroll.

**Input target rules.**

| Class | Touch-capable rows | Pointer-only affordances |
|-------|--------------------|--------------------------|
| portrait | 96px minimum (unchanged, per **Console Interaction Model** and the Spacing System floor) | — |
| wide | 96px minimum on any touch-capable row | May densify to 44px minimum on hover-driven or pointer-only controls — never below |

The 96px touch-target minimum in the Spacing System is a **class-independent floor** for any
row a touch device may hit. Wide only permits densification on rows that are explicitly
pointer-only (e.g. hover-revealed secondary controls, keyboard-cycled item chips in a
desktop-only editor).

**Class namespace.** New CSS structures that exist only in wide use a `wide-` class prefix
(e.g. `.wide-shell`, `.wide-telemetry-dock`, `.wide-console-dock`, `.wide-mode-tab`). This
lets tooling exclude planned-only structures from portrait-scope parity checks and marks the
implementation surface unambiguously for the follow-up implementation feature.

**Portrait Console Expand States (2026-08-21 · mobile-ux-and-combat-readout SESSION-02).**
The portrait `.console-bar` cycles through **three** height states — the wide dock (`variant:
'dock'`) is unaffected and stays full-height. Legacy `.expanded` / `.collapsed` class names
are preserved (mocks, keyboard-flow e2e `/expanded/` regex, and the M97 design-scan
`check-mock-classes` rule depend on them); the new `data-expand-state` attribute
disambiguates size.

| State | Height (portrait) | Container classes | `data-expand-state` |
|-------|-------------------|-------------------|---------------------|
| collapsed | tab bar only (~64px) | `console-bar collapsed` | `collapsed` |
| half | 50% of the portrait frame | `console-bar expanded expanded-half` | `half` |
| full | 100% of the portrait frame | `console-bar expanded expanded-full` | `full` |

**Tap-cycle.** Tapping the currently-active tab cycles `collapsed → half → full → collapsed`.
Tapping a different tab switches mode; it opens the console at `half` only when it was
collapsed, otherwise it keeps the current size. The intent payload dispatched via
`CONSOLE_INTENTS.expand` / `CONSOLE_INTENTS.collapse` now carries `{ mode, size }` so
downstream listeners can distinguish half vs full landings; the pre-existing `ui:console-expand`
/ `ui:console-collapse` / `ui:camera-request` events fire on every landing state.

**Status-strip collapse (portrait exploration + combat).** The strip carries a trailing
`.status-collapse-toggle` button beside the manual `?` chip. The affordance is a text glyph
matching the d-pad's unicode-arrow precedent — `▴` when expanded, `▾` when collapsed — with
a 44×44 tap floor (M97 `check-touch-targets`). Clicking toggles the `status-collapsed` class
and flips `aria-expanded`; the collapsed row hides seed, initiative, danger, clock, and the
active-actor charge bar / move flag while keeping DEPTH, ROUND (combat), the active sigil,
mini-HP, and AP legible.

**Portrait Combat (2026-08-21 · mobile-combat-pass SESSION-04).** In portrait, the COMBAT
console pane is actions-first: the pinned status strip owns the readout (HP / CHARGE / AP /
MV + initiative), so the pane drops the full active panel and initiative rail and keeps only
a slim `.combat-active-conditions` row (AP repeated for glance-ability alongside the actions,
plus condition tags — the strip shows neither). The action list is a 2-column grid where
`combat-action--primary` (Move / Attack / End Turn) spans both columns for thumb reach and
the four secondary actions (Protocol / Overclock / Item / Retreat) pair up in two-column
rows; every action keeps a 48px minimum tap floor. The wide dock is unaffected and keeps its
full active panel + initiative rail. The combat map defaults to a legible portrait zoom
(`zoomToCells(COMBAT_CELL_SIZE, 64)` on the M104 viewport camera) centered on the active
actor. The console auto-presents per turn — expand to `half` on party turn, collapse on
enemy playback — with a per-turn manual override via `ui:console-collapse` so the console
never fights the player.

### Screen Layouts by Class

One row per screen × {portrait, wide} for all 15 mock screens. The **portrait** column
documents the current, production-matched behavior plus the fluidity rule (the frame fills
the viewport width up to the class boundary — no fixed 450px cap in production; the max-width
in current mocks is a preview convenience). The **wide** column names the structural
composition; details are governed by the Adaptive Layout System contract above and the
approved wide keystone mocks (`mocks/wide/exploration.html`, `mocks/wide/combat.html`) once
authored. The **shared** column names what is class-independent and unchanged across the
switch.

Type-scale note: **all type-scale values are design-px and valid in both classes** — Display
48px, Heading 24px, Subheading 18px, Body 14px, Caption 12px, Micro 10px for text; Sigil-34,
Sigil-72, Sigil-108, Sigil-220 for sigil glyphs. The class switch does not re-tune font size,
line-height, letter-spacing, or sigil sizing. Palette tokens, corner radii, shadow/glow
levels, CRT/glitch timing constants, and bus event names are likewise class-independent.

| # | Mock file | Portrait layout | Wide layout | Shared across classes |
|---|-----------|-----------------|-------------|------------------------|
| 1 | `mocks/title.html` | Full-viewport CRT background; centered vertical stack — machine header, ◈ ornament + title lockup + tagline, START control, branch list (revealed post-START), footer legalia. Frame fills viewport width up to the class boundary. | Centered vertical stack retained; ornament field widens with the viewport; branch list narrows to ~40% viewport width or a fixed max centered under the lockup. No dock; the CRT effects fill the whole viewport. | Title lockup content, tagline, START WebAudio-gesture role, branch labels, tutorial-offer flag, ◈ ornament, palette, type scale, CRT constants |
| 2 | `mocks/creation.html` | Full-viewport CRT background; single-column tabbed editor (CLASS → SIGIL → ATTR → GEAR → TECH tabs), live readout header (points remaining, credits, AP/round), character slot bar, blueprint / saved-configs row, action footer. | Two-pane split: **left pane** = roster + saved-configs + readout (fixed ~40% viewport width, minmax(360px, 40%)); **right pane** = editor for the selected slot (all creation subsections stacked, no tab switching needed at ≥900px). Action footer spans both panes. | 80-point buy math, class definitions, sigil bank rules, gate/cost tables, live readout format, saved-config CRUD, finalize action |
| 3 | `mocks/exploration.html` | Full-viewport CRT frame; top status strip, 20×32 lattice fills the middle, bottom-pinned expanded console with 7-tab horizontal bar and MOVE mode content. | **Three-region shell** per **Wide game-screen shell** above: telemetry dock (status fields stacked + live LOG feed) \| playfield column that fills the middle (20×32 lattice viewed through the M104 pan/zoom viewport camera) \| console dock (7 vertical tabs, MOVE expanded, no collapse). Full-viewport CRT covers all three regions. | 20×32 lattice, shadowcast LOS, fog-of-war states, auto-stop rules, MOVE keyboard/touch mapping, danger-clock display |
| 4 | `mocks/combat.html` | Full-viewport CRT frame; top status strip (depth + round + initiative rail + active HP/CHARGE), 8×16 combat grid at 2× zoom fills the middle, bottom-pinned expanded console with COMBAT mode (actions, targeting sub-mode). | Three-region shell: telemetry dock (status fields stacked, initiative rail vertical or wrapped, active-actor readout, live LOG feed) \| portrait-proportioned combat grid column (8×16, 9:16 aspect) \| console dock (7 vertical tabs, COMBAT active, targeting sub-mode inside the dock). | 8×16 grid geometry, initiative order, AP costs, targeting flow, range bands, cover, condition tags, deployment separation rules |
| 5 | `mocks/console-party.html` | Bottom-anchored expanded console overlaying dimmed playfield; PARTY mode content (member list, selected member detail, attributes, HP/CHARGE/conditions, corruption contribution). | Console dock at the right of the three-region shell hosts the same PARTY mode content in its native layout. Playfield is NOT dimmed in wide (the dock does not overlap it); telemetry dock keeps status + LOG feed visible. | Member data model, attribute display formulas, condition tag classes, HP/CHARGE/AP indicators, corruption tally |
| 6 | `mocks/console-gear.html` | Bottom-anchored expanded console overlaying dimmed playfield; GEAR mode content (character selector, equipped slots, inventory list, junk toggle, CORRUPT warning, scrap counter). | Console dock hosts GEAR content in its native layout; playfield not dimmed. | Equipment slot model, inventory 100-cap enforcement, junk/scrap system, CORRUPT warning styling, salvage math |
| 7 | `mocks/console-tech.html` | Bottom-anchored expanded console overlaying dimmed playfield; TECH mode content (character row, protocol deck, CHARGE display, cast/overclock buttons, target list, deck-slot pip row). | Console dock hosts TECH content in its native layout; playfield not dimmed. | Deck slot capacity, CHARGE math, protocol tier costs, overclock flow with corruption risk, class-gated protocol lists |
| 8 | `mocks/console-loot.html` | Bottom-anchored expanded console overlaying dimmed playfield; LOOT mode content (container header, container items, take flow, inventory-full warning, item detail). | Console dock hosts LOOT content in its native layout; playfield not dimmed. | Container access rules, take flow, inventory-cap warning, item detail (stats, rarity, affixes, CORRUPT status) |
| 9 | `mocks/console-log.html` | Bottom-anchored expanded console overlaying dimmed playfield; LOG mode content (scrolling event log, sticky "◈ Event Log — Floor NN" header, copy-link action with URL fragment display). | Console dock hosts LOG content (full history + copy-link) in its native layout; playfield not dimmed. Same feed also streams live into the telemetry dock (auto-scrolls to newest) per **Telemetry dock (wide)** above. | Log entry format, `[T:NNN]` timestamp prefix, log-severity classes, URL fragment schema (< 1500 chars), copy-link action |
| 10 | `mocks/library.html` | Full-viewport CRT frame; header + vertical list of run rows (accent swatch, seed, depth, party sigils, controls) + library actions footer. | Full-viewport CRT frame; header + **run-card grid** (2–3 cards per row depending on viewport width, `repeat(auto-fill, minmax(320px, 1fr))`) + library actions footer. Each card contains the same run-row content laid out for a rectangular card footprint. | Run row content model, accent-swatch generation, load/delete flow, "New Run" / "Title" actions, broken-run error state |
| 11 | `mocks/settings.html` | Full-viewport CRT frame; vertically stacked form (master mute, master volume, five per-layer volume sliders, glitch toggle, reduced-motion override, scanline/grain toggle) + back action. | Full-viewport CRT frame; **two-column form** — left column = audio (master mute + master volume + five per-layer sliders), right column = visual (glitch toggle, reduced-motion override, scanline/grain toggle) + back action spanning both columns. | Setting keys, localStorage schema, 96px touch-row minimum on any settings row (even the pointer-only ones stay ≥96px for parity), slider/toggle visuals |
| 12 | `mocks/scorecard.html` | Full-viewport CRT frame; vertical stack — final depth display, roster with cause-of-death annotations, seed readout, share-link display, action row (restart same seed, new run, title, library). | Full-viewport CRT frame; **two-pane** split — **left pane** = summary (larger final-depth display, roster, cause-of-death, seed) `minmax(360px, 1fr)`; **right pane** = share panel (share-link display, action row) `minmax(320px, 1fr)`. | Final-depth math, roster rendering with dead-marker styling, cause-of-death copy, seed display, share-link generation (`#w=` only after wipe), action set, scrap-recovered readout |
| 13 | `mocks/import.html` | Full-viewport CRT frame; centered column — link input, IMPORT button, simulate-failure buttons, named-failure screens (truncated / version mismatch / checksum / malformed), success screen with RESUME RUN. | Full-viewport CRT frame; centered column retained at the same input width (a wider input would not read as a link); failure/success screens still centered. Ornament field around the column may widen. | Named failure types, error copy, seed-recoverable branch, fresh-run-in-world action, return-to-title action |
| 14 | `mocks/tutorial.html` | Full-viewport CRT frame; single-page paginated view — page title, illustration area (CSS-drawn console mock), body text, page dots, prev/next navigation, skip-to-title action. | Full-viewport CRT frame; **two-page spread** — current page on the left (illustration + body), next page on the right (illustration + body) so the reader sees the transition. Prev/next advances both panes by two; page dots reflect the leftmost page. At the last page the right pane shows a "Return to title" summary card. | Manual page content, illustration components, prev/next navigation contract, page-dot indicator, decline flag persistence |
| 15 | `mocks/index.html` (Prototype Hub) | Full-viewport CRT frame; header + vertical list of screen links grouped by flow (primary, console modes, library/scorecard/import, tutorial/settings). | Full-viewport CRT frame; header + **screen preview grid** (`repeat(auto-fill, minmax(240px, 1fr))`) with a small preview thumbnail or label chip per screen. Each card links to the matching mock file (portrait or wide depending on the toggle state per SESSION-06's layout-aware navigation). | Screen inventory list, cross-mock navigation targets, flow groupings, class-switch toggle (added in SESSION-06) |

## Prototype Navigation Notes

The interactive prototype (`mocks/index.html`) links all 15 mock screens together with live navigation. The following navigational connections are implemented:

### Primary Flow (New Run)
- `title.html` START button → reveals branch buttons (Begin New Run, Run Library, Import Link, Tutorial, Settings)
- `creation.html` "Finalize & Descend" → `exploration.html`
- `exploration.html` "HOSTILE DETECTED" alert banner → `combat.html`
- `combat.html` "CONFIRM" button → `scorecard.html` (simulates attack resolution → party wipe path)
- `scorecard.html` actions → `creation.html` (restart same seed), `creation.html` (new run), `title.html`, `library.html`

### Console Mode Navigation
All in-play screens (exploration, combat, and 5 console mode mocks) share the 7-mode tab bar. Each tab navigates to its corresponding mock:
- MOVE → `exploration.html`
- CMBT → `combat.html`
- PARTY → `console-party.html`
- GEAR → `console-gear.html`
- TECH → `console-tech.html`
- LOOT → `console-loot.html`
- LOG → `console-log.html`
- "TAP TO COLLAPSE" on any console mode → `exploration.html`
- Disabled tabs (e.g., CMBT during exploration, LOOT during combat) are not clickable

### Resume Flow
- `title.html` → "Run Library" → `library.html`
- `library.html` any run row → `exploration.html`
- `library.html` "New Run" → `creation.html`
- `library.html` "Title" → `title.html`

### Import Flow
- `title.html` → "Import Link" → `import.html`
- `import.html` IMPORT button → success screen → "RESUME RUN" → `exploration.html`
- `import.html` simulate buttons → named failure screens
- Failure screens with readable seed → "Fresh Run in This World" → `creation.html`
- All failure screens → "Return to Title" → `title.html`

### Tutorial Flow
- `title.html` → "Tutorial" → `tutorial.html`
- `tutorial.html` page navigation (prev/next) stays within tutorial
- `tutorial.html` "SKIP / BACK TO TITLE" → `title.html`

### Settings Flow
- `title.html` → "Settings" → `settings.html`
- `settings.html` "Back" → `title.html`

### Requirements Coverage in Mocks

The following requirements have visual representation in the updated mocks:

| FR | Mock | Coverage |
|----|------|----------|
| FR-3 | `creation.html` | 80-point buy, live readout (points, credits, AP/round), character slots, class/sigil/attr/gear/tech tabs |
| FR-15 | All in-play mocks | 7-mode console, tab bar, expand/collapse, dimmed playfield, 96px+ touch targets |
| FR-31 | `scorecard.html` | Final depth, roster, cause of death, seed, share link, restart same seed, scrap recovered, credits |
| FR-34 | `settings.html` | Master mute, master volume, 5 per-layer audio sliders, glitch toggle, reduced-motion, scanline toggle |
| FR-50 | `console-gear.html` | Inventory cap (7/100), scrap counter, "Junk All Tagged" action, junk toggle concept |
| FR-51 | `creation.html` | Saved party configurations row (horizontal scroll, named configs, save slot) |
| FR-28 | `console-log.html` | Copy link action with URL fragment display, full run state share |
| FR-29 | `import.html` | All 4 named failure screens (truncated, version mismatch, checksum, malformed), seed recovery |
| FR-23 | All mocks | CRT/VHS effects: scanlines, grain, vignette, tracking band, glitch bars, noise lines, VHS events, border flicker, frame flash, per-element text glitch with chromatic ghosts |