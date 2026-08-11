import { getFlag, setFlag } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel } from '../components.js';
import { createInputHandler } from '../input.js';

const TUTORIAL_FLAG = 'tutorialDeclined';

const BRANCHES = [
  ['BEGIN NEW RUN', 'creation', 'title-begin-new-run'],
  ['RUN LIBRARY', 'library', 'title-run-library'],
  ['IMPORT LINK', 'import', 'title-import-link'],
  ['TUTORIAL', 'tutorial', 'title-tutorial'],
  ['SETTINGS', 'settings', 'title-settings']
];

function navigate(screen, params = {}) {
  bus.dispatch('ui:navigate', { screen, params });
}

function branchButton(label, screen, testid) {
  const button = createButton(label, {
    primary: screen === 'creation',
    onClick: () => navigate(screen)
  });
  button.dataset.testid = testid;
  return button;
}

export function mount(container) {
  const cleanups = [];
  const inputHandler = createInputHandler();
  inputHandler.bindToElement(container);
  cleanups.push(() => inputHandler.destroy());

  const screen = document.createElement('section');
  screen.className = 'title-screen';
  screen.setAttribute('aria-label', 'Activated title screen');

  const title = document.createElement('h1');
  title.className = 'display glow-strong';
  title.textContent = "OPERATOR'S DESCENT";
  title.setAttribute('data-glitch', '');
  title.dataset.glitchIntensity = '0.10';

  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = 'SYSTEM ACTIVATED · SELECT DESCENT PATH';

  const notice = document.createElement('p');
  notice.className = 'console-note';
  notice.setAttribute('aria-live', 'polite');
  notice.dataset.testid = 'title-notice';

  const branches = createPanel({ title: 'FRONT DOOR' });
  branches.classList.add('glow-border-strong');
  branches.dataset.testid = 'title-branches';

  if (getFlag(TUTORIAL_FLAG) !== true) {
    const offer = createPanel({ title: 'FIRST-TIME BRIEFING', elevated: true });
    offer.classList.add('tutorial-offer');
    offer.dataset.testid = 'tutorial-offer';

    const body = document.createElement('p');
    body.textContent = 'Read the console manual now, or decline once and use the dedicated Tutorial control later.';

    const tutorial = createButton('OPEN TUTORIAL', {
      primary: true,
      onClick: () => navigate('tutorial', { offered: true })
    });
    tutorial.dataset.testid = 'title-offer-tutorial';

    const decline = createButton('DECLINE TUTORIAL', {
      onClick: () => {
        const result = setFlag(TUTORIAL_FLAG, true);
        notice.textContent = result.success
          ? 'TUTORIAL OFFER SUPPRESSED'
          : `TUTORIAL DISMISSED FOR THIS SESSION — ${result.error || 'storage unavailable'}`;
        tutorial.cleanup?.();
        decline.cleanup?.();
        offer.remove();
      }
    });
    decline.dataset.testid = 'title-decline-tutorial';

    cleanups.push(() => tutorial.cleanup?.(), () => decline.cleanup?.());
    offer.append(body, tutorial, decline);
    screen.appendChild(offer);
  }

  for (const [label, route, testid] of BRANCHES) {
    const button = branchButton(label, route, testid);
    cleanups.push(() => button.cleanup?.());
    branches.appendChild(button);
  }

  screen.prepend(title, subtitle, notice);
  screen.appendChild(branches);
  container.replaceChildren(screen);

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
