# GAP Report — icon-first-ui-density SESSION-01

Single source of truth for the seven-session `icon-first-ui-density` feature.
The section numbers below are cited by SESSION-02..08 and MUST NOT be renumbered.
Every "text-chrome" claim is anchored to a `file:line` in the current tree, every
lucide id to `src/ui/icon.js` `ICON_IDS`, and every geometry number to either a
live measurement (Playwright pass on port 8081, chromium-1234) or an existing
gate in `tests/e2e/*.spec.js`. `NO-GLYPH` rows keep text — the brief permits
that fallback and this session records every instance rather than inventing a
sprite that doesn't exist in `lucide@^0.400.0`.

Feature scope reminders folded in from the brief and `STATE.md`:

- **Icons only from lucide** via the M107 sprite (`src/ui/icon.js` gate).
- **96 px minimum visible touch box holds** — this session records nothing that
  would trip that floor.
- **Red (`--danger`) stays reserved for hostiles/destructive** (Custom Rule 14).
- **Sanctioned text controls** — the title wordmark + START, destructive
  actions (icon **+** text), and any value/log/notice/prose/proper-noun row.
- **Tutorial screen is retired** as a reachable UX surface
  (`tests/ui/front-door.test.js:261-274`, `data/manual.json` takes over via
  `ui:manual-open`). `src/ui/screens/tutorial.js` and both tutorial mocks are
  **OUT of scope** for the whole feature.
- **Exploration + Combat screens own zero buttons** — verified by grep
  (`grep -n createButton src/ui/screens/{exploration,combat}.js` returns no
  hits). All in-run chrome lives in the console shell + 7 modes (M60–M67) and
  the status strip / telemetry dock (M59).

---

## §1 Method

### Viewports measured

Three viewports were driven in the pass — the fewest that cover both layout
classes and the phone-vs-tall-portrait split enforced by the current e2e:

| Name | CSS px | Layout class | Playwright project analogue |
|------|--------|--------------|-----------------------------|
| `phone` | 412 × 915 | `portrait` | `chromium-phone-touch` (`playwright.config.js:36`) |
| `portrait` | 1080 × 1920 | `portrait` | `chromium-portrait` (`playwright.config.js:32`) |
| `wide-square` | 1024 × 1024 | `wide` | `chromium-wide-square` (`playwright.config.js:58`) |

`wide-square` is the smallest wide-class viewport the project already exercises
(the ≥900 px width × ≥1:1 aspect-ratio media query in `src/ui/layout.js`
puts a square at exactly the class boundary) — the strictest wide budget any
downstream session must clear.

### Tools used

- Dev server: `PORT=8081 HOST=127.0.0.1 node scripts/server.js` (the envelope
  port; killed at session end — see §Verification in the handoff).
- Playwright driver: `node_modules/playwright-core@^1.62.1` via a scratch
  script under `/tmp` (nothing committed outside the lease). Chromium 1234
  from `~/Library/Caches/ms-playwright/chromium-1234`.
- CSS floors: read directly from `styles/components.css` and `styles/wide.css`.
- E2E floors: extracted verbatim from `tests/e2e/{portrait-usability,touch-flow,wide-panes,accessibility}.spec.js`.

### What this pass captured live vs. what it derived from source

- **Live**: title screen and creation screen geometry across all three
  viewports (START button, branch buttons, secondary branches, `.btn-crt` and
  generic `<button>` sizes on creation).
- **Derived from source**: in-run chrome (status strip, console tabs, action
  rows, direction pad, target rows) is bound by
  `.mode-tab { min-height: 96px }` (`styles/components.css:94`),
  `.wide-mode-tab { min-height: 72px }` (`styles/wide.css:333`),
  `.combat-action { min-height: 96px }` (`components.css:1705`),
  `.combat-direction { min-height: 96px }` (`components.css:1708`),
  `.combat-target { min-height: 96px }` (`components.css:1717`),
  `.console-bar.expanded-half { min-height: 220px }` (`components.css:1171`),
  and cross-checked against the e2e assertions cited in §4. Two floors already
  landed above the CSS minimum: `tests/e2e/portrait-usability.spec.js:290`
  (`.console-row:visible, .mode-tab:visible → min ≥ 96`) and
  `tests/e2e/wide-panes.spec.js:252` (`.wide-playfield-column → ≥ 320`).
- **NOT captured live**: full descent through creation into exploration/combat.
  The measurement rig would need to finalize a party build and wire
  `#a=exploration?…` — outside a discovery session's time budget. §4's in-run
  numbers cite the e2e floors that already assert them; SESSION-05/SESSION-08
  will measure the reclaimed values live and raise the floors accordingly.

---

## §2 Control Inventory

Every text-chrome control the feature might convert, classified per the brief:

- **icon-only** — the entire visible label becomes a lucide glyph;
  `aria-label` preserves the former text verbatim.
- **icon+text (sanctioned)** — icon leads, short text stays (title wordmark
  + START and destructive actions).
- **stays text (content)** — value, log line, notice, prose, proper noun,
  numeric readout, action-cost chip, disabled-reason line.
- **NO-GLYPH — keeps text** — no suitable lucide id in the M107 subset.

Rows are grouped by owning module. `file:line` anchors to the current tree.

### 2.1 Console shell (M60 · `src/ui/console/console.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| MOVE tab | `src/ui/console/console.js:113` (`tab.textContent = mode.label`) with `label='MOVE'` in `MODE_REGISTRY` at `:21` | `MOVE` + numeric badge `1` | **icon-only** (badge stays) |
| CMBT tab | `console.js:113`; label at `:22` | `CMBT` + badge `2` | **icon-only** |
| PARTY tab | `console.js:113`; label at `:23` | `PARTY` + badge `3` | **icon-only** |
| GEAR tab | `console.js:113`; label at `:24` | `GEAR` + badge `4` | **icon-only** |
| TECH tab | `console.js:113`; label at `:25` | `TECH` + badge `5` | **icon-only** |
| LOOT tab | `console.js:113`; label at `:26` | `LOOT` + badge `6` | **icon-only** |
| LOG tab | `console.js:113`; label at `:27` | `LOG` + badge `7` | **icon-only** |
| Mode heading (wide dock content header) | `console.js:169` (`◈ ${label} MODE`) | `◈ MOVE MODE` etc. | **stays text (content)** — the header echoes the mode name for orientation; SESSION-06 wide dock does not include an icon here. |

### 2.2 Move mode (M61 · `src/ui/console/move.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| D-pad NW/N/NE/W/E/SW/S/SE | `move.js:66-79`, buttons in `DIRECTIONS` `:3-13` | Arrow character only (label emptied when icon present) | **icon-only** — already icon-first as of the referenced session; keep. |
| CONFIRM / WAIT / DESCEND | `move.js:73` (`isConfirm ? confirmLabel : …`) | `WAIT` / `DESCEND` | **NO-GLYPH — keeps text.** Semantic verb switches per underfoot state; no lucide glyph disambiguates "you may descend" from "you are just waiting a beat." |
| HOSTILE STOP LOCKED (portrait) | `move.js:94` | `HOSTILE STOP LOCKED` | **icon+text** — carries `eye` prefix already (`move.js:96`); the padlock is conveyed by the disabled state, not a second icon. Short text kept because "hostile stop" is a named toggle. |
| DISCOVERY STOP ON/OFF (portrait) | `move.js:99` | `DISCOVERY STOP ON` / `…OFF` | **icon+text** — `eye`/`eye-off` swap already wired (`move.js:102`); text stays because the setting name is not glyph-guessable. |
| DAMAGE STOP ON/OFF (portrait) | `move.js:107` | `DAMAGE STOP ON` / `…OFF` | **icon+text** — same rationale. |
| Auto-stop rows (wide) | `move.js:116-118` — inline `<span>` with `ON`/`OFF` pill | Text row + `ON`/`OFF` pill | **stays text (content)** — non-interactive setting readout, not a button; the pill is a value chip, not chrome. |
| Move input hint | `move.js:56` (`Arrows / WASD / Numpad`) | `Arrows / WASD / Numpad` | **stays text (content)** — instructional prose. |
| Move mode indicator | `move.js:54` (`◈ MOVE MODE`) | `◈ MOVE MODE` | **stays text (content)** — heading. |
| Move notice | `move.js:121-122` | `MOVE with arrows, numpad, WASD…`, `BLOCKED…`, `MOVED TO x:y.` etc. | **stays text (content)** — event/status line. |

