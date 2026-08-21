import { readFileSync } from 'node:fs';
import { validateGameData } from '../../src/data-loader.js';
import { createRNGCursorForRun } from '../../src/core/rng-cursor.js';
import { generateFloor } from '../../src/floor/generator.js';
import { validateFloor } from '../../src/floor/validator.js';
import { GRID_W, GRID_H } from '../../src/floor/archetypes.js';
import { createLattice } from '../../src/exploration/lattice.js';
import { moveParty, tickDangerClock } from '../../src/exploration/movement.js';
import { createRunState, validateRunState } from '../../src/state/run-state.js';
import { encodeRun, initEncoder } from '../../src/state/save-encode.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { createCreationModel } from '../../src/ui/creation-model.js';
import { deriveStats } from '../../src/rules/attributes.js';
import { generateLoot } from '../../src/rules/loot.js';
import { addItem, getInventoryCount } from '../../src/rules/inventory.js';
import { equipItem } from '../../src/rules/equipment.js';
import { createEnemy, createEcho } from '../../src/rules/enemies.js';
import { createStandardEncounter, createHuntEncounter, completeEncounter } from '../../src/rules/encounters.js';
import { beginFloorTransition, completeFloorTransition } from '../../src/rules/progression.js';
import { initiateCombat, getLegalActions, executeAction, resolveTurn, checkCombatEnd, getCharacterDeaths, toCombatSnapshot } from '../../src/rules/combat.js';

const ROOT = new URL('../../', import.meta.url);
const DATA_FILES = [
  ['sigils', 'sigils'],
  ['themes', 'themes'],
  ['classes', 'classes'],
  ['protocols', 'protocols'],
  ['enemies', 'enemies'],
  ['equipment', 'equipment'],
  ['affixes', 'affixes'],
  ['conditions', 'conditions'],
  ['consumables', 'consumables'],
  ['symbolTable', 'symbol-table']
];
const DIRECTIONS = [
  ['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0],
  ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1], ['nw', -1, -1]
];
const DEFAULT_WEAPON = { damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 6 };

let cachedData = null;

export function loadGameDataFixture() {
  if (cachedData) return cachedData;
  const registry = Object.fromEntries(DATA_FILES.map(([key, file]) => [key, JSON.parse(readFileSync(new URL(`data/${file}.json`, ROOT), 'utf8'))]));
  const validation = validateGameData(registry);
  if (!validation.valid) throw new Error(`invalid fixture data: ${JSON.stringify(validation.errors[0])}`);
  initEncoder(registry.symbolTable);
  cachedData = registry;
  return cachedData;
}

function firstLegalWeapon(classData) {
  return classData.equipmentGates.weapons.find((id) => id !== 'shield') || classData.equipmentGates.weapons[0] || null;
}

function firstLegalArmor(classData) {
  return classData.equipmentGates.armor.find((id) => id !== 'none') || null;
}

export function createLegalParty(size = 1, data = loadGameDataFixture()) {
  const model = createCreationModel(data);
  for (let index = 0; index < size; index++) {
    model.dispatch({ type: 'add_character' });
    const classData = data.classes.classes[index % data.classes.classes.length];
    const slot = index;
    model.dispatch({ type: 'set_class', slot, classId: classData.id });
    model.dispatch({ type: 'set_sigil', slot, sigil: data.sigils.playerBank.families[classData.sigilFamily].codepoints[index % 8] });
    const weapon = firstLegalWeapon(classData);
    const armor = firstLegalArmor(classData);
    if (weapon) model.dispatch({ type: 'equip_gear', slot, gearSlot: 'weapon', itemId: weapon });
    if (armor) model.dispatch({ type: 'equip_gear', slot, gearSlot: 'armor', itemId: armor });
    const school = classData.protocolGates.schools[0];
    if (school) model.dispatch({ type: 'add_protocol', slot, school, tier: 1 });
  }
  const finalized = model.finalize({ characterIds: Array.from({ length: size }, (_, index) => `operator_${index + 1}`) });
  if (!finalized.success) throw new Error(`party finalization failed: ${finalized.reason}`);
  return finalized;
}

