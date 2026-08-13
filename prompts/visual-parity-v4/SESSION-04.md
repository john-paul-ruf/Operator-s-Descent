# SESSION-04 — CRT overlay & effect parity

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M78 (crt.css), M98 (CRT overlay renderer), M53 (glitch system), M54 (grain), M55 (transitions)
> **Depends on:** SESSION-01, SESSION-02
> **Parallel-safe with:** SESSION-03, SESSION-05
> **Estimated effort:** 30 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M78 | `./styles/crt.css` (279 lines) | Full | Owns scanlines, vignette, grille, tracking bars, glitch keyframes. |
| M98 | `./src/glitch/crt-overlays.js` | Full | DOM-injects the overlay divs the CSS animates. |
| M53 | `./src/glitch/glitch.js` | Skim exports | Timer + per-element intensity constants (Custom Rule #5). |
| M54 | `./src/glitch/grain.js` | Skim | Canvas grain — must match mock cadence. |
| M55 | `./src/glitch/transitions.js` | Skim | Boot/descent/death transitions — timing lives here. |
| — | `./mocks/*.html` `<style>` CRT sections | Full | Ground truth for scanline pitch, vignette curve, grille pattern, tracking cadence. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"CRT overlays (S04)" | Full | Target list. |

## Context

The CRT layer is what makes Operator's Descent *feel* like Operator's Descent. Drift here is why "way off" is the user's overall verdict. Common gaps: scanline pitch too coarse, vignette too aggressive at the corners, tracking bar visible when the mock shows it only every N seconds, grille alpha wrong, grain density wrong. Custom Rule #5 states glitch intensity is authoring-time — do not gate it on game state.

This session reconciles the ten overlay layers M98 injects with the ten layers the mocks specify. The overlay *inventory* (how many layers, their names) is fixed at 10 per the module registry entry for M98; the fix is in their CSS parameters, injection order, and animation timings.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./styles/crt.css` | Modify | Reconcile scanline pitch, grille pattern, vignette curve, tracking-bar geometry, glitch keyframe amplitudes. |
| `./src/glitch/crt-overlays.js` | Modify | Fix layer injection order or missing layers; keep the API to M53 stable. |
| `./src/glitch/glitch.js` | Modify (only if the scanner flags it) | Adjust per-element intensity constants to match mock authoring. Do NOT introduce game-state-driven intensity. |
| `./src/glitch/grain.js` | Modify (only if the scanner flags it) | Match density/rate/tint to mock. |
| `./src/glitch/transitions.js` | Modify (only if S14 identifies overlap; usually no changes here) | Left mostly to S14. |
| `./program/operator-s-descent/arch/ui.md` | Modify | Note reconciled overlay parameters. |
| `./tests/glitch/` (existing directory if present) | Modify | If tests assert specific timing constants that no longer match the mock, update them; do not delete assertions. |

## Implementation

### 1. Extract the mock CRT spec

For every mock in `./mocks/`, capture the CSS driving the CRT stack:
- Scanline `background: repeating-linear-gradient(...)` — pitch, colour stops, alpha.
- Vignette `radial-gradient(...)` — centre, colour stops, alpha.
- Grille — pixel pattern, cell size, alpha.
- Tracking bar — height, colour, animation duration, `animation-timing-function`.
- Glitch keyframes — displacement amplitude, colour-channel offsets, chance / cadence.

The mocks may repeat this stack per-file; the ground truth is whichever definition appears identically across ≥ 3 mocks. Where the mocks disagree, pick the most recent (mtime) and log the choice in the handoff note.

### 2. Diff against `./styles/crt.css` and `./src/glitch/crt-overlays.js`

Produce a table in your notes:

| Layer | Prod value (crt.css / overlays.js) | Mock ground truth | Delta |
|-------|-------------------------------------|--------------------|-------|
| Scanline pitch | 3px | 2px | −1px |
| Vignette inner radius | 60% | 55% | −5% |
| Grille cell | 4×4 | 3×3 | −1×−1 |
| Tracking bar cadence | 6s | 8s | +2s |

### 3. Apply edits to `./styles/crt.css`

Update each rule. Preserve custom-property references — if a value should be tunable (typical for pitch, alpha, cadence), promote it to a token in `./styles/base.css` and reference via `var()`. Coordinate with S03's token block if S03 has already landed.

### 4. Apply edits to `./src/glitch/crt-overlays.js`

Read the module first. If layer *count* is wrong (mock has fewer/more overlays than 10), do NOT change the count without user input — set the session to `blocked` and cite the mock. Otherwise: correct the layer *order* and any inline style values. Keep the M53 subscription contract stable.

### 5. Reconcile glitch cadence in `./src/glitch/glitch.js`

Only if the scanner flags per-element intensity or cadence. When you edit, keep constants at authoring-time (Rule #5). Do not introduce a `state.intensity` parameter.

### 6. Update tests if any assert the changed constants

Read `./tests/glitch/*.test.js` (if present). Any test asserting exact millisecond cadences or amplitude values that just changed must be updated to the new values, with a comment `// visual-parity-v4 SESSION-04 — matched to ./mocks/*.html` pointing to the mock line. Do not weaken the assertion (e.g. don't replace an exact value with a range unless the mock itself has a range).

### 7. Document

Append to `./program/operator-s-descent/arch/ui.md` under the CRT section:

```markdown
### CRT overlay reconciliation — 2026-08-12 (visual-parity-v4 SESSION-04)
- Scanline pitch: <old> → <new> (mock ./mocks/exploration.html:LN)
- Vignette curve: <old> → <new> (mock ./mocks/title.html:LN)
- Grille: <old> → <new> …
- Tracking cadence: <old> → <new> …
- Glitch amplitude constants: <deltas> (Rule #5 preserved — authoring-time only).
```

## Verification

- `npx vitest run` — glitch/crt tests pass (updated where noted).
- `node --check ./src/glitch/crt-overlays.js` / `./src/glitch/glitch.js` / `./src/glitch/grain.js` — parse.
- `npm start`, open every screen — the CRT stack looks correct against a mock in a second browser tab. Take one manual side-by-side screenshot of the exploration screen as a sanity check and save to `./prompts/visual-parity-v4/artifacts/parity/exploration-crt-sanity.png`.
- `npm run design:scan` — CRT-category findings strictly decrease vs S01 baseline. Save new output to `./prompts/visual-parity-v4/artifacts/design-scan-after-s04.json`.
- `npm run parity:shots -- --screen exploration` and `--screen combat` — pixel diff against the mock is materially smaller than the S01 baseline in `./prompts/visual-parity-v4/artifacts/parity/`.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-04 → `done`, stamp date.
- Notes: any changed constants, any tests updated (list them), any layers whose count would need to change (blockers).
- Handoff Note: call out any glitch cadence that now conflicts with S14's motion pass (S14 owns final reconciliation).