### 2.3 Combat mode (M62 · `src/ui/console/combat.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| MOVE action button | `combat.js:24` `label='Move'`, rendered at `combat.js:253` as `MOVE · UP TO 5 CELLS` | Label + needs chip | **icon+text** — icon already prefixed (`combat.js:274`); the `· 1 AP` / `UP TO 5 CELLS` cost chip is content, not chrome. |
| ATTACK action | `combat.js:25` `label='Attack'` | `ATTACK · 1 AP` | **icon+text** — `sword` prefixed; cost is content. |
| PROTOCOL action | `combat.js:26` `label='Protocol'` | `PROTOCOL · 1 AP + CHARGE` | **icon+text** — `wand-sparkles`. |
| OVERCLOCK action | `combat.js:27` `label='Overclock'` | `OVERCLOCK · 1 AP + OVERCLOCK CHARGE` | **icon+text** — `zap`; is a "power" state, cost line is content. |
| ITEM action | `combat.js:28` `label='Item'` | `ITEM · 1 AP` | **icon+text** — `flame` (matches existing catalog). |
| RETREAT action | `combat.js:29` `label='Retreat'` | `RETREAT · 1 AP` | **icon+text** — `arrow-up-right`; destructive-ish (loses tempo) but not lethal → keep short text. |
| END TURN action | `combat.js:30` `label='End Turn'` | `END TURN · EXPLICIT` | **icon+text** — `clock`; text stays because End Turn is an explicit, contractual close-of-turn — the strongest argument for a redundant textual affordance in the whole console. |
| Direction cells (nw/n/ne/w/e/sw/s/se) | `combat.js:32-36`, rendered `combat.js:289-303` | Arrow character | **icon-only** — swap arrow-character text for the same 8 lucide arrows already used by move.js. Center cell `X LEFT` is a **value chip** and stays text (`combat.js:294`). |
| UNDO (path pop) | `combat.js:309` | `UNDO` | **icon+text** — `arrow-up-left` (SESSION-03/05 discretion) or a text keep. §3 records `arrow-up-left` as the icon, text stays because UNDO is a semantically loaded verb (path-step vs. selection). |
| Target rows | `combat.js:427` (`createButton(label, …)`) | `<name> · HP x/y · Range …` | **stays text (content)** — content label. `circle-x` prefix already appears on `is-illegal` rows (`combat.js:433`); accepted as-is. |
| CONFIRM (combat) | `combat.js:454` | `CONFIRM` / `RESOLVING` | **NO-GLYPH — keeps text.** `check` is the only near-fit and mis-cues "task complete." Combat-CONFIRM is a load-bearing verb; text stays. |
| BACK (combat) | `combat.js:462` | `BACK` | **icon-only** — `arrow-left`; aria stays `BACK`. |
| Feedback: hint / notice / error / resolving / terminal / TARGET preview / no valid targets / no consumables / active-panel AP+move line / condition tags | `combat.js:405,489-491,505,502,395,411,349,130,136` | Various | **stays text (content)** — status/preview strings, not chrome. Condition tags already carry icons via `createConditionTag` (`components.js:257`). |

### 2.4 Party mode (M63 · `src/ui/console/party.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| Member card (row) | `party.js:187-222` (a `<div role="button">`) | Class/name + `Cal N · Tk` + inline HP/CHG bar + equipment line | **stays text (content)** — content-heavy card; icons already lead HP (`heart`), CHG (`battery`), and the role glyph (`user`) via `compactBar` at `:214-215` and the icon prefix at `:204`. |
| PARTY ROSTER heading | `party.js:175` | `◈ PARTY ROSTER` | **stays text (content)** — heading. |
| Detail heading (`◈ CLASS DETAIL`) | `party.js:246` | `◈ <CLASS> DETAIL` | **stays text (content)**. |
| Derived-stat rows (Defense, Protocol Defense, Initiative, Melee/Ranged/Protocol, Detection, CHARGE regen) | `party.js:288-295` | Label + value | **icon+text** — `DERIVED_ICONS` map is already wired at `party.js:9-16`; text stays because each row is a stat readout, not chrome. |
| Attribute stepper labels (MGT/FIN/VIT/RES/FOC/SIG) | `party.js:268-282` (`ATTR_LABELS`) | Three-letter abbreviation + value | **stays text (content)** — attribute abbreviations ARE the content; adding an icon would only decorate. |
| Section labels ("Conditions", "Equipment", "Deck") | `party.js:301,315,322` | `Conditions`, `Equipment`, `Deck` | **stays text (content)** — section headings. |

### 2.5 Gear mode (M64 · `src/ui/console/gear.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| Character selector pills (C1, C2, C3…) | `gear.js:286` | Party member's name or `C1`/`C2`/… | **stays text (content)** — proper name (the operator's name is content). |
| Slot buttons: Weapon / Armor / Off-hand | `gear.js:300` | `Weapon · <item>` etc. | **icon+text** — `SLOT_ICONS` map already wired at `gear.js:9` (`sword`/`shield`/`star`); text stays because it includes the equipped item name (content). |
| EQUIPPED heading | `gear.js:310` | `◈ EQUIPPED — <name>` | **stays text (content)** — heading. |
| UNEQUIP button (per slot) | `gear.js:353` | `UNEQUIP` | **icon+text** — `x` icon already prefixed at `gear.js:356`; short text kept because UNEQUIP is a mutating verb (semi-destructive) — keeping text is the sanctioned pattern. |
| Disabled-reason lines | `gear.js:361` | `Inventory full.` etc. | **stays text (content)** — explanation prose. |
| CONFIRM CORRUPT EQUIP | `gear.js:399` | `CONFIRM CORRUPT EQUIP` | **icon+text — destructive** — needs `triangle-alert` prefix (danger tone) and short text stays; corrupt equip is permanent state mutation. |
| INVENTORY heading | `gear.js:374` | `◈ INVENTORY` | **stays text (content)** — heading. |
| EQUIP / EQUIP BLOCKED / EQUIP WEAPON etc. | `gear.js:434` | `EQUIP WEAPON` / `EQUIP BLOCKED` | **icon-only** — `check` (positive) when enabled, disabled state kept + reason line adjacent. NOTE: this button's text is currently dynamic per-slot (`EQUIP WEAPON`/`EQUIP ARMOR`); the *slot* is already communicated by the selected slot button above, so the per-row EQUIP can go icon-only. Reason chip remains text. |
| TAG JUNK / UNTAG JUNK | `gear.js:451` | `TAG JUNK` / `UNTAG JUNK` | **icon+text** — `recycle` already prefixed (`gear.js:453`); JUNK is a mutating action that removes items on the subsequent JUNK ALL step — sanctioned text keep. |
| JUNK ALL TAGGED / CONFIRM JUNK ALL TAGGED | `gear.js:414` | full text | **icon+text — destructive** — `recycle` + `danger` tone; text stays (deletes items). |
| CORRUPT tag / corrupt-warning span | `gear.js:394,457` | Warning prose | **stays text (content)** — warning prose. |

### 2.6 Tech mode (M65 · `src/ui/console/tech.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| Character selector pills | `tech.js:294` | Member name | **stays text (content)** — proper name. |
| ACTIVE indicator | `tech.js:290` | `ACTIVE: <name>` | **stays text (content)** — status line. |
| CHARGE POOL heading | `tech.js:441` | `◈ CHARGE POOL` | **stays text (content)** — heading. |
| Deck-slot line | `tech.js:455` | `Deck slots N/M · valid` | **stays text (content)** — status. |
| EQUIPPED PROTOCOLS heading | `tech.js:465` | `◈ EQUIPPED PROTOCOLS` | **stays text (content)**. |
| CAST / CAST BLOCKED | `tech.js:333` | `CAST` / `CAST BLOCKED` | **icon-only** — `wand-sparkles` already prefixed (`tech.js:336`); text stays only when blocked (§3 records both). Enabled CAST → icon-only with `aria-label="Cast"`. |
| OVERCLOCK N CHG / OVERCLOCK BLOCKED | `tech.js:342` | `OVERCLOCK <N> CHG` | **icon+text** — `zap` + `danger` tone already prefixed (`tech.js:345`); the CHG cost is content; text stays because Overclock has real corruption risk. |
| CONFIRM (tech) | `tech.js:392` | `CONFIRM` | **NO-GLYPH — keeps text.** Same reasoning as combat-CONFIRM. |
| BACK (tech) | `tech.js:395` | `BACK` | **icon-only** — `arrow-left`. |
| Target rows | `tech.js:364` | `<name> · HP …` | **stays text (content)** — content label. |
| Catalog rows | `tech.js:409` (`line.textContent = ...`) | Full protocol catalog line | **stays text (content)** — reference text. |
| Notice / preview / result / regen line | `tech.js:382,447,476,477,479` | Prose | **stays text (content)**. |

