import { createRunState } from '../../src/state/run-state.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { deriveStats } from '../../src/rules/attributes.js';
import { makeParty } from './fixtures.js';
import { loadData } from './data.js';

const classData = loadData('classes');
const themesData = loadData('themes');
const themeIds = themesData.themes.map(t => t.id);

export function buildRealisticRun(seed, {
  depth = 1,
  inventoryItems = 0,
  fogCells = 0,
  echoes = 0,
} = {}) {
  const party = makeParty(2).map((c, i) => {
    const cls = classData.classes[i] || classData.classes[0];
    const derived = deriveStats(c, cls);
    return {
      ...c,
      hp: derived.hpMax,
      hpMax: derived.hpMax,
      charge: derived.chargeMax,
      chargeMax: derived.chargeMax,
    };
  });

  const state = createRunState(seed, party);
  state.creationTimestamp = seed * 1000 + 500;

  for (let d = 1; d < depth; d++) {
    state.advanceFloor();
  }

  const cursor = createRNGCursorForRun(seed);
  for (let i = 0; i < seed % 7; i++) cursor.next('gen');
  for (let i = 0; i < seed % 3; i++) cursor.next('combat');
  state.rngState = cursor.getState();

  for (let i = 0; i < Math.min(fogCells, 640); i++) {
    const x = (seed * (i + 1) * 7) % 20;
    const y = (seed * (i + 1) * 13) % 32;
    state.markCellVisited(x, y);
  }

  const idCount = Math.min(40, fogCells);
  for (let i = 0; i < idCount; i++) {
    if (i % 2 === 0) state.markContainerOpened(i % 20);
    else state.markEnemyDefeated(i % 20);
  }

  for (let i = 0; i < inventoryItems; i++) {
    state.inventory.push({
      id: `item_${i}`,
      baseType: 'sidearm',
      category: 'weapon',
      rarity: 'common',
      rarityTier: 0,
      affixes: [],
      corrupt: false,
      salvageValue: 1,
    });
  }

  state.corruption = (seed % 5) * 0.1;
  state.credits = seed * 10;
  state.scrapCounter = seed * 3;

  for (let i = 0; i < Math.min(3, themeIds.length); i++) {
    state.themesSeen.add(themeIds[(seed + i) % themeIds.length]);
  }

  for (let i = 0; i < echoes; i++) {
    state.queueEcho(party[i % party.length], depth);
  }

  state.flags.calibrationFloorsReached = [1, 3, 5].slice(0, seed % 4);

  return state;
}