import { saveRun } from '../../state/library.js';
import { decodeRun, decodeSeed } from '../../state/save-decode.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel } from '../components.js';

const MAX_IMPORT_TEXT_LENGTH = 2048;
const MAX_FRAGMENT_LENGTH = 1500;

const FAILURE_MESSAGES = {
  truncated: ['TRUNCATED', 'Truncated — the link was cut short.'],
  version_mismatch: ['VERSION MISMATCH', 'Version mismatch — this link was made by a different version.'],
  checksum_failed: ['CHECKSUM FAILED', 'Checksum failed — the link was corrupted in transit.'],
  malformed: ['MALFORMED', 'Malformed — the link is not a valid save.']
};

function normalizeFailure(error) {
  return FAILURE_MESSAGES[error] ? error : 'malformed';
}

function baseUrl() {
  try { return globalThis.window?.location?.href || 'http://127.0.0.1/'; } catch { return 'http://127.0.0.1/'; }
}

function extractImport(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { success: false, error: 'malformed' };
  if (raw.length > MAX_IMPORT_TEXT_LENGTH) return { success: false, error: 'malformed' };

  let fragment = raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) {
    try {
      const url = new URL(raw, baseUrl());
      fragment = url.hash ? url.hash.slice(1) : raw;
    } catch {
      return { success: false, error: 'malformed' };
    }
  } else if (raw.startsWith('r=') || raw.startsWith('w=')) {
    fragment = raw;
  }

  if (fragment.startsWith('#')) fragment = fragment.slice(1);
  let type = 'unknown';
  if (fragment.startsWith('r=')) {
    type = 'run';
    fragment = fragment.slice(2);
  } else if (fragment.startsWith('w=')) {
    type = 'seed';
    fragment = fragment.slice(2);
  }
  if (!fragment || fragment.length > MAX_FRAGMENT_LENGTH) return { success: false, error: 'malformed' };
  return { success: true, type, fragment };
}

function isLivingRun(runState) {
  if (!runState || !Number.isInteger(runState.worldSeed) || !Number.isInteger(runState.depth)) return false;
  if (!Array.isArray(runState.party) || runState.party.length === 0) return false;
  return runState.party.some((character) => (character?.currentHP ?? character?.hp ?? 0) > 0);
}

function withImportedIdentity(runState) {
  const originalCreationTimestamp = runState.creationTimestamp;
  runState.creationTimestamp = Date.now();
  return { runState, originalCreationTimestamp };
}

function navigate(screen, params = {}) {
  bus.dispatch('ui:navigate', { screen, params });
}

export function mount(container, params = {}) {
  const cleanups = [];

  const header = document.createElement('h2');
  header.className = 'display';
  header.textContent = 'IMPORT LINK';

  const input = document.createElement('textarea');
  input.className = 'link-input';
  input.placeholder = 'Paste save link here (#r=... or #w=...)';
  input.rows = 3;
  input.maxLength = MAX_IMPORT_TEXT_LENGTH;
  input.dataset.testid = 'import-input';

  const resultArea = document.createElement('div');
  resultArea.className = 'import-result';
  resultArea.setAttribute('aria-live', 'polite');
  resultArea.dataset.testid = 'import-result';

  function track(element) {
    cleanups.push(() => element.cleanup?.());
    return element;
  }

  function showFailure(error, recoveredSeed = null) {
    const code = normalizeFailure(error);
    const [title, body] = FAILURE_MESSAGES[code];
    resultArea.replaceChildren();

    const panel = createPanel({ title });
    panel.classList.add('glow-danger');
    panel.dataset.testid = `import-failure-${code}`;
    const message = document.createElement('p');
    message.textContent = body;
    panel.appendChild(message);
    resultArea.appendChild(panel);

    const actions = document.createElement('div');
    actions.className = 'import-failure-actions';
    if (Number.isInteger(recoveredSeed)) {
      const fresh = track(createButton('FRESH RUN IN THIS WORLD', {
        primary: true,
        onClick: () => navigate('creation', { preloadedSeed: recoveredSeed })
      }));
      fresh.dataset.testid = 'import-fresh-world';
      actions.appendChild(fresh);
    }
    const titleButton = track(createButton('RETURN TO TITLE', {
      onClick: () => navigate('title')
    }));
    titleButton.dataset.testid = 'import-return-title-result';
    actions.appendChild(titleButton);
    resultArea.appendChild(actions);
  }

  function showRunSummary(runState) {
    resultArea.replaceChildren();
    const panel = createPanel({ title: 'RUN DECODED' });
    panel.dataset.testid = 'import-run-summary';
    const info = document.createElement('p');
    info.textContent = `SEED ${runState.worldSeed} · DEPTH ${runState.depth} · ${runState.party.length} MEMBERS${runState.activeCombat ? ' · ACTIVE COMBAT SNAPSHOT' : ''}`;
    panel.appendChild(info);
    resultArea.appendChild(panel);

    const resume = track(createButton('RESUME RUN', {
      primary: true,
      onClick: () => {
        const imported = withImportedIdentity(runState);
        const saved = saveRun(imported.runState, { imported: true });
        navigate('exploration', {
          runState: imported.runState,
          resume: true,
          imported: true,
          localSave: saved.success ? { key: saved.key, length: saved.length } : { error: saved.error || 'storage_failed' },
          originalCreationTimestamp: imported.originalCreationTimestamp
        });
      }
    }));
    resume.dataset.testid = 'import-resume';
    resultArea.appendChild(resume);
  }

  function handleRunResult(result) {
    if (!result.success) {
      showFailure(result.error, Number.isInteger(result.recoveredSeed) ? result.recoveredSeed : null);
      return;
    }
    if (!isLivingRun(result.runState)) {
      showFailure('malformed', result.recoveredSeed ?? result.runState?.worldSeed ?? null);
      return;
    }
    showRunSummary(result.runState);
  }

  function doImport() {
    const parsed = extractImport(input.value);
    if (!parsed.success) {
      showFailure(parsed.error);
      return;
    }

    if (parsed.type === 'seed') {
      const result = decodeSeed(parsed.fragment);
      if (result.success) navigate('creation', { preloadedSeed: result.seed });
      else showFailure(result.error);
      return;
    }

    if (parsed.type === 'run') {
      handleRunResult(decodeRun(parsed.fragment));
      return;
    }

    const runResult = decodeRun(parsed.fragment);
    if (runResult.success) {
      handleRunResult(runResult);
      return;
    }
    const seedResult = decodeSeed(parsed.fragment);
    if (seedResult.success) navigate('creation', { preloadedSeed: seedResult.seed });
    else showFailure(runResult.error, Number.isInteger(runResult.recoveredSeed) ? runResult.recoveredSeed : null);
  }

  if (params.fragment) {
    input.value = String(params.fragment).slice(0, MAX_IMPORT_TEXT_LENGTH);
    doImport();
  }

  const actions = document.createElement('div');
  actions.className = 'import-actions';
  const importButton = track(createButton('IMPORT', { primary: true, onClick: doImport }));
  importButton.dataset.testid = 'import-submit';
  const titleButton = track(createButton('RETURN TO TITLE', {
    onClick: () => navigate('title')
  }));
  titleButton.dataset.testid = 'import-return-title';
  actions.append(importButton, titleButton);

  container.replaceChildren(header, input, resultArea, actions);

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
