import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { generateFloor } from '../../src/floor/generator.js';
import { addItem, getInventoryCount } from '../../src/rules/inventory.js';
import { saveRun, listRuns, deleteRunState, getSeed } from '../../src/state/library.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import {
  applyCombatToRun,
  assertRunInvariants,
  attemptOverflowPickup,
  createGameHarness,
  descend,
  driveCombat,
  echoVictoryWithGear,
  equipSpareSidearm,
  fillInventory,
  loadGameDataFixture,
  lootFirstContainer,
  queueSingleDeathEcho,
  roundTripRunState,
  startStandardCombat,
  triggerHunt
} from '../helpers/game-fixture.js';

let storage;

beforeAll(() => {
  loadGameDataFixture();
});

afterEach(() => {
  storage?.uninstall();
  storage = null;
});

function combatOverrides() {
  const override = {
    charge: 20,
    currentCHARGE: 20,
    protocols: [{ school: 'disrupt', tier: 1 }],
    weapon: { damageDie: 'd12', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 }
  };
  return [override, override, override, override];
}

describe('full game loop integration', () => {
  it('finalizes legal one- and four-operator runs and keeps portable saves under budget', () => {
    for (const partySize of [1, 4]) {
      const harness = createGameHarness({ seed: 100 + partySize, partySize });
      const invariant = assertRunInvariants(harness.runState, harness.floor);

      expect(harness.runState.party).toHaveLength(partySize);
      expect(harness.runState.depth).toBe(1);
      expect(harness.runState.partyPosition).toEqual(harness.floor.entryPoint);
      expect(invariant.saveLength).toBeLessThan(1500);
    }
  });

  it('covers exploration, loot, gear, combat victory, descent, calibration, autosave, and resume', () => {
    const harness = createGameHarness({ seed: 2, partySize: 4 });
    const firstSave = assertRunInvariants(harness.runState, harness.floor).saveLength;

    const loot = lootFirstContainer(harness);
    expect(loot.success).toBe(true);
    expect(loot.walk.results.some((result) => result.discoveries.some((entry) => entry.type === 'container'))).toBe(true);
    expect(getInventoryCount(harness.runState.inventory)).toBeGreaterThan(0);
    expect((harness.runState.openedContainers & 1n) === 1n).toBe(true);

    const equipped = equipSpareSidearm(harness);
    expect(equipped.success).toBe(true);
    expect(harness.runState.party[0].equipment.weapon.id).toBe('spare_sidearm');

    harness.runState.inventory.push({ id: 'patch', category: 'consumable', baseType: 'repair_patch', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false });
    const combat = startStandardCombat(harness, { enemyHP: 80, partyOverrides: combatOverrides() });
    const driven = driveCombat(harness, combat, { item: true, protocol: true, overclock: true, move: true, maxTurns: 120 });

    expect(driven.combatState.ended).toBe(true);
    expect(driven.combatState.result).toBe('victory');
    expect(driven.used).toMatchObject({ item: true, protocol: true, overclock: true, move: true });
    expect(driven.completion.outcome).toBe('victory');
    expect(driven.combatState.log.some((entry) => entry.type === 'protocol' && entry.overclocked)).toBe(true);
    expect(driven.combatState.log.some((entry) => entry.type === 'item')).toBe(true);

    expect(applyCombatToRun(harness, driven.combatState).applied).toBe(true);
    expect(harness.runState.activeCombat).toBeNull();

    harness.runState.party[0].currentHP = Math.max(1, harness.runState.party[0].currentHP - 5);
    harness.runState.party[0].currentCHARGE = 0;
    const hpBeforeDescent = harness.runState.party[0].currentHP;
    const descentTwo = descend(harness);
    expect(descentTwo.result.error).toBeUndefined();
    expect(harness.runState.depth).toBe(2);
    expect(harness.runState.party[0].currentHP).toBe(hpBeforeDescent);
    expect(harness.runState.party[0].currentCHARGE).toBeGreaterThan(0);
    expect(harness.runState.stats.floorsDescended).toBe(1);

    const descentThree = descend(harness);
    expect(descentThree.start.calibrationRequired).toBe(true);
    expect(descentThree.result.error).toBeUndefined();
    expect(descentThree.result.events.map((event) => event.type)).toContain('calibration');
    expect(harness.runState.depth).toBe(3);
    expect(harness.runState.party.every((character) => character.calibrationCount === 1)).toBe(true);

    storage = installMockStorage();
    const saved = saveRun(harness.runState, { themeId: harness.floor.themeId, accentSwatch: '#7ec8e3' });
    expect(saved.success).toBe(true);
    expect(listRuns()).toHaveLength(1);

    const resumed = roundTripRunState(harness.runState);
    expect(resumed.encoded.fragment.length).toBeLessThan(1500);
    expect(resumed.encoded.fragment.length).toBeGreaterThan(firstSave);
    expect(resumed.decoded.depth).toBe(3);
    expect(resumed.decoded.party.map((character) => character.calibrationCount)).toEqual([1, 1, 1, 1]);
    expect(assertRunInvariants(resumed.decoded, harness.floor).saveLength).toBeLessThan(1500);
  });

  it('covers hunts, threshold vaults, Echo lifecycle, inventory cap, and wipe deletion', () => {
    const data = loadGameDataFixture();
    const harness = createGameHarness({ seed: 42, partySize: 2 });

    const hunt = triggerHunt(harness);
    expect(hunt.tick.huntTriggered).toBe(true);
    expect(hunt.encounter.kind).toBe('hunt');
    expect(hunt.encounter.actors.some((actor) => actor.elite)).toBe(true);

    const threshold = generateFloor(harness.runState.worldSeed, 10, { themesSeen: [...harness.runState.themesSeen] }, data.themes);
    expect(threshold.threshold).toBe(true);
    expect(threshold.containers.some((container) => container.kind === 'vault')).toBe(true);
    expect(threshold.enemySpawns.some((spawn) => spawn.elite)).toBe(true);

    const death = queueSingleDeathEcho(harness);
    expect(death.deaths).toHaveLength(1);
    expect(death.queued[0].queued).toBe(true);
    expect(harness.runState.getDueEchoes(death.echo.appearanceFloor)).toHaveLength(1);
    expect(harness.runState.echoQueue).toHaveLength(1);

    const reclaimable = echoVictoryWithGear(harness);
    expect(reclaimable.map((item) => item.id)).toContain('echo_blade');

    fillInventory(harness.runState);
    const overflow = attemptOverflowPickup(harness.runState);
    expect(overflow.success).toBe(false);
    expect(overflow.reason).toBe('inventory_full');
    expect(getInventoryCount(harness.runState.inventory)).toBe(100);

    storage = installMockStorage();
    const saved = saveRun(harness.runState, { themeId: harness.floor.themeId });
    expect(saved.success).toBe(true);
    expect(listRuns()).toHaveLength(1);
    const deleted = deleteRunState(saved.key);
    expect(deleted).toMatchObject({ success: true, tombstoned: true });
    expect(listRuns()).toHaveLength(0);
    expect(getSeed(saved.key)).toBe(harness.runState.worldSeed);

    const addAfterCap = addItem(harness.runState.inventory, { id: 'med', category: 'consumable', baseType: 'repair_patch', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false });
    expect(addAfterCap.success).toBe(false);
    expect(assertRunInvariants(harness.runState, harness.floor).saveLength).toBeLessThan(1500);
  });
});
