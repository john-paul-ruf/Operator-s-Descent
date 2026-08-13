# SESSION-11 — Settings + Tutorial + Import parity + scroll

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M74 (import), M75 (tutorial), M76 (settings), M56 (components), M77–M79 (styles)
> **Depends on:** SESSION-02, SESSION-03, SESSION-04, SESSION-05
> **Parallel-safe with:** SESSION-06, SESSION-07, SESSION-08, SESSION-09, SESSION-10
> **Estimated effort:** 30 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M74 | `./src/ui/screens/import.js` | Full | Link import + named failure screens. |
| M75 | `./src/ui/screens/tutorial.js` | Full | Paginated manual. |
| M76 | `./src/ui/screens/settings.js` | Full | Audio sliders, glitch toggle. |
| M56 | `./src/ui/components.js` | Reference | S05 factories: sliders, toggles, buttons, text input. |
| — | `./mocks/import.html`, `./mocks/tutorial.html`, `./mocks/settings.html` | Full | Ground truth. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Settings" + §"Tutorial" + §"Import" | Full | Target lists. |

## Context

Three utility screens grouped because each is small and follows the same header + `.screen-body` pattern. Tutorial is paginated in the mock — the *pagination controls* are pinned; the *page content* scrolls inside a page (a page can be taller than the frame).

Import has multiple named failure states (`truncated`, `version_mismatch`, `checksum_failed`, `malformed` per FORGE-CONFIG error handling) — each must match its mock variant if present.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/screens/settings.js` | Modify | Rebuild per `./mocks/settings.html`. Pinned header, `.screen-body` for slider/toggle list. Consume S05 slider + toggle factories. |
| `./src/ui/screens/tutorial.js` | Modify | Pinned header (title + page indicator), pinned footer (prev/next + jump-to-page), `.screen-body` for current page content. Preserve keyboard nav. |
| `./src/ui/screens/import.js` | Modify | Pinned header, `.screen-body` for input + preview + failure state. Match failure-variant DOM in mock. |
| `./tests/ui/screens/*.test.js` (if present, for these three) | Modify | Update DOM assertions. |
| `./styles/components.css` | Modify (only if `.settings-*` / `.tutorial-*` / `.import-*` scoped rules need adding) | Confine namespaces. |

## Implementation

### 1. Read the mocks

- Settings: layout of slider rows, toggle row, back button.
- Tutorial: pagination controls, page content layout, whether page transitions animate.
- Import: input field, preview block, failure-state variants.

### 2. Read current screens

Note mount signatures, subscriptions, data flow to M45 (settings), M44 (import decode), M75 (tutorial pages).

### 3. Settings rebuild

- Pinned header + back.
- `createScreenBody({ scroll: true })` for slider/toggle rows.
- Every row uses S05 factories.
- Model wire-up unchanged.

### 4. Tutorial rebuild

- Pinned header (title, page N/M).
- `createScreenBody({ scroll: true })` for current page.
- Pinned footer (prev, next, jump).
- On page change: `.replaceChildren` on the body only; reset `scrollTop` to 0 (new page starts at top). Do not blow away the body element itself.

### 5. Import rebuild

- Pinned header.
- `createScreenBody({ scroll: true })` for input + preview + failure block.
- Failure states: read M44's error type names; branch DOM to the matching mock variant. If a mock variant is missing for a named error type, use the closest match and note it in the handoff.

### 6. Update tests

DOM composition per mock + `.screen-body` presence per screen. For tutorial, assert that page change resets scroll to 0.

## Verification

- `npx vitest run`.
- `node --check` all three screen modules.
- `npm start`, walk through each screen — compare to mocks. Scroll behaviour: settings scrolls list, tutorial scrolls current page and resets on prev/next, import scrolls preview.
- Import failure states: paste a truncated / bad-version / bad-checksum / malformed link into the input; the failure variant renders.
- `npm run parity:shots -- --screen settings --screen tutorial --screen import` (or however the tool takes multiple).
- `npm run design:scan` — Settings/Tutorial/Import findings resolved.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-11 → `done`, stamp date.
- Notes: any failure-state variant missing from mocks (flagged for follow-up).
- Handoff Note: tutorial page-reset-to-0 confirmed working.