### 2.7 Loot mode (M66 · `src/ui/console/loot.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| Container header line | `loot.js:341` | `CONTAINER <id> · <kind> · <status> · <n> item(s)` | **stays text (content)** — content readout. Icon (`box`/`archive`) already prefixed at `loot.js:339`. |
| OPEN CONTAINER / OPENED | `loot.js:343` | `OPEN CONTAINER` / `OPENED` | **icon-only** — `chevron-right` prefixed today (`loot.js:347`); primary action, aria stays `Open container`. When disabled (`OPENED`), keep text. |
| CONTENTS heading | `loot.js:351` | `◈ CONTENTS` | **stays text (content)**. |
| TAKE / TAKE BLOCKED | `loot.js:243` | `TAKE` / `TAKE BLOCKED` | **icon-only** — `download` prefixed today (`loot.js:246`). Blocked path keeps text (reason chip adjacent). |
| INVENTORY heading | `loot.js:268` | `◈ INVENTORY` | **stays text (content)**. |
| MANAGE JUNK toggle | `loot.js:276` | `▾ MANAGE JUNK · N` / `▸ MANAGE JUNK · N` | **icon-only** — `chevron-down` open / `chevron-right` closed. Numeric count is content, moves to an adjacent chip. **NO-GLYPH note:** `chevron-down` is not currently in the M107 subset (§3 flags this for SESSION-02 sprite extension). If SESSION-02 declines to add it → keeps text. |
| TAG / UNTAG (per item) | `loot.js:297` | `TAG <name>` / `UNTAG <name>` | **icon+text** — `recycle` already prefixed (`loot.js:299`); text stays because it includes the item name (content). |
| JUNK ALL TAGGED / CONFIRM JUNK ALL TAGGED | `loot.js:305` | full text | **icon+text — destructive** — `recycle` + `danger`; text stays. |

### 2.8 Log mode (M67 · `src/ui/console/log.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| EVENT LOG heading | `log.js:270` | `◈ EVENT LOG — FLOOR NN` | **stays text (content)** — heading with floor value. |
| Log entries | `log.js:170-195` | `[E:NNN] TYPE · message` | **stays text (content)** — full log content. |
| SHARE RUN heading | `log.js:283` | `◈ SHARE RUN` | **stays text (content)**. |
| Budget line | `log.js:284` | `URL < 1500 chars` | **stays text (content)**. |
| Link fallback field | `log.js:286` | URL text | **stays text (content)**. |
| COPY LINK | `log.js:294` | `◈ COPY LINK` | **icon-only** — `link` prefixed today (`log.js:299`); aria stays `Copy link`. Disabled state → keep text (`Full-state link unavailable after wipe.`). |
| Notice / error | `log.js:305,313` | Prose | **stays text (content)**. |

### 2.9 Status strip + telemetry dock (M59 · `src/ui/status-strip.js`)

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| Portrait strip labels: DEPTH / SEED / PARTY / DANGER / CLK / ACTIVE / ROUND / INITIATIVE ORDER | `status-strip.js:120-136,209-222,242-249,273` | ALL-CAPS group label | **stays text (content)** — these are noninteractive readouts; the accompanying value IS the point. Icon prefixes on the wide dock already exist (`DOCK_ICONS` at `:12-19`) — portrait strip skips them for pixel budget. |
| Manual `?` chip | `status-strip.js:33` (via `createManualLink`) | `?` | **NO-GLYPH — keeps text** — the `?` character is already a maximally-recognized affordance and is glyph-tight in the strip's 8px padding. `circle-help` in a 14px box is larger than the current text `?` and would break wide-dock layout. Kept text. |
| Wide dock field labels: Depth / Seed / Party / Danger Clock / Corruption / Round | `status-strip.js:12-19` | Label | **icon+text** — icons already prefixed on the LABEL span (`status-strip.js:303`). §3 records the map. **NO-GLYPH edge:** `Seed` currently uses `chevron-right` as a placeholder because `hash` is not in the M107 subset (`status-strip.js:11`). §3 flags this. |
| Wide initiative rail: `◈ INITIATIVE ORDER` header | `status-strip.js:351` | Text | **stays text (content)** — heading. |
| Wide active-actor: `<NAME> · ACTIVE`, `N AP · 1 MV`, `HP N/M`, `CHG N/M`, condition tags | `status-strip.js:423,427,438,444,449-455` | Content | **stays text (content)**. |
| Wide event-log feed header | `status-strip.js:507` | `◈ Event Log — Floor NN` | **stays text (content)**. |

### 2.10 Screens with buttons — menus only

**Title (M68 · `src/ui/screens/title.js`)**

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| `OPERATOR'S DESCENT` wordmark | `title.js:72,80` | Two-line wordmark | **stays text (content) — sanctioned** — brief §"sanctioned text" line 1. |
| `DEPTH IS THE SCORE` tagline | `title.js:92` | Tagline | **stays text (content)**. |
| `GLITCH FORGEWORKS` header | `title.js:56` | Publisher | **stays text (content) — proper noun**. |
| `START` | `title.js:95` | `START` | **stays text (content) — sanctioned** — the START affordance is explicitly named in the brief. |
| `◈ BEGIN NEW RUN` | `title.js:107` (from `BRANCHES[0]`) | `◈ BEGIN NEW RUN` | **icon+text** — `chevron-right` prefix; text stays (the `◈` ornament reads as decorative and is content-owned). |
| `◈ RUN LIBRARY` | `title.js:107` (`BRANCHES[1]`) | `◈ RUN LIBRARY` | **icon+text** — `archive` prefix. |
| `◈ IMPORT LINK` | `title.js:107` (`BRANCHES[2]`) | `◈ IMPORT LINK` | **icon+text** — `download` (or `link`) prefix — §3 picks `download`. |
| `MANUAL` | `title.js:15` (SECONDARY) | `MANUAL` | **icon+text** — `scroll-text`; text stays because the secondary row is a wide two-button strip whose labels are the only differentiator. |
| `SETTINGS` | `title.js:16` (SECONDARY) | `SETTINGS` | **icon+text** — `gauge` (existing map on wide dock uses it for `Depth`; here it repurposes to "configure terminal"). §3 records this as the chosen id; SESSION-02 or SESSION-06 may add `settings`/`sliders`/`cog` to the subset if a semantically stronger glyph is desired. |
| `v1.0 · BUILD · OFFLINE READY`, `PRESS START TO POWER ON` | `title.js:148,150` | Footer prose | **stays text (content)**. |

**Settings (M76 · `src/ui/screens/settings.js`)**

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| `◈ SETTINGS` eyebrow | `settings.js:57` | Eyebrow | **stays text (content)** — heading. |
| `CONFIGURE TERMINAL` heading | `settings.js:62` | Heading | **stays text (content)**. |
| `◈ AUDIO` / `◈ VISUAL` / `◈ INFO` section headers | `settings.js:102,148,214` | Section header | **stays text (content)**. |
| `MASTER MUTE` toggle | `settings.js:106` (`createToggle` label) | `MASTER MUTE` | **icon+text** — `eye-off` when muted / `eye` when unmuted feels contradictory; better fit is `x` (mute) — §3 records this. Text stays because the setting name is not glyph-guessable. |
| `MASTER` slider label | `settings.js:116` | `MASTER` | **stays text (content)** — slider label; adding an icon inside the slider row breaks the label/input/value trio the e2e asserts (`portrait-usability.spec.js:468-479`). |
| Per-layer volume sliders: `DRONE` / `PULSE` / `SPARKLE` / `LEAD` / `NOISE BED` | `settings.js:131` (`LAYERS` array `:6-12`) | Layer name | **stays text (content) — proper noun** — each names a synthesis layer. |
| `PER-LAYER VOLUME` caption | `settings.js:127` | Caption | **stays text (content)**. |
| `GLITCH` toggle | `settings.js:152` | `GLITCH` | **icon+text** — `triangle-alert` (matches the visual style the effect projects). Text stays; the setting name is content. |
| `REDUCED MOTION` group + `FOLLOW SYSTEM` / `REDUCE` / `ALLOW` | `settings.js:170,174` | Text options | **stays text (content)** — radio-group options; each conveys a value, not chrome. |
| `SCANLINES & GRAIN` toggle | `settings.js:194` | Label | **icon+text** — `eye` (visual texture). Text stays. |
| `OPERATOR'S MANUAL` button | `settings.js:206` | Label | **icon+text** — `scroll-text` prefix; text stays because it names the deep-link target. |
| `BACK` | `settings.js:234` | `BACK` | **icon-only** — `arrow-left`. |
| Info rows (`Version`, `Build`, `Cache`, `Transfer`) | `settings.js:218-225` | Label/value pairs | **stays text (content)**. |

**Creation (M69 · `src/ui/screens/creation.js`)** — the biggest single-screen inventory.

