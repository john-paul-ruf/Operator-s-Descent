# Architecture Detail — Foundations and Data

## Modules

| IDs | Area | Public Surface |
|---|---|---|
| M01–M03 | Determinism | `createPRNG`, `hash`, `createRNGCursorForRun` |
| M04–M13 | Static content | Versioned JSON registries for sigils, themes, classes, protocols, enemies, equipment, affixes, conditions, consumables, and symbols |
| M14 | Sigil asset | Project-owned `./assets/descent-sigil.woff2` |
| M87 | Data loader | `loadGameData()`, `validateGameData()`, `getGameData()` |

## Structure and Dependency Rules

- `./src/core/` is pure deterministic logic and imports no browser, UI, state, or data modules.
- `./data/*.json` is immutable runtime content. Every file has an integer `version` and is validated before the hot runtime mounts.
- `./src/data-loader.js` is dynamically loaded after START. It may fetch data, validate cross-file IDs, freeze the registry, and return structured errors; it must not run from the cold bootstrap.
- `./assets/descent-sigil.woff2` contains only the 72 mapped PUA glyphs plus `.notdef`; all authored outlines originate in M93.

## Contracts

```js
export function createPRNG(seed) {}
export function hash(...values) {}
export function createRNGCursorForRun(worldSeed, savedState = null) {}

export async function loadGameData(fetchImpl = fetch) {}
export function validateGameData(registry) {}
export function getGameData() {}
```

`validateGameData` returns `{ valid, errors }` and checks counts, versions, stable IDs, cross-references, numeric bounds, PUA disjointness, and safe-pool exclusion.

## Conventions

- World/floor/gameplay randomness uses M01–M03 only. `Math.random()` is limited to a fresh world-seed source, ambient audio texture, and ambient visual glitch.
- Hashed sub-seeds do not advance the combat stream.
- JSON IDs are lower snake case and are portable-save ABI once v2 ships.
- Static content failures surface a named boot error; never continue with partial data.

## Baseline Audit (2026-08-10)

- M01–M13 exist and current contract tests pass.
- Data loading currently occurs before START and lacks full schema/version validation.
- The symbol table has 324 entries rather than the documented near-exhaustive table.
- M14 now contains a valid generated baseline WOFF2; later typeface sessions refine glyph quality and target size.

## Change History

| Date | Change |
|---|---|
| 2026-08-09 | Initial registry created. |
| 2026-08-10 | SESSION-35 integrated the accepted production font and bank enforcement. |
| 2026-08-10 | Added M87 and made strict post-START loading authoritative; original font confirmed in scope. |
| 2026-08-10 | SESSION-28 replaced the placeholder with the generated baseline DESCENT SIGIL WOFF2. |
