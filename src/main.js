import { bus } from './state/bus.js';
import { createUpdateToast } from './ui/components.js';

let activeGameData = null;

export const gameData = new Proxy({}, {
  get(_target, property) {
    if (!activeGameData) return undefined;
    return property === 'symbol-table' ? activeGameData.symbolTable : activeGameData[property];
  },
  set() {
    return false;
  }
});

export function setGameDataCompatibility(registry) {
  activeGameData = registry;
}

let crtOverlaysController = null;

export function getCrtOverlaysController() {
  return crtOverlaysController;
}

const parentsWithUpdateToast = new WeakSet();
bus.on('runtime:update-ready', () => {
  const parent = document.getElementById('portrait-frame') || document.body;
  if (!parent || parentsWithUpdateToast.has(parent)) return;
  const toast = createUpdateToast({
    onReload: () => {
      if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
        window.location.reload();
      }
    }
  });
  parent.appendChild(toast);
  parentsWithUpdateToast.add(parent);
});

const overlaysContainer = document.getElementById('crt-overlays');
if (overlaysContainer) {
  import('./glitch/crt-overlays.js').then(({ createCRTOverlays }) => {
    crtOverlaysController = createCRTOverlays({ container: overlaysContainer, enabled: true });
    crtOverlaysController.mount();
  }).catch(error => console.error('CRT overlay load failed:', error));
}

const root = document.getElementById('app-root');
if (root && typeof window !== 'undefined' && window.location && !globalThis.__odSkipBoot) {
  import('./runtime.js').then(({ activateRuntime, shutdownRuntime }) => {
    activateRuntime({ initialHash: window.location.hash }).catch(error => {
      console.error('Runtime activation failed:', error);
      shutdownRuntime();
    });
  }).catch(error => console.error('Runtime import failed:', error));
}