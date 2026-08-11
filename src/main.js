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

let activationPromise = null;
let pendingAudioContext = null;

function closePendingAudioContext() {
  const context = pendingAudioContext;
  pendingAudioContext = null;
  return context?.close?.().catch(() => {});
}

function activateOnce() {
  if (activationPromise) return activationPromise;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  pendingAudioContext = AudioContextCtor ? new AudioContextCtor() : null;
  const audioContext = pendingAudioContext;
  activationPromise = import('./runtime.js').then(async ({ activateRuntime, shutdownRuntime }) => {
    try {
      await activateRuntime({
        audioContext,
        initialHash: window.location.hash
      });
      pendingAudioContext = null;
    } catch (error) {
      shutdownRuntime();
      throw error;
    }
  });
  return activationPromise;
}

function showBootFailure(message) {
  let failure = document.getElementById('boot-failure');
  if (!failure) {
    failure = document.createElement('p');
    failure.id = 'boot-failure';
    failure.className = 'boot-failure';
    document.getElementById('app-root')?.appendChild(failure);
  }
  failure.textContent = message;
}

export function mountColdTitle(root, activate = activateOnce) {
  root.replaceChildren();

  const screen = document.createElement('main');
  screen.className = 'cold-title';
  const title = document.createElement('h1');
  title.className = 'display glow-strong';
  title.textContent = "OPERATOR'S DESCENT";
  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = 'GLITCH FORGEWORKS LLC';
  const startButton = document.createElement('button');
  startButton.className = 'btn-primary';
  startButton.type = 'button';
  startButton.textContent = 'START';

  startButton.addEventListener('click', async () => {
    if (startButton.disabled) return;
    startButton.disabled = true;
    try {
      await activate();
    } catch (error) {
      await closePendingAudioContext();
      activationPromise = null;
      startButton.disabled = false;
      showBootFailure('BOOT FAILED — RETRY START');
      console.error('Runtime activation failed:', error);
    }
  });

  screen.append(title, subtitle, startButton);
  root.appendChild(screen);
  return screen;
}

const root = document.getElementById('app-root');
if (root) mountColdTitle(root);
