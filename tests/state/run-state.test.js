import { describe, it, expect } from 'vitest';
import { createRunState, deserializeRunState } from '../../src/state/run-state.js';
import { dangerClockBaseRate, corruptionDangerRate } from '../../src/rules/scaling.js';
import { makeCharacter, makeParty } from '../helpers/fixtures.js';

describe('createRunState — defaults', () => {
  const party = makeParty(2);
  const state = createRunState(42, party);

  it('worldSeed set', () => { expect(state.worldSeed).toBe(42); });
  it('depth: 1', () => { expect(state.depth).toBe(1); });
  it('partyPosition {x:10, y:0}', () => { expect(state.partyPosition).toEqual({ x: 10, y: 0 }); });
  it('fogOfWar is Uint8Array(80) of zeros', () => {
    expect(state.fogOfWar).toBeInstanceOf(Uint8Array);
    expect(state.fogOfWar.length).toBe(80);
    expect(state.fogOfWar.every(b => b === 0)).toBe(true);
  });
  it('openedContainers === 0n', () => { expect(state.openedContainers).toBe(0n); });
  it('defeatedEnemies === 0n', () => { expect(state.defeatedEnemies).toBe(0n); });
  it('dangerClockProgress: 0', () => { expect(state.dangerClockProgress).toBe(0); });
  it('inventory empty', () => { expect(state.inventory).toEqual([]); });
  it('corruption: 0', () => { expect(state.corruption).toBe(0); });
  it('credits: 0', () => { expect(state.credits).toBe(0); });
  it('scrapCounter: 0', () => { expect(state.scrapCounter).toBe(0); });
  it('themesSeen empty Set', () => { expect(state.themesSeen).toBeInstanceOf(Set); expect(state.themesSeen.size).toBe(0); });
  it('echoQueue: []', () => { expect(state.echoQueue).toEqual([]); });
  it('rngState: null', () => { expect(state.rngState).toBeNull(); });
  it('flags.version: 1, calibrationFloorsReached: []', () => {
    expect(state.flags).toEqual({ version: 1, calibrationFloorsReached: [] });
  });
  it('party held by reference', () => { expect(state.party).toBe(party); });
  it('creationTimestamp is a number', () => { expect(typeof state.creationTimestamp).toBe('number'); });
});

describe('serialize — JSON safety contract', () => {
  const state = createRunState(7, makeParty(1));
  state.markContainerOpened(0);
  state.markContainerOpened(2);
  state.themesSeen.add('industrial');
  state.themesSeen.add('organic');

  it('fogOfWar → plain Array(80)', () => {
    const s = state.serialize();
    expect(Array.isArray(s.fogOfWar)).toBe(true);
    expect(s.fogOfWar).toHaveLength(80);
  });
  it('openedContainers → decimal string', () => {
    const s = state.serialize();
    expect(s.openedContainers).toBe('5');
  });
  it('defeatedEnemies → decimal string "0"', () => {
    const s = state.serialize();
    expect(s.defeatedEnemies).toBe('0');
  });
  it('themesSeen → Array', () => {
    const s = state.serialize();
    expect(Array.isArray(s.themesSeen)).toBe(true);
    expect(s.themesSeen).toContain('industrial');
    expect(s.themesSeen).toContain('organic');
  });
  it('flags deep-copied — mutating serialized flags does not touch state', () => {
    const s = state.serialize();
    s.flags.calibrationFloorsReached.push(3);
    expect(state.flags.calibrationFloorsReached).toEqual([]);
  });
  it('JSON.stringify(serialize()) does not throw', () => {
    expect(() => JSON.stringify(state.serialize())).not.toThrow();
  });
  it('openedContainers "0" for fresh state', () => {
    const fresh = createRunState(1, []);
    expect(fresh.serialize().openedContainers).toBe('0');
  });
});

describe('advanceFloor', () => {
  it('depth++, fog zeroed, BigInts reset, conditions emptied', () => {
    const party = [makeCharacter({ id: 'a', conditions: [{ id: 'burning', duration: 2, stacks: 1 }] }), makeCharacter({ id: 'b' })];
    const state = createRunState(1, party);
    state.markContainerOpened(1);
    state.markEnemyDefeated(3);
    state.markCellVisited(0, 0);
    state.advanceFloor();
    expect(state.depth).toBe(2);
    expect(state.fogOfWar.every(b => b === 0)).toBe(true);
    expect(state.openedContainers).toBe(0n);
    expect(state.defeatedEnemies).toBe(0n);
    expect(state.party[0].conditions).toEqual([]);
  });

  it('members without conditions key untouched', () => {
    const party = [{ id: 'noconds', hp: 20 }];
    const state = createRunState(1, party);
    expect(() => state.advanceFloor()).not.toThrow();
  });
});

describe('mutators — corruption, scrap, inventory', () => {
  it('addCorruption accumulates', () => {
    const state = createRunState(1, []);
    state.addCorruption(0.1);
    state.addCorruption(0.05);
    expect(state.corruption).toBeCloseTo(0.15);
  });
  it('addScrap accumulates', () => {
    const state = createRunState(1, []);
    state.addScrap(5);
    state.addScrap(3);
    expect(state.scrapCounter).toBe(8);
  });
  it('getInventoryCount', () => {
    const state = createRunState(1, []);
    state.inventory.push({ id: 'i1' }, { id: 'i2' });
    expect(state.getInventoryCount()).toBe(2);
  });
  it('isInventoryFull at 99 → false', () => {
    const state = createRunState(1, []);
    state.inventory = Array(99).fill({ id: 'x' });
    expect(state.isInventoryFull()).toBe(false);
  });
  it('isInventoryFull at 100 → true', () => {
    const state = createRunState(1, []);
    state.inventory = Array(100).fill({ id: 'x' });
    expect(state.isInventoryFull()).toBe(true);
  });
});