export function createGameHarness({ seed = 4242, partySize = 1, depth = 1 } = {}) {
  const data = loadGameDataFixture();
  const creation = createLegalParty(partySize, data);
  const floor = generateFloor(seed, depth, {}, data.themes);
  const runState = createRunState(seed, creation.party, {
    creationTimestamp: seed * 1000 + partySize,
    depth,
    floorSubSeed: floor.floorSubSeed ?? 0,
    partyPosition: { ...floor.entryPoint },
    credits: creation.credits,
    themesSeen: floor.themeId ? [floor.themeId] : [],
    extensions: { floorThemeId: floor.themeId }
  });
  runState.rngState = createRNGCursorForRun(seed).getState();
  return hydrateHarness({ data, runState, floor });
}

export function floorGenerationOptions(runState, data = loadGameDataFixture()) {
  const themesSeen = runState?.themesSeen instanceof Set ? [...runState.themesSeen] : [...(runState?.themesSeen || [])];
  const currentThemeId = typeof runState?.extensions?.floorThemeId === 'string' ? runState.extensions.floorThemeId : null;
  const themeCount = data?.themes?.themes?.length ?? 0;
  const priorThemesSeen = currentThemeId && themesSeen.includes(currentThemeId) && !(themeCount > 0 && themesSeen.length >= themeCount)
    ? themesSeen.filter((themeId) => themeId !== currentThemeId)
    : themesSeen;
  return { floorSubSeed: runState.floorSubSeed ?? 0, themesSeen: priorThemesSeen };
}

export function regenerateFloorForRun(runState, data = loadGameDataFixture()) {
  return generateFloor(runState.worldSeed, runState.depth, floorGenerationOptions(runState, data), data.themes);
}

export function hydrateHarness({ data = loadGameDataFixture(), runState, floor }) {
  const lattice = createLattice(floor);
  lattice.setPartyPosition(runState.partyPosition.x, runState.partyPosition.y);
  return { data, runState, floor, lattice, fogState: new Uint8Array(640), cursor: createRNGCursorForRun(runState.worldSeed, runState.rngState) };
}

export function commitCursor(harness) {
  harness.runState.rngState = harness.cursor.getState();
}

export function createFogState() {
  return new Uint8Array(640);
}

export function findPath(cells, from, to) {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const queue = [from];
  const seen = new Set([`${from.x},${from.y}`]);
  const parent = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.x === to.x && current.y === to.y) {
      const path = [];
      let key = `${to.x},${to.y}`;
      while (parent.has(key)) {
        const [direction, previous] = parent.get(key);
        path.unshift(direction);
        key = previous;
      }
      return path;
    }
    for (const [direction, dx, dy] of DIRECTIONS) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = `${next.x},${next.y}`;
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height || seen.has(key) || cells[next.y][next.x] === 0) continue;
      if (dx !== 0 && dy !== 0 && cells[current.y][next.x] === 0 && cells[next.y][current.x] === 0) continue;
      seen.add(key);
      parent.set(key, [direction, `${current.x},${current.y}`]);
      queue.push(next);
    }
  }
  return null;
}

export function walkTo(harness, target, { maxSteps = 300, stopOnInterrupt = false } = {}) {
  const start = harness.lattice.getPartyPosition();
  const directions = findPath(harness.floor.cells, start, target);
  if (!directions) return { reached: false, directions: [], results: [] };
  const results = [];
  for (const direction of directions.slice(0, maxSteps)) {
    const result = moveParty(harness.lattice, harness.fogState, direction, harness.cursor, harness.runState);
    results.push(result);
    if (stopOnInterrupt && result.interruptType) break;
  }
  commitCursor(harness);
  const position = harness.lattice.getPartyPosition();
  return { reached: position.x === target.x && position.y === target.y, directions, results, position };
}

function floorId(harness) {
  return `${harness.runState.worldSeed}:${harness.runState.depth}:${harness.floor.floorSubSeed ?? 0}`;
}

function themeBias(harness) {
  return harness.data.themes.themes.find((theme) => theme.id === harness.floor.themeId)?.lootBias ?? {};
}

