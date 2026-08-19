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
    const value = item({ category: 'consumable', baseType: 'med_kit', rarity: 'stock', affixes: [], count: 7, corruptionValue: 0.1, extensions: { source: 'cache' } });
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

  it('writeEcho strips ephemeral combat-actor extension keys but preserves canonical extensions', () => {
    // Echoes queued from combat inherit combat-actor artifacts through the
    // spread in getCharacterDeaths → queueEcho → normalizeCharacter's
    // unknown-key fallback. Those keys (side, position, hpMax, defense, …)
    // are transient — createEcho computes them fresh at summon time. v5
    // sanitizes them at the wire boundary; canonical progression-driven
    // keys (deckSlotBonus, proficiencies) survive.
    const character = structuredClone(buildRealisticRun(21).party[0]);
    character.extensions = {
      deckSlotBonus: 2,
      proficiencies: ['sword'],
      side: 'party',
      hpMax: 24,
      defense: 12,
      chargeMax: 4,
      position: { x: 3, y: 4 },
      ap: 2,
      moveAvailable: true,
      _deathRecorded: true
    };
    const roundTripped = roundTrip(writeEcho, readEcho, { character, deathFloor: 4, appearanceFloor: 7 });
    expect(roundTripped.character.extensions).toEqual({ deckSlotBonus: 2, proficiencies: ['sword'] });
    expect(roundTripped.character.id).toBe(character.id);
    expect(roundTripped.character.attributes).toEqual(character.attributes);
  });

  it('writeEcho drops the extensions block entirely when only ephemeral keys are present', () => {
    // Round-trips of a purely ephemeral extensions bag emit no extensions
    // block on read — the read-side character has undefined extensions,
    // matching what a freshly-created character record looks like.
    const character = structuredClone(buildRealisticRun(22).party[0]);
    character.extensions = { side: 'party', hpMax: 20, moveAvailable: true, _deathRecorded: true };
    const roundTripped = roundTrip(writeEcho, readEcho, { character, deathFloor: 3, appearanceFloor: 6 });
    expect(roundTripped.character.extensions).toBeUndefined();
  });

  it('round-trips the compact active-combat state without floor geometry', () => {
    expect(roundTrip(writeCombatSnapshot, readCombatSnapshot, combat())).toEqual(combat());
  });

  it('round-trips an apex two-slot initiative order (duplicates legal in v5)', () => {
    // Apex actors take a second action slot per round (combat.js
    // buildTurnOrder), so initiativeOrder legitimately contains the same id
    // twice while actors[] holds each unique actor once. v5 codec accepts
    // this shape; v4 rejected it with duplicate_actor, so no real combat
    // containing an apex could save.
    const snapshot = combat();
    snapshot.actors[1].id = 'enemy_4_apex_11';
    snapshot.initiativeOrder = ['char_0', 'enemy_4_apex_11', 'enemy_4_apex_11'];
    snapshot.currentIndex = 2;
    const decoded = roundTrip(writeCombatSnapshot, readCombatSnapshot, snapshot);
    expect(decoded.initiativeOrder).toEqual(['char_0', 'enemy_4_apex_11', 'enemy_4_apex_11']);
    expect(decoded.currentIndex).toBe(2);
    expect(decoded.actors.map((a) => a.id)).toEqual(['char_0', 'enemy_4_apex_11']);
  });

  it('round-trips a snapshot whose encounter.id matches arena.contactId (sameAs flag)', () => {
    // toCombatSnapshot in the shipping runtime sets both fields to
    // combatState.id, so the sameAs path fires on every real save.
    const snapshot = combat();
    snapshot.encounter = { id: snapshot.arena.contactId, type: snapshot.encounter.type };
    expect(roundTrip(writeCombatSnapshot, readCombatSnapshot, snapshot)).toEqual(snapshot);
  });

  it('round-trips a same-depth run of enemy ids (delta context collapses cursor deltas)', () => {
    // Four enemies at the same depth exercise the delta-encoded id path:
    // the first writes the full compact form, the rest write 1-bit same-depth
    // + 3-bit archetype + signed varInt cursor delta. Round-tripping proves
    // the read side rebuilds the exact id strings.
    const snapshot = combat();
    snapshot.actors = [
      { id: 'operator_1', side: 'party', x: 1, y: 1, hp: 20, charge: 4, conditions: [], initiative: 12, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false },
      { id: 'enemy_4_drone_7', side: 'enemy', x: 3, y: 4, hp: 8, charge: 0, conditions: [], initiative: 10, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false, stats: { archetypeId: 'drone', hpMax: 8, chargeMax: 0, sigilCodepoint: 57392 } },
      { id: 'enemy_4_drone_9', side: 'enemy', x: 3, y: 5, hp: 8, charge: 0, conditions: [], initiative: 9, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false, stats: { archetypeId: 'drone', hpMax: 8, chargeMax: 0, sigilCodepoint: 57392 } },
      { id: 'enemy_4_null_12', side: 'enemy', x: 4, y: 4, hp: 12, charge: 0, conditions: [], initiative: 8, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false, stats: { archetypeId: 'null', hpMax: 12, chargeMax: 0, sigilCodepoint: 57404 } },
    ];
    snapshot.initiativeOrder = snapshot.actors.map((actor) => actor.id);
    snapshot.currentIndex = 0;
    expect(roundTrip(writeCombatSnapshot, readCombatSnapshot, snapshot)).toEqual(snapshot);
  });

  it('rejects collection overflows, duplicate IDs, and invalid compact enums', () => {
    expect(() => roundTrip(writeItem, readItem, item({ affixes: Array(9).fill('edged') }))).toThrow('invalid_item');
    const character = buildRealisticRun(3).serialize().party[0];
    expect(() => roundTrip(writeCharacter, readCharacter, { ...character, protocolDeck: Array(21).fill({ school: 'ward', tier: 1 }) })).toThrow('invalid_character');
    // Duplicate ACTOR entries (same id in actors[]) still fail — the apex
    // fix only relaxes duplicates in initiativeOrder, not actors.
    const invalidCombat = combat();
    invalidCombat.actors.push({ ...invalidCombat.actors[0] });
    expect(() => roundTrip(writeCombatSnapshot, readCombatSnapshot, invalidCombat)).toThrow('duplicate_actor');
    // Three-slot references (>2 per actor) exceed the apex ceiling and fail.
    const overReferenced = combat();
    overReferenced.initiativeOrder = ['char_0', 'char_0', 'char_0', 'enemy_0'];
    overReferenced.currentIndex = 0;
    expect(() => roundTrip(writeCombatSnapshot, readCombatSnapshot, overReferenced)).toThrow('invalid_combat');
    // Missing-actor references (initiativeOrder references an id not in actors[]) fail.
    const missing = combat();
    missing.initiativeOrder = ['char_0', 'missing_id'];
    expect(() => roundTrip(writeCombatSnapshot, readCombatSnapshot, missing)).toThrow('invalid_combat');
    // Unreferenced actor (actor absent from initiativeOrder) fails.
    const unreferenced = combat();
    unreferenced.initiativeOrder = ['char_0', 'char_0'];
    expect(() => roundTrip(writeCombatSnapshot, readCombatSnapshot, unreferenced)).toThrow('invalid_combat');
    expect(() => roundTrip(writeEcho, readEcho, { character, deathFloor: 4, appearanceFloor: 5 })).toThrow('invalid_echo');
  });

  it('rejects truncated binary input before allocating decoded collections', () => {
    const writer = createBitWriter();
    writer.writeUint(31, 5);
    expect(() => readCombatSnapshot(createBitReader(writer.toUint8Array(), writer.bitLength))).toThrow('truncated');
  });
});
