import { setGameDataCompatibility } from './main.js';
import { loadGameData } from './data-loader.js';
import { bus } from './state/bus.js';
import { loadSettings, saveRun, deleteRunState } from './state/library.js';
import { createAudioEngine } from './audio/engine.js';
import { createGlitchSystem, initGlitchSafePool } from './glitch/glitch.js';
import { createGrain } from './glitch/grain.js';
import { playDescentSequence, playDeathSequence } from './glitch/transitions.js';
import { initEncoder } from './state/save-encode.js';
import { createRNGCursorForRun } from './core/rng-cursor.js';
import { generateFloor } from './floor/generator.js';
import { beginFloorTransition, completeFloorTransition } from './rules/progression.js';

export const ROUTES = Object.freeze(['title', 'creation', 'exploration', 'combat', 'library', 'scorecard', 'import', 'tutorial', 'settings']);
export const AUTOSAVE_CHECKPOINTS = Object.freeze(['floor-transition', 'combat-resolution', 'import-resume', 'explicit-exit']);

const ROUTE_SET = new Set(ROUTES);
const AUTOSAVE_SET = new Set(AUTOSAVE_CHECKPOINTS);
const DEFAULT_COMBAT_WINDOW = { originX: 0, originY: 0, width: 8, height: 16 };
const DEFAULT_ENEMY_WEAPON = { damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 0 };
const DEFAULT_ATTRIBUTES = { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 };

let currentScreenController = null;
let currentScreenContainer = null;
let currentRoute = null;
let audioEngine = null;
let glitchSystem = null;
let grainController = null;
let grainCanvas = null;
let currentRunState = null;
let currentFloor = null;
let currentFloorKey = null;
let visualSettings = { glitchEnabled: true, reducedMotion: 'system' };
let runtimeSettings = null;
let runtimeLogEntries = [];
let pendingDeathEchoes = [];
let mountSequence = 0;
let gestureAudioContext = null;
let busUnsubscribers = [];
let runtimeActive = false;
let serviceWorkerStarted = false;
let lastAutosaveResult = null;

let gameData = null;

function isValidRoute(name) {
  return ROUTE_SET.has(name);
}

function isValidFloor(floor) {
  const grid = floor?.cells || floor?.grid;
  return Array.isArray(grid) && grid.length > 0 && Array.isArray(grid[0]);
}

function floorCells(floor) {
  return floor?.cells || floor?.grid || [[1]];
}

function clampInteger(value, minimum, maximum, fallback) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function getFloorKey(runState) {
  return `${runState?.worldSeed}:${runState?.depth}:${runState?.floorSubSeed ?? 0}`;
}

function setCurrentFloor(runState, floor) {
  currentFloor = floor;
  currentFloorKey = floor ? getFloorKey(runState) : null;
}

function hasCurrentFloorForRun(runState) {
  return isValidFloor(currentFloor) && currentFloorKey === getFloorKey(runState);
}

function themeForFloor(floor) {
  return gameData?.themes?.themes?.find((entry) => entry.id === floor?.themeId) ?? null;
}

function autosaveMetadata(runState, floor, extra = {}) {
  const theme = themeForFloor(floor);
  return {
    ...extra,
    themeId: floor?.themeId,
    theme: floor?.themeId,
    accentSwatch: theme?.accentColor,
    depth: runState?.depth
  };
}

function transitionOptions() {
  return { settings: runtimeSettings || visualSettings, glitchEnabled: visualSettings.glitchEnabled };
}

function unregisterGlitchElements(container) {
  if (!glitchSystem || !container?.querySelectorAll) return;
  container.querySelectorAll('[data-glitch]').forEach((element) => glitchSystem.unregisterElement(element));
}

function registerGlitchElements(container) {
  if (!glitchSystem || !container?.querySelectorAll) return;
  container.querySelectorAll('[data-glitch]').forEach((element) => {
    const rawIntensity = Number(element.dataset.glitchIntensity || 0.10);
    const intensity = Number.isFinite(rawIntensity) ? Math.max(0, Math.min(1, rawIntensity)) : 0.10;
    glitchSystem.registerElement(element, intensity);
  });
}

