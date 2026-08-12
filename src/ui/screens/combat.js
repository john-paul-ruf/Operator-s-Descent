import { createStatusBar } from '../status-strip.js';
import { createPlayfield } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { bus } from '../../state/bus.js';
import { createRNGCursorForRun } from '../../core/rng-cursor.js';
import { createLattice } from '../../exploration/lattice.js';
import { createEnemy } from '../../rules/enemies.js';
import { initiateCombat, executeAction, resolveTurn, checkCombatEnd, getLegalActions, getCharacterDeaths, toCombatSnapshot } from '../../rules/combat.js';
import { createStandardEncounter, completeEncounter } from '../../rules/encounters.js';
import { distanceCells, getEdgeCoverBonus, isFlanked } from '../../rules/combat-geometry.js';
import { evaluateRange } from '../../rules/equipment.js';

const ACTION_PHASES = {
  attack: 'choose-target',
  cast: 'choose-protocol',
  overclock: 'choose-protocol',
  item: 'choose-item',
  move: 'choose-path',
  retreat: 'confirm',
  'end-turn': 'confirm'
};
const DEFAULT_WINDOW = { originX: 0, originY: 0, width: 8, height: 16, cells: Array.from({ length: 16 }, () => Array(8).fill(1)) };
const UNARMED = { damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 0 };

function clear(element) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else while (element.firstChild) element.removeChild(element.firstChild);
}

function codepointFromSigilId(value) {
  const match = typeof value === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(value);
  return match ? Number.parseInt(match[1], 16) : null;
}

function actorSigil(actor, side) {
  return actor?.sigilCodepoint ?? codepointFromSigilId(actor?.sigilId) ?? (side === 'enemy' ? 0xE030 : 0xE000);
}

function actorSide(actor, fallback = 'party') {
  if (actor?.side === 'enemy' || actor?.side === 'echo') return actor.side;
  return fallback;
}

function normalizeCondition(condition) {
  if (typeof condition === 'string') return { id: condition, conditionId: condition, duration: 0 };
  const id = condition?.id ?? condition?.conditionId;
  return { ...condition, id, conditionId: id, duration: condition?.duration ?? 0 };
}

function normalizeCombatActor(actor, fallbackSide = 'party') {
  const side = actorSide(actor, fallbackSide);
  const equipment = actor?.equipment || { weapon: actor?.weapon ?? null, armor: actor?.armor ?? null, offhand: actor?.offhand ?? null };
  const hp = actor?.hp ?? actor?.currentHP ?? 1;
  const charge = actor?.charge ?? actor?.currentCHARGE ?? 0;
  return {
    ...actor,
    side,
    hp,
    hpMax: actor?.hpMax ?? actor?.maxHP ?? actor?.currentHP ?? hp,
    charge,
    chargeMax: actor?.chargeMax ?? actor?.maxCHARGE ?? actor?.currentCHARGE ?? charge,
    protocols: actor?.protocols ?? actor?.protocolDeck ?? [],
    protocolDeck: actor?.protocolDeck ?? actor?.protocols ?? [],
    equipment,
    weapon: actor?.weapon ?? equipment.weapon ?? null,
    armor: actor?.armor ?? equipment.armor ?? null,
    offhand: actor?.offhand ?? equipment.offhand ?? null,
    sigilCodepoint: actorSigil(actor, side),
    conditions: (actor?.conditions || []).map(normalizeCondition)
  };
}

function normalizeEncounter(encounter) {
  if (!encounter || !Array.isArray(encounter.actors)) return null;
  return {
    ...encounter,
    window: encounter.window || DEFAULT_WINDOW,
    actors: encounter.actors.map((actor) => normalizeCombatActor(actor, actor?.side || 'enemy'))
  };
}

