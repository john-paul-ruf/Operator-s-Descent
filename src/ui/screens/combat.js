import { createStatusBar } from '../status-strip.js';
import { createPlayfield } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { bus } from '../../state/bus.js';
import { createRNGCursorForRun } from '../../core/rng-cursor.js';
import { createEnemy } from '../../rules/enemies.js';
import { initiateCombat, executeAction, resolveTurn } from '../../rules/combat.js';
import { gameData } from '../../main.js';

export function mount(container, params) {
  const { runState, floor, lattice, combatState: existingCombat } = params;
  const rngCursor = createRNGCursorForRun(runState.worldSeed, runState.rngState);
  const enemies = existingCombat
    ? []
    : normalizeEnemySpawns(floor?.enemySpawns, runState.depth, rngCursor, gameData.enemies);
  const combatState = existingCombat || initiateCombat(runState.party, enemies, rngCursor);
  const rulesContext = {
    runState,
    protocolsData: gameData.protocols,
    conditionsData: gameData.conditions,
    consumablesData: gameData.consumables,
    lattice: lattice ? lattice.getGrid() : null,
  };

  resolveTurn(combatState, rngCursor, rulesContext);
  runState.rngState = rngCursor.getState();

  const selection = {
    actorId: null,
    type: 'attack',
    targetId: null,
    school: null,
    tier: null,
    consumableId: null,
    error: null
  };
  syncSelectionActor(selection, combatState);

  let mounted = true;
  let terminalDispatched = false;
  let statusBar = createStatusBar(runState, combatState);
  container.appendChild(statusBar);

  const inputHandler = createInputHandler();
  inputHandler.bindToElement(container);

  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 768;
  container.appendChild(canvas);
  const playfield = createPlayfield(canvas);
  playfield.setAccent('#7ec8e3');

  const state = {
    runState,
    combatState,
    selection,
    protocolsData: gameData.protocols,
    consumablesData: gameData.consumables,
    inputHandler,
    canvas,
    playfield,
    lattice
  };
  const consoleController = createConsole(state);
  container.appendChild(consoleController.render());
  consoleController.setMode('combat');

  const zoomOrigin = lattice ? lattice.getPartyPosition() : { x: 10, y: 8 };
  reRender();

  const unsubscribers = [
    bus.on('combat:action', handleActionSelection),
    bus.on('combat:select-target', handleTargetSelection),
    bus.on('combat:select-protocol', handleProtocolSelection),
    bus.on('combat:select-item', handleItemSelection),
    bus.on('combat:confirm', confirmSelection),
    bus.on('combat:cancel', clearSelectionError)
  ];

  dispatchTerminal();

  function handleActionSelection(payload = {}) {
    if (!mounted || !payload.type) return;
    selection.type = payload.type;
    selection.targetId = null;
    selection.school = payload.school || null;
    selection.tier = payload.tier || null;
    selection.consumableId = payload.consumableId || null;
    selection.error = null;
    reRender();
  }

  function handleTargetSelection(payload) {
    if (!mounted) return;
    selection.targetId = payload?.targetId ?? payload?.id ?? payload;
    selection.error = null;
    reRender();
  }

  function handleProtocolSelection(payload = {}) {
    if (!mounted) return;
    selection.school = payload.school || null;
    selection.tier = payload.tier || null;
    selection.error = null;
    reRender();
  }

  function handleItemSelection(payload = {}) {
    if (!mounted) return;
    selection.consumableId = payload.consumableId || payload.baseType || payload.id || null;
    selection.error = null;
    reRender();
  }

  function confirmSelection() {
    if (!mounted || terminalDispatched) return;
    syncSelectionActor(selection, combatState);

    const actor = getActiveActor(combatState);
    if (!actor || actor.side !== 'party') {
      selection.error = 'WAIT FOR A PARTY TURN';
      reRender();
      return;
    }

    const validationError = validateSelection(selection, actor, combatState, runState, gameData);
    if (validationError) {
      selection.error = validationError;
      reRender();
      return;
    }

    const action = {
      type: selection.type,
      actorId: actor.id,
      targetId: selection.targetId,
      school: selection.school,
      tier: selection.tier,
      consumableId: selection.consumableId
    };
    const result = executeAction(combatState, action, rngCursor, rulesContext);
    if (!result.success && selection.type !== 'retreat') {
      selection.error = actionFailureMessage(result.reason);
      reRender();
      return;
    }

    runState.rngState = rngCursor.getState();
    resolveTurn(combatState, rngCursor, rulesContext);
    runState.rngState = rngCursor.getState();
    selection.targetId = null;
    if (selection.type === 'item') selection.consumableId = null;
    selection.error = null;
    syncSelectionActor(selection, combatState);
    reRender();
    dispatchTerminal();
  }

  function clearSelectionError() {
    if (!mounted) return;
    selection.error = null;
    reRender();
  }

  function reRender() {
    playfield.renderCombat(combatState, lattice, zoomOrigin);
    const nextStatusBar = createStatusBar(runState, combatState);
    statusBar.replaceWith(nextStatusBar);
    statusBar = nextStatusBar;
    consoleController.refresh();
  }

  function dispatchTerminal() {
    if (!mounted || terminalDispatched || !combatState.ended) return;
    terminalDispatched = true;
    const payload = { runState, result: combatState.result, combatState };
    if (combatState.result === 'victory') bus.dispatch('state:combat-end', payload);
    if (combatState.result === 'wipe') bus.dispatch('state:party-wipe', payload);
  }

  return {
    unmount() {
      mounted = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
    }
  };
}