export async function mountScreen(name, params = {}) {
  if (!isValidRoute(name)) {
    console.warn(`Invalid route '${name}'`);
    return false;
  }

  const sequence = ++mountSequence;
  if (currentScreenController?.unmount) {
    currentScreenController.unmount();
  }
  if (sequence !== mountSequence) return false;

  currentScreenController = null;
  if (currentScreenContainer) {
    unregisterGlitchElements(currentScreenContainer);
    currentScreenContainer.remove();
  }

  const root = document.getElementById('app-root');
  if (!root) return false;
  const container = document.createElement('div');
  container.className = 'screen-container';
  currentScreenContainer = container;
  root.appendChild(container);

  try {
    const mod = await import(`./ui/screens/${name}.js`);
    if (sequence !== mountSequence || currentScreenContainer !== container) return false;

    const controller = mod.mount(container, {
      ...params,
      data: gameData,
      settings: runtimeSettings,
      logEntries: params.logEntries ?? runtimeLogEntries
    });
    if (sequence !== mountSequence || currentScreenContainer !== container) {
      controller?.unmount?.();
      return false;
    }

    currentScreenController = controller;
    currentRoute = name;
    registerGlitchElements(container);
    bus.dispatch('runtime:route', { screen: name, params });
    return true;
  } catch (error) {
    if (sequence === mountSequence) {
      console.error(`Failed to mount screen '${name}':`, error);
      bus.dispatch('runtime:error', { error: 'mount_failed', screen: name, message: error?.message || String(error) });
    }
    return false;
  }
}

function restoreFloorForRun(runState) {
  if (!runState || typeof runState !== 'object') {
    console.error('Cannot restore floor without a run state');
    return null;
  }

  const worldSeed = Number.isInteger(runState.worldSeed) ? runState.worldSeed >>> 0 : null;
  const depth = Number.isInteger(runState.depth) && runState.depth > 0 ? runState.depth : null;
  if (worldSeed == null || depth == null || !gameData?.themes) {
    console.error('Cannot restore floor from invalid run state');
    return null;
  }

  try {
    const floor = generateFloor(worldSeed, depth, { floorSubSeed: runState.floorSubSeed ?? 0 }, gameData.themes);
    if (!isValidFloor(floor)) {
      console.error(`Generated floor at depth ${depth} is invalid`);
      return null;
    }
    return floor;
  } catch (error) {
    console.error(`Failed to restore floor at depth ${depth}:`, error);
    return null;
  }
}

function buildCombatWindowFromSnapshot(snapshot, floor) {
  const arena = snapshot?.arena || DEFAULT_COMBAT_WINDOW;
  const originX = Math.max(0, Math.floor(arena.originX ?? 0));
  const originY = Math.max(0, Math.floor(arena.originY ?? 0));
  const width = clampInteger(arena.width, 1, 20, 8);
  const height = clampInteger(arena.height, 1, 32, 16);
  const cells = floorCells(floor);
  return {
    originX,
    originY,
    width,
    height,
    cells: Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => (cells[originY + y]?.[originX + x] ?? 0) === 0 ? 0 : 1))
  };
}

function codepointFromSigilId(value) {
  const match = typeof value === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(value);
  return match ? Number.parseInt(match[1], 16) : null;
}

function snapshotCondition(condition) {
  const id = condition?.id ?? condition?.conditionId;
  return id ? { id, conditionId: id, duration: condition?.duration ?? 0, stacks: condition?.stacks ?? 1 } : null;
}

