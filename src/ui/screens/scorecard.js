import { encodeSeed } from '../../state/save-encode.js';
import { createButton, createSigilToken } from '../components.js';
import { bus } from '../../state/bus.js';

export function mount(container, params = {}) {
  const runState = params.runState && typeof params.runState === 'object' ? params.runState : {};
  const summary = params.summary && typeof params.summary === 'object' ? params.summary : {};
  const party = Array.isArray(params.party)
    ? params.party
    : (Array.isArray(runState.party) ? runState.party : []);
  const seed = Number.isFinite(params.seed)
    ? params.seed
    : (Number.isFinite(runState.worldSeed) ? runState.worldSeed : 0);
  const depth = Number.isFinite(params.depth)
    ? params.depth
    : (Number.isFinite(runState.depth) ? runState.depth : 0);
  const causeOfDeath = params.causeOfDeath || 'UNKNOWN';
  const getNumber = (...values) => values.find(value => Number.isFinite(value)) ?? 0;
  const calibrationTotal = party.reduce(
    (total, character) => total + getNumber(character?.calibrationCount),
    0
  );
  const metrics = [
    ['Floors descended', getNumber(summary.floorsDescended, runState.floorsDescended, depth)],
    ['Calibrations', getNumber(summary.calibrations, runState.calibrations, calibrationTotal)],
    ['Enemies slain', getNumber(summary.enemiesSlain, runState.enemiesSlain)],
    ['Echoes slain', getNumber(summary.echoesSlain, runState.echoesSlain)],
    ['CORRUPT items', getNumber(summary.corruptItems, summary.corruptItemCount, runState.corruptItems)],
    ['Corruption', getNumber(summary.corruption, runState.corruption, params.corruption)],
    ['Scrap Recovered', getNumber(summary.scrapRecovered, runState.scrapCounter, params.scrapCounter)],
    ['Credits remaining', getNumber(summary.creditsRemaining, runState.credits, params.credits)]
  ];

  const depthDisplay = document.createElement('div');
  depthDisplay.className = 'display glow-strong';
  depthDisplay.textContent = `DEPTH ${depth || 1}`;
  container.appendChild(depthDisplay);

  const roster = document.createElement('div');
  roster.className = 'scorecard-roster';
  for (const character of party) {
    const codepoint = Number.isInteger(character?.sigilCodepoint)
      && character.sigilCodepoint >= 0
      && character.sigilCodepoint <= 0x10FFFF
      ? character.sigilCodepoint
      : 0xE000;
    const sigil = createSigilToken(codepoint, 72);
    sigil.style.opacity = '0.4';
    roster.appendChild(sigil);
  }
  container.appendChild(roster);

  const cod = document.createElement('p');
  cod.className = 'scorecard-cod';
  cod.textContent = `CAUSE OF DEATH: ${causeOfDeath || 'UNKNOWN'}`;
  container.appendChild(cod);

  const seedEl = document.createElement('p');
  seedEl.className = 'scorecard-seed';
  seedEl.textContent = `WORLD SEED: ${seed}`;
  container.appendChild(seedEl);

  const shareLink = encodeSeed(seed || 0);
  const linkDisplay = document.createElement('div');
  linkDisplay.className = 'share-link-display';
  linkDisplay.textContent = `#w=${shareLink}`;
  container.appendChild(linkDisplay);

  const copyBtn = createButton('COPY LINK', {
    onClick: () => {
      const url = `${window.location.origin}${window.location.pathname}#w=${shareLink}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
      copyBtn.textContent = 'LINK COPIED';
      setTimeout(() => { copyBtn.textContent = 'COPY LINK'; }, 2000);
    }
  });
  container.appendChild(copyBtn);

  const stats = document.createElement('div');
  stats.className = 'scorecard-stats';
  const summaryTitle = document.createElement('h3');
  summaryTitle.textContent = 'RUN SUMMARY';
  stats.appendChild(summaryTitle);
  const metricGrid = document.createElement('div');
  metricGrid.className = 'scorecard-metrics';
  for (const [label, value] of metrics) {
    const metric = document.createElement('div');
    metric.className = 'scorecard-metric';
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    const valueElement = document.createElement('strong');
    valueElement.textContent = Number.isInteger(value) ? value.toLocaleString() : String(value);
    metric.appendChild(labelElement);
    metric.appendChild(valueElement);
    metricGrid.appendChild(metric);
  }
  stats.appendChild(metricGrid);
  container.appendChild(stats);

  const actions = document.createElement('div');
  actions.className = 'scorecard-actions';
  actions.appendChild(createButton('RESTART SAME SEED', {
    primary: true,
    onClick: () => bus.dispatch('ui:navigate', { screen: 'creation', params: { preloadedSeed: seed } })
  }));
  actions.appendChild(createButton('NEW RUN', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'creation' })
  }));
  actions.appendChild(createButton('TITLE', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'title' })
  }));
  actions.appendChild(createButton('LIBRARY', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'library' })
  }));
  container.appendChild(actions);

  return { unmount() {} };
}
