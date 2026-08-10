import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { createRunState } from '../../src/state/run-state.js';
import { deriveStats } from '../../src/rules/attributes.js';
import { makeParty } from './fixtures.js';
import { loadData } from './data.js';

const classData = loadData('classes');
const themesData = loadData('themes');
const themeIds = themesData.themes.map(theme => theme.id);

export function buildRealisticRun(seed, { depth = 1, inventoryItems = 0, fogCells = 0, echoes = 0 } = {}) {
  const party = makeParty(2).map((character, index) => {
    const characterClass = classData.classes[index] || classData.classes[0];
    const derived = deriveStats(character, characterClass);
    return {
      id: character.id,
      classId: characterClass.id,
      sigilId: `pua-${character.sigilCodepoint.toString(16)}`,
      attributes: { ...character.attributes },
      currentHP: derived.hpMax,
      currentCHARGE: derived.chargeMax,
      calibrationCount: 0,
      calibrationChoices: [],
      signatureTier: 1,
      equipment: { weapon: null, armor: null, offhand: null },
      protocolDeck: [],
      conditions: []
    };
  });
  const state = createRunState(seed, party, { creationTimestamp: seed * 1000 + 500 });
  for (let currentDepth = 1; currentDepth < depth; currentDepth++) state.advanceFloor();
  const cursor = createRNGCursorForRun(seed);
  for (let index = 0; index < seed % 7; index++) cursor.next('gen');
  for (let index = 0; index < seed % 3; index++) cursor.next('combat');
  state.rngState = cursor.getState();
  for (let index = 0; index < Math.min(fogCells, 640); index++) state.markCellVisited((seed * (index + 1) * 7) % 20, (seed * (index + 1) * 13) % 32);
  for (let index = 0; index < Math.min(40, fogCells); index++) {
    if (index % 2 === 0) state.markContainerOpened(index % 20);
    else state.markEnemyDefeated(index % 20);
  }
  state.inventory = Array.from({ length: Math.min(inventoryItems, 100) }, (_, index) => ({
    id: `item_${index}`,
    baseType: 'sidearm',
    category: 'weapon',
    rarity: 'stock',
    affixes: [],
    corrupt: false,
    stats: {},
    salvageValue: 1,
    junkTagged: false
  }));
  state.corruption = (seed % 5) * 0.1;
  state.credits = seed * 10;
  state.scrapCounter = seed * 3;
  for (let index = 0; index < Math.min(3, themeIds.length); index++) state.themesSeen.add(themeIds[(seed + index) % themeIds.length]);
  for (let index = 0; index < Math.min(echoes, 2); index++) state.queueEcho(party[index % party.length], depth, cursor);
  state.flags.calibrationFloorsReached = [1, 3, 5].slice(0, seed % 4);
  return state;
}

export function buildMaximumRun(seed = 42) {
  const state = buildRealisticRun(seed, { depth: 60, inventoryItems: 100, fogCells: 640, echoes: 2 });
  const party = makeParty(4).map((character, index) => ({
    id: `max_char_${index}`,
    classId: classData.classes[index].id,
    sigilId: `pua-${character.sigilCodepoint.toString(16)}`,
    attributes: { mgt: 10, fin: 10, vit: 10, res: 10, foc: 10, sig: 10 },
    currentHP: 255,
    currentCHARGE: 255,
    calibrationCount: 16,
    calibrationChoices: Array.from({ length: 16 }, (_, choice) => ({ floor: choice + 1, optionId: `calibration_${index}_${choice}` })),
    signatureTier: 3,
    equipment: {
      weapon: { id: `equipped_weapon_${index}`, category: 'weapon', baseType: 'sidearm', rarity: 'prototype', affixes: ['edged'], corrupt: false, stats: { damage: 12 }, salvageValue: 999, junkTagged: false },
      armor: { id: `equipped_armor_${index}`, category: 'armor', baseType: 'light', rarity: 'custom', affixes: [], corrupt: false, stats: { defense: 4 }, salvageValue: 999, junkTagged: false },
      offhand: null
    },
    protocolDeck: Array.from({ length: 20 }, (_, protocol) => ({ school: 'disrupt', tier: (protocol % 5) + 1 })),
    conditions: [{ conditionId: 'burning', duration: 3, stacks: 2 }]
  }));
  state.party = party;
  state.echoQueue = [0, 1].map((index) => ({ character: structuredClone(party[index]), deathFloor: 50 + index, appearanceFloor: 53 + index }));
  state.inventory = Array.from({ length: 100 }, (_, index) => ({
    id: `maximum_item_${index}`,
    category: index % 3 === 0 ? 'consumable' : index % 3 === 1 ? 'weapon' : 'armor',
    baseType: index % 3 === 0 ? 'med_kit' : index % 3 === 1 ? 'sidearm' : 'light',
    rarity: 'prototype',
    affixes: ['edged'],
    corrupt: false,
    stats: { index, values: [1, 2, 3] },
    salvageValue: 999,
    junkTagged: index % 2 === 0,
    ...(index % 3 === 0 ? { count: 1 } : {})
  }));
  state.themesSeen = new Set(themeIds);
  state.flags.calibrationFloorsReached = Array.from({ length: 16 }, (_, index) => index + 1);
  state.stats = { enemiesSlain: 1_000, echoesSlain: 2, corruptItemsEquipped: 0, floorsDescended: 59 };
  state.recentEvents = Array.from({ length: 64 }, (_, index) => ({ index, type: 'combat', result: true }));
  state.activeCombat = {
    arena: { originX: 0, originY: 0, contactId: 'maximum_contact' },
    actors: [
      { id: 'max_actor_party', side: 'party', x: 1, y: 1, hp: 255, charge: 255, conditions: [], initiative: 10, ap: 2, moves: 1, freeActions: 1, defeated: false, retreated: false },
      { id: 'max_actor_enemy', side: 'enemy', x: 2, y: 1, hp: 255, charge: 0, conditions: [], initiative: 9, ap: 2, moves: 1, freeActions: 0, defeated: false, retreated: false }
    ],
    initiativeOrder: ['max_actor_party', 'max_actor_enemy'],
    currentIndex: 0,
    round: 255,
    pendingEffects: Array.from({ length: 32 }, (_, index) => ({ index, type: 'damage' })),
    encounter: { id: 'maximum_encounter', type: 'hunt' },
    eventOrder: 1_000
  };
  return state;
}