function actorFromSnapshot(actor, runState) {
  const partyById = new Map((runState?.party || []).map((character) => [character.id, character]));
  const base = actor?.side === 'party' ? partyById.get(actor.id) || {} : {};
  const hp = Math.max(0, Math.min(255, Math.floor(actor?.hp ?? base.currentHP ?? 1)));
  const charge = Math.max(0, Math.min(255, Math.floor(actor?.charge ?? base.currentCHARGE ?? 0)));
  const equipment = base.equipment || { weapon: null, armor: null, offhand: null };
  const enemy = actor?.side === 'enemy' || actor?.side === 'echo';
  return {
    ...base,
    id: actor?.id ?? base.id,
    side: actor?.side === 'echo' ? 'echo' : enemy ? 'enemy' : 'party',
    position: { x: Math.floor(actor?.x ?? 0), y: Math.floor(actor?.y ?? 0) },
    hp,
    hpMax: Math.max(hp, base.maxHP ?? base.currentHP ?? hp),
    charge,
    chargeMax: Math.max(charge, base.maxCHARGE ?? base.currentCHARGE ?? charge),
    currentHP: hp,
    currentCHARGE: charge,
    attributes: base.attributes || DEFAULT_ATTRIBUTES,
    equipment,
    weapon: base.weapon ?? equipment.weapon ?? (enemy ? DEFAULT_ENEMY_WEAPON : null),
    armor: base.armor ?? equipment.armor ?? null,
    offhand: base.offhand ?? equipment.offhand ?? null,
    protocols: base.protocolDeck || base.protocols || [],
    protocolDeck: base.protocolDeck || base.protocols || [],
    conditions: (actor?.conditions || []).map(snapshotCondition).filter(Boolean),
    initiative: actor?.initiative ?? 0,
    ap: Math.max(0, Math.min(7, actor?.ap ?? 0)),
    moveAvailable: (actor?.moves ?? 0) > 0,
    freeActions: actor?.freeActions ?? 0,
    sigilCodepoint: base.sigilCodepoint ?? codepointFromSigilId(base.sigilId) ?? (enemy ? 0xE030 : 0xE000),
    defense: base.defense ?? (enemy ? 10 : 0),
    protocolDefense: base.protocolDefense ?? 10,
    behavior: base.behavior ?? (enemy ? 'aggressive' : undefined),
    defeated: Boolean(actor?.defeated),
    retreated: Boolean(actor?.retreated)
  };
}

function combatStateFromSnapshot(snapshot, runState, floor) {
  if (!snapshot || !Array.isArray(snapshot.actors) || snapshot.actors.length === 0) return null;
  const actors = snapshot.actors.map((actor) => actorFromSnapshot(actor, runState)).filter((actor) => actor.id != null && actor.hp > 0);
  if (!actors.length) return null;
  const ids = new Set(actors.map((actor) => actor.id));
  const initiativeOrder = (Array.isArray(snapshot.initiativeOrder) ? snapshot.initiativeOrder : actors.map((actor) => actor.id)).filter((id) => ids.has(id));
  const turnOrder = initiativeOrder.length ? initiativeOrder : actors.map((actor) => actor.id);
  return {
    id: snapshot.encounter?.id || snapshot.arena?.contactId || 'resumed-combat',
    kind: snapshot.encounter?.type || 'standard',
    window: buildCombatWindowFromSnapshot(snapshot, floor),
    round: Math.max(1, Math.floor(snapshot.round ?? 1)),
    currentTurn: Math.max(0, Math.min(turnOrder.length - 1, Math.floor(snapshot.currentIndex ?? 0))),
    turnOrder,
    combatants: new Map(actors.map((actor) => [actor.id, actor])),
    log: [],
    ended: false,
    result: null,
    turnStarted: true,
    pendingEffects: Array.isArray(snapshot.pendingEffects) ? [...snapshot.pendingEffects] : [],
    eventOrder: snapshot.eventOrder ?? 0,
    forfeitableLoot: []
  };
}

function encounterFromCombatState(combatState) {
  if (!combatState) return null;
  return {
    id: combatState.id,
    kind: combatState.kind,
    window: combatState.window,
    actors: [...combatState.combatants.values()],
    forfeitableLoot: combatState.forfeitableLoot || []
  };
}