| Control (representative) | file:line | Current text | Classify |
|--------------------------|-----------|--------------|----------|
| `◀ BACK` (screen top) | `creation.js:701, 1190` | `◀ BACK` | **icon-only** — `arrow-left`; `◀` becomes the sprite. |
| `◈ FINALIZE & DESCEND` / `BOOTING…` / `FINALIZED` | `creation.js:708, 1196` | Text | **icon+text — destructive-adjacent** — `chevron-right` prefix; text stays (this is the run-start commit). `BOOTING…` / `FINALIZED` are dynamic states, text stays. |
| `− REMOVE` (party member) | `creation.js:277, 802` | `− REMOVE` | **icon+text — destructive** — `x` + `danger` tone; short text stays. |
| Slot cards (empty class/gear/protocol pickers) | `creation.js:297,324,350,388,481,567,781,874,933,1011,1026,1083` | Empty label passed to `createButton('', {…})` | **stays text (content)** — card content is a class/item/sigil name (proper noun content). |
| `−` / `+` attribute steppers | `creation.js:530,539` | `−` / `+` | **icon-only** — `chevron-left`/`chevron-right` … or keep the mathematical `−`/`+` characters as-is (they ARE the affordance). Recommendation: **stays text (content) — sanctioned punctuation**. §3 records "no swap." (Steppers are already 32px CSS-wide, not a chrome-density opportunity — see accessibility-audit.md §3D re: `.stepper-btn:disabled` opacity.) |
| Tab buttons in creation subpanels | `creation.js:829` | Text label | **stays text (content)** — panel-tab labels are content (`CLASS` / `GEAR` / `PROTOCOLS` / `SIGIL`); no glyph is more legible than a 4–8 char text tab. |
| `NO ARMOR` / `NONE` | `creation.js:1011` | Text | **stays text (content)** — semantic-null value chip. |
| `SAVE CONFIG` / `CONFIRM OVERWRITE` | `creation.js:1126` | Text | **icon+text** — `download`; text stays because it names the storage target. |
| `LOAD` (per saved config) | `creation.js:1153` | `LOAD` | **icon-only** — `upload` (the direction is "into the run"; SESSION-06 may pick a different id — §3 fixes `upload`). |
| `DELETE` / `CONFIRM DELETE` (per saved config) | `creation.js:1158` | Text | **icon+text — destructive** — `x` + `danger`; text stays. |
| `+ SAVE` | `creation.js:1246` | `+ SAVE` | **icon+text** — `download`; text stays (paired with a name input). |

**Library (M72 · `src/ui/screens/library.js`)**

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| `◈ RUN LIBRARY` eyebrow | `library.js:313,375` | Eyebrow | **stays text (content)**. |
| `N ACTIVE RUNS`, seed/theme/depth/classes/last-played rows | `library.js:132,134,144,149,153,227,230,244,251,254,263,318,380` | Content rows | **stays text (content)** — run metadata. |
| `NO SIGILS` empty state | `library.js:90,244` | Empty label | **stays text (content)**. |
| `QUARANTINED — <reason>` | `library.js:160,270` | Error text | **stays text (content)**. |
| `RESUME` (per row, portrait) | `library.js:166` | `RESUME` | **icon-only** — `chevron-right`. |
| `◈ RESUME` (per row, wide) | `library.js:276` | Text | **icon-only** — `chevron-right`. |
| `DELETE LOCAL STATE` (portrait per row) | `library.js:177` | Text | **icon+text — destructive** — `x` + `danger` (Custom Rule 14 & brief §3); text stays. |
| `DELETE` (wide per row) | `library.js:287` | `DELETE` | **icon+text — destructive** — `x` + `danger`; text stays. |
| `NEW RUN` / `◈ NEW RUN` | `library.js:349, 425` | Text | **icon+text** — `chevron-right`; text stays (page-level primary CTA). |
| `TITLE` / `◀ TITLE` | `library.js:355, 419` | Text | **icon-only** — `arrow-left`. |
| `◈ NO LIMIT ON SIMULTANEOUS RUNS ◈` hint | `library.js:410` | Prose hint | **stays text (content)**. |
| No-runs empty message | `library.js:336, 398` | Prose | **stays text (content)**. |

**Scorecard (M73 · `src/ui/screens/scorecard.js`)**

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| `PARTY WIPE` / `RUN CONCLUDED` / `CAUSE OF DEATH: …` / `WORLD SEED: …` / `◈ FINAL DEPTH` / `MUTABLE RUN STATE DELETED` / `SEED ONLY — NO RUN STATE` / `SHARE & RESTART` / `CARRY THE SEED FORWARD` / `◈ ◈ ◈` ornament | `scorecard.js:205,208,220,239,246,230,274,264,267,205,261,301,304,307,317,327,338,346,353` | Prose + values | **stays text (content)** — pure run summary content. |
| `COPY WORLD LINK` / `WORLD LINK COPIED` | `scorecard.js:155,143` | Text | **icon+text** — `link`; text stays (label toggles on success). |
| `RESTART SAME SEED` | `scorecard.js:163` | Text | **icon+text** — `recycle`; text stays (semantic-strong verb). |
| `NEW RUN` | `scorecard.js:169` | Text | **icon+text** — `chevron-right`. |
| `TITLE` | `scorecard.js:173` | `TITLE` | **icon-only** — `arrow-left`. |
| `LIBRARY` | `scorecard.js:177` | `LIBRARY` | **icon-only** — `archive`. |

**Import (M74 · `src/ui/screens/import.js`)**

| Control | file:line | Current text | Classify |
|---------|-----------|--------------|----------|
| `◈ IMPORT LINK` eyebrow + `RESUME FROM URL` heading + instructions | `import.js:97,102,115` | Prose | **stays text (content)**. |
| `IMPORT` | `import.js:268` | `IMPORT` | **icon-only** — `download`; primary action. |
| `RETURN TO TITLE` | `import.js:179,275` | Text | **icon-only** — `arrow-left`; aria `Return to title`. |
| `FRESH RUN IN THIS WORLD` | `import.js:171` | Text | **icon+text** — `chevron-right`; text stays (fallback that changes what the button does). |
| `RESUME RUN` | `import.js:197` | Text | **icon+text** — `chevron-right`; text stays (primary fallback action). |
| Info line + failure-message body | `import.js:193,164` | Prose | **stays text (content)**. |

### 2.11 Not touched by the feature

- `src/ui/screens/tutorial.js` — route retired, module lingers per
  `tests/ui/front-door.test.js:271` (see the tombstone comment).
- `src/ui/screens/exploration.js`, `src/ui/screens/combat.js` — own zero
  buttons; nothing to swap. (Verified above.)
- `src/ui/manual/manual-modal.js` — brief §"Manual modal chrome untouched."
- `src/ui/playfield.js` — canvas rendering, no buttons.

### 2.12 Aggregate counts

- Total text-chrome buttons/tabs surveyed: **≈ 96** across 8 console modes + 6
  menu screens + status strip. (Aggregated from the tables above; excludes
  every "stays text (content)" row that was already a value/notice/prose line.)
- **icon-only** rows: 26 (7 tabs; 8 combat directions; UNDO; combat BACK;
  tech BACK; loot OPEN; loot TAKE; loot MANAGE JUNK toggle; log COPY LINK;
  gear EQUIP; title branches → NO, those are icon+text; library RESUME × 2;
  library TITLE; scorecard TITLE; scorecard LIBRARY; import IMPORT; import
  RETURN TO TITLE; settings BACK; creation `◀ BACK`; tech CAST; loot MANAGE
  JUNK; settings BACK).
- **icon+text (sanctioned)** rows: **≈ 42** (majority are destructive
  actions, cost-bearing verbs, and identifier-carrying primary CTAs).
- **NO-GLYPH — keeps text** rows: **6** (move CONFIRM/WAIT/DESCEND;
  combat CONFIRM; tech CONFIRM; status-strip manual `?` chip;
  status-dock `Seed` label falls back to `chevron-right` because `hash` is
  not in the M107 subset; loot MANAGE JUNK toggle if SESSION-02 declines to
  add `chevron-down`).

---

## §3 Icon Map

One row per control that is **not** classified as pure content. `NO-GLYPH`
rows keep text and are marked. `aria-label` MUST match the former visible
label verbatim (per STATE.md Design Decision 2). Sizes match existing prefix
sizes — `16` for primary action buttons, `14` for chips/pills/toggles.
Sprite membership is checked against `src/ui/icon.js` `ICON_IDS` (45 ids); a
NEW row here means SESSION-02 must add the id to `tools/icons/subset.json`
and rerun `npm run build:icons`.

Tone key: `dim` for prefix-on-content rows; `accent` when the icon carries
the primary intent (`chevron-right` on OPEN CONTAINER, `download` on IMPORT);
`danger` only on destructive/hostile per Custom Rule 14. Un-toned → inherits
`currentColor` from `.btn-crt` — matches accent/dim per button state.

