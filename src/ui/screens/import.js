import { decodeRun, decodeSeed } from '../../state/save-decode.js';
import { createButton, createPanel } from '../components.js';
import { bus } from '../../state/bus.js';

const FAILURE_MESSAGES = {
  truncated: 'SAVE LINK IS TRUNCATED — DATA INCOMPLETE',
  version_mismatch: 'SAVE VERSION MISMATCH — THIS LINK IS FROM A NEWER/OLDER VERSION',
  checksum_failed: 'CHECKSUM FAILED — SAVE DATA IS CORRUPTED',
  malformed: 'MALFORMED LINK — UNRECOGNIZED FORMAT'
};

export function mount(container, params) {
  const header = document.createElement('h2');
  header.className = 'display';
  header.textContent = 'IMPORT LINK';
  container.appendChild(header);

  const input = document.createElement('textarea');
  input.className = 'link-input';
  input.placeholder = 'Paste save link here (#r=... or #w=...)';
  input.rows = 3;
  container.appendChild(input);

  const resultArea = document.createElement('div');
  resultArea.className = 'import-result';
  container.appendChild(resultArea);

  if (params.fragment) {
    input.value = params.fragment;
    doImport();
  }

  function extractFragment(text) {
    let fragment = text.trim();
    if (fragment.includes('#r=')) {
      return { type: 'run', fragment: fragment.split('#r=')[1] };
    }
    if (fragment.includes('#w=')) {
      return { type: 'seed', fragment: fragment.split('#w=')[1] };
    }
    return { type: 'run', fragment };
  }

  function doImport() {
    const text = input.value.trim();
    if (!text) return;
    const { type, fragment } = extractFragment(text);

    if (type === 'seed') {
      const result = decodeSeed(fragment);
      if (result.success) {
        bus.dispatch('ui:navigate', { screen: 'creation', params: { preloadedSeed: result.seed } });
      } else {
        showFailure(result.error, null);
      }
    } else {
      const result = decodeRun(fragment);
      if (result.success) {
        showRunSummary(result.runState);
      } else {
        const seedResult = decodeSeed(fragment);
        const seed = seedResult.success ? seedResult.seed : null;
        showFailure(result.error, seed);
      }
    }
  }

  function showFailure(error, seed) {
    resultArea.innerHTML = '';
    const panel = createPanel();
    panel.classList.add('glow-danger');
    const msg = document.createElement('p');
    msg.textContent = FAILURE_MESSAGES[error] || 'UNKNOWN ERROR';
    panel.appendChild(msg);
    resultArea.appendChild(panel);

    if (seed != null) {
      resultArea.appendChild(createButton('FRESH RUN IN THIS WORLD', {
        onClick: () => bus.dispatch('ui:navigate', { screen: 'creation', params: { preloadedSeed: seed } })
      }));
    }
  }

  function showRunSummary(runState) {
    resultArea.innerHTML = '';
    const panel = createPanel({ title: 'RUN SUMMARY' });
    const info = document.createElement('p');
    info.textContent = `SEED ${runState.worldSeed} · DEPTH ${runState.depth} · ${runState.party?.length || 0} MEMBERS`;
    panel.appendChild(info);
    resultArea.appendChild(panel);

    resultArea.appendChild(createButton('RESUME RUN', {
      primary: true,
      onClick: () => bus.dispatch('ui:navigate', { screen: 'exploration', params: { runState } })
    }));
  }

  const actions = document.createElement('div');
  actions.className = 'import-actions';
  actions.appendChild(createButton('IMPORT', { primary: true, onClick: doImport }));
  actions.appendChild(createButton('RETURN TO TITLE', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'title' })
  }));
  container.appendChild(actions);

  return { unmount() {} };
}