function processPendingDeathEchoes(runState) {
  if (!runState || pendingDeathEchoes.length === 0) return;
  const remaining = [];
  for (const pending of pendingDeathEchoes) {
    if (pending.runState !== runState) {
      remaining.push(pending);
      continue;
    }
    const cursor = createRNGCursorForRun(runState.worldSeed, runState.rngState);
    const result = runState.queueEcho(pending.character, runState.depth, cursor);
    if (result.queued) appendRuntimeLogEntry({ type: 'death', message: `${pending.character.id || 'Character'} queued as an Echo.`, entry: result.echo });
  }
  pendingDeathEchoes = remaining;
}

function appendRuntimeLogEntry(entry = {}) {
  const payload = {
    type: entry.type || 'runtime',
    message: typeof entry.message === 'string' ? entry.message : (entry.entry?.message || entry.type || 'Runtime event.'),
    sequence: entry.sequence,
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
    ...(entry.entry ? { entry: entry.entry } : {})
  };
  runtimeLogEntries.push(payload);
  if (runtimeLogEntries.length > 64) runtimeLogEntries.splice(0, runtimeLogEntries.length - 64);
  currentRunState?.recordEvent?.(payload);
  return payload;
}

function commitAutosave(runState, reason, metadata = {}) {
  if (!runState || !AUTOSAVE_SET.has(reason)) return { success: false, error: 'invalid_checkpoint' };
  const result = saveRun(runState, metadata);
  lastAutosaveResult = { reason, result };
  if (result.success) {
    bus.dispatch('state:autosave-complete', { reason, runState, result, key: result.key, length: result.length });
  } else {
    const error = result.error || result.reason || 'storage_failed';
    console.warn(`Autosave failed at ${reason}: ${error}`);
    bus.dispatch('state:autosave-failed', { reason, runState, error, result });
  }
  return result;
}

function applyVisualSettings() {
  glitchSystem?.setMotionSettings?.(visualSettings);
  glitchSystem?.setEnabled?.(visualSettings.glitchEnabled);
}

function setupGrain() {
  if (grainController) return grainController;
  const frame = document.getElementById('portrait-frame');
  if (!frame) return null;
  grainCanvas = document.createElement('canvas');
  grainCanvas.id = 'grain-canvas';
  grainCanvas.style.position = 'absolute';
  grainCanvas.style.inset = '0';
  grainCanvas.style.pointerEvents = 'none';
  grainCanvas.style.zIndex = '56';
  grainCanvas.width = 1080;
  grainCanvas.height = 1920;
  frame.appendChild(grainCanvas);
  grainController = createGrain(grainCanvas);
  grainController.start();
  return grainController;
}

function startAudioEngine(settings = loadSettings()) {
  if (gestureAudioContext?.resume) gestureAudioContext.resume().catch?.(() => {});
  if (audioEngine) {
    if (gestureAudioContext) {
      audioEngine.updateContext?.(gestureAudioContext);
      gestureAudioContext = null;
    }
    audioEngine.applySettings(settings);
    return audioEngine;
  }
  audioEngine = createAudioEngine(gestureAudioContext);
  gestureAudioContext = null;
  audioEngine.start();
  audioEngine.applySettings(settings);
  return audioEngine;
}

function updateRuntimeSettings(key, value) {
  runtimeSettings ||= loadSettings();
  if (key.startsWith('volume:')) {
    const layer = key.split(':')[1];
    runtimeSettings = {
      ...runtimeSettings,
      layerVolumes: { ...(runtimeSettings.layerVolumes || {}), [layer]: value }
    };
    audioEngine?.setLayerVolume(layer, value);
  } else if (key === 'mute') {
    runtimeSettings = { ...runtimeSettings, masterMute: Boolean(value) };
    audioEngine?.setMute(value);
  } else if (key === 'glitch') {
    runtimeSettings = { ...runtimeSettings, glitchEnabled: Boolean(value) };
    visualSettings.glitchEnabled = Boolean(value);
    applyVisualSettings();
  } else if (key === 'reducedMotion') {
    const reducedMotion = ['system', 'reduce', 'full'].includes(value) ? value : (value ? 'reduce' : 'full');
    runtimeSettings = { ...runtimeSettings, reducedMotion };
    visualSettings.reducedMotion = reducedMotion;
    applyVisualSettings();
  } else if (key === 'scanlineGrain') {
    runtimeSettings = { ...runtimeSettings, scanlineGrainEnabled: Boolean(value) };
    grainController?.setEnabled(value);
  }
}

