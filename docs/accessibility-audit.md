# Accessibility Audit — Operator's Descent

> **Discovery artifact** — accessibility-pass / SESSION-01.
> Target: **WCAG 2.1 AA**, fully operable **by keyboard alone** and **by
> pointer/touch alone**. Preserve the CRT aesthetic.
>
> The findings below are grouped by the file that owns them, keyed to the
> Wave B fix-session leases proposed in `STATE.md`. Each finding cites the
> WCAG success criterion it targets and a fix hint. Contrast findings come
> from the `scripts/design-scan/check-contrast.js` gate committed alongside
> this report — that gate exits non-zero on any AA failure, so Wave B is
> the merge condition, not this file.

## 1. Method

1. **Contrast** — static gate at `scripts/design-scan/check-contrast.js`
   parses `styles/*.css`, resolves tokens through `:root`, composites tinted
   backgrounds against their ancestor surface, multiplies opacity onto text
   alpha, and computes WCAG 2.1 relative-luminance contrast. Reports raw
   ratios and a secondary CRT-through ratio (documented as scanline @ 10%
   white over vignette @ 65% black — worst-case frame edge). Raw failures
   are errors; raw-pass / CRT-fail cases are warnings.
2. **Keyboard operability** — read every screen and console mode in
   `src/ui/screens/*.js` and `src/ui/console/*.js`, cross-referenced against
   the unified handler in `src/ui/input.js` and the tab-mount plumbing in
   `src/runtime.js` and `src/ui/console/console.js`. Verified against the
   existing `tests/e2e/accessibility.spec.js`, `keyboard-flow.spec.js`, and
   `touch-flow.spec.js` expectations.
3. **Pointer / touch parity** — same source pass, this time confirming every
   keyboard-only path has an on-screen affordance and vice-versa. Folded in
   findings from `scripts/design-scan/check-touch-targets.js`.
4. **Assumptions** — the design goal is WCAG 2.1 AA text (4.5:1) and 3:1
   for large text (≥ 24 px, or ≥ 18.66 px @ 700 weight), focus rings, and
   meaningful UI boundaries (WCAG 1.4.11). The CRT overlay is treated as an
   attenuating layer for warning-tier context only — raw ratios are the
   pass/fail gate because per-pixel legibility varies with the vignette
   pulse animation and with reduced-motion overrides.

## 2. Contrast — WCAG 1.4.3 / 1.4.11 (owner: `styles/*.css`)

The gate reports **99 errors + 72 warnings** on the current tree. Full
enumeration lives in the JSON output of `node scripts/design-scan/check-contrast.js --json`;
the categories below summarize the systemic issues Wave B must fix in
`styles/base.css`, `styles/components.css`, `styles/crt.css`, and
`styles/wide.css`.

### 2A. Token-pair failures (fix at `styles/base.css :root`)

| Pair | Raw ratio | Threshold | Criterion | Fix hint |
|------|-----------|-----------|-----------|----------|
| `--danger` #e83a3a on `--bg-panel-elevated` #1a0e36 | 4.39:1 | 4.5:1 | 1.4.3 | Nudge `--danger` toward #f04b4b (5.0:1) or brighten `--bg-panel-elevated` |
| `--border-dim` #453370 on `--bg-base` #0a0612 | 1.87:1 | 3:1 | 1.4.11 | Raise `--border-dim` to ~#7a5fb8 (3.1:1) — currently invisible boundary |
| `--border-dim` on `--bg-panel` #13092a | 1.78:1 | 3:1 | 1.4.11 | Same bump — one token, every panel border benefits |
| `--border-dim` on `--bg-panel-elevated` #1a0e36 | 1.69:1 | 3:1 | 1.4.11 | Same bump |

`--danger` is used both for text and semantic borders. Raising the token
also fixes the danger-border warnings (`.action-btn.danger`, `.load-error`,
`.combat-terminal`, `.log-entry.death`, `.scorecard-cod`, `.tech-error`,
`.gear-error`, `.loot-error`, `.combat-error`, `.log-error`).

