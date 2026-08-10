import { bus } from './state/bus.js';
import { loadSettings, saveRun, deleteRunState } from './state/library.js';
import { createAudioEngine } from './audio/engine.js';
import { createGlitchSystem, initGlitchSafePool } from './glitch/glitch.js';
import { createGrain } from './glitch/grain.js';
import { initEncoder } from './state/save-encode.js';
import { createPRNG } from './core/prng.js';
import { createRNGCursor } from './core/rng-cursor.js';
import { generateFloor } from './floor/generator.js';

export const gameData = {};

let currentScreenController = null;
let currentScreenContainer = null;
let audioEngine = null;
let glitchSystem = null;
let grainController = null;
let currentRunState = null;
let currentFloor = null;

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
  bus.on('ui:navigate', ({ screen, params }) => mountScreen(screen, params));

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

  bus.on('state:floor-change', ({ runState }) => {
    currentRunState = runState;
    runState.advanceFloor();
    const genPRNG = createPRNG(runState.worldSeed);
    const combatPRNG = createPRNG((runState.worldSeed ^ 0xC0FFEE) >>> 0);
    const rngCursor = createRNGCursor(genPRNG, combatPRNG);
    if (runState.rngState) {
      rngCursor.syncTo('gen', runState.rngState.gen?.cursor || 0, runState.rngState.gen?.prngState);
      rngCursor.syncTo('combat', runState.rngState.combat?.cursor || 0, runState.rngState.combat?.prngState);
    }
    currentFloor = generateFloor(runState.worldSeed, runState.depth, rngCursor, gameData.themes);
    runState.rngState = rngCursor.getState();
    saveRun(runState);
    mountScreen('exploration', { runState, floor: currentFloor });
    audioEngine?.updateState({ depth: runState.depth });
  });

  bus.on('state:combat-start', ({ runState, floor, lattice }) => {
    mountScreen('combat', { runState, floor, lattice });
    audioEngine?.updateState({ combat: true });
  });

  bus.on('state:combat-end', ({ runState, result }) => {
    if (result === 'victory' && currentRunState) {
      saveRun(currentRunState);
      mountScreen('exploration', { runState: currentRunState, floor: currentFloor });
      audioEngine?.updateState({ combat: false });
    }
  });

  bus.on('state:party-wipe', ({ runState }) => {
    const seed = runState.worldSeed;
    if (runState.creationTimestamp) {
      deleteRunState(`${runState.worldSeed}_${runState.creationTimestamp}`);
    }
    mountScreen('scorecard', {
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