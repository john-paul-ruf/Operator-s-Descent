# Forge Build — Operator's Descent / visual-parity-v4

**Feature:** Close the visual-parity gap with `./mocks/*.html` across every screen and
console pane, and introduce an in-frame scroll pattern so screens whose content
overflows the 1080×1920 portrait canvas remain fully reachable without breaking
the letterboxed frame.

**Root:** `./prompts/visual-parity-v4/`

---

## Protocol — Each iteration

1. **Read `./program/operator-s-descent/FORGE-CONFIG.md`** — module registry, stack, conventions, verification commands. Pay attention to Custom Rules #3 (no Tailwind — mocks are Tailwind, prod is hand-written CSS), #8 (portrait-only 1080×1920 letterboxed), and #10 (no deferred-boot gate).
2. **Read `./prompts/visual-parity-v4/STATE.md`** — current session status, done/pending/blocked, handoff notes from the previous agent.
3. **Pick the next `pending` session whose `Depends on` sessions are all `done`.** Parallelism is allowed only when explicitly noted in the session's front matter.
4. **Read `./prompts/visual-parity-v4/SESSION-NN.md` fully** plus every Module Context file listed in its table. Never modify a file you have not read.
5. **Read affected source files before modifying** — surgical edits, cite functions/selectors, preserve exports and public API.
6. **Execute precisely.** Follow the conventions in `FORGE-CONFIG.md`: kebab-case files, camelCase functions, native ES modules, no build step, no runtime deps, no Tailwind, no TODOs left behind.
7. **Verify.** Run the session-specific verification steps AND the FORGE-CONFIG compliance checks (at minimum `npm test` for touched modules, `npm run design:scan` after any style/DOM change, and a browser smoke test via `npm start`).
8. **Update `STATE.md`** — set the session's status to `done`, stamp the completion date (2026-08-12 or later), append notes and a Handoff Note describing what changed and any surprises.
9. **Update `./program/operator-s-descent/arch/ui.md`** (or the relevant arch file) if a new module, public API, or CSS token was added.
10. **Commit** using the format from `FORGE-CONFIG.md` — `SESSION-NN: <brief description>` (feature-prefixed if you're on a feature branch: `visual-parity-v4 SESSION-NN: …`).
11. **Loop.** When every session is `done`, produce the Final Report described below.

---

## Discovery-first plan

This feature runs **discovery-first**: `SESSION-01` runs the automated
compliance and screenshot-parity tooling to produce a machine-generated
`GAP-REPORT.md` inside this folder. Every downstream session references its
own screen's section of that report to prioritise fixes — do **not** guess
which changes matter. If `SESSION-01` reveals a gap that no scheduled session
addresses, add a new `SESSION-NN.md` for it, list it in `STATE.md` as
`pending`, and leave a Handoff Note explaining why.

---

## Crash Recovery

- **Read `STATE.md`.** Any session in `in-progress` is the one you must resume or roll back.
- **Read the Handoff Notes at the bottom of `STATE.md`** and check `git status` / `git log --oneline -20` for the last committed session.
- **Partial session with uncommitted work:** either complete the remaining implementation and verify, or `git reset --hard HEAD` and restart the session cleanly. Do not leave a half-applied session and pick up another one.
- **Always update `STATE.md` before stopping**, whether the stop is voluntary (context limit, blocker) or forced. The next agent has no other source of truth.

---

## Stopping Conditions

- **All sessions `done`** → produce the Final Report (below) and stop.
- **Blocker with no workaround** → set the session to `blocked`, write the exact question or missing input in Handoff Notes, and skip to the next eligible pending session. Do not stall the whole build on one blocker.
- **Context limit approaching** → finish the current session's verification and commit, then update `STATE.md` and stop cleanly.
- **User input needed for a decision that changes scope** → set the affected session(s) to `blocked` with a specific question, and stop.

---

## Final Report

When every session is `done`, emit a report containing:

1. **Summary** — one paragraph on what visual parity looked like before and after.
2. **Sessions done/total** and total wall-clock time if tracked.
3. **Files created / modified** — grouped by module, with M-IDs.
4. **Architecture impact** — new modules, new CSS tokens, changed public APIs, updates to `./program/operator-s-descent/arch/ui.md`.
5. **Verification results** — `npm test`, `npm run design:scan`, `npm run parity:shots -- --all`, `npm run test:e2e` outputs (pass counts, any newly-quarantined tests).
6. **Residual gap** — anything the compliance scanner still flags, why it was deferred, and where it's tracked.
7. **Follow-up** — sessions to schedule next (if any), and any FORGE-CONFIG Custom Rules that should be added or amended based on decisions made during this build.