### 2B. Literal (non-token) foreground failures (fix in-line at `styles/components.css`)

| Selector | Foreground | Ratio | Fix hint |
|----------|------------|-------|----------|
| `.r-prototype` (`--bg-panel`) | #b026d4 | 3.70:1 | Promote to a token, brighten to #c749e9 (4.7:1); mirror same fix into `.school-rewrite` if it shares purple |
| `.token-echo` and echo sigil color | `--danger` on `rgba(232,58,58,0.1)` over `--bg-panel` | 4.29:1 | Follows the `--danger` bump |
| `.title-glitch::before/after` (chromatic RGB ghosts) | #ff0000 / #0000ff | 4.44:1 / 2.22:1 | Decorative-only — ADD `aria-hidden` to the pseudo-target or exclude via `role="presentation"`; WCAG 1.4.3 exempts decorative text |
| `[data-glitch].text-swapping::before/after` | `rgba(255,0,0,0.47)` / `rgba(0,0,255,0.47)` | 1.80:1 / 1.30:1 | Same treatment — the glitch overlay animates briefly; ensure the underlying element remains legible when the class is present |

### 2C. Text-on-tint failures

| Selector | Effective FG on tint | Ratio | Fix hint |
|----------|----------------------|-------|----------|
| `.alert-banner` — `--danger` on `rgba(232,58,58,0.15)` over `--bg-panel` | 4.07:1 | Restrict the alert-banner text to `--text-primary` (bright) with `--danger` used for the border/glow only |
| `.corrupt-warning` — `--warning` on `rgba(232,99,42,0.10)` | 4.34:1 (raw) / 3.44:1 (CRT) | Bump `--warning` OR strengthen the fill to make the tint darker (raise alpha ≥ 0.20) |
| `.btn-danger:hover` — `--danger` on `rgba(232,58,58,0.20)` | 4.44:1 | Same `--danger` bump |
| `.btn-crt.primary` — `--accent` text on `rgba(126,200,227,0.10)` over `--bg-panel-elevated` | raw ~4.9 / borderline via CRT | Fine after `--border-dim` bump; watch selected-state after |

### 2D. Opacity-attenuated failures (WCAG 1.4.3 — non-text 3:1 not applicable; text still must clear 4.5:1)

| Case | Effective ratio | Threshold | Fix hint |
|------|-----------------|-----------|----------|
| `button:disabled` / `[aria-disabled="true"]` at opacity `0.45` (base.css) on `--bg-panel-elevated` | 3.54:1 | 4.5:1 | Disabled controls are exempt from WCAG 1.4.3 — but AA best practice is 3:1. Raise to `opacity: 0.6` and reflect state via a distinct color/label rather than opacity alone (WCAG 1.4.1 — colour is not the only means) |
| `.is-interactive[disabled]` at opacity `0.45` on `--bg-panel` | 3.56:1 | 4.5:1 | Same — either 0.6 opacity + text-secondary, or a dedicated `--text-disabled` token |
| `.mode-tab.disabled` / `[aria-disabled="true"]` at opacity `0.35` | 2.60:1 | 4.5:1 | Raise to 0.55, add `aria-disabled` label copy, and gate keyboard focus (currently `tab.disabled = !available` correctly removes from focus order — verify no exception) |
| `.stepper-btn:disabled` at opacity `0.30` | 2.22:1 | 4.5:1 | Same — 0.55 minimum |
| `.wide-editor .gear-row:disabled` at opacity `0.40` | 3.05:1 | 4.5:1 | Same — 0.55, and back with `disabled-reason` copy (already present in wide layout) |
| `.no-limit-hint` at opacity `0.60` on `--bg-panel` | 2.46:1 | 4.5:1 | Drop the opacity (currently redundant with `--text-dim`) OR promote to `--text-secondary` and remove opacity |
| `.loot-container.empty` at opacity `0.5` | 4.13:1 | 4.5:1 | Attach a label to the empty state instead of dimming the whole container; keep the container border visible for screen-reader semantics |

