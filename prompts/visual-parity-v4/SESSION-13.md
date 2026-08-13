# SESSION-13 — Console mode panes parity + scroll (MOVE / COMBAT / PARTY / GEAR / TECH / LOOT / LOG)

> **Program:** Operator's Descent
> **Feature:** visual-parity-v4
> **Modules:** M61 (move), M62 (combat), M63 (party), M64 (gear), M65 (tech), M66 (loot), M67 (log), M56 (components), M79 (components CSS)
> **Depends on:** SESSION-02, SESSION-03, SESSION-04, SESSION-05, SESSION-12
> **Estimated effort:** 45 min — larger than the 30-min cap. If context gets tight, commit after each pane (7 commits) and continue; the executing agent may split this into `SESSION-13a`..`SESSION-13g` per pane.

## Module Context

| ID | Module | Read | Why |
|----|--------|------|-----|
| M61 | `./src/ui/console/move.js` | Full | MOVE mode: D-pad, auto-stop indicators. Mock context: `./mocks/exploration.html` (console region). |
| M62 | `./src/ui/console/combat.js` | Full | COMBAT mode: actions, targeting. Mock context: `./mocks/combat.html` (console region). |
| M63 | `./src/ui/console/party.js` | Full | PARTY mode: member list, stats. Mock: `./mocks/console-party.html`. |
| M64 | `./src/ui/console/gear.js` | Full | GEAR mode: equipment management. Mock: `./mocks/console-gear.html`. |
| M65 | `./src/ui/console/tech.js` | Full | TECH mode: protocol deck, CHARGE. Mock: `./mocks/console-tech.html`. |
| M66 | `./src/ui/console/loot.js` | Full | LOOT mode: container contents, take. Mock: `./mocks/console-loot.html`. |
| M67 | `./src/ui/console/log.js` | Full | LOG mode: scrolling event log, copy link. Mock: `./mocks/console-log.html`. |
| M56 | `./src/ui/components.js` | Reference | S05 factories. |
| M79 | `./styles/components.css` | Reference | S12 shell classes + component classes. |
| — | `./prompts/visual-parity-v4/GAP-REPORT.md` §"Console modes (S13)" | Full | Target list per pane. |
| — | `./prompts/visual-parity-v4/artifacts/scroll-audit.md` rows for `console-party`, `console-gear`, `console-tech`, `console-loot`, `console-log` | Reference | Panes that need `.screen-body` scroll inside their body. |

## Context

Seven panes, each mounted into the M60 console body (post-S12). Each pane owns its own DOM inside the shell's `.console-body` container. Panes whose content overflows (PARTY with 3 members, GEAR with inventory, TECH with full protocol deck, LOOT with N items, LOG with running event log) wrap their body in `createScreenBody({ scroll: true })` — the shell's tab bar stays pinned because it's outside `.console-body`.

**Splitting guidance:** if this session exceeds context or the 200-line cap, do panes in this order and commit each as `SESSION-13a` through `SESSION-13g`, adding rows to STATE.md as you split:

1. MOVE (simplest — D-pad)
2. COMBAT (action bar)
3. PARTY (member list — scroll)
4. GEAR (inventory — scroll)
5. TECH (deck — scroll)
6. LOOT (list — scroll)
7. LOG (event stream — scroll + copy-link)

## Files to Create / Modify

| File | Action | What Changes |
|------|--------|--------------|
| `./src/ui/console/move.js` | Modify | Rebuild pane DOM per mock; no scroll needed. |
| `./src/ui/console/combat.js` | Modify | Rebuild per mock; action bar layout; no scroll unless GAP says otherwise. |
| `./src/ui/console/party.js` | Modify | Rebuild per `./mocks/console-party.html`; wrap member list in `createScreenBody({ scroll: true })`. |
| `./src/ui/console/gear.js` | Modify | Rebuild per `./mocks/console-gear.html`; inventory rows in `createScreenBody({ scroll: true })`. |
| `./src/ui/console/tech.js` | Modify | Rebuild per `./mocks/console-tech.html`; protocol deck in `createScreenBody({ scroll: true })`. |
| `./src/ui/console/loot.js` | Modify | Rebuild per `./mocks/console-loot.html`; container list in `createScreenBody({ scroll: true })`. |
| `./src/ui/console/log.js` | Modify | Rebuild per `./mocks/console-log.html`; event stream in `createScreenBody({ scroll: true })`; copy-link button in pinned footer. |
| `./tests/ui/console/*.test.js` (if present) | Modify | Update DOM assertions per pane. |
| `./styles/components.css` | Modify (only if `.console-{mode}-*` scoped rules need adding) | Confine per pane. |

## Implementation

### Per-pane recipe (apply to each of M61–M67)

1. **Read the mock** — extract this pane's DOM signature.
2. **Read the pane module** — mount signature, subscriptions, model reads (M33 run state, M45 library, mode-specific rules).
3. **Rebuild DOM**:
   - If pane has a header/footer inside itself, pin them; wrap the scrollable middle in `createScreenBody({ scroll: true })`.
   - If pane fits, no scroll body needed — just plain DOM.
   - Consume S05 factories for every button/row/card.
4. **Wire model → DOM** — targeted `.replaceChildren` on affected sub-regions; preserve `.screen-body` scroll position across updates (see S07 recipe).
5. **Wire input** — pane-specific keyboard bindings via M57 subscriptions.
6. **Log pane (M67) specifics** — copy-link button pinned; button calls the existing M43 encode; success/failure toast per mock.
7. **Update tests** — DOM composition, scroll body presence where applicable, event bindings.

### Cross-cutting rules

- No pane may modify shell CSS (S12 owns it). If a pane needs a class that leaks into the shell, that's a `blocked` finding — cite the mock and stop the pane.
- No pane may subscribe to bus events not already documented for it in `./program/operator-s-descent/arch/ui.md`.
- On mode change (`ui:mode-change`), the outgoing pane's teardown must clear its own subscriptions — do not rely on garbage collection.

## Verification

For each pane:
- `npx vitest run` — pane tests pass.
- `node --check ./src/ui/console/<pane>.js`.
- `npm start`, activate the tab, compare to its mock; scroll where expected; keyboard bindings work.
- `npm run parity:shots -- --screen console-<pane>` (matches mock filename pattern).

After all panes:
- `npm run design:scan` — Console-modes findings resolved.
- Full-app smoke: enter a run, switch between all 7 tabs, confirm no bus/subscription leaks (open DevTools console; no warnings on tab-switch).

## State Update

Update `./prompts/visual-parity-v4/STATE.md`:
- SESSION-13 → `done` (or SESSION-13a..13g if split), stamp date.
- Notes: which panes got `.screen-body`, which didn't, any pane whose mock demanded a shell change (blocker — cite).
- Handoff Note: motion/timing details punted to S14 (log auto-scroll cadence, protocol deck reveal timing, etc.).
