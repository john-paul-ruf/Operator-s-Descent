# Architecture Detail — UI, Console, and Screens

## Modules

| IDs | Area | Owns |
|---|---|---|
| M56–M59 | UI foundation | Accessible components, semantic input, canvas playfield, status strip |
| M60–M67 | Console | Shell plus MOVE/COMBAT/PARTY/GEAR/TECH/LOOT/LOG modes |
| M68–M76 | Screens | Title, creation, exploration, combat, library, scorecard, import, tutorial, settings |
| M77–M79 | Presentation | Fixed portrait layout, CRT layers, component styles |
| M92 | Creation model | Pure point-buy/blueprint state and validation |

## Interaction Boundary

The playfield is a readout, never a control surface. All game actions originate in the console. Pointer events on the canvas do not move, target, loot, or confirm. Keyboard and touch dispatch the same semantic actions through M57.

```js
export function createInputHandler() {}
export function createConsole(context) {}
export function createPlayfield(canvas) {}
export function createCreationModel(data, initial = null) {}
export function reduceCreationDraft(draft, action, data) {}
export function validateCreationDraft(draft, data) {}
export function finalizeCreationDraft(draft, data, options = {}) {}
export function mount(container, params) {} // every screen
```

## Accessibility and Lifecycle

- Interactive factories use native `button`, `input`, and labelled controls; clickable `div` elements are prohibited.
- Focus is restored after rerender, modal confirmations trap and return focus correctly, and every screen/controller removes listeners/subscriptions on `unmount()`.
- Console rows are at least 96px in the fixed 1080×1920 coordinate space.
- Only 34/72/108/220px sigil classes exist. Callers pass a named tier, not an arbitrary number.
- Status uses text/numbers in addition to color. Target selection always has a confirm step on touch.
- Expanded console has one fixed height, dims the playfield, and requests auto-pan for the active actor.

## Screen body scroll container (visual-parity-v4)