function normalizeCombatState(combatState) {
  if (!combatState) return null;
  const entries = combatState.combatants instanceof Map
    ? [...combatState.combatants.entries()].map(([id, actor]) => [id, normalizeCombatActor(actor, actor?.side || 'party')])
    : Array.isArray(combatState.combatants)
      ? combatState.combatants.map((actor) => [actor.id, normalizeCombatActor(actor, actor?.side || 'party')])
      : null;
  if (!entries) return null;
  combatState.combatants = new Map(entries);
  combatState.turnOrder = [...(combatState.turnOrder || entries.map(([id]) => id))];
  combatState.log = [...(combatState.log || [])];
  combatState.window = combatState.window || DEFAULT_WINDOW;
  combatState.ended = Boolean(combatState.ended);
  combatState.result = combatState.result ?? null;
  combatState.turnStarted = Boolean(combatState.turnStarted);
  return combatState;
}

function normalizeEnemySpawns(spawns, depth, rngCursor, enemiesData) {
  return (spawns || []).map((spawn, index) => {
    if (!spawn) return null;
    const position = spawn.position || { x: spawn.x ?? 0, y: spawn.y ?? 0 };
    if (spawn.hp !== undefined && spawn.hpMax !== undefined && spawn.defense !== undefined) {
      return normalizeCombatActor({ ...spawn, id: spawn.id ?? `enemy_${depth}_${index}`, side: 'enemy', position }, 'enemy');
    }
    const enemy = createEnemy(spawn.archetypeId, depth, rngCursor, enemiesData);
    return enemy ? normalizeCombatActor({ ...enemy, id: spawn.id ?? enemy.id, side: 'enemy', position }, 'enemy') : null;
  }).filter(Boolean);
}

function fallbackEncounter(floor, runState, rngCursor, data) {
  const enemies = data.enemies ? normalizeEnemySpawns(floor?.enemySpawns, runState.depth, rngCursor, data.enemies) : [];
  return normalizeEncounter(createStandardEncounter(floor, runState.partyPosition || floor?.entryPoint || { x: 0, y: 0 }, runState.party || [], enemies, rngCursor));
}

function windowLattice(window) {
  const cells = window?.cells || DEFAULT_WINDOW.cells;
  return {
    getGrid: () => cells,
    getWidth: () => window?.width || cells[0]?.length || 8,
    getHeight: () => window?.height || cells.length || 16,
    isWall: (x, y) => cells[y]?.[x] === 0
  };
}

function getActors(combatState) {
  return combatState?.combatants instanceof Map ? [...combatState.combatants.values()] : [];
}

function getActiveActor(combatState) {
  const id = combatState?.turnOrder?.[combatState.currentTurn];
  return combatState?.combatants?.get(id) || null;
}

function themeFor(floor, data) {
  return data?.themes?.themes?.find((entry) => entry.id === floor?.themeId) ?? null;
}

function protocolData(data, protocol) {
  return data?.protocols?.schools?.[protocol?.school]?.tiers?.[protocol?.tier - 1] || null;
}

function consumableItems(runState) {
  return (runState?.inventory || []).filter((item) => item.category === 'consumable' && item.baseType);
}

function conditionForSave(condition) {
  const id = condition?.conditionId ?? condition?.id;
  return { conditionId: id, duration: condition?.duration ?? 0, ...(condition?.stacks == null ? {} : { stacks: condition.stacks }) };
}

function syncRunStateFromCombat(runState, combatState, { removeDead = false } = {}) {
  const actorsById = new Map(getActors(combatState).filter((actor) => actor.side === 'party').map((actor) => [actor.id, actor]));
  const dead = new Set();
  for (const member of runState.party || []) {
    const actor = actorsById.get(member.id);
    if (!actor) continue;
    member.currentHP = Math.max(0, Math.floor(actor.hp ?? member.currentHP ?? 0));
    member.currentCHARGE = Math.max(0, Math.floor(actor.charge ?? member.currentCHARGE ?? 0));
    member.conditions = (actor.conditions || []).map(conditionForSave).filter((condition) => condition.conditionId);
    if (member.currentHP <= 0) dead.add(member.id);
  }
  if (removeDead && dead.size) runState.party = runState.party.filter((member) => !dead.has(member.id));
}

