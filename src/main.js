import { bus } from './state/bus.js';

export const gameData = {};

let currentScreenController = null;
let currentScreenContainer = null;

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
    })
    .catch((err) => {
      console.error(`Failed to mount screen '${name}':`, err);
    });
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }

  await loadData();

  const urlFragment = window.location.hash;
  if (urlFragment.startsWith('#r=')) {
    mountScreen('import', { fragment: urlFragment.slice(3) });
  } else if (urlFragment.startsWith('#w=')) {
    mountScreen('creation', { preloadedSeed: urlFragment.slice(3) });
  } else {
    mountScreen('title');
  }
}

init();