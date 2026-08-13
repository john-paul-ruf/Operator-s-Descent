# SESSION-03 — Design tokens & typography reconciliation

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M77 (base CSS), M79 (components CSS), M97 (compliance scanner — read only, used for verification)
> **Depends on:** SESSION-01, SESSION-02
> **Parallel-safe with:** SESSION-04, SESSION-05 (different files)
> **Estimated effort:** 30 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M77 | `./styles/base.css` | Full | Owns `:root` palette + type tokens. Every diff lands here or in M79. |
| M79 | `./styles/components.css` | Skim for tokens used | Tokens must remain referenced only through `var(--name)`, never hard-coded. |
| — | `./specs/design.md` | Full | Canonical token definitions per FORGE-CONFIG Documentation. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Tokens & typography (S03)" | Full | Target list for this session. |
| — | `./mocks/*.html` `<style>` blocks + Tailwind arbitrary values (`text-[13px]`, `tracking-[.14em]`, etc.) | Skim | Source of truth for what the mocks actually render. |
| — | `./prompts/visual-parity-v4/artifacts/design-scan.json` | Grep | Machine-generated token/typography mismatches. |

## Context

The mocks are Tailwind (Rule #3) with a mix of standard utilities and arbitrary values. `specs/design.md` was the intended source of truth, but drift has crept in: M97 flags palette values, letter-spacing, line-height, and type-scale mismatches. This session reconciles `./styles/base.css` tokens with what the mocks *actually* render, and fixes references in `./styles/components.css` so hard-coded colours or sizes flow through tokens.

**Nothing else changes.** No screen module, no console module, no HTML. If a token change would visibly break a screen, that visible fix belongs to the screen's session (S06–S11) which will consume the corrected token.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./styles/base.css` | Modify | Reconcile `:root` tokens: palette, type scale, tracking, line-height, weight, spacing scale. Add tokens the mocks use but base is missing. Do not remove tokens still referenced elsewhere. |
| `./styles/components.css` | Modify | Replace any hard-coded colour/size the scanner flagged with the corresponding token. Do not restructure selectors. |
| `./specs/design.md` | Modify | Update the tokens table to reflect the reconciled values. Cite mock sources for anything changed. |
| `./program/operator-s-descent/arch/ui.md` | Modify (append) | Note the reconciliation date and any deprecated tokens. |

## Implementation

### 1. Extract mock ground-truth

For each mock in `./mocks/`, pull the `<style>` block (if any) and the arbitrary-value Tailwind utilities into a single scratchpad. Group by dimension:

- **Colours** — every hex, rgb, oklch, or `var()` reference the mock uses.
- **Typography** — font-family, size, weight, tracking, line-height per element role (title, section header, body, caption, mono, sigil).
- **Spacing** — the spacing scale actually used (which `p-*`, `m-*`, `gap-*` values dominate; convert to px).
- **Borders / radii / shadows** — border widths, corner radii, shadow definitions.

You are NOT trying to match every one-off value; you are extracting the *scale* the mocks converge on. Where a mock uses `text-[13px]` twice and `text-[14px]` once, the token is `13px`.

### 2. Diff against `./styles/base.css`

For every token role, produce a three-column mapping in your working notes:

| Role | Current `base.css` token & value | Mock ground truth | Action |
|------|-----------------------------------|--------------------|--------|
| body font-size | `--text-body: 15px;` | `13px` | update value |
| heading tracking | *(missing)* | `.14em` | add token |
| dim text | hard-coded `#7a7a7a` in components.css:412 | `var(--text-muted)` should be `#6b6b6b` | update both |

The scanner (M97) already produces most of this — cross-check its output against your manual pass.

### 3. Apply edits to `./styles/base.css`

Update the `:root` block. Preserve token names when possible (renaming forces per-screen sessions to update). For genuinely new tokens, follow the existing naming convention (kebab-case, prefixed by category: `--text-*`, `--bg-*`, `--accent-*`, `--space-*`, `--radius-*`, `--tracking-*`, `--leading-*`, `--weight-*`).

Do **not** delete tokens that are still referenced elsewhere — `grep -R "var(--old-token)" ./styles ./src` before removing anything. Mark tokens no longer used by mocks but still referenced in prod code as `/* deprecated visual-parity-v4 SESSION-03 — remove when M69/M70/... migrate */` and leave them defined; downstream screen sessions will clean up.

### 4. Replace hard-coded values in `./styles/components.css`

For each finding in `GAP-REPORT.md` §"Tokens & typography (S03)" that points at `./styles/components.css`, replace the literal with `var(--token)`. Do not otherwise restructure the file — selector order and specificity must not change.

### 5. Update `./specs/design.md`

Update the tokens table to reflect the new `:root` block. In a "Change log" section at the bottom, append:

```markdown
### 2026-08-12 — visual-parity-v4 SESSION-03
- Reconciled palette/typography tokens with `./mocks/*.html`.
- <bullet per material change with mock citation>
```

### 6. Update `./program/operator-s-descent/arch/ui.md`

Append a one-paragraph note under the tokens section describing the reconciliation and pointing at `./specs/design.md`'s change-log entry.

## Verification

- `node --check` is not applicable (CSS). Instead, `npm start` and open every currently-shipping screen — nothing should visibly regress. Some *improvements* may appear (e.g. font-size correct on library rows) because components.css picked up the reconciled token via `var()`.
- `npx vitest run` — passes (no JS touched).
- `npm run design:scan` — the "Tokens & typography" category count in the report should strictly decrease vs. the S01 baseline in `./prompts/visual-parity-v4/artifacts/design-scan.json`. Save the new scanner output to `./prompts/visual-parity-v4/artifacts/design-scan-after-s03.json` for the S15 verifier.
- `grep -R "#[0-9a-fA-F]\{6\}" ./styles/components.css` — count should not increase (ideally decreases). Any remaining literals must be justified in the S03 handoff note.
- `grep -R "font-size:" ./styles/components.css | grep -v "var("` — ideally empty; anything left must be justified.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-03 → `done`, stamp date.
- Notes: number of tokens added / updated / deprecated, whether any renames occurred (list them so downstream sessions can migrate).
- Handoff Note: cite the scanner delta (tokens-category findings before vs after).
