// v6 → v7 forward migration (Custom Rule 13).
//
// v7 is a WIRE-FORMAT bump — the decoded RunState shape is unchanged. The
// wire changes are:
//   - persisted event `type` symbolized against an inline enum
//   - calibration `optionId` symbolized against an inline enum
//   - combat actor `x`/`y` packed to 3+4 bits (matches the fixed 8×16
//     combat window in src/rules/encounters.js)
//   - newly-generated loot ids shrink to ≤9 chars (legacy long ids
//     remain valid — the codec's 96-char cap is unchanged)
//
// CP2 (this session, wire compaction) lands the hop as a pure identity so
// the migration chain is unbroken the moment RUN_SCHEMA_VERSION advances.
// CP3 (same session, cap reduction) extends this file with clamping logic:
// inventory salvaged to the new lower cap, corrupt-implant ledger and
// persisted-event tail truncated, oversized combat dropped to null. Until
// CP3 lands the caps, `migrate` returns the state unchanged and the
// downstream save-schema/run-state validators accept it — every v6 payload
// that decoded before still decodes now.
//
// The corpus test at tests/state/save-migration-corpus.test.js is the
// enforcement arm: any regression that drops validity or busts SAVE_BUDGET
// fails there and blocks the release.

// The 8×16 combat window (WINDOW_WIDTH × WINDOW_HEIGHT in
// src/rules/encounters.js) has been the runtime shape for many releases, but
// pre-v6 codecs stored actor coordinates as raw 5-bit fields (0..31) — so
// early corpus saves (v3-caster-combat, v4-caster-combat, …) legitimately
// carry actor.x up to 10 and actor.y up to 12 that no longer fit the new
// v7 3+4 packing. Rather than dead-ending those loads, this hop drops the
// stale activeCombat snapshot on migration (the danger clock re-engages on
// contact); the rest of the RunState survives. Same policy as D2's
// "oversized combat drops to null" — CP3 extends that policy to inventory,
// ledger, and events at the same seam.
function combatFitsV7Window(activeCombat) {
  if (!activeCombat || !Array.isArray(activeCombat.actors)) return true;
  for (const actor of activeCombat.actors) {
    if (!Number.isInteger(actor?.x) || actor.x < 0 || actor.x > 7) return false;
    if (!Number.isInteger(actor?.y) || actor.y < 0 || actor.y > 15) return false;
  }
  return true;
}

export const v6ToV7 = {
  from: 6,
  to: 7,
  migrate: (state) => {
    if (!state || typeof state !== 'object') return state;
    if (state.activeCombat && !combatFitsV7Window(state.activeCombat)) {
      // Mutate in place — the state carries RunState methods (serialize,
      // setActiveCombat, …). Spreading it would strip them and break callers
      // that expect a live RunState after migration.
      if (typeof state.setActiveCombat === 'function') state.setActiveCombat(null);
      else state.activeCombat = null;
    }
    return state;
  }
};
