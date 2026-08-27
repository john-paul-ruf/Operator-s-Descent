# Architecture Detail — Rules and Encounters

## Modules

| IDs | Area | Owns |
|---|---|---|
| M15–M25 | Rules engine | Attributes, scaling, classes, equipment, conditions, protocols, consumables, loot, enemies, combat, inventory |
| M90 | Progression | Calibration offers/application and floor-transition recovery |
| M91 | Encounters | Deployment, hunts, threshold elites, and Echo injection |

## Public API Direction

Rules are pure or transaction-style: inputs are snapshots plus an injected RNG cursor/context; outputs contain a new snapshot or an explicit mutation result and structured log entries. They never read DOM, `localStorage`, global game data, or `Math.random()`.

```js
export function resolveAttack(combatState, action, rngCursor, context) {}
export function executeAction(combatState, action, rngCursor, context) {}
export function castProtocol(caster, protocolRef, targets, rngCursor, context) {}
export function applyProtocolEffect(caster, request, context, rngCursor) {}
export function createEncounter(kind, floor, runState, rngCursor, data) {}
export function getCalibrationOffer(runState, characterId, floorNumber, data) {}
export function applyCalibration(runState, selections, data) {}
export function applyFloorTransition(runState, nextFloor, data) {}
```

## Internal Boundaries

- M15/M16 provide formulas only.
- M17/M90 own class signatures and advancement; UI only presents returned choices.
- M18/M19/M20/M21/M25 own item, condition, protocol, consumable, and inventory legality.
- M22/M23 generate rewards/actors but do not mount encounters.
- M24 owns turn legality and resolution; M91 owns who participates and where they deploy.
- Every d20 result emits roll, natural value, modifier breakdown, target number, outcome, and deterministic event order.

## Invariants

- One combat move action (one legal cell) plus 2 AP; neither converts to the other.
- AP never carries over. Swap is free once per turn. Signature free actions obey per-round/per-combat limits.
- Natural 1 is an automatic miss plus adjacent opportunity attacks; natural 20 is maximum damage, not double dice.
- Enemy raw attributes stay 1–10; derived stats receive depth scaling.
- Conditions are exactly the nine data-defined IDs; BURNING alone stacks.
- Inventory is bounded by stack-aware item count and never exceeds 100.

## Baseline Audit (2026-08-10)

Current unit tests are green, but several implementations are approximations: protocol dice counts parse die sides as dice counts, saves are skipped, combat lacks movement/range/cover/flanking/opportunity attacks, class signatures are descriptive only, hunts/calibrations are not wired, and Echo scheduling uses `Math.random()`.

## Change History

| Date | Change |
|---|---|
| 2026-08-11 | SESSION-51 persisted current floor theme metadata during M90 floor transitions and canonicalized M25 inventory copies so generated loot remains equal across encode/decode continuation checks. |
| 2026-08-09 | Initial M15–M25 registry. |
| 2026-08-10 | Added M90/M91 to isolate progression and encounter composition. |
| 2026-08-10 | SESSION-16 added catalog-keyed protocol effect transactions with explicit combat/fog/topology deltas. |
| 2026-08-10 | SESSION-17 added deterministic depth/vault-gated loot, 16 structured affix hooks, and immutable CORRUPT equipment transactions. |
| 2026-08-11 | SESSION-44 wired M24 combat transactions into the UI without changing resolution rules; the screen updates active-combat snapshots and dispatches victory/retreat/wipe/death intents after exact engine actions. |
| 2026-08-11 | SESSION-45 routed GEAR equip/unequip/junk UX through M18/M25 transactions, preserving cap/CORRUPT permanence and one-swap combat policy without altering rule APIs. |
| 2026-08-11 | SESSION-46 drove TECH and LOOT UI actions through M20/M22/M25 rule APIs, including no-preview RNG consumption for overclock and cap-preserving loot pickup. |

