import { bus } from '../../state/bus.js';
import { createButton, createMenuGroup } from '../components.js';
import { createInputHandler } from '../input.js';
import { currentLayoutClass } from '../layout.js';

// icon-first-ui-density SESSION-06 — branch rows are icon+text per GAP §3.10.
// aria-label preserves the former visible label verbatim (ornament included)
// so getByRole(name:)/getByLabel e2e (title-start-toggle, manual.spec,
// keyboard-flow) continue to resolve without spec edits. Visible label drops
// the ornament: the sprite icon now carries the visual accent.
const BRANCHES = [
  { id: 'begin-new-run', label: 'BEGIN NEW RUN', route: 'creation', testid: 'title-begin-new-run', icon: 'chevron-right', ariaLabel: '◈ BEGIN NEW RUN', iconTone: 'accent' },
  { id: 'run-library', label: 'RUN LIBRARY', route: 'library', testid: 'title-run-library', icon: 'archive', ariaLabel: '◈ RUN LIBRARY' },
  { id: 'import-link', label: 'IMPORT LINK', route: 'import', testid: 'title-import-link', icon: 'download', ariaLabel: '◈ IMPORT LINK' }
];

// the-manual SESSION-04 — TUTORIAL branch retired; MANUAL opens the modal.
// Distinguished from SETTINGS by `action: 'manual'` vs the default navigate.
// GAP §3.10 sanctioned fallback keeps `gauge` for SETTINGS; the icon collides
// visually with the wide-dock `Depth` label but no better id lives in the
// M107 subset (`sliders`/`settings2` not present in lucide@^0.400.0).
const SECONDARY_BRANCHES = [
  { id: 'manual', label: 'MANUAL', route: 'manual', testid: 'title-manual', action: 'manual', icon: 'scroll-text', ariaLabel: 'MANUAL' },
  { id: 'settings', label: 'SETTINGS', route: 'settings', testid: 'title-settings', icon: 'gauge', ariaLabel: 'SETTINGS' }
];

function navigate(screen, params = {}) {
  bus.dispatch('ui:navigate', { screen, params });
}

function openManual(source) {
  bus.dispatch('ui:manual-open', { target: null, source });
}

// Local reveal/reset for the title's START ↔ branches toggle. Both the START
// click handler and the ui:manual-close listener drive the same two DOM nodes,
// so the reveal and reset live here instead of being duplicated inline in each
// layout builder.
function revealBranches(startButton, branchList) {
  if (!startButton || !branchList) return;
  branchList.classList.remove('hidden-branches');
  startButton.style.display = 'none';
  startButton.setAttribute('aria-expanded', 'true');
  branchList.children[0]?.focus?.();
}

function resetToStart(startButton, branchList) {
  if (!startButton || !branchList) return;
  branchList.classList.add('hidden-branches');
  startButton.style.display = '';
  startButton.setAttribute('aria-expanded', 'false');
  // The modal restores its invoker (typically the MANUAL branch) BEFORE
  // dispatching ui:manual-close, so focus lands on a now-hidden control unless
  // this listener pulls it back to the freshly visible START.
  startButton.focus?.();
}

function renderBranchGroup({ containerClass, rowClass, rowStyle, testid }) {
  const primary = createMenuGroup(BRANCHES, {
    className: containerClass,
    testid: 'title-branches',
    actionOptions: { className: 'btn-crt' },
    itemOptions: (branch) => ({
      ariaLabel: branch.ariaLabel,
      icon: branch.icon,
      iconSize: 16,
      iconTone: branch.iconTone,
      onClick: () => navigate(branch.route)
    })
  });
  primary.id = 'title-branches';

  const secondary = createMenuGroup(SECONDARY_BRANCHES, {
    className: rowClass,
    testid,
    actionOptions: { className: 'btn-crt' },
    itemOptions: (branch) => ({
      ariaLabel: branch.ariaLabel,
      icon: branch.icon,
      iconSize: 16,
      style: rowStyle,
      onClick: branch.action === 'manual' ? () => openManual('title') : () => navigate(branch.route)
    })
  });
  if (rowStyle) for (const button of secondary.actions) Object.assign(button.style, rowStyle);
  primary.appendChild(secondary);
  return { branchList: primary, cleanup: () => primary.cleanup?.() };
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
    onClick: () => revealBranches(startButton, branchList)
  });
  startButton.classList.add('btn-start', 'glow-border-strong');
  startButton.dataset.testid = 'title-start';
  startButton.setAttribute('aria-controls', 'title-branches');
  startButton.setAttribute('aria-expanded', 'false');
  cleanups.push(() => startButton.cleanup?.());

  const { branchList, cleanup } = renderBranchGroup({
    containerClass: 'branch-list hidden-branches',
    rowClass: 'title-secondary-branches',
    rowStyle: { display: 'flex', gap: '12px' },
    testid: 'title-secondary-branches'
  });
  cleanups.push(cleanup);

  cleanups.push(bus.on('ui:manual-close', () => resetToStart(startButton, branchList)));

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
    onClick: () => revealBranches(startButton, branchList)
  });
  startButton.classList.add('btn-start', 'glow-border-strong');
  startButton.dataset.testid = 'title-start';
  startButton.setAttribute('aria-controls', 'title-branches');
  startButton.setAttribute('aria-expanded', 'false');
  cleanups.push(() => startButton.cleanup?.());

  const { branchList, cleanup } = renderBranchGroup({
    containerClass: 'wide-title-branches branch-list hidden-branches',
    rowClass: 'branch-row',
    testid: 'title-secondary-branches'
  });
  cleanups.push(cleanup);

  cleanups.push(bus.on('ui:manual-close', () => resetToStart(startButton, branchList)));

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
