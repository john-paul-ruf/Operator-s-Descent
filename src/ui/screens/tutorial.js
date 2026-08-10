import { createButton } from '../components.js';
import { bus } from '../../state/bus.js';

const PAGES = [
  {
    title: 'Console Overview',
    body: 'The console is your interface to the system. It has seven modes, selected by tabs or keys 1-7. The console can be expanded for detail or collapsed to maximize the playfield. The status strip at the top always shows your depth, danger clock, and party status.'
  },
  {
    title: 'MOVE Mode',
    body: 'MOVE mode (1) displays an 8-directional D-pad. Use arrow keys, WASD, numpad, or QEZC for movement. Diagonal movement follows the corner rule — you can slip through gaps. Movement reveals fog-of-war and may trigger auto-stops for hostiles, containers, or descent points.'
  },
  {
    title: 'COMBAT Mode',
    body: 'COMBAT mode (2) shows available actions: Attack, Cast, Item, Retreat. Combat uses a d20 system — your attack roll + modifiers vs target Defense. Natural 20 is a critical (double damage). Natural 1 is a fumble. Each character has 2 AP per round. Turns follow initiative order.'
  },
  {
    title: 'PARTY / GEAR / TECH',
    body: 'PARTY mode (3) shows each character with attributes, HP, CHARGE, and conditions. GEAR mode (4) displays equipped items and inventory (100-item cap). TECH mode (5) shows your protocol deck — cast protocols by spending CHARGE. Overclock for enhanced effects at higher risk.'
  },
  {
    title: 'LOOT / LOG',
    body: 'LOOT mode (6) appears when a container is in line of sight. Take items individually or all at once. LOG mode (7) is a scrolling record of events — combat results, discoveries, and more. Use the copy-link button to share your log.'
  },
  {
    title: 'Status Strip & Settings',
    body: 'The status strip shows depth (D1+), danger clock (fills as you linger — when it fills, hostiles hunt you), and party sigils with mini HP bars. In combat, it shows round, active combatant, and full HP/CHARGE bars. SETTINGS adjusts audio, glitch effects, and scanlines. Your world seed is displayed in the creation screen and can be shared via #w= links.'
  }
];

export function mount(container, params) {
  let currentPage = 0;

  const wrapper = document.createElement('div');
  wrapper.className = 'tutorial-wrapper';

  const pageContainer = document.createElement('div');
  pageContainer.className = 'tutorial-page';

  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'tutorial-dots';

  function renderPage() {
    pageContainer.innerHTML = '';

    const page = PAGES[currentPage];

    const title = document.createElement('h3');
    title.className = 'tutorial-page-title';
    title.textContent = page.title;
    pageContainer.appendChild(title);

    const illustration = document.createElement('div');
    illustration.className = 'tutorial-illustration';
    illustration.textContent = `${currentPage + 1}/${PAGES.length}`;
    pageContainer.appendChild(illustration);

    const body = document.createElement('p');
    body.className = 'tutorial-body';
    body.textContent = page.body;
    pageContainer.appendChild(body);

    renderDots();

    const navRow = document.createElement('div');
    navRow.className = 'tutorial-nav';

    if (currentPage > 0) {
      navRow.appendChild(createButton('PREV', {
        onClick: () => { currentPage--; renderPage(); }
      }));
    }

    if (currentPage < PAGES.length - 1) {
      navRow.appendChild(createButton('NEXT', {
        primary: true,
        onClick: () => { currentPage++; renderPage(); }
      }));
    } else {
      navRow.appendChild(createButton('DONE', {
        primary: true,
        onClick: () => bus.dispatch('ui:navigate', { screen: 'title' })
      }));
    }

    navRow.appendChild(createButton('SKIP', {
      onClick: () => bus.dispatch('ui:navigate', { screen: 'title' })
    }));

    pageContainer.appendChild(navRow);
  }

  function renderDots() {
    dotsContainer.innerHTML = '';
    for (let i = 0; i < PAGES.length; i++) {
      const dot = document.createElement('div');
      dot.className = `tutorial-dot${i === currentPage ? ' active' : ''}`;
      dotsContainer.appendChild(dot);
    }
  }

  renderPage();
  wrapper.appendChild(pageContainer);
  wrapper.appendChild(dotsContainer);
  container.appendChild(wrapper);

  return { unmount() {} };
}
