import { deleteRunState, listRuns, loadRun } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel, createScrollArea, createSigilToken } from '../components.js';

const PLAYER_BANK_START = 0xE000;
const PLAYER_BANK_END = 0xE030;
const FAILURE_LABELS = {
  truncated: 'TRUNCATED',
  version_mismatch: 'VERSION MISMATCH',
  checksum_failed: 'CHECKSUM FAILED',
  malformed: 'MALFORMED',
  not_found: 'MISSING RUN STATE'
};

function safeAccent(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#7ec8e3';
}

function lastPlayed(entry) {
  const value = Number(entry?.lastPlayed ?? entry?.creationTimestamp ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatDate(value) {
  return value > 0 ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) : 'UNKNOWN';
}

function isPlayerSigil(codepoint) {
  return Number.isInteger(codepoint) && codepoint >= PLAYER_BANK_START && codepoint < PLAYER_BANK_END;
}

function failureLabel(error) {
  return FAILURE_LABELS[error] || 'LOAD FAILED';
}

function readRows() {
  return listRuns()
    .map((entry) => ({ entry, result: loadRun(entry.key) }))
    .sort((left, right) => lastPlayed(right.entry) - lastPlayed(left.entry));
}

export function mount(container) {
  let selectedKey = null;
  let noticeText = '';
  let renderCleanups = [];

  function cleanupRender() {
    while (renderCleanups.length) renderCleanups.pop()?.();
  }

  function track(element) {
    renderCleanups.push(() => element.cleanup?.());
    return element;
  }

  function navigate(screen, params = {}) {
    bus.dispatch('ui:navigate', { screen, params });
  }

  function resume(row) {
    if (!row.result.success) return;
    navigate('exploration', { runState: row.result.runState, resume: true, key: row.entry.key });
  }

  function removeRun(entry) {
    const result = deleteRunState(entry.key);
    noticeText = result.success
      ? `DELETED LOCAL RUN ${entry.worldSeed}`
      : `DELETE FAILED — ${result.error || 'storage_failed'}`;
    if (selectedKey === entry.key) selectedKey = null;
    render();
  }

  function appendSigils(row, sigils) {
    const strip = document.createElement('div');
    strip.className = 'run-sigils';
    strip.dataset.testid = 'run-sigils';
    for (const codepoint of sigils) {
      if (!isPlayerSigil(codepoint)) continue;
      strip.appendChild(createSigilToken(codepoint, 34, { role: 'player' }));
    }
    if (strip.children.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = 'NO SIGILS';
      strip.appendChild(empty);
    }
    row.appendChild(strip);
  }

  function createRunRow(row) {
    const { entry, result } = row;
    const broken = !result.success;
    const element = document.createElement('article');
    element.className = `run-row${broken ? ' broken' : ''}${selectedKey === entry.key ? ' selected' : ''}`;
    element.tabIndex = 0;
    element.dataset.testid = `run-row-${entry.key}`;
    element.setAttribute('aria-selected', String(selectedKey === entry.key));

    const choose = () => {
      selectedKey = entry.key;
      noticeText = broken ? `QUARANTINED — ${failureLabel(result.error)}` : `SELECTED SEED ${entry.worldSeed}`;
      render();
    };
    element.addEventListener('click', choose);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault?.();
        choose();
      }
    });

    const swatch = document.createElement('span');
    swatch.className = 'accent-swatch';
    swatch.style.backgroundColor = safeAccent(entry.accentSwatch);
    swatch.setAttribute('aria-label', `Accent ${safeAccent(entry.accentSwatch)}`);
    element.appendChild(swatch);

    appendSigils(element, entry.partySigils);

    const info = document.createElement('div');
    info.className = 'run-info';
    const seed = document.createElement('strong');
    seed.textContent = `SEED ${entry.worldSeed}`;
    const depth = document.createElement('span');
    depth.textContent = `DEPTH ${entry.depth}`;
    const classes = document.createElement('span');
    classes.textContent = (entry.partyClasses || []).length
      ? `CLASSES ${(entry.partyClasses || []).join(' / ').toUpperCase()}`
      : 'CLASSES UNKNOWN';
    const played = document.createElement('span');
    played.textContent = `LAST ${formatDate(lastPlayed(entry))}`;
    info.append(seed, depth, classes, played);
    element.appendChild(info);

    if (broken) {
      const error = document.createElement('p');
      error.className = 'load-error';
      error.textContent = `QUARANTINED — ${failureLabel(result.error)}`;
      element.appendChild(error);
    }

    const controls = document.createElement('div');
    controls.className = 'run-controls';
    const resumeButton = track(createButton('RESUME', {
      primary: true,
      disabled: broken,
      description: broken ? `Cannot resume: ${failureLabel(result.error)}` : `Resume seed ${entry.worldSeed}`,
      onClick: (event) => {
        event.stopPropagation?.();
        resume(row);
      }
    }));
    resumeButton.dataset.testid = `run-resume-${entry.key}`;
    const deleteButton = track(createButton('DELETE LOCAL STATE', {
      danger: true,
      onClick: (event) => {
        event.stopPropagation?.();
        removeRun(entry);
      }
    }));
    deleteButton.dataset.testid = `run-delete-${entry.key}`;
    controls.append(resumeButton, deleteButton);
    element.appendChild(controls);
    return element;
  }

  function render() {
    cleanupRender();
    container.replaceChildren();

    const header = document.createElement('h2');
    header.className = 'display';
    header.textContent = 'RUN LIBRARY';

    const notice = document.createElement('p');
    notice.className = 'console-note';
    notice.setAttribute('aria-live', 'polite');
    notice.dataset.testid = 'library-notice';
    notice.textContent = noticeText;

    container.append(header, notice);

    const rows = readRows();
    if (rows.length === 0) {
      const empty = createPanel({ title: 'NO LIVING RUNS' });
      empty.dataset.testid = 'library-empty';
      const message = document.createElement('p');
      message.textContent = 'No saved living runs. Wiped runs remain seed tombstones only and do not appear here.';
      empty.appendChild(message);
      container.appendChild(empty);
    } else {
      const scroll = createScrollArea({ label: 'Saved runs', focusable: true });
      scroll.dataset.testid = 'library-list';
      for (const row of rows) scroll.appendChild(createRunRow(row));
      container.appendChild(scroll);
    }

    const actions = document.createElement('div');
    actions.className = 'library-actions';
    const newRun = track(createButton('NEW RUN', {
      primary: true,
      onClick: () => navigate('creation')
    }));
    newRun.dataset.testid = 'library-new-run';
    const title = track(createButton('TITLE', {
      onClick: () => navigate('title')
    }));
    title.dataset.testid = 'library-title';
    actions.append(newRun, title);
    container.appendChild(actions);
  }

  render();

  return {
    unmount() {
      cleanupRender();
    }
  };
}