<!-- walls-npc-docks SESSION-02 (Jikijitsu append) -->
- **M24 Combat Rules (walls-npc-docks S02):** public `pathToward(combatState, actor, targetId, maxSteps, desiredRange)` — greedy legal path toward a combatant, zero RNG, `null` when no forward progress; `executeMove` targetId fallback now walks up to `MOVE_RANGE=5` steps stopping at Chebyshev `desiredRange` (default 1). Per-step OA, moveAvailable consumption, lethal-OA cancellation preserved; internal `stepToward` retained for future stepwise callers.
- **M23 Enemies Rules (walls-npc-docks S02):** `enemyAI` move actions carry `desiredRange: OPTIMAL_RANGE[behavior] ?? 1`; echoes/hunts/threshold-elites covered via the shared resolveTurn fallback. Panicked flee stays single-step; "1 MV" display = one move ACTION, unchanged.

<!-- combat-and-overworld-clarity-pass SESSION-03 (Jikijitsu append) -->
### M91 — Encounters (SESSION-03 delta, 2026-08-19)

`carveWindow(floorCells, contact)` return shape unchanged: `{ originX, originY, width: 8, height: 16, cells }`. Internal algorithm now:

1. **Scoring loop.** Enumerates up to 25 candidate origins in a Chebyshev-2 ring around the contact-centered origin. Each candidate clamps to grid bounds and deduplicates. Score = `openCells * 4 - oneWideCorridors * 3 + min(2, twoByTwoRegions) * 8`. Ties broken by smaller Chebyshev distance to the unclamped center, then `(originY, originX)` lexicographic. Pure — no PRNG, no floor-cell mutation.
2. **Post-carve widening.** If the winning window has fewer than `OPEN_CELL_TARGET = 48` open cells, `widenWindow(cells)` runs up to `MAX_WIDENING_PASSES = 3` inside the CARVED WINDOW ONLY (`floor.cells` is never touched). Pass 1: connector — flood-fill open regions, BFS the shortest interior wall chain between the two largest, open the chain plus one perpendicular neighbor per chain cell (2-wide corridor). Border cells never opened. Passes 2–3: perimeter — open every interior wall cell adjacent to the largest region. Loop short-circuits when `openCells ≥ 48`, giving idempotence for the common case where the target is reachable.
3. **New helper `countOneWideCorridorsIn` inlined.** Mirrors SESSION-02's `src/floor/validator.js:countOneWideCorridors` (rules layer must not import from floor layer). Both must stay in sync; a comment in `encounters.js` cites the source function by name.
4. **New export `windowMetrics(floorCells, originX, originY)`** — `{ openCells, oneWideCorridors, twoByTwoRegions, cells }`. Used by scoring and by tests. Pure.

`deployBands` contract unchanged. Spacious cells give it more room; existing anchor-pair separation logic naturally uses them (verified: Chebyshev separation ≥ 8 on widened corridor floors, ≥ 9 on `contactWindowFloor`).

<!-- combat-and-overworld-clarity-pass SESSION-05 (Jikijitsu append) -->
### M24 (Combat Rules) — SESSION-05 audit fixes + protocol range hook

- **`getLegalActions.retreat`** (AUDIT-4): now gated on `actor.ap > 0`. The rules-level
  `executeAction` guard at combat.js:243 already returned `no-ap` for the execution path;
  the legal-action list stopped advertising retreat so the console button disables cleanly.
- **`getLegalActions.swap`** (AUDIT-6): now requires at least one adjacent (Chebyshev 1)
  living side-mate. New private helper `hasAdjacentSwapPartner(combatState, actor)` mirrors
  `executeSwap`'s adjacency + liveness check. Solo actors and far allies never see the SWAP
  button. `executeSwap`'s runtime guards remain unchanged (defense-in-depth).
- **`executeProtocol` protocol-range hook** (AUDIT-2): after the `target.hp <= 0` check, if
  `Number.isFinite(protocolData.range)` AND both actor and target have positions, verifies
  `distanceCells(actor.position, target.position) <= protocolData.range` and returns
  `{success:false, reason:'out-of-range'}` on failure. Every shipped protocol in
  `data/protocols.json` declares `range` as a human-readable string ("SIG×2", "adjacent"),
  so `Number.isFinite` is false today and the gate is a no-op. Future numeric ranges become
  live without another code change.
