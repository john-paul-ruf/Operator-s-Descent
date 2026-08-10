import { describe, expect, it } from 'vitest';
import { createBitReader, createBitWriter } from '../../src/state/bit-codec.js';
import { initCondenser } from '../../src/state/condense.js';
import { readCharacter, readCombatSnapshot, readEcho, readItem, writeCharacter, writeCombatSnapshot, writeEcho, writeItem } from '../../src/state/save-codecs.js';
import { loadData } from '../helpers/data.js';
import { buildRealisticRun } from '../helpers/run-builder.js';

initCondenser(loadData('symbol-table'));

function roundTrip(write, read, value) {
  const writer = createBitWriter();
  write(writer, value);
  const reader = createBitReader(writer.toUint8Array(), writer.bitLength);
  const result = read(reader);
  reader.assertEOF();
  return result;
}

function item(overrides = {}) {
  return {
    id: 'weapon_01',
    category: 'weapon',
    baseType: 'sidearm',
    rarity: 'tuned',
    affixes: ['edged'],
    corrupt: false,
    stats: { bonus: 1, tags: ['test'] },
    salvageValue: 1.5,
    junkTagged: true,
    ...overrides
  };
}

function combat() {
  return {
    arena: { originX: 4, originY: 7, contactId: 'contact_01' },
    actors: [
      { id: 'char_0', side: 'party', x: 5, y: 7, hp: 12, charge: 4, conditions: [], initiative: 8, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false },
      { id: 'enemy_0', side: 'enemy', x: 8, y: 7, hp: 9, charge: 0, conditions: [{ conditionId: 'marked', duration: 2 }], initiative: 5, ap: 2, moves: 0, freeActions: 1, defeated: false, retreated: false }
    ],
    initiativeOrder: ['char_0', 'enemy_0'],
    currentIndex: 1,
    round: 3,
    pendingEffects: [{ type: 'burn', target: 'enemy_0', damage: 2 }],
    encounter: { id: 'hunt_7', type: 'hunt' },
    eventOrder: 12
  };
}

describe('save codecs', () => {
  it('round-trips an item including stack counts and bounded structured metadata', () => {
    const value = item({ category: 'consumable', baseType: 'med_kit', rarity: 'stock', affixes: [], count: 7, extensions: { source: 'cache' } });
    expect(roundTrip(writeItem, readItem, value)).toEqual(value);
  });

  it('round-trips canonical characters and echoes', () => {
    const character = structuredClone(buildRealisticRun(17).party[0]);
    character.equipment.weapon = item();
    character.protocolDeck = [{ school: 'ward', tier: 2 }];
    character.conditions = [{ conditionId: 'burning', duration: 3, stacks: 2 }];
    character.calibrationCount = 1;
    character.calibrationChoices = [{ floor: 3, optionId: 'breacher-3-a' }];
    expect(roundTrip(writeCharacter, readCharacter, character)).toEqual(character);
    expect(roundTrip(writeEcho, readEcho, { character, deathFloor: 4, appearanceFloor: 7 })).toEqual({ character, deathFloor: 4, appearanceFloor: 7 });
  });

  it('round-trips the compact active-combat state without floor geometry', () => {
    expect(roundTrip(writeCombatSnapshot, readCombatSnapshot, combat())).toEqual(combat());
  });

  it('rejects collection overflows, duplicate IDs, and invalid compact enums', () => {
    expect(() => roundTrip(writeItem, readItem, item({ affixes: Array(9).fill('edged') }))).toThrow('invalid_item');
    const character = buildRealisticRun(3).serialize().party[0];
    expect(() => roundTrip(writeCharacter, readCharacter, { ...character, protocolDeck: Array(21).fill({ school: 'ward', tier: 1 }) })).toThrow('invalid_character');
    const invalidCombat = combat();
    invalidCombat.actors.push({ ...invalidCombat.actors[0] });
    expect(() => roundTrip(writeCombatSnapshot, readCombatSnapshot, invalidCombat)).toThrow('duplicate_actor');
    expect(() => roundTrip(writeEcho, readEcho, { character, deathFloor: 4, appearanceFloor: 5 })).toThrow('invalid_echo');
  });

  it('rejects truncated binary input before allocating decoded collections', () => {
    const writer = createBitWriter();
    writer.writeUint(31, 5);
    expect(() => readCombatSnapshot(createBitReader(writer.toUint8Array(), writer.bitLength))).toThrow('truncated');
  });
});
