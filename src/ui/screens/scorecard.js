import { deleteRunState, getRunKey } from '../../state/library.js';
import { encodeSeed } from '../../state/save-encode.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel, createScreenBody, createSigilToken } from '../components.js';

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

export function mount(container, params = {}) {
  const cleanups = [];
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

  const screen = document.createElement('section');
  screen.className = 'scorecard-screen screen-container';
  screen.style.padding = '0';
  screen.style.gap = '0';
  screen.setAttribute('aria-label', 'Run scorecard');

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
  rosterPanel.appendChild(roster);

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

  const seedFragment = `#w=${encodeSeed(seed)}`;
  const linkDisplay = document.createElement('output');
  linkDisplay.className = 'share-link-display';
  linkDisplay.dataset.testid = 'scorecard-share-link';
  linkDisplay.textContent = seedFragment;

  const copyBtn = createButton('COPY WORLD LINK', {
    onClick: () => {
      const url = shareUrl(seedFragment);
      globalThis.navigator?.clipboard?.writeText?.(url)?.catch?.(() => {});
      linkDisplay.textContent = seedFragment;
      copyBtn.textContent = 'WORLD LINK COPIED';
      setTimeout(() => { copyBtn.textContent = 'COPY WORLD LINK'; }, 2000);
    }
  });
  copyBtn.dataset.testid = 'scorecard-copy-world';
  cleanups.push(() => copyBtn.cleanup?.());

  const sharePanel = createPanel({ title: '◈ SHARE THIS WORLD', elevated: true });
  sharePanel.classList.add('s-4');
  const shareNote = document.createElement('p');
  shareNote.className = 'micro';
  shareNote.textContent = 'SEED ONLY — NO RUN STATE';
  sharePanel.append(shareNote, linkDisplay, copyBtn);

  const stats = createPanel({ title: '◈ RUN SUMMARY' });
  stats.classList.add('scorecard-stats', 's-4');
  const metricGrid = document.createElement('div');
  metricGrid.className = 'scorecard-metrics';
  for (const [label, value] of metrics) {
    const metric = document.createElement('div');
    metric.className = 'scorecard-metric';
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    const valueElement = document.createElement('strong');
    valueElement.textContent = Number.isInteger(value) ? value.toLocaleString() : String(value);
    metric.append(labelElement, valueElement);
    metricGrid.appendChild(metric);
  }
  stats.appendChild(metricGrid);

  const actions = document.createElement('div');
  actions.className = 'scorecard-actions';
  const restart = createButton('RESTART SAME SEED', {
    primary: true,
    onClick: () => navigate('creation', { preloadedSeed: seed })
  });
  restart.dataset.testid = 'scorecard-restart-seed';
  const newRun = createButton('NEW RUN', {
    onClick: () => navigate('creation')
  });
  newRun.dataset.testid = 'scorecard-new-run';
  const title = createButton('TITLE', {
    onClick: () => navigate('title')
  });
  title.dataset.testid = 'scorecard-title';
  const library = createButton('LIBRARY', {
    onClick: () => navigate('library')
  });
  library.dataset.testid = 'scorecard-library';
  cleanups.push(() => restart.cleanup?.(), () => newRun.cleanup?.(), () => title.cleanup?.(), () => library.cleanup?.());
  actions.append(restart, newRun, title, library);

  body.append(depthPanel, deletionStatus, rosterPanel, causePanel, seedPanel, sharePanel, stats);

  screen.append(header, body, actions);
  container.replaceChildren(screen);

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
