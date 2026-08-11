import { setFlag } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createButton } from '../components.js';

const TUTORIAL_FLAG = 'tutorialDeclined';

const PAGES = [
  {
    title: 'Console Overview',
    body: 'Every meaningful action routes through the single bottom console. Tabs 1-7 select modes; the panel expands for detail and collapses to keep the playfield visible.',
    tokens: ['MOVE', 'COMBAT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG']
  },
  {
    title: 'MOVE Mode',
    body: 'MOVE owns exploration input. Use the directional controls or movement keys for eight-way steps. Hostiles always stop movement; container, descent, and damage stops are shown as console decisions.',
    tokens: ['NW', 'N', 'NE', 'W', 'WAIT', 'E', 'SW', 'S', 'SE'],
    illustration: 'dpad'
  },
  {
    title: 'COMBAT Mode',
    body: 'COMBAT presents one actor turn at a time: choose an action, choose a target or path, then confirm. Turns follow initiative, AP, movement, reactions, and d20 outcomes.',
    tokens: ['ACTION', 'TARGET', 'CONFIRM', 'ROLL', 'END']
  },
  {
    title: 'PARTY Mode',
    body: 'PARTY is the read-only roster: HP, CHARGE, attributes, defenses, conditions, calibration, corruption, equipment, protocol deck, and current combat resources.',
    tokens: ['HP', 'CHARGE', 'ATTR', 'COND', 'DECK']
  },
  {
    title: 'GEAR Mode',
    body: 'GEAR handles equipment, inventory, junk tags, scrap, class gates, slot gates, and CORRUPT consent. In combat, the active actor gets one free swap per turn.',
    tokens: ['WEAPON', 'ARMOR', 'OFFHAND', 'JUNK', 'SCRAP']
  },
  {
    title: 'TECH Mode',
    body: 'TECH shows each prepared protocol, CHARGE cost, target shape, and overclock risk. Select a protocol, choose a legal target, then confirm before CHARGE or RNG is consumed.',
    tokens: ['CAST', 'OVERCLK', 'TIER', 'DC', 'RISK']
  },
  {
    title: 'LOOT Mode',
    body: 'LOOT opens nearby containers. Items remain in the container until taken, inventory cap failures do not delete them, and CORRUPT items remain explicit decisions.',
    tokens: ['OPEN', 'TAKE', 'COMPARE', 'CAP 100', 'CORRUPT']
  },
  {
    title: 'LOG Mode',
    body: 'LOG keeps the ordered recent event tail: discoveries, damage, d20 rolls, combat outcomes, and link actions. Living runs can copy a full #r= state link.',
    tokens: ['EVENTS', 'ROLLS', '#r=', 'COPY']
  },
  {
    title: 'Status Strip',
    body: 'The top strip is the compact truth readout. Exploration shows depth, seed, party HP, corruption, and danger clock. Combat shows round, initiative, active HP, CHARGE, AP, and move.',
    tokens: ['DEPTH', 'SEED', 'HP', 'CLOCK', 'AP']
  },
  {
    title: 'Settings',
    body: 'Settings are reachable from the title and in play. Master mute, five audio layers, glitch, motion policy, and scanline/grain are the complete v1 list.',
    tokens: ['MUTE', 'DRONE', 'PULSE', 'GLITCH', 'MOTION']
  },
  {
    title: 'Seed & Share Links',
    body: 'The world seed identifies the dungeon. Copy #w= to share the world, or #r= while the party lives to share the entire current run state. Failed links name the reason.',
    tokens: ['SEED', '#w=', '#r=', 'IMPORT', 'FAILURE']
  }
];

function navigateTitle(params = {}) {
  bus.dispatch('ui:navigate', { screen: 'title', params });
}

function suppressTutorial() {
  return setFlag(TUTORIAL_FLAG, true);
}