export function lootFirstContainer(harness) {
  const container = harness.floor.containers[0];
  if (!container) return { success: false, reason: 'no_container' };
  const walk = walkTo(harness, container);
  if (!walk.reached) return { success: false, reason: 'unreachable_container', walk };
  const items = generateLoot(harness.runState.worldSeed, harness.runState.depth, floorId(harness), container.id, themeBias(harness), harness.data.equipment, harness.data.affixes, harness.data.consumables, container);
  let inventory = harness.runState.inventory;
  const added = [];
  for (const item of items) {
    const result = addItem(inventory, item);
    if (!result.success) break;
    inventory = result.inventory;
    added.push(item);
  }
  harness.runState.inventory = inventory;
  harness.runState.markContainerOpened(container.id);
  harness.runState.recordEvent({ type: 'loot', containerId: container.id, count: added.length });
  return { success: added.length > 0, container, items, added, walk };
}

export function fillInventory(runState) {
  runState.inventory = [{
    id: 'cap_stack',
    category: 'consumable',
    baseType: 'repair_patch',
    rarity: 'stock',
    affixes: [],
    corrupt: false,
    stats: {},
    salvageValue: 1,
    junkTagged: false,
    count: 100
  }];
  return runState.inventory;
}

export function attemptOverflowPickup(runState) {
  return addItem(runState.inventory, {
    id: 'overflow', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false
  });
}

export function equipSpareSidearm(harness) {
  const item = { id: 'spare_sidearm', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false };
  harness.runState.inventory.push(item);
  const result = equipItem(harness.runState, harness.runState.party[0].id, 'weapon', item.id);
  if (result.success) harness.runState = result.runState;
  return result;
}

function classFor(data, character) {
  return data.classes.classes.find((entry) => entry.id === character.classId) ?? data.classes.classes[0];
}

export function combatActorFromCharacter(character, data, overrides = {}) {
  const stats = deriveStats(character, classFor(data, character), character.equipment);
  const hpMax = stats.hpMax;
  const chargeMax = stats.chargeMax;
  return {
    ...character,
    side: 'party',
    hp: Math.max(1, character.currentHP ?? hpMax),
    hpMax,
    charge: Math.max(0, character.currentCHARGE ?? chargeMax),
    chargeMax,
    currentHP: Math.max(1, character.currentHP ?? hpMax),
    currentCHARGE: Math.max(0, character.currentCHARGE ?? chargeMax),
    defense: stats.defenseBase ?? 10,
    protocolDefense: stats.protocolDefense ?? 10,
    weapon: character.equipment?.weapon || DEFAULT_WEAPON,
    protocols: character.protocolDeck || [],
    conditions: [...(character.conditions || [])],
    ...overrides
  };
}

export function combatContext(harness) {
  return {
    protocolsData: harness.data.protocols,
    conditionsData: harness.data.conditions.conditions,
    consumablesData: harness.data.consumables,
    enemiesData: harness.data.enemies,
    classData: harness.data.classes.classes[0],
    runState: harness.runState
  };
}

export function startStandardCombat(harness, { archetypeId = 'drone', archetypes = null, enemyCount = 1, enemyHP = 3, partyOverrides = [] } = {}) {
  const cycle = Array.isArray(archetypes) && archetypes.length > 0 ? archetypes : null;
  const enemies = Array.from({ length: enemyCount }, (_, index) => {
    const chosen = cycle ? cycle[index % cycle.length] : archetypeId;
    const enemy = createEnemy(chosen, harness.runState.depth, harness.cursor, harness.data.enemies);
    if (enemyHP !== 'natural') {
      enemy.hp = Math.min(enemy.hp, enemyHP + index);
      enemy.hpMax = Math.max(enemy.hp, enemyHP + index);
    }
    return enemy;
  });
  const party = harness.runState.party.map((character, index) => combatActorFromCharacter(character, harness.data, partyOverrides[index] || {}));
  const contact = harness.floor.enemySpawns[0] || harness.floor.descentPoint || harness.runState.partyPosition;
  const encounter = createStandardEncounter(harness.floor, contact, party, enemies, harness.cursor);
  const combatState = initiateCombat(encounter, harness.cursor, combatContext(harness));
  commitCursor(harness);
  harness.runState.setActiveCombat(toCombatSnapshot(combatState));
  return { encounter, combatState, cursor: harness.cursor, context: combatContext(harness) };
}

function livingEnemies(combatState) {
  return [...combatState.combatants.values()].filter((actor) => actor.side === 'enemy' && actor.hp > 0);
}

function activeActor(combatState) {
  return combatState.combatants.get(combatState.turnOrder[combatState.currentTurn]);
}