async function routeToExploration(params = {}) {
  const runState = params.runState;
  if (!runState) return false;
  const floor = isValidFloor(params.floor) ? params.floor : restoreFloorForRun(runState);
  if (!floor) return false;

  currentRunState = runState;
  setCurrentFloor(runState, floor);
  const theme = themeForFloor(floor);
  audioEngine?.updateState({ worldSeed: runState.worldSeed, depth: runState.depth, floorId: `${runState.worldSeed}:${runState.depth}:${floor.floorSubSeed ?? 0}`, theme, audioMode: theme?.audioMode, combat: false });

  if (params.resume && runState.activeCombat && !params.forceExploration) {
    const combatState = combatStateFromSnapshot(runState.activeCombat, runState, floor);
    if (combatState) {
      audioEngine?.updateState({ combat: true });
      return mountScreen('combat', { ...params, runState, floor, combatState, encounter: encounterFromCombatState(combatState), resumedCombat: true });
    }
  }

  return mountScreen('exploration', { ...params, runState, floor });
}

async function handleFloorChange({ runState, selections = {}, reason = 'descent-confirmed' } = {}) {
  if (!runState || !gameData) return;
  const start = beginFloorTransition(runState, gameData);
  if (start.error) {
    console.warn(`Floor transition rejected: ${start.error}`);
    bus.dispatch('runtime:error', { error: 'floor_transition_rejected', reason: start.error });
    return;
  }
  if (start.calibrationRequired) {
    bus.dispatch('state:calibration-required', { runState, offers: start.offers, nextDepth: start.nextDepth, reason });
  }

  const completion = completeFloorTransition(runState, start.transitionToken, selections, { data: gameData, themesData: gameData.themes });
  if (completion.error) {
    console.warn(`Floor transition failed: ${completion.error}`);
    bus.dispatch('runtime:error', { error: 'floor_transition_failed', reason: completion.error });
    return;
  }

  currentRunState = completion.runState;
  setCurrentFloor(completion.runState, completion.floor);
  for (const event of completion.events || []) {
    appendRuntimeLogEntry({ type: event.type || 'floor', message: `Depth ${completion.runState.depth}: ${event.type || 'floor'} event.`, entry: event });
  }
  commitAutosave(completion.runState, completion.autosaveReason || 'floor-transition', autosaveMetadata(completion.runState, completion.floor, { transitionReason: reason }));
  audioEngine?.updateState({ depth: completion.runState.depth, theme: themeForFloor(completion.floor), combat: false });

  const sequence = mountSequence;
  try {
    await playDescentSequence(currentScreenContainer, transitionOptions());
  } catch (error) {
    console.warn('Descent transition failed:', error);
  }
  if (!runtimeActive || sequence !== mountSequence) return;
  await mountScreen('exploration', { runState: completion.runState, floor: completion.floor });
}

async function handleNavigation({ screen, params = {} } = {}) {
  if (!isValidRoute(screen)) return false;
  if (screen === 'exploration') return routeToExploration(params);
  if (screen === 'combat' && params.runState) {
    currentRunState = params.runState;
    setCurrentFloor(params.runState, isValidFloor(params.floor) ? params.floor : restoreFloorForRun(params.runState));
    if (!currentFloor) return false;
    audioEngine?.updateState({ combat: true });
    return mountScreen('combat', { ...params, runState: params.runState, floor: currentFloor });
  }
  if (screen === 'title' && params.abandon === true && currentRunState?.creationTimestamp != null) {
    deleteRunState(`${currentRunState.worldSeed}_${currentRunState.creationTimestamp}`);
    currentRunState = null;
    setCurrentFloor(null, null);
  }
  if (!['exploration', 'combat'].includes(screen)) audioEngine?.updateState({ combat: false });
  return mountScreen(screen, params);
}

