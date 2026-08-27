# Architecture Detail — Floors and Exploration

## Modules

| IDs | Area | Public Surface |
|---|---|---|
| M26–M29 | Floor pipeline | Eight archetypes, modifiers, six-check validation, deterministic accepted floor |
| M30–M32 | Exploration | Lattice model, true shadowcasting/fog, movement/interrupt/danger processing |

## Contracts

```js
export function generateFloor(worldSeed, floorNumber, options, themesData) {}
export function validateFloor(floor) {}
export function createLattice(floor, savedDiff = null) {}
export function computeLOS(lattice, x, y, radius) {}
export function moveParty(lattice, fogState, direction, rngCursor, runState, options) {}
export function tickDangerClock(runState, steps, context) {}
```

`generateFloor` returns a validated floor with `floorSubSeed`, `entryPoint`, `descentPoint`, stable container/enemy IDs, `themeId`, `archetypeId`, applied modifier IDs, threshold metadata, and generation diagnostics. It never returns an invalid fallback.

## Determinism

- Floor candidate N/sub-seed K derives from `hash(worldSeed, generationVersion, N, K)`.
- Regeneration does not consume or perturb combat/event draws.
- Saved `floorSubSeed` is honored on load; saved diff is applied after deterministic regeneration.
- Threshold theme exclusion uses `themesSeen` from RunState; with the same prior run state it resolves identically.

## Exploration Invariants

- Grid is exactly 20×32; combat view is an 8×16 window into the same cells.
- Diagonal movement is legal only when at least one orthogonal edge is open, matching the approved corner rule.
- Fog runtime values are 0/1/2, while portable persistence stores the 640-bit visited bitmap and recomputes current LOS.
- Discovery interrupts fire once per entity; descent occurs only by deliberately entering/confirming the descent cell.
- Danger advances only during exploration and defers a hunt if combat is active.

## Baseline Audit (2026-08-10)

- The current generator caps validation at ten attempts and may return an invalid floor.
- Several archetype IDs/algorithms do not match the eight required forms, applied modifier IDs are not returned, threshold guarantees are absent, and the current LOS is ray casting rather than shadowcasting.
- Current exploration initializes position from generated descent geometry instead of the saved party position and ignores hunt results.

## Change History

| Date | Change |
|---|---|
| 2026-08-11 | SESSION-54 measured the M26–M29 generator across 1,000 fixed seed/depth samples: all outputs validated, all archetypes/themes appeared, max accepted sub-seed attempts was 7, and p95 generation time was 0.270ms. |
| 2026-08-11 | SESSION-51 fixed integration restoration by honoring requested `floorSubSeed` directly and selecting the floor entry point from actual open cells; exact restore now depends on the prior `themesSeen` set recorded before the current floor theme was added. |
| 2026-08-09 | Initial M26–M32 registry. |
| 2026-08-10 | Clarified pure sub-seed generation and saved-diff restoration. |
| 2026-08-11 | SESSION-43 exported visible-cell `computeExplorationProximity`, honored discovery/damage quick toggles, and wired exploration screen fog from 640-cell runtime state synced to the 80-byte RunState bitmap. |
| 2026-08-19 | SESSION-02 (combat-and-overworld-clarity-pass) widened corridors to 2 cells default across all eight archetypes, added `corridor-width` validator check (cap 12), raised `MAX_CANDIDATES` 100→200, and exposed non-enumerable `diagnostics` on generated floors. See "Floor Generation Width Contract" below. |
| 2026-08-19 | SESSION-04 (combat-and-overworld-clarity-pass) added session-scoped hunter overrides + cache culling to the lattice; `stepHunters` and `pruneEmptyCaches` in movement; `DEFAULT_LOS_RADIUS` 8→10; camera-lock in exploration screen (`centerOnPartyIfIdle`); playfield renders via `getActiveContainers`/`getActiveEnemySpawns` (culled + hunter-position aware). See "Overworld Hunt + Cull + Camera Lock" below. |

<!-- SESSION-02 -->
## Floor Generation Width Contract (SESSION-02, 2026-08-19)

### M26 `src/floor/archetypes.js`
- **Exports added:** `carveCorridor(grid, x1, y1, x2, y2, value = 1, width = 2)`,
  `widenOneWideCorridors(grid)`.
- `carveCorridor` now paints a `width`-cell strip perpendicular to the walking
  axis (default `width = 2`) plus a 2×2 landing patch at the destination.
  Passing `width = 1` reproduces legacy single-cell behaviour. Never overwrites
  cells whose value exceeds `value` (leaves already-placed features intact).
- `widenOneWideCorridors(grid)` runs a one-shot deterministic dilation pass:
  any open cell whose only two open ortho-neighbours are collinear (N+S or
  E+W) gets one perpendicular neighbour opened (prefer west for N/S, north
  for E/W). Widen-set computed upfront so cascades cannot chain.
- Room ranges widened across all eight archetypes; `generateMazes` runs
  `widenOneWideCorridors` after DFS + connective corridors so the maze itself
  is no longer 1-cell wide. `generateSpines` paints spines 2 cells wide.
- Cell-type contract unchanged (0/1/2/3). `GRID_W`/`GRID_H` unchanged.

### M27 `src/floor/modifiers.js`
- **Exports added:** `TIGHT_MODIFIER_IDS` (Set).
- Non-tight wall-adding modifiers now run `widenOneWideCorridors` after
  placement. `dense` is marked TIGHT (its purpose is to narrow) and skips the
  widening pass; `dangerous` widens after its pit placement; `sparse` is not a
  wall-adder and is unchanged.
- Return shape and PRNG draw order unchanged.