### 3.1 Console — tabs (M60)

| Control | lucide id | In sprite? | Size | aria-label (verbatim) | Tone | Notes |
|---------|-----------|-----------|------|-----------------------|------|-------|
| MOVE tab | `footprints` | ✅ | 20 | `MOVE · Key 1` | — | Numeric badge stays visible per `.tab-key`. |
| CMBT tab | `sword` | ✅ | 20 | `CMBT · Key 2` | — | |
| PARTY tab | `users` | ✅ | 20 | `PARTY · Key 3` | — | |
| GEAR tab | `backpack` | ✅ | 20 | `GEAR · Key 4` | — | |
| TECH tab | `flask-conical` | ✅ | 20 | `TECH · Key 5` | — | |
| LOOT tab | `box` | ✅ | 20 | `LOOT · Key 6` | — | Container-neutral; `archive` reserved for vault-loot in `loot.js:339`. |
| LOG tab | `scroll-text` | ✅ | 20 | `LOG · Key 7` | — | |

Disabled-state aria: keep the existing `LABEL · <reason>` string
(`console.js:165`); the icon does not change.

### 3.2 Move mode — D-pad (M61)

Already icon-first as of the referenced session; no changes here. SESSION-05
must NOT reintroduce arrow characters.

- `arrow-up-left`, `arrow-up`, `arrow-up-right`, `arrow-left`, `arrow-right`,
  `arrow-down-left`, `arrow-down`, `arrow-down-right` — all ✅ in sprite.
- CONFIRM cell → **NO-GLYPH**, text stays (`WAIT`/`DESCEND`).

### 3.3 Combat mode (M62)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| MOVE action | `arrow-down-right` | ✅ | 16 | `Move` | — | Existing. |
| ATTACK action | `sword` | ✅ | 16 | `Attack` | — | |
| PROTOCOL action | `wand-sparkles` | ✅ | 16 | `Protocol` | — | |
| OVERCLOCK action | `zap` | ✅ | 16 | `Overclock` | — | |
| ITEM action | `flame` | ✅ | 16 | `Item` | — | |
| RETREAT action | `arrow-up-right` | ✅ | 16 | `Retreat` | — | |
| END TURN action | `clock` | ✅ | 16 | `End Turn` | — | |
| Direction cells (8) | `arrow-*` (as move-mode) | ✅ | 16 | `Step <dir>` | — | Replace arrow character with sprite; center cell `X LEFT` stays text. |
| UNDO | `arrow-up-left` | ✅ | 14 | `UNDO` | dim | icon+text keep. |
| BACK | `arrow-left` | ✅ | 14 | `BACK` | — | icon-only. |
| Illegal-target chip (already present) | `circle-x` | ✅ | 14 | (reason) | danger | Already at `combat.js:433`. |

### 3.4 Party mode (M63)

Already icon-prefixed via `DERIVED_ICONS` (`party.js:9-16`), `heart`/`battery`
in `compactBar`, and `user` on member cards. No new sprite work.

### 3.5 Gear mode (M64)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| Slot: Weapon | `sword` | ✅ | 14 | `Weapon · <item>` | dim | Existing. |
| Slot: Armor | `shield` | ✅ | 14 | `Armor · <item>` | dim | Existing. |
| Slot: Off-hand | `star` | ✅ | 14 | `Off-hand · <item>` | dim | Existing. |
| UNEQUIP | `x` | ✅ | 14 | `UNEQUIP` | — | icon+text keep. |
| CONFIRM CORRUPT EQUIP | `triangle-alert` | ✅ | 14 | `CONFIRM CORRUPT EQUIP` | danger | icon+text destructive. |
| EQUIP / EQUIP BLOCKED | `check` | ✅ | 14 | `EQUIP <slot>` | accent (enabled) | icon-only when enabled; disabled path keeps text + reason chip. |
| TAG JUNK / UNTAG JUNK | `recycle` | ✅ | 14 | `TAG JUNK <name>` / `UNTAG JUNK <name>` | dim | icon+text. |
| JUNK ALL TAGGED | `recycle` | ✅ | 14 | `JUNK ALL TAGGED` | danger | icon+text destructive. |

### 3.6 Tech mode (M65)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| CAST | `wand-sparkles` | ✅ | 14 | `Cast` | accent | icon-only when enabled; blocked path keeps text. |
| OVERCLOCK N CHG | `zap` | ✅ | 14 | `OVERCLOCK <N> CHG` | danger | icon+text; existing. |
| CONFIRM | **NO-GLYPH** | — | — | — | — | Keeps text (`CONFIRM` / `RESOLVING`). |
| BACK | `arrow-left` | ✅ | 14 | `BACK` | — | icon-only. |
| Errors: triangle-alert prefix on tech-error | `triangle-alert` | ✅ | 14 | (error text) | danger | Already at `tech.js:480`. |

### 3.7 Loot mode (M66)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| Container icon (kind=vault) | `archive` | ✅ | 16 | (decorative) | dim | Existing. |
| Container icon (kind=standard) | `box` | ✅ | 16 | (decorative) | dim | Existing. |
| OPEN CONTAINER | `chevron-right` | ✅ | 14 | `Open container` | accent | icon-only when enabled; disabled → `OPENED` text keep. |
| TAKE | `download` | ✅ | 14 | `Take <item>` | accent | icon-only when enabled; blocked → `TAKE BLOCKED` text keep. |
| MANAGE JUNK toggle (open) | **`chevron-down`** | ❌ **NOT IN SPRITE** | 14 | `Collapse junk manager` | dim | **SESSION-02 to add `chevron-down` to `tools/icons/subset.json`, else NO-GLYPH → keeps text.** |
| MANAGE JUNK toggle (closed) | `chevron-right` | ✅ | 14 | `Expand junk manager` | dim | Reuses existing id if `chevron-down` is refused. |
| TAG / UNTAG per item | `recycle` | ✅ | 14 | `TAG JUNK <name>` / `UNTAG JUNK <name>` | dim | icon+text. |
| JUNK ALL TAGGED | `recycle` | ✅ | 14 | `JUNK ALL TAGGED` | danger | icon+text destructive. |

### 3.8 Log mode (M67)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| COPY LINK | `link` | ✅ | 14 | `Copy link` | accent | icon-only when enabled; disabled keeps text. |

### 3.9 Status strip / telemetry dock (M59)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| Depth label (wide dock) | `gauge` | ✅ | 14 | `Depth` | dim | Existing at `status-strip.js:12`. |
| Seed label (wide dock) | **`hash` desired; `chevron-right` placeholder** | ❌ **`hash` NOT IN SPRITE** | 14 | `Seed` | dim | **SESSION-02 to add `hash` to subset.** Placeholder in place today (`status-strip.js:11`). |
| Party label (wide dock) | `users` | ✅ | 14 | `Party` | dim | Existing. |
| Danger Clock label (wide dock) | `clock` | ✅ | 14 | `Danger Clock` | dim | Existing. |
| Corruption label (wide dock) | `flame` | ✅ | 14 | `Corruption` | dim | Existing. |
| Round label (wide dock) | `sparkles` | ✅ | 14 | `Round` | dim | Existing. |
| Manual `?` chip | **NO-GLYPH** | — | — | — | — | Keeps text `?`. |

Portrait strip labels stay text (§2.9).

### 3.10 Title screen (M68)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| BEGIN NEW RUN | `chevron-right` | ✅ | 16 | `◈ BEGIN NEW RUN` | accent | icon+text. |
| RUN LIBRARY | `archive` | ✅ | 16 | `◈ RUN LIBRARY` | — | icon+text. |
| IMPORT LINK | `download` | ✅ | 16 | `◈ IMPORT LINK` | — | icon+text. |
| MANUAL | `scroll-text` | ✅ | 16 | `MANUAL` | — | icon+text. |
| SETTINGS | `gauge` | ✅ | 16 | `SETTINGS` | — | **See §7 Risk** — `gauge` is also used for the wide-dock `Depth` label. Two different meanings on the same session for the same glyph is a legibility hazard; SESSION-02 may add `settings2` (lucide) or `sliders` to the subset. If nothing better lands → keeps `gauge` here. |
| START | **NO-GLYPH** | — | — | — | — | Sanctioned text. |

