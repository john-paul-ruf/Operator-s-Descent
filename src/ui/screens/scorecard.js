import { deleteRunState, getRunKey } from '../../state/library.js';
import { encodeSeed } from '../../state/save-encode.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel, createScreenBody, createSigilToken } from '../components.js';
import { currentLayoutClass } from '../layout.js';

const PLAYER_BANK_START = 0xE000;
const PLAYER_BANK_END = 0xE030;

function getNumber(...values) {
  return values.find(value => Number.isFinite(value)) ?? 0;
}

function codepointFromSigilId(sigilId) {
  const match = typeof sigilId === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(sigilId);
  return match ? Number.parseInt(match[1], 16) : null;
}

function safePlayerSigil(character) {
  const codepoint = Number.isInteger(character?.sigilCodepoint)
    ? character.sigilCodepoint
    : codepointFromSigilId(character?.sigilId);
  return Number.isInteger(codepoint) && codepoint >= PLAYER_BANK_START && codepoint < PLAYER_BANK_END
    ? codepoint
    : PLAYER_BANK_START;
}

function shareUrl(fragment) {
  const location = globalThis.window?.location;
  const origin = location?.origin || 'http://127.0.0.1';
  const pathname = location?.pathname || '/';
  return `${origin}${pathname}${fragment}`;
}

function runKey(runState) {
  return getRunKey(runState);
}

function navigate(screen, params = {}) {
  bus.dispatch('ui:navigate', { screen, params });
}

// Update a button's visible text without disturbing prefixed icon children.
// Walks childNodes for the trailing text node (real DOM) and rewrites its
// value; falls back to textContent for environments without text-node
// support (FakeElement in unit tests). Aria-label is never touched — it
// stays pinned to the former visible label per Design Decision 2.
function swapButtonLabel(button, text) {
  const nodes = button.childNodes;
  if (nodes && typeof nodes.length === 'number' && nodes.length > 0) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node && node.nodeType === 3) {
        node.nodeValue = text;
        return;
      }
    }
  }
  button.textContent = text;
}

function buildRoster(party) {
  const roster = document.createElement('div');
  roster.className = 'scorecard-roster';
  roster.dataset.testid = 'scorecard-roster';
  for (const character of party) {
    const entry = document.createElement('div');
    entry.className = 'scorecard-roster-entry dead';
    const sigil = createSigilToken(safePlayerSigil(character), 72, { role: 'player' });
    sigil.classList.add('sigil-dead');
    const label = document.createElement('span');
    const currentHP = getNumber(character?.currentHP, character?.hp);
    const maxHP = getNumber(character?.maxHP, character?.hpMax, character?.hp);
    label.textContent = `${(character?.classId || 'unknown').toUpperCase()} · CAL ${getNumber(character?.calibrationCount)} · HP ${currentHP}/${maxHP}`;
    entry.append(sigil, label);
    roster.appendChild(entry);
  }
  return roster;
}

function buildMetricGrid(metrics) {
  const grid = document.createElement('div');
  grid.className = 'scorecard-metrics';
  for (const [label, value] of metrics) {
    const metric = document.createElement('div');
    metric.className = 'scorecard-metric';
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    const valueElement = document.createElement('strong');
    valueElement.textContent = Number.isInteger(value) ? value.toLocaleString() : String(value);
    metric.append(labelElement, valueElement);
    grid.appendChild(metric);
  }
  return grid;
}

