import { setGameDataCompatibility } from './main.js';
import { loadGameData } from './data-loader.js';
import { bus } from './state/bus.js';
import { loadSettings, saveRun, deleteRunState } from './state/library.js';
import { createAudioEngine } from './audio/engine.js';
import { createGlitchSystem, initGlitchSafePool } from './glitch/glitch.js';
import { createGrain } from './glitch/grain.js';
import { initEncoder } from './state/save-encode.js';
import { createRNGCursorForRun } from './core/rng-cursor.js';
import { generateFloor } from './floor/generator.js';


let currentScreenController = null;
let currentScreenContainer = null;
let audioEngine = null;
let glitchSystem = null;
let grainController = null;
let currentRunState = null;
let currentFloor = null;
let currentFloorKey = null;
let visualSettings = { glitchEnabled: true, reducedMotion: 'system' };
let mountSequence = 0;
let gestureAudioContext = null;
let busUnsubscribers = [];

let gameData = null;

export async function mountScreen(name, params = {}) {
  const sequence = ++mountSequence;
  if (currentScreenController?.unmount) {
    currentScreenController.unmount();
  }
  if (sequence !== mountSequence) return;
  currentScreenController = null;
  if (currentScreenContainer) {
    currentScreenContainer.remove();
  }
  const container = document.createElement('div');
  container.className = 'screen-container';
  currentScreenContainer = container;
  document.getElementById('app-root').appendChild(container);

  try {
    const mod = await import(`./ui/screens/${name}.js`);
    if (sequence !== mountSequence || currentScreenContainer !== container) return;

    const controller = mod.mount(container, { ...params, data: gameData });
    if (sequence !== mountSequence || currentScreenContainer !== container) {
      controller?.unmount?.();
      return;
    }

    currentScreenController = controller;
    if (glitchSystem) {
      container.querySelectorAll('[data-glitch]').forEach(el => {
        const rawIntensity = Number(el.dataset.glitchIntensity || 0.10);
        const intensity = Number.isFinite(rawIntensity)
          ? Math.max(0, Math.min(1, rawIntensity))
          : 0.10;
        glitchSystem.registerElement(el, intensity);
      });
    }
  } catch (error) {
    if (sequence === mountSequence) {
      console.error(`Failed to mount screen '${name}':`, error);
    }
  }
}

