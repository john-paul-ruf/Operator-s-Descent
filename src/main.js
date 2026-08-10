import { bus } from './state/bus.js';
import { loadSettings, saveRun, deleteRunState } from './state/library.js';
import { createAudioEngine } from './audio/engine.js';
import { createGlitchSystem, initGlitchSafePool } from './glitch/glitch.js';
import { createGrain } from './glitch/grain.js';
import { initEncoder } from './state/save-encode.js';
import { createRNGCursorForRun } from './core/rng-cursor.js';
import { generateFloor } from './floor/generator.js';

export const gameData = {};

let currentScreenController = null;
let currentScreenContainer = null;
let audioEngine = null;
let glitchSystem = null;
let grainController = null;
let currentRunState = null;
let currentFloor = null;
let currentFloorKey = null;

const DATA_FILES = [
  'data/sigils.json',
  'data/themes.json',
  'data/classes.json',
  'data/protocols.json',
  'data/enemies.json',
  'data/equipment.json',
  'data/affixes.json',
  'data/conditions.json',
  'data/consumables.json',
  'data/symbol-table.json',
];

async function loadData() {
  const results = await Promise.all(
    DATA_FILES.map(async (path) => {
      const res = await fetch(path);
      if (!res.ok) console.warn(`Failed to load ${path}`);
      return [path, await res.json().catch(() => null)];
    })
  );
  for (const [path, data] of results) {
    if (data) gameData[path.replace('data/', '').replace('.json', '')] = data;
  }
}

export function mountScreen(name, params) {
  if (currentScreenController?.unmount) {
    currentScreenController.unmount();
  }
  if (currentScreenContainer) {
    currentScreenContainer.remove();
  }
  currentScreenContainer = document.createElement('div');
  currentScreenContainer.className = 'screen-container';
  document.getElementById('app-root').appendChild(currentScreenContainer);

  import(`./ui/screens/${name}.js`)
    .then((mod) => {
      currentScreenController = mod.mount(currentScreenContainer, params || {});
      if (glitchSystem) {
        currentScreenContainer.querySelectorAll('[data-glitch]').forEach(el => {
          const intensity = parseFloat(el.style.intensity || '0.10');
          glitchSystem.registerElement(el, intensity);
        });
      }
    })
    .catch((err) => {
      console.error(`Failed to mount screen '${name}':`, err);
    });
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
  bus.on('ui:navigate', ({ screen, params = {} } = {}) => {
    if (screen === 'exploration' && params.runState) {
      const runState = params.runState;
      const floor = isValidFloor(params.floor) ? params.floor : restoreFloorForRun(runState);
      if (!floor) return;
      currentRunState = runState;
      setCurrentFloor(runState, floor);
      mountScreen('exploration', { ...params, runState, floor });
      return;
    }
    mountScreen(screen, params);
  });

  bus.on('ui:audio-start', () => {
    if (!audioEngine) {
      audioEngine = createAudioEngine();
      audioEngine.start();
      const settings = loadSettings();
      audioEngine.setMute(settings.masterMute);
      for (const [layer, vol] of Object.entries(settings.layerVolumes)) {
        audioEngine.setLayerVolume(layer, vol);
      }
    }
  });

  bus.on('state:settings-change', ({ key, value }) => {
    if (key.startsWith('volume:') && audioEngine) {
      audioEngine.setLayerVolume(key.split(':')[1], value);
    } else if (key === 'mute' && audioEngine) {
      audioEngine.setMute(value);
    } else if (key === 'glitch' && glitchSystem) {
      glitchSystem.setEnabled(value);
    } else if (key === 'scanlineGrain' && grainController) {
      grainController.setEnabled(value);
    }
  });

  bus.on('state:floor-change', ({ runState } = {}) => {
    if (!runState) return;
    currentRunState = runState;
    runState.advanceFloor();
    setCurrentFloor(runState, restoreFloorForRun(runState));
    if (!currentFloor) return;
    saveRun(runState);
    mountScreen('exploration', { runState, floor: currentFloor });
    audioEngine?.updateState({ depth: runState.depth });
  });

  bus.on('state:combat-start', ({ runState, floor, lattice } = {}) => {
    if (!runState) return;
    currentRunState = runState;
    setCurrentFloor(runState, isValidFloor(floor) ? floor : restoreFloorForRun(runState));
    if (!currentFloor) return;
    mountScreen('combat', { runState, floor: currentFloor, lattice });
    audioEngine?.updateState({ combat: true });
  });

  bus.on('state:combat-end', ({ runState, result } = {}) => {
    if (result !== 'victory' || !runState) return;
    currentRunState = runState;
    if (!hasCurrentFloorForRun(runState)) setCurrentFloor(runState, restoreFloorForRun(runState));
    if (!currentFloor) return;
    saveRun(runState);
    mountScreen('exploration', { runState, floor: currentFloor });
    audioEngine?.updateState({ combat: false });
  });

  bus.on('state:party-wipe', ({ runState } = {}) => {
    if (!runState) return;
    const seed = runState.worldSeed;
    if (runState.creationTimestamp != null) {
      deleteRunState(`${runState.worldSeed}_${runState.creationTimestamp}`);
    }
    currentRunState = null;
    setCurrentFloor(null, null);
    mountScreen('scorecard', {
      runState,
      seed,
      depth: runState.depth,
      party: runState.party,
      causeOfDeath: 'Party Wipe',
      scrapCounter: runState.scrapCounter
    });
  });

  bus.on('state:character-death', ({ character, runState }) => {
    import('./glitch/transitions.js').then(({ playDeathSequence }) => {
      playDeathSequence(currentScreenContainer, character);
    });
    runState.queueEcho(character, runState.depth);
  });
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }

  await loadData();

  initEncoder(gameData['symbol-table']);
  initGlitchSafePool(gameData['sigils']);

  const settings = loadSettings();

  glitchSystem = createGlitchSystem();
  glitchSystem.setEnabled(settings.glitchEnabled && !settings.reducedMotion);
  glitchSystem.start();

  setupGrain();
  if (!settings.scanlineGrainEnabled) grainController.setEnabled(false);

  setupBus();

  const hash = window.location.hash;
  if (hash.startsWith('#r=')) {
    mountScreen('import', { fragment: hash.slice(3) });
  } else if (hash.startsWith('#w=')) {
    mountScreen('creation', { preloadedSeed: hash.slice(3) });
  } else {
    mountScreen('title');
  }
}

init();
