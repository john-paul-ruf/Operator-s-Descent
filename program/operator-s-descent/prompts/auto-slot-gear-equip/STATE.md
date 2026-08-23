# State Tracker — Operator's Descent / auto-slot-gear-equip

## Program / Feature / Intent / Sessions

| Field | Value |
|---|---|
| **Program** | Operator's Descent |
| **Feature** | `auto-slot-gear-equip` |
| **Intent** | Make each GEAR inventory equipment action derive its only valid destination from the item catalog, so a valid armor click equips Armor directly and no manual slot button or wrong-slot block is shown. |
| **Sessions** | 2 |

## Session Status

| # | Session | Modules | Owns | Status | Checkpoint | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 01 | Auto-route inventory equipment and remove manual slot buttons | M09, M17, M18, M25, M33, M34, M56, M60, M64, M79, M95 | `./src/ui/console/gear.js`, `./styles/components.css`, `./tests/ui/console-gear.test.js`, `./tests/e2e/gear-actions-persistence.spec.js`, `./tests/e2e/scroll-restore.spec.js` | done | 2/2 | 2026-08-23 | `notes`: Removed manual GEAR slot selection; armor resolves to armor and catalogued weapons resolve to weapon/offhand at render and activation time. Class/combat/CORRUPT constraints remain. Browser proof confirms direct armor autosave and reload restoration. `followUp`: — |
| 02 | Release direct GEAR routing through the offline cache | M81, M83, M95 | `./service-worker.js`, `./tests/integration/service-worker.test.js` | done | 2/2 | 2026-08-23 | `notes`: Advanced offline cache v10→v11; activation deletes operator-descent-2026-08-23-gear-equip-save-v10 and retains operator-descent-2026-08-23-auto-slot-gear-equip-v11. Pinned direct GEAR JS/CSS manifest assertions. `followUp`: No residual SESSION-02 work. |

## Wave Plan

| Wave | Sessions | Why concurrent |
|---|---|---|
| 1 | SESSION-01 ∥ SESSION-02 | Their leases are literally disjoint. SESSION-01 owns direct GEAR behavior and browser proof; SESSION-02 owns only the cache release and its unit test. The manifest already lists the changed assets, so neither consumes an artifact from the other. |

## Dependency Graph

```mermaid
flowchart TD
    S01["SESSION-01: direct item routing"]
    S02["SESSION-02: offline cache v11"]
```

## Architecture Reference

- **Destination resolution:** M64 `./src/ui/console/gear.js` maps an inventory armor item to `armor` and a weapon item to `./data/equipment.json`'s declared `weapon` or `offhand` slot. GEAR no longer stores a selected destination.
- **Transaction boundary:** M64 passes the resolved slot to the existing M18 `equipItem` transaction. M18, M17, and M25 contracts stay unchanged; no save schema, data shape, or rule API changes are planned.
- **Constraints retained:** Only an artificial wrong-slot block disappears. Class/proficiency gates, the combat swap gate, inventory-cap behavior on unequip, and the two-step CORRUPT confirmation remain.
- **Persistence:** A successful direct transaction continues through `state:inventory-change`, M86 runtime autosave, and M45 local storage. SESSION-01 proves a reload restores Armor.
- **Offline release:** M81 advances v10 to `2026-08-23-auto-slot-gear-equip-v11` and pins the two changed GEAR client assets in the precache contract.

## Scope Summary

| Module | Scope |
|---|---|
| M09 Equipment data | Read-only target-slot authority; no catalog/schema change. |
| M17–M18, M25 Rules | Read-only legality, transaction, and inventory constraints retained by M64. |
| M33–M34, M43–M45 State/persistence | Read-only existing event and autosave route; browser-tested, not rewritten. |
| M56, M60, M64 UI | Remove manual target selection and route each actionable inventory item directly. |
| M79 Components CSS | Remove retired slot-row styling only. |
| M81 Offline | Cache v10→v11 plus exact predecessor and manifest assertions. |
| M95 Acceptance | Focused unit and browser coverage for direct armor equip, no selector, reload, and scroll refresh. |

## Design Decisions

| Choice | Rationale |
|---|---|
| Resolve a target from the item/catalog at click/render time | The equipment item already determines its only legal destination; carrying a selected destination state creates a needless wrong-slot failure. |
| Armor → Armor; weapons use catalog `slot` | This covers all current catalog destinations, including future/reachable shield inventory data routing to Off-hand, without hard-coded item IDs. |
| No `EQUIP` action for non-equipment/unresolvable items | A consumable is not “equipment blocked”; removing the false action prevents another form of wrong-slot message. |
| Retain real gating reasons | Class legality, combat timing, and CORRUPT consent are game rules, not a redundant UI selection step. |
| Keep the resolver in M64 | It adapts authoritative loaded catalog data to the existing M18 transaction API; moving it would force an unnecessary API/save-data change. |
| Split cache release from UI work | The write sets are disjoint and can safely run in parallel; SESSION-02's v11 gate keeps the delivered feature offline-safe. |

## Handoff Notes

### SESSION-01

```json
{
  "session": "01",
  "status": "done",
  "checkpoint": 2,
  "notes": "Removed manual GEAR slot selection; armor resolves to armor and catalogued weapons resolve to weapon/offhand at render and activation time. Class/combat/CORRUPT constraints remain. Browser proof confirms direct armor autosave and reload restoration.",
  "delivered": "Direct item-routed GEAR equip actions, obsolete selector CSS removal, focused unit coverage, armor persistence coverage, and character-selector scroll-refresh coverage.",
  "verification": "node --check passed; focused Vitest passed (19); focused Playwright passed (13 passed, 15 expected skips); design:scan passed (2 info); check:assets passed. Full npm test has 2 unrelated exploration-screen failures; full e2e has unrelated accessibility/manual failures before completion.",
  "surprises": "Untracked .DS_Store was pre-existing/outside lease. Full-suite failures are outside this lease: exploration-screen tap notices/hostile interrupt; e2e portrait-frame ratio and manual focus-return.",
  "followUp": "—",
  "filesTouched": [
    "src/ui/console/gear.js",
    "styles/components.css",
    "tests/ui/console-gear.test.js",
    "tests/e2e/gear-actions-persistence.spec.js",
    "tests/e2e/scroll-restore.spec.js"
  ],
  "blockedReason": null
}
```

### SESSION-02

```json
{
  "session": "02",
  "status": "done",
  "checkpoint": 2,
  "notes": "Advanced offline cache v10→v11; activation deletes operator-descent-2026-08-23-gear-equip-save-v10 and retains operator-descent-2026-08-23-auto-slot-gear-equip-v11. Pinned direct GEAR JS/CSS manifest assertions.",
  "delivered": "Released direct GEAR routing through the versioned offline cache and regression-tested its shipped assets.",
  "verification": "node --check ./service-worker.js ✓; npx vitest run ./tests/integration/service-worker.test.js ✓ (6); npm run check:assets ✓; full npx vitest run had 3 unrelated failures.",
  "surprises": "Full Vitest: existing exploration tap failures (2) and sigil lint failures caused by generated test-results error-context files. Concurrent uncommitted changes exist in ./src/ui/console/gear.js and ./styles/components.css; untouched. Untracked .DS_Store untouched.",
  "followUp": "No residual SESSION-02 work.",
  "filesTouched": [
    "./service-worker.js",
    "./tests/integration/service-worker.test.js"
  ],
  "blockedReason": null
}
```