- **Audit findings 1, 3, 7, 8, 9** (AUDIT-1/3/7/8/9): documented in `tests/rules/combat-audit.test.js`, confirmed correct-as-shipped. AUDIT-5 is a cross-session read-only finding routed to SESSION-04's exploration.js (already handled pre-emptively there via `moveParty` ordering).

<!-- SESSION-01 — combat-and-ux-feedback-pass, 2026-08-24 -->

### M91 Encounters — public API additions and hydration ownership

- `createStandardEncounter(floor, contact, party, enemies, rngCursor, options)` gained an
  optional 6th arg `{ enemiesData, depth }`. Backward-compatible: existing 5-arg callers still
  work, but the standard-encounter branch now hydrates each spawn stub before deploying it,
  so callers should pass `options.enemiesData` (from the data-loader registry) and
  `options.depth` (usually `runState.depth`) to get real archetype hp/defense/attributes.
- New export `hydrateSpawn(spawn, depth, rngCursor, enemiesData)` — turns a bare floor spawn
  stub into a combat-ready actor via `createEnemy`/`createEcho`. Idempotent (already-hydrated
  actors pass through) and tolerant of missing `enemiesData` (raw spawn returned rather than
  crash). Ownership: this used to live only in `./src/ui/screens/combat.js` (`normalizeEnemySpawns`,
  reachable only from `fallbackEncounter`); moved into M91 so both encounter constructors
  hydrate at their source instead of relying on downstream UI to backfill stats.
- New export `gatherChainedSpawns(activeSpawns, contactPoint, contactSpawn)` — transitive
  closure that groups nearby hostiles into the same encounter around a contact point.
  Constants `CHAIN_ANCHOR_RANGE=2` (mirrors `HOSTILE_CONTACT_RANGE` in
  `./src/exploration/movement.js`), `CHAIN_LINK_RANGE=3`, `MAX_CHAIN_ADDITIONAL=6` (7 total).
- `createHuntEncounter` now hydrates internally via `hydrateSpawn`; its signature is
  unchanged.

<!-- SESSION-02 — combat-and-ux-feedback-pass, 2026-08-24 -->

### M24 (Combat Rules) — new export from `src/rules/combat-geometry.js`

- `hasLineOfSight(lattice, from, to) → boolean` — true unless the supercover trace's interior threads through a solid wall cell (`corner: false`); grazed corners (`corner: true`) never block, preserving `getEdgeCoverBonus`'s cover-only semantics. Unpositioned callers (`!from || !to`) and null lattice → true, matching `performAttackRoll`'s `positioned` short-circuit and protocol targeting's null-context pass-through.

### M24 (Combat Rules) — attack-log `range` sub-object gained a `reason` field

- Log entry produced by `performAttackRoll` (`src/rules/combat.js`) now emits `range: { distance, band, legal, reason }` (was `{ distance, band, legal }`). `reason` mirrors the string returned by `evaluateRange` / the new LOS gate: `'in_range'`, `'beyond_maximum'`, `'invalid_distance'`, `'not_a_weapon'`, `'minimum_range_penalty'`, `'unpositioned'`, or `'no_line_of_sight'`. Downstream consumers (UI console log, SESSION-03's `previewForTarget`) key off this string exactly — matches the pre-existing `REASON_LABEL` map at `src/ui/console/combat.js:112-121`.

### M24 (Combat Rules) — ranged weapon attacks now gated on LOS

- `performAttackRoll` (`src/rules/combat.js`) hard-blocks non-melee attacks whose straight-line trace passes through a wall cell: `range.legal = false`, `range.reason = 'no_line_of_sight'`, no damage, no d20 → damage-die rolls. Melee (`weapon.rangeBand === 'adjacent'`) is exempt by construction. `coverBonus` is still computed and logged so the UI can explain what the wall would have contributed to a legal shot.

### M23 (Enemies Rules) — `engageRange` respects LOS

- Private `engageRange(enemy, combatState, target)` gained a third parameter (was `engageRange(enemy, combatState)`). Choir (band 3) and Null (band 2) ranged branches now require LOS to `target.position` from `enemy.position` through `combatState.window`; wall-blocked → falls through to melee range 1 so the AI closes distance instead of attempting an action the weapon-attack / protocol-cast paths would refuse. Missing target/positions/window → LOS check skipped (behavior matches pre-LOS).
