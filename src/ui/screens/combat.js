import { createStatusBar, createTelemetryDock } from '../status-strip.js';
import { createPlayfield, cellAtPoint, COMBAT_CELL_SIZE, COMBAT_GRID_W, COMBAT_GRID_H } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { attachWidePanes, currentLayoutClass } from '../layout.js';
import { loadSettings, saveSettings } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createRNGCursorForRun } from '../../core/rng-cursor.js';
import { createLattice } from '../../exploration/lattice.js';
import { createEnemy } from '../../rules/enemies.js';
import { initiateCombat, executeAction, resolveTurn, checkCombatEnd, getLegalActions, getCharacterDeaths, toCombatSnapshot, reachableMoveCells, isLegalMoveStep, MOVE_RANGE } from '../../rules/combat.js';
import { createStandardEncounter, completeEncounter } from '../../rules/encounters.js';
import { distanceCells, getEdgeCoverBonus, isFlanked } from '../../rules/combat-geometry.js';
import { evaluateRange, resolveLoadout } from '../../rules/equipment.js';
import { createViewportCamera, attachViewportGestures, sizeCanvasToContainer } from '../viewport.js';

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
const DIRECTION_DELTAS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
// Playback pacing (M71 log-replay). Move cells step at MOVE_STEP_MS each; a whole path renders
// path.length × MOVE_STEP_MS. Reaction-heavy entries (attack/protocol/condition/item) hold their
// flash frame for ACTION_STEP_MS. Notice-only entries (wait/end-turn/retreat/death) tick at NOTICE_STEP_MS.
const MOVE_STEP_MS = 140;
const ACTION_STEP_MS = 320;
const NOTICE_STEP_MS = 240;

// Duplicated from status-strip.js (sibling-import boundary). Keep the two in lockstep.
function titleCasePlayback(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}
function humanizeActorName(actor) {
  if (!actor) return 'Actor';
  if (actor.name) return actor.name;
  if (actor.classId) return titleCasePlayback(actor.classId);
  if (actor.archetypeId) return titleCasePlayback(actor.archetypeId);
  const match = String(actor.id ?? '').match(/^enemy_\d+_([a-z][a-z0-9]*)(?:_.+)?$/);
  if (match) return titleCasePlayback(match[1]);
  return String(actor.id ?? 'Actor');
}

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

function normalizeCombatActor(actor, fallbackSide = 'party', data = null) {
  const side = actorSide(actor, fallbackSide);
  const equipment = actor?.equipment || { weapon: actor?.weapon ?? null, armor: actor?.armor ?? null, offhand: actor?.offhand ?? null };
  const hp = actor?.hp ?? actor?.currentHP ?? 1;
  const charge = actor?.charge ?? actor?.currentCHARGE ?? 0;
  // Resolve object-form equipment through the catalog so the engine sees real
  // damageDie/rangeBand/maxRange. A null loadout (equipment-less enemy) falls
  // through so the caller's UNARMED_WEAPON / archetype fallback stays intact.
  const loadout = data && actor?.equipment ? resolveLoadout(actor, data.equipment, data.affixes) : null;
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
    weapon: loadout?.weapon ?? actor?.weapon ?? equipment.weapon ?? null,
    armor: loadout?.armor ?? actor?.armor ?? equipment.armor ?? null,
    offhand: loadout?.offhand ?? actor?.offhand ?? equipment.offhand ?? null,
    sigilCodepoint: actorSigil(actor, side),
    conditions: (actor?.conditions || []).map(normalizeCondition)
  };
}

function normalizeEncounter(encounter, data = null) {
  if (!encounter || !Array.isArray(encounter.actors)) return null;
  return {
    ...encounter,
    window: encounter.window || DEFAULT_WINDOW,
    actors: encounter.actors.map((actor) => normalizeCombatActor(actor, actor?.side || 'enemy', data))
  };
}