function setupBus() {
  if (busUnsubscribers.length > 0) return;
  const listen = (event, handler) => busUnsubscribers.push(bus.on(event, handler));

  listen('ui:navigate', (payload) => { void handleNavigation(payload); });

  listen('ui:audio-start', () => {
    startAudioEngine(loadSettings());
  });

  listen('audio:update-state', (payload) => {
    audioEngine?.updateState(payload || {});
  });

  listen('state:settings-change', ({ key, value }) => {
    updateRuntimeSettings(key, value);
  });

  listen('state:floor-change', (payload) => { void handleFloorChange(payload); });

  listen('state:combat-start', ({ runState, floor, lattice, encounter, reason, contact, moveResult, combatState } = {}) => {
    if (!runState) return;
    currentRunState = runState;
    setCurrentFloor(runState, isValidFloor(floor) ? floor : restoreFloorForRun(runState));
    if (!currentFloor) return;
    void mountScreen('combat', { runState, floor: currentFloor, lattice, encounter, reason, contact, moveResult, combatState });
    audioEngine?.updateState({ combat: true });
  });

  listen('state:combat-end', ({ runState, result, completion } = {}) => {
    if (!['victory', 'retreat'].includes(result) || !runState) return;
    currentRunState = runState;
    processPendingDeathEchoes(runState);
    if (!hasCurrentFloorForRun(runState)) setCurrentFloor(runState, restoreFloorForRun(runState));
    if (!currentFloor) return;
    commitAutosave(runState, 'combat-resolution', autosaveMetadata(runState, currentFloor, { combatResult: result, encounterOutcome: completion?.outcome }));
    void mountScreen('exploration', { runState, floor: currentFloor });
    audioEngine?.updateState({ combat: false });
  });

  listen('state:party-wipe', ({ runState, summary, combatState } = {}) => {
    if (!runState) return;
    const seed = runState.worldSeed;
    if (runState.creationTimestamp != null) {
      deleteRunState(`${runState.worldSeed}_${runState.creationTimestamp}`);
    }
    currentRunState = null;
    setCurrentFloor(null, null);
    audioEngine?.updateState({ combat: false });
    void mountScreen('scorecard', {
      runState,
      summary: summary || combatState?.summary || combatState || {},
      seed,
      depth: runState.depth,
      party: runState.party,
      causeOfDeath: 'Party Wipe',
      scrapCounter: runState.scrapCounter
    });
  });

  listen('state:character-death', ({ character, runState }) => {
    const container = currentScreenContainer;
    Promise.resolve(playDeathSequence(container, character, transitionOptions())).catch((error) => console.warn('Death transition failed:', error));
    if (!runState || !character) return;
    pendingDeathEchoes.push({ runState, character });
    const queue = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => Promise.resolve().then(fn);
    queue(() => processPendingDeathEchoes(runState));
  });

  listen('ui:log-entry', (entry) => {
    appendRuntimeLogEntry(entry);
  });
}