describe('markContainerOpened / markEnemyDefeated', () => {
  it('markContainerOpened(0) → bit 0 set → 1n', () => {
    const state = createRunState(1, []);
    state.markContainerOpened(0);
    expect(state.openedContainers).toBe(1n);
  });
  it('markContainerOpened(5) → |= 32n', () => {
    const state = createRunState(1, []);
    state.markContainerOpened(5);
    expect(state.openedContainers).toBe(32n);
  });
  it('ids up to 63 work', () => {
    const state = createRunState(1, []);
    state.markContainerOpened(63);
    expect(state.openedContainers).toBe(1n << 63n);
  });
  it('markEnemyDefeated works the same', () => {
    const state = createRunState(1, []);
    state.markEnemyDefeated(0);
    state.markEnemyDefeated(2);
    expect(state.defeatedEnemies).toBe(5n);
  });
});

describe('markCellVisited', () => {
  it('(0,0) sets byte 0 bit 0', () => {
    const state = createRunState(1, []);
    state.markCellVisited(0, 0);
    expect(state.fogOfWar[0] & 1).toBe(1);
  });
  it('(19,31) sets byte 79 bit 7', () => {
    const state = createRunState(1, []);
    state.markCellVisited(19, 31);
    expect(state.fogOfWar[79] & 0x80).toBe(0x80);
  });
  it('out-of-range (y=32) silently ignored', () => {
    const state = createRunState(1, []);
    const before = [...state.fogOfWar];
    state.markCellVisited(0, 32);
    expect([...state.fogOfWar]).toEqual(before);
  });
});

describe('queueEcho', () => {
  it('pushes {character, deathFloor, appearanceFloor} with appearanceFloor in [deathFloor+2, deathFloor+4]', () => {
    const char = makeCharacter({ id: 'dead' });
    for (let i = 0; i < 20; i++) {
      const state = createRunState(i, []);
      state.queueEcho(char, 5);
      const entry = state.echoQueue[0];
      expect(entry.character).toBe(char);
      expect(entry.deathFloor).toBe(5);
      expect(entry.appearanceFloor).toBeGreaterThanOrEqual(7);
      expect(entry.appearanceFloor).toBeLessThanOrEqual(9);
    }
  });
  it('queue caps at 2 (third call ignored)', () => {
    const state = createRunState(1, []);
    const c1 = makeCharacter({ id: 'c1' });
    const c2 = makeCharacter({ id: 'c2' });
    const c3 = makeCharacter({ id: 'c3' });
    state.queueEcho(c1, 1);
    state.queueEcho(c2, 2);
    state.queueEcho(c3, 3);
    expect(state.echoQueue).toHaveLength(2);
    expect(state.echoQueue[0].character).toBe(c1);
    expect(state.echoQueue[1].character).toBe(c2);
  });
});

describe('getDangerClockRate', () => {
  it('equals dangerClockBaseRate(depth) + corruptionDangerRate(corruption)', () => {
    const state = createRunState(1, []);
    state.depth = 10;
    state.corruption = 0.5;
    const expected = dangerClockBaseRate(10) + corruptionDangerRate(0.5);
    expect(state.getDangerClockRate()).toBeCloseTo(expected);
  });
});

describe('deserializeRunState — full round-trip', () => {
  it('mutate everything, serialize → deserialize → serialize deep-equal', () => {
    const party = makeParty(2);
    const state = createRunState(99, party);
    state.depth = 5;
    state.floorSubSeed = 3;
    state.markContainerOpened(1);
    state.markContainerOpened(3);
    state.markEnemyDefeated(0);
    state.markCellVisited(5, 10);
    state.inventory = [{ id: 'i1', baseType: 'sword' }];
    state.corruption = 0.3;
    state.credits = 500;
    state.scrapCounter = 42;
    state.themesSeen.add('industrial');
    state.themesSeen.add('digital');
    state.dangerClockProgress = 0.15;
    state.echoQueue = [{ character: makeCharacter({ id: 'echo1' }), deathFloor: 3, appearanceFloor: 6 }];
    state.rngState = { gen: { cursor: 5, prngState: [1, 2, 3, 4] } };
    state.flags.calibrationFloorsReached = [3, 6];
    state.partyPosition = { x: 5, y: 7 };

    const serialized = state.serialize();
    const deserialized = deserializeRunState(serialized);
    expect(deserialized.serialize()).toEqual(serialized);
  });
});

describe('deserializeRunState — empty object', () => {
  it('sane defaults: worldSeed 0, party [], depth 1', () => {
    const state = deserializeRunState({});
    expect(state.worldSeed).toBe(0);
    expect(state.party).toEqual([]);
    expect(state.depth).toBe(1);
  });
});

describe('deserializeRunState — falsy-field quirks', () => {
  it('depth: 0 is ignored (if(data.depth)) → stays 1', () => {
    const state = deserializeRunState({ depth: 0 });
    expect(state.depth).toBe(1);
  });
  it('corruption: 0 IS honored (!== undefined)', () => {
    const state = deserializeRunState({ corruption: 0 });
    expect(state.corruption).toBe(0);
  });
  it('credits: 0 IS honored', () => {
    const state = deserializeRunState({ credits: 0 });
    expect(state.credits).toBe(0);
  });
  it('openedContainers "0" → 0n', () => {
    const state = deserializeRunState({ openedContainers: '0' });
    expect(state.openedContainers).toBe(0n);
  });
  it('flags missing calibrationFloorsReached → defaults to [] with version forced to 1', () => {
    const state = deserializeRunState({ flags: { version: 999 } });
    expect(state.flags.version).toBe(1);
    expect(state.flags.calibrationFloorsReached).toEqual([]);
  });
});