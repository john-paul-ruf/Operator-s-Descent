# SESSION-12 — Console shell parity

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M60 (console shell), M79 (components CSS), M56 (components), M34 (event bus — read only)
> **Depends on:** SESSION-02, SESSION-03, SESSION-04, SESSION-05
> **Blocks:** SESSION-13
> **Estimated effort:** 25 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M60 | `./src/ui/console/console.js` | Full | The shell — owns tab bar, expand/collapse, routing to mode panes. |
| M56 | `./src/ui/components.js` | Reference | S05 tab factory. |
| M79 | `./styles/components.css` | Reference | Shell CSS: `.console-shell`, `.console-tab-bar`, `.console-body`. |
| M34 | `./src/state/bus.js` | Skim | Bus events the shell emits (`ui:mode-change`). Do not change events. |
| — | `./mocks/exploration.html` + `./mocks/combat.html` + `./mocks/console-*.html` — the console region across all of them | Full | Ground truth. The console region is copied across mocks; compare and pick the newest identical spec. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Console shell (S12)" | Full | Target list. |

## Context

The console is the 7-tab bar (MOVE / COMBAT / PARTY / GEAR / TECH / LOOT / LOG) plus a body that renders the active mode's pane. It pins to the bottom of exploration + combat screens and floats standalone in the tab-focused mocks. This session fixes the *shell* — tab bar layout, active/inactive/disabled states, expand/collapse control, body container that mode panes mount into. The panes themselves are S13.

`.console-body` here is the shell's inner container for the active pane's content. Individual pane bodies (S13) may use `.screen-body` internally if their content overflows.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/console/console.js` | Modify | Rebuild shell DOM per mock. Consume S05 tab factory. Preserve routing + bus events. |
| `./styles/components.css` | Modify | Reconcile `.console-shell`, `.console-tab-bar`, `.console-tab`, `.console-body`, expand/collapse states. |
| `./tests/ui/console/console.test.js` (if present) | Modify | Update DOM + tab-state assertions. |
| `./program/operator-s-descent/arch/ui.md` | Modify | Update console section with any DOM/class changes. |

## Implementation

### 1. Read the console region across mocks

Extract the shell markup from `./mocks/exploration.html`, `./mocks/combat.html`, and each `./mocks/console-*.html`. Confirm they agree — where they don't, pick the newest mtime and log the choice.

### 2. Read `./src/ui/console/console.js`

Note: mount signature, mode registry (how it looks up panes by mode string), bus events, expand/collapse mechanism, teardown.

### 3. Rebuild shell DOM

- Outer: `.console-shell` with expand/collapse toggle.
- Tab bar: `.console-tab-bar` with 7 tabs, active tab marked (`aria-selected="true"` per S05).
- Body: `.console-body` — the mode pane mounts into this.
- Preserve every bus event and mode registry key.

### 4. Reconcile CSS

Match mock: shell height (collapsed vs expanded), tab dimensions, active-tab affordance, hover/focus/disabled states, body inset.

### 5. Update tests

Assert tab bar has 7 tabs, correct classes on active/inactive, expand/collapse toggles a documented class, mode-change emits `ui:mode-change`.

### 6. Document

Update `./program/operator-s-descent/arch/ui.md` console section with the reconciled class names and expand/collapse contract.

## Verification

- `npx vitest run`.
- `node --check ./src/ui/console/console.js`.
- `npm start`, enter exploration — console shell matches mock. Tab through the 7 tabs; active tab affordance correct.
- `npm run parity:shots -- --screen exploration --screen combat` — shell portion visually matches.
- `npm run design:scan` — Console-shell findings resolved.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-12 → `done`, stamp date.
- Notes: shell DOM class changes (list them so S13 uses correct selectors).
- Handoff Note: any bus event whose contract needed a note; confirm mode registry keys unchanged.
