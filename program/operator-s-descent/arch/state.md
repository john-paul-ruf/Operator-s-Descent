# Architecture Detail — State and Portable Saves

## Modules

| IDs | Area | Owns |
|---|---|---|
| M33–M35 | Run/event/condensation | Canonical RunState, bus, semantic symbol lookup |
| M36–M42 | Compression/obfuscation | Lossless framed passes and XOR stream |
| M43–M46 | Persistence | Save encode/decode, library/settings, party blueprints |
| M88–M89 | Binary ABI | Bit primitives and versioned save schema |

## RunState Contract

RunState contains every non-regenerable fact, including a compact active-combat snapshot when a full-state link is copied during combat. Mutators validate bounds and return explicit results. Serialization returns a canonical plain object; deserialization treats every field as untrusted.

```js
export function createRunState(worldSeed, party, options = {}) {}
export function deserializeRunState(data, options = {}) {}
export function encodeRun(runState) {}
export function decodeRun(fragment) {}
export function encodeSeed(worldSeed) {}
export function decodeSeed(fragment) {}
```

## Save v2 Frame

```text
magic | saveVersion | tableVersion | flags | layer descriptors | encrypted payload | CRC32
```

- M89 writes bounded bit fields/varints through M88; it never serializes JSON text.
- M35 uses field-specific symbol indices with collision-safe canonical-value verification and escape-coded raw values.
- Every M36–M40 pass is independently reversible for all byte values; dictionary bytes/lengths are stored in the frame.
- Compression happens before XOR. CRC covers the complete authenticated frame bytes selected by the version contract.
- Decoder classifies `truncated`, `version_mismatch`, `checksum_failed`, and `malformed`, and recovers the world seed whenever the validated header still contains it.
- v1 decoder compatibility remains until a deliberate migration removal.

### Binary Payload API

`src/state/save-schema.js` exposes `RUN_SCHEMA_VERSION`, `encodeRunPayload(runState)`, and `decodeRunPayload(bytes, bitLength, options)`. Its fixed field order writes schema/table identifiers and the fixed-width world seed first, followed by floor diff, party, inventory, run-wide state, Echoes, RNG streams, flags/stats/log, extensions, and optional active combat.

## Storage Invariants

- `od_run_<key>` stores exactly the same fragment payload used by `#r=`.
- Run index fields are defensively migrated and preserve unknown keys.
- Wipe deletes mutable state but preserves an index tombstone with the seed.
- Party blueprints are versioned, limited to ten, validated against current gates/costs, and never included in RunState.
- `blueprintFromDraft(draft, data, name)` and `draftFromBlueprint(blueprint)` bridge saved party configurations to M92 creation drafts without adding depth, HP, inventory, RNG, or other run state.

## Baseline Audit (2026-08-10)

The current condenser writes JSON bytes and does not use symbol tables. Compression layer dictionaries are not framed, several passes are not escape-safe, and current budget tests explicitly accept `save_too_large` for valid 100-item states. RunState Echo timing is nondeterministic and omits exact active-combat portability.

## Change History

| Date | Change |
|---|---|
| 2026-08-11 | SESSION-54 compacted common operator/enemy/encounter identifiers inside the v2 binary save codec, preserving decoded IDs while keeping the legal deep active-combat/two-Echo boundary fixture at 1,476 URL-fragment characters. |
| 2026-08-11 | SESSION-53 preserved canonical portable `creationTimestamp` for imported `#r=` links while attaching a non-enumerable local run key for library storage/deletion, and extended decoder seed recovery to readable v2 structural/checksum failures used by browser diagnostics. |
| 2026-08-11 | SESSION-51 added `RunState.extensions.floorThemeId` as compact current-floor restore metadata and canonicalized inventory item copies so generated loot unknowns survive round-trip under bounded item extensions. |
| 2026-08-11 | SESSION-49 added M34 event contract descriptions/validators, runtime autosave success/failure events, and route/runtime lifecycle notifications while preserving unknown-event compatibility for tests and future intents. |
| 2026-08-11 | SESSION-48 documented persistence-screen behavior: library loads validate saved payloads before resume, import writes fresh local identities, and scorecard deletes mutable run state while preserving seed-only sharing. |
| 2026-08-11 | SESSION-47 documented front-door persistence use: `tutorialDeclined` suppresses only the automatic offer, and Settings UI writes only the final enumerated schema while preserving existing `system`/`reduce`/`full` normalized motion values. |
| 2026-08-09 | Initial v1 modules. |
| 2026-08-10 | Added M88/M89 and established save v2 as the completion target. |
| 2026-08-10 | Added M89's ordered v2 binary payload with canonical validation and bounded hostile-input decoding. |
| 2026-08-11 | SESSION-41 added creation-draft/blueprint adapters and exact point accounting validation for saved party configurations. |
| 2026-08-11 | SESSION-45 documented RunState-facing PARTY/GEAR mutations: only successful equipment/junk transactions update the injected RunState; CORRUPT ledgers remain permanent and scrap changes use `addScrap`. |
| 2026-08-11 | SESSION-46 wired LOG copy-link generation to M43 `encodeRun`, keeping full-state sharing living-run-only and LOG retention presentation-bounded unless present in canonical `recentEvents`. |

