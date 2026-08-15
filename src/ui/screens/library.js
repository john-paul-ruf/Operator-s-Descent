import { deleteRunState, listRuns, loadRun } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel, createScreenBody, createSigilToken } from '../components.js';
import { currentLayoutClass } from '../layout.js';

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
  const isWide = currentLayoutClass() === 'wide';

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

    const content = document.createElement('div');
    content.className = 'run-info';

    const heading = document.createElement('div');
    heading.style.display = 'flex';
    heading.style.justifyContent = 'space-between';

    const seed = document.createElement('strong');
    seed.textContent = `SEED ${entry.worldSeed}`;
    const theme = document.createElement('span');
    theme.textContent = String(entry.theme || 'UNKNOWN THEME').replaceAll('_', ' ').toUpperCase();
    heading.append(seed, theme);

    const summary = document.createElement('div');
    summary.style.display = 'flex';
    summary.style.alignItems = 'center';
    summary.style.justifyContent = 'space-between';
    appendSigils(summary, entry.partySigils);

    const depth = document.createElement('span');
    depth.textContent = `DEPTH ${entry.depth}`;
    depth.className = 'accent-text glow';
    summary.appendChild(depth);

    const classes = document.createElement('span');
    classes.textContent = (entry.partyClasses || []).length
      ? `CLASSES ${(entry.partyClasses || []).join(' / ').toUpperCase()}`
      : 'CLASSES UNKNOWN';
    const played = document.createElement('span');
    played.textContent = `LAST ${formatDate(lastPlayed(entry))}`;
    content.append(heading, summary, classes, played);
    element.appendChild(content);

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
    resumeButton.classList.remove('btn-primary');
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

  function createRunCard(row) {
    const { entry, result } = row;
    const broken = !result.success;
    const accent = safeAccent(entry.accentSwatch);

    const card = document.createElement('article');
    card.className = `run-card${broken ? ' broken' : ''}${selectedKey === entry.key ? ' selected' : ''}`;
    card.tabIndex = 0;
    card.dataset.testid = `run-row-${entry.key}`;
    card.setAttribute('aria-selected', String(selectedKey === entry.key));

    const choose = () => {
      selectedKey = entry.key;
      noticeText = broken ? `QUARANTINED — ${failureLabel(result.error)}` : `SELECTED SEED ${entry.worldSeed}`;
      render();
    };
    card.addEventListener('click', choose);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault?.();
        choose();
      }
    });

    const swatch = document.createElement('span');
    swatch.className = 'accent-swatch';
    swatch.style.backgroundColor = accent;
    swatch.setAttribute('aria-label', `Accent ${accent}`);
    card.appendChild(swatch);

    const body = document.createElement('div');
    body.className = 'run-card-body';

    const head = document.createElement('div');
    head.className = 'run-card-head';
    const seed = document.createElement('div');
    seed.className = 'run-card-seed accent-text glow';
    seed.textContent = `SEED ${entry.worldSeed}`;
    const theme = document.createElement('div');
    theme.className = 'run-card-theme';
    theme.textContent = String(entry.theme || 'UNKNOWN THEME').replaceAll('_', ' ').toUpperCase();
    head.append(seed, theme);

    const mid = document.createElement('div');
    mid.className = 'run-card-mid';
    const party = document.createElement('div');
    party.className = 'run-card-party';
    party.dataset.testid = 'run-sigils';
    for (const codepoint of entry.partySigils || []) {
      if (!isPlayerSigil(codepoint)) continue;
      party.appendChild(createSigilToken(codepoint, 34, { role: 'player' }));
    }
    if (party.children.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = 'NO SIGILS';
      party.appendChild(empty);
    }
    const depthBlock = document.createElement('div');
    depthBlock.className = 'run-card-depth';
    const depthLabel = document.createElement('span');
    depthLabel.className = 'label';
    depthLabel.textContent = 'DEPTH';
    const depthValue = document.createElement('span');
    depthValue.className = 'value accent-text glow';
    depthValue.textContent = String(entry.depth);
    depthBlock.append(depthLabel, depthValue);
    mid.append(party, depthBlock);

    const meta = document.createElement('div');
    meta.className = 'run-card-meta';
    const classesText = (entry.partyClasses || []).length
      ? (entry.partyClasses || []).join(' / ').toUpperCase()
      : 'UNKNOWN';
    meta.textContent = `CLASSES ${classesText} · LAST ${formatDate(lastPlayed(entry))}`;

    body.append(head, mid, meta);

    if (broken) {
      const error = document.createElement('p');
      error.className = 'load-error';
      error.textContent = `QUARANTINED — ${failureLabel(result.error)}`;
      body.appendChild(error);
    }

    const actions = document.createElement('div');
    actions.className = 'run-card-actions';
    const resumeButton = track(createButton('◈ RESUME', {
      primary: true,
      disabled: broken,
      description: broken ? `Cannot resume: ${failureLabel(result.error)}` : `Resume seed ${entry.worldSeed}`,
      onClick: (event) => {
        event.stopPropagation?.();
        resume(row);
      }
    }));
    resumeButton.classList.remove('btn-primary');
    resumeButton.dataset.testid = `run-resume-${entry.key}`;
    const deleteButton = track(createButton('DELETE', {
      danger: true,
      onClick: (event) => {
        event.stopPropagation?.();
        removeRun(entry);
      }
    }));
    deleteButton.classList.add('btn-danger');
    deleteButton.dataset.testid = `run-delete-${entry.key}`;
    actions.append(resumeButton, deleteButton);
    body.appendChild(actions);

    card.appendChild(body);
    return card;
  }

  function renderPortrait(rows) {
    const screen = document.createElement('section');
    screen.className = 'screen-container';
    screen.setAttribute('aria-label', 'Run library');

    const header = document.createElement('header');
    header.className = 'panel-elevated s-3';
    header.style.textAlign = 'center';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'micro';
    eyebrow.textContent = '◈ RUN LIBRARY';
    eyebrow.setAttribute('role', 'heading');
    eyebrow.setAttribute('aria-level', '1');
    const activeCount = document.createElement('div');
    activeCount.className = 'subheading accent-text glow';
    activeCount.textContent = `${rows.filter(row => row.result.success).length} ACTIVE RUNS`;
    header.append(eyebrow, activeCount);

    const notice = document.createElement('p');
    notice.className = 'console-note';
    notice.setAttribute('aria-live', 'polite');
    notice.dataset.testid = 'library-notice';
    notice.textContent = noticeText;

    header.appendChild(notice);
    screen.appendChild(header);

    const body = createScreenBody({ className: 's-3' });
    body.dataset.testid = 'library-list';
    if (rows.length === 0) {
      const empty = createPanel({ title: 'NO LIVING RUNS' });
      empty.dataset.testid = 'library-empty';
      const message = document.createElement('p');
      message.textContent = 'No saved living runs. Wiped runs remain seed tombstones only and do not appear here.';
      empty.appendChild(message);
      body.appendChild(empty);
    } else {
      body.setAttribute('aria-label', 'Saved runs');
      body.tabIndex = 0;
      for (const row of rows) body.appendChild(createRunRow(row));
    }
    screen.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'library-actions';
    const newRun = track(createButton('NEW RUN', {
      primary: true,
      onClick: () => navigate('creation')
    }));
    newRun.classList.remove('btn-primary');
    newRun.dataset.testid = 'library-new-run';
    const title = track(createButton('TITLE', {
      onClick: () => navigate('title')
    }));
    title.dataset.testid = 'library-title';
    actions.classList.add('panel', 's-3');
    actions.append(title, newRun);
    screen.appendChild(actions);
    return screen;
  }

  function renderWide(rows) {
    const screen = document.createElement('section');
    screen.className = 'screen-container wide-library-shell';
    screen.dataset.wideRoot = '';
    screen.setAttribute('aria-label', 'Run library');

    const header = document.createElement('header');
    header.className = 'panel-elevated wide-library-header';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'micro eyebrow';
    eyebrow.textContent = '◈ RUN LIBRARY';
    eyebrow.setAttribute('role', 'heading');
    eyebrow.setAttribute('aria-level', '1');
    const activeCount = document.createElement('div');
    activeCount.className = 'headline subheading accent-text glow';
    activeCount.textContent = `${rows.filter(row => row.result.success).length} ACTIVE RUNS`;
    header.append(eyebrow, activeCount);

    const notice = document.createElement('p');
    notice.className = 'console-note';
    notice.setAttribute('aria-live', 'polite');
    notice.dataset.testid = 'library-notice';
    notice.textContent = noticeText;
    header.appendChild(notice);
    screen.appendChild(header);

    const body = createScreenBody({ className: 'wide-library-body' });
    body.dataset.testid = 'library-list';
    if (rows.length === 0) {
      const empty = createPanel({ title: 'NO LIVING RUNS' });
      empty.dataset.testid = 'library-empty';
      empty.classList.add('no-limit-hint');
      const message = document.createElement('p');
      message.textContent = 'No saved living runs. Wiped runs remain seed tombstones only and do not appear here.';
      empty.appendChild(message);
      body.appendChild(empty);
    } else {
      body.setAttribute('aria-label', 'Saved runs');
      body.tabIndex = 0;
      const grid = document.createElement('div');
      grid.className = 'wide-library-grid';
      grid.dataset.testid = 'library-grid';
      for (const row of rows) grid.appendChild(createRunCard(row));
      const hint = document.createElement('div');
      hint.className = 'no-limit-hint';
      hint.textContent = '◈ NO LIMIT ON SIMULTANEOUS RUNS ◈';
      grid.appendChild(hint);
      body.appendChild(grid);
    }
    screen.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'panel wide-library-footer';
    const titleButton = track(createButton('◀ TITLE', {
      onClick: () => navigate('title')
    }));
    titleButton.dataset.testid = 'library-title';
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    const newRun = track(createButton('◈ NEW RUN', {
      primary: true,
      onClick: () => navigate('creation')
    }));
    newRun.classList.remove('btn-primary');
    newRun.dataset.testid = 'library-new-run';
    actions.append(titleButton, spacer, newRun);
    screen.appendChild(actions);
    return screen;
  }

  function render() {
    cleanupRender();
    container.replaceChildren();
    const rows = readRows();
    const screen = isWide ? renderWide(rows) : renderPortrait(rows);
    container.replaceChildren(screen);
  }

  render();

  return {
    unmount() {
      cleanupRender();
    }
  };
}
