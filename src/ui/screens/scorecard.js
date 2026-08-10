import { encodeSeed } from '../../state/save-encode.js';
import { createButton, createSigilToken } from '../components.js';
import { bus } from '../../state/bus.js';

export function mount(container, params) {
  const { seed, depth, party, causeOfDeath, scrapCounter } = params;

  const depthDisplay = document.createElement('div');
  depthDisplay.className = 'display glow-strong';
  depthDisplay.textContent = `DEPTH ${depth || 1}`;
  container.appendChild(depthDisplay);

  const roster = document.createElement('div');
  roster.className = 'scorecard-roster';
  if (party && party.length > 0) {
    for (const character of party) {
      const sigil = createSigilToken(character.sigilCodepoint || 0xE000, 72);
      sigil.style.opacity = '0.4';
      roster.appendChild(sigil);
    }
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
  stats.textContent = `SCRAP RECOVERED: ${scrapCounter || 0}`;
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