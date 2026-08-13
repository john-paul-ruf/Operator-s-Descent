# SESSION-15 — Final verification, parity shots, gap-report close-out

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M97 (design-compliance scanner), M99 (screenshot-parity), M95 (Playwright acceptance)
> **Depends on:** SESSION-14 (transitively depends on every prior session)
> **Estimated effort:** 20 min

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M97 | `./scripts/scan-design-compliance.js` | Reference | Runs same as S01. |
| M99 | `./scripts/screenshot-parity.js` | Reference | Runs same as S01. |
| M95 | `./tests/e2e/`, `./playwright.config.js` | Reference | Full E2E pass. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` | Full | Close every finding or explain why it's carried forward. |

## Context

This session ships no code. It runs the same tooling S01 ran, produces final artifacts, and either declares victory or spawns follow-up sessions for residual gaps. Do not modify any source in this session; if something needs fixing, add a new `SESSION-16.md` (or later) and set it `pending` — do not fold fixes into this session, so the verification pass stays independent.

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./prompts/visual-parity-v4/artifacts/design-scan-final.json` | Create | Final scanner output. |
| `./prompts/visual-parity-v4/artifacts/parity-final/` | Create | Final side-by-side PNGs. |
| `./prompts/visual-parity-v4/GAP-REPORT.md` | Modify | Add "Close-out" section: per-finding disposition (resolved / carried-forward / rejected + reason). |
| `./prompts/visual-parity-v4/FINAL-REPORT.md` | Create | Feature-level final report per MASTER.md's "Final Report" template. |
| `./prompts/visual-parity-v4/STATE.md` | Modify | SESSION-15 → `done`; feature status → complete (or "complete with follow-ups"). |
| `./prompts/visual-parity-v4/SESSION-16.md` etc. | Create only if follow-ups are needed | New sessions for residual gaps. Add rows to STATE.md as `pending`. |

## Implementation

### 1. Run the full acceptance suite

```
npx vitest run
npm run design:scan -- --json > ./prompts/visual-parity-v4/artifacts/design-scan-final.json
npm run design:scan
npm run parity:shots -- --all --out ./prompts/visual-parity-v4/artifacts/parity-final
npm run test:e2e
```

If E2E is slow or flaky, run at minimum the `title`, `creation`, `exploration`, `combat`, `library`, `scorecard`, `settings`, `tutorial`, `import` specs. Skip only if a spec is quarantined pre-feature (cite the quarantine).

### 2. Close out every GAP-REPORT finding

For each bullet in `GAP-REPORT.md`, append a disposition tag:

- `✓ resolved in SESSION-NN` — verified by scan + parity shot.
- `→ carried forward — SESSION-16` — cite the follow-up session.
- `✗ rejected — <reason>` — with mock citation showing the finding was a false positive.

Add a **Close-out** section at the end of `GAP-REPORT.md` summarising counts by disposition.

### 3. Write `FINAL-REPORT.md`

Per MASTER.md's template:

1. Summary (before/after).
2. Sessions done/total, wall-clock estimate.
3. Files created / modified — grouped by module with M-IDs.
4. Architecture impact — new modules, new CSS tokens (S02 + S03), API changes, arch/ui.md diffs.
5. Verification — vitest, design:scan, parity:shots, test:e2e results.
6. Residual gap — cite carried-forward sessions.
7. Follow-up — anything else to schedule.

### 4. Update `STATE.md`

- Every session `done`.
- Any new follow-up session listed as `pending` with dependencies.
- Handoff Note under SESSION-15: final scanner delta (S01 baseline → S15 final).

## Verification

- `./prompts/visual-parity-v4/artifacts/design-scan-final.json` count < S01 baseline count; ideally 0 blockers, only carried-forward or rejected minors.
- `./prompts/visual-parity-v4/artifacts/parity-final/` contains one PNG per shipping screen; pixel diff visibly smaller than S01 baseline.
- `npx vitest run` and `npm run test:e2e` — both green (or delta explicitly documented).
- `git status` shows only additions/modifications under `./prompts/visual-parity-v4/` — no `./src/` or `./styles/` changes.

## State Update

- SESSION-15 → `done`, stamp date.
- Feature status in STATE.md header → `complete` (or `complete with N follow-ups`).
- Handoff Note lists follow-up sessions (if any) with a one-line "why".
