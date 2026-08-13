# SESSION-07 — Creation screen parity + scroll

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M69 (creation screen), M92 (creation model), M56 (components), M77–M79 (styles)
> **Depends on:** SESSION-02, SESSION-03, SESSION-04, SESSION-05
> **Parallel-safe with:** SESSION-06, SESSION-08, SESSION-09, SESSION-10, SESSION-11
> **Estimated effort:** 30 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M69 | `./src/ui/screens/creation.js` | Full | The screen module. |
| M92 | `./src/ui/creation-model.js` | Skim | Pure 80-point-buy model — do not modify unless the mock changes the buy math. |
| M56 | `./src/ui/components.js` | Reference | S05 factories: sliders, cards, buttons. |
| M77 | `./styles/base.css` | Reference | Tokens (S03). |
| M79 | `./styles/components.css` | Reference | `.screen-body` (S02), components (S05). |
| — | `./mocks/creation.html` (544 lines) | Full | Ground truth. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Creation (S07)" | Full | Target list. |
| — | `./prompts/visual-parity-v4/artifacts/scroll-audit.md` row for `creation` | Reference | Almost certainly needs scroll — confirm. |

## Context

Creation is the 80-point buy party builder — 3 members × class × attributes × starting kit × protocols. Content reliably exceeds portrait height. This session brings the DOM to mock parity AND wraps the body in `.screen-body` so the header (title + points remaining + start button strip) stays visible while attributes/protocols scroll.

The buy math lives in M92 and is pure — do not touch it. This session is presentation-only unless the mock shows a new interaction the current model can't support (in which case, `blocked` and cite the mock).

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/screens/creation.js` | Modify | Rebuild DOM to match mock. Wrap the scrollable region in `createScreenBody({ scroll: true })`. Pin the point-budget header + start button strip *outside* the scroll body. |
| `./tests/ui/screens/creation.test.js` (if present) | Modify | Update DOM assertions. |
| `./styles/components.css` | Modify (only if a `.creation-*` scoped rule needs adding) | Confine additions to `.creation-*` namespace to avoid leaking into other screens. |

Do **not** modify `./src/ui/creation-model.js`.

## Implementation

### 1. Read the mock

Understand section order: header (points remaining, party-selector chips) → per-member column (class picker, attribute sliders, starting kit, protocol deck) → footer (save config / start run). Note which region scrolls in the mock and which stays pinned.

### 2. Read the current screen module

Identify: mount function, subscriptions, event handlers, teardown. Note where DOM is built and where reactive updates happen (subscribing to model changes).

### 3. Restructure DOM

- Outer layout (inside the frame slot):
  1. Pinned header (points + party chips + save/start buttons).
  2. `createScreenBody({ scroll: true })` containing the scrolling per-member columns.
- Preserve reactive wiring: every re-render must target the correct sub-region (do not blow away the scroll container on model updates, or scroll position resets).
- Consume S05 factories for sliders, buttons, cards.

### 4. Preserve scroll position on model updates

When the model changes (attribute slider tweak, class switch), only re-render the affected region — do NOT replace `.screen-body`'s children wholesale. Use a keyed diff or targeted `.replaceChildren` on the sub-region only. If the current architecture forces a full re-render, capture `.scrollTop` before and restore after.

### 5. Wire keyboard behaviour

Match mock: Tab moves between sliders, ←/→ adjusts value, Enter saves, Esc returns to title. Confirm M57 input already handles most of this; if not, subscribe in `mount()`.

### 6. Update tests

Update DOM assertions. Add a regression test asserting `.screen-body` exists and receives the expected children.

## Verification

- `npx vitest run` — creation + model tests pass.
- `node --check ./src/ui/screens/creation.js`.
- `npm start`, load creation screen, compare to `./mocks/creation.html` — visual match. Scroll the body — header stays pinned, no viewport reflow, momentum on touch.
- Adjust a slider — scroll position preserved.
- `npm run parity:shots -- --screen creation`. Save output.
- `npm run design:scan` — Creation-related findings resolved.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-07 → `done`, stamp date.
- Notes: how re-render preserves scroll (targeted or scrollTop-restore).
- Handoff Note: any interaction the mock demonstrates that M92 doesn't currently model (should be zero — flag if not).