export function mount(container, params = {}) {
  const cleanups = [];
  const isWide = currentLayoutClass() === 'wide';
  const runState = params.runState && typeof params.runState === 'object' ? params.runState : {};
  const summary = params.summary && typeof params.summary === 'object' ? params.summary : {};
  const party = Array.isArray(params.party)
    ? params.party
    : (Array.isArray(runState.party) ? runState.party : []);
  const seed = getNumber(params.seed, runState.worldSeed) >>> 0;
  const depth = Math.max(1, Math.floor(getNumber(params.depth, runState.depth, 1)));
  const causeOfDeath = typeof params.causeOfDeath === 'string' && params.causeOfDeath ? params.causeOfDeath : 'UNKNOWN';
  const key = runKey(runState);
  const deletion = key ? deleteRunState(key) : { success: true, tombstoned: false };

  const calibrationTotal = party.reduce(
    (total, character) => total + getNumber(character?.calibrationCount),
    0
  );
  const metrics = [
    ['Floors descended', getNumber(summary.floorsDescended, runState.stats?.floorsDescended, runState.floorsDescended, depth)],
    ['Calibrations', getNumber(summary.calibrations, runState.stats?.calibrations, runState.calibrations, calibrationTotal)],
    ['Enemies slain', getNumber(summary.enemiesSlain, runState.stats?.enemiesSlain, runState.enemiesSlain)],
    ['Echoes slain', getNumber(summary.echoesSlain, runState.stats?.echoesSlain, runState.echoesSlain)],
    ['CORRUPT items', getNumber(summary.corruptItems, summary.corruptItemCount, runState.stats?.corruptItems, runState.corruptItems)],
    ['Corruption', getNumber(summary.corruption, runState.corruption, params.corruption)],
    ['Scrap recovered', getNumber(summary.scrapRecovered, runState.stats?.scrapRecovered, runState.scrapCounter, params.scrapCounter)],
    ['Credits remaining', getNumber(summary.creditsRemaining, runState.credits, params.credits)]
  ];

  const seedFragment = `#w=${encodeSeed(seed)}`;
  const shareLink = shareUrl(seedFragment);
  const linkDisplay = document.createElement('input');
  linkDisplay.type = 'text';
  linkDisplay.className = 'share-link-display share-input console-row';
  linkDisplay.dataset.testid = 'scorecard-share-link';
  linkDisplay.setAttribute('readonly', 'readonly');
  linkDisplay.setAttribute('aria-label', 'World seed share link');
  linkDisplay.value = shareLink;

  const copyStatus = document.createElement('div');
  copyStatus.className = 'scorecard-copy-status console-row';
  copyStatus.dataset.testid = 'scorecard-copy-status';
  copyStatus.setAttribute('aria-live', 'polite');
  copyStatus.textContent = '';

  let resetTimer = null;

  function flashLabel(text) {
    swapButtonLabel(copyBtn, text);
    if (typeof globalThis.setTimeout !== 'function') return;
    if (resetTimer != null && typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(resetTimer);
    resetTimer = globalThis.setTimeout(() => { swapButtonLabel(copyBtn, 'SHARE WORLD LINK'); resetTimer = null; }, 2000);
  }

  async function copyToClipboard() {
    let copied = false;
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(shareLink);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      linkDisplay.focus?.();
      linkDisplay.select?.();
      try { copied = Boolean(globalThis.document?.execCommand?.('copy')); } catch { copied = false; }
    }
    if (copied) {
      copyStatus.textContent = 'WORLD LINK COPIED';
      flashLabel('WORLD LINK COPIED');
    } else {
      copyStatus.textContent = 'CLIPBOARD UNAVAILABLE — SELECT LINK';
      linkDisplay.focus?.();
      linkDisplay.select?.();
    }
  }

  async function copyShareLink() {
    linkDisplay.value = shareLink;
    if (globalThis.navigator?.share) {
      try {
        await globalThis.navigator.share({
          title: "Operator's Descent",
          text: 'Join my world in Operator\'s Descent.',
          url: shareLink,
        });
        copyStatus.textContent = 'WORLD LINK SHARED';
        flashLabel('WORLD LINK SHARED');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          copyStatus.textContent = 'SHARE CANCELLED';
          return;
        }
        // Any other share failure (unsupported context, permission denial,
        // etc.) falls through to the honest clipboard fallback below.
      }
    }
    await copyToClipboard();
  }

  const copyBtn = createButton('SHARE WORLD LINK', {
    label: 'SHARE WORLD LINK',
    icon: 'link',
    iconSize: 14,
    iconTone: 'accent',
    onClick: copyShareLink
  });
  copyBtn.dataset.testid = 'scorecard-copy-world';
  cleanups.push(() => {
    if (resetTimer != null && typeof globalThis.clearTimeout === 'function') globalThis.clearTimeout(resetTimer);
    resetTimer = null;
    copyBtn.cleanup?.();
  });

  const restart = createButton('RESTART SAME SEED', {
    label: 'RESTART SAME SEED',
    icon: 'recycle',
    iconSize: 16,
    iconTone: 'accent',
    primary: true,
    onClick: () => navigate('creation', { preloadedSeed: seed })
  });
  restart.classList.remove('btn-primary');
  restart.dataset.testid = 'scorecard-restart-seed';
  const newRun = createButton('NEW RUN', {
    label: 'NEW RUN',
    icon: 'chevron-right',
    iconSize: 16,
    iconTone: 'accent',
    onClick: () => navigate('creation')
  });
  newRun.dataset.testid = 'scorecard-new-run';
  const titleButton = createButton('', {
    label: 'TITLE',
    icon: 'arrow-left',
    iconSize: 16,
    onClick: () => navigate('title')
  });
  titleButton.dataset.testid = 'scorecard-title';
  const libraryButton = createButton('', {
    label: 'LIBRARY',
    icon: 'archive',
    iconSize: 16,
    onClick: () => navigate('library')
  });
  libraryButton.dataset.testid = 'scorecard-library';
  const highScoresButton = createButton('', {
    label: 'HIGH SCORES',
    icon: 'star',
    iconSize: 16,
    onClick: () => navigate('highscores')
  });
  highScoresButton.dataset.testid = 'scorecard-high-scores';
  cleanups.push(
    () => restart.cleanup?.(),
    () => newRun.cleanup?.(),
    () => titleButton.cleanup?.(),
    () => libraryButton.cleanup?.(),
    () => highScoresButton.cleanup?.()
  );

  const screen = document.createElement('section');
  screen.className = isWide ? 'scorecard-screen wide-scorecard-shell' : 'scorecard-screen screen-container';
  if (isWide) screen.dataset.wideRoot = '';
  screen.style.padding = '0';
  screen.style.gap = '0';
  screen.setAttribute('aria-label', 'Run scorecard');

  if (isWide) {
    // ── Summary pane (left) ─────────────────────────────────────────
    const summaryPane = document.createElement('section');
    summaryPane.className = 'wide-scorecard-summary';
    summaryPane.dataset.testid = 'scorecard-summary-pane';

    const summaryHeader = document.createElement('header');
    summaryHeader.className = 'wide-scorecard-header';
    const summaryOrnament = document.createElement('div');
    summaryOrnament.className = 'micro';
    summaryOrnament.textContent = '◈ ◈ ◈';
    const summaryConclusion = document.createElement('h1');
    summaryConclusion.className = 'heading glow-danger';
    summaryConclusion.textContent = 'PARTY WIPE';
    const summarySubtitle = document.createElement('div');
    summarySubtitle.className = 'micro';
    summarySubtitle.textContent = 'RUN CONCLUDED';
    summaryHeader.append(summaryOrnament, summaryConclusion, summarySubtitle);

    const summaryBody = createScreenBody({ className: 'wide-scorecard-body' });

    const depthPanel = createPanel({ elevated: true });
    depthPanel.style.textAlign = 'center';
    const depthLabel = document.createElement('div');
    depthLabel.className = 'micro';
    depthLabel.textContent = '◈ FINAL DEPTH';
    const depthDisplay = document.createElement('div');
    depthDisplay.className = 'display accent-text glow-strong';
    depthDisplay.dataset.testid = 'scorecard-depth';
    depthDisplay.textContent = String(depth);
    depthPanel.append(depthLabel, depthDisplay);

    const deletionStatus = document.createElement('p');
    deletionStatus.className = 'console-note';
    deletionStatus.dataset.testid = 'scorecard-deletion';
    deletionStatus.textContent = deletion.success ? 'MUTABLE RUN STATE DELETED' : `RUN STATE DELETE FAILED — ${deletion.error || 'storage_failed'}`;

    const rosterPanel = createPanel({ title: '◈ PARTY ROSTER' });
    rosterPanel.appendChild(buildRoster(party));

    const causePanel = createPanel({ title: '◈ CAUSE OF DEATH' });
    const cod = document.createElement('p');
    cod.className = 'scorecard-cod';
    cod.dataset.testid = 'scorecard-cause';
    cod.textContent = `CAUSE OF DEATH: ${causeOfDeath}`;
    causePanel.appendChild(cod);

    const seedPanel = createPanel({ title: '◈ WORLD SEED' });
    const seedEl = document.createElement('p');
    seedEl.className = 'scorecard-seed';
    seedEl.dataset.testid = 'scorecard-seed';
    seedEl.textContent = `WORLD SEED: ${seed}`;
    seedPanel.appendChild(seedEl);

    summaryBody.append(depthPanel, deletionStatus, rosterPanel, causePanel, seedPanel);
    summaryPane.append(summaryHeader, summaryBody);

    // ── Share pane (right) ──────────────────────────────────────────
    const sharePane = document.createElement('section');
    sharePane.className = 'wide-scorecard-share';
    sharePane.dataset.testid = 'scorecard-share-pane';

    const shareHeader = document.createElement('header');
    shareHeader.className = 'wide-scorecard-header';
    const shareOrnament = document.createElement('div');
    shareOrnament.className = 'micro';
    shareOrnament.textContent = '◈ ◈ ◈';
    const shareHeading = document.createElement('h2');
    shareHeading.className = 'subheading accent-text glow-strong';
    shareHeading.textContent = 'SHARE & RESTART';
    const shareSubtitle = document.createElement('div');
    shareSubtitle.className = 'micro';
    shareSubtitle.textContent = 'CARRY THE SEED FORWARD';
    shareHeader.append(shareOrnament, shareHeading, shareSubtitle);

    const shareBody = createScreenBody({ className: 'wide-scorecard-body' });
    const sharePanel = createPanel({ title: '◈ SHARE THIS WORLD', elevated: true });
    const shareNote = document.createElement('p');
    shareNote.className = 'micro';
    shareNote.textContent = 'SEED ONLY — NO RUN STATE';
    sharePanel.append(shareNote, linkDisplay, copyBtn, copyStatus);

    const stats = createPanel({ title: '◈ RUN SUMMARY' });
    stats.classList.add('scorecard-stats');
    stats.appendChild(buildMetricGrid(metrics));

    shareBody.append(sharePanel, stats);
    sharePane.appendChild(shareHeader);
    sharePane.appendChild(shareBody);

    const actions = document.createElement('div');
    actions.className = 'wide-scorecard-actions scorecard-actions';
    const secondaryRow = document.createElement('div');
    secondaryRow.style.display = 'flex';
    secondaryRow.style.gap = '8px';
    secondaryRow.append(titleButton, libraryButton, highScoresButton);
    actions.append(restart, newRun, secondaryRow);
    sharePane.appendChild(actions);

    screen.append(summaryPane, sharePane);
  } else {
    const header = document.createElement('header');
    header.style.textAlign = 'center';
    header.className = 's-6';
    const ornament = document.createElement('div');
    ornament.className = 'micro';
    ornament.textContent = '◈ ◈ ◈';
    const conclusion = document.createElement('h1');
    conclusion.className = 'heading glow-danger';
    conclusion.textContent = 'PARTY WIPE';
    const subtitle = document.createElement('div');
    subtitle.className = 'micro';
    subtitle.textContent = 'RUN CONCLUDED';
    header.append(ornament, conclusion, subtitle);

    const body = createScreenBody({ className: 's-4' });

    const depthPanel = createPanel({ elevated: true });
    depthPanel.classList.add('s-6');
    depthPanel.style.textAlign = 'center';
    const depthLabel = document.createElement('div');
    depthLabel.className = 'micro';
    depthLabel.textContent = '◈ FINAL DEPTH';
    const depthDisplay = document.createElement('div');
    depthDisplay.className = 'display accent-text glow-strong';
    depthDisplay.dataset.testid = 'scorecard-depth';
    depthDisplay.textContent = String(depth);
    depthPanel.append(depthLabel, depthDisplay);

    const deletionStatus = document.createElement('p');
    deletionStatus.className = 'console-note';
    deletionStatus.dataset.testid = 'scorecard-deletion';
    deletionStatus.textContent = deletion.success ? 'MUTABLE RUN STATE DELETED' : `RUN STATE DELETE FAILED — ${deletion.error || 'storage_failed'}`;

    const rosterPanel = createPanel({ title: '◈ PARTY ROSTER' });
    rosterPanel.classList.add('s-4');
    rosterPanel.appendChild(buildRoster(party));

    const causePanel = createPanel({ title: '◈ CAUSE OF DEATH' });
    causePanel.classList.add('s-4');
    const cod = document.createElement('p');
    cod.className = 'scorecard-cod';
    cod.dataset.testid = 'scorecard-cause';
    cod.textContent = `CAUSE OF DEATH: ${causeOfDeath}`;
    causePanel.appendChild(cod);

    const seedPanel = createPanel({ title: '◈ WORLD SEED' });
    seedPanel.classList.add('s-4');
    const seedEl = document.createElement('p');
    seedEl.className = 'scorecard-seed';
    seedEl.dataset.testid = 'scorecard-seed';
    seedEl.textContent = `WORLD SEED: ${seed}`;
    seedPanel.appendChild(seedEl);

    const sharePanel = createPanel({ title: '◈ SHARE THIS WORLD', elevated: true });
    sharePanel.classList.add('s-4');
    const shareNote = document.createElement('p');
    shareNote.className = 'micro';
    shareNote.textContent = 'SEED ONLY — NO RUN STATE';
    sharePanel.append(shareNote, linkDisplay, copyBtn, copyStatus);

    const stats = createPanel({ title: '◈ RUN SUMMARY' });
    stats.classList.add('scorecard-stats', 's-4');
    stats.appendChild(buildMetricGrid(metrics));

    const actions = document.createElement('div');
    actions.className = 'scorecard-actions';
    actions.append(restart, newRun, titleButton, libraryButton, highScoresButton);

    body.append(depthPanel, deletionStatus, rosterPanel, causePanel, seedPanel, sharePanel, stats);
    screen.append(header, body, actions);
  }

  container.replaceChildren(screen);

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