- **Class:** `.screen-body` (M79 `./styles/components.css`)
- **Factory:** `createScreenBody({ scroll = true, className = '' })` in M56 `./src/ui/components.js`
- **Tokens:** `--screen-body-fade`, `--scrollbar-track`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-width` in M77 `./styles/base.css`
- **Contract:** lives inside the portrait frame, sits between the pinned status strip (M59) and the pinned console (M60, when present); flex-child with `min-height: 0` to enable internal scroll; masks its top/bottom edges to dissolve into the CRT vignette.
- **Opt-out modifier:** `.screen-body--no-scroll` for screens whose content is known to fit (e.g. title).
- **Rule #8 compatibility:** the viewport still never reflows; only this container scrolls.
- **Existing `createScrollArea`** (`.scroll-area`) is deprecated in favor of `createScreenBody`; kept for current call-sites, per-screen sessions migrate.

## Baseline Audit (2026-08-10)

All screens/modes exist, but several are display-only and dispatch orphan events. Input touch zones cover the whole screen, controls often use non-semantic elements, fixed sigil tiers are not enforced, position/floor diffs are not restored, creation cost/deck math is wrong, and combat has no movement or geometry-aware targeting.

## Change History

| Date | Change |
|---|---|
| 2026-08-11 | SESSION-52 added real-browser keyboard/touch/accessibility acceptance for console-only input, 96px touch rows, tab order/focus, no-canvas-input, motion overrides, and fixed 1080:1920 portrait letterboxing; console tabs now expand/collapse and focus the tabpanel from both touch and keyboard. |
| 2026-08-11 | SESSION-51 kept finalized creation equipment compact by storing catalog-resolved stock stats outside RunState and passed current floor theme metadata through new-run creation. |
| 2026-08-11 | SESSION-49 finalized runtime routing among hot screens, including exploration resume, compact active-combat resume into COMBAT, scorecard terminal handoff, and route notifications after screen mount. |
| 2026-08-11 | SESSION-48 completed the library/import/scorecard persistence screens with broken-save quarantine, safe fragment parsing, exact failure diagnostics, and seed-only wipe sharing. |
| 2026-08-11 | SESSION-47 completed the activated title, first-time tutorial suppression, DOM-only tutorial manual, and final enumerated settings screen with defensive save/live-preview controls. |
| 2026-08-09 | Initial M56–M79 registry. |
| 2026-08-10 | Added M92 and formalized console-only action/focus contracts. |
| 2026-08-10 | SESSION-36 added semantic component cleanup handles and canonical input action stack (`move_n`, `confirm`, `mode_1`–`mode_7`). |
| 2026-08-10 | SESSION-37 added read-only playfield camera/render contracts, status strip variants, and single `--accent` theme write boundary. |
| 2026-08-11 | SESSION-40 added console mode registry, availability, fixed geometry, input context routing, and teardown contract. |
| 2026-08-11 | SESSION-41 added M92 pure creation draft reducer, selectors, validation, and one-time canonical party finalization. |
| 2026-08-11 | SESSION-42 replaced legacy character creation with the M92 reducer-driven creation/blueprint controller, 220px sigil picker, blueprint validation/overwrite/delete UX, and one-shot persisted run/floor finalization. |
| 2026-08-11 | SESSION-43 completed exploration controller wiring: MOVE is console/M57-owned 8-way input, LOOT enables from adjacent unopened containers, and screen teardown owns status/console/input/bus cleanup. |
| 2026-08-11 | SESSION-44 added the combat screen/COMBAT console action state machine, initiative rail, target preview/confirmation contract, keyboard target cycling, and combat lifecycle teardown. |
| 2026-08-11 | SESSION-45 completed PARTY/GEAR console modes with semantic roster/slot/inventory controls, derived readouts, CORRUPT confirmation, junk-all confirmation, and combat swap disabled reasons. |
| 2026-08-11 | SESSION-46 completed TECH/LOOT/LOG console modes with protocol target confirmation, overclock warnings, deterministic loot pickup/junk controls, ordered logs, and living-run copy-link feedback. |
| 2026-08-12 | visual-parity-v4 SESSION-02 added `.screen-body` scroll container (M79), `--screen-body-fade`/`--scrollbar-*` tokens (M77), and `createScreenBody({ scroll })` factory (M56); deprecated `createScrollArea`. No screen migration yet. |

<!-- SESSION-02 -->
## Screen body scroll container (visual-parity-v4)

- **Class:** `.screen-body` (M79 `./styles/components.css`)
- **Factory:** `createScreenBody({ scroll = true })` in M56 `./src/ui/components.js`
- **Tokens:** `--screen-body-fade`, `--scrollbar-track`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-width` in M77 `./styles/base.css`
- **Contract:** lives inside the portrait frame, sits between the pinned status strip (M59) and the pinned console (M60, when present); flex-child with `min-height: 0` to enable internal scroll; masks its top/bottom edges to dissolve into the CRT vignette.
- **Opt-out modifier:** `.screen-body--no-scroll` for screens whose content is known to fit (e.g. title).
- **Rule #8 compatibility:** the viewport still never reflows; only this container scrolls.
- **Existing `createScrollArea`** (`.scroll-area`) is deprecated in favor of `createScreenBody`; kept for current call-sites, per-screen sessions migrate.

<!-- SESSION-02 (adaptive-layouts-impl) -->

## Public API changes — adaptive-layouts-impl SESSION-02

### M60 Console Shell (`src/ui/console/console.js`)

`createConsole` gains a second parameter `options = { variant: 'bar' | 'dock' }` (default `'bar'`). The `bar` variant is byte-identical to the legacy portrait console. The `dock` variant renders `wide-console-dock` / `wide-console-tabs` (vertical `wide-mode-tab` buttons) / `wide-console-content` (`wide-console-content-header` + `wide-console-content-body`), is permanently `expanded`, never mounts `.console-dim-layer`, and treats `collapse()` and the `cancel` action as no-ops. Every mode module's context now carries `layout: 'wide' | 'portrait'` so modes can branch content without importing `layout.js`. `MODE_REGISTRY`, `ui:mode-change`, `console:*` intents, disabled-tab conventions, and keyboard mode shortcuts are identical across variants. The `api` object gains `variant` for introspection.

```js
export function createConsole(state, options = { variant: 'bar' }) {}
// api.variant, api.expanded (dock: always true), api.collapse (dock: no-op)
```

### M59 Status Strip (`src/ui/status-strip.js`)

New named export `createTelemetryDock(runState, combatState = null)` returns the wide-layout telemetry region. Portrait `createStatusBar` is unchanged. The dock stacks `wide-telemetry-field` rows (Depth, Seed, Party, Danger Clock — numeric, Corruption; combat adds Round and the `wide-init-block` + `wide-active-actor` blocks) and streams a persistent live LOG feed (`wide-log-feed` / `wide-log-feed-header` / `wide-log-feed-scroll`) that subscribes to `ui:log-entry`, mirrors `runState.recentEvents`, and auto-scrolls to newest. The returned element carries a `cleanup()` closure that removes both the danger-clock and log-entry bus subscriptions.