function normalizeEnemySpawns(spawns, depth, rngCursor, enemiesData) {
  return (spawns || []).map((spawn, index) => {
    if (!spawn) return null;
    const position = spawn.position || { x: spawn.x ?? 0, y: spawn.y ?? 0 };
    if (spawn.hp !== undefined && spawn.hpMax !== undefined && spawn.defense !== undefined) {
      return { ...spawn, id: spawn.id ?? `enemy_${depth}_${index}`, side: 'enemy', position };
    }

    const enemy = createEnemy(spawn.archetypeId, depth, rngCursor, enemiesData);
    return enemy
      ? { ...enemy, id: spawn.id ?? enemy.id, side: 'enemy', position }
      : null;
  }).filter(Boolean);
}

function getActiveActor(combatState) {
  const actorId = combatState.turnOrder?.[combatState.currentTurn];
  return combatState.combatants instanceof Map
    ? combatState.combatants.get(actorId)
    : (combatState.combatants || []).find(actor => actor.id === actorId);
}

function syncSelectionActor(selection, combatState) {
  const actor = getActiveActor(combatState);
  if (selection.actorId === actor?.id) return;
  selection.actorId = actor?.id ?? null;
  selection.type = 'attack';
  selection.targetId = null;
  selection.school = null;
  selection.tier = null;
  selection.consumableId = null;
  selection.error = null;
}

function validateSelection(selection, actor, combatState, runState, data) {
  if (actor.ap <= 0) return 'NO AP REMAINING';
  if (selection.type === 'attack') {
    const target = getCombatant(combatState, selection.targetId);
    if (!target || target.hp <= 0 || target.side !== 'enemy') return 'SELECT A LIVING TARGET';
  }
  if (selection.type === 'cast' || selection.type === 'overclock') {
    const protocol = actor.protocols?.find(p => p.school === selection.school && p.tier === selection.tier);
    if (!protocol || !data.protocols?.schools?.[selection.school]?.tiers?.[selection.tier - 1]) {
      return 'SELECT A VALID PROTOCOL';
    }
    const target = getCombatant(combatState, selection.targetId);
    if (!target || target.hp <= 0) return 'SELECT A LIVING TARGET';
  }
  if (selection.type === 'item') {
    const item = runState.inventory?.find(i => i.id === selection.consumableId || i.baseType === selection.consumableId);
    if (!item || !data.consumables?.consumables?.[item.baseType]) return 'SELECT A VALID ITEM';
    const target = getCombatant(combatState, selection.targetId);
    if (!target || target.hp <= 0 || target.side !== 'party') return 'SELECT A PARTY TARGET';
  }
  if (!['attack', 'cast', 'overclock', 'item', 'retreat'].includes(selection.type)) {
    return 'SELECT A VALID ACTION';
  }
  return null;
}

function getCombatant(combatState, id) {
  if (id == null) return null;
  if (combatState.combatants instanceof Map) return combatState.combatants.get(id) || null;
  return (combatState.combatants || []).find(actor => actor.id === id) || null;
}

function actionFailureMessage(reason) {
  const messages = {
    'invalid-target': 'SELECT A LIVING TARGET',
    'invalid-protocol': 'SELECT A VALID PROTOCOL',
    'invalid-item': 'SELECT A VALID ITEM',
    'insufficient-charge': 'INSUFFICIENT CHARGE',
    'no-ap': 'NO AP REMAINING',
    jammed: 'PROTOCOLS JAMMED',
    panicked: 'PANICKED: ATTACK BLOCKED',
    'invalid-turn': 'WAIT FOR THE ACTIVE TURN'
  };
  return messages[reason] || 'ACTION FAILED';
}
