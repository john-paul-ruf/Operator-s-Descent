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