function updateRunCombatSnapshot(runState, combatState) {
  runState.activeCombat = combatState.ended ? null : toCombatSnapshot(combatState);
}

function formatLog(entry) {
  if (!entry) return 'Combat event.';
  if (entry.type === 'attack') return `${entry.actorId} attacks ${entry.targetId}: ${entry.hit ? `${entry.damage} damage` : 'miss'}.`;
  if (entry.type === 'move') return `${entry.actorId} moves ${entry.direction}.`;
  if (entry.type === 'protocol') return `${entry.actorId} casts ${entry.school}-${entry.tier}.`;
  if (entry.type === 'item') return `${entry.actorId} uses ${entry.consumableId}.`;
  if (entry.type === 'retreat') return `${entry.actorId} retreat ${entry.success ? 'succeeds' : 'fails'}.`;
  if (entry.type === 'death') return `${entry.targetId || entry.actorId} dies.`;
  if (entry.type === 'end-turn' || entry.type === 'wait') return `${entry.actorId} ends turn.`;
  return `${entry.type || 'combat'} event.`;
}

function markDefeated(runState, ids) {
  for (const id of ids || []) {
    const numeric = typeof id === 'number' ? id : /^\d+$/.test(String(id)) ? Number(id) : NaN;
    if (Number.isInteger(numeric)) runState.markEnemyDefeated?.(numeric);
  }
}

function actionFailureMessage(reason) {
  const messages = {
    'invalid-target': 'SELECT A VALID TARGET',
    'invalid-protocol': 'SELECT A VALID PROTOCOL',
    'invalid-item': 'SELECT A VALID ITEM',
    'insufficient-charge': 'INSUFFICIENT CHARGE',
    'no-ap': 'NO AP REMAINING',
    'no-move': 'MOVE ALREADY SPENT',
    'illegal-cell': 'ILLEGAL MOVE CELL',
    'invalid-direction': 'SELECT A VALID DIRECTION',
    'no-window': 'NO COMBAT WINDOW',
    jammed: 'PROTOCOLS JAMMED',
    panicked: 'PANICKED: ATTACK BLOCKED',
    'invalid-turn': 'WAIT FOR THE ACTIVE TURN'
  };
  return messages[reason] || 'ACTION FAILED';
}

export function mount(container, params = {}) {
  const runState = params.runState;
  const floor = params.floor;
  const data = params.data || {};
  const rngCursor = createRNGCursorForRun(runState.worldSeed, runState.rngState);
  const lattice = params.lattice || (floor ? createLattice(floor, runState) : null);
  const encounter = normalizeEncounter(params.encounter) || fallbackEncounter(floor, runState, rngCursor, data) || { id: 'combat', kind: 'standard', window: DEFAULT_WINDOW, actors: [] };
  const combatState = normalizeCombatState(params.combatState) || initiateCombat(encounter, rngCursor);
  const combatLattice = windowLattice(combatState.window);
  const rulesContext = {
    runState,
    protocolsData: data.protocols,
    conditionsData: data.conditions,
    consumablesData: data.consumables,
    classData: data.classes,
    classesData: data.classes,
    lattice: combatState.window
  };

  let mounted = true;
  let terminalDispatched = false;
  let logCursor = combatState.log.length;
  const selection = {
    phase: 'choose-action',
    actionType: null,
    actorId: null,
    targetId: null,
    targetIndex: 0,
    direction: null,
    protocol: null,
    itemId: null,
    error: null,
    notice: null,
    resolving: false,
    combatId: combatState.id ?? 'combat'
  };

  clear(container);
  const inputHandler = createInputHandler({ legacyActions: false });
  inputHandler.bindToElement(container);

  let statusBar = createStatusBar(runState, combatState);
  container.appendChild(statusBar);

  const canvas = document.createElement('canvas');
  canvas.className = 'playfield-canvas';
  canvas.width = 384;
  canvas.height = 768;
  canvas.dataset.testid = 'combat-canvas';

  container.appendChild(canvas);
  const playfield = createPlayfield(canvas);
  playfield.setAccent(themeFor(floor, data) || '#7ec8e3');

  const viewState = {
    runState,
    floor,
    combatState,
    selection,
    protocolsData: data.protocols,
    consumablesData: data.consumables,
    inputHandler,
    lattice: combatLattice,
    combatGetActiveActor: () => getActiveActor(combatState),
    combatGetLegalActions: () => legalActions(),
    combatGetTargets: () => targetsForSelection(),
    combatGetDirections: () => legalActions().legalMoveDirections || [],
    combatGetItems: () => consumableItems(runState),
    combatGetPreview: (targetId) => previewForTarget(targetId),
    combatChooseAction: chooseAction,
    combatSelectTarget: selectTarget,
    combatSelectDirection: selectDirection,
    combatSelectProtocol: selectProtocol,
    combatSelectItem: selectItem,
    combatCycleTarget: cycleTarget,
    combatCancel: cancelSelection,
    combatConfirm: confirmSelection,
    combatCanConfirm: canConfirm
  };
  const consoleController = createConsole(viewState);
  container.appendChild(consoleController.render());
  consoleController.setMode('combat');

  resolveToPartyTurn();
  syncSelectionActor();
  renderAll();
  dispatchTerminal();

  function legalActions() {
    const actor = getActiveActor(combatState);
    return actor ? getLegalActions(combatState, actor.id, rulesContext) : { canAct: false, actions: [], legalMoveDirections: [] };
  }

  function isPartyTurn() {
    const actor = getActiveActor(combatState);
    return Boolean(actor && actor.side === 'party' && !combatState.ended && !selection.resolving);
  }

  function targetsForAction(actionType = selection.actionType) {
    const actors = getActors(combatState).filter((actor) => actor.hp > 0);
    if (actionType === 'attack') return actors.filter((actor) => actor.side === 'enemy');
    if (actionType === 'item') return actors.filter((actor) => actor.side === 'party');
    if (actionType === 'cast' || actionType === 'overclock') return actors.filter((actor) => actor.id !== getActiveActor(combatState)?.id);
    return [];
  }

  function targetsForSelection() {
    return targetsForAction(selection.actionType);
  }

  function syncSelectionActor() {
    const actor = getActiveActor(combatState);
    if (selection.actorId === actor?.id) return;
    selection.actorId = actor?.id ?? null;
    selection.phase = 'choose-action';
    selection.actionType = null;
    selection.targetId = null;
    selection.targetIndex = 0;
    selection.direction = null;
    selection.protocol = null;
    selection.itemId = null;
    selection.error = null;
    selection.notice = actor?.side === 'enemy' ? 'ENEMY TURN RESOLVING.' : null;
  }

  function chooseAction(type) {
    if (!isPartyTurn()) return false;
    const actor = getActiveActor(combatState);
    const legal = legalActions().actions || [];
    if (!legal.includes(type) || (type === 'retreat' && actor.ap <= 0)) {
      selection.error = 'ACTION NOT AVAILABLE';
      renderAll();
      return false;
    }
    selection.actionType = type;
    selection.phase = ACTION_PHASES[type] || 'choose-action';
    selection.targetId = null;
    selection.targetIndex = 0;
    selection.direction = null;
    selection.protocol = null;
    selection.itemId = null;
    selection.error = null;
    selection.notice = null;
    const targets = targetsForAction(type);
    if ((type === 'attack' || type === 'cast' || type === 'overclock' || type === 'item') && targets.length) {
      selection.targetId = targets[0].id;
    }
    renderAll();
    return true;
  }

  function selectProtocol(protocol) {
    if (!isPartyTurn()) return false;
    if (!protocolData(data, protocol)) {
      selection.error = 'SELECT A VALID PROTOCOL';
      renderAll();
      return false;
    }
    selection.protocol = { school: protocol.school, tier: protocol.tier };
    selection.phase = 'choose-target';
    const targets = targetsForSelection();
    selection.targetId = targets[0]?.id ?? null;
    selection.targetIndex = 0;
    selection.error = null;
    renderAll();
    return true;
  }

  function selectItem(item) {
    if (!isPartyTurn()) return false;
    selection.itemId = item?.id || item?.baseType || null;
    selection.phase = 'choose-target';
    const targets = targetsForSelection();
    selection.targetId = targets[0]?.id ?? null;
    selection.targetIndex = 0;
    selection.error = null;
    renderAll();
    return true;
  }

  function selectTarget(targetId) {
    if (!isPartyTurn()) return false;
    const targets = targetsForSelection();
    const index = targets.findIndex((target) => String(target.id) === String(targetId));
    if (index < 0) {
      selection.error = 'SELECT A VALID TARGET';
      renderAll();
      return false;
    }
    selection.targetId = targets[index].id;
    selection.targetIndex = index;
    selection.phase = 'confirm';
    selection.error = null;
    renderAll();
    return true;
  }

  function cycleTarget(delta) {
    if (!isPartyTurn() || !['choose-target', 'confirm'].includes(selection.phase)) return null;
    const targets = targetsForSelection();
    if (!targets.length) return false;
    const current = targets.findIndex((target) => String(target.id) === String(selection.targetId));
    const index = (Math.max(0, current) + delta + targets.length) % targets.length;
    selection.targetId = targets[index].id;
    selection.targetIndex = index;
    selection.error = null;
    renderAll();
    return true;
  }

  function selectDirection(direction) {
    if (!isPartyTurn()) return false;
    if (!legalActions().legalMoveDirections?.includes(direction)) {
      selection.error = 'SELECT A VALID DIRECTION';
      renderAll();
      return false;
    }
    selection.direction = direction;
    selection.phase = 'confirm';
    selection.error = null;
    renderAll();
    return true;
  }

  function cancelSelection() {
    if (selection.resolving) return false;
    if (selection.phase === 'confirm') {
      selection.phase = selection.actionType === 'move' ? 'choose-path' : selection.actionType === 'retreat' || selection.actionType === 'end-turn' ? 'choose-action' : 'choose-target';
    } else if (selection.phase === 'choose-target' && (selection.actionType === 'cast' || selection.actionType === 'overclock')) {
      selection.phase = 'choose-protocol';
      selection.targetId = null;
    } else if (selection.phase === 'choose-target' && selection.actionType === 'item') {
      selection.phase = 'choose-item';
      selection.targetId = null;
    } else {
      selection.phase = 'choose-action';
      selection.actionType = null;
      selection.targetId = null;
      selection.direction = null;
      selection.protocol = null;
      selection.itemId = null;
    }
    selection.error = null;
    renderAll();
    return true;
  }

  function canConfirm() {
    if (!isPartyTurn() || selection.phase !== 'confirm') return false;
    return !validationError();
  }

  function validationError() {
    const actor = getActiveActor(combatState);
    if (!actor || actor.side !== 'party') return 'WAIT FOR A PARTY TURN';
    if (!selection.actionType) return 'SELECT AN ACTION';
    if (selection.actionType !== 'move' && selection.actionType !== 'end-turn' && actor.ap <= 0) return 'NO AP REMAINING';
    if (selection.actionType === 'attack') {
      const target = combatState.combatants.get(selection.targetId);
      if (!target || target.hp <= 0 || target.side !== 'enemy') return 'SELECT A LIVING HOSTILE';
    }
    if (selection.actionType === 'move' && !legalActions().legalMoveDirections?.includes(selection.direction)) return 'SELECT A VALID DIRECTION';
    if (selection.actionType === 'cast' || selection.actionType === 'overclock') {
      if (!selection.protocol || !actor.protocols?.some((protocol) => protocol.school === selection.protocol.school && protocol.tier === selection.protocol.tier)) return 'SELECT A VALID PROTOCOL';
      const target = combatState.combatants.get(selection.targetId);
      if (!target || target.hp <= 0) return 'SELECT A LIVING TARGET';
    }
    if (selection.actionType === 'item') {
      if (!consumableItems(runState).some((item) => item.id === selection.itemId || item.baseType === selection.itemId)) return 'SELECT A VALID ITEM';
      const target = combatState.combatants.get(selection.targetId);
      if (!target || target.hp <= 0 || target.side !== 'party') return 'SELECT A PARTY TARGET';
    }
    return null;
  }

  function actionFromSelection(actor) {
    if (selection.actionType === 'end-turn') return { type: 'end-turn', actorId: actor.id };
    if (selection.actionType === 'move') return { type: 'move', actorId: actor.id, direction: selection.direction };
    if (selection.actionType === 'attack') return { type: 'attack', actorId: actor.id, targetId: selection.targetId };
    if (selection.actionType === 'cast' || selection.actionType === 'overclock') return { type: selection.actionType, actorId: actor.id, targetId: selection.targetId, school: selection.protocol.school, tier: selection.protocol.tier };
    if (selection.actionType === 'item') return { type: 'item', actorId: actor.id, targetId: selection.targetId, consumableId: selection.itemId };
    if (selection.actionType === 'retreat') return { type: 'retreat', actorId: actor.id };
    return null;
  }

  function confirmSelection() {
    if (!mounted || selection.resolving || terminalDispatched) return false;
    if (selection.phase !== 'confirm') {
      const readyFromKeyboard = selection.phase === 'choose-target' && ['attack', 'cast', 'overclock', 'item'].includes(selection.actionType) && !validationError();
      if (readyFromKeyboard) selection.phase = 'confirm';
      else {
        selection.error = validationError() || 'CONFIRM A SELECTED OPTION';
        renderAll();
        return false;
      }
    }
    const error = validationError();
    if (error) {
      selection.error = error;
      renderAll();
      return false;
    }
    const actor = getActiveActor(combatState);
    if (selection.actorId !== actor.id || selection.combatId !== (combatState.id ?? 'combat')) {
      selection.error = 'STALE COMBAT SELECTION';
      renderAll();
      return false;
    }
    selection.resolving = true;
    selection.error = null;
    renderAll();
    const action = actionFromSelection(actor);
    const result = executeAction(combatState, action, rngCursor, rulesContext);
    if (!result.success && !(selection.actionType === 'retreat' && result.retreated === false)) {
      selection.resolving = false;
      selection.error = actionFailureMessage(result.reason);
      renderAll();
      return false;
    }
    afterAction(result);
    return true;
  }

  function afterAction(result) {
    runState.rngState = rngCursor.getState();
    dispatchNewLogs();
    handleCharacterDeaths();
    checkCombatEnd(combatState);
    if (!combatState.ended) {
      resolveTurn(combatState, rngCursor, rulesContext);
      runState.rngState = rngCursor.getState();
      dispatchNewLogs();
      handleCharacterDeaths();
      checkCombatEnd(combatState);
    }
    syncRunStateFromCombat(runState, combatState, { removeDead: !combatState.ended || combatState.result !== 'wipe' });
    updateRunCombatSnapshot(runState, combatState);
    selection.resolving = false;
    selection.notice = result?.retreated === false ? 'RETREAT FAILED.' : null;
    syncSelectionActor();
    if (!combatState.ended) {
      selection.phase = 'choose-action';
      selection.actionType = null;
      selection.targetId = null;
      selection.direction = null;
      selection.protocol = null;
      selection.itemId = null;
    }
    renderAll();
    dispatchTerminal();
  }

  function resolveToPartyTurn() {
    resolveTurn(combatState, rngCursor, rulesContext);
    runState.rngState = rngCursor.getState();
    dispatchNewLogs();
    handleCharacterDeaths();
    checkCombatEnd(combatState);
    syncRunStateFromCombat(runState, combatState, { removeDead: !combatState.ended || combatState.result !== 'wipe' });
    updateRunCombatSnapshot(runState, combatState);
  }

  function handleCharacterDeaths() {
    for (const death of getCharacterDeaths(combatState)) {
      bus.dispatch('state:character-death', { character: death.character, runState, combatState });
    }
  }

  function dispatchNewLogs() {
    while (logCursor < combatState.log.length) {
      const entry = combatState.log[logCursor++];
      bus.dispatch('ui:log-entry', { type: entry.type || 'combat', message: formatLog(entry), entry, sequence: entry.sequence, timestamp: Date.now() });
    }
  }

  function dispatchTerminal() {
    if (!mounted || terminalDispatched || !combatState.ended) return;
    terminalDispatched = true;
    syncRunStateFromCombat(runState, combatState, { removeDead: combatState.result !== 'wipe' });
    runState.activeCombat = null;
    const completion = completeEncounter(encounter, combatState);
    if (encounter.kind === 'hunt' && (combatState.result === 'victory' || combatState.result === 'retreat')) runState.dangerClockProgress = 0;
    if (combatState.result === 'victory') markDefeated(runState, completion.defeatedSpawnIds);
    const payload = { runState, floor, lattice, encounter, combatState, result: combatState.result, completion, autosaveReason: 'combat-resolution' };
    if (combatState.result === 'wipe') bus.dispatch('state:party-wipe', payload);
    else bus.dispatch('state:combat-end', payload);
  }

  function previewForTarget(targetId) {
    const actor = getActiveActor(combatState);
    const target = combatState.combatants.get(targetId);
    if (!actor || !target) return null;
    const distance = distanceCells(actor.position, target.position);
    const weapon = actor.weapon || UNARMED;
    const range = selection.actionType === 'attack' ? evaluateRange(weapon, distance ?? 0) : { legal: true, band: selection.actionType || 'effect', accuracyModifier: 0 };
    const coverBonus = selection.actionType === 'attack' ? getEdgeCoverBonus(combatState.window, actor, target) : 0;
    const flanked = selection.actionType === 'attack' ? isFlanked(target, getActors(combatState).filter((other) => other.side === actor.side && other.hp > 0), combatState.window) : false;
    return { distance, range, coverBonus, flanked };
  }

  function overlayOptions() {
    const targets = targetsForSelection();
    const validTargets = new Set(targets.filter((target) => target.position).map((target) => `${target.position.x},${target.position.y}`));
    const selected = combatState.combatants.get(selection.targetId);
    const selectedKey = selected?.position ? `${selected.position.x},${selected.position.y}` : null;
    const preview = selected ? previewForTarget(selected.id) : null;
    const actor = getActiveActor(combatState);
    const pathCells = new Set();
    if (selection.direction && actor?.position) {
      const delta = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] }[selection.direction];
      if (delta) pathCells.add(`${actor.position.x + delta[0]},${actor.position.y + delta[1]}`);
    }
    return {
      selectedTargetId: selection.targetId,
      validTargets,
      rangeCells: selectedKey ? new Set([selectedKey]) : new Set(),
      coverCells: selectedKey && preview?.coverBonus > 0 ? new Set([selectedKey]) : new Set(),
      pathCells,
      consoleExpanded: consoleController.expanded
    };
  }

  function renderAll() {
    if (!mounted) return;
    playfield.renderCombat(combatState, combatLattice, overlayOptions());
    const nextStatusBar = createStatusBar(runState, combatState);
    statusBar.cleanup?.();
    if (typeof statusBar.replaceWith === 'function') statusBar.replaceWith(nextStatusBar);
    else statusBar.parentNode?.replaceChild?.(nextStatusBar, statusBar);
    statusBar = nextStatusBar;
    consoleController.refresh();
  }

  return {
    unmount() {
      if (!mounted) return;
      mounted = false;
      statusBar.cleanup?.();
      consoleController.destroy();
      inputHandler.destroy();
    }
  };
}