<!-- SESSION-01 (saves-never-fail, 2026-08-24) -->

### Module Registry deltas (saves-never-fail SESSION-01)

**M13 Sigils/Symbol Table** — no version bump this cycle (see D8 note below), but adds `data/symbol-table.v6.json` as the frozen v6 snapshot (byte-identical copy of the current v1 symbol-table.json). Custom Rule 13 hygiene — future symbol-table version bumps get a starting snapshot; the registration mechanism is exercised inline via CALIBRATION_OPTION_IDS/EVENT_TYPE_IDS enums in save-codecs.js rather than a table-version bump (see D8 amendment below).

**M22 Loot Rules** — v7 short id format: `l<31-bit-hash-base36>-<idx%8>` (≤9 chars, was `loot-<hash>-<idx>` ~15 chars). Same hash inputs — determinism preserved. Also stripped the redundant `rarityTier` field from emitted items (derivable from `rarity` via `RARITIES.indexOf(item.rarity)`); loot-rules callers now derive locally. Both changes are wire-cost reductions with no runtime semantic change.

**M25 Inventory Rules** — INVENTORY_CAP 100 → 40 (single program-wide source; imported by M33 and M89 instead of duplicated). Sized by CP4 budget model.

**M33 Run State** — imports INVENTORY_CAP from M25. MAX_EVENTS 64 → 24, MAX_CORRUPT_IMPLANTS 118 → 32, MAX_COMBAT_BYTES 12288 → 8192 (CP3 hypothesis 4096 raised after direct-measurement showed legal 24-actor combat JSON is ~6650 bytes). NEW: runtime caps split from legacy load-tolerant bounds (LEGACY_MAX_INVENTORY 100, LEGACY_MAX_EVENTS 64, LEGACY_MAX_CORRUPT_IMPLANTS 118, LEGACY_MAX_COMBAT_BYTES 12288) so the frozen v3/v4/v5/v6 readers' `deserializeRunState` calls still accept legacy oversized state; the v6→v7 migration hop clamps to runtime caps. Without this split, every pre-v7 save with >40 items would dead-end at load, violating Custom Rule 13.

**M43 Save Encode** — new export `SAVE_BUDGET` (raised 1500 → 1900 per owner D9, single source for every consumer: import screen, LOG copy label, migration corpus test, release gate). Internal `BUDGET` aliased to `SAVE_BUDGET`. `EVENT_TRIM_LADDER` rebased to `[24, 16, 8, 4, 2, 1, 0]`.

**M44 Save Decode** — v6 registered in `FROZEN_READERS`. From CP2 onward, v6 fragments route through `readV6Payload` + the `v6→v7` clamping migration; the covenant is enforced by `tests/state/save-migration-corpus.test.js`.

**M89 Save Schema** — `RUN_SCHEMA_VERSION` 6 → 7. Imports INVENTORY_CAP from M25 (via `../rules/inventory.js`). Caps mirror M33. NEW top-level loot-id pattern codec (`writeCompactId`/`readCompactId`) applied to `appliedCorruptItemIds` and `affixFloorLedger.reroll`/`floorEntry`. `writeItem`/`readItem` in save-codecs.js gained: loot-id pattern codec (as `writeItemId`), corruptionValue 1-bit `is-default 0.1` enum, salvageValue 1-bit `is-integer` + varUint path. Combat actor position packed to 3+4 bits (fixed 8×16 window). Calibration `optionId` symbolized via inline `CALIBRATION_OPTION_IDS` enum. `EVENT_TYPE_IDS` enum exported for future compression-aware use (recentEvents currently uses generic writeValue — the compact codec was tried and reverted: verbose keys compress better).

