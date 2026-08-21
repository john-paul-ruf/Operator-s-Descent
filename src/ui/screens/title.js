import { bus } from '../../state/bus.js';
import { createButton } from '../components.js';
import { createInputHandler } from '../input.js';
import { currentLayoutClass } from '../layout.js';

const BRANCHES = [
  ['◈ BEGIN NEW RUN', 'creation', 'title-begin-new-run'],
  ['◈ RUN LIBRARY', 'library', 'title-run-library'],
  ['◈ IMPORT LINK', 'import', 'title-import-link']
];

// the-manual SESSION-04 — TUTORIAL branch retired; MANUAL opens the modal.
// Distinguished from SETTINGS by `action: 'manual'` vs the default navigate.
const SECONDARY_BRANCHES = [
  ['MANUAL', 'manual', 'title-manual', 'manual'],
  ['SETTINGS', 'settings', 'title-settings']
];

function navigate(screen, params = {}) {
  bus.dispatch('ui:navigate', { screen, params });
}

function openManual(source) {
  bus.dispatch('ui:manual-open', { target: null, source });
}

function mountPortrait(container, cleanups) {
  const screen = document.createElement('section');
  screen.className = 'title-screen';
  screen.setAttribute('aria-label', 'Title screen');

  const header = document.createElement('div');
  header.className = 'title-header caption glow';
  header.style.color = 'var(--text-secondary)';
  header.textContent = 'GLITCH FORGEWORKS';
  header.dataset.testid = 'title-header';

  const main = document.createElement('div');
  main.className = 'title-main';

  const titleBlock = document.createElement('div');
  titleBlock.style.display = 'flex';
  titleBlock.style.flexDirection = 'column';
  titleBlock.style.alignItems = 'center';

  const ornamentTop = document.createElement('div');
  ornamentTop.className = 'ornament accent-text glow';
  ornamentTop.style.color = 'var(--text-secondary)';

  const titleTop = document.createElement('h1');
  titleTop.className = 'display glow-strong title-glitch';
  titleTop.textContent = "OPERATOR'S";
  titleTop.setAttribute('data-text', "OPERATOR'S");
  titleTop.setAttribute('data-glitch', '');
  titleTop.dataset.glitchIntensity = '0.10';
  titleTop.style.fontSize = '36px';

  const titleBottom = document.createElement('h1');
  titleBottom.className = 'display glow-strong title-glitch';
  titleBottom.textContent = 'DESCENT';
  titleBottom.setAttribute('data-text', 'DESCENT');
  titleBottom.setAttribute('data-glitch', '');
  titleBottom.dataset.glitchIntensity = '0.10';
  titleBottom.style.fontSize = '36px';

  const ornamentBottom = document.createElement('div');
  ornamentBottom.className = 'ornament accent-text glow';
  ornamentBottom.style.color = 'var(--text-secondary)';

  const tagline = document.createElement('p');
  tagline.className = 'tagline';
  tagline.textContent = 'DEPTH IS THE SCORE';
  tagline.dataset.testid = 'title-tagline';

  const startButton = createButton('START', {
    onClick: () => {
      branchList.classList.remove('hidden-branches');
      startButton.style.display = 'none';
    }
  });
  startButton.classList.add('btn-start', 'glow-border-strong');
  startButton.dataset.testid = 'title-start';
  cleanups.push(() => startButton.cleanup?.());

  const branchList = document.createElement('div');
  branchList.className = 'branch-list hidden-branches';
  branchList.id = 'title-branches';
  branchList.dataset.testid = 'title-branches';

  for (const [label, route, testid] of BRANCHES) {
    const button = createButton(label, {
      onClick: () => navigate(route)
    });
    button.classList.add('btn-crt');
    button.dataset.testid = testid;
    cleanups.push(() => button.cleanup?.());
    branchList.appendChild(button);
  }

  const secondaryRow = document.createElement('div');
  secondaryRow.style.display = 'flex';
  secondaryRow.style.gap = '12px';
  secondaryRow.dataset.testid = 'title-secondary-branches';
  for (const [label, route, testid, action] of SECONDARY_BRANCHES) {
    const onClick = action === 'manual' ? () => openManual('title') : () => navigate(route);
    const button = createButton(label, { onClick });
    button.classList.add('btn-crt');
    button.style.flex = '1';
    button.dataset.testid = testid;
    cleanups.push(() => button.cleanup?.());
    secondaryRow.appendChild(button);
  }
  branchList.appendChild(secondaryRow);

  const notice = document.createElement('p');
  notice.className = 'console-note';
  notice.setAttribute('aria-live', 'polite');
  notice.dataset.testid = 'title-notice';

  titleBlock.append(ornamentTop, titleTop, titleBottom, ornamentBottom, tagline);
  main.append(titleBlock, startButton, branchList);

  screen.append(header, main, notice);

  const footer = document.createElement('footer');
  footer.className = 'title-footer';
  footer.dataset.testid = 'title-footer';
  const footerVersion = document.createElement('p');
  footerVersion.textContent = 'v1.0 · BUILD · OFFLINE READY';
  const footerPrompt = document.createElement('p');
  footerPrompt.textContent = 'PRESS START TO POWER ON';
  footer.append(footerVersion, footerPrompt);
  screen.appendChild(footer);

  container.replaceChildren(screen);
}

