# SESSION-01 — Discovery: run scanners, write `GAP-REPORT.md`

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M97 (design-compliance scanner), M99 (screenshot-parity tool), M95 (Playwright acceptance harness — needed to run M99)
> **Depends on:** —
> **Estimated effort:** 25 min (mostly waiting on Playwright)

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M97 | `./scripts/scan-design-compliance.js`, `./scripts/design-scan/` | Full | Understand its JSON output shape so this session can post-process it. |
| M99 | `./scripts/screenshot-parity.js` | Full | Same — need to know its side-by-side output dir and filename convention. |
| M95 | `./playwright.config.js` | Skim | Confirm base URL matches `npm start` (127.0.0.1:8080) so M99 can attach. |
| — | `./mocks/` (every `.html`) | Skim titles | So this report can enumerate the intended screens even if the scanner misses one. |
| — | `./src/ui/screens/`, `./src/ui/console/` | Skim exports | So this report can list the shipping screens/panes side-by-side with the mocks. |

## Context

Two prior visual-parity passes (`visual-parity-v2`, `visual-parity-v3`) drifted because they were done from memory of the mocks. The tooling in M97 and M99 was built precisely to close that loop — this session is where the loop finally runs. Every downstream session in this feature (SESSION-02 through SESSION-14) reads its section of the `GAP-REPORT.md` produced here and treats it as the definitive target list. If the report says a screen is already at parity, that session's implementation step is a no-op and only the verification step runs.

Nothing is edited under `./src/` or `./styles/` in this session. Output is one markdown file — `./prompts/visual-parity-v4/GAP-REPORT.md` — plus any raw scanner/parity artifacts saved under `./prompts/visual-parity-v4/artifacts/`.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./prompts/visual-parity-v4/GAP-REPORT.md` | Create | Consolidated per-screen gap list, ranked by severity. |
| `./prompts/visual-parity-v4/artifacts/design-scan.json` | Create | Raw M97 output (`--json` flag). |
| `./prompts/visual-parity-v4/artifacts/parity/` | Create dir | M99 side-by-side PNGs per screen. |
| `./prompts/visual-parity-v4/artifacts/scroll-audit.md` | Create | Per-screen scroll-height measurements (see §3 below). |
| `./prompts/visual-parity-v4/STATE.md` | Modify | Set S01 → `done`, append Handoff Note. |

**Do not** modify any file under `./src/`, `./styles/`, `./index.html`, `./mocks/`, `./data/`, or `./program/`.

## Implementation

### 1. Boot the dev server

```
npm start
```

Confirm `http://127.0.0.1:8080/` returns `./index.html` with no console errors (per FORGE-CONFIG Verification Commands, "Browser Load"). Leave it running for the parity-shot step.

### 2. Run the design-compliance scanner (M97)

```
npm run design:scan -- --json > ./prompts/visual-parity-v4/artifacts/design-scan.json
npm run design:scan       # also capture the human-readable report to stdout; paste-friendly
```

If the scanner emits its report to a fixed path (check `./scripts/scan-design-compliance.js` — likely `./scripts/design-scan/report.js`), copy that file to `./prompts/visual-parity-v4/artifacts/` as well. Do not modify the scanner itself.

### 3. Run the screenshot-parity tool (M99) for every screen

```
npm run parity:shots -- --all --out ./prompts/visual-parity-v4/artifacts/parity
```

If `--out` is not supported, fall back to whatever the tool's default output directory is and move the results into `artifacts/parity/` after the run. Confirm one PNG per screen exists, each showing mock-vs-prod side-by-side.

### 4. Audit scroll overflow per screen

For each screen in `./mocks/*.html` and its shipping counterpart in `./src/ui/screens/*.js`, measure whether the mock's rendered content exceeds the fixed 1080×1920 portrait canvas. Two approaches — do whichever is faster with the tooling at hand:

