# State Tracker — Operator's Descent / gear-inventory-filters

## Program / Feature / Intent / Sessions

| Field | Value |
|---|---|
| **Program** | Operator's Descent |
| **Feature** | `gear-inventory-filters` |
| **Intent** | Let players narrow the GEAR inventory from a top-of-screen, accessible selector without altering inventory state, equipment rules, or save data. |
| **Sessions** | 2 |

## Session Status

| # | Session | Modules | Owns | Status | Checkpoint | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 01 | Add top-level GEAR inventory filters | M06, M09, M12, M17, M18, M25, M33, M34, M56, M60, M64, M79, M95 | `./src/ui/console/gear.js`, `./styles/components.css`, `./tests/ui/console-gear.test.js`, `./tests/e2e/gear-actions-persistence.spec.js` | in-progress | — | — | — |
| 02 | Release GEAR filters through the offline cache | M81, M83, M95 | `./service-worker.js`, `./tests/integration/service-worker.test.js` | in-progress | — | — | — |

## Wave Plan

| Wave | Sessions | Why concurrent |
|---|---|---|
| 1 | SESSION-01 ∥ SESSION-02 | Their leases are literally disjoint. SESSION-01 changes rendered GEAR behavior and proof; SESSION-02 changes only M81's release identity/tests. Both shipped UI files already exist in the worker manifest, so neither consumes an artifact from the other. |

## Dependency Graph

```mermaid
flowchart TD
    S01["SESSION-01: top GEAR filters"]
    S02["SESSION-02: offline cache v12"]
```

## Architecture Reference

- **Top-level control:** M64 renders an `Inventory filters` radio group after `gear-selectors` and before the EQUIPPED readout in `./src/ui/console/gear.js`. It controls only the un-equipped list.
- **Transient state:** The active filter lives in M64's existing per-run WeakMap and defaults to `all`. It never becomes an M33 field, portable-save value, URL parameter, local-storage preference, or bus event.
- **Predicate boundary:** `ALL` retains every entry in order. `EQUIPPABLE` requires M64's direct slot resolver plus M17 class/proficiency legality; it intentionally ignores momentary combat-swap availability. `CONSUMABLES` is category exact. `JUNK` uses the existing `junkTagged` flag.
- **Action safety:** A filter switch cancels any pending CORRUPT or junk-all confirmation. It does not change inventory, equipped rows, capacity/scrap summary, or the established global `JUNK ALL TAGGED` transaction.
- **Accessibility and layout:** M64 uses native radio buttons with explicit `aria-checked` state. M79 makes them wrap at narrow widths and retains the existing `console-row` touch floor; existing wide fine-pointer CSS densifies them without a new wide-only branch.
- **Offline release:** M81 advances the cache from `operator-descent-2026-08-23-auto-slot-gear-equip-v11` to `operator-descent-2026-08-23-gear-inventory-filters-v12`. The manifest already precaches both changed UI files.

## Scope Summary

| Module | Scope |
|---|---|
| M06, M09, M12 | Read-only catalog authority for class gates, item slots, and consumable category. |
| M17–M18, M25 | Read-only legality/transaction/salvage contracts retained by M64. |
| M33–M34 | Read-only persistence/event boundary; filters are intentionally view-only. |
| M56, M60, M64, M79 | Add radio selector, filtered rendering, responsive styling, and focused unit/browser proof. |
| M81 | Cache v11→v12 and exact predecessor/manifest regression tests. |
| M95 | Focused production-browser coverage of filter behavior and no-autosave guarantee. |

## Design Decisions

| Choice | Rationale |
|---|---|
| Ship ALL, EQUIPPABLE, CONSUMABLES, and JUNK | These cover every current inventory workflow with four discoverable controls; separate weapon/armor filters add clutter without fulfilling the requested compatibility view. |
| Define EQUIPPABLE by slot resolution + class/proficiency legality | The player sees items the selected character can actually use, while temporary combat timing remains an action-level disabled reason rather than hiding compatible gear. |
| Store selection only in M64's WeakMap | Filtering is a local presentation preference; persisting it would expand portable save and autosave scope for no gameplay value. |
| Keep JUNK ALL TAGGED global | Existing salvage semantics intentionally operate on all tagged inventory. A view filter must not silently change the destructive transaction's scope. |
| Split the cache release from UI work | The write sets are disjoint and can safely run concurrently; the v12 cache identity prevents offline clients from retaining the unfiltered GEAR UI. |

## Handoff Notes