function restoreFloorForRun(runState) {
  if (!runState || typeof runState !== 'object') {
    console.error('Cannot restore floor without a run state');
    return null;
  }

  const worldSeed = Number.isFinite(runState.worldSeed) ? runState.worldSeed >>> 0 : 0;
  const depth = Number.isFinite(runState.depth) && runState.depth > 0 ? Math.floor(runState.depth) : 1;
  runState.worldSeed = worldSeed;
  runState.depth = depth;

  try {
    const rngCursor = createRNGCursorForRun(worldSeed, runState.rngState);
    const floor = generateFloor(worldSeed, depth, rngCursor, gameData.themes);
    runState.rngState = rngCursor.getState();
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

function isValidFloor(floor) {
  const grid = floor?.cells || floor?.grid;
  return Array.isArray(grid) && grid.length > 0 && Array.isArray(grid[0]);
}

function getFloorKey(runState) {
  return `${runState?.worldSeed}:${runState?.depth}`;
}

function setCurrentFloor(runState, floor) {
  currentFloor = floor;
  currentFloorKey = floor ? getFloorKey(runState) : null;
}

function hasCurrentFloorForRun(runState) {
  return isValidFloor(currentFloor) && currentFloorKey === getFloorKey(runState);
}

function applyVisualSettings() {
  const followsSystem = visualSettings.reducedMotion === 'system';
  let systemReducedMotion = false;
  try { systemReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false; } catch {}
  glitchSystem?.setEnabled(visualSettings.glitchEnabled && visualSettings.reducedMotion !== 'reduce' && !(followsSystem && systemReducedMotion));
}

function setupGrain() {
  const grainCanvas = document.createElement('canvas');
  grainCanvas.id = 'grain-canvas';
  grainCanvas.style.position = 'absolute';
  grainCanvas.style.inset = '0';
  grainCanvas.style.pointerEvents = 'none';
  grainCanvas.style.zIndex = '56';
  grainCanvas.width = 1080;
  grainCanvas.height = 1920;
  document.getElementById('portrait-frame').appendChild(grainCanvas);
  grainController = createGrain(grainCanvas);
  grainController.start();
}

function setupBus() {
  const listen = (event, handler) => busUnsubscribers.push(bus.on(event, handler));

  listen('ui:navigate', ({ screen, params = {} } = {}) => {
    if (screen === 'exploration' && params.runState) {
      const runState = params.runState;
      const floor = isValidFloor(params.floor) ? params.floor : restoreFloorForRun(runState);
      if (!floor) return;
      currentRunState = runState;
      setCurrentFloor(runState, floor);
      void mountScreen('exploration', { ...params, runState, floor });
      return;
    }
    void mountScreen(screen, params);
  });

  listen('ui:audio-start', () => {
    if (!audioEngine) {
      audioEngine = createAudioEngine(gestureAudioContext);
      gestureAudioContext = null;
      audioEngine.start();
      const settings = loadSettings();
      audioEngine.setMute(settings.masterMute);
      for (const [layer, vol] of Object.entries(settings.layerVolumes)) {
        audioEngine.setLayerVolume(layer, vol);
      }
    }
  });

  listen('audio:update-state', (payload) => {
    audioEngine?.updateState(payload || {});
  });

  listen('state:settings-change', ({ key, value }) => {
    if (key.startsWith('volume:') && audioEngine) {
      audioEngine.setLayerVolume(key.split(':')[1], value);
    } else if (key === 'mute' && audioEngine) {
      audioEngine.setMute(value);
    } else if (key === 'glitch') {
      visualSettings.glitchEnabled = Boolean(value);
      applyVisualSettings();
    } else if (key === 'reducedMotion') {
      visualSettings.reducedMotion = ['system', 'reduce', 'full'].includes(value) ? value : (value ? 'reduce' : 'full');
      applyVisualSettings();
    } else if (key === 'scanlineGrain' && grainController) {
      grainController.setEnabled(value);
    }
  });

  listen('state:floor-change', ({ runState } = {}) => {
    if (!runState) return;
    currentRunState = runState;
    runState.advanceFloor();
    setCurrentFloor(runState, restoreFloorForRun(runState));
    if (!currentFloor) return;
    saveRun(runState);
    void mountScreen('exploration', { runState, floor: currentFloor });
    audioEngine?.updateState({ depth: runState.depth });
  });

  listen('state:combat-start', ({ runState, floor, lattice, encounter, reason, contact, moveResult } = {}) => {
    if (!runState) return;
    currentRunState = runState;
    setCurrentFloor(runState, isValidFloor(floor) ? floor : restoreFloorForRun(runState));
    if (!currentFloor) return;
    void mountScreen('combat', { runState, floor: currentFloor, lattice, encounter, reason, contact, moveResult });
    audioEngine?.updateState({ combat: true });
  });

  listen('state:combat-end', ({ runState, result } = {}) => {
    if (!['victory', 'retreat'].includes(result) || !runState) return;
    currentRunState = runState;
    if (!hasCurrentFloorForRun(runState)) setCurrentFloor(runState, restoreFloorForRun(runState));
    if (!currentFloor) return;
    saveRun(runState);
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
    import('./glitch/transitions.js').then(({ playDeathSequence }) => {
      playDeathSequence(currentScreenContainer, character);
    });
    runState.queueEcho(character, runState.depth);
  });
}

export async function activateRuntime({ audioContext, initialHash = '' } = {}) {
  gestureAudioContext = audioContext || null;
  document.getElementById('app-root')?.replaceChildren();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }

  try {
    gameData = await loadGameData();
  } catch (error) {
    mountDataFailure(error);
    return;
  }
  setGameDataCompatibility(gameData);

  initEncoder(gameData.symbolTable);
  initGlitchSafePool(gameData.sigils);

  const settings = loadSettings();
  visualSettings = {
    glitchEnabled: Boolean(settings.glitchEnabled),
    reducedMotion: settings.reducedMotion
  };

  glitchSystem = createGlitchSystem();
  glitchSystem.start();
  applyVisualSettings();

  setupGrain();
  if (!settings.scanlineGrainEnabled) grainController.setEnabled(false);

  setupBus();

  const hash = initialHash;
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


export function shutdownRuntime() {
  mountSequence += 1;
  for (const unsubscribe of busUnsubscribers) unsubscribe();
  busUnsubscribers = [];
  currentScreenController?.unmount?.();
  currentScreenController = null;
  currentScreenContainer?.remove();
  currentScreenContainer = null;
  glitchSystem?.stop?.();
  glitchSystem = null;
  grainController?.stop?.();
  grainController = null;
  audioEngine?.stop?.();
  audioEngine = null;
  if (gestureAudioContext) {
    gestureAudioContext.close?.().catch?.(() => {});
    gestureAudioContext = null;
  }
  currentRunState = null;
  setCurrentFloor(null, null);
  gameData = null;
  setGameDataCompatibility(null);
}
