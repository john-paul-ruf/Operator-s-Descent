# State Tracker — Operator's Descent / tech-protocol-e2e-repair

## Program / Feature / Intent / Sessions

| Field | Value |
|---|---|
| **Program** | Operator's Descent |
| **Feature** | `tech-protocol-e2e-repair` |
| **Intent** | Restore reliable, non-quarantined browser coverage for all 20 TECH protocols by repairing the live cursor/snapshot transaction and correcting the E2E fixture contract. |
| **Sessions** | 3 |
| **Plan directory** | `./program/operator-s-descent/prompts/tech-protocol-e2e-repair/` |

## Test Evidence at Planning Time

| Command | Result | Interpretation |
|---|---|---|
| `npx playwright test ./tests/e2e/tech-protocols.spec.js --reporter=line` | 80 passed | All cases are marked `test.fail`, so this is a quarantined baseline rather than a release signal. |
| `TECH_PROTOCOL_STRICT=1 npx playwright test ./tests/e2e/tech-protocols.spec.js --project=chromium-portrait --reporter=line` | 20 failed | Every protocol case is currently broken or asserted incorrectly in strict mode. |
| `npx vitest run ./tests/rules/protocols.test.js ./tests/ui/console-tech.test.js ./tests/ui/combat-screen.test.js` | 116 passed | Existing focused unit/UI coverage does not exercise the full resumed TECH transaction. |

## Session Status

| # | Session | Modules | Owns | Status | Checkpoint | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `./SESSION-01.md` — Normalize Protocol HP Deltas | M20 | `./src/rules/protocols.js`, `./tests/rules/protocols.test.js` | done | 2/2 | 2026-08-23 | Normalized withActorHp() so protocol HP effect deltas keep hp/currentHP coherent whenever both aliases exist on the incoming actor; added heal + damage regression tests in tests/rules/protocols.test.js.<br><br>applyProtocolEffect()'s stateDelta.markers/temporaryEffects/apDebt/grid outputs still have no serialized or turn-processing persistence contract in runState — SESSION-02 should confirm it is only wiring actor deltas (hp/currentHP/conditions/position) into the live combat map and committed snapshot, not silently implying those non-actor payloads are now durable. |
| 2 | `./SESSION-02.md` — Commit TECH Casts Through Live Combat State | M65, M71 | `./src/ui/console/tech.js`, `./src/ui/screens/combat.js`, `./tests/ui/console-tech.test.js`, `./tests/ui/combat-screen.test.js` | pending | — | — | Pass the live cursor, make effect resolution atomic, and persist post-cast combat state. |
| 3 | `./SESSION-03.md` — Repair and Unquarantine the TECH Browser Matrix | M95 | `./tests/helpers/tech-protocol-e2e-fixture.js`, `./tests/e2e/tech-protocols.spec.js` | pending | — | — | Derive targeting from data, fix the caster ledger assertion, and remove the xfail quarantine. |

## Wave Plan

| Wave | Sessions | Why concurrent |
|---|---|---|
| 1 | SESSION-01 | One member: the rules-layer actor delta is an artifact consumed by the live UI transaction. |
| 2 | SESSION-02 | One member: it depends on SESSION-01's coherent `hp`/`currentHP` deltas and owns the screen-to-console contract. |
| 3 | SESSION-03 | One member: it removes the test quarantine only after the repaired live transaction can satisfy strict browser assertions. |

## Dependency Graph

`SESSION-01 → SESSION-02 → SESSION-03`

- **SESSION-01 → SESSION-02**: SESSION-02 must materialize M20 actor deltas into live combat actors and snapshots without alias divergence.
- **SESSION-02 → SESSION-03**: SESSION-03's normal, non-xfail E2E matrix requires a live RNG cursor and a synchronized post-cast `activeCombat` snapshot.

## Architecture Reference

1. `./src/ui/screens/combat.js` owns the live combat map and its deterministic `rngCursor`.
2. `./src/ui/console/console.js` spreads that context to `./src/ui/console/tech.js`.
3. `./src/ui/console/tech.js` calls `./src/rules/protocols.js` to resolve the action and apply its effect delta.
4. The combat screen commits the resulting live map back through party synchronization, `runState.rngState`, and `runState.activeCombat` via `toCombatSnapshot()`.
5. `./tests/e2e/tech-protocols.spec.js` resumes the encoded snapshot and validates the real UI plus the committed runtime state.

## Scope Summary

