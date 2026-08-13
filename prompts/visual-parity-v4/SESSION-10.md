# SESSION-10 — Library + Scorecard parity + scroll

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M72 (library screen), M73 (scorecard screen), M56 (components), M77–M79 (styles)
> **Depends on:** SESSION-02, SESSION-03, SESSION-04, SESSION-05
> **Parallel-safe with:** SESSION-06, SESSION-07, SESSION-08, SESSION-09, SESSION-11
> **Estimated effort:** 30 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M72 | `./src/ui/screens/library.js` | Full | Run library listing. |
| M73 | `./src/ui/screens/scorecard.js` | Full | Run-end scorecard, share link. |
| M56 | `./src/ui/components.js` | Reference | S05 factories: rows, buttons. |
| — | `./mocks/library.html` (197 lines) | Full | Ground truth for library. |
| — | `./mocks/scorecard.html` (232 lines) | Full | Ground truth for scorecard. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Library" + §"Scorecard" | Full | Target lists. |
| — | `./prompts/visual-parity-v4/artifacts/scroll-audit.md` rows for `library`, `scorecard` | Reference | Both likely need scroll. |

## Context

Both screens are list/table-heavy and expected to exceed portrait height. Both share the pattern: pinned header (screen title + action buttons) → scrolling body of rows/cards → pinned footer (if the mock has one). Two screens in one session because they share the pattern and are small enough (~200-line mocks).

Scorecard also owns share-link generation via M43 — do not touch encode/decode; only the button + preview UI.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/screens/library.js` | Modify | Rebuild DOM per mock. Wrap rows in `createScreenBody({ scroll: true })`. Pin header (title + sort/filter chips + back). |
| `./src/ui/screens/scorecard.js` | Modify | Rebuild DOM per mock. Wrap stats/summary in `createScreenBody({ scroll: true })`. Pin header + footer (copy-link + close). |
| `./tests/ui/screens/library.test.js`, `./tests/ui/screens/scorecard.test.js` (if present) | Modify | Update DOM assertions. |
| `./styles/components.css` | Modify (only if `.library-*` / `.scorecard-*` scoped rules need adding) | Confine namespaces. |

## Implementation

### 1. Read both mocks

Note: header composition, row/card DOM shape, empty-state markup (mock likely shows it), footer for scorecard (share-link block, copy button state).

### 2. Read both current screens

Note: mount signatures, data sources (M45 library for both), event bus wiring.

### 3. Library rebuild

- Pinned header: title, sort chips, back button (factories only).
- `createScreenBody({ scroll: true })` for the row list.
- Each row via a factory (should exist post-S05; if not, add `createLibraryRow` in `./src/ui/components.js` — coordinate with S05's handoff notes).
- Empty state renders inside the scroll body.

### 4. Scorecard rebuild

- Pinned header: title + close.
- `createScreenBody({ scroll: true })` for stats blocks (party summary, run stats, floor progression, notable events).
- Pinned footer: share-link input + copy button. Share-link *generation* stays in M43; button click calls the existing encode helper.

### 5. Preserve scroll on data updates

Same rule as S07: on model updates, targeted re-render only. Do not blow away `.screen-body`.

### 6. Update tests

DOM composition per mock + scroll body presence.

## Verification

- `npx vitest run`.
- `node --check` both screen modules.
- `npm start`, open library (via title → LIBRARY) — compare to `./mocks/library.html`. Scroll works. Open a completed run → scorecard → compare to `./mocks/scorecard.html`. Scroll works, copy link functions.
- `npm run parity:shots -- --screen library` and `--screen scorecard`.
- `npm run design:scan` — Library + Scorecard findings resolved.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-10 → `done`, stamp date.
- Notes: whether `createLibraryRow` / `createScorecardStat` were newly added.
- Handoff Note: any share-link visual state the mock shows but M43 doesn't currently emit (flag as follow-up).