- **A. Extend M99 temporarily** with a per-run `--scroll-audit` flag that reports `document.body.scrollHeight` inside the frame element for each screen. If you add this flag, keep it a *pure addition* — do not change existing behaviour, and revert the change at the end of this session (this session ships no code).
- **B. Manual pass** via Playwright in a scratch script under `./prompts/visual-parity-v4/artifacts/`: navigate to each mock, then to each prod screen, evaluate `document.querySelector('.portrait-frame')?.scrollHeight ?? document.body.scrollHeight`, write results to `artifacts/scroll-audit.md`.

Either way, `artifacts/scroll-audit.md` must contain a table:

| Screen | Mock scroll height (px @ 1080 wide) | Prod scroll height (px @ 1080 wide) | Overflows 1920? | Suggested scroll container |
|--------|--------------------------------------|--------------------------------------|-----------------|-----------------------------|

### 5. Write `GAP-REPORT.md`

Produce `./prompts/visual-parity-v4/GAP-REPORT.md` with the following sections. Every finding must cite either a M97 rule ID or a specific mock/prod file line so the downstream session can act on it without re-scanning.

```markdown
# Gap Report — visual-parity-v4

_Generated YYYY-MM-DD from M97 (`npm run design:scan`) and M99 (`npm run parity:shots -- --all`)._

## Summary
| Category | Total findings | Blocking |
|----------|----------------|----------|
| Layout / structure | N | N |
| Typography | N | N |
| Colour / tokens | N | N |
| CRT / glitch | N | N |
| Components | N | N |
| Motion | N | N |
| Scroll overflow | N | N |

## Foundations (feeds S02–S05)
### Scroll architecture (S02)
- <finding> — <mock file:line> vs <prod file:line> — <fix hint>

### Tokens & typography (S03)
- …

### CRT overlays (S04)
- …

### Shared components (S05)
- …

## Per-screen findings

### Title (S06) — `./mocks/title.html` vs `./src/ui/screens/title.js` + `./styles/*`
- <finding> — cite mock line + prod file — <severity: blocker | major | minor>

### Creation (S07) — …
### Exploration (S08) — …
### Combat (S09) — …
### Library (S10) — …
### Scorecard (S10) — …
### Settings (S11) — …
### Tutorial (S11) — …
### Import (S11) — …

## Console (S12–S13)
### Console shell (S12) — `./mocks/console-*.html` header vs `./src/ui/console/console.js`
### Console modes (S13)
- MOVE — `./mocks/exploration.html` console region — …
- COMBAT — `./mocks/combat.html` console region — …
- PARTY — `./mocks/console-party.html` — …
- GEAR — `./mocks/console-gear.html` — …
- TECH — `./mocks/console-tech.html` — …
- LOOT — `./mocks/console-loot.html` — …
- LOG — `./mocks/console-log.html` — …

## Motion & cadence (S14)
- <finding on transition timing, glitch tick cadence, etc.>

## Deferred / out-of-scope
- <anything the scanner surfaced that this feature intentionally will not touch, with a one-line reason>
```

### 6. Sanity check the report

Every session (S02–S14) must have at least a "no gaps found — verification-only" bullet in its section. If a section is genuinely empty, say so explicitly; do not leave headings blank. This lets the downstream agent decide `pending → done` without re-running the scanner.

## Verification

- `./prompts/visual-parity-v4/artifacts/design-scan.json` is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('./prompts/visual-parity-v4/artifacts/design-scan.json'))"`.
- `./prompts/visual-parity-v4/artifacts/parity/` contains one PNG per screen listed in `STATE.md`'s Session Status table for S06–S13.
- `./prompts/visual-parity-v4/artifacts/scroll-audit.md` covers every screen and every console pane.
- `GAP-REPORT.md` has all section headings above, no `TODO` markers, and every finding cites a file or rule ID.
- `git status` shows only additions under `./prompts/visual-parity-v4/` — nothing under `./src/`, `./styles/`, or `./mocks/`.

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- Set SESSION-01 → `done`, stamp date.
- Notes: total findings by category, and any downstream session whose "no gaps found" verdict means it can be closed as a no-op.
- Handoff Note (template in STATE.md) — call out any finding that suggests a session needs to be split or an extra session added.
