# Database Design — Operator's Descent

## Engine

This game has **no backend, no server-side database, and no ORM**. All persistence is client-side. The architecture (per `specs/architecture.md`) defines three distinct data layers:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Run Library & Settings | `localStorage` (browser key-value store) | Persistent, device-local storage for multiple runs, settings, and saved party configurations |
| Game Content | Static JSON files (`data/*.json`) | Lookup tables loaded via `fetch()` on first load, cached by service worker. The single source of truth for all game content — classes, themes, enemies, equipment, protocols, etc. |
| Portable Saves | URL fragment (`#r=` / `#w=`) | Compact, encoded run state (< 1500 chars) for cross-device save sharing |
| Session Routing | URL fragment (`#a=`) | Canonical route + resume hint (`save=current`, `seed=<b32>`, `from=<route>`) written by the history controller so Back/Forward/reload land on the right screen |

There are no SQL migrations. "Migrations" in this context means:
- **Save encoding versioning**: A version byte in the URL fragment header. Old saves are decoded against their version's symbol table; incompatible versions produce a named `version_mismatch` error.
- **localStorage key namespacing**: All keys are prefixed `od_` to avoid collisions. If the schema changes, new keys are introduced and old keys are migrated on load by `state/library.js`.
- **Static data versioning**: Each `data/*.json` file carries a `version` field. The game validates the version on load. If a data file's version is incompatible, the game fails with a clear error.

---

## Schema Overview

```
┌─────────────────────────────────────────────────────────┐
│                    localStorage                          │
│                                                          │
│  od_runs          → JSON array of LibraryEntry objects    │
│  od_run_<key>     → Encoded RunState (base64url string)  │
│  od_settings      → JSON Settings object                  │
│  od_flags         → JSON object of boolean flags          │
│  od_party_configs → JSON array of PartyBlueprint objects  │
│  od_party_config_last_used → string (config name | null)  │
│                                                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Static JSON Data Files (data/)              │
│                                                          │
│  sigils.json      → PUA codepoints, safe pool, metadata   │
│  themes.json      → 12 environment theme definitions      │
│  classes.json     → 6 class definitions                   │
│  protocols.json   → 20 protocol definitions              │
│  enemies.json     → 8 enemy archetype stat blocks         │
│  equipment.json   → Weapon/armor categories + costs       │
│  affixes.json     → 16 affix definitions                  │
│  conditions.json  → 9 condition definitions              │
│  consumables.json → 7 consumable type definitions         │
│  symbol-table.json → Field-level lookup tables for saves  │
│                                                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│               URL Fragment (Portable Save)               │
│                                                          │
│  #r=<base64url>  → Full run state (mid-run only)          │
│  #w=<base32>     → World seed only (share-world link)     │
│                                                          │
│  Encoded pipeline:                                       │
│    serialize → condense → compress → encrypt → base64url  │
│  Decoded pipeline (reverse):                              │
│    base64url → decrypt → decompress → expand → deserialize│
│                                                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              URL Fragment (Session Routing)              │
│                                                          │
│  #a=<route>[&save=current][&seed=<b32>][&from=<route>]   │
│                                                          │
│  Router: src/router.js (M102)                            │
│  Never written to the network — fragment stays offline.  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### `#a=` Session Routing Schema

**Purpose:** Give Back/Forward/reload a canonical target without expanding what the URL carries. All meaningful run state lives in `localStorage` — `#a=` is a pointer, not a save. The router (`src/router.js`, M102) writes `#a=` on every mount and drives navigation from `hashchange`.

**Grammar:**
```text
#a=<route>[&save=current][&seed=<base32>][&from=<route>]
```

| Field | Values | Notes |
|-------|--------|-------|
| `a` | `title` \| `creation` \| `exploration` \| `library` \| `scorecard` \| `import` \| `tutorial` \| `settings` | `combat` is never written — combat canonicalizes to `exploration` and resumes via `runState.activeCombat` |
| `save` | `current` | Only meaningful for `exploration`. On cold resolve, loads the newest `alive` library entry (optionally filtered by `seed`) |
| `seed` | base32 world seed | Same codec as `#w=` (`encodeSeed`/`decodeSeed`). Written for `exploration`, `creation` (when a seed is preloaded), and `scorecard` |
| `from` | any valid route | Optional return target for `settings` |

**Legacy fragments (`#r=` full-state, `#w=` seed-only) remain first-class:** both are classified by `parseFragment` and consumed by the boot resolver — `#r=` mounts the import screen, `#w=` mounts creation with the preloaded seed. Share links produced by the LOG mode's copy-link action still use `#r=`.

**Write policy:**
- User-driven route change (`ui:navigate` where `screen !== currentRoute`) → `history.pushState`
- Every other mount (combat handoff, floor transition, party wipe, layout re-mount, hashchange-triggered mount) → `history.replaceState`
- If the canonical fragment equals the current hash (in-run `#a=exploration&save=current&seed=…` re-mounts, for example) the write is skipped entirely

**Boot resolution:** the initial hash is parsed once. `#r=`/`#w=`/`#a=…` route through `resolveParsedFragment`; anything unrecognized (or `#a=exploration&save=current` with no matching alive run) falls back to `title` and `replaceState`s `#a=title` so the URL doesn't lie. A bare URL stays bare — no fragment is written until the first user navigation.


---

## localStorage Schema

### Key: `od_runs`

**Purpose:** Index of all runs in the library. Used by `state/library.js.listRuns()`.

**Type:** JSON array of `LibraryEntry` objects.

**Shape:**
```typescript
interface LibraryEntry {
  key: string;              // Composite key: `${worldSeed}_${creationTimestamp}`
  worldSeed: number;        // uint32 — the root seed for deterministic generation
  creationTimestamp: number; // Unix ms — distinguishes multiple runs on same seed
  depth: number;            // Current floor depth reached
  partySigils: number[];    // Array of PUA codepoints (one per character)
  partyClasses: string[];   // Array of class IDs (e.g. ["breacher", "ghost"])
  accentSwatch: string;     // CSS color of current floor's theme (e.g. "#7ec8e3")
  alive: boolean;           // false after party wipe (entry may remain briefly until cleaned)
  lastPlayed: number;       // Unix ms — updated on autosave
}
```

