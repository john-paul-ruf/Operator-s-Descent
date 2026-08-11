import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyCombatToRun,
  canonical,
  canonicalRun,
  createGameHarness,
  descend,
  driveCombat,
  hydrateHarness,
  loadGameDataFixture,
  lootFirstContainer,
  regenerateFloorForRun,
  roundTripRunState,
  startStandardCombat
} from '../helpers/game-fixture.js';

beforeAll(() => {
  loadGameDataFixture();
});

function overrides() {
  const actor = {
    charge: 20,
    currentCHARGE: 20,
    protocols: [{ school: 'disrupt', tier: 1 }],
    weapon: { damageDie: 'd12', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 }
  };
  return [actor, actor, actor, actor];
}

function addPatch(runState) {
  runState.inventory.push({ id: `patch_${runState.inventory.length}`, category: 'consumable', baseType: 'repair_patch', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false });
}

describe('deterministic continuation', () => {
  it('restores the exact saved floor from floorSubSeed and themesSeen', () => {
    const harness = createGameHarness({ seed: 7, partySize: 2 });
    const floorTwo = descend(harness);
    expect(floorTwo.result.error).toBeUndefined();
    const floorThree = descend(harness);
    expect(floorThree.result.error).toBeUndefined();

    const roundTrip = roundTripRunState(harness.runState);
    const restored = regenerateFloorForRun(roundTrip.decoded, harness.data);

    expect(restored).toEqual(harness.floor);
    expect(restored.floorSubSeed).toBe(harness.runState.floorSubSeed);
    expect(restored.themeId).toBe(harness.floor.themeId);
  });

  it('produces identical loot, combat rolls, events, and RNG cursors after portable resume', () => {
    const original = createGameHarness({ seed: 2, partySize: 4 });
    const loot = lootFirstContainer(original);
    expect(loot.success).toBe(true);
    const checkpoint = roundTripRunState(original.runState);
    const resumed = hydrateHarness({ data: original.data, runState: checkpoint.decoded, floor: regenerateFloorForRun(checkpoint.decoded, original.data) });

    expect(resumed.floor).toEqual(original.floor);
    expect(canonicalRun(resumed.runState)).toEqual(canonicalRun(original.runState));

    addPatch(original.runState);
    addPatch(resumed.runState);
    const combatA = startStandardCombat(original, { enemyHP: 80, partyOverrides: overrides() });
    const combatB = startStandardCombat(resumed, { enemyHP: 80, partyOverrides: overrides() });

    expect(canonical(combatB.combatState)).toEqual(canonical(combatA.combatState));

    const resultA = driveCombat(original, combatA, { item: true, protocol: true, overclock: true, move: true, maxTurns: 120 });
    const resultB = driveCombat(resumed, combatB, { item: true, protocol: true, overclock: true, move: true, maxTurns: 120 });

    expect(resultB.combatState.result).toBe(resultA.combatState.result);
    expect(canonical(resultB.combatState.log)).toEqual(canonical(resultA.combatState.log));
    expect(resumed.runState.rngState).toEqual(original.runState.rngState);
    expect(resultB.used).toEqual(resultA.used);

    applyCombatToRun(original, resultA.combatState);
    applyCombatToRun(resumed, resultB.combatState);
    expect(canonicalRun(resumed.runState)).toEqual(canonicalRun(original.runState));
  });

  it('keeps calibration offers, floor transition results, and next cursors equal across cloned snapshots', () => {
    const original = createGameHarness({ seed: 11, partySize: 2 });
    const toFloorTwo = descend(original);
    expect(toFloorTwo.result.error).toBeUndefined();
    const checkpoint = roundTripRunState(original.runState);
    const resumed = hydrateHarness({ data: original.data, runState: checkpoint.decoded, floor: regenerateFloorForRun(checkpoint.decoded, original.data) });

    const floorThreeA = descend(original);
    const floorThreeB = descend(resumed);

    expect(floorThreeA.start.calibrationRequired).toBe(true);
    expect(floorThreeB.start.offers).toEqual(floorThreeA.start.offers);
    expect(floorThreeB.result.events).toEqual(floorThreeA.result.events);
    expect(floorThreeB.result.floor).toEqual(floorThreeA.result.floor);
    expect(canonicalRun(resumed.runState)).toEqual(canonicalRun(original.runState));
    expect(resumed.cursor.getState()).toEqual(original.cursor.getState());
  });
});
