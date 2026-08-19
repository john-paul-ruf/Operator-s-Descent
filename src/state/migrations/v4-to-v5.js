// v4 → v5 forward migration (Custom Rule 13).
//
// The v4 → v5 bump is encoding-only: SESSION-02 changes the wire format
// (initiativeOrder as 5-bit actor indices with duplicates legal, enemy
// entity-id run dedup, per-enemy byte-alignment dropped, condition ids as
// a pinned 4-bit enum with escape, hpMax/chargeMax as delta-from-baseline)
// but the decoded RunState shape is unchanged. The apex serialization bug
// that motivates the codec change (turn-order duplicates for apex two-slot
// actors) prevented any shipped v4 save from containing duplicate initiative
// entries — so no v4 payload in the wild needs remapping to produce a legal
// v5 state. This migration is a pure identity: pass the state through
// untouched. New v5 fields (none at present) pick up defaults from
// deserializeRunState / validateRunState downstream.
//
// The corpus test at tests/state/save-migration-corpus.test.js is the
// enforcement arm: any regression that drops validity or blows the 1500
// budget fails there and blocks the release.

export const v4ToV5 = {
  from: 4,
  to: 5,
  migrate: (state) => state
};