**Constraints:**
- The `key` field is unique across all entries — it is the composite of `worldSeed` + `creationTimestamp`.
- There is no hard cap on the number of runs. `localStorage` total budget (~5–10 MB in most browsers) is the practical limit. Each run state is a few KB, so hundreds of runs are feasible.
- On party wipe, the corresponding `od_run_<key>` entry is deleted, and this index entry's `alive` flag is set to `false`. The entry persists in `od_runs` with `alive: false` so that `getSeed(key)` can still retrieve the world seed for the scorecard's share-world and restart-with-same-seed actions. `listRuns()` filters out entries where `alive: false` — dead runs do not appear in the library listing.

**Migration strategy:** If the `LibraryEntry` shape changes, `state/library.js` validates each entry on load. Entries missing new fields are filled with defaults. Entries with unrecognized fields are preserved (forward-compatible). The `od_runs` key version is not explicitly versioned — the shapes are validated defensively on every read.

---

### Key: `od_run_<key>`

**Purpose:** Full run state for a single run. One key per run. Used by `state/library.js.saveRun()` and `loadRun()`.

**Type:** Encoded string — the same compact base64url encoding used for URL fragment saves (`#r=`). This is NOT stored as JSON. The encoded string is the output of the save encoding pipeline: `serialize → condense → compress → encrypt → base64url` (see [Save Encoding](#save-encoding-versioning--migration-strategy)). The value stored is identical to what would appear after `#r=` in a shareable URL — including the version byte and CRC32 checksum.

**Key format:** `od_run_${worldSeed}_${creationTimestamp}` — e.g., `od_run_12345_1691234567890`.

**Value format:** A base64url string, typically 200–500 characters (well under the 1500-char URL limit). This is dramatically smaller than a full JSON serialization of `RunState`, which would be several KB.

**Constraints:**
- Written on autosave (floor transition, combat resolution). The `saveRun()` call encodes the `RunState` through the same pipeline as URL fragment saves, then writes the resulting string to `localStorage`.
- Deleted on party wipe (`deleteRunState(key)`). The seed is preserved separately.
- Treated as untrusted on load — `loadRun()` decodes through the same pipeline as URL fragment import. Malformed data, checksum failures, or version mismatches fail gracefully and return `null`, never crash the app.
- Because the same encoding is used for both `localStorage` and URL fragments, there is exactly one serialization path to maintain. Any migration logic in `state/save-decode.js` applies equally to both storage layers.

**Migration strategy:** The version byte at the start of the encoded string identifies the save encoding version. If a future version changes the run state shape or symbol table, `state/save-decode.js` applies migration maps during decode, exactly as it does for URL fragment imports. Saves with a version newer than the running game return `version_mismatch` (surfaced as `null` from `loadRun()`).

---

### Key: `od_settings`

**Purpose:** User settings (audio levels, glitch toggle, etc.). Used by `state/library.js.saveSettings()` and `loadSettings()`.

**Type:** JSON object.

**Shape:**
```typescript
interface Settings {
  masterMute: boolean;          // true = all audio off
  layerVolumes: {
    drone: number;              // 0–100
    pulse: number;              // 0–100
    sparkle: number;            // 0–100
    lead: number;               // 0–100
    noiseBed: number;            // 0–100
  };
  glitchEnabled: boolean;       // false = all glitch effects off
  reducedMotion: boolean;       // true = disable glitch + transitions
  scanlineGrainEnabled: boolean; // false = scanlines/grain off (independent of glitch)
}
```

**Constraints:**
- Persisted across sessions.
- Defaults on first load (no key present): `masterMute: false`, all layer volumes `75`, `glitchEnabled: true`, `reducedMotion: false`, `scanlineGrainEnabled: true`.
- Settings list is final and enumerated per FR-34 — no additional settings in v1.

**Migration strategy:** Defensive validation on load. Missing fields are filled with defaults. Unknown fields are preserved.

---

### Key: `od_flags`

**Purpose:** Boolean flags for first-time UX state. Used by `state/library.js.getFlag()` and `setFlag()`.

**Type:** JSON object (free-form key-value).

**Shape:**
```typescript
interface Flags {
  tutorialDeclined: boolean;  // true = tutorial was declined, never re-offer unasked
  // Future flags added here as needed
}
```

**Constraints:**
- `tutorialDeclined` is written when the player declines the tutorial (FR-1, FR-2). Once true, the tutorial is never auto-offered again.
- The tutorial is always manually reachable from the title screen regardless of this flag.

**Migration strategy:** Free-form object. New flags added without version bumps. Unknown flags ignored.

---

### Key: `od_party_configs`

**Purpose:** Saved party configurations (meta-game blueprints). Used by `state/party-configs.js`. Per FR-51.

**Type:** JSON array of `PartyBlueprint` objects (max 10).

**Shape:**
```typescript
interface PartyBlueprint {
  name: string;               // Player-assigned name (text input)
  version: number;            // Game data version when saved (for validation)
  credits: number;            // Unspent points converted to credits (10:1)
  characters: CharacterBuild[];
}

interface CharacterBuild {
  classId: string;            // e.g. "breacher", "ghost", "compiler", "anchor", "oracle", "operator"
  sigilId: string;            // Sigil identifier (maps to PUA codepoint via data/sigils.json)
  attributes: {
    mgt: number;               // 1–10
    fin: number;               // 1–10
    vit: number;               // 1–10
    res: number;               // 1–10
    foc: number;               // 1–10
    sig: number;               // 1–10
  };
  equipment: {
    weapon: string | null;     // Item ID from data/equipment.json, or null
    armor: string | null;      // Item ID, or null
    offhand: string | null;    // Item ID (shield or secondary sidearm), or null
  };
  protocols: {
    school: string;            // "disrupt" | "ward" | "scry" | "rewrite"
    tier: number;              // 1–5
  }[];
}
```

**Constraints:**
- Maximum 10 configurations (FR-51). Attempting to save an 11th returns `{ success: false }`.
- Names are unique. Saving with an existing name overwrites (UI confirms).
- Configurations are meta-game data — NOT part of run state, NOT in URL fragment, NOT affected by party wipe or run deletion.
- Configurations are validated against current game data on load (`validateConfig()`) — if a game update changed class gates, equipment costs, or protocol availability, invalid items are flagged for the player to adjust.

**Migration strategy:** Each `PartyBlueprint` carries a `version` field. On load, `validateConfig(partyBlueprint, currentGameData)` checks the blueprint against current `data/classes.json`, `data/equipment.json`, `data/protocols.json`. Invalid items are returned as a list for the UI to flag.

---

### Key: `od_party_config_last_used`

**Purpose:** Tracks which configuration was last used, so new runs default to it (FR-51). Used by `state/party-configs.js.getLastUsed()` and `setLastUsed()`.

**Type:** `string | null` — the name of the last-used configuration, or `null` if none.

**Constraints:**
- Updated when the player finalizes a run or loads a config.
- On creation screen mount, the screen calls `getLastUsed()` and pre-populates all fields if a value is returned.
- A first-time player (no key, or `null`) starts with a blank creation screen.

---

## Static Data File Schemas

All files are loaded via `fetch()` at game start, cached by the service worker. Each file is a JSON object with a `version` field for forward/backward compatibility.

### `data/sigils.json`

**Purpose:** Single source of truth for PUA codepoint ranges, safe substitution pool, and sigil metadata (FR-5, FR-6).

**Shape:**
```typescript
interface SigilsData {
  version: number;
  playerBank: {
    start: number;           // PUA codepoint start (inclusive)
    end: number;              // PUA codepoint end (exclusive)
    families: {
      [classId: string]: {    // "breacher", "ghost", "compiler", "anchor", "oracle", "operator"
        codepoints: number[]; // 8 codepoints per family
      };
    };
  };
  bestiaryBank: {
    start: number;
    end: number;
    archetypes: {
      [archetypeId: string]: { // "drone", "warden", "stalker", "choir", "null", "construct", "phantom", "apex"
        codepoints: number[]; // 3 codepoints per archetype
      };
    };
  };
  safeSubstitutionPool: {
    latin: number[];          // Latin letter codepoints (A-Z, a-z)
    digits: number[];         // 0-9 codepoints
    boxDrawing: number[];     // Box-drawing codepoints (U+2500–U+257F range subset)
  };
}
```

**Constraints:**
- 48 player codepoints (6 families × 8 glyphs).
- 24 bestiary codepoints (8 archetypes × 3 glyphs).
- Player bank and bestiary bank must not overlap.
- Safe substitution pool must not include any player or bestiary bank codepoints.
- This file is the lint target — the lint check uses these ranges to ban bank glyphs from non-creature contexts.

---

### `data/themes.json`

**Purpose:** 12 environment theme definitions (FR-8a, FR-25). Single source of truth for all theme-driven generation behavior.

**Shape:**
```typescript
interface ThemesData {
  version: number;
  themes: ThemeEntry[];
}

interface ThemeEntry {
  id: string;                    // Stable string identifier (e.g. "cold_storage")
  name: string;                  // Display name (e.g. "Cold Storage")
  accentColor: string;           // CSS color value (e.g. "#7ec8e3")
  archetypeWeights: { [archetypeId: string]: number }; // Relative weights (≥0; 0 = excluded)
  modifierWeights: { [modifierId: string]: number };  // Relative weights (≥0; 0 = excluded)
  enemyMixWeights: { [archetypeId: string]: number };   // Relative weights for enemy composition
  lootBias: {
    containerDensity: number;    // Multiplier on base container count
    rarityShift: number;         // Bonus/penalty to rarity roll
    affixPoolBias: { [affixId: string]: number }; // Relative weights for affix selection
  };
  audioMode: string;             // Identifier referencing an audio mode (timbre + modal set)
}
```

**Constraints:**
- Exactly 12 entries (FR-25, FR-8a).
- IDs are stable strings used in theme selection and save-state encoding (`themesSeen` set).
- `archetypeWeights` maps over 8 archetypes (FR-8). Weights need not sum to 1.
- `enemyMixWeights` must be compatible with depth scaling (the depth scaler multiplies/shifts weights, doesn't replace them).
- Adding a 13th theme requires only adding a row (FR-8a). Removing requires only deleting a row.
- Theme selection is deterministic given `(worldSeed, floorNumber)`.

**Theme entries (enumerated per FR-25):**

| # | id | name | accentColor |
|---|---|---|---|
| 1 | `cold_storage` | Cold Storage | `#7ec8e3` |
| 2 | `foundry` | The Foundry | `#e8632a` |
| 3 | `data_stream` | Data Stream | `#2ed4c1` |
| 4 | `data_cache` | Data Cache | `#e8d23a` |
| 5 | `archive` | The Archive | `#c4a04e` |
| 6 | `hive` | The Hive | `#8ec44a` |
| 7 | `void` | The Void | `#b026d4` |
| 8 | `lattice` | The Lattice | `#a8e8ff` |
| 9 | `stack` | The Stack | `#6a2eb8` |
| 10 | `terminal` | The Terminal | `#e83a3a` |
| 11 | `nursery` | The Nursery | `#3ae8a8` |
| 12 | `crypt` | The Crypt | `#d4d0c8` |

---

### `data/classes.json`

**Purpose:** 6 class definitions (FR-4, FR-45).

**Shape:**
```typescript
interface ClassesData {
  version: number;
  classes: ClassDefinition[];
}

interface ClassDefinition {
  id: string;                  // "breacher", "ghost", "compiler", "anchor", "oracle", "operator"
  name: string;                 // Display name
  primaryAttribute: string;     // "mgt" | "fin" | "vit" | "res" | "foc" | "sig"
  hitDieBase: number;           // 16, 14, 12, 10, 8, or 6
  chargeBase: number;           // 0, 2, 4, 6, or 8
  signature: {
    id: string;                 // "breach", "phase", "compile", "hold", "foresee", "overlay"
    name: string;
    tiers: string[];            // 3 entries: base, tier 2 (cal 2), tier 3 (cal 4) descriptions
  };
  equipmentGates: {
    weapons: string[];          // Allowed weapon category IDs
    armor: string[];            // Allowed armor category IDs
  };
  protocolGates: {
    schools: string[];          // Allowed school IDs
    maxTier: number;            // Max protocol tier purchasable at creation
  };
  sigilFamily: string;          // References sigils.json playerBank.families[classId]
  calibrationOptions: {          // Per-class calibration option pool (deterministic from seed)
    [floorNumber: string]: CalibrationOption[];
  };
}

interface CalibrationOption {
  id: string;
  name: string;
  type: "attribute" | "hp" | "deck_slot" | "signature_upgrade" | "proficiency";
  effect: object;               // Structured effect data (attribute raised, HP added, etc.)
}
```

**Constraints:**
- Exactly 6 classes (FR-45). No seventh class in v1.
- Class definitions are final for v1.
- `calibrationOptions` are deterministic given `(worldSeed, characterId, floorNumber)` — the data file defines the pool; the PRNG draw selects from it.

---

### `data/protocols.json`

**Purpose:** 20 protocol definitions (4 schools × 5 tiers) (FR-12, FR-47).

**Shape:**
```typescript
interface ProtocolsData {
  version: number;
  schools: {
    [schoolId: string]: {       // "disrupt", "ward", "scry", "rewrite"
      name: string;
      tiers: ProtocolTier[];     // 5 entries (tier 1–5)
    };
  };
}

interface ProtocolTier {
  tier: number;                  // 1–5
  name: string;                  // e.g. "SPARK", "PATCH", "PING", "FLIP"
  chargeCost: number;            // tier × 2
  range: string;                 // "SIG×2", "adjacent", "3-cell radius", "full floor", etc.
  effect: string;                // Human-readable effect description
  effectData: object;            // Structured effect for the rules engine
}
```

**Constraints:**
- Exactly 20 protocols (4 × 5). No additional protocols in v1 (FR-47).
- `chargeCost` is always `tier × 2`.
- Protocol catalog is final for v1.

---

### `data/enemies.json`

**Purpose:** 8 enemy archetype stat blocks and AI behavior profiles (FR-43).

**Shape:**
```typescript
interface EnemiesData {
  version: number;
  archetypes: {
    [archetypeId: string]: {    // "drone", "warden", "stalker", "choir", "null", "construct", "phantom", "apex"
      name: string;
      role: string;              // "Swarm minion", "Guard defender", etc.
      attributes: {
        mgt: number;             // 1–10
        fin: number;
        vit: number;
        res: number;
        foc: number;
        sig: number;
      };
      hpBonus: number;           // Added to VIT-derived HP
      armored: boolean;          // If true, counts as medium armor (+3 Def, -1 FIN)
      behavior: string;          // AI profile identifier
      protocolAccess?: {         // Only for Choir and Null
        schools?: string[];      // Choir: ["disrupt", "scry"], up to tier 3
        conditions?: string[];   // Null: ["jammed", "overloaded", "immobilized", "panicked", "marked"]
        maxTier?: number;        // Choir: 3
      };
      retreats: boolean;         // Whether this archetype retreats below 25% HP (false for Drone, Construct, Apex)
      sigilCodepoints: number[]; // 3 bestiary PUA codepoints (from sigils.json)
    };
  };
}
```

**Constraints:**
- Exactly 8 archetypes (FR-43).
- All archetypes use the same derived stat formulas as player characters.
- Echo enemies do not have a stat block here — they are constructed from dead character state at runtime (FR-32, FR-43).
- Apex enemies appear on threshold floors and have double initiative.

---

### `data/equipment.json`

**Purpose:** Weapon and armor categories, costs, range bands, class gates (FR-42). Also defines salvage values (FR-50).

**Shape:**
```typescript
interface EquipmentData {
  version: number;
  weapons: {
    [categoryId: string]: {     // "sidearm", "heavy_melee", "polearm", "light_ranged", "heavy_ranged", "sniper", "area_projector", "shield"
      name: string;
      damageDie: string;        // "d6", "d8", "d10", "d12", "d6×target"
      rangeBand: string;         // "adjacent", "short", "medium", "long", "blast"
      minRange?: number;        // For sniper (3 cells minimum)
      maxRange: number;         // 1, 4, 8, 16, 3 (blast radius)
      accuracyBonus: number;    // +1, 0, -1
      classGates: string[];     // Allowed class IDs
      creationCost: number;     // 1–4 points (Basic/Specialist tier)
      slot: "weapon" | "offhand"; // "offhand" for shield
      defenseBonus?: number;    // Shield: +2
      salvageValue: number;      // Scrap value when junked (FR-50)
    };
  };
  armor: {
    [categoryId: string]: {     // "none", "light", "medium", "heavy"
      name: string;
      defenseBonus: number;     // 0, +1, +3, +5
      finPenalty: number;       // 0, 0, -1, -2
      classGates: string[];     // "all" or specific class IDs; Breacher/Anchor ignore medium penalty
      creationCost: number;     // 1–3 points
      salvageValue: number;      // Scrap value when junked (FR-50)
    };
  };
}
```

**Constraints:**
- Equipment costs at creation: Basic 1, Standard 2, Advanced 3, Specialist 4 (FR-42).
- A character may equip one weapon, one armor, and one off-hand (shield or secondary sidearm).
- `salvageValue` is defined per category (FR-50) — used by the junk/salvage system.
- Class gates constrain creation purchases; in-run calibrations can expand proficiency (FR-39).

---

### `data/affixes.json`

**Purpose:** 16 affix definitions (universal, weapon-only, armor-only) (FR-48).

**Shape:**
```typescript
interface AffixesData {
  version: number;
  affixes: {
    [affixId: string]: {        // "reinforced", "overcharged", "lucky", "phasing", "edged", "precise", "extended", "vampiric", "conducting", "incendiary", "corrosive", "jamming", "lightweight", "shielding", "fortified", "resonant"
      name: string;
      category: "universal" | "weapon" | "armor";
      class: "minor" | "major";
      effect: string;           // Human-readable effect
      effectData: object;       // Structured effect for the rules engine
    };
  };
}
```

**Constraints:**
- Exactly 16 affixes: 4 universal, 8 weapon-only, 4 armor-only (FR-48).
- Minor = single-effect modifier; Major = significant mechanical change.
- CORRUPT items always roll from the major affix pool only.
- Affix pool is final for v1.

---

### `data/conditions.json`

**Purpose:** 9 condition definitions (FR-44).

**Shape:**
```typescript
interface ConditionsData {
  version: number;
  conditions: {
    [conditionId: string]: {     // "jammed", "overloaded", "shielded", "blinded", "immobilized", "corroded", "marked", "panicked", "burning"
      name: string;
      effect: string;           // Human-readable
      duration: number;         // Turns (or -1 for "until consumed")
      saveAttribute?: string;   // "foc", "res", "fin", "mgt", "vit", or null for "no save"
      stackable: boolean;        // Only BURNING is true
      effectData: object;       // Structured effect for the rules engine
    };
  };
}
```

**Constraints:**
- Exactly 9 conditions. No tenth condition in v1 (FR-44).
- BURNING is the only stackable condition (refreshes duration, adds stacking d6).
- Conditions clear on floor transition.
- SHIELDED is consumed on the next condition applied.

---

### `data/consumables.json`

**Purpose:** 7 consumable type definitions (FR-49).

**Shape:**
```typescript
interface ConsumablesData {
  version: number;
  consumables: {
    [consumableId: string]: {   // "repair_patch", "med_kit", "charge_cell", "boost_cell", "purge_spike", "shield_capacitor", "adrenal_injector"
      name: string;
      effect: string;           // Human-readable
      effectData: object;       // Structured effect for the rules engine
      minDepth: number;          // Minimum depth for this consumable to appear in loot
      combatOnly: boolean;       // true for adrenal_injector
      salvageValue: number;      // Flat salvage value (half rarity-equivalent, per FR-50)
    };
  };
}
```

**Constraints:**
- Exactly 7 consumable types (FR-49).
- No rarity tiers or affixes — fixed-effect items.
- Consumables stack in inventory (display count per type).
- `salvageValue` is a flat value per type (FR-50: half rarity-equivalent value).
- Drop rates are lower than weapon/armor (supplementary, not primary loot).

---

### `data/symbol-table.json`

**Purpose:** Pre-built field-level lookup tables for the save encoding pipeline (FR-28, architecture spec `state/save-encode.js`). Ships with the game (~8 KB, ~500 entries). Every machine running the same game version has the identical table, so table indices resolve identically across machines.

**Shape:**
```typescript
interface SymbolTableData {
  version: number;
  tables: {
    [fieldName: string]: {
      escape: number;            // Escape code for values not in the table
      entries: (string | number | [string, string])[]; // Ordered list of values (index = table code)
    };
  };
}
```

**Field-level table structure:**

| Field | Table Entries | Bits/Code | Coverage | Hash Key (canonical bytes) |
|-------|--------------|----------|----------|---------------------------|
| class | 6 | 3 | 100% | `[classId]` |
| sigil | 60 | 6 | 100% | `[sigilId]` |
| attribute (×6) | 16 each | 4 | ~95% (ranks 3–18) | `[attrRank]` |
| hp | 80 | 7 | ~95% (1–80) | `[hpValue]` |
| charge | 80 | 7 | ~95% (1–80) | `[chargeValue]` |
| conditions | 50 | 6 | ~90% | `[conditionMask]` (16-bit bitmask) |
| item_id | 200 | 8 | 100% | `[itemId]` |
| equipment | 100 | 7 | 100% | `[itemId, slot]` |
| calamity_count | 32 | 5 | 100% | `[count]` |
| sigil_tier | 8 | 3 | 100% | `[tier]` |
| inventory_default | 8 | 3 | 100% | `[invSnapshotId]` |
| **Total** | **~500** | **3–8** | **~90–95%** | |

**Constraints:**
- The symbol table is **versioned**. The version byte in the save header tells the decoder which table version to use.
- If the save's version is newer than the running game's table, the decoder returns `version_mismatch`.
- If the save's version is older, the decoder applies a migration map (if one exists) or returns `version_mismatch`.
- Each field has a forward `Map<hash, index>` (encoding) and a reverse `Array` (decoding), both built at module load.
- FNV-1a hash provides O(1) lookup per field. Collision probability with ~200 entries per table and 32-bit hash is negligible (< 10⁻³⁰).
- Total memory: ~4 KB for the Map indexes + ~8 KB for the table data = ~12 KB.

---

## Run State Schema (Serializable)

This is the canonical run state object (`state/run-state.js`). It is serialized for both `localStorage` (autosave) and URL fragment encoding (portable saves). It contains **only what cannot be regenerated from the seed** — floor geometry, container placement, enemy placement, and theme are all regenerated from `hash(worldSeed, depth)` on load.

**Shape:**
```typescript
interface RunState {
  // === Identification ===
  worldSeed: number;              // uint32 — root of all deterministic generation
  creationTimestamp: number;     // Unix ms — distinguishes multiple runs on same seed

  // === Progress ===
  depth: number;                  // Current floor number (regenerates floor N on load)
  floorSubSeed: number;           // Non-zero if validation incremented sub-seed (rare; usually 0)

  // === Floor Diff (the only floor-specific data that cannot be regenerated) ===
  partyPosition: { x: number; y: number };   // Party token position on 20×32 lattice
  fogOfWar: Uint8Array(80);       // 640-bit bitmap (20×32 cells, 1 bit per cell: visited/not-visited)
  openedContainers: number;       // Bitfield of looted container IDs on this floor
  defeatedEnemies: number;        // Bitfield of killed enemy IDs on this floor
  dangerClockProgress: number;     // Current danger clock value (accumulates during exploration, resets on hunt)

  // === Party (1–4 characters) ===
  party: Character[];

  // === Inventory ===
  inventory: Item[];              // Unequipped items. Hard-capped at 100 (FR-50).

  // === Run-wide State ===
  corruption: number;             // Run-wide corruption total (raises danger clock rate)
  credits: number;                // Remaining credits from unspent creation points (10:1)
  scrapCounter: number;           // Total salvage value accumulated through junking (FR-50)
  themesSeen: string[];           // Set of theme IDs encountered this run (for threshold floor guarantee)

  // === Echoes ===
  echoQueue: Echo[];              // 0–2 pending Echoes (dead character snapshot + appearance floor)

  // === PRNG State (for deterministic resume) ===
  rngState: {
    gen: { cursor: number; prngState: { a: number; b: number; c: number; d: number } };
    combat: { cursor: number; prngState: { a: number; b: number; c: number; d: number } };
  };

  // === Flags ===
  flags: {
    version: number;              // Save encoding version byte (currently 0x01)
    calibrationFloorsReached: number[]; // Which calibration floors have been completed
    // Future flags added here
  };

  // === Portable Event Log (persisted subset, capped at 64) ===
  recentEvents: PersistedEvent[]; // Slim tail of recent LOG entries — see PersistedEvent shape below
}

interface PersistedEvent {
  // Slim persisted shape written by RunState.recordEvent. Live in-session
  // display fidelity uses the fat runtime payload (with `entry`, `timestamp`);
  // only the fields below cross the encode boundary.
  type: string;                    // Event kind ("combat", "loot", …). Clamped to 16 chars.
  message: string;                 // Human-readable summary. Clamped to 72 chars. REQUIRED.
  sequence?: number;               // Optional monotonic ordering key (typically Date.now()).
}

interface Character {
  classId: string;                // e.g. "breacher"
  sigilId: string;                // e.g. "breacher_3"
  attributes: {
    mgt: number;                  // 1–10
    fin: number;
    vit: number;
    res: number;
    foc: number;
    sig: number;
  };
  currentHP: number;               // Current HP (not max — HP does not auto-heal)
  currentCHARGE: number;           // Current CHARGE
  calibrationCount: number;        // Number of calibrations taken (effective level = calCount + 1)
  calibrationChoices: { floor: number; optionId: string }[]; // History of calibration choices
  signatureTier: number;           // 1 (base), 2 (cal 2), or 3 (cal 4)
  equipment: {
    weapon: Item | null;
    armor: Item | null;
    offhand: Item | null;
  };
  protocolDeck: { school: string; tier: number }[];
  conditions: { conditionId: string; duration: number; stacks?: number }[]; // Active conditions (if mid-floor)
}

interface Item {
  id: string;                      // Unique item identifier
  category: "weapon" | "armor" | "consumable";
  baseType: string;                // Category ID from equipment.json or consumables.json
  rarity: "stock" | "tuned" | "custom" | "prototype" | "corrupt";
  affixes: string[];                // Affix IDs from affixes.json
  corrupt: boolean;                 // True if CORRUPT rarity
  stats: object;                    // Computed stats (damage, defense, etc. — pre-calculated)
  salvageValue: number;            // Scrap value if junked
  junkTagged: boolean;              // True if player tagged as junk (FR-50)
  count?: number;                   // For consumables: stack count (e.g., 3 Repair Patches)
}

interface Echo {
  character: Character;             // Full dead character snapshot at moment of death (includes equipment)
  deathFloor: number;               // Floor where the character died
  appearanceFloor: number;          // Floor where the Echo will appear (deathFloor + 2–4)
}
```

**What IS saved (the diff + persistent state):**
- `worldSeed`, `depth`, `floorSubSeed` — regenerate floor on load
- `partyPosition`, `fogOfWar`, `openedContainers`, `defeatedEnemies` — the floor diff (cannot be regenerated)
- `dangerClockProgress` — current danger clock value
- `party` — full character state (class, sigil, attributes, HP, CHARGE, calibrations, equipment, protocols, conditions)
- `inventory` — unequipped items (max 100, FR-50)
- `corruption`, `credits`, `scrapCounter` — run-wide resources
- `themesSeen` — set of theme IDs for threshold floor guarantee
- `echoQueue` — 0–2 pending Echoes
- `rngState` — both PRNG stream states (gen + combat) for deterministic resume
- `flags` — version byte, calibration floors reached
- `recentEvents` — up to 64 slim `PersistedEvent` records, newest last (see trim policy below)

**What is NOT saved (regenerated on load):**
- Floor geometry (cells, walls, layout) — regenerated by `floor/generator.js` from `hash(worldSeed, depth)`
- Container positions and contents — placed during generation; contents from `hash(worldSeed, depth, containerId)`; `openedContainers` bitfield marks looted ones
- Enemy positions and stats — spawned during generation; `defeatedEnemies` bitfield marks dead ones
- Environment theme — derived from `hash(worldSeed, depth)` via weighted selection from `data/themes.json`
- Descent point position — placed during floor generation

**Constraints:**
- Inventory is hard-capped at 100 items (FR-50). This guarantees the URL save is always encodable.
- Party size is 1–4 characters.
- Echo queue is max 2 concurrent.
- `flags.version` identifies the save encoding version. Currently `0x01`.
- `rngState` contains two independent PRNG streams: `gen` (floor generation) and `combat` (combat/event rolls). Both serialize compactly (2 × 16 bytes = 32 bytes).
- The entire serialized state must encode to < 1500 base64url characters. Worst-case budget analysis (4 chars, depth 50+, 100 inventory items, 2 Echoes): ~396 base64url chars — 3.8× headroom.

**`recentEvents` persistence and trim policy:**
- `RunState.recordEvent(event)` normalizes any incoming event to the slim `PersistedEvent` shape before storing — the fat runtime payload (with `entry`, `timestamp`, and other free-form fields) is dropped on the way in. Events without a string `message` are rejected (`{ recorded: false, reason: 'invalid_event' }`). The persisted list is hard-capped at 64 entries; overflow drops from the oldest end.
- `encodeRun(runState)` runs a deterministic trim-to-fit ladder before conceding: it attempts the encode with the full tail, then successively smaller keep-counts (64, 32, 16, 8, 4, 2, 1, 0), keeping the **newest** events at each step. The first attempt whose base64url fragment is under 1500 chars wins; the result's `metrics.eventsKept` / `metrics.eventsDropped` report the survivor count. `encodeRun` throws `RangeError('save_budget_exceeded')` only when the zero-event attempt still exceeds the budget — that is a genuine payload overflow and surfaces as `save_too_large` from `library.saveRun`.
- Legacy fat entries decoded from prior versions of the save format remain intact on load (the decode path is untouched); they are only slimmed the next time `recordEvent` runs, so a resumed run's initial LOG tail may mix legacy fat entries with fresh slim ones until the buffer rolls.

---

## Query Patterns

### localStorage Access Patterns

| Pattern | Operation | Key | Module | Notes |
|---------|-----------|-----|--------|-------|
| List all runs | Read + parse JSON | `od_runs` | `state/library.js.listRuns()` | Returns `LibraryEntry[]` for library display |
| Load a run | Read string → decode pipeline | `od_run_<key>` | `state/library.js.loadRun(key)` | Returns `RunState` or `null` if key absent / decode fails |
| Autosave a run | Encode pipeline → write string | `od_run_<key>` + update `od_runs` | `state/library.js.saveRun(runState)` | Same encoding as URL fragment saves. Called on floor transition, combat resolution |
| Delete run state | Remove key | `od_run_<key>` + update `od_runs` | `state/library.js.deleteRunState(key)` | Called on party wipe. Seed preserved separately |
| Get seed for wiped run | Read `od_runs`, find entry by key | `od_runs` | `state/library.js.getSeed(key)` | Returns `worldSeed` for scorecard share/restart |
| Load settings | Read + parse JSON | `od_settings` | `state/library.js.loadSettings()` | Fills defaults for missing fields |
| Save settings | Serialize + write JSON | `od_settings` | `state/library.js.saveSettings(settings)` | Called on settings change |
| Get flag | Read `od_flags`, return field | `od_flags` | `state/library.js.getFlag(key)` | e.g., `tutorialDeclined` |
| Set flag | Read-modify-write | `od_flags` | `state/library.js.setFlag(key, value)` | e.g., set `tutorialDeclined = true` |
| List party configs | Read + parse JSON | `od_party_configs` | `state/party-configs.js.listConfigs()` | Returns `ConfigEntry[]` for creation screen |
| Load party config | Read, find by name | `od_party_configs` | `state/party-configs.js.loadConfig(name)` | Returns `PartyBlueprint` or `null` |
| Save party config | Read-modify-write (max 10) | `od_party_configs` | `state/party-configs.js.saveConfig(name, blueprint)` | Returns `{ success: false }` if 10 exist |
| Delete party config | Read-modify-write | `od_party_configs` | `state/party-configs.js.deleteConfig(name)` | UI confirms before calling |
| Get last used config | Read string | `od_party_config_last_used` | `state/party-configs.js.getLastUsed()` | Returns name or `null` |
| Set last used config | Write string | `od_party_config_last_used` | `state/party-configs.js.setLastUsed(blueprint)` | Called on finalize or config load |

### Static Data Access Patterns

| Pattern | Operation | File | Consumer | Notes |
|---------|-----------|------|----------|-------|
| Resolve sigil codepoint | Lookup by class/archetype | `data/sigils.json` | `ui/playfield.js`, `ui/components.js` | PUA codepoint for rendering at 4 sizes |
| Select floor theme | Weighted draw using `archetypeWeights`, `modifierWeights` | `data/themes.json` | `floor/generator.js` | Deterministic from `hash(worldSeed, floorN)` |
| Get class definition | Lookup by `classId` | `data/classes.json` | `rules/classes.js`, `rules/attributes.js` | Hit die, charge base, signature, gates |
| Resolve protocol | Lookup by school + tier | `data/protocols.json` | `rules/protocols.js` | CHARGE cost, range, effect |
| Create enemy | Lookup archetype stats | `data/enemies.json` | `rules/enemies.js` | Attributes, HP bonus, behavior, protocol access |
| Generate loot | Lookup item base types + affixes | `data/equipment.json`, `data/affixes.json`, `data/consumables.json` | `rules/loot.js` | Deterministic from `hash(worldSeed, depth, floorId, containerId)` |
| Resolve equipment stats | Lookup by category ID | `data/equipment.json` | `rules/equipment.js` | Damage die, range band, accuracy, defense, FIN penalty |
| Apply condition | Lookup by `conditionId` | `data/conditions.json` | `rules/conditions.js` | Duration, save attribute, stackable |
| Use consumable | Lookup by `consumableId` | `data/consumables.json` | `rules/consumables.js` | Effect, combat-only flag, salvage value |
| Encode save (condense) | Lookup field values in symbol table | `data/symbol-table.json` | `state/condense.js` | FNV-1a hash → table index (3–8 bits) |
| Decode save (expand) | Reverse-lookup index → value | `data/symbol-table.json` | `state/condense.js` | Reverse array lookup per field |

### URL Save Access Patterns

| Pattern | Operation | Module | Notes |
|---------|-----------|--------|-------|
| Encode full run state | `RunState → condense → compress → encrypt → base64url` | `state/save-encode.js` | Returns `< 1500` char string for `#r=` |
| Decode full run state | `base64url → decrypt → decompress → expand → RunState` | `state/save-decode.js` | Returns `{ success, runState?, error? }` |
| Encode seed-only | `worldSeed → base32` | `state/save-encode.js` | Returns string for `#w=` |
| Decode seed-only | `base32 → worldSeed` | `state/save-decode.js` | Returns `{ success, seed?, error? }` |
| Copy link to clipboard | UI action → `navigator.clipboard.writeText` | `ui/console/log.js` | Full-state `#r=` link (mid-run only) |
| Import link | Paste URL → decode → mount exploration or failure screen | `ui/screens/import.js` | Named failure: truncated, version_mismatch, checksum_failed, malformed |

---

## Save Encoding Versioning & Migration Strategy

### Version Byte

The first byte of every URL fragment save (`#r=`) is the version byte (`0x01` currently). The decoder reads this byte first and determines compatibility:

| Save Version | Game Version | Action |
|-------------|-------------|--------|
| Equal | Equal | Decode normally |
| Older | Newer | Apply migration map (if one exists for this version transition) or return `version_mismatch` |
| Newer | Older | Return `version_mismatch` — cannot decode saves from a future version |

### Migration Maps

If the run state schema or symbol table changes in a future version, a migration map is added to `state/run-state.js`:

```typescript
// Example migration from v1 → v2 (hypothetical)
const migrations = {
  0x01: (runState) => {
    // Transform v1 RunState to v2 shape
    return { ...runState, newField: defaultValue };
  }
};
```

The decoder applies migration maps in sequence from the save's version up to the current version. If any step in the chain is missing, decoding fails with `version_mismatch`.

### Symbol Table Versioning

The symbol table (`data/symbol-table.json`) is versioned independently of the save format. The save header carries the symbol table version used during encoding. On decode:

1. If save's table version == game's table version: decode normally.
2. If save's table version < game's table version: use the older table (shipped alongside the game if backward-compatible) or apply a migration map.
3. If save's table version > game's table version: return `version_mismatch`.

### localStorage Migration

`localStorage` keys are not explicitly versioned. Instead, `state/library.js` validates the structure of every read:

- **`od_runs` entries:** Missing fields are filled with defaults. Unrecognized fields are preserved (forward-compatible).
- **`od_run_<key>` values:** The `flags.version` byte in the run state determines the migration path. `RunState.deserialize()` applies migrations as needed.
- **`od_settings`:** Missing fields get defaults. The settings shape is stable for v1.
- **`od_party_configs`:** Each blueprint carries a `version` field. `validateConfig()` checks against current game data and flags invalid items.

### Static Data Versioning

Each `data/*.json` file has a top-level `version` field. On game start, `main.js` validates all data file versions against the game's expected versions. If a data file version is incompatible (too old or too new), the game shows a clear error rather than loading potentially broken data.

Data file version bumps are rare and tied to game releases. The service worker cache invalidation (via cache versioning in `service-worker.js`) ensures the player always gets the matching data files for the game version they loaded.

---

## Indexes & Performance Notes

There are no database indexes in the traditional sense. Performance considerations for the data layers:

| Concern | Mitigation |
|---------|-----------|
| `od_runs` list is small (tens to low hundreds of entries) | Linear scan is fine — no indexing needed |
| `od_run_<key>` read is O(1) by key | `localStorage` is a hash map under the hood. Encoded string is ~200–500 chars (vs several KB as JSON) |
| `localStorage` writes block the main thread | All writes are kept under 50ms (NFR). Run states are a few KB. |
| Symbol table lookup during save encoding | FNV-1a hash is O(1) per field. ~500 entries total. < 50ms total encode (NFR). |
| Symbol table lookup during save decode | Reverse array lookup is O(1). < 100ms total decode (NFR). |
| Static data files loaded at start | Parallel `Promise.all` fetch of 10 files (~28 KB total). Cached by service worker. |
| Fog of war bitmap (640 bits = 80 bytes) | Stored as `Uint8Array(80)` — compact, compresses well in save encoding |

---

## Seed Data (Initial State)

### First-Run Defaults

On first load (no `localStorage` keys present):

| Key | Initial Value |
|-----|--------------|
| `od_runs` | `[]` (empty array) |
| `od_run_*` | (no keys — no runs exist) |
| `od_settings` | `{ masterMute: false, layerVolumes: { drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 }, glitchEnabled: true, reducedMotion: false, scanlineGrainEnabled: true }` |
| `od_flags` | `{ tutorialDeclined: false }` |
| `od_party_configs` | `[]` (empty array — first-time player starts with blank creation) |
| `od_party_config_last_used` | `null` (no last-used config) |

### Game Content (Static Data Files)

The static JSON data files are authored content, not seed data. They are loaded from the server (and cached by the service worker) on first load. They are the single source of truth for all game content and are never modified at runtime.

---

## Data Integrity & Security

| Concern | Mitigation |
|---------|-----------|
| `localStorage` is unencrypted | Treated as untrusted on every read. `state/library.js` validates structure defensively. Malformed data fails gracefully, never crashes. |
| URL fragment is user-controlled | Decoded in a sandboxed parser — no `eval`, no `Function()`, no `innerHTML`. Pure data deserialization. Untrusted input produces a named error or valid `RunState`, never arbitrary code execution. |
| Save encoding integrity | CRC32 checksum appended to every save. Decoder validates checksum before any further processing. Failed checksum → named `checksum_failed` error. |
| XOR cipher is obfuscation only | Fixed app key + version byte. Not cryptographic security. Prevents casual tampering and keeps base64url output opaque. No security claim. |
| Service worker | Only fetches from the origin. No third-party requests. No `importScripts` from external URLs. |
| Data file tampering | Service worker cache-first strategy ensures the player gets the files that were cached on first load. Data file versions are validated on load. |

---

## Migration History

| # | Description | Scope |
|---|-------------|-------|
| 001 | Initial schema — v0.01 (save encoding version `0x01`) | All `localStorage` keys, all `data/*.json` files, URL fragment encoding pipeline, symbol table v1 |

**Note:** As this is the initial database design, there are no prior migrations to apply. The "migration" is the initial creation of all `localStorage` keys with defaults (on first load) and the initial fetch + cache of all `data/*.json` files (on first load). Future schema changes will be documented as new entries in this table with corresponding migration maps in `state/run-state.js`.