function normalizeCombatState(combatState, data = null) {
  if (!combatState) return null;
  const entries = combatState.combatants instanceof Map
    ? [...combatState.combatants.entries()].map(([id, actor]) => [id, normalizeCombatActor(actor, actor?.side || 'party', data)])
    : Array.isArray(combatState.combatants)
      ? combatState.combatants.map((actor) => [actor.id, normalizeCombatActor(actor, actor?.side || 'party', data)])
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
  return normalizeEncounter(createStandardEncounter(floor, runState.partyPosition || floor?.entryPoint || { x: 0, y: 0 }, runState.party || [], enemies, rngCursor), data);
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
  const encounter = normalizeEncounter(params.encounter, data) || fallbackEncounter(floor, runState, rngCursor, data) || { id: 'combat', kind: 'standard', window: DEFAULT_WINDOW, actors: [] };
  const combatState = normalizeCombatState(params.combatState, data) || initiateCombat(encounter, rngCursor);
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
  let userAdjusted = false;
  let currentDpr = 1;
  // Log-replay playback state (M71). While `active`, `selection.resolving` gates input, the
  // playfield draws with position/active/flash overrides, and the console shows the current
  // entry's notice. `entries` is the sliced tail of combatState.log we're stepping through;
  // `index` counts entries already consumed by advancePlayback (dispatched to bus + rendered).
  const playback = {
    timerId: null,
    active: false,
    entries: null,
    index: 0,
    positionOverrides: new Map(),
    activeOverrideId: null,
    flashCells: new Set(),
    onComplete: null
  };
  const selection = {
    phase: 'choose-action',
    actionType: null,
    actorId: null,
    targetId: null,
    targetIndex: 0,
    direction: null,
    movePath: [],
    protocol: null,
    itemId: null,
    error: null,
    notice: null,
    resolving: false,
    combatId: combatState.id ?? 'combat'
  };

  clear(container);
  container.classList.add('combat-screen', 'in-run-screen');
  container.style.position = 'relative';
  container.style.overflow = 'hidden';
  const inputHandler = createInputHandler({ legacyActions: false });
  inputHandler.bindToElement(container);

  const layout = currentLayoutClass();
  const isWide = layout === 'wide';

  let statusBar = null;
  let telemetryDock = null;
  let playfieldBody;
  let widePlayfieldColumn = null;
  let shell = null;

  if (isWide) {
    shell = document.createElement('div');
    shell.className = 'wide-shell';
    shell.dataset.wideRoot = '';
    shell.dataset.testid = 'wide-shell';

    telemetryDock = createTelemetryDock(runState, combatState);
    shell.appendChild(telemetryDock);

    widePlayfieldColumn = document.createElement('section');
    widePlayfieldColumn.className = 'wide-playfield-column';
    playfieldBody = document.createElement('div');
    playfieldBody.className = 'combat-grid playfield-body combat-playfield wide-playfield-inner';
    playfieldBody.style.overflow = 'hidden';
    playfieldBody.style.position = 'relative';
    widePlayfieldColumn.appendChild(playfieldBody);
    shell.appendChild(widePlayfieldColumn);
    container.appendChild(shell);
  } else {
    statusBar = createStatusBar(runState, combatState);
    statusBar.classList.add('panel', 'combat-status', 'in-run-status');
    statusBar.style.flex = '0 0 auto';
    container.appendChild(statusBar);

    playfieldBody = document.createElement('div');
    playfieldBody.className = 'combat-grid playfield-body combat-playfield';
    playfieldBody.style.display = 'block';
    playfieldBody.style.flex = '1 1 auto';
    playfieldBody.style.minHeight = '0';
    playfieldBody.style.marginBottom = '96px';
    playfieldBody.style.overflow = 'hidden';
    playfieldBody.style.position = 'relative';
    container.appendChild(playfieldBody);
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'playfield-canvas combat-grid-canvas';
  canvas.width = 384;
  canvas.height = 768;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.dataset.testid = 'combat-canvas';

  playfieldBody.appendChild(canvas);
  const playfield = createPlayfield(canvas);
  playfield.setAccent(themeFor(floor, data) || '#7ec8e3');
  const reducedMotionSetting = loadSettings().reducedMotion;
  const prefersReduced = typeof globalThis.window?.matchMedia === 'function'
    && globalThis.window.matchMedia('(prefers-reduced-motion: reduce)')?.matches;
  const reduceMotion = reducedMotionSetting === 'reduce'
    || (reducedMotionSetting !== 'full' && prefersReduced);
  playfield.setPulse(!reduceMotion);

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
    combatGetItems: () => consumableItems(runState),
    combatGetPreview: (targetId) => previewForTarget(targetId),
    combatGetMoveRange: () => getMoveRange(),
    combatGetPathSteps: () => nextStepDirections(),
    combatChooseAction: chooseAction,
    combatSelectTarget: selectTarget,
    combatStepPath: stepPath,
    combatPopPath: popPath,
    combatSelectDestination: selectDestination,
    combatSelectProtocol: selectProtocol,
    combatSelectItem: selectItem,
    combatCycleTarget: cycleTarget,
    combatCancel: cancelSelection,
    combatConfirm: confirmSelection,
    combatCanConfirm: canConfirm
  };
  const consoleController = createConsole(viewState, { variant: isWide ? 'dock' : 'bar' });
  let widePanesCleanup = null;
  if (isWide) {
    shell.appendChild(consoleController.render());
    widePanesCleanup = attachWidePanes({ shell, loadSettings, saveSettings });
  } else {
    container.appendChild(consoleController.render());
  }
  consoleController.setMode('combat');

  // Canvas-space camera (M104) owns pan/zoom and hit-tests. The gesture controller emits
  // drag-pans (>= DRAG_THRESHOLD_PX) that set `userAdjusted` so the turn-change auto-center
  // won't fight the user; a release inside the threshold fires `onCanvasTap`.
  const worldW = (combatState.window?.width || COMBAT_GRID_W) * COMBAT_CELL_SIZE;
  const worldH = (combatState.window?.height || COMBAT_GRID_H) * COMBAT_CELL_SIZE;
  const camera = createViewportCamera({ worldW, worldH });
  currentDpr = syncCameraViewport();
  camera.fit();

  const gestureCleanup = attachViewportGestures(playfieldBody, camera, {
    onChange: () => { userAdjusted = true; renderAll(); },
    onTap: onCanvasTap
  });

  let resizeObserverInstance = null;
  if (typeof globalThis.ResizeObserver === 'function') {
    resizeObserverInstance = new globalThis.ResizeObserver(() => {
      currentDpr = syncCameraViewport();
      renderAll();
    });
    resizeObserverInstance.observe(playfieldBody);
  }

  // Initial pre-party enemy resolution (mid-run reload, enemy-first initiative). Playback runs
  // exactly like a mid-combat turn: input is gated, state/autosave land immediately, terminal
  // dispatch waits for playback completion. On the common path (party first in turnOrder),
  // resolveTurn returns without adding log entries and beginPlayback fires onComplete inline.
  selection.resolving = true;
  runResolveWithPlayback(() => {
    selection.resolving = false;
    syncSelectionActor();
    renderAll();
    dispatchTerminal();
  });

  function syncCameraViewport() {
    const rect = playfieldBody.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      const size = sizeCanvasToContainer(canvas, playfieldBody);
      camera.setViewport(size.w, size.h);
      return size.dpr;
    }
    // Fallback (test envs without layout): keep the initial backing store, treat it as CSS px.
    camera.setViewport(canvas.width, canvas.height);
    return 1;
  }

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
    selection.movePath = [];
    selection.protocol = null;
    selection.itemId = null;
    selection.error = null;
    selection.notice = actor?.side === 'enemy' ? 'ENEMY TURN RESOLVING.' : null;
    // Turn change → auto-centering resumes: forget any within-turn user pan and re-center.
    userAdjusted = false;
    if (actor?.position) {
      camera.centerOn((actor.position.x + 0.5) * COMBAT_CELL_SIZE, (actor.position.y + 0.5) * COMBAT_CELL_SIZE);
    }
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
    selection.movePath = [];
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

  function getMoveRange() {
    const actor = getActiveActor(combatState);
    return actor ? reachableMoveCells(combatState, actor.id, MOVE_RANGE) : new Map();
  }

  function pathEndpoint(actor) {
    let cursor = { x: actor.position?.x ?? 0, y: actor.position?.y ?? 0 };
    for (const dir of selection.movePath || []) {
      const delta = DIRECTION_DELTAS[dir];
      if (!delta) break;
      cursor = { x: cursor.x + delta[0], y: cursor.y + delta[1] };
    }
    return cursor;
  }

  function nextStepDirections() {
    const actor = getActiveActor(combatState);
    if (!actor || selection.actionType !== 'move') return [];
    const path = selection.movePath || [];
    if (path.length >= MOVE_RANGE) return [];
    const cursor = pathEndpoint(actor);
    return Object.keys(DIRECTION_DELTAS).filter((direction) => isLegalMoveStep(combatState, actor.id, cursor, direction));
  }

  // Append one direction to the current movePath. Any legal single step from the current
  // cursor is accepted (users may zig-zag), capped at MOVE_RANGE total. Tap-to-destination
  // uses BFS-shortest routes; button/keyboard stepping is free-form.
  function stepPath(direction) {
    if (!isPartyTurn() || selection.actionType !== 'move') return false;
    const path = selection.movePath || [];
    if (path.length >= MOVE_RANGE) {
      selection.error = 'PATH FULL';
      renderAll();
      return false;
    }
    const actor = getActiveActor(combatState);
    const cursor = pathEndpoint(actor);
    if (!isLegalMoveStep(combatState, actor.id, cursor, direction)) {
      selection.error = 'SELECT A VALID DIRECTION';
      renderAll();
      return false;
    }
    selection.movePath = [...path, direction];
    selection.direction = selection.movePath[0];
    selection.phase = 'confirm';
    selection.error = null;
    renderAll();
    return true;
  }

  function popPath() {
    if (!isPartyTurn() || selection.actionType !== 'move') return false;
    const path = selection.movePath || [];
    if (path.length === 0) return false;
    const nextPath = path.slice(0, -1);
    selection.movePath = nextPath;
    selection.direction = nextPath[0] || null;
    if (nextPath.length === 0) selection.phase = 'choose-path';
    selection.error = null;
    renderAll();
    return true;
  }

  // Tap-to-destination: replace movePath with the BFS shortest route to the tapped cell.
  function selectDestination(cell) {
    if (!isPartyTurn() || selection.actionType !== 'move') return false;
    const info = getMoveRange().get(`${cell.x},${cell.y}`);
    if (!info) {
      selection.error = 'SELECT A VALID DIRECTION';
      renderAll();
      return false;
    }
    selection.movePath = [...info.path];
    selection.direction = selection.movePath[0];
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
      selection.movePath = [];
      selection.protocol = null;
      selection.itemId = null;
    }
    selection.error = null;
    renderAll();
    return true;
  }

  function canConfirm() {
    if (!isPartyTurn()) return false;
    // Move confirms as soon as the movePath is non-empty; other actions require the confirm phase.
    if (selection.actionType === 'move' && (selection.movePath?.length ?? 0) > 0) return !validationError();
    if (selection.phase !== 'confirm') return false;
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
    if (selection.actionType === 'move') {
      const path = selection.movePath || [];
      if (path.length < 1 || path.length > MOVE_RANGE) return 'SELECT A VALID DIRECTION';
      const reachable = getMoveRange();
      const dest = pathEndpoint(actor);
      if (!reachable.has(`${dest.x},${dest.y}`)) return 'SELECT A VALID DIRECTION';
    }
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
    if (selection.actionType === 'move') return { type: 'move', actorId: actor.id, path: [...(selection.movePath || [])] };
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
      const readyFromMovePath = selection.actionType === 'move' && (selection.movePath?.length ?? 0) > 0 && !validationError();
      if (readyFromKeyboard || readyFromMovePath) selection.phase = 'confirm';
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
    // Party-turn log entries stream immediately — the player just saw those actions run live.
    dispatchNewLogs();
    handleCharacterDeaths();
    checkCombatEnd(combatState);
    if (combatState.ended) {
      finalizeAfterAction(result);
      return;
    }
    runResolveWithPlayback(() => finalizeAfterAction(result));
  }

  function finalizeAfterAction(result) {
    if (!mounted) return;
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

  // Snapshots positions BEFORE calling resolveTurn so playback can start each moved actor at its
  // pre-resolution cell (the engine has already advanced them to their final cells). State sync
  // (runState.rngState, syncRunStateFromCombat, updateRunCombatSnapshot) lands immediately —
  // exactly as before playback existed — so a crash mid-playback still autosaves the final state.
  // Enemy-side deaths and terminal combat-end fire after playback so the user sees the actions
  // that caused them.
  function runResolveWithPlayback(onDone) {
    const startCursor = logCursor;
    const preResolvePositions = snapshotPositions();
    resolveTurn(combatState, rngCursor, rulesContext);
    runState.rngState = rngCursor.getState();
    checkCombatEnd(combatState);
    syncRunStateFromCombat(runState, combatState, { removeDead: !combatState.ended || combatState.result !== 'wipe' });
    updateRunCombatSnapshot(runState, combatState);
    const entries = combatState.log.slice(startCursor);
    beginPlayback(entries, preResolvePositions, () => {
      handleCharacterDeaths();
      onDone?.();
    });
  }

  function handleCharacterDeaths() {
    for (const death of getCharacterDeaths(combatState)) {
      bus.dispatch('state:character-death', { character: death.character, runState, combatState });
    }
  }

  function dispatchLogEntry(entry) {
    if (!entry) return;
    bus.dispatch('ui:log-entry', {
      type: entry.type || 'combat',
      message: formatLog(entry),
      entry,
      sequence: entry.sequence,
      timestamp: Date.now()
    });
  }

  function dispatchNewLogs() {
    while (logCursor < combatState.log.length) {
      dispatchLogEntry(combatState.log[logCursor++]);
    }
  }

  function snapshotPositions() {
    const map = new Map();
    for (const actor of getActors(combatState)) {
      if (actor.position) map.set(actor.id, { x: actor.position.x, y: actor.position.y });
    }
    return map;
  }

  // Play only enemy-side actor entries, plus death/condition-damage on any side. Party-actor
  // entries (opportunity attacks the player triggered during an enemy move) already ran live for
  // the user and are dispatched inline without a paced step.
  function shouldPlayEntry(entry) {
    if (!entry) return false;
    if (entry.type === 'death' || entry.type === 'condition-damage') return true;
    const actor = entry.actorId != null ? combatState.combatants.get(entry.actorId) : null;
    return Boolean(actor && actor.side !== 'party');
  }

  function noticeFor(entry) {
    if (!entry) return null;
    const actor = entry.actorId != null ? combatState.combatants.get(entry.actorId) : null;
    const target = entry.targetId != null ? combatState.combatants.get(entry.targetId) : null;
    const name = (a) => (humanizeActorName(a) || 'Actor').toUpperCase();
    switch (entry.type) {
      case 'attack':
        return entry.hit
          ? `${name(actor)} ATTACKS ${name(target)} — ${entry.damage} DMG.`
          : `${name(actor)} ATTACKS ${name(target)} — MISS.`;
      case 'protocol':
        return target
          ? `${name(actor)} CASTS ${String(entry.school || '').toUpperCase()}-${entry.tier} ON ${name(target)}.`
          : `${name(actor)} CASTS ${String(entry.school || '').toUpperCase()}-${entry.tier}.`;
      case 'condition':
        return entry.applied
          ? `${name(actor)} APPLIES ${String(entry.conditionId || 'condition').toUpperCase()} TO ${name(target)}.`
          : `${name(target)} RESISTS ${String(entry.conditionId || 'condition').toUpperCase()}.`;
      case 'item':
        return `${name(actor)} USES ${String(entry.consumableId || 'item').toUpperCase()}.`;
      case 'move':
        return `${name(actor)} MOVES.`;
      case 'wait':
        return `${name(actor)} WAITS.`;
      case 'end-turn':
        return `${name(actor)} ENDS TURN.`;
      case 'retreat':
        return `${name(actor)} ${entry.success ? 'RETREATS' : 'RETREAT FAILS'}.`;
      case 'death':
        return `${name(target || actor)} FALLS.`;
      case 'condition-damage':
        return `${name(actor)} — ${String(entry.source || 'condition').toUpperCase()} ${entry.amount}.`;
      default:
        return `${String(entry.type || 'event').toUpperCase()}.`;
    }
  }

  function flashKeyFor(entry) {
    const targetId = entry?.targetId ?? entry?.actorId;
    if (targetId == null) return null;
    const target = combatState.combatants.get(targetId);
    if (!target?.position) return null;
    const override = playback.positionOverrides.get(target.id);
    const pos = override || target.position;
    return `${pos.x},${pos.y}`;
  }

  function centerOnCellIfIdle(cell) {
    if (!cell || userAdjusted) return;
    camera.centerOn((cell.x + 0.5) * COMBAT_CELL_SIZE, (cell.y + 0.5) * COMBAT_CELL_SIZE);
  }

  function scheduleTimeout(fn, ms) {
    const timerFn = globalThis.setTimeout;
    return typeof timerFn === 'function' ? timerFn(fn, ms) : null;
  }

  function clearPlaybackTimer() {
    if (playback.timerId == null) return;
    const clearFn = globalThis.clearTimeout;
    if (typeof clearFn === 'function') clearFn(playback.timerId);
    playback.timerId = null;
  }

  // Playfield-only redraw during playback: avoids the full renderAll pass (which rebuilds the
  // portrait status strip on every call). Console refresh is triggered separately per entry so
  // the notice slot updates without re-creating the status bar element every 140ms.
  function renderPlayfieldOnly() {
    if (!mounted) return;
    playfield.renderCombat(combatState, combatLattice, {
      ...overlayOptions(),
      viewTransform: camera.viewTransform(currentDpr),
      positionOverrides: playback.positionOverrides.size ? playback.positionOverrides : undefined,
      activeOverrideId: playback.activeOverrideId ?? undefined,
      flashCells: playback.flashCells.size ? playback.flashCells : undefined
    });
  }

  function beginPlayback(entries, preResolvePositions, onDone) {
    if (!mounted) { onDone?.(); return; }
    const hasVisual = entries.some(shouldPlayEntry);
    // Reduced-motion or no enemy-visible entries → instant path. Dispatches every entry to the
    // bus immediately (log-feed sync stays intact) and fires onComplete inline.
    if (reduceMotion || !hasVisual) {
      for (const entry of entries) dispatchLogEntry(entry);
      logCursor = combatState.log.length;
      onDone?.();
      return;
    }
    playback.positionOverrides = new Map();
    for (const [id, pos] of preResolvePositions) {
      const actor = combatState.combatants.get(id);
      if (!actor?.position) continue;
      if (actor.position.x !== pos.x || actor.position.y !== pos.y) {
        playback.positionOverrides.set(id, { x: pos.x, y: pos.y });
      }
    }
    playback.flashCells = new Set();
    playback.activeOverrideId = null;
    playback.onComplete = onDone;
    playback.entries = entries;
    playback.index = 0;
    playback.active = true;
    renderPlayfieldOnly();
    advancePlayback();
  }

  function advancePlayback() {
    if (!mounted || !playback.active) return;
    playback.flashCells = new Set();
    if (playback.index >= playback.entries.length) {
      finishPlayback();
      return;
    }
    const entry = playback.entries[playback.index++];
    dispatchLogEntry(entry);
    if (logCursor < combatState.log.length) logCursor++;

    if (!shouldPlayEntry(entry)) {
      // Party-side entries (OA attacks provoked by enemy moves) dispatch to the log feed but
      // don't consume a visible step — they already ran live for the user.
      advancePlayback();
      return;
    }

    const actor = entry.actorId != null ? combatState.combatants.get(entry.actorId) : null;
    if (actor && actor.side !== 'party') playback.activeOverrideId = entry.actorId;
    selection.notice = noticeFor(entry);

    if (entry.type === 'move' && Array.isArray(entry.path) && entry.path.length > 0 && entry.from) {
      playMoveEntry(entry);
      return;
    }
    if (['attack', 'protocol', 'condition', 'item'].includes(entry.type)) {
      const key = flashKeyFor(entry);
      if (key) playback.flashCells.add(key);
      const cell = playback.positionOverrides.get(actor?.id) || actor?.position;
      centerOnCellIfIdle(cell);
      renderPlayfieldOnly();
      consoleController.refresh();
      playback.timerId = scheduleTimeout(() => {
        playback.flashCells = new Set();
        advancePlayback();
      }, ACTION_STEP_MS);
      return;
    }
    // Notice-only entries: wait / end-turn / retreat / death / condition-damage.
    const cell = playback.positionOverrides.get(actor?.id) || actor?.position;
    centerOnCellIfIdle(cell);
    renderPlayfieldOnly();
    consoleController.refresh();
    playback.timerId = scheduleTimeout(advancePlayback, NOTICE_STEP_MS);
  }

  function playMoveEntry(entry) {
    const path = entry.path;
    let cursor = { x: entry.from.x, y: entry.from.y };
    let step = 0;
    playback.positionOverrides.set(entry.actorId, { x: cursor.x, y: cursor.y });
    centerOnCellIfIdle(cursor);
    renderPlayfieldOnly();
    consoleController.refresh();
    const walk = () => {
      if (!mounted || !playback.active) return;
      if (step >= path.length) {
        // Align override with the engine's final position so subsequent entries see the same cell.
        if (entry.to) playback.positionOverrides.set(entry.actorId, { x: entry.to.x, y: entry.to.y });
        advancePlayback();
        return;
      }
      const delta = DIRECTION_DELTAS[path[step++]];
      if (!delta) { advancePlayback(); return; }
      cursor = { x: cursor.x + delta[0], y: cursor.y + delta[1] };
      playback.positionOverrides.set(entry.actorId, { x: cursor.x, y: cursor.y });
      centerOnCellIfIdle(cursor);
      renderPlayfieldOnly();
      playback.timerId = scheduleTimeout(walk, MOVE_STEP_MS);
    };
    playback.timerId = scheduleTimeout(walk, MOVE_STEP_MS);
  }

  function finishPlayback() {
    clearPlaybackTimer();
    playback.active = false;
    playback.entries = null;
    playback.index = 0;
    playback.positionOverrides = new Map();
    playback.activeOverrideId = null;
    playback.flashCells = new Set();
    logCursor = combatState.log.length;
    const done = playback.onComplete;
    playback.onComplete = null;
    done?.();
  }

  // Tap during playback fast-forwards: cancels the current timer, dispatches every not-yet-seen
  // entry to the bus (log feed catches up), and fires the onComplete callback — same effect as
  // waiting for every remaining timer to fire, minus the pacing.
  function fastForwardPlayback() {
    if (!playback.active) return;
    clearPlaybackTimer();
    while (playback.index < playback.entries.length) {
      dispatchLogEntry(playback.entries[playback.index++]);
      if (logCursor < combatState.log.length) logCursor++;
    }
    finishPlayback();
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
    const isMoveMode = selection.actionType === 'move' && (selection.phase === 'choose-path' || selection.phase === 'confirm');
    const pathCells = new Set();
    let rangeCells;
    if (isMoveMode && actor?.position) {
      const reachable = getMoveRange();
      rangeCells = new Set(reachable.keys());
      let cursor = { x: actor.position.x, y: actor.position.y };
      for (const dir of selection.movePath || []) {
        const delta = DIRECTION_DELTAS[dir];
        if (!delta) break;
        cursor = { x: cursor.x + delta[0], y: cursor.y + delta[1] };
        pathCells.add(`${cursor.x},${cursor.y}`);
      }
    } else {
      rangeCells = selectedKey ? new Set([selectedKey]) : new Set();
    }
    return {
      selectedTargetId: selection.targetId,
      validTargets,
      rangeCells,
      coverCells: selectedKey && preview?.coverBonus > 0 ? new Set([selectedKey]) : new Set(),
      pathCells,
      confirmCell: isMoveMode && (selection.movePath?.length ?? 0) > 0 && actor?.position
        ? `${pathEndpoint(actor).x},${pathEndpoint(actor).y}`
        : null
    };
  }

  function pathEndpointKey() {
    const actor = getActiveActor(combatState);
    if (!actor || !(selection.movePath?.length)) return null;
    const end = pathEndpoint(actor);
    return `${end.x},${end.y}`;
  }

  function onCanvasTap({ clientX, clientY }) {
    if (!mounted) return;
    // A tap during enemy playback fast-forwards to completion instead of selecting anything.
    if (playback.active) {
      fastForwardPlayback();
      return;
    }
    const cell = cellAtPoint({ canvas, cellSize: COMBAT_CELL_SIZE, viewTransform: camera.viewTransform(currentDpr) }, clientX, clientY);
    if (!cell) return;
    if (['attack', 'cast', 'overclock', 'item'].includes(selection.actionType) && ['choose-target', 'confirm'].includes(selection.phase)) {
      const hit = targetsForSelection().find((target) => target.position && target.position.x === cell.x && target.position.y === cell.y);
      if (hit) selectTarget(hit.id);
      return;
    }
    if (selection.actionType === 'move' && (selection.phase === 'choose-path' || selection.phase === 'confirm')) {
      const endpointKey = pathEndpointKey();
      const tappedKey = `${cell.x},${cell.y}`;
      if (endpointKey && tappedKey === endpointKey && canConfirm()) {
        confirmSelection();
        return;
      }
      if (getMoveRange().has(tappedKey) && selectDestination(cell)) {
        selection.notice = 'TAP DESTINATION AGAIN TO CONFIRM.';
        renderAll();
      }
      return;
    }
    if (selection.phase === 'choose-action') {
      const legal = legalActions().actions || [];
      if (!legal.includes('move')) return;
      if (!getMoveRange().has(`${cell.x},${cell.y}`)) return;
      if (chooseAction('move') && selectDestination(cell)) {
        selection.notice = 'TAP DESTINATION AGAIN TO CONFIRM.';
        renderAll();
      }
    }
  }

  function renderAll() {
    if (!mounted) return;
    playfield.renderCombat(combatState, combatLattice, {
      ...overlayOptions(),
      viewTransform: camera.viewTransform(currentDpr),
      positionOverrides: playback.positionOverrides.size ? playback.positionOverrides : undefined,
      activeOverrideId: playback.activeOverrideId ?? undefined,
      flashCells: playback.flashCells.size ? playback.flashCells : undefined
    });
    if (!isWide) {
      const nextStatusBar = createStatusBar(runState, combatState);
      nextStatusBar.classList.add('panel', 'combat-status', 'in-run-status');
      nextStatusBar.style.flex = '0 0 auto';
      statusBar.cleanup?.();
      if (typeof statusBar.replaceWith === 'function') statusBar.replaceWith(nextStatusBar);
      else statusBar.parentNode?.replaceChild?.(nextStatusBar, statusBar);
      statusBar = nextStatusBar;
    }
    consoleController.refresh();
  }

  return {
    unmount() {
      if (!mounted) return;
      // Flush any log entries still queued by an in-progress playback BEFORE tearing down —
      // logCursor must end equal to combatState.log.length on every path so LOG mode stays whole.
      // Runs before listeners detach so the telemetry feed still receives them.
      clearPlaybackTimer();
      if (playback.active && playback.entries) {
        while (playback.index < playback.entries.length) {
          dispatchLogEntry(playback.entries[playback.index++]);
        }
      }
      logCursor = combatState.log.length;
      mounted = false;
      playback.active = false;
      playback.entries = null;
      playback.onComplete = null;
      gestureCleanup?.();
      resizeObserverInstance?.disconnect?.();
      widePanesCleanup?.();
      statusBar?.cleanup?.();
      telemetryDock?.cleanup?.();
      playfield.destroy();
      consoleController.destroy();
      inputHandler.destroy();
    }
  };
}
