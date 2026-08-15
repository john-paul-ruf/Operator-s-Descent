import { setFlag } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createButton, createScreenBody } from '../components.js';
import { currentLayoutClass } from '../layout.js';

const TUTORIAL_FLAG = 'tutorialDeclined';

const PAGES = [
  {
    title: 'Console Overview',
    body: 'Every meaningful action routes through the single bottom console. Tabs 1-7 select modes; the panel expands for detail and collapses to keep the playfield visible.',
    tokens: ['MOVE', 'COMBAT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG'],
    illustration: 'tabs'
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
    tokens: ['ACTION', 'TARGET', 'CONFIRM', 'ROLL', 'END'],
    illustration: 'grid'
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

function buildIllustration(page, indexLabel, indexTestId) {
  const illustration = document.createElement('div');
  illustration.className = 'tutorial-illustration';
  illustration.setAttribute('aria-label', `${page.title} diagram`);
  if (indexLabel) {
    const index = document.createElement('span');
    index.className = 'tutorial-page-index';
    if (indexTestId) index.dataset.testid = indexTestId;
    index.textContent = indexLabel;
    illustration.appendChild(index);
  }
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
  } else if (page.illustration === 'tabs') {
    const tabs = document.createElement('div');
    tabs.className = 'illus-tabs';
    for (let i = 0; i < page.tokens.length; i++) {
      const tab = document.createElement('div');
      tab.className = i === 0 ? 'illus-tab active' : 'illus-tab';
      tab.textContent = page.tokens[i];
      tabs.appendChild(tab);
    }
    illustration.appendChild(tabs);
  } else if (page.illustration === 'grid') {
    const grid = document.createElement('div');
    grid.className = 'illus-grid';
    const layout = [
      ['wall', '', '', 'enemy', '', 'wall'],
      ['wall', '', '', '', '', 'wall'],
      ['', '', '', '', '', ''],
      ['', '', 'player', '', 'player', '']
    ];
    for (const row of layout) {
      for (const cellType of row) {
        const cell = document.createElement('div');
        if (cellType) cell.className = cellType;
        if (cellType === 'player') cell.textContent = 'B';
        if (cellType === 'enemy') cell.textContent = 'D';
        grid.appendChild(cell);
      }
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
  return illustration;
}

function mountPortrait(container, cleanups) {
  let currentPage = 0;
  const pageCleanups = [];

  const wrapper = document.createElement('section');
  wrapper.className = 'tutorial-wrapper screen-container';
  wrapper.style.padding = '0';
  wrapper.style.gap = '0';
  wrapper.setAttribute('aria-label', 'Operator manual');

  const header = document.createElement('header');
  header.className = 'panel-elevated s-3';
  header.style.textAlign = 'center';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'micro';
  eyebrow.textContent = "◈ OPERATOR'S MANUAL";
  const headerTitle = document.createElement('div');
  headerTitle.className = 'subheading accent-text glow';
  header.append(eyebrow, headerTitle);

  const status = document.createElement('p');
  status.className = 'console-note';
  status.setAttribute('aria-live', 'polite');
  status.dataset.testid = 'tutorial-status';

  const bodyContainer = createScreenBody({ className: 's-4' });

  const pageContainer = document.createElement('article');
  pageContainer.className = 'tutorial-page';
  pageContainer.dataset.testid = 'tutorial-page';

  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'tutorial-dots';
  dotsContainer.setAttribute('aria-label', 'Tutorial progress');

  const footer = document.createElement('footer');
  footer.className = 'panel s-3';
  const navContainer = document.createElement('nav');
  navContainer.className = 'tutorial-nav';
  navContainer.setAttribute('aria-label', 'Tutorial navigation');

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
    navContainer.replaceChildren();
    const page = PAGES[currentPage];
    headerTitle.textContent = page.title.toUpperCase();

    const title = document.createElement('h3');
    title.className = 'tutorial-page-title';
    title.dataset.testid = 'tutorial-page-title';
    title.textContent = page.title;

    const illustration = buildIllustration(page, `${currentPage + 1}/${PAGES.length}`, 'tutorial-page-index');

    const body = document.createElement('p');
    body.className = 'tutorial-body';
    body.textContent = page.body;

    if (currentPage > 0) {
      const prev = track(createButton('PREV', {
        onClick: () => {
          currentPage -= 1;
          renderPage();
        }
      }));
      prev.dataset.testid = 'tutorial-prev';
      navContainer.appendChild(prev);
    }

    if (currentPage < PAGES.length - 1) {
      const next = track(createButton('NEXT', {
        primary: true,
        onClick: () => {
          currentPage += 1;
          renderPage();
        }
      }));
      next.classList.remove('btn-primary');
      next.dataset.testid = 'tutorial-next';
      navContainer.appendChild(next);
    } else {
      const done = track(createButton('DONE', {
        primary: true,
        onClick: () => finish(true)
      }));
      done.classList.remove('btn-primary');
      done.dataset.testid = 'tutorial-done';
      navContainer.appendChild(done);
    }

    const skip = track(createButton('SKIP / BACK TO TITLE', {
      onClick: () => finish(false)
    }));
    skip.dataset.testid = 'tutorial-skip';
    navContainer.appendChild(skip);

    pageContainer.append(title, illustration, body);
    renderDots();
  }

  renderPage();
  bodyContainer.append(status, pageContainer);
  footer.append(dotsContainer, navContainer);
  wrapper.append(header, bodyContainer, footer);
  container.replaceChildren(wrapper);

  cleanups.push(() => {
    while (pageCleanups.length) pageCleanups.pop()?.();
  });
}

function buildSpreads() {
  // Pair up all production pages (1|2)(3|4)... ; last pair may have null right.
  // After the last content pair, append a summary-card state (owner decision).
  const spreads = [];
  for (let i = 0; i < PAGES.length; i += 2) {
    spreads.push({
      leftIndex: i,
      rightIndex: i + 1 < PAGES.length ? i + 1 : null,
      isSummary: false
    });
  }
  spreads.push({
    leftIndex: PAGES.length - 1,
    rightIndex: null,
    isSummary: true
  });
  return spreads;
}

function mountWide(container, cleanups) {
  const spreads = buildSpreads();
  let currentSpread = 0;
  const pageCleanups = [];

  const shell = document.createElement('section');
  shell.className = 'tutorial-wrapper wide-tutorial-shell';
  shell.dataset.wideRoot = '';
  shell.setAttribute('aria-label', 'Operator manual');

  const header = document.createElement('header');
  header.className = 'panel-elevated wide-tutorial-header';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'micro';
  eyebrow.textContent = "◈ OPERATOR'S MANUAL";
  const headerTitle = document.createElement('div');
  headerTitle.className = 'subheading accent-text glow-strong';
  headerTitle.dataset.testid = 'tutorial-spread-title';
  header.append(eyebrow, headerTitle);

  const status = document.createElement('p');
  status.className = 'console-note';
  status.setAttribute('aria-live', 'polite');
  status.dataset.testid = 'tutorial-status';

  const spread = document.createElement('div');
  spread.className = 'wide-tutorial-spread';
  spread.dataset.testid = 'tutorial-spread';

  const leftPane = document.createElement('article');
  leftPane.className = 'wide-tutorial-pane';
  leftPane.dataset.testid = 'tutorial-page';
  const leftHeader = document.createElement('div');
  leftHeader.className = 'wide-tutorial-pane-header';
  const leftBody = document.createElement('div');
  leftBody.className = 'wide-tutorial-pane-body';
  leftPane.append(leftHeader, leftBody);

  const rightPane = document.createElement('article');
  rightPane.className = 'wide-tutorial-pane';
  rightPane.dataset.testid = 'tutorial-right-pane';
  const rightHeader = document.createElement('div');
  rightHeader.className = 'wide-tutorial-pane-header';
  const rightBody = document.createElement('div');
  rightBody.className = 'wide-tutorial-pane-body';
  rightPane.append(rightHeader, rightBody);

  spread.append(leftPane, rightPane);

  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'tutorial-dots';
  dotsContainer.setAttribute('aria-label', 'Tutorial progress');

  const navContainer = document.createElement('nav');
  navContainer.className = 'tutorial-nav';
  navContainer.setAttribute('aria-label', 'Tutorial navigation');

  const footer = document.createElement('footer');
  footer.className = 'panel wide-tutorial-footer';
  footer.append(dotsContainer, navContainer);

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
    // One dot per content spread (last spread is summary — no dot for it).
    const contentSpreadCount = spreads.length - 1;
    const activeIdx = spreads[currentSpread].isSummary ? contentSpreadCount - 1 : currentSpread;
    for (let index = 0; index < contentSpreadCount; index += 1) {
      const dot = document.createElement('span');
      dot.className = `tutorial-dot${index === activeIdx ? ' active' : ''}`;
      // Label with the leftmost page number of that spread (matches spec "dots track the leftmost page").
      dot.textContent = String(index * 2 + 1);
      dot.setAttribute('aria-current', index === activeIdx ? 'step' : 'false');
      dotsContainer.appendChild(dot);
    }
  }

  function renderPageContent(bodyEl, headerEl, pageIndex, isPrimary) {
    bodyEl.replaceChildren();
    if (pageIndex == null) {
      headerEl.textContent = '';
      return;
    }
    const page = PAGES[pageIndex];
    headerEl.textContent = `◈ PAGE ${pageIndex + 1} — ${page.title.toUpperCase()}`;

    const title = document.createElement('h3');
    title.className = 'tutorial-page-title';
    if (isPrimary) title.dataset.testid = 'tutorial-page-title';
    title.textContent = page.title;

    const indexLabel = `${pageIndex + 1}/${PAGES.length}`;
    const illustration = buildIllustration(page, indexLabel, isPrimary ? 'tutorial-page-index' : null);

    const body = document.createElement('p');
    body.className = 'tutorial-body copy';
    body.textContent = page.body;

    bodyEl.append(title, illustration, body);
  }

  function renderSummaryPane(bodyEl, headerEl) {
    bodyEl.replaceChildren();
    headerEl.textContent = '◈ RETURN TO TITLE';
    const wrap = document.createElement('div');
    wrap.className = 'wide-tutorial-summary';
    wrap.dataset.testid = 'tutorial-summary';
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = '◈ ◈ ◈';
    const headline = document.createElement('div');
    headline.className = 'headline';
    headline.textContent = 'READY TO DESCEND';
    const copy = document.createElement('p');
    copy.className = 'copy';
    copy.textContent = "You've seen the console, the modes, the loop. Return to the title screen and press BEGIN NEW RUN when you're ready.";
    wrap.append(badge, headline, copy);
    bodyEl.appendChild(wrap);
  }

  function renderSpread() {
    while (pageCleanups.length) pageCleanups.pop()?.();
    navContainer.replaceChildren();
    const spec = spreads[currentSpread];

    if (spec.isSummary) {
      renderPageContent(leftBody, leftHeader, spec.leftIndex, true);
      renderSummaryPane(rightBody, rightHeader);
      headerTitle.textContent = 'READY TO DESCEND';
    } else {
      renderPageContent(leftBody, leftHeader, spec.leftIndex, true);
      renderPageContent(rightBody, rightHeader, spec.rightIndex, false);
      const leftPage = PAGES[spec.leftIndex];
      const rightPage = spec.rightIndex != null ? PAGES[spec.rightIndex] : null;
      headerTitle.textContent = rightPage
        ? `${leftPage.title.toUpperCase()} · ${rightPage.title.toUpperCase()}`
        : leftPage.title.toUpperCase();
    }

    // Nav buttons — same testids as portrait so tests can traverse identically.
    if (currentSpread > 0) {
      const prev = track(createButton('◀ PREV', {
        onClick: () => {
          currentSpread -= 1;
          renderSpread();
        }
      }));
      prev.dataset.testid = 'tutorial-prev';
      navContainer.appendChild(prev);
    }

    if (currentSpread < spreads.length - 1) {
      const next = track(createButton('NEXT ▶', {
        primary: true,
        onClick: () => {
          currentSpread += 1;
          renderSpread();
        }
      }));
      next.classList.remove('btn-primary');
      next.dataset.testid = 'tutorial-next';
      navContainer.appendChild(next);
    } else {
      const done = track(createButton('◈ DONE', {
        primary: true,
        onClick: () => finish(true)
      }));
      done.classList.remove('btn-primary');
      done.dataset.testid = 'tutorial-done';
      navContainer.appendChild(done);
    }

    const skip = track(createButton('SKIP / BACK TO TITLE', {
      onClick: () => finish(false)
    }));
    skip.dataset.testid = 'tutorial-skip';
    navContainer.appendChild(skip);

    renderDots();
  }

  renderSpread();
  shell.append(header, status, spread, footer);
  container.replaceChildren(shell);

  cleanups.push(() => {
    while (pageCleanups.length) pageCleanups.pop()?.();
  });
}

export function mount(container) {
  const cleanups = [];
  if (currentLayoutClass() === 'wide') mountWide(container, cleanups);
  else mountPortrait(container, cleanups);

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
