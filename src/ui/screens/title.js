import { getFlag, setFlag } from '../../state/library.js';
import { createButton } from '../components.js';
import { createInputHandler } from '../input.js';
import { bus } from '../../state/bus.js';

export function mount(container) {
  const inputHandler = createInputHandler();
  inputHandler.bindToElement(container);

  const title = document.createElement('h1');
  title.className = 'display glow-strong';
  title.textContent = "OPERATOR'S DESCENT";
  title.setAttribute('data-glitch', '');
  title.dataset.glitchIntensity = '0.10';
  container.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'subtitle';
  subtitle.textContent = 'GLITCH FORGEWORKS LLC';
  container.appendChild(subtitle);

  const branchContainer = document.createElement('div');
  branchContainer.className = 'panel';

  if (!getFlag('tutorialDeclined')) {
    const tutorialRow = document.createElement('div');
    tutorialRow.className = 'branch-row';
    tutorialRow.appendChild(createButton('TUTORIAL', {
      onClick: () => bus.dispatch('ui:navigate', { screen: 'tutorial' })
    }));
    tutorialRow.appendChild(createButton('SKIP', {
      onClick: () => {
        setFlag('tutorialDeclined', true);
        tutorialRow.remove();
      }
    }));
    branchContainer.appendChild(tutorialRow);
  }

  branchContainer.appendChild(createButton('BEGIN NEW RUN', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'creation' })
  }));
  branchContainer.appendChild(createButton('RUN LIBRARY', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'library' })
  }));
  branchContainer.appendChild(createButton('IMPORT LINK', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'import' })
  }));
  branchContainer.appendChild(createButton('TUTORIAL', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'tutorial' })
  }));
  branchContainer.appendChild(createButton('SETTINGS', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'settings' })
  }));
  container.appendChild(branchContainer);
  bus.dispatch('ui:audio-start');

  return {
    unmount() {
      inputHandler?.onAction?.(() => {});
    }
  };
}
