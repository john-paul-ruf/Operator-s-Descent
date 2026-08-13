# SESSION-14 — Motion & glitch cadence parity

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M53 (glitch system), M55 (transitions), M78 (crt.css keyframes)
> **Depends on:** SESSION-04, SESSION-06, SESSION-07, SESSION-08, SESSION-09, SESSION-10, SESSION-11, SESSION-12, SESSION-13
> **Estimated effort:** 25 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M53 | `./src/glitch/glitch.js` | Full | Per-element intensity constants (Rule #5). |
| M55 | `./src/glitch/transitions.js` | Full | Boot, descent, death transitions. |
| M78 | `./styles/crt.css` | Skim keyframes | Timings from S04. |
| — | `./mocks/*.html` — animation-duration + keyframe usage | Skim | Ground truth for cadence. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Motion (S14)" | Full | Target list. |

## Context

By this point every screen is structurally correct. What's left is *motion*: transition durations, easing, per-element glitch cadence, scroll-body edge-fade cadence (if any). Rule #5 still binds — no state-driven intensity. This session's only job is to reconcile the numeric constants that drive motion and confirm nothing regressed from S04's authoring.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/glitch/glitch.js` | Modify (only if the GAP-REPORT flags cadence) | Adjust per-element cadence constants. |
| `./src/glitch/transitions.js` | Modify | Reconcile boot/descent/death transition durations + easing with mocks. |
| `./styles/crt.css` | Modify (only if S04 missed a keyframe timing) | Adjust `animation-duration`, `animation-timing-function`. |
| `./tests/glitch/*.test.js` (if present) | Modify | Update timing assertions with mock citations. |

## Implementation

### 1. Extract mock cadence

For every `@keyframes`, `animation`, and `transition` in the mocks, record the property, duration, easing, delay. Group by author intent (boot, descent, death, per-element glitch, tracking bar, grille pulse).

### 2. Diff against prod

Produce a table:

| Motion | Prod value | Mock value | File to edit |
|--------|------------|------------|--------------|
| Boot transition | 900ms ease-out | 1200ms cubic-bezier(...) | `./src/glitch/transitions.js` |
| ... | | | |

### 3. Apply edits

- Transition constants live in `./src/glitch/transitions.js` (authored set-pieces).
- Per-element cadence in `./src/glitch/glitch.js`.
- CSS keyframe durations in `./styles/crt.css`.
- Rule #5: no state parameter.

### 4. Update tests

Any test asserting exact durations updates to new values with mock citation.

## Verification

- `npx vitest run`.
- `node --check` all edited JS modules.
- `npm start`, trigger each transition (start run → boot; descend a floor → descent; die → death). Cadence feels like the mock's animations.
- `npm run design:scan` — Motion findings resolved.
- `npm run parity:shots -- --all` — save output; will be the input for S15's verification.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-14 → `done`, stamp date.
- Notes: deltas applied.
- Handoff Note: nothing left except S15 verification.