function mountWide(container, cleanups) {
  const screen = document.createElement('section');
  screen.className = 'wide-title-screen';
  screen.dataset.wideRoot = '';
  screen.setAttribute('aria-label', 'Title screen');

  const header = document.createElement('div');
  header.className = 'wide-title-header caption glow';
  header.textContent = 'GLITCH FORGEWORKS';
  header.dataset.testid = 'title-header';

  const body = document.createElement('div');
  body.className = 'wide-title-body';

  const lockup = document.createElement('div');
  lockup.className = 'wide-title-lockup';

  const ornamentTop = document.createElement('div');
  ornamentTop.className = 'wide-title-ornament';

  const titleTop = document.createElement('h1');
  titleTop.className = 'wide-title-word glow-strong title-glitch';
  titleTop.textContent = "OPERATOR'S";
  titleTop.setAttribute('data-text', "OPERATOR'S");
  titleTop.setAttribute('data-glitch', '');
  titleTop.dataset.glitchIntensity = '0.10';

  const titleBottom = document.createElement('h1');
  titleBottom.className = 'wide-title-word glow-strong title-glitch';
  titleBottom.textContent = 'DESCENT';
  titleBottom.setAttribute('data-text', 'DESCENT');
  titleBottom.setAttribute('data-glitch', '');
  titleBottom.dataset.glitchIntensity = '0.10';

  const ornamentBottom = document.createElement('div');
  ornamentBottom.className = 'wide-title-ornament';

  const tagline = document.createElement('p');
  tagline.className = 'wide-title-tagline';
  tagline.textContent = 'DEPTH IS THE SCORE';
  tagline.dataset.testid = 'title-tagline';

  lockup.append(ornamentTop, titleTop, titleBottom, ornamentBottom, tagline);

  const startButton = createButton('START', {
    onClick: () => {
      branchList.classList.remove('hidden-branches');
      startButton.style.display = 'none';
    }
  });
  startButton.classList.add('btn-start', 'glow-border-strong');
  startButton.dataset.testid = 'title-start';
  cleanups.push(() => startButton.cleanup?.());

  const branchList = document.createElement('div');
  branchList.className = 'wide-title-branches branch-list hidden-branches';
  branchList.id = 'title-branches';
  branchList.dataset.testid = 'title-branches';

  for (const [label, route, testid] of BRANCHES) {
    const button = createButton(label, { onClick: () => navigate(route) });
    button.classList.add('btn-crt');
    button.dataset.testid = testid;
    cleanups.push(() => button.cleanup?.());
    branchList.appendChild(button);
  }

  const branchRow = document.createElement('div');
  branchRow.className = 'branch-row';
  branchRow.dataset.testid = 'title-secondary-branches';
  for (const [label, route, testid, action] of SECONDARY_BRANCHES) {
    const onClick = action === 'manual' ? () => openManual('title') : () => navigate(route);
    const button = createButton(label, { onClick });
    button.classList.add('btn-crt');
    button.dataset.testid = testid;
    cleanups.push(() => button.cleanup?.());
    branchRow.appendChild(button);
  }
  branchList.appendChild(branchRow);

  body.append(lockup, startButton, branchList);

  const notice = document.createElement('p');
  notice.className = 'console-note';
  notice.setAttribute('aria-live', 'polite');
  notice.dataset.testid = 'title-notice';

  const footer = document.createElement('footer');
  footer.className = 'wide-title-footer';
  footer.dataset.testid = 'title-footer';
  const footerVersion = document.createElement('p');
  footerVersion.textContent = 'v1.0 · BUILD · OFFLINE READY';
  const footerPrompt = document.createElement('p');
  footerPrompt.textContent = 'PRESS START TO POWER ON';
  footer.append(footerVersion, footerPrompt);

  screen.append(header, body, notice, footer);
  container.replaceChildren(screen);
}

export function mount(container) {
  const cleanups = [];
  const inputHandler = createInputHandler();
  inputHandler.bindToElement(container);
  cleanups.push(() => inputHandler.destroy());

  if (currentLayoutClass() === 'wide') mountWide(container, cleanups);
  else mountPortrait(container, cleanups);

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
