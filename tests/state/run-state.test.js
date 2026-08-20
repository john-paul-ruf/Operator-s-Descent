import { describe, expect, it } from 'vitest';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { createRunState, deserializeRunState, validateRunState } from '../../src/state/run-state.js';

function makeCharacter(id = 'operator_1') {
  return {
    id,
    classId: 'breacher',
    sigilId: 'pua-e000',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    currentHP: 30,
    currentCHARGE: 10,
    calibrationCount: 0,
    calibrationChoices: [],
    signatureTier: 1,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [],
    conditions: []
  };
}

function makeState(options = {}) {
  return createRunState(42, [makeCharacter()], { creationTimestamp: 1_000, ...options });
}

describe('RunState v2 canonical shape', () => {
  it('creates independent canonical collections and summary state', () => {
    const party = [makeCharacter()];
    const state = createRunState(42, party, { creationTimestamp: 1_000 });
    party[0].attributes.mgt = 1;
    expect(state.party[0].attributes.mgt).toBe(5);
    expect(state.flags).toEqual({ version: 2, calibrationFloorsReached: [] });
    expect(state.activeCombat).toBeNull();
    expect(state.stats).toEqual({ enemiesSlain: 0, echoesSlain: 0, corruptItemsEquipped: 0, floorsDescended: 0 });
    expect(state.recentEvents).toEqual([]);
  });

  it('serializes plain independent v2 data without legacy aliases', () => {
    const state = makeState();
    state.markContainerOpened(3);
    const serialized = state.serialize();
    expect(serialized.openedContainers).toBe('8');
    expect(serialized.party[0]).toMatchObject({ currentHP: 30, currentCHARGE: 10, sigilId: 'pua-e000' });
    expect(serialized.party[0]).not.toHaveProperty('hp');
    expect(() => JSON.stringify(serialized)).not.toThrow();
    serialized.party[0].attributes.mgt = 1;
    expect(state.party[0].attributes.mgt).toBe(5);
  });

  it('maintains non-serialized legacy aliases while later modules migrate', () => {
    const state = makeState();
    state.party[0].hp -= 4;
    state.party[0].charge -= 2;
    expect(state.party[0].currentHP).toBe(26);
    expect(state.party[0].currentCHARGE).toBe(8);
    expect(state.party[0].sigilCodepoint).toBe(0xe000);
  });
});

describe('RunState bounds and hostile input', () => {
  it('rejects invalid state rather than clamping or fabricating identities', () => {
    const serialized = makeState().serialize();
    serialized.party[0].classId = '';
    expect(validateRunState(serialized)).toEqual({ valid: false, errors: ['invalid_run_state'] });
    expect(deserializeRunState(serialized)).toBeNull();
  });

  it.each([
    ['seed', state => { state.worldSeed = -1; }],
    ['fog length', state => { state.fogOfWar.pop(); }],
    ['position', state => { state.partyPosition.x = 20; }],
    ['inventory', state => { state.inventory = Array.from({ length: 101 }, () => validItem()); }],
    ['echo queue', state => { state.echoQueue = [validEcho(), validEcho(), validEcho()]; }],
    ['non-finite number', state => { state.corruption = Number.NaN; }],
    ['bitfield', state => { state.openedContainers = '-1'; }]
  ])('rejects invalid %s', (_label, mutate) => {
    const serialized = makeState().serialize();
    mutate(serialized);
    expect(deserializeRunState(serialized)).toBeNull();
  });
});

