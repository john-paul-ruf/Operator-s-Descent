# SESSION-06 — Title screen parity

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M68 (title screen), M77–M79 (styles), M56 (components)
> **Depends on:** SESSION-02, SESSION-03, SESSION-04, SESSION-05
> **Parallel-safe with:** SESSION-07, SESSION-08, SESSION-09, SESSION-10, SESSION-11
> **Estimated effort:** 25 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M68 | `./src/ui/screens/title.js` | Full | The screen module. |
| M56 | `./src/ui/components.js` | Reference | Consume the S05-reconciled factories. |
| M77 | `./styles/base.css` | Reference | Tokens from S03. |
| M78 | `./styles/crt.css` | Reference | Overlays from S04. |
| M79 | `./styles/components.css` | Reference | `.screen-body` from S02 + components from S05. |
| — | `./mocks/title.html` (393 lines) | Full | Ground truth. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Title (S06)" | Full | Target list. |
| — | `./prompts/visual-parity-v4/artifacts/scroll-audit.md` row for `title` | Reference | Confirm whether the body scrolls. |

## Context

`./mocks/title.html` is a single-state screen per Rule #10 (dropped-gate rule from v2 SESSION-03). START toggles the branch list on the same page — do NOT re-introduce a two-state title. Content typically fits (`.screen-body--no-scroll` opt-out likely correct); confirm via `scroll-audit.md`.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/screens/title.js` | Modify | Restructure DOM to match `./mocks/title.html`. Use `createScreenBody({ scroll: <audit result> })` from M56. Consume S05 button/tab factories. |
| `./tests/ui/screens/title.test.js` (if present) | Modify | Update DOM/class assertions. |

Do **not** modify `./styles/*.css` here — token/component fixes belong to S03/S05. If a title-only style is needed, add a `.screen-title` scoped block to `./styles/components.css` and note it in the handoff.

## Implementation

### 1. Read the mock end-to-end

Understand: element hierarchy, class names, order of branch entries after START (new run / library / import / tutorial / settings), footer content (copyright, build hash?), any glitch triggers.

### 2. Read the current `./src/ui/screens/title.js`

Note: mount function name, event bus subscriptions, START handler, teardown.

### 3. Rewrite the mount DOM

- Preserve public API (whatever `main.js` M82 imports must still work).
- Use `createScreenBody({ scroll: false })` when audit confirms fit; `{ scroll: true }` otherwise.
- Match mock element hierarchy: outer frame is provided by index.html; title's DOM starts at the first child of the screen slot.
- Class names must match the mock (subject to S05 renames).

### 4. Wire START behaviour

- Single click reveals the branch list *in place* (no new screen). Match the mock's animation cadence.
- Each branch item is a factory-built button; click emits the appropriate bus event.

### 5. Update tests

Any test that asserted a two-state title or old class names must be updated to the single-state DOM. Do not delete assertions.

## Verification

- `npx vitest run` — title tests pass.
- `node --check ./src/ui/screens/title.js`.
- `npm start`, load `/`, compare to `./mocks/title.html` open in a second tab — visual match at 1080 wide.
- `npm run parity:shots -- --screen title` — pixel diff materially smaller than S01 baseline. Save to `./prompts/visual-parity-v4/artifacts/parity/title-after.png`.
- `npm run design:scan` — Title-related findings resolved (compare to S01 baseline).
- Manual keyboard: Enter on title screen triggers START; branch list is keyboard-navigable per M57.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-06 → `done`, stamp date.
- Notes: whether `.screen-body--no-scroll` was used or full scroll was enabled.
- Handoff Note: any glitch-cadence quirk observed that S14 should verify.