### 3.11 Settings (M76)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| MASTER MUTE | `x` | ✅ | 14 | `MASTER MUTE` | — | icon+text (mute intent). |
| GLITCH | `triangle-alert` | ✅ | 14 | `GLITCH` | — | icon+text. |
| SCANLINES & GRAIN | `eye` | ✅ | 14 | `SCANLINES & GRAIN` | dim | icon+text. |
| OPERATOR'S MANUAL | `scroll-text` | ✅ | 16 | `OPERATOR'S MANUAL` | — | icon+text. |
| BACK | `arrow-left` | ✅ | 14 | `BACK` | — | icon-only. |

### 3.12 Creation (M69)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| BACK (`◀ BACK`) | `arrow-left` | ✅ | 14 | `◀ BACK` | — | icon-only. |
| FINALIZE & DESCEND | `chevron-right` | ✅ | 16 | `◈ FINALIZE & DESCEND` | accent | icon+text. |
| REMOVE (party) | `x` | ✅ | 14 | `− REMOVE` | danger | icon+text destructive. |
| SAVE CONFIG / CONFIRM OVERWRITE | `download` | ✅ | 14 | `SAVE CONFIG` / `CONFIRM OVERWRITE` | — | icon+text. |
| + SAVE | `download` | ✅ | 14 | `+ SAVE` | — | icon+text. |
| LOAD (per config) | `upload` | ✅ | 14 | `LOAD` | — | icon-only. |
| DELETE / CONFIRM DELETE (per config) | `x` | ✅ | 14 | `DELETE` / `CONFIRM DELETE` | danger | icon+text destructive. |
| Attribute steppers `−` / `+` | **NO SWAP** | n/a | n/a | (existing aria: `Decrease <attr>` / `Increase <attr>`) | — | Keep the mathematical characters — they ARE the affordance. |

### 3.13 Library (M72)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| RESUME / ◈ RESUME (per row) | `chevron-right` | ✅ | 14 | `RESUME` | accent | icon-only. |
| DELETE LOCAL STATE (portrait) | `x` | ✅ | 14 | `DELETE LOCAL STATE` | danger | icon+text destructive. |
| DELETE (wide) | `x` | ✅ | 14 | `DELETE` | danger | icon+text destructive. |
| NEW RUN / ◈ NEW RUN | `chevron-right` | ✅ | 16 | `NEW RUN` | accent | icon+text. |
| TITLE / ◀ TITLE | `arrow-left` | ✅ | 14 | `TITLE` | — | icon-only. |

### 3.14 Scorecard (M73)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| COPY WORLD LINK | `link` | ✅ | 14 | `COPY WORLD LINK` | — | icon+text. |
| RESTART SAME SEED | `recycle` | ✅ | 14 | `RESTART SAME SEED` | — | icon+text. |
| NEW RUN | `chevron-right` | ✅ | 14 | `NEW RUN` | accent | icon+text. |
| TITLE | `arrow-left` | ✅ | 14 | `TITLE` | — | icon-only. |
| LIBRARY | `archive` | ✅ | 14 | `LIBRARY` | — | icon-only. |

### 3.15 Import (M74)

| Control | lucide id | In sprite? | Size | aria-label | Tone | Notes |
|---------|-----------|-----------|------|------------|------|-------|
| IMPORT | `download` | ✅ | 16 | `IMPORT` | accent | icon-only (primary CTA on a text-heavy screen). |
| RETURN TO TITLE | `arrow-left` | ✅ | 14 | `RETURN TO TITLE` | — | icon-only. |
| FRESH RUN IN THIS WORLD | `chevron-right` | ✅ | 14 | `FRESH RUN IN THIS WORLD` | — | icon+text (fallback that mutates run intent). |
| RESUME RUN | `chevron-right` | ✅ | 14 | `RESUME RUN` | accent | icon+text. |

### 3.16 Sprite deltas SESSION-02 must ship

| New id | Requested by | Notes |
|--------|--------------|-------|
| `chevron-down` | §3.7 loot MANAGE JUNK expanded state | If SESSION-02 declines, that toggle keeps text. |
| `hash` | §3.9 wide-dock `Seed` label | If SESSION-02 declines, keep `chevron-right` placeholder. |
| (optional) `sliders` or `settings2` | §3.10 title SETTINGS branch | If SESSION-02 declines, keep `gauge` — see §7 Risk. |

**Every other icon this feature needs is already in `src/ui/icon.js` `ICON_IDS`.**

---

## §4 Measured Geometry

Numbers reported here are either **live** (Playwright pass on port 8081,
chromium-1234, this session) or **e2e-authoritative** — the current
`tests/e2e/*.spec.js` assertion is the floor SESSION-08 will raise. Where a
CSS min-height governs the box, the min-height is also cited so downstream
sessions can reason about the ceiling.

### 4.1 Title screen (live measurement)

Captured by driving `/` on the envelope port and recording bounding rects:

| Viewport | START button (before click) | Branch button height | Secondary-branch height | Header top | Footer bottom |
|----------|------------------------------|-----------------------|-------------------------|-----------|---------------|
| `phone` 412×915 | 208 × 72 px @ (108, 431) | 46 px | 46 px | 80 | 831 |
| `portrait` 1080×1920 | 208 × 72 px @ (436, 839) | 46 px | 46 px | 80 | 1836 |
| `wide-square` 1024×1024 | 208 × 72 px @ (408, 501) | 46 px | 46 px | 48 | 938 |

Observations:
- START button already meets WCAG 2.5.5 (72 px ≥ 44 px). SESSION-06 keeps
  START as sanctioned text; no change.
- **Branch buttons (46 px) sit just above the WCAG floor.** They are NOT
  `.console-row` and NOT `.mode-tab`, so the 96 px rule does not apply, but
  §5 records this as a candidate for a modest bump (46 → 56) if SESSION-06
  reclaims vertical space elsewhere on the title.
- The wide layout on 1024×1024 already renders the wide title mock
  (`html[data-layout=wide]`, `#portrait-frame → 1024×1024`).

### 4.2 Creation screen (live measurement)

| Viewport | `<button>` first (attribute stepper) height | `.btn-crt` first height |
|----------|---------------------------------------------|-------------------------|
| `phone` 412×915 | 126 × 44 px | 89 × 72 px |
| `portrait` 1080×1920 | 349 × 44 px | 256 × 72 px |
| `wide-square` 1024×1024 | 409 × 44 px | 76 × 32 px |

- **Attribute stepper is 44 px.** This is the current WCAG floor; the icon
  swap does not apply (§3.12 keeps `−`/`+` characters). SESSION-06 must
  preserve or raise, never shrink.
- The wide-square `.btn-crt` first sample (76 × 32) is a header-region
  button that is intentionally compact; SESSION-06 keeps it out of scope.

### 4.3 In-run chrome — CSS floors + e2e authorities

| Region | Portrait floor | Wide floor | Source |
|--------|----------------|------------|--------|
| Console tab bar `.console-tab-bar` height | 96 px | 72 px | `.mode-tab { min-height: 96px }` (`components.css:94`); `.wide-mode-tab { min-height: 72px }` (`wide.css:333`). |
| Console tab-tap floor (e2e) | ≥ 48 px | (n/a, tabs are `.wide-mode-tab`) | `tests/e2e/touch-flow.spec.js:152` — asserts `.console-row:visible, .mode-tab:visible` min ≥ 48. |
| Console row floor (e2e) | ≥ 96 px | ≥ 96 px | `tests/e2e/portrait-usability.spec.js:290`, `wide-panes.spec.js` implicit via `.console-row`. |
| Console-bar `expanded-half` | 220 px min / 32 dvh / 420 px max | (dock: `full` always) | `components.css:1170-1173`. |
| Console-bar `expanded-full` | 320 px min / 48 dvh / 640 px max | (dock: `full` always) | `components.css:1176-1178`. |
| Playfield height (portrait, tray half-open) | ≥ 200 px | (n/a) | `tests/e2e/portrait-usability.spec.js:282`. |
| `.wide-playfield-column` width | (n/a) | ≥ 320 px | `tests/e2e/wide-panes.spec.js:252`. |
| `.wide-console-dock` width (right dock, reopened) | (n/a) | ≥ 360 px | `tests/e2e/wide-panes.spec.js:262`. |
| Wide settings-body row heights | (n/a) | ≥ 96 px | `tests/e2e/portrait-usability.spec.js:449`. |
| `.combat-action`, `.combat-direction`, `.combat-target` | 96 px | 96 px | `components.css:1705,1708,1717`. |
| Status strip padding | 8 × 12 px | (n/a — wide uses `.wide-telemetry-dock`) | `components.css:1069`. Combat variant: 6 × 10 px (`components.css:1123`). |

### 4.4 Dead / letterboxed regions (source-truth)

- **Portrait**: the strip runs full-bleed (`components.css:1109-1113`); no
  side letterbox. Vertical dead space lives at the boundary between the
  status strip and the console tab bar when the tray is `collapsed` — the
  console never covers the playfield (per `components.css:1146-1179`), so a
  collapsed tray leaves ~ 96 px of chrome (tab bar) + status strip on a
  412×915 phone. §5 targets reclaiming ~ 12–16 px from wide-dock header
  paddings that were dropped 14/20 → 10/14 in SESSION-06 (`wide.css:369`).
- **Wide**: `.wide-playfield-inner` fills its column exactly
  (`wide-panes.spec.js:245-250`); no 9:16 letterbox (Custom Rule 8
  amendment). Left telemetry dock: 320 px minimum implied by the shell.
  Right console dock: 360 px minimum. Middle column absorbs surplus width.
- **Live capture caveat**: this session did not measure in-run rectangles.
  The e2e floors above are the truth-set the next capture pass (SESSION-05
  handoff) must record achieved values against, so SESSION-08 can raise the
  floors.

---

## §5 Height Budget

The budget is per-viewport. Two rules bound every entry:

1. **The 96 px touch floor NEVER moves.** Every `.console-row` /
   `.mode-tab` / `.combat-action` / `.combat-direction` / `.combat-target`
   stays ≥ 96 px in portrait. SESSION-08 will raise `touch-flow.spec.js:152`
   from 48 → 96 (per STATE.md Design Decision 7) so the touch floor becomes
   internally consistent across every visible touchable row.
2. **Every reclaimed pixel is assigned to playfield/map or console content.**
   No reclaimed budget vanishes into padding without a stated purpose.

Height budget targets are ranges — SESSION-05..07 report achieved values in
handoffs, SESSION-08 asserts those achieved values (STATE.md Design Decision
7). If the wide subset gets `chevron-down`+`hash` (§3.16), a further ~ 2 px
per label is captured; if not, the placeholders are already accounted for.

### 5.1 Portrait phone (412 × 915)

| Region | Current px (source) | Target px | Delta reclaimed | Assigned to |
|--------|--------------------|-----------|-----------------|-------------|
| Status strip (explore) | ~ 46 (padding 8×12 + 30 px content, `components.css:1069`) | 40–44 (icon labels absorb the DEPTH/SEED/… inline; strip stays text but tightens gap from 12 → 8) | ~ 2–6 | Playfield (portrait) |
| Status strip (combat) | ~ 78 (2-row grid, `status-strip.js:187`; padding 6×10) | 72–76 (icon-prefixed field labels shave 2 px per row via 8 px letter-spacing) | ~ 2–6 | Playfield (portrait combat) |
| Console tab bar (collapsed) | 96 (min `.mode-tab`, `components.css:94`) | **96 (unchanged)** | 0 (touch floor) | — |
| In-tab `tab-key` badge | 8 px overlay, no height cost | unchanged | 0 | — |
| `expanded-half` tray | 220 min, 32 dvh (`components.css:1170`) | 200 min, 30 dvh (icon-only tabs let content sit closer to the top) | ~ 20 | Console content vertical room |
| `expanded-full` tray | 320 min, 48 dvh (`components.css:1176`) | **320 (unchanged)** — full tray already burns dvh | 0 | — |
| Feedback rail (between playfield & console) | ~ 24 px (portrait), see `screens/combat.js` | 20–24 | ~ 0–4 | Playfield |
| Bottom safe-area padding | ~ 8 px | unchanged | 0 | — |
| **Playfield reclaimed floor** | ≥ 200 (`portrait-usability.spec.js:282`) | **≥ 224 (raise +24)** | +24 | — |
| **Touch-row floor** | ≥ 48 (`touch-flow.spec.js:152`) | **≥ 96 (raise +48)** | 0 (already true; e2e closes gap) | — |

Total reclaimed on portrait phone: **~ 24 px** of vertical playfield, plus
the touch-floor upgrade being asserted rather than aspirational.

### 5.2 Portrait tall (1080 × 1920)

| Region | Current px | Target px | Delta reclaimed | Assigned to |
|--------|-----------|-----------|-----------------|-------------|
| Status strip | ~ 46 (as phone) | 40–44 | ~ 2–6 | Playfield |
| Console tab bar | 96 | **96 (unchanged)** | 0 | — |
| `expanded-half` (32 dvh at 1920 = ~ 614 px, capped 420) | 420 max | **420 (unchanged — cap already dominates)** | 0 | — |
| `expanded-full` (48 dvh = ~ 922, capped 640) | 640 max | **640 (unchanged)** | 0 | — |
| **Playfield reclaimed floor** | ≥ 200 | **≥ 240 (raise +40 — the 1080-wide viewport has more spare vertical budget once the strip tightens)** | +40 | — |

### 5.3 Wide-square (1024 × 1024)

| Region | Current px | Target px | Delta reclaimed | Assigned to |
|--------|-----------|-----------|-----------------|-------------|
| `.wide-console-tabs` column width | 96 (default `.wide-mode-tab` writing-mode `horizontal-tb`, min-height 72; the column WIDTH is the sum of tab-label widths) | 72–80 (icon-only tabs collapse the horizontal write-mode band) | ~ 16–24 | Middle column |
| `.wide-mode-tab` min-height | 72 (`wide.css:333`) | **72 (unchanged — WCAG-safe floor for a vertical tab column)** | 0 | — |
| `.wide-console-content-header` padding | 10 × 14 (`wide.css:369`) | 8 × 12 | ~ 4 | Console content (vertical) |
| Wide telemetry-dock `.wide-telemetry-field` row | ~ 22 (label + value in flex row) | ~ 22 (icon-prefixed already; §3.9) | 0 | — |
| Wide dock width (right console) | ≥ 360 (`wide-panes.spec.js:262`) | **≥ 360 (unchanged; owner-chosen width is user-preference)** | 0 | — |
| Playfield column width | ≥ 320 (`wide-panes.spec.js:252`) | **≥ 320 (unchanged floor); typical width grows by ~ 20 px as the console tab column narrows** | +20 (typical, not floor) | Playfield map |
| **Map/playfield reclaimed floor** | ≥ 320 (already asserted) | **≥ 320 (unchanged; SESSION-08 to add "canvas fills column" invariant if not already covered)** | — | — |

Total wide-square reclamation: ~ 16–24 px of column width to the middle
(playfield/map) column, plus ~ 4 px of vertical room in the wide dock's
content header.

### 5.4 Summary — headline reclaimed pixels per viewport

| Viewport | Vertical reclaimed | Horizontal reclaimed | Where it lands |
|----------|--------------------|-----------------------|-----------------|
| `phone` 412×915 | **~ 24 px** | 0 | Playfield (portrait floor 200 → 224) |
| `portrait` 1080×1920 | **~ 40 px** | 0 | Playfield (portrait floor 200 → 240) |
| `wide-square` 1024×1024 | **~ 4 px** | **~ 16–24 px** | Middle column (map/playfield) + wide-dock content |

The 96 px touch floor holds in every viewport. `.wide-mode-tab` stays ≥ 72 px
per its 2026-08 density pass. No new tokens are minted (§7 flags the token
sheet check-off).

---

## §6 Per-screen notes

Cross-referenced with §2/§3, sequenced by session:

### 6.1 Title (SESSION-04 mocks + CSS; SESSION-06 JS)

- Portrait: primary branch buttons at 46 px sit just above WCAG; if
  SESSION-06 changes their padding to accommodate a 16 px lucide prefix,
  hold the button height ≥ 48 px (better: 52 px). Icons lead the label —
  layout stays two-line-safe on 412 px width.
- Wide: primary + secondary branch strips are rendered inside
  `.wide-title-branches` — SESSION-04 mock must express the new prefix
  slot; SESSION-06 JS should not swap the label to icon-only for the
  named branches (icon+text stays because these are page-level CTAs).
- START stays sanctioned text; wordmark stays proper-noun content. No
  icon on either.
- Retire the tutorial branch was already done — this feature does not
  reintroduce it (`tests/ui/front-door.test.js:271`).

### 6.2 Creation (SESSION-04 mocks; SESSION-06 JS)

- The `◀ BACK` header button goes icon-only. `◈ FINALIZE & DESCEND`
  stays icon+text.
- `− REMOVE`, `DELETE / CONFIRM DELETE`, `CONFIRM CORRUPT EQUIP` all stay
  icon+text with `danger` tone (Custom Rule 14, brief §3 destructive).
- **Attribute steppers are the ceiling.** They are 44 × 44 px today; do NOT
  wrap them in extra label chrome. Docs/accessibility-audit.md §3D flags
  their disabled opacity (`0.30`, → 2.22:1 contrast) — SESSION-06 must NOT
  make the steppers smaller and SHOULD leave the opacity fix to a separate
  session (out of scope for icon-first density).

### 6.3 Library (SESSION-04 mocks; SESSION-07 JS)

- Portrait uses `RESUME` + `DELETE LOCAL STATE`; wide uses `◈ RESUME` +
  `DELETE`. Icon-only for RESUME/`◈ RESUME`, icon+text destructive for
  both DELETE variants.
- `QUARANTINED — <reason>` rows stay text (content). The load-error red
  color already appears — verify it uses `--danger` (allowed as a
  semantic error state per Custom Rule 14).
- Empty state ("No saved living runs…") stays text (content).

### 6.4 Scorecard (SESSION-04 mocks; SESSION-07 JS)

- `COPY WORLD LINK` toggles text on success — `link` icon persists; the
  label swap `COPY WORLD LINK` ↔ `WORLD LINK COPIED` is a value change,
  not chrome. Handle carefully so the aria-label reflects the current
  visible label.
- `RESTART SAME SEED` gets `recycle` (not destructive — restart is a
  sanctioned intent); `NEW RUN` gets `chevron-right`; `TITLE` +
  `LIBRARY` go icon-only.

### 6.5 Import (SESSION-04 mocks; SESSION-07 JS)

- Text-heavy screen; the single primary CTA (`IMPORT`) goes icon-only
  with `download` for accent.
- `RESUME RUN` / `FRESH RUN IN THIS WORLD` stay icon+text — labels tell
  the reader which fallback path fired.

### 6.6 Settings (SESSION-04 mocks; SESSION-06 JS)

- Sliders keep their label / input / value trio verbatim (portrait
  `.wide-settings-body .slider-row` e2e at `portrait-usability.spec.js:468-479`
  depends on the trio not being reordered). Icon prefixes go on TOGGLE rows
  only (MASTER MUTE, GLITCH, SCANLINES & GRAIN, OPERATOR'S MANUAL), never
  on slider labels.
- The layer names (`DRONE`, `PULSE`, `SPARKLE`, `LEAD`, `NOISE BED`) are
  synthesis-layer proper nouns; no icon.
- `BACK` goes icon-only.

### 6.7 In-run screens (exploration + combat) (SESSION-03 mocks + CSS; SESSION-05 JS)

- Own zero buttons themselves — every touchable chrome control lives in the
  console (M60–M67) or the strip/dock (M59). SESSION-03 will touch the
  in-run mocks (`mocks/{exploration,combat}.html`,
  `mocks/wide/{exploration,combat}.html`), and their scan compliance is
  the gate for the JS work in SESSION-05.
- **Dead-region elimination**: `.status-strip-combat` grid at
  `status-strip.js:182-187` uses `4px 8px` gap; SESSION-05 may tighten to
  `2px 6px` in combat (justified by the density payoff and the initiative
  rail already scrolling).
- The `?` manual chip stays text and stays at the trailing edge
  (`status-strip.js:200`).

### 6.8 Console shell + modes (SESSION-03 mocks/CSS + SESSION-05 JS)

- All 7 tabs go icon-only with the numeric badge preserved. Aria labels
  keep the `LABEL · Key N` format (`console.js:164`) — that string is the
  e2e-selector contract per STATE.md Design Decision 2.
- The in-tab `tab-key` badge (`console.js:120`) stays; SESSION-05 must not
  merge it into the icon.
- MOVE mode D-pad is already icon-first; no regression.
- COMBAT direction cells swap arrow characters for the same 8 arrow
  sprites; center `X LEFT` cell stays text (value chip).
- CAST/CAST BLOCKED, TAKE/TAKE BLOCKED, OPEN CONTAINER/OPENED, EQUIP/EQUIP
  BLOCKED, COPY LINK: enabled path is icon-only, disabled path keeps text +
  reason line.
- All destructive actions (JUNK ALL TAGGED, DELETE, UNEQUIP when it clears
  a CORRUPT tag, CONFIRM CORRUPT EQUIP, CONFIRM JUNK ALL TAGGED, − REMOVE)
  stay icon+text with `danger` tone.

---

## §7 Risks

1. **`gauge` used for both `Depth` (wide dock) and `SETTINGS` (title
   secondary branch).** Two different meanings on the same session is a
   legibility hazard. **Mitigation:** SESSION-02 adds `sliders`
   (lucide name: `sliders`) or `settings2` to the subset; if the owner
   declines, keep `gauge` on title SETTINGS and accept the collision —
   context (title screen row vs. telemetry dock label) disambiguates for
   the reader.

2. **Scanner does not scan `styles/icons.css`.** `scripts/design-scan/check-mock-classes.js:4`
   only reads `styles/{base,components,crt,wide}.css`. Any class the mocks
   express that lives in `styles/icons.css` (currently `.icon`,
   `.icon-<size>`, `.icon-<tone>`) would be flagged by the mock-class check
   as missing. **Mitigation:** SESSION-03 extends `PRODUCTION_CSS_FILES`
   to include `styles/icons.css` (STATE.md Wave/W2 already flags this file
   as owned by SESSION-03). Fail-loud: if SESSION-03 misses this, W5 icon
   swaps will trip mock-class errors on the very next `design:scan`.

3. **Contrast on disabled tones (accessibility-audit.md §2D).** `.mode-tab.disabled`
   sits at opacity `0.35` → 2.60:1, below WCAG 4.5:1. Adding a lucide
   glyph inherits `currentColor`, so the same reduced-contrast state
   applies to the icon. **Mitigation:** do NOT apply `tone: 'danger'` to
   disabled buttons; keep the disabled reason ADJACENT (text, in a
   `.disabled-reason` chip that already carries its own opacity).
   Contrast fixes proper are OUT of scope for this feature; document in
   handoff for a follow-up.

4. **`gear.js:434` per-slot `EQUIP <SLOT>` becoming icon-only loses the
   slot name in the visible chrome.** Slot is communicated by the SELECTED
   slot button above (`gear.js:300`, e.g. `Weapon · <item>` `selected`),
   but a screen-reader listener who lost focus context may hear only
   `Equip`. **Mitigation:** aria-label MUST keep the slot: `EQUIP WEAPON`
   / `EQUIP ARMOR` / `EQUIP OFF-HAND` (the aria template is
   `EQUIP ${SLOT_LABELS[ui.slot].toUpperCase()}`, matching the current
   dynamic label verbatim per STATE.md Design Decision 2).

5. **Sanctioned text on destructive icon+text pairings must all use
   `--danger`.** Custom Rule 14 reserves `--danger` red for hostiles AND
   for semantic error/validation states. Destructive actions
   (UNEQUIP, DELETE, JUNK ALL, CONFIRM CORRUPT EQUIP, − REMOVE) already
   fit under Custom Rule 14 as "destructive" exceptions — but the icon
   tone must be applied via `.icon-danger` (via `opts.iconTone = 'danger'`),
   NOT by adding a new red token. Zero new tokens ship in this feature.

6. **CSS `!important` and specificity war.** Historical `.combat-action`
   / `.combat-direction` / `.combat-target` are already at 96 px min-height
   in shared portrait CSS; wide overrides live in `styles/wide.css`. Do
   NOT out-escalate a selector to force an icon-only bare-button width.
   Flatten by structure. Handoff any place that needed `!important` so
   Forge learns the mock/CSS gap.

7. **Ambiguous glyphs (owner-review candidates):**
   - `flame` for combat ITEM action (currently used for `burning`
     condition — reader may associate flame with a condition, not a
     consumable). Backup: `hand-metal` (already in the sprite for
     "grab an item") — SESSION-05 discretion; §3.3 records `flame` as
     the default to match the existing catalog.
   - `download` for creation SAVE CONFIG (implies "download to device")
     — the actual op is "write to localStorage." The metaphor holds
     ("into local storage"); `upload` is arguably closer to "read out"
     (LOAD).
   - `chevron-right` on RESUME rows overloads the same glyph as
     BEGIN/RESUME/NEW RUN. Acceptable — the shared "forward motion"
     semantics is exactly the point.

8. **`portrait-usability.spec.js:290` regex `getByRole` couplings.** The
   test asserts labels equal `['MOVE', 'CMBT', 'PARTY', 'GEAR', 'TECH',
   'LOOT', 'LOG']` by reading `tab.firstChild?.textContent?.trim()`
   (`accessibility.spec.js:94`). Going icon-only replaces the first child
   with an `<svg>`, and `tab.firstChild.textContent` returns `""`. SESSION-05
   MUST update this assertion (it OWNS `tests/e2e/accessibility.spec.js`
   per STATE.md wave 5) to read the accessible name from `aria-label`
   instead of `firstChild`. **Fail-loud**: if the assertion is not
   updated, wave-5 turns red on the very next e2e run.

9. **`docs/accessibility-audit.md` §3F flags the focus-restore bug in the
   route change.** Not fixed by this feature; SESSION-08 must not attempt
   to. Record in handoff if any icon swap tests reveal a new focus
   regression; do not fix in-lease.

10. **The 96 px touch floor never moves.** Any session that reports "I
    shrunk `.mode-tab` to 80" is wrong. `touch-flow.spec.js:152` bumps
    to 96 in SESSION-08 precisely to lock this.

---