function validItem() {
  return { id: 'item_1', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
}

function validEcho() {
  return { character: makeCharacter('dead_operator'), deathFloor: 3, appearanceFloor: 6 };
}

describe('deterministic mutators', () => {
  it('queues a deep-copied Echo from the combat cursor and persists the advanced cursor', () => {
    const state = makeState();
    const cursor = createRNGCursorForRun(42);
    const expectedCursor = createRNGCursorForRun(42);
    const expectedFloor = 5 + 2 + expectedCursor.nextInt('combat', 3);
    const character = makeCharacter('dead_operator');
    const result = state.queueEcho(character, 5, cursor);
    character.currentHP = 0;
    expect(result.queued).toBe(true);
    expect(state.echoQueue[0].appearanceFloor).toBe(expectedFloor);
    expect(state.echoQueue[0].character.currentHP).toBe(30);
    expect(state.rngState.combat.cursor).toBe(1);
  });

  it('returns explicit failures for invalid mutation requests and caps Echoes', () => {
    const state = makeState();
    expect(state.markContainerOpened(64)).toEqual({ marked: false, reason: 'invalid_id' });
    expect(state.markCellVisited(20, 0)).toEqual({ marked: false, reason: 'invalid_coordinate' });
    state.queueEcho(makeCharacter('one'), 1, createRNGCursorForRun(1));
    state.queueEcho(makeCharacter('two'), 1, createRNGCursorForRun(2));
    expect(state.queueEcho(makeCharacter('three'), 1, createRNGCursorForRun(3))).toEqual({ queued: false, reason: 'queue_full' });
  });

  it('tracks visited cells as exactly 80 persisted bits and resets them', () => {
    const state = makeState();
    state.markCellVisited(19, 31);
    expect(state.isCellVisited(19, 31)).toBe(true);
    expect(state.isCellVisited(20, 31)).toBe(false);
    state.resetFogOfWar();
    expect(state.fogOfWar).toHaveLength(80);
    expect(state.isCellVisited(19, 31)).toBe(false);
  });

  it('counts consumable stacks toward the hard inventory cap', () => {
    const state = makeState({ inventory: [{ ...validItem(), category: 'consumable', count: 100 }] });
    expect(state.getInventoryCount()).toBe(100);
    expect(state.isInventoryFull()).toBe(true);
  });

  it('clears floor-only state and updates scorecard truth on descent', () => {
    const state = makeState({ activeCombat: { round: 1, actors: [] } });
    state.markCellVisited(0, 0);
    state.markEnemyDefeated(0);
    expect(state.advanceFloor()).toEqual({ advanced: true, depth: 2 });
    expect(state.activeCombat).toBeNull();
    expect(state.stats).toMatchObject({ enemiesSlain: 1, floorsDescended: 1 });
    expect(state.isCellVisited(0, 0)).toBe(false);
  });

  it('caps portable LOG entries at 64 slim persisted events', () => {
    const state = makeState();
    for (let index = 0; index < 65; index++) state.recordEvent({ type: 'move', message: `step ${index}`, sequence: index });
    expect(state.recentEvents).toHaveLength(64);
    expect(state.recentEvents[0]).toEqual({ type: 'move', message: 'step 1', sequence: 1 });
  });
});

describe('recordEvent persistence policy (slim events)', () => {
  it('drops the fat entry payload, keeping only type/message/sequence', () => {
    const state = makeState();
    state.recordEvent({
      type: 'combat',
      message: 'Operator fires sidearm.',
      sequence: 42,
      timestamp: 1_700_000_000_000,
      entry: { round: 2, damage: 6, extras: { deep: 'nested' } }
    });
    expect(state.recentEvents).toEqual([{ type: 'combat', message: 'Operator fires sidearm.', sequence: 42 }]);
  });

  it('clamps message to 72 characters and type to 16 characters', () => {
    const state = makeState();
    state.recordEvent({ type: 'very-long-runtime-type-name', message: 'A'.repeat(100), sequence: 1 });
    expect(state.recentEvents[0]).toEqual({
      type: 'very-long-runtim',
      message: 'A'.repeat(72),
      sequence: 1
    });
  });

  it('defaults missing type to "info" and omits absent sequence', () => {
    const state = makeState();
    state.recordEvent({ message: 'Bare message.' });
    expect(state.recentEvents[0]).toEqual({ type: 'info', message: 'Bare message.' });
  });

  it('rejects events without a string message', () => {
    const state = makeState();
    expect(state.recordEvent({ type: 'combat', sequence: 3 })).toEqual({ recorded: false, reason: 'invalid_event' });
    expect(state.recordEvent({ type: 'combat', message: 42 })).toEqual({ recorded: false, reason: 'invalid_event' });
    expect(state.recordEvent(null)).toEqual({ recorded: false, reason: 'invalid_event' });
    expect(state.recordEvent(undefined)).toEqual({ recorded: false, reason: 'invalid_event' });
    expect(state.recentEvents).toEqual([]);
  });

  it('ignores non-finite sequence values', () => {
    const state = makeState();
    state.recordEvent({ type: 'move', message: 'A', sequence: Number.NaN });
    state.recordEvent({ type: 'move', message: 'B', sequence: Infinity });
    expect(state.recentEvents).toEqual([
      { type: 'move', message: 'A' },
      { type: 'move', message: 'B' }
    ]);
  });
});

describe('v1 normalization', () => {
  it('normalizes legacy names only at the v1 boundary', () => {
    const v1 = {
      ...makeState().serialize(),
      party: [{ ...makeCharacter(), hp: 27, charge: 4, protocols: [{ school: 'ward', tier: 1 }], sigilCodepoint: 0xe000 }],
      flags: { version: 1, calibrationFloorsReached: [3] }
    };
    delete v1.party[0].currentHP;
    delete v1.party[0].currentCHARGE;
    delete v1.party[0].protocolDeck;
    delete v1.party[0].sigilId;
    const state = deserializeRunState(v1, { sourceVersion: 1 });
    expect(state.serialize().party[0]).toMatchObject({ currentHP: 27, currentCHARGE: 4, sigilId: 'pua-e000', protocolDeck: [{ school: 'ward', tier: 1 }] });
    expect(state.flags.version).toBe(2);
  });

  it('preserves bounded unknown v1 fields under extensions', () => {
    const v1 = makeState().serialize();
    v1.flags.version = 1;
    v1.legacyField = { retained: true };
    const state = deserializeRunState(v1, { sourceVersion: 1 });
    expect(state.extensions).toEqual({ legacyField: { retained: true } });
  });
});

describe('applyCombatResult', () => {
  it('victory clears activeCombat and increments enemiesSlain', () => {
    const state = makeState();
    state.setActiveCombat({ round: 1, actors: [{ id: 'a' }] });
    expect(state.activeCombat).not.toBeNull();
    state.applyCombatResult({ result: 'victory', victoryPayload: { defeatedSpawnIds: ['e1', 'e2'] } });
    expect(state.activeCombat).toBeNull();
    expect(state.stats.enemiesSlain).toBe(2);
  });

  it('retreat clears activeCombat and resets danger clock', () => {
    const state = makeState();
    state.setActiveCombat({ round: 1, actors: [{ id: 'a' }] });
    state.dangerClockProgress = 0.5;
    state.applyCombatResult({ result: 'retreat' });
    expect(state.activeCombat).toBeNull();
    expect(state.dangerClockProgress).toBe(0);
  });

  it('wipe clears activeCombat', () => {
    const state = makeState();
    state.setActiveCombat({ round: 1, actors: [{ id: 'a' }] });
    state.applyCombatResult({ result: 'wipe' });
    expect(state.activeCombat).toBeNull();
  });

  it('returns invalid for missing result', () => {
    const state = makeState();
    expect(state.applyCombatResult(null)).toEqual({ applied: false, reason: 'invalid-result' });
  });
});

describe('setActiveCombat', () => {
  it('sets activeCombat from a valid snapshot', () => {
    const state = makeState();
    state.setActiveCombat({ round: 3, actors: [{ id: 'a' }] });
    expect(state.activeCombat).toEqual({ round: 3, actors: [{ id: 'a' }] });
  });

  it('clears activeCombat when passed null', () => {
    const state = makeState({ activeCombat: { round: 1, actors: [] } });
    state.setActiveCombat(null);
    expect(state.activeCombat).toBeNull();
  });
});
