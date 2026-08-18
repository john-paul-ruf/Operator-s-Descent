// v3 → v4 forward migration (Custom Rule 13).
//
// The v3 → v4 bump was encoding-only: SESSION-02 slimmed the enemy stat
// snapshot in the wire format (standard archetypes now persist only
// {archetypeId, hpMax, chargeMax, sigilCodepoint}; the runtime re-derives
// attributes/defense/behavior/protocolAccess on restore via
// deriveEnemyStats). The decoded RunState shape is unchanged — the frozen
// readV3Payload already emits an object shaped like a v4 native decode,
// with the full enemy template inline. That template is redundant under
// v4 (deriveEnemyStats reproduces it deterministically at restore time),
// so the migration is a pure identity: pass the state through untouched.
//
// Conditions on the current v4 codec still travel as {conditionId, duration,
// stacks?} tuples — the `condition_mask` field mentioned in the SESSION-03
// prompt landed as a codec-internal packing detail, not a shape change, so
// nothing needs remapping here either. New v4 fields (none at present) will
// pick up their defaults from deserializeRunState / validateRunState when
// the migrated state is re-hydrated downstream.
//
// If a future v3 payload somehow carries a genuinely v4-incompatible shape,
// the corpus test in tests/state/save-migration-corpus.test.js is the
// enforcement arm: any regression that drops validity or blows the 1500
// budget fails there and blocks the release.

export const v3ToV4 = {
  from: 3,
  to: 4,
  migrate: (state) => state
};