```js
export function createTelemetryDock(runState, combatState = null) {}
```

### M67 Console LOG mode (`src/ui/console/log.js`)

Two new named exports so telemetry-dock's live feed and LOG mode's full history render identical `.log-entry log-<type> console-row` markup with `[T|E:NNN]` prefix:

```js
export function createLogEntryElement(entry, index) {}
export function collectLogEntries(context = {}) {}
```

LOG mode's `render()` now also branches on `context.layout === 'wide'` to emit `log-history-header` (sticky), `share-panel` (on the share row), and `share-input` (on the copy-link readonly input); portrait class names are unchanged.

### M61 MOVE mode (`src/ui/console/move.js`)

When `context.layout === 'wide'` the mode appends three `.autostop-row` entries (hostile locked, discovery live, damage live) with `.autostop-pill` (and `.off` modifier) reflecting the current toggle state. Portrait output is unchanged.

### M62 COMBAT console mode (`src/ui/console/combat.js`)

When `context.layout === 'wide'` the target preview block uses `.target-info` / `.target-name` / `.target-detail`, and the confirm button additionally carries the `.btn-confirm` class. Portrait output is unchanged.

### M63 PARTY / M66 LOOT

When `context.layout === 'wide'`:
- PARTY: the selected-member detail sigil gains the `.sigil-lg` class.
- LOOT: the container header glyph gains the `.container-icon-lg` class.

### M70 Exploration screen / M71 Combat screen (`src/ui/screens/{exploration,combat}.js`)

Both branch on `currentLayoutClass()` at mount. Wide path renders `.wide-shell[data-wide-root]` as the sole container child, with three grid regions:
1. `createTelemetryDock(runState[, combatState])` (left)
2. `.wide-playfield-column` → optional `.playfield-alert-banner` (exploration only) + `.wide-playfield-inner` hosting the existing canvas (right-side 9:16)
3. `createConsole(viewState, { variant: 'dock' })` (right)

Portrait path is byte-identical to before this session. Wide combat skips the per-frame `createStatusBar` swap and lets the telemetry dock re-render itself. Unmount cleans up both the (portrait) status bar and (wide) telemetry dock closures.

### M101 Wide CSS (`styles/wide.css`)

All new wide-only structural CSS lives inside the single `@media (min-width: 900px) and (min-aspect-ratio: 1/1)` block: `.wide-shell`, telemetry (`.wide-telemetry-*`, `.wide-log-feed*`, `.wide-init-*`, `.wide-active-*`), playfield column (`.wide-playfield-column`, `.wide-playfield-inner`, `.playfield-alert-banner`), console dock (`.wide-console-dock`, `.wide-console-tabs`, `.wide-mode-tab`, `.wide-console-content*`), and mode-specific extras (`.autostop-row`, `.autostop-pill`, `.autostop-pill.off`, `.target-info`, `.target-name`, `.target-detail`, `.btn-confirm`, `.sigil-lg`, `.container-icon-lg`, `.log-history-header`, `.share-panel`, `.share-input`, plus `.init-order`, `.init-slot.spent`).

<!-- adaptive-layouts-impl feature-end (Jikijitsu) -->

## Adaptive layout controller + wide class — adaptive-layouts-impl

- **M100 Layout Controller** (`src/ui/layout.js`, new): `WIDE_MEDIA_QUERY`, `currentLayoutClass()` (`'wide' | 'portrait'`), `initLayoutController({bus})` → sets `html[data-layout]`, dispatches `ui:layout-change` on media-query flips. Bus injected — no imports.
- **M101 Wide CSS** (`styles/wide.css`, new): every wide-only structural rule lives inside ONE `@media (min-width: 900px) and (min-aspect-ratio: 1/1)` block (FR-35 single-breakpoint law enforced by file structure). `#portrait-frame:has([data-wide-root])` gates full-bleed; screens without a wide DOM root keep the centered column.
- **Screen contract (S02–S04):** screens branch on `currentLayoutClass()` at mount; the wide root carries `data-wide-root=""`; live class switch re-mounts the active route (transient DOM state resets — accepted). Wide game screens render three regions: `createTelemetryDock(runState[, combatState])` (M59) | portrait-proportioned playfield column | `createConsole(state, {variant: 'dock'})` (M60). SESSION-02's merged delta above details the dock/telemetry/log-renderer API surface.
- **Letterbox retired (S01):** body bg `--bg-base`, frame shadow ring removed; `#crt-overlays` is a body-level `position: fixed; inset: 0` container in both classes (canonical rule in base.css; stale crt.css container rule removed).

