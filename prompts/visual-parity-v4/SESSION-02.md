# SESSION-02 — Scroll-container architecture (`.screen-body`)

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M77 (base CSS), M79 (components CSS), M56 (UI components factory), M82 (main entry — wiring only if a screen re-mount is needed)
> **Depends on:** SESSION-01
> **Estimated effort:** 25 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M77 | `./styles/base.css` | Full (339 lines) | Owns the portrait frame, letterbox, palette tokens. New scroll rules must slot in without overriding letterboxing. |
| M79 | `./styles/components.css` | Full (~1400 lines) | Owns `.status-strip`, `.console-shell`, and any existing screen container classes. New `.screen-body` lives here. |
| M56 | `./src/ui/components.js` | Skim exports | If existing factories mount a `.screen-content` (or similar), the new class name must be consistent — either extend or alias, do not fork. |
| M59 | `./src/ui/status-strip.js` | Skim | Confirm the strip is `position: sticky` / `position: fixed` — the scroll body must scroll *under* it, not push it off-screen. |
| M60 | `./src/ui/console/console.js` | Skim | Same concern for the console pinned at the bottom of exploration/combat. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Scroll architecture (S02)" | Full | Absolute source of truth for what this session must fix. |
| — | `./prompts/visual-parity-v4/artifacts/scroll-audit.md` | Full | Confirms which screens actually overflow. |

## Context

Custom Rule #8 mandates a fixed 1080×1920 portrait canvas letterboxed on larger viewports — the viewport itself never reflows. Several screens (creation, library, scorecard, tutorial, log, gear) have content that legitimately exceeds 1920px and is currently either clipped or squashed. This session introduces a single, reusable **`.screen-body`** container that lives inside the portrait frame, sits between the status strip and the console (or occupies the full non-strip area on screens without a console), and scrolls internally.

The scroll container has to look native to the CRT aesthetic: custom scrollbar styling, top/bottom edge fades so content dissolves into the vignette instead of hard-clipping, momentum on touch. It also has to remain a no-op when content fits — an empty title screen must not show scroll affordances.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./styles/components.css` | Modify | Add `.screen-body { ... }` block, its scrollbar styles, edge-fade mask, and a `.screen-body--no-scroll` opt-out modifier. |
| `./styles/base.css` | Modify | Add `--screen-body-fade` and `--scrollbar-*` custom properties. |
| `./src/ui/components.js` | Modify | Export `createScreenBody({ scroll = true } = {})` returning a `<div class="screen-body">` element (with `--no-scroll` modifier when `scroll: false`). Existing factories that manually build the scroll region migrate to this in later sessions — do not modify screen modules here. |
| `./program/operator-s-descent/arch/ui.md` | Modify | Add a "Screen body scroll container" subsection documenting the class, tokens, and factory. |

Do **not** touch `./src/ui/screens/*`, `./src/ui/console/*`, or `./index.html` in this session — screen migration is the per-screen sessions' responsibility.

## Implementation

### 1. Read the existing frame + strip + console CSS

Before adding anything, read:
- `./styles/base.css` — find the `.portrait-frame` (or equivalent) rule, note its `width`, `height`, and any `overflow` value.
- `./styles/components.css` — find the `.status-strip` selector and its positioning; find the `.console-shell` selector and confirm bottom pinning.

Record the current selector names in a comment in your working notes — the new `.screen-body` rules must reference them correctly (e.g. `.screen-body` height calc subtracts strip + console heights).

### 2. Add tokens to `./styles/base.css`

Under the existing `:root { ... }` custom-property block, add:

```css
:root {
  /* Scroll body — visual-parity-v4 */
  --screen-body-fade: 32px;                        /* edge-fade mask height */
  --scrollbar-track: transparent;
  --scrollbar-thumb: color-mix(in oklab, var(--accent) 40%, transparent);
  --scrollbar-thumb-hover: color-mix(in oklab, var(--accent) 70%, transparent);
  --scrollbar-width: 6px;
}
```

Adjust the actual token names to match the existing base.css palette (`--accent` is a placeholder — use whatever is defined). Values must be tunable in one place.

### 3. Add `.screen-body` to `./styles/components.css`

```css
/* Screen body — scrollable region between status strip and console.
   visual-parity-v4 SESSION-02. */