export function driveCombat(harness, combat, options = {}) {
  const context = combatContext(harness);
  const used = { item: false, protocol: false, overclock: false, move: false, retreat: false };
  let guard = options.maxTurns ?? 160;
  while (!combat.combatState.ended && guard-- > 0) {
    const status = resolveTurn(combat.combatState, harness.cursor, context);
    if (status.ended) break;
    const actor = activeActor(combat.combatState);
    if (!actor || actor.side !== 'party' || actor.hp <= 0) continue;
    const target = livingEnemies(combat.combatState)[0];
    let action = null;
    if (options.retreat && !used.retreat) {
      action = { type: 'retreat', actorId: actor.id };
      used.retreat = true;
    } else if (options.move && !used.move) {
      const direction = getLegalActions(combat.combatState, actor.id, context).legalMoveDirections[0];
      used.move = true;
      if (direction) {
        action = { type: 'move', actorId: actor.id, direction };
      }
    } else if (target && options.overclock && !used.overclock && actor.protocols?.length && actor.charge >= 4) {
      const protocol = actor.protocols[0];
      action = { type: 'overclock', actorId: actor.id, school: protocol.school, tier: protocol.tier, targetId: target.id };
      used.overclock = true;
    } else if (target && options.protocol && !used.protocol && actor.protocols?.length && actor.charge >= 2) {
      const protocol = actor.protocols[0];
      action = { type: 'cast', actorId: actor.id, school: protocol.school, tier: protocol.tier, targetId: target.id };
      used.protocol = true;
    } else if (options.item && !used.item && harness.runState.inventory.some((item) => item.baseType === 'repair_patch')) {
      actor.hp = Math.max(1, Math.min(actor.hp, Math.floor(actor.hpMax / 2)));
      action = { type: 'item', actorId: actor.id, targetId: actor.id, consumableId: 'repair_patch' };
      used.item = true;
    } else if (target) {
      action = { type: 'attack', actorId: actor.id, targetId: target.id };
    } else {
      action = { type: 'end-turn', actorId: actor.id };
    }
    if (action) executeAction(combat.combatState, action, harness.cursor, context);
    checkCombatEnd(combat.combatState);
  }
  commitCursor(harness);
  harness.runState.setActiveCombat(toCombatSnapshot(combat.combatState));
  return { combatState: combat.combatState, used, guardRemaining: guard, completion: completeEncounter(combat.encounter, combat.combatState) };
}

export function applyCombatToRun(harness, combatResult) {
  const applied = harness.runState.applyCombatResult(combatResult);
  harness.runState.setActiveCombat(null);
  return applied;
}

export function triggerHunt(harness) {
  const party = harness.runState.party.map((character) => combatActorFromCharacter(character, harness.data));
  const cursorState = harness.cursor.getState();
  const cells = [];
  for (let y = 0; y < harness.floor.cells.length; y++) {
    for (let x = 0; x < harness.floor.cells[0].length; x++) {
      if (harness.floor.cells[y][x] !== 0) cells.push({ x, y });
    }
  }
  const current = harness.runState.partyPosition;
  const viable = cells
    .sort((a, b) => Math.max(Math.abs(a.x - current.x), Math.abs(a.y - current.y)) - Math.max(Math.abs(b.x - current.x), Math.abs(b.y - current.y)) || a.y - b.y || a.x - b.x)
    .find((cell) => createHuntEncounter(harness.floor, cell, party, harness.runState, createRNGCursorForRun(harness.runState.worldSeed, cursorState), harness.data));
  if (viable) {
    harness.runState.partyPosition = { ...viable };
    harness.lattice.setPartyPosition(viable.x, viable.y);
  }
  harness.runState.dangerClockProgress = 0.999;
  const tick = tickDangerClock(harness.runState, 1, { exploring: true });
  const encounter = createHuntEncounter(harness.floor, harness.runState.partyPosition, party, harness.runState, harness.cursor, harness.data);
  commitCursor(harness);
  return { tick, encounter };
}