<!-- walls-npc-docks SESSION-01 (Jikijitsu append) -->
- **M58 Playfield (walls-npc-docks S01):** API += `setPulse(enabled)` / `destroy()` / `wallThickness(size)` + exported constants `WALL_PULSE_PERIOD_MS 2400`, `WALL_PULSE_FPS 30`, `WALL_GLOW_BLUR [4,12]`, `WALL_GLOW_ALPHA [0.7,1]`. Walls paint OUTSIDE the traversable square (thickness `max(3, round(size/8))`, 4×t×t corner joints, drawn over ticks); ticks require ALL 4 touching cells revealed traversable. Pulse = cached-args rAF replay ~30fps, 2.4s sine on shadowBlur/alpha; `setPulse(false)`/`destroy()` cancel + hold static g=0.7. M70/M71 resolve `loadSettings().reducedMotion` (runtime.js:416 semantics) → `setPulse(!reduce)` after `createPlayfield`; `playfield.destroy()` on unmount. M81: CACHE_VERSION → `2026-08-17-walls-npc-docks-v1`.

<!-- combat-and-overworld-clarity-pass SESSION-05 (Jikijitsu append) -->
### M71 (Combat Screen) — SESSION-05 `previewForTarget.targetLegal` + range gate

`previewForTarget(targetId)` now returns `{distance, range, coverBonus, flanked, targetLegal}`.
`targetLegal` is authored per action type:

