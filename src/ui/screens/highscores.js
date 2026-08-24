import { listHighScores, HIGH_SCORE_CAP } from '../../state/high-scores.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel, createScreenBody, createSigilToken } from '../components.js';
import { currentLayoutClass } from '../layout.js';
import { captureScroll, restoreScroll } from '../scroll-memory.js';

const SCROLL_KEY = 'highscores:list';
const PLAYER_BANK_START = 0xE000;
const PLAYER_BANK_END = 0xE030;

function isPlayerSigil(codepoint) {
  return Number.isInteger(codepoint) && codepoint >= PLAYER_BANK_START && codepoint < PLAYER_BANK_END;
}

function formatDate(value) {
  return value > 0 ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) : 'UNKNOWN';
}

function navigate(screen, params = {}) {
  bus.dispatch('ui:navigate', { screen, params });
}

export function mount(container) {
  let renderCleanups = [];
  let scrollPane = null;
  const isWide = currentLayoutClass() === 'wide';

  function cleanupRender() {
    while (renderCleanups.length) renderCleanups.pop()?.();
  }

  function track(element) {
    renderCleanups.push(() => element.cleanup?.());
    return element;
  }

  function restart(entry) {
    navigate('creation', { preloadedSeed: entry.worldSeed });
  }

  function appendDeadSigils(host, sigils) {
    for (const codepoint of sigils) {
      if (!isPlayerSigil(codepoint)) continue;
      const sigil = createSigilToken(codepoint, 34, { role: 'player' });
      sigil.classList.add('sigil-dead');
      host.appendChild(sigil);
    }
    if (host.children.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = 'NO SIGILS';
      host.appendChild(empty);
    }
  }

  function classesText(entry) {
    return entry.partyClasses.length
      ? `CLASSES ${entry.partyClasses.join(' / ').toUpperCase()}`
      : 'CLASSES UNKNOWN';
  }

  function themeText(entry) {
    return String(entry.theme || 'UNKNOWN THEME').replaceAll('_', ' ').toUpperCase();
  }

  function restartButtonFor(entry) {
    const button = track(createButton('RESTART SAME SEED', {
      label: 'RESTART SAME SEED',
      icon: 'recycle',
      iconSize: 16,
      iconTone: 'accent',
      primary: true,
      onClick: (event) => {
        event.stopPropagation?.();
        restart(entry);
      }
    }));
    button.classList.remove('btn-primary');
    button.dataset.testid = `highscore-restart-${entry.key}`;
    return button;
  }

  function createEntryRow(entry) {
    const element = document.createElement('article');
    element.className = 'run-row';
    element.dataset.testid = `highscore-row-${entry.key}`;

    const swatch = document.createElement('span');
    swatch.className = 'accent-swatch';
    swatch.style.backgroundColor = entry.accentSwatch;
    swatch.setAttribute('aria-label', `Accent ${entry.accentSwatch}`);
    element.appendChild(swatch);

    const content = document.createElement('div');
    content.className = 'run-info';

    const heading = document.createElement('div');
    heading.style.display = 'flex';
    heading.style.justifyContent = 'space-between';
    const seed = document.createElement('strong');
    seed.textContent = `SEED ${entry.worldSeed}`;
    const theme = document.createElement('span');
    theme.textContent = themeText(entry);
    heading.append(seed, theme);

    const summary = document.createElement('div');
    summary.style.display = 'flex';
    summary.style.alignItems = 'center';
    summary.style.justifyContent = 'space-between';
    const sigils = document.createElement('div');
    sigils.className = 'run-sigils';
    sigils.dataset.testid = 'highscore-sigils';
    appendDeadSigils(sigils, entry.partySigils);
    summary.appendChild(sigils);

    const depth = document.createElement('div');
    depth.className = 'display accent-text glow-strong';
    depth.textContent = String(entry.depth);
    summary.appendChild(depth);

    const classes = document.createElement('span');
    classes.textContent = classesText(entry);

    const cause = document.createElement('p');
    cause.className = 'scorecard-cod';
    cause.textContent = `CAUSE OF DEATH: ${entry.causeOfDeath}`;

    const date = document.createElement('span');
    date.textContent = formatDate(entry.endedAt);

    content.append(heading, summary, classes, cause, date);
    element.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'run-actions';
    actions.appendChild(restartButtonFor(entry));
    content.appendChild(actions);

    return element;
  }

  function createEntryCard(entry) {
    const card = document.createElement('article');
    card.className = 'run-card';
    card.dataset.testid = `highscore-row-${entry.key}`;

    const swatch = document.createElement('span');
    swatch.className = 'accent-swatch';
    swatch.style.backgroundColor = entry.accentSwatch;
    swatch.setAttribute('aria-label', `Accent ${entry.accentSwatch}`);
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
    theme.textContent = themeText(entry);
    head.append(seed, theme);

    const mid = document.createElement('div');
    mid.className = 'run-card-mid';
    const party = document.createElement('div');
    party.className = 'run-card-party';
    party.dataset.testid = 'highscore-sigils';
    appendDeadSigils(party, entry.partySigils);
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
    meta.textContent = `${classesText(entry)} · CAUSE OF DEATH: ${entry.causeOfDeath} · ${formatDate(entry.endedAt)}`;

    body.append(head, mid, meta);

    const actions = document.createElement('div');
    actions.className = 'run-card-actions';
    actions.appendChild(restartButtonFor(entry));
    body.appendChild(actions);

    card.appendChild(body);
    return card;
  }

  function renderPortrait(entries) {
    const screen = document.createElement('section');
    screen.className = 'screen-container';
    screen.setAttribute('aria-label', 'High scores');

    const header = document.createElement('header');
    header.className = 'panel-elevated s-3';
    header.style.textAlign = 'center';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'micro';
    eyebrow.textContent = '◈ HIGH SCORES';
    eyebrow.setAttribute('role', 'heading');
    eyebrow.setAttribute('aria-level', '1');
    const count = document.createElement('div');
    count.className = 'subheading accent-text glow';
    count.textContent = `${entries.length} OF ${HIGH_SCORE_CAP} RECORDED`;
    header.append(eyebrow, count);
    screen.appendChild(header);

    const body = createScreenBody({ className: 's-3' });
    body.dataset.testid = 'highscores-list';
    if (entries.length === 0) {
      const empty = createPanel({ title: 'NO FALLEN RUNS YET' });
      empty.dataset.testid = 'highscores-empty';
      const message = document.createElement('p');
      message.textContent = 'NO FALLEN RUNS YET — DEPTH REACHED AT WIPE BECOMES YOUR SCORE.';
      empty.appendChild(message);
      body.appendChild(empty);
    } else {
      body.setAttribute('aria-label', 'Recorded high scores');
      body.tabIndex = 0;
      for (const entry of entries) body.appendChild(createEntryRow(entry));
    }
    screen.appendChild(body);
    scrollPane = body;

    const actions = document.createElement('div');
    actions.className = 'library-actions';
    const titleButton = track(createButton('', {
      label: 'TITLE',
      icon: 'arrow-left',
      iconSize: 16,
      onClick: () => navigate('title')
    }));
    titleButton.dataset.testid = 'highscores-title';
    titleButton.style.flex = '0 0 auto';
    titleButton.style.minWidth = '96px';
    const newRun = track(createButton('NEW RUN', {
      label: 'NEW RUN',
      icon: 'chevron-right',
      iconSize: 16,
      iconTone: 'accent',
      primary: true,
      onClick: () => navigate('creation')
    }));
    newRun.classList.remove('btn-primary');
    newRun.dataset.testid = 'highscores-new-run';
    newRun.style.flex = '1';
    actions.classList.add('panel', 's-3');
    actions.append(titleButton, newRun);
    screen.appendChild(actions);
    return screen;
  }

  function renderWide(entries) {
    const screen = document.createElement('section');
    screen.className = 'screen-container wide-library-shell';
    screen.dataset.wideRoot = '';
    screen.setAttribute('aria-label', 'High scores');

    const header = document.createElement('header');
    header.className = 'panel-elevated wide-library-header';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'micro eyebrow';
    eyebrow.textContent = '◈ HIGH SCORES';
    eyebrow.setAttribute('role', 'heading');
    eyebrow.setAttribute('aria-level', '1');
    const count = document.createElement('div');
    count.className = 'headline subheading accent-text glow';
    count.textContent = `${entries.length} OF ${HIGH_SCORE_CAP} RECORDED`;
    header.append(eyebrow, count);
    screen.appendChild(header);

    const body = createScreenBody({ className: 'wide-library-body' });
    body.dataset.testid = 'highscores-list';
    if (entries.length === 0) {
      const empty = createPanel({ title: 'NO FALLEN RUNS YET' });
      empty.dataset.testid = 'highscores-empty';
      empty.classList.add('no-limit-hint');
      const message = document.createElement('p');
      message.textContent = 'NO FALLEN RUNS YET — DEPTH REACHED AT WIPE BECOMES YOUR SCORE.';
      empty.appendChild(message);
      body.appendChild(empty);
    } else {
      body.setAttribute('aria-label', 'Recorded high scores');
      body.tabIndex = 0;
      const grid = document.createElement('div');
      grid.className = 'wide-library-grid';
      grid.dataset.testid = 'highscores-grid';
      for (const entry of entries) grid.appendChild(createEntryCard(entry));
      const hint = document.createElement('div');
      hint.className = 'no-limit-hint';
      hint.textContent = '◈ RANKED BY DEPTH REACHED, HIGHEST FIRST ◈';
      grid.appendChild(hint);
      body.appendChild(grid);
    }
    screen.appendChild(body);
    scrollPane = body;

    const actions = document.createElement('div');
    actions.className = 'panel wide-library-footer';
    const titleButton = track(createButton('', {
      label: '◀ TITLE',
      icon: 'arrow-left',
      iconSize: 16,
      onClick: () => navigate('title')
    }));
    titleButton.dataset.testid = 'highscores-title';
    titleButton.style.flex = '0 0 96px';
    titleButton.style.minWidth = '96px';
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    const newRun = track(createButton('◈ NEW RUN', {
      label: '◈ NEW RUN',
      icon: 'chevron-right',
      iconSize: 16,
      iconTone: 'accent',
      primary: true,
      onClick: () => navigate('creation')
    }));
    newRun.classList.remove('btn-primary');
    newRun.dataset.testid = 'highscores-new-run';
    newRun.style.flex = '0 0 240px';
    actions.append(titleButton, spacer, newRun);
    screen.appendChild(actions);
    return screen;
  }

  function render() {
    captureScroll(scrollPane, SCROLL_KEY);
    cleanupRender();
    container.replaceChildren();
    scrollPane = null;
    const entries = listHighScores();
    const screen = isWide ? renderWide(entries) : renderPortrait(entries);
    container.replaceChildren(screen);
    restoreScroll(scrollPane, SCROLL_KEY);
  }

  render();

  return {
    unmount() {
      cleanupRender();
    }
  };
}