.screen-body {
  flex: 1 1 auto;
  min-height: 0;                         /* critical: enables scroll inside flex parent */
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;          /* stops iOS rubber-band leaking to page */
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  /* Top + bottom edge fade so content dissolves into vignette */
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--screen-body-fade),
    #000 calc(100% - var(--screen-body-fade)),
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--screen-body-fade),
    #000 calc(100% - var(--screen-body-fade)),
    transparent 100%
  );
}

.screen-body::-webkit-scrollbar {
  width: var(--scrollbar-width);
}
.screen-body::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}
.screen-body::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 999px;
}
.screen-body::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

/* Opt out — use when content is known to always fit (e.g. title). */
.screen-body--no-scroll {
  overflow: hidden;
  mask-image: none;
  -webkit-mask-image: none;
}
```

### 4. Add the factory to `./src/ui/components.js`

Read the file first, follow its existing factory style (arrow returning a DOM node, no classes). Append:

```js
/**
 * createScreenBody — scrollable region between status strip and console.
 * visual-parity-v4 SESSION-02.
 *
 * @param {{scroll?: boolean, className?: string}} [opts]
 * @returns {HTMLDivElement}
 */
export const createScreenBody = ({ scroll = true, className = '' } = {}) => {
  const el = document.createElement('div');
  el.className = ['screen-body', scroll ? '' : 'screen-body--no-scroll', className]
    .filter(Boolean)
    .join(' ');
  return el;
};
```

If a factory with a colliding purpose already exists (e.g. `createScreenContent`), do **not** delete it — leave a JSDoc `@deprecated` note pointing to `createScreenBody` so per-screen sessions can migrate cleanly. Do not migrate call-sites here.

### 5. Document in `./program/operator-s-descent/arch/ui.md`

Append a subsection:

```markdown
## Screen body scroll container (visual-parity-v4)

- **Class:** `.screen-body` (M79 `./styles/components.css`)
- **Factory:** `createScreenBody({ scroll = true })` in M56 `./src/ui/components.js`
- **Tokens:** `--screen-body-fade`, `--scrollbar-track`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-width` in M77 `./styles/base.css`
- **Contract:** lives inside the portrait frame, sits between the pinned status strip (M59) and the pinned console (M60, when present); flex-child with `min-height: 0` to enable internal scroll; masks its top/bottom edges to dissolve into the CRT vignette.
- **Opt-out modifier:** `.screen-body--no-scroll` for screens whose content is known to fit (e.g. title).
- **Rule #8 compatibility:** the viewport still never reflows; only this container scrolls.
```

## Verification

- `npx vitest run` — nothing should break (this session adds only new exports and new CSS classes).
- `node --check ./src/ui/components.js` — parses cleanly.
- `npm start`, then in the browser open the title screen and every currently-shipping screen, confirm none of them have visually changed (the new class is not yet applied to any screen; per-screen sessions do that).
- Manual DevTools check: `document.styleSheets` includes the new `.screen-body` rule and the new custom properties resolve on `:root`.
- `npm run design:scan` — no *new* violations vs. the S01 baseline captured in `./prompts/visual-parity-v4/artifacts/design-scan.json`. (This session may resolve some findings tagged "scroll architecture missing" and should not introduce any new ones.)

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-02 → `done`, stamp date.
- Notes: exact selector names used for `.status-strip` and `.console-shell` in the height calc (so per-screen sessions know what to compose with).
- Handoff Note: list the exact factory signature added and the CSS custom-property names, so per-screen sessions cite them verbatim.
