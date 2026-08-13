# SESSION-08 — Exploration screen parity

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M70 (exploration screen), M58 (playfield), M59 (status strip), M60 (console shell), M77–M79 (styles)
> **Depends on:** SESSION-02, SESSION-03, SESSION-04, SESSION-05
> **Parallel-safe with:** SESSION-06, SESSION-07, SESSION-09, SESSION-10, SESSION-11 (S12 does the console shell separately, but the exploration screen doesn't own the shell)
> **Estimated effort:** 30 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M70 | `./src/ui/screens/exploration.js` | Full | The screen. |
| M58 | `./src/ui/playfield.js` | Skim | Canvas renderer — this session composes it, does not modify the renderer. |
| M59 | `./src/ui/status-strip.js` | Skim | Pinned strip. |
| M60 | `./src/ui/console/console.js` | Skim | Pinned console. Do NOT restructure it here (owned by S12). |
| — | `./mocks/exploration.html` (866 lines — the largest mock; take your time) | Full | Ground truth. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Exploration (S08)" | Full | Target list. |

## Context

Exploration is the workhorse screen: status strip on top, playfield (canvas) in the middle, console with MOVE mode active at the bottom. The mock is 866 lines — most of it is the CRT stack + console markup that S04/S12 cover. This session's job is the *composition*: the three pinned regions in correct proportions, the playfield container sized correctly for the canvas at 1080 wide, and any exploration-scoped chrome (mini-map affordance, floor label, depth ticker) matching the mock.

**Playfield renderer (M58) is out of scope.** If the compliance scanner flags the canvas rendering itself, that's a separate follow-up session.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/screens/exploration.js` | Modify | Reconcile layout composition (status strip + playfield container + console) with the mock. Sizes, gaps, floor label, depth ticker DOM. Do NOT re-mount M58's canvas element on model updates. |
| `./tests/ui/screens/exploration.test.js` (if present) | Modify | Update DOM assertions. |
| `./styles/components.css` | Modify (only if `.exploration-*` scoped rules need adding) | Confine to `.exploration-*` namespace. |

## Implementation

### 1. Read the mock

Focus on the layout scaffolding (not the CRT stack — S04 owns that). Note: strip height, console height (collapsed vs expanded), playfield container aspect ratio, any labels/tickers outside the canvas.

### 2. Reconcile the screen composition

- Outer: pinned strip (M59) → playfield container → pinned console (M60).
- The playfield container is the flex-child that gets whatever space is left. No `.screen-body` scroll here — exploration should never scroll (the canvas is its own bounded region).
- Ensure the canvas element's parent has the correct aspect ratio at 1080 wide so the lattice (20×32) doesn't distort.

### 3. Consume S05 factories

Any labels, buttons, or ticker components use S05 factories. Do not inline DOM that a factory exists for.

### 4. Do not touch canvas rendering

If M58 draws lattice / grain / cover, that stays in M58. This session only sizes and positions M58's canvas element correctly.

### 5. Update tests

Assert layout composition (strip pinned, console pinned, canvas parent has correct aspect ratio class). Do not add pixel-perfect assertions — that's parity-shot territory.

## Verification

- `npx vitest run`.
- `node --check ./src/ui/screens/exploration.js`.
- `npm start`, load a run, enter exploration — compare to `./mocks/exploration.html`. Canvas is square-ish (matches lattice), strip pinned, console MOVE tab active.
- `npm run parity:shots -- --screen exploration`.
- `npm run design:scan` — Exploration composition findings resolved.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-08 → `done`, stamp date.
- Notes: any canvas-renderer discrepancy noticed but out-of-scope (flag as follow-up).
- Handoff Note: mention console MOVE mode composition is verified alongside; deep MOVE pane work happens in S13.
