# SESSION-09 — Combat screen parity

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M71 (combat screen), M58 (playfield), M59 (status strip), M60 (console shell), M77–M79 (styles)
> **Depends on:** SESSION-02, SESSION-03, SESSION-04, SESSION-05
> **Parallel-safe with:** SESSION-06, SESSION-07, SESSION-08, SESSION-10, SESSION-11
> **Estimated effort:** 25 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M71 | `./src/ui/screens/combat.js` | Full | The screen. |
| M58 | `./src/ui/playfield.js` | Skim | Same renderer as exploration, zoomed. |
| M59 | `./src/ui/status-strip.js` | Skim | Combat-mode strip content is richer (initiative). |
| M60 | `./src/ui/console/console.js` | Skim | COMBAT tab active. |
| — | `./mocks/combat.html` (533 lines) | Full | Ground truth. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Combat (S09)" | Full | Target list. |

## Context

Combat is exploration's twin with a zoomed grid, initiative meter, and richer status strip. Same composition rules — no `.screen-body` scroll; the canvas is bounded. Additional pieces: initiative rail (top-of-screen), action bar (bottom of console COMBAT pane). The action bar itself is S13; this session only wires composition.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/screens/combat.js` | Modify | Reconcile composition with the mock: status strip (combat mode content), initiative rail, playfield container, console COMBAT tab. |
| `./tests/ui/screens/combat.test.js` (if present) | Modify | Update assertions. |
| `./styles/components.css` | Modify (only if `.combat-*` scoped rules need adding) | Confine to `.combat-*`. |

## Implementation

### 1. Read the mock

Focus on: initiative rail position + tokens, status-strip variant content in combat, playfield container size in zoomed mode, action-bar slot in the console.

### 2. Reconcile composition

- Pinned status strip (combat variant).
- Optional initiative rail slot directly under the strip.
- Playfield container (zoomed — different aspect than exploration).
- Pinned console with COMBAT tab active.

### 3. Consume S05 factories

Initiative tokens, action buttons — factory only.

### 4. Do not touch canvas or combat rules

M58 for rendering, M24 for rules — untouched.

### 5. Update tests

DOM composition + initiative rail presence.

## Verification

- `npx vitest run`.
- `node --check ./src/ui/screens/combat.js`.
- `npm start`, enter combat — compare to `./mocks/combat.html`.
- `npm run parity:shots -- --screen combat`.
- `npm run design:scan` — Combat findings resolved.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-09 → `done`, stamp date.
- Notes: initiative rail composition, any canvas-renderer discrepancy (out-of-scope, flag as follow-up).
- Handoff Note: action-bar visual details land in S13 (console COMBAT pane).
