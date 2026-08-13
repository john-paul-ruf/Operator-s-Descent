# SESSION-05 — Shared components parity

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M56 (UI components factory), M79 (components CSS)
> **Depends on:** SESSION-01, SESSION-02, SESSION-03 (tokens must be reconciled first)
> **Parallel-safe with:** SESSION-04
> **Estimated effort:** 30 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M56 | `./src/ui/components.js` | Full | Owns every shared factory the screens call. |
| M79 | `./styles/components.css` | Full (~1400 lines) | Owns the matching CSS. Sections are typically headed by comment banners. |
| M77 | `./styles/base.css` | Reference | Tokens the components must reference. |
| — | `./mocks/*.html` — every button, tab, card, slider, progress bar, meter | Skim | Ground truth per component. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Shared components (S05)" | Full | Target list. |

## Context

The mocks use a small vocabulary of components repeatedly: primary/secondary/danger buttons, mode tabs, slot cards, key-value rows, sliders, bars (HP/CHARGE/GLITCH), toggles, and text inputs. Prod exists but has drifted — corners too round, borders too thick, hover states missing, focus rings inconsistent, disabled states not rendered. This session brings each shared component to parity with its most-recent mock authoring, once, so that per-screen sessions (S06–S13) just use the corrected factories.

Do **not** add new component variants that the mocks don't demonstrate. If a screen session later needs a variant that doesn't exist, that's a follow-up session, not scope creep here.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/components.js` | Modify | Fix each factory that the GAP-REPORT flags: DOM shape (missing wrapper?), class names, ARIA attributes, event wiring. Add opt-in variants only when the mock demonstrates one. |
| `./styles/components.css` | Modify | Reconcile each component's CSS section against the mocks: sizing, spacing, borders, radii, hover/focus/disabled states, active/selected states. |
| `./tests/ui/components.test.js` (if present) | Modify | Update assertions for changed DOM shape or class names. Do NOT loosen assertions. |
| `./program/operator-s-descent/arch/ui.md` | Modify | Update the components inventory table with any new variants. |

## Implementation

### 1. Inventory the mock component set

Walk `./mocks/*.html` and record every shared component with the class or Tailwind-utility signature it uses. Group by kind:

- **Buttons** — primary, secondary, danger, ghost, icon-only. Each with hover/focus/active/disabled.
- **Tabs** — the console's 7-tab bar, plus any secondary tabs (creation subsections?).
- **Cards** — slot card, loot card, party-member card, protocol card.
- **Rows** — key-value row (stat row), log row, inventory row.
- **Sliders** — audio sliders in settings, point-buy sliders in creation.
- **Bars / meters** — HP, CHARGE, GLITCH, initiative meter.
- **Toggles** — glitch toggle, audio mute.
- **Inputs** — text (import screen), select-like (creation subsections).

Add anything you find that the GAP-REPORT missed to a new bullet in your working notes.

### 2. Diff each component's factory + CSS

For each item in the inventory, produce three findings in your notes:

- **DOM shape delta** — what wrappers, siblings, or attributes the factory outputs vs the mock.
- **CSS delta** — spacing, size, border, radius, state styles.
- **Interaction delta** — hover, focus, active, disabled, keyboard behaviour (Enter, Space, Arrow for tabs).

Cross-check against `./prompts/visual-parity-v4/artifacts/design-scan.json` for anything the scanner surfaced.

### 3. Apply DOM/factory edits to `./src/ui/components.js`

Read the file first. For each factory:
- Match the mock's DOM shape exactly (element tags, class names, `data-*` attributes).
- Preserve the existing exported name and signature. If the signature genuinely must change (e.g. options object gains a new key), add the key with a default that preserves current behaviour.
- Attach ARIA where the mock demonstrates it (`role="tab"`, `aria-selected`, `aria-disabled`, `aria-valuenow`).
- Keep factories pure returns — no side effects, no globals.

If the mock demonstrates a new variant (e.g. `.btn--danger`), add it as an option (`kind: 'danger'`) — do not create a separate factory.

### 4. Apply CSS edits to `./styles/components.css`

Reconcile each section's block. Use tokens from S03. Preserve selector order and specificity — do not restructure the file; only re-tune values and add missing state rules (`:hover`, `:focus-visible`, `:active`, `[disabled]`, `[aria-selected="true"]`).

If a component's *class name* is wrong vs the mock (e.g. mock uses `.tab-mode` but prod uses `.mode-tab`), rename the class in BOTH the factory and the CSS in the same edit. `grep -R` for any other reference and update. Add a one-line comment `/* renamed from .old-name in visual-parity-v4 SESSION-05 */` in the CSS.

### 5. Update `./tests/ui/components.test.js` (if present)

Update DOM-shape and class-name assertions to match. Do not weaken; add assertions for newly-added ARIA where the mock demonstrates it.

### 6. Update `./program/operator-s-descent/arch/ui.md`

Ensure the components table lists every factory with its exported name, class root, and variants. Bump the "Last reconciled" date to today.

## Verification

- `npx vitest run` — component tests pass.
- `node --check ./src/ui/components.js`.
- `npm start`, then open each console pane mock (`./mocks/console-*.html`) alongside the running app's equivalent panel — buttons, tabs, cards look identical at the component level (per-screen composition may still be off — that's S06–S13's job).
- `npm run design:scan` — Components-category findings strictly decrease. Save output to `./prompts/visual-parity-v4/artifacts/design-scan-after-s05.json`.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-05 → `done`, stamp date.
- Notes: any factory signature changes (list them so per-screen sessions can migrate), any renamed classes.
- Handoff Note: if any screen-session's mock references a factory that was renamed here, flag which screens need the rename applied when their session runs.