### M28 `src/floor/validator.js`
- **Exports added:** `countOneWideCorridors(grid)`, `MAX_ONE_WIDE_CORRIDOR = 12`.
- **New failure id:** `'corridor-width'` — fired when a candidate floor has
  more than `MAX_ONE_WIDE_CORRIDOR` collinear-neighbour open cells.
- **New metric:** `metrics.oneWideCorridors: number`.
- `interior-cover` refined: `openArea < 40` → `openArea < 60` to reflect the
  wider-room baseline.

### M29 `src/floor/generator.js`
- **Exports added:** `MAX_CANDIDATES` (raised 100 → 200), `REPAIR_THRESHOLD` (50).
- Repair-fallback path bypasses the `corridor-width` check — a candidate whose
  only failure is `corridor-width` is accepted so the generator always
  terminates with a valid floor. Other failure ids still gate the repair pool.
- Returned floor gains a **non-enumerable** `diagnostics` property so deep
  equality comparisons of floor content still succeed. Shape:
  `{ attempts, repaired, failures, corridorWidthFailures }`.

### Contract with M91 (`src/rules/encounters.js`)
- `countOneWideCorridors` in M28 is the canonical definition. The mirror
  `countOneWideCorridorsIn` inlined in M91 must stay in sync (same
  "exactly-2 open ortho neighbours, collinear pair" rule).

<!-- SESSION-04 -->
## Overworld Hunt + Cull + Camera Lock (SESSION-04, 2026-08-19)

### M30 `src/exploration/lattice.js`
- **Exports added (on the createLattice closure):**
  - `setHunterPosition(id, { x, y })` — record a hunter override for spawn `id`. Returns `false` on invalid input.
  - `getHunterPosition(id)` — returns `{ x, y }` copy or `null`.
  - `markCulled(kind, id)` — `kind ∈ { 'container', 'enemy' }`. Returns `false` on unknown kind.
  - `isCulled(kind, id)` — matching predicate.
- **Semantics changes:**
  - `getActiveContainers()` now also filters cells marked culled.
  - `getActiveEnemySpawns()` filters culled AND applies hunter overrides — the returned spawn objects carry the moved `{ x, y }`, not the spawn cell.
  - `isOccupied(x, y)` honors hunter overrides (the moved cell is the truthy one).
- **Non-persisted state:** hunter overrides + cull sets live in the closure only. Save-restore returns enemies to spawn cells; the hunt loop re-engages. Persistence deferred per Custom Rule 13.

### M32 `src/exploration/movement.js`
- **New exports:** `stepHunters(lattice, runState)`, `pruneEmptyCaches(lattice, runState, floor, data)`, `HUNT_ACTIVATION_RANGE = 8`.
- **Constant change:** `DEFAULT_LOS_RADIUS` 8 → 10 (sig × 2 override unchanged).
- **`stepHunters` contract:** each active, undefeated spawn within `HUNT_ACTIVATION_RANGE` Chebyshev takes ONE BFS-shortest step toward the party. Deterministic (spawn.id ascending; `DIRECTION_ORDER` tiebreak). Walls, closed-corner rule, party cell, and other hunter cells all block. Blocked hunter stays put. RNG-free. Returns `{ moved: [{id, from, to}], contactSpawnId }`.
- **`pruneEmptyCaches` contract:** for each unopened, unculled container, runs `generateLoot(runState.worldSeed, runState.depth, floorId, container.id, themeLootBias, equipment, affixes, consumables, { containerType: container.kind })`. If it returns `[]`, marks the container culled on the lattice. Reserves a `spawn.hasDrop === false` hook for a future enemy-drops feature. No-op if `data.equipment`/`.affixes`/`.consumables` missing.
- **`moveParty` ordering:** party move → LOS refresh → `stepHunters` → `findDiscoveries` → contact detection. A hunter that closes to Chebyshev-1 on the same tick triggers combat before the tick ends.
- **Dedup key change:** `_contactedHostiles` and `_knownHostiles` now key by `spawn.id`, not `${x},${y}` — required because hunter movement changes positions each tick.
- **Interior helpers:** `nearestConnectedHostile`, `findDiscoveries`, `computeExplorationProximity` now iterate `lattice.getActiveEnemySpawns()` / `lattice.getActiveContainers()` (culled- and hunter-position-aware) with `runState.defeatedEnemies`/`runState.openedContainers` as the runtime authority (lattice snapshot lags mid-run combat updates).

### M58 `src/ui/playfield.js` (consumer of M30)
- `renderExplorationImpl` now walks `lattice.getActiveContainers?.()` and `lattice.getActiveEnemySpawns?.()`. Culled containers/enemies never render; hunter-overridden spawns render at their moved cell. Rest of the pipeline unchanged.

### M70 `src/ui/screens/exploration.js` (consumer of M30/M32)
- **Retired:** `ensurePartyVisible` (margin-based auto-follow) + the `suppressFollow` + `AUTO_FOLLOW_MARGIN_CELLS` constant.
- **Added:** `centerOnPartyIfIdle()` (camera snaps center to party unless `userAdjusted`). `userAdjusted` mirrors the combat screen's `syncSelectionActor` pattern — set true on viewport `onChange` (user pan/zoom) and reset false on every successful party move.
- **Added at mount:** `pruneEmptyCaches(lattice, runState, floor, data)` runs before the first LOS refresh so culled containers never enter the discovery/interrupt path. Guarded on `data.equipment && data.affixes && data.consumables` for headless tests.

### Cross-module contract note
- `pruneEmptyCaches` deliberately takes `floor` as a fourth argument (not documented in the SESSION-04 prompt's `(lattice, runState, data)` signature) because the lattice does not expose `floorSubSeed` / `themeId` and the exploration screen has direct access. Callers pass the same `floor` object handed to `createLattice`.
