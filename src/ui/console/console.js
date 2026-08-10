import { bus } from '../../state/bus.js';
import * as moveMode from './move.js';
import * as combatMode from './combat.js';
import * as partyMode from './party.js';
import * as gearMode from './gear.js';
import * as techMode from './tech.js';
import * as lootMode from './loot.js';
import * as logMode from './log.js';

const MODES = [
  { id: 'move', label: 'MOVE', module: moveMode },
  { id: 'combat', label: 'CMBT', module: combatMode },
  { id: 'party', label: 'PARTY', module: partyMode },
  { id: 'gear', label: 'GEAR', module: gearMode },
  { id: 'tech', label: 'TECH', module: techMode },
  { id: 'loot', label: 'LOOT', module: lootMode },
  { id: 'log', label: 'LOG', module: logMode }
];

export function createConsole(state) {
  const container = document.createElement('div');
  container.className = 'console-bar';
  let currentMode = 'move';
  let expanded = false;

  const tabBar = document.createElement('div');
  tabBar.className = 'console-tab-bar';

  const contentArea = document.createElement('div');
  contentArea.className = 'console-content';

  const modeTabs = MODES.map((mode, i) => {
    const tab = document.createElement('button');
    tab.className = 'mode-tab';
    tab.textContent = mode.label;
    tab.addEventListener('click', () => setMode(mode.id));
    tab.title = `Key ${i + 1}`;
    return { tab, mode };
  });

  function setMode(modeId) {
    currentMode = modeId;
    modeTabs.forEach(({ tab, mode }) => {
      tab.classList.toggle('active', mode.id === modeId);
    });
    renderCurrentMode();
    bus.dispatch('ui:mode-change', { mode: modeId });
  }

  function renderCurrentMode() {
    const mode = MODES.find(m => m.id === currentMode);
    if (!mode) return;
    contentArea.innerHTML = '';
    mode.module.render(contentArea, createModeContext());
  }

  function createModeContext() {
    return { ...state, bus, refresh: renderCurrentMode };
  }

  function expand() {
    expanded = true;
    container.classList.add('expanded');
    bus.dispatch('ui:console-expand');
  }

  function collapse() {
    expanded = false;
    container.classList.remove('expanded');
    bus.dispatch('ui:console-collapse');
  }

  function refresh() {
    renderCurrentMode();
  }

  function render() {
    tabBar.innerHTML = '';
    modeTabs.forEach(({ tab }) => tabBar.appendChild(tab));
    container.appendChild(tabBar);
    container.appendChild(contentArea);
    setMode('move');
    return container;
  }

  if (state?.inputHandler) {
    state.inputHandler.onAction((action) => {
      const mode = MODES.find(item => item.id === currentMode);
      mode?.module.handleInput?.({ action }, createModeContext());
      const match = action.match(/^mode-(\d)$/);
      if (match) {
        const idx = parseInt(match[1]) - 1;
        if (idx >= 0 && idx < MODES.length) setMode(MODES[idx].id);
      }
      if (action === 'cancel') collapse();
    });
  }

  return { setMode, expand, collapse, refresh, render, container, get currentMode() { return currentMode; } };
}