| Module | Affected files | Scope |
|---|---|---|
| M20 | `./src/rules/protocols.js`, `./tests/rules/protocols.test.js` | Keep dual health aliases synchronized in protocol actor deltas. |
| M65 | `./src/ui/console/tech.js`, `./tests/ui/console-tech.test.js` | Require a usable cursor, fail atomically, apply deltas, and notify the combat owner. |
| M71 | `./src/ui/screens/combat.js`, `./tests/ui/combat-screen.test.js` | Pass cursor/commit/refresh context and persist a post-cast snapshot. |
| M95 | `./tests/helpers/tech-protocol-e2e-fixture.js`, `./tests/e2e/tech-protocols.spec.js` | Replace hard-coded target rules and xfail masking with data-driven strict acceptance. |

## Design Decisions

| Choice | Rationale |
|---|---|
| Repair the runtime transaction rather than raise E2E timeouts | The strict failure is deterministic `invalid-rng` caused by a missing context field, not slow rendering. |
| Treat `runState.activeCombat` as the E2E correctness boundary | The run can resume from this snapshot; a UI-only update is not a durable cast. |
| Normalize HP aliases in M20 | `toCombatSnapshot()` reads `hp`, while resumed actors also expose `currentHP`; the invariant belongs at the delta producer. |
| Derive target selection from `effectData` | `./data/protocols.json` is the authoritative catalog; hard-coded test IDs drifted from UI/rules semantics. |
| Remove all expected-failure masking | A passing TECH matrix must mean real browser behavior passed. |
| Keep non-actor payload persistence out of this repair | `markers`, `temporaryEffects`, `apDebt`, and grid mutations have no current serialized/turn-processing contract. This repair must not misrepresent them as newly persistent without a separate scoped feature. |

## Known Failure Classification

| Class | Evidence | Planned repair |
|---|---|---|
| Missing deterministic cursor | `./src/ui/screens/combat.js` creates a cursor but omits it from `viewState`; `./src/ui/console/tech.js` receives `undefined`. | SESSION-02 supplies the existing cursor through the console context. |
| False success after effect failure | Non-hostile casts spend CHARGE/AP even though `applyProtocolEffect()` returns `invalid-rng`. | SESSION-02 treats effect failure as an atomic rejection. |
| HP alias divergence | A dual-shaped actor delta updates `currentHP` but leaves `hp` stale; snapshots serialize the stale field. | SESSION-01 normalizes effect deltas. |
| Stale resumable state | Direct TECH mutations do not refresh `runState.activeCombat`. | SESSION-02 commits the live map through the combat owner. |
| Incorrect fixture ledger | The E2E assertion reads the primary enemy's CHARGE/AP rather than the caster's. | SESSION-03 reads `ids.caster`. |
| Incorrect target workflow | Several AoE protocols are targetless in the real UI but the test waits for target buttons. | SESSION-03 derives targeting from `effectData`. |
| Quarantined suite | `test.fail` makes 80 default-project results non-actionable. | SESSION-03 removes the quarantine after strict behavior is repaired. |

## Handoff Notes

### SESSION-01

- **Notes:** Normalized withActorHp() so protocol HP effect deltas keep hp/currentHP coherent whenever both aliases exist on the incoming actor; added heal + damage regression tests in tests/rules/protocols.test.js.
- **Delivered:** src/rules/protocols.js: withActorHp(actor, nextHp) now mirrors nextHp onto every alias present on the incoming actor (hp when 'hp' in actor or neither alias present; currentHP when present) instead of updating only currentHP when both exist. tests/rules/protocols.test.js: new 'HP alias invariant' describe block with (1) a heal-path test on a dual-shaped ally (hp+currentHP) asserting both fields land at 11, and (2) a damage-path regression that runs a dual-shaped hostile through applyProtocolEffect, materializes the returned delta into a Map via Object.assign(...) matching src/ui/console/tech.js:195-199's applyActorDeltas pattern, and asserts both aliases equal 19 post-materialization.
- **Verification:** npx vitest run ./tests/rules/protocols.test.js -> 32 passed (was 30 baseline + 2 new); node --check ./src/rules/protocols.js -> OK; confirmed via git diff that only src/rules/protocols.js and tests/rules/protocols.test.js changed, no save-schema/UI/data files touched, and all pre-existing one-alias fixtures (hp-only, currentHP-only) still pass unmodified.
- **Surprises:** —
- **Follow-up:** applyProtocolEffect()'s stateDelta.markers/temporaryEffects/apDebt/grid outputs still have no serialized or turn-processing persistence contract in runState — SESSION-02 should confirm it is only wiring actor deltas (hp/currentHP/conditions/position) into the live combat map and committed snapshot, not silently implying those non-actor payloads are now durable.
