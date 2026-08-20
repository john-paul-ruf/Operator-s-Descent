// v5 → v6 forward migration (Custom Rule 13).
//
// v6 widens partyPosition + combat coordinates from 5 to 7 bits and makes the
// fog framing self-sizing (varUint length + bytes, previously fixed 80 bytes).
// At the moment v6 lands, the runtime grid is still 20×32 (SESSION-05 flips it
// to 40×64 later), so every field in a v5 payload fits the v6 shape unchanged:
// coordinates all live in the 0–31 subrange and the fog byte length equals the
// current FOG_BYTES. This migration is a pure identity — the payload's
// decoded shape is already v6-compatible.
//
// Once SESSION-05 grows GRID_W×GRID_H, a v5 payload migrated forward will have
// fog whose length disagrees with the new FOG_BYTES; normalizeFog resets it
// (and discards the stale partyPosition) rather than failing the load. That
// tolerance lives in run-state.js and is asserted at the migration-corpus
// level in tests/state/save-migration-corpus.test.js — the corpus is the
// enforcement arm for "versioned saves never dead-end".

export const v5ToV6 = {
  from: 5,
  to: 6,
  migrate: (state) => state
};