export function descend(harness, selections = null) {
  const start = beginFloorTransition(harness.runState, harness.data);
  if (start.error) return { start, result: start };
  const chosen = selections ?? Object.fromEntries((start.offers || []).map((offer) => [offer.characterId, offer.options[0].id]));
  const result = completeFloorTransition(harness.runState, start.transitionToken, chosen, { data: harness.data, themesData: harness.data.themes });
  if (!result.error) {
    harness.runState = result.runState;
    harness.floor = result.floor;
    harness.lattice = createLattice(result.floor);
    harness.lattice.setPartyPosition(result.runState.partyPosition.x, result.runState.partyPosition.y);
    harness.fogState = new Uint8Array(640);
    harness.cursor = createRNGCursorForRun(result.runState.worldSeed, result.runState.rngState);
  }
  return { start, result };
}

export function queueSingleDeathEcho(harness) {
  const dead = combatActorFromCharacter(harness.runState.party[0], harness.data, { hp: 0, currentHP: 0 });
  const survivor = combatActorFromCharacter(harness.runState.party[1] || harness.runState.party[0], harness.data, { id: 'survivor', hp: 10, currentHP: 10 });
  const echoEnemy = createEnemy('drone', harness.runState.depth, harness.cursor, harness.data.enemies);
  const encounter = createStandardEncounter(harness.floor, harness.floor.enemySpawns[0] || harness.floor.descentPoint, [dead, survivor], [echoEnemy], harness.cursor);
  const combatState = initiateCombat(encounter, harness.cursor, combatContext(harness));
  combatState.combatants.get(dead.id).hp = 0;
  const deaths = getCharacterDeaths(combatState);
  const queued = deaths.map((death) => harness.runState.queueEcho(death.character, harness.runState.depth, harness.cursor));
  commitCursor(harness);
  return { deaths, queued, echo: harness.runState.echoQueue[0] };
}

export function echoVictoryWithGear(harness) {
  const echo = createEcho({ ...harness.runState.party[0], hpMax: 20, defense: 10 }, harness.runState.depth);
  echo.position = { x: 2, y: 1 };
  echo.hp = 0;
  echo.equipment = { weapon: { id: 'echo_blade', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false } };
  const party = [combatActorFromCharacter(harness.runState.party[0], harness.data, { position: { x: 1, y: 1 } })];
  const combatState = {
    id: 'echo-reclaim',
    kind: 'standard',
    window: { originX: 0, originY: 0, width: 8, height: 16, cells: Array.from({ length: 16 }, () => Array(8).fill(1)) },
    round: 1,
    currentTurn: 0,
    turnOrder: [party[0].id, echo.id],
    combatants: new Map([[party[0].id, party[0]], [echo.id, echo]]),
    log: [],
    ended: false,
    result: null,
    forfeitableLoot: []
  };
  checkCombatEnd(combatState);
  return combatState.victoryPayload?.reclaimableGear || [];
}

export function roundTripRunState(runState) {
  const encoded = encodeRun(runState);
  if (!encoded.success) throw new Error(`encode failed: ${encoded.error}`);
  const decoded = decodeRun(encoded.fragment);
  if (!decoded.success) throw new Error(`decode failed: ${decoded.error}`);
  return { encoded, decoded: decoded.runState };
}

export function assertRunInvariants(runState, floor = null) {
  const validation = validateRunState(runState.serialize());
  if (!validation.valid) throw new Error(`invalid run state: ${validation.errors.join(',')}`);
  if (getInventoryCount(runState.inventory) > 100) throw new Error('inventory exceeds cap');
  if (runState.echoQueue.length > 2) throw new Error('echo queue exceeds cap');
  if (runState.party.some((character) => character.currentHP < 0 || character.currentCHARGE < 0)) throw new Error('negative party resource');
  if (runState.partyPosition.x < 0 || runState.partyPosition.x >= GRID_W || runState.partyPosition.y < 0 || runState.partyPosition.y >= GRID_H) throw new Error('party position out of bounds');
  const encoded = encodeRun(runState);
  if (!encoded.success || encoded.fragment.length >= 1500) throw new Error(`save budget failed: ${encoded.error || encoded.fragment.length}`);
  if (floor) {
    const floorValidation = validateFloor(floor);
    if (!floorValidation.valid) throw new Error(`invalid floor: ${floorValidation.failures.join(',')}`);
  }
  return { saveLength: encoded.fragment.length };
}

export function canonical(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return [...value];
  if (value instanceof Set) return [...value].sort();
  if (value instanceof Map) return [...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, entry]) => [key, canonical(entry)]);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => typeof entry !== 'function')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function canonicalRun(runState) {
  return canonical(runState.serialize());
}