**M105 Save Migration** — new hop `src/state/migrations/v6-to-v7.js` registered in `save-migrate.js`. Clamp policy (D2):
  - inventory: sort non-junk before junk, then salvageValue desc; keep INVENTORY_CAP units; overflow salvaged into scrapCounter
  - ledger: still-held-first-then-newest; truncate to MAX_CORRUPT_IMPLANTS
  - events: keep newest MAX_EVENTS
  - activeCombat: null if snapshot exceeds MAX_COMBAT_BYTES OR any actor coord falls outside the new 8×16 window (early v3-caster-combat with actor.x up to 10)
  - Up to 2 `system`-typed chronicle events appended announcing the compaction

**M106 Version Readers** — new frozen pair `src/state/versions/read-v6.js` + `codecs-v6.js` (pinned to `V6_SCHEMA_VERSION=6` and `V6_TABLE_VERSION=1` forever, per Custom Rule 13). New committed fixtures under `tests/fixtures/save-versions/`: `v6-midrun.txt`, `v6-combat.txt`, `v6-maxed.txt`.

### FORGE-CONFIG amendments needed

- **Custom Rule 6** — replace body with: *"[AMENDED via saves-never-fail SESSION-01] — encoded run state must be < **1900** characters (raised from 1500 by owner directive 2026-08-24 — saves are URL fragments that never traverse a server; total URL ≈ 1,950 stays under the ~2,048 universal interop floor). The budget is the sole save budget for every transport (localStorage and URL), exported as `SAVE_BUDGET` from `src/state/save-encode.js` — the import screen, LOG copy label, and release gate import it; no re-literaled budget numbers. Gameplay caps (M25 `INVENTORY_CAP`, M33/M89 event/ledger/combat bounds) are sized by the budget model (`./tests/state/save-budget-model.test.js`) so the reachable apex encodes ≤SAVE_BUDGET without dead-ending; the ladder trims events as emergency slack. Any new persisted field, cap increase, or budget change must re-run the model."*

### D8 amendment (STATE.md, informational — Jikijitsu may want to record)

The session's original D8 plan called for a symbol-table v1→v2 bump introducing three new tables (`calibration_option`, `stat_key`, `event_type`). That plan required updating `src/data-loader.js` (`validateSymbolTable`, `SYMBOL_TABLE_IDS`) and `tests/data/contracts.test.js` — neither in this session's lease. To stay in-lease, the equivalent compaction landed as inline codec enums in `src/state/save-codecs.js` (`CALIBRATION_OPTION_IDS`, `EVENT_TYPE_IDS`), matching the existing `CONDITION_IDS` pattern. `stat_key` was skipped — item.stats is empty in practice for generated loot; a dedicated persisted-event codec was drafted and reverted (compact form defeated the progressive-compression stack: verbose keys compressed to zero, compact form left nothing for the reducer to exploit — net regression ~15-30 chars per 8-event tail). Table version stays at 1; `data/symbol-table.v6.json` is committed as a byte-identical snapshot for Custom Rule 13 hygiene and future use.

<!-- SESSION-02 (saves-never-fail, 2026-08-24) -->

### M45 Library — public API deltas

- `saveRun(runState, metadata)` result now carries `metrics` (encoder metrics passthrough — `{rawBytes, compressedBytes, layers, eventsKept, eventsDropped}`) and, when the quota-recovery ladder freed space, an `evicted: string[]` of archived-run keys removed to fit the live save.
- `loadRun(key)` gains a `seed_only` error branch: when the stored payload does not decode as a run but does decode as a bare seed encoding, returns `{success: false, error: 'seed_only', recoveredSeed}` per Custom Rule 13's versioned-saves-never-dead-end floor.
- Quota-recovery ladder (internal): orphan sweep → dead-index sweep → oldest-`lastPlayed` eviction (never the current run, cap 8 per save). Failed `setItem` remains a no-op on the prior stored value (browser semantics).

### M34 Bus — contract descriptions (validators unchanged, backward-compatible)

- `state:autosave-complete` description extended: payload now includes encoder `metrics` and (when non-empty) `evicted` keys.
- `state:autosave-failed` description extended: payload carries named `error` + raw storage `result` — the LOG chronicle surfaces this as a semantic-error entry.

### M86 Hot Runtime — internal API

- `commitAutosave` now emits ONE persisted-event notice per severity change: `error` for failure, `system` for eviction, `system` for compaction (metrics.eventsDropped > 0). Module-level `lastAutosaveNotice` gates repeats; cleared on a clean save and on `shutdownRuntime`. Notice message strings are clamped ≤ `PERSISTED_EVENT_MESSAGE_MAX` (72 chars). Notice is recorded on the saved runState (not module-level `currentRunState`, which may be null on save-only checkpoints).