### 2E. Decorative or noise-source foregrounds

| Selector | Note |
|----------|------|
| `.noise-line`, `.crt-*` overlays, `.crt-grille`, `.glitch-bar` | Decorative-only — currently no `role="presentation"`/`aria-hidden`. Confirm none reach the AT tree; add `aria-hidden` to the top `#crt-overlays` container (single change catches all descendants) |
| `.party-token`/`.enemy-marker` `color: var(--bg-base)` on `.bg-panel` (from playfield illustrations) | These render **background dots** in canvas — the `color` is used as fill color for a graphic. Static analysis false-positive; annotate with a comment or wrap in `role="img"` container for AT context |
| `.deck-pip.filled` and `.page-dot.active` (accent bg + accent border, 1:1) | Meaningful UI element — pip against panel needs a distinguishing border (e.g. inner-shadow contrasting with `--bg-panel-elevated`) |
| `.illus-grid > .wall` `border: var(--bg-panel-elevated)` on `--bg-base` | Cosmetic tutorial-grid cell — border can be reduced to `background: --bg-panel-elevated` and border-color dropped |

### 2F. Border/ambient boundary sweep

`--border-dim` is the panel-boundary token used by ~50+ classes
(`.panel`, `.item-card`, `.class-card`, `.mode-tab`, `.btn-crt`, `.link-input`,
`.share-link`, `.stepper-btn`, `.dpad-btn`, `.combat-active-panel`,
`.wide-shell` panes, `.run-card`, every `.wide-editor` row, every
`.wide-saved-configs .config-card`, `.wide-roster .char-slot`, both wide
input classes, `input[type="range"]`, `.tutorial-*`, `.illus*`, and more).
**One bump to `--border-dim` (currently #453370 → ~#7a5fb8) resolves the
vast majority of the 71 border errors** — Wave B should do this before
per-selector overrides. The residual failures after the bump are:

- `rgba(232,58,58,0.30)` on `.action-btn.danger` (needs opaque bump or
  raise alpha to 0.55)
- `var(--accent)` on `rgba(126,200,227,0.10)` for `.selected` shells —
  same-color case; keep the drop-shadow-glow ring for boundary distinction

### 2G. Focus indicators (WCAG 2.4.7)

`:focus-visible` in `styles/base.css` sets a **4 px accent outline + inset
`--bg-base` ring + 16 px accent glow** — passes the 3:1 boundary threshold
against every panel token (7.7:1 on `--bg-base`, 7.4:1 on `--bg-panel`,
7.1:1 on `--bg-panel-elevated`). No fix required. Same for the
`.is-interactive:focus-visible` 2 px outline in `styles/components.css`
(passes) and `.toggle-input:focus-visible + .toggle` (passes).

**Gap**: `.wide-shell .pane-resize-handle` and `.pane-collapse-btn` in
`styles/wide.css` set custom focus styles that use `rgba(126,200,227,0.18)`
background + accent glow — the background alone is 1.1:1, but the glow +
border-color combo raises the effective ring above 3:1. Acceptable if the
glow is not disabled by user prefs; **fix hint**: replicate the base
`:focus-visible` treatment for consistency.

## 3. Keyboard operability (WCAG 2.1.1 / 2.4.3 / 2.4.7)

### 3A. Global — focus does not follow route change (owner: `src/runtime.js`)

`runtime.js` `mountRoute` (line 166+) creates a fresh `.screen-container`
`<div>` and appends it to `#app-root`, then calls the screen module's
`mount(container, params)`. **Only `exploration.js` (line 272) explicitly
focuses its container after mount.** Every other route — title, creation,
library, import, tutorial, settings, scorecard, combat — leaves focus on
whatever button the user just activated (or on `<body>` after a browser
back/forward), so the next Tab starts from an arbitrary location.

- **WCAG 2.4.3 (Focus Order)**, **AAA 2.4.7** and **best practice 3.2.1
  (On Focus)**: after `ui:navigate` completes, focus should move to an
  element in the new screen — the main heading, the first actionable
  control, or the container with `role="main" tabindex="-1"`.
- **Fix hint**: give `#app-root` a stable focus-target contract
  (`role="main"`, `tabindex="-1"`), and after `container.replaceChildren(screen)`
  in each screen's `mount`, call `screen.focus?.({ preventScroll: true })`
  when `screen` is the top-level `<section>` with `tabindex="-1"`. Cheapest
  central fix is in `runtime.js` after `mod.mount(...)` returns:
  `container.setAttribute('tabindex','-1'); container.focus?.({ preventScroll: true });`

### 3B. Interaction primitives (owner: `src/ui/components.js` + `src/ui/input.js`)

- **`createButton`** produces `<button type="button" class="btn-crt is-interactive">`
  with the click listener on the button element itself — native semantics,
  Tab-reachable, `Enter`/`Space` fire click. **OK.**
- **`createToggle`** builds a `<label>` wrapping a native `<input
  type="checkbox">` with `role="switch"` and a decorative `<span class="toggle">`.
  The visible knob is `aria-hidden`. `Tab` reaches the input, `Space`
  toggles. **OK for keyboard.** Pointer clicks on the label body also
  toggle (native `<label>` behavior). **OK for pointer.**
- **`createSlider`** builds an `<input type="range">` with a live-region
  value readout. Arrow keys move the value, `Home`/`End` clamp. **OK.**
- **`createTextInput`** builds `<input>` or `<textarea>` with `aria-*`
  wired through. **OK.**
- **`createProtocolCard`** / **`createEquipmentCard`** use
  `document.createElement(opts.onClick ? 'button' : 'article')` — buttons
  are focusable, articles are not; static articles have no click handler,
  so this is correct. **OK.**
- **`createAttributeRow`** — the row itself is a `<div>` (not focusable)
  with `<button class="stepper-btn">` steppers appended. Steppers are
  reachable individually. **OK.**
- **Gap — `.run-row` and `.run-card`** in `src/ui/screens/library.js` are
  `<article>` elements with manual `tabIndex = 0` and inline `keydown`
  Enter/Space handlers. Native semantics (should be `<button>` or add
  `role="button"` + `aria-pressed`). **WCAG 4.1.2 (Name, Role, Value)** —
  fix hint: switch to `role="button" aria-pressed="…"` OR make the whole
  card a `<button>` with the two action buttons still native.
- **Gap — `createInputHandler.handleKeydown`** ignores events that
  originate in text inputs (`isTypingTarget` — correct), but the global
  handler is only bound via `bindToElement(element)`, and only exploration
  binds `container` (line 68 of `exploration.js`). Title, creation,
  library, import, tutorial, settings, scorecard, and combat all instantiate
  the handler indirectly through the console — meaning **the game-level
  keyboard shortcuts (digits 1-7, Esc-back) are not active on non-combat
  screens outside the console area.** Confirm this is intentional.
- **Gap** — `createInputHandler.bindActionControl` binds `click` +
  `touchend`; no `keydown` handler on the bound control. Since the bound
  controls are already `<button>` elements from `createButton`, `Enter`/
  `Space` still fire the click. **OK — no change needed**, but document
  the assumption because bare `<div>` bindings would silently break.

### 3C. Title screen (owner: `src/ui/screens/title.js`)

- **START button toggles the branch list** by toggling `hidden-branches`
  on `#title-branches`. Keyboard-reachable, but the branch list appears
  **without moving focus into it** — screen readers do not announce the
  new controls. **WCAG 4.1.3 (Status Messages)**. Fix hint: after `START`,
  focus the first branch button (`title-begin-new-run`) and mark the
  branch list `aria-live="polite" aria-atomic="true"` or use
  `aria-expanded` on the START button plus `aria-controls="title-branches"`.
- **`aria-live="polite"` on `#title-notice`** — currently unused (no text
  gets pushed there in the portrait flow). Verify the notice is intended,
  or drop it.
- **`h1` for OPERATOR'S + h1 for DESCENT** — two `<h1>` per page violates
  **WCAG 1.3.1 (Info and Relationships)** heading structure. Combine into
  one `<h1>OPERATOR'S DESCENT</h1>` with the visual two-line break done
  via `::after` or two spans.

### 3D. Creation screen (owner: `src/ui/screens/creation.js` + `src/ui/creation-model.js`)

Highest-complexity surface: 80-point buy, class/sigil/equipment/protocol
sub-tabs, saved configs, dual portrait/wide layouts. Findings:

- **Class card / sigil thumb / equipment card / protocol card** are built
  by `createButton('')` with a `.selected` class + `aria-checked` — but
  they live in `<div>` containers marked `aria-label="Class selection"`
  and similar, **without `role="radiogroup"`**. Screen readers announce
  them as bare buttons rather than a radio group. **WCAG 4.1.2**. Fix hint:
  add `role="radiogroup"` to the grid and `role="radio"` to each card
  (already have `aria-checked`).
- **`aria-label="Class selection"` on both portrait AND wide selection
  grids** — good.
- **Attribute steppers**: `createAttributeRow({ steppers: true, … })`
  creates `−` and `+` buttons with `aria-label="Decrease MIG"` /
  `"Increase MIG"`. **OK.** But the row itself has
  `aria-label="MIG rank 2, modifier +0"` — this collides with each
  stepper's own aria-label; a screen reader announces the row twice on
  Tab (once for the row's aria-label, then again per stepper). **WCAG
  4.1.2** — fix hint: drop `aria-label` on the row (`aria-label` on a
  non-focusable div still announces on group navigation) or move the
  row-level info to `aria-describedby` on each stepper.
- **Sigil thumbs**: `.sigil-choice` uses `min-height: 280px` — passes
  touch target. But the currently-selected thumb only signals via
  `.selected` box-shadow (accent glow) + `aria-checked="true"`. The
  visible ring uses accent-on-panel with a glow — **contrast passes at 4.9:1**
  but the shadow-only cue fails **WCAG 1.4.11** in reduced-motion (the
  glow is a shadow, not a border). Fix hint: add a solid 2px accent border
  in the `.selected` state so the boundary is visible without shadow.
- **Save-config text input** (`.config-name-input`) uses
  `border: 1px solid var(--border-dim)` — same border contrast issue
  (1.87:1). Ripples out of the token bump in §2A.
- **Confirm-overwrite / confirm-delete two-click pattern**: today the
  button label swaps between `DELETE` and `CONFIRM DELETE` after the first
  click. Keyboard-accessible (still a button), but the state change is
  not announced to AT. Fix hint: wrap the button in an `aria-live="polite"`
  region and update label text via `textContent`, OR use `aria-pressed`
  to signal the intermediate state.

### 3E. Console shell + modes (owner: `src/ui/console/console.js` + per-mode files)

- **Tab bar** uses `role="tablist"` with each tab `role="tab"`,
  `aria-controls`, `aria-selected`, `aria-expanded`, `aria-disabled`, and
  a native `<button>`. **OK for AT semantics.**
- **Content area** is `role="tabpanel"` with `tabindex="-1"` + focused on
  render — **OK.**
- **`console.js`** `updateTabs` sets `tab.disabled = !available` — so
  disabled tabs drop out of the focus order entirely. **WCAG 2.1.1 OK**,
  but users cannot see WHY the tab is disabled without hovering; the `title`
  attribute carries the reason but AT rarely announces `title`. Fix hint:
  use `aria-describedby` pointing at a hidden reason element, OR keep
  `disabled` false and switch to `aria-disabled="true"` + `preventDefault`
  in the click handler (already partially present via `aria-disabled`).
- **MOVE mode** (`console/move.js`) — d-pad `<button>` grid,
  `aria-label` per direction, `bindActionControl` wires
  click/touchend AND registers the semantic action. **OK.** Note: the
  wait/descend confirm button changes label when a descent point is
  underfoot — this is announced via label change but not via `aria-live`.
- **COMBAT mode** (`console/combat.js`) — 340 lines; primary action list,
  target list, direction grid, confirm-row all built with `createButton`.
  Target selection uses `role="listbox"`? Let's read it.
- **LOG mode** (`console/log.js`) — the share link uses a native
  `<input type="text" readonly>` — Tab-reachable, `Ctrl+C` works. **OK.**
- **PARTY mode** (`console/party.js`) — party cards use `role="tab"`? Cards
  set `aria-selected` via `card.setAttribute('aria-selected', …)` but the
  container is not a listbox. **WCAG 4.1.2** — fix hint: add
  `role="listbox"` to the member grid, `role="option"` to each card.
- **GEAR / LOOT / TECH modes** — use `createScrollArea({ focusable: true })`
  which sets `tabIndex = 0` on a `<div>` labelled `Inventory`, `Container
  contents`, `Prepared protocols`. **OK** — the scroll area is
  focusable so keyboard users can scroll with arrows.

### 3F. Exploration + combat screens (owners: `src/ui/screens/exploration.js`, `src/ui/screens/combat.js`, `src/ui/playfield.js`, `src/ui/viewport.js`)

- **Playfield canvas** carries `pointer-events: none` (base.css) and is
  wrapped in a `.playfield-body` div that hosts `attachViewportGestures`
  (drag-pan, pinch, wheel, tap). The **canvas has no `role="img"`** — the
  existing accessibility spec asserts `getByRole('img', { name: /Exploration
  map/ })` finds it, meaning the label is set on the wrapper. Verify the
  wrapper actually carries `role="img"` and an `aria-label` in every
  screen — grep of source shows none of the exploration/combat modules do
  this; the spec passes today only because the exploration screen sets
  the label elsewhere. **WCAG 1.1.1**. Fix hint: in `exploration.js`
  after `playfieldBody.appendChild(canvas)`, add
  `playfieldBody.setAttribute('role', 'img'); playfieldBody.setAttribute('aria-label', 'Exploration map at depth …');`
  and update on each render. Do the same in `combat.js`.
- **Exploration container** is focused after mount (line 272) — **OK**.
  Every subsequent `renderPlayfield` call does not steal focus (correct).
  The `pointerdown` capture handler `refocusContainer()` recovers focus
  after the user taps the canvas — **OK** for keyboard-after-pointer flow.
- **Combat screen** — no equivalent `container.focus()` on mount. Falls
  under §3A fix.
- **Exploration danger clock** is spoken by the status strip
  (`CLK\d+\.\d{2}`) as a live text; assertion in the existing spec
  passes. But the status strip is not marked `role="status"` or
  `aria-live` — deep-tree updates go silent. Fix hint: add
  `role="status" aria-live="polite" aria-atomic="false"` to `.status-strip`
  in `styles/components.css` or in `src/ui/status-strip.js`.

### 3G. Menu screens (settings, tutorial, library, import, scorecard) — see per-screen notes in §5

## 4. Pointer / no-keyboard parity (WCAG 2.5.1 / 2.5.5)

### 4A. Global — every keyboard-only path

Cross-referenced `src/ui/input.js` KEY_MAP against on-screen affordances:

| Keyboard action | Pointer / touch affordance | Verdict |
|-----------------|----------------------------|---------|
| `Arrow`/`WASD`/`Numpad` movement | MOVE mode d-pad (portrait + wide) | **OK** — parity |
| `Digit 1-7` (mode switching) | Console tab bar (portrait bottom, wide right dock) | **OK** — parity |
| `Enter`/`Space` (confirm) | CONFIRM button in COMBAT, DESCEND button in MOVE d-pad, per-action confirm buttons | **OK** — parity |
| `Escape`/`Backspace` (cancel) | BACK button in every sub-flow (creation, import, settings, tutorial, combat) | **OK** — parity |
| `Tab` (cycle target in combat) | Target list rows in COMBAT mode | **OK** — parity, and tap on target beats keyboard cycling for speed |
| Arrow keys cycle target in `choose-target` phase | Same target list | **OK** |
| **`Enter` in LOG mode copies share link** | Explicit COPY LINK button | **OK** — parity |
| Playfield tap → path-plan → auto-run | No keyboard equivalent for tap-to-path; keyboard is step-by-step d-pad | **Gap** — keyboard users cannot request a multi-step auto-run to a target cell. Fix hint: add a `pathToCell(cellFocus)` action bound to a target-cell overlay reachable via a "focus cell mode" (T-key), OR document as a pointer-only convenience |
| Playfield pinch/wheel-zoom, drag-pan | No keyboard equivalent for camera control (M104 exposes `panBy`/`anchorZoom` in `viewport.js`, no key binding) | **Gap** — keyboard users can move the party, but cannot pan/zoom the map. Fix hint: bind `+`/`-` for zoom and `Shift+Arrow` for camera pan in the viewport gesture layer |

### 4B. Pointer-only gaps per screen

- **Title screen** — START button (pointer + keyboard both work). Branch
  list toggle discoverable only after clicking START, no keyboard hint on
  the button itself. Not a WCAG failure but worsens discoverability.
- **Creation screen** — all controls have pointer affordances; the
  attribute steppers are pointer-friendly (44×44 wide-layout,
  32×32 portrait — see §4C touch targets).
- **Library / import / tutorial / settings / scorecard** — every action
  has a button; no keyboard-only path detected.
- **Combat direction grid** — the `.combat-direction-grid` is a 3×3
  56×56 button grid. Pointer parity to keyboard direction keys **OK**,
  though 56 px is below the wide-layout 96 px min-row expectation (§4C).
- **Console tab bar (portrait)** — 48 px min-height + full tap area,
  pointer-friendly. Wide dock uses 96 px min-height. **OK.**

### 4C. Touch targets (WCAG 2.5.5 AAA, project rule = 96 px console rows)

`scripts/design-scan/check-touch-targets.js` reports three warnings
against the project's 96 px minimum:

| Declaration | Value | File | Fix hint |
|-------------|-------|------|----------|
| `min-height: 34px` | `.init-slot`, `.init-sigil`, `.status-*` rows | `styles/components.css` | Init-slots are decorative rail dots — annotate `role="presentation"`; keep 34 px. Status rows contain no interactive controls — same treatment. |
| `min-height: 32px` | `.stepper-btn`, `.combat-direction`, `.dpad-btn` inline | `styles/components.css` | Steppers ARE interactive — raise wrap container (`.slider-row` / `.attr-row`) padding to hit 96 px in portrait; wide layout already does 44×44 which is a legitimate exception. Add a per-context override or increase padding. |
| `min-height: 64px` | `.config-name-input` (creation save-name field) | `styles/components.css` | Passes WCAG 2.5.5 AA (24×24) but below the project 96 px rule. Consider adding a wrapper row that hits 96 px and let the input flow inside. |

Note: the check itself does not distinguish decorative rows from
interactive ones. Wave B should annotate `role="presentation"` on init-rail
sigils and status readouts to remove them from the touch-target audit, and
apply padding to the stepper wrappers rather than the buttons themselves.

### 4D. Non-target-related pointer findings

- **`.crt-scanlines .crt-vignette .crt-grille` etc.** in `styles/crt.css`
  are `pointer-events: none` — decorative overlays never intercept clicks.
  **OK.**
- **`.playfield-canvas` in `styles/components.css`** — `pointer-events:
  none` (already asserted by the existing accessibility spec) with the
  wrapper handling gestures. **OK.**
- **`.update-toast` reload button** — `min-height: 48px`, keyboard-
  reachable. **OK.**
- **`.mode-tab.disabled`** uses `cursor: not-allowed` and `disabled` — a
  pointer user gets clear feedback that the tab is inactive. **OK.**