- **attack**: `evaluateRange(weapon, distance).legal` — same rule the rules layer uses.
  Unpositioned actors (`distance === null`) and same-cell (`distance === 0`) short-circuit
  to `targetLegal: true` (matches `performAttackRoll`'s `positioned = distance !== null`).
- **cast / overclock**: `distance <= protocolData.range` when `Number.isFinite(protocolData.range)`,
  else `true`. Reason on failure is `'beyond_maximum'` for parity with `evaluateRange`.
- **item**: always `true` (no ranged item today; item targets are party members).
- other action types: `targetLegal: true` (no gate).

`selectTarget(targetId)` reads `previewForTarget(candidate.id).targetLegal` and refuses to
commit when false, setting `selection.error = 'OUT OF RANGE — MOVE OR RETARGET'`.
`validationError()` returns the same string for attack + cast + overclock when the currently-
selected target is illegal, and `canConfirm()` returns false in that case.

### M62 (Console Combat) — SESSION-05 action icons + illegal target rows

- `ACTIONS` entries gained an `icon` field: `move → 'arrow-down-right'`,
  `attack → 'sword'`, `cast → 'wand-sparkles'`, `overclock → 'zap'`, `item → 'flame'`,
  `retreat → 'arrow-up-right'`, `end-turn → 'clock'`. Each icon is prepended to the button
  via `safeCreateIcon(action.icon, {size:16})`.
- Target rows now read `preview.targetLegal`. When false: the row is rendered with
  `disabled: true`, class `is-illegal` (styling hook for SESSION-06's `styles/wide.css`
  and `styles/components.css`), and prefixed with a `circle-x` tone-danger icon carrying
  the reason as `aria-label`. Clicks on illegal rows are no-ops (`onClick: undefined`).
- The internally-selected illegal target still shows `selected: true` so the player sees
  what they're aiming at while the disabled + is-illegal state explains the refusal.
- `REASON_LABEL` gained `beyond_maximum: 'out of range'` so `evaluateRange`'s
  `reason: 'beyond_maximum'` and the protocol range gate's identical reason both surface
  as "OUT OF RANGE" on the row.
- New import `createIcon` from `../icon.js`, wrapped in `safeCreateIcon` (mirrors
  `src/ui/console/party.js:safeCreateIcon`) so test environments without `createElementNS`
  degrade to icon-less rendering instead of throwing.

<!-- combat-and-overworld-clarity-pass SESSION-06 (Jikijitsu append) -->
### M56 — UI Components (SESSION-06 icon-aware factories)

**New `createButton` opts**
- `opts.icon?: string` — lucide id from `assets/icons.svg` (`ICON_IDS` in `src/ui/icon.js`). When provided, a `<svg class="icon icon-<size>">` is prepended before the label and the button gains a `has-icon` class.
- `opts.iconSize?: 14 | 16 | 20 | 24` (default `16`).
- `opts.iconTone?: 'danger' | 'accent' | 'dim'` — appends `.icon-<tone>` to the sprite.
- `createManualLink` accepts the same `opts.icon` / `opts.iconSize` / `opts.iconTone` triple.
- `createConditionTag(id, duration)` now prepends a lucide icon for known conditions via an internal `CONDITION_ICONS` map (`burning→flame`, `jammed→zap`, `shielded→shield`, `marked→target`, `panicked→circle-help`, `immobilized→hand-metal`, `overloaded→gauge`, `drained→battery`, `blinded→eye-off`). Unknown ids fall through with no icon.

**Fail-soft**: when `document.createElementNS` is unavailable (test fake DOMs), the icon and the `has-icon` marker are both silently skipped so the button remains functional.

### M79 — Components CSS (SESSION-06)

**New class contracts**
- `.btn-crt.has-icon` / `.manual-term-link.has-icon` / `.condition-tag.has-icon` — `display: inline-flex; align-items: center; gap: 8px;` (buttons also get `padding-left/right: 12px`). Sprite children get `flex-shrink: 0`.
- `.combat-target.is-illegal { opacity: 0.5 }` — hook consumed by SESSION-05's disabled illegal-target rows. Keeps the reason chip legible.
- Wide-mode overrides (scoped `:root[data-layout="wide"]`): `.console-row`, `.action-btn`, `.item-card`, `.equipment-card`, `.protocol-card` relaxed to `min-height: 48px`. `.combat-active-panel`, `.loot-container-header`, `.gear-slot-row` gain `flex-wrap: nowrap; min-width: 0;` with `text-overflow: ellipsis` on the label side so narrow docks never wrap awkwardly.

### M101 — Wide CSS density pass (SESSION-06)

- `.wide-telemetry-header` padding `14/16 → 10/14`.
- `.wide-telemetry-field` padding `8/0 → 6/0`.
- `.wide-telemetry-label` — new `display: inline-flex; align-items: center; gap: 6px` so the SESSION-06 lucide sprite prefix aligns with the label text.
- `.wide-mode-tab` `min-height: 96px → 72px` (44px touch target preserved).
- `.wide-console-content-header` padding `14/20 → 10/14`.
- `.wide-console-content-body` padding `20 → 12`; new `> * + * { margin-top: 8px }` rhythm rule.
- `.wide-console-content-body .combat-action-list` — 2-column grid so SESSION-05's seven combat actions fit in four rows.
- `.target-info` padding `12/16 → 8/12`; `.target-info .target-detail` margin-top `4 → 2`.
- `.btn-confirm` padding `14/24 → 12/20`; font-size `12px → 11px`.

### M59 — Status Strip (SESSION-06)

- `createTelemetryDock` wide field labels each lead with a 14px lucide sprite (`gauge` for Depth, `chevron-right` for Seed — no `hash` in the current subset, `users` for Party, `clock` for Danger Clock, `flame` for Corruption, `sparkles` for Round). The combat rail (`wide-init-block`) is unchanged (SESSION-05's territory). The portrait `createStatusBar` remains icon-free.

### M61 / M63 / M64 / M65 / M66 / M67 — Console panes (SESSION-06)

Per-pane icon adoption via the new `createButton opts.icon` API:

- **MOVE** — D-pad direction buttons prefix `arrow-*` sprites (matched by direction); CONFIRM has no icon; portrait auto-stop buttons prefix `eye`/`eye-off` at size 14 with the dim tone that swaps on state.
- **PARTY** — roster cards prefix `user`; HP/CHG compact bars prefix `heart`/`battery`; derived-stat rows prefix `shield` (Defense/Protocol Defense), `sparkles` (Initiative), `sword` (Melee/Ranged/Protocol), `eye` (Detection), `battery` (CHARGE regen).
- **GEAR** — slot buttons prefix `sword`/`shield`/`star` (weapon/armor/offhand); UNEQUIP prefixes `x`; TAG/UNTAG JUNK and JUNK ALL TAGGED prefix `recycle`.
- **TECH** — CAST prefixes `wand-sparkles`; OVERCLOCK prefixes `zap` with the danger tone; the `tech-error` row prepends `triangle-alert` (danger tone) when an availability reason surfaces.
- **LOOT** — TAKE prefixes `download`; TAG/UNTAG and JUNK ALL prefix `recycle`; container header renders its Unicode glyph as `children[0]` (unchanged) and appends a `box` (standard) or `archive` (vault) lucide sprite immediately after. OPEN CONTAINER prefixes `chevron-right`.
- **LOG** — COPY LINK prefixes `link`.

Each pane guards the sprite with a local `safeIcon()` fallback so tests using a document without `createElementNS` continue to pass.

### Notes for future sessions (SESSION-06)

- `styles/components.css` `.combat-target.is-illegal` is the contract SESSION-05 emits on target rows in combat mode; SESSION-06 owns the visual (dimmed).
- All portrait-only tests continue to pass unchanged; the wide-mode density pass is scoped to `:root[data-layout="wide"]`, the wide media block in `styles/wide.css`, or SESSION-06's icon prefix classes.
- `hash` icon was missing from `tools/icons/subset.json` — SESSION-06 fell back to `chevron-right` for the Seed field per the session prompt's guidance. Adding a proper `hash` sprite is a followup for the subset owner (SESSION-01's lease).

<!-- mobile-ux-and-combat-readout feature-end (Jikijitsu) -->

## Mobile UX + combat readout — derived maxes, portrait console/strip, log truth (mobile-ux-and-combat-readout)

New M→M15/M18 edges folded from this feature (derivation via `deriveStats` + `resolveLoadout`):
- **M71 Combat Screen → M15** (S01) — `normalizeCombatActor` derives party `hpMax`/`chargeMax` at the fabrication source; enemies/echoes/snapshots short-circuit with explicit maxes.
- **M59 Status Strip → M15/M18** (S02) — `createStatusBar`/`createTelemetryDock` derive display maxes from the new `options.data` (M87 registry) third arg wired by S01.
- **M65 Console Tech → M15/M18** (S03) — TECH CHARGE POOL derives `chargeMax` out of combat.
- **M64 Console Gear → M15/M18** (S03) — GEAR post-transaction `syncCombatActor` writes derived maxes (was a no-op on nonexistent `character.maxHP`).
- M63 Console Party already had both; its member CARDS now derive too (detail pane already did).

Fallback precedence everywhere: explicit actor max → derived → current (last resort, only when `context.data`/`options.data` absent). Max HP/CHARGE stays derived — no persisted character fields, no save-schema bump (Design Decision 1).

Portrait UX (S02): M60 console gains a 3-state expand model (`collapsed → half → full → collapsed`, `data-expand-state`, `.expanded-half`/`.expanded-full`; legacy `.expanded`/`.collapsed` retained for mocks + keyboard-flow `/expanded/` + M97 `check-mock-classes`). M59 status strip gains a `▴`/`▾` collapse toggle (per-mount state). M79 CSS: killed the fixed 720px expanded height; CMBT action list → 1fr grid, 48px rows. `specs/design.md` got one additive "Portrait Console Expand States" subsection.

Known follow-up (out of every session's lease): `tests/tooling/check-tokens.test.js` hardcodes the M97 touch-target warning count at 3; S02's mandated 44px toggle + 64px tab-bar raise it to 5 (warning-level; `design:scan` still 0-error). Bump to 5 or filter on `level==='error'`. Local `derivedMaxesFor()` is copied in party.js/tech.js (gear.js reuses `runStats`) — 3-copy ceiling; lift into M56 components.js only if a 4th appears.

<!-- icon-first-ui-density SESSION-02 (Jikijitsu) -->


## M107 (Icon System) — sprite membership grows

Two new lucide ids join `ICON_IDS` and `tools/icons/subset.json`:

- `chevron-down` — loot MANAGE JUNK expanded state (§3.7 in `docs/icon-density-gap.md`)
- `hash` — wide-dock Seed label (§3.9; replaces the `chevron-right` placeholder at `src/ui/status-strip.js:11`)

Sprite regenerated via `npm run build:icons` (47 → 49 symbols). `ALLOWED_SIZES` unchanged (`{14, 16, 20, 24}`).

## M56 (UI Components) — `createButton` icon-only form

Signature is unchanged (`createButton(label, opts)`), extensions are backwards-compatible:

- `opts.icon` + empty `label` → icon-only button; adds the `.icon-only` class alongside `.has-icon`.
- `opts.label` (already used as `aria-label`) now also becomes the `title` on icon-only buttons and on text buttons whose `opts.label` differs from the visible label. Matching-label buttons stay untitled.
- `opts.title` — new; explicit override for the title attribute, wins over `opts.label`.
- Icon-only buttons without any accessible-name source (no `opts.label`, no `opts.title`) throw, mirroring `createIcon`'s falsy-id contract.

Every existing consumer renders byte-identical DOM (60 component tests + all screen tests green; the two failing exploration-screen tests pre-exist SESSION-02).