function registerServiceWorkerOnce() {
  if (serviceWorkerStarted || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  serviceWorkerStarted = true;
  return navigator.serviceWorker.register('./service-worker.js').catch((err) => {
    console.warn('Service worker registration failed:', err);
    return null;
  });
}

export async function activateRuntime({ audioContext, initialHash = '' } = {}) {
  if (runtimeActive) shutdownRuntime();
  runtimeActive = true;
  gestureAudioContext = audioContext || null;
  document.getElementById('app-root')?.replaceChildren();
  registerServiceWorkerOnce();

  try {
    gameData = await loadGameData();
  } catch (error) {
    runtimeActive = false;
    mountDataFailure(error);
    return;
  }
  setGameDataCompatibility(gameData);

  initEncoder(gameData.symbolTable);
  initGlitchSafePool(gameData.sigils);

  runtimeSettings = loadSettings();
  startAudioEngine(runtimeSettings);
  visualSettings = {
    glitchEnabled: Boolean(runtimeSettings.glitchEnabled),
    reducedMotion: runtimeSettings.reducedMotion
  };

  glitchSystem = createGlitchSystem({ settings: visualSettings });
  glitchSystem.start();
  applyVisualSettings();

  setupGrain();
  if (!runtimeSettings.scanlineGrainEnabled) grainController?.setEnabled(false);

  setupBus();

  const hash = typeof initialHash === 'string' ? initialHash : '';
  if (hash.startsWith('#r=')) {
    await mountScreen('import', { fragment: hash.slice(3) });
  } else if (hash.startsWith('#w=')) {
    await mountScreen('creation', { preloadedSeed: hash.slice(3) });
  } else {
    await mountScreen('title');
  }
}

function mountDataFailure(error) {
  const root = document.getElementById('app-root');
  if (!root) return;
  const screen = document.createElement('main');
  const message = document.createElement('p');
  message.textContent = `DATA LOAD FAILED — ${error?.file || 'data'} / ${error?.code || 'unknown'}`;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'RETRY';
  retry.addEventListener('click', () => window.location.reload());
  const returnButton = document.createElement('button');
  returnButton.type = 'button';
  returnButton.textContent = 'RETURN';
  returnButton.addEventListener('click', () => window.location.reload());
  screen.append(message, retry, returnButton);
  root.replaceChildren(screen);
}

export function getRuntimeSnapshot() {
  return {
    active: runtimeActive,
    route: currentRoute,
    hasScreen: Boolean(currentScreenController),
    hasContainer: Boolean(currentScreenContainer),
    hasAudio: Boolean(audioEngine),
    audioStarted: Boolean(audioEngine?.isStarted?.()),
    hasGlitch: Boolean(glitchSystem),
    hasGrain: Boolean(grainController),
    grainCanvasAttached: Boolean(grainCanvas?.parentNode),
    busListenerCount: busUnsubscribers.length,
    serviceWorkerStarted,
    floorKey: currentFloorKey,
    currentRun: currentRunState ? {
      worldSeed: currentRunState.worldSeed,
      depth: currentRunState.depth,
      floorSubSeed: currentRunState.floorSubSeed,
      rngState: currentRunState.rngState,
      activeCombat: currentRunState.activeCombat
    } : null,
    logEntries: runtimeLogEntries.length,
    lastAutosaveResult
  };
}

export function shutdownRuntime() {
  const route = currentRoute;
  runtimeActive = false;
  mountSequence += 1;
  for (const unsubscribe of busUnsubscribers) unsubscribe();
  busUnsubscribers = [];
  currentScreenController?.unmount?.();
  currentScreenController = null;
  if (currentScreenContainer) {
    unregisterGlitchElements(currentScreenContainer);
    currentScreenContainer.remove();
  }
  currentScreenContainer = null;
  glitchSystem?.destroy?.();
  glitchSystem = null;
  grainController?.destroy?.();
  grainController = null;
  grainCanvas?.remove?.();
  grainCanvas = null;
  audioEngine?.destroy?.();
  audioEngine = null;
  if (gestureAudioContext) {
    gestureAudioContext.close?.().catch?.(() => {});
    gestureAudioContext = null;
  }
  currentRunState = null;
  setCurrentFloor(null, null);
  currentRoute = null;
  runtimeLogEntries = [];
  pendingDeathEchoes = [];
  runtimeSettings = null;
  lastAutosaveResult = null;
  gameData = null;
  setGameDataCompatibility(null);
  bus.dispatch('runtime:shutdown', { route });
}