export function mount(container) {
  let currentPage = 0;
  let pageCleanups = [];
  const cleanups = [];

  const wrapper = document.createElement('section');
  wrapper.className = 'tutorial-wrapper';
  wrapper.setAttribute('aria-label', 'Operator manual');

  const header = document.createElement('h2');
  header.className = 'display';
  header.textContent = 'OPERATOR MANUAL';

  const status = document.createElement('p');
  status.className = 'console-note';
  status.setAttribute('aria-live', 'polite');
  status.dataset.testid = 'tutorial-status';

  const pageContainer = document.createElement('article');
  pageContainer.className = 'tutorial-page';
  pageContainer.dataset.testid = 'tutorial-page';

  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'tutorial-dots';
  dotsContainer.setAttribute('aria-label', 'Tutorial progress');

  function track(element) {
    pageCleanups.push(() => element.cleanup?.());
    return element;
  }

  function finish(completed) {
    const result = suppressTutorial();
    status.textContent = result.success
      ? (completed ? 'MANUAL COMPLETE — OFFER SUPPRESSED' : 'MANUAL SKIPPED — OFFER SUPPRESSED')
      : `MANUAL CLOSED — ${result.error || 'storage unavailable'}`;
    navigateTitle({ tutorialCompleted: completed });
  }

  function renderDots() {
    dotsContainer.replaceChildren();
    for (let index = 0; index < PAGES.length; index += 1) {
      const dot = document.createElement('span');
      dot.className = `tutorial-dot${index === currentPage ? ' active' : ''}`;
      dot.textContent = String(index + 1);
      dot.setAttribute('aria-current', index === currentPage ? 'step' : 'false');
      dotsContainer.appendChild(dot);
    }
  }

  function renderPage() {
    while (pageCleanups.length) pageCleanups.pop()?.();
    pageContainer.replaceChildren();
    const page = PAGES[currentPage];

    const title = document.createElement('h3');
    title.className = 'tutorial-page-title';
    title.dataset.testid = 'tutorial-page-title';
    title.textContent = page.title;

    const illustration = document.createElement('div');
    illustration.className = 'tutorial-illustration';
    illustration.setAttribute('aria-label', `${page.title} diagram`);
    const index = document.createElement('span');
    index.className = 'tutorial-page-index';
    index.dataset.testid = 'tutorial-page-index';
    index.textContent = `${currentPage + 1}/${PAGES.length}`;
    illustration.appendChild(index);
    if (page.illustration === 'dpad' && page.tokens.length === 9) {
      const grid = document.createElement('div');
      grid.className = 'illus-dpad';
      for (let i = 0; i < page.tokens.length; i++) {
        const cell = document.createElement('div');
        cell.textContent = page.tokens[i];
        if (i === 4) cell.className = 'dpad-center';
        grid.appendChild(cell);
      }
      illustration.appendChild(grid);
    } else {
      for (const token of page.tokens) {
        const chip = document.createElement('span');
        chip.className = 'tutorial-chip';
        chip.textContent = token;
        illustration.appendChild(chip);
      }
    }

    const body = document.createElement('p');
    body.className = 'tutorial-body';
    body.textContent = page.body;

    const navRow = document.createElement('nav');
    navRow.className = 'tutorial-nav';
    navRow.setAttribute('aria-label', 'Tutorial navigation');

    if (currentPage > 0) {
      const prev = track(createButton('PREV', {
        onClick: () => {
          currentPage -= 1;
          renderPage();
        }
      }));
      prev.dataset.testid = 'tutorial-prev';
      navRow.appendChild(prev);
    }

    if (currentPage < PAGES.length - 1) {
      const next = track(createButton('NEXT', {
        primary: true,
        onClick: () => {
          currentPage += 1;
          renderPage();
        }
      }));
      next.dataset.testid = 'tutorial-next';
      navRow.appendChild(next);
    } else {
      const done = track(createButton('DONE', {
        primary: true,
        onClick: () => finish(true)
      }));
      done.dataset.testid = 'tutorial-done';
      navRow.appendChild(done);
    }

    const skip = track(createButton('SKIP / BACK TO TITLE', {
      onClick: () => finish(false)
    }));
    skip.dataset.testid = 'tutorial-skip';
    navRow.appendChild(skip);

    pageContainer.append(title, illustration, body, navRow);
    renderDots();
  }

  renderPage();
  wrapper.append(header, status, pageContainer, dotsContainer);
  container.replaceChildren(wrapper);

  cleanups.push(() => {
    while (pageCleanups.length) pageCleanups.pop()?.();
  });

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
