import { bus } from '../../state/bus.js';
import * as moveMode from './move.js';
import * as combatMode from './combat.js';
import * as partyMode from './party.js';
import * as gearMode from './gear.js';
import * as techMode from './tech.js';
import * as lootMode from './loot.js';
import * as logMode from './log.js';

export const CONSOLE_INTENTS = Object.freeze({
  expand: 'console:expand',
  collapse: 'console:collapse',
  modeChange: 'console:mode-change',
  unavailable: 'console:unavailable'
});

const MODE_MODULES = { move: moveMode, combat: combatMode, party: partyMode, gear: gearMode, tech: techMode, loot: lootMode, log: logMode };

export const MODE_REGISTRY = [
  { id: 'move', label: 'MOVE', key: 'mode_1', module: moveMode, available: (state) => !state.combatState, reason: 'Only available while exploring.' },
  { id: 'combat', label: 'COMBAT', key: 'mode_2', module: combatMode, available: (state) => Boolean(state.combatState), reason: 'No active combat.' },
  { id: 'party', label: 'PARTY', key: 'mode_3', module: partyMode, available: (state) => Boolean(state.runState?.party?.length), reason: 'No party.' },
  { id: 'gear', label: 'GEAR', key: 'mode_4', module: gearMode, available: (state) => Boolean(state.runState), reason: 'No run data.' },
  { id: 'tech', label: 'TECH', key: 'mode_5', module: techMode, available: (state) => Boolean(state.runState?.party?.length), reason: 'No protocol deck.' },
  { id: 'loot', label: 'LOOT', key: 'mode_6', module: lootMode, available: (state) => Boolean(state.lootState || state.canLoot?.()), reason: 'No unopened nearby container.' },
  { id: 'log', label: 'LOG', key: 'mode_7', module: logMode, available: () => true, reason: '' }
];

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  element.innerHTML = '';
}

function modeById(id) {
  return MODE_REGISTRY.find((mode) => mode.id === id) || MODE_REGISTRY[0];
}

function firstAvailableMode(state, preferred = 'move') {
  const preferredMode = modeById(preferred);
  if (preferredMode.available(state)) return preferredMode.id;
  return MODE_REGISTRY.find((mode) => mode.available(state))?.id || 'log';
}

function normalizeConsoleAction(action) {
  if (/^mode_[1-7]$/.test(action)) return action;
  const legacy = action.match(/^mode-(\d)$/);
  return legacy ? `mode_${legacy[1]}` : action;
}

export function createConsole(state) {
  const container = document.createElement('section');
  container.className = 'console-bar collapsed';
  container.setAttribute('aria-label', 'Command console');
  const dimLayer = document.createElement('div');
  dimLayer.className = 'console-dim-layer';
  dimLayer.setAttribute('aria-hidden', 'true');
  const tabBar = document.createElement('div');
  tabBar.className = 'console-tab-bar';
  tabBar.setAttribute('role', 'tablist');
  const contentArea = document.createElement('div');
  contentArea.className = 'console-content';
  contentArea.setAttribute('role', 'tabpanel');
  contentArea.tabIndex = -1;
  const notice = document.createElement('div');
  notice.className = 'console-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');

  let currentMode = firstAvailableMode(state);
  let expanded = false;
  let mountedCleanup = null;
  let inputCleanup = null;
  let rendered = false;

  const modeTabs = MODE_REGISTRY.map((mode, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'mode-tab console-row';
    tab.textContent = mode.label;
    tab.id = `console-tab-${mode.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'console-content');
    tab.title = `Key ${index + 1}`;
    tab.dataset.testid = `console-tab-${mode.id}`;
    tab.addEventListener('click', () => setMode(mode.id, { source: 'touch' }));
    return { tab, mode };
  });

  function createModeContext() {
    return { ...state, bus, refresh: renderCurrentMode, expanded, console: api };
  }

  function setNotice(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }

  function updateTabs() {
    for (const { tab, mode } of modeTabs) {
      const active = mode.id === currentMode;
      const available = mode.available(state);
      tab.classList.toggle('active', active);
      tab.disabled = !available;
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('aria-disabled', String(!available));
      tab.title = available ? `${mode.label} · ${mode.key.replace('mode_', 'Key ')}` : mode.reason;
    }
  }

  function destroyMountedMode() {
    mountedCleanup?.();
    mountedCleanup = null;
    for (const child of [...contentArea.children]) child.cleanup?.();
    clearChildren(contentArea);
  }

  function renderCurrentMode() {
    destroyMountedMode();
    const mode = modeById(currentMode);
    const result = mode.module.render?.(contentArea, createModeContext());
    mountedCleanup = typeof result === 'function' ? result : result?.cleanup || null;
    contentArea.id = 'console-content';
    contentArea.setAttribute('aria-labelledby', `console-tab-${mode.id}`);
    contentArea.focus?.({ preventScroll: true });
  }

  function setMode(modeId, options = {}) {
    const mode = modeById(modeId);
    if (!mode.available(state)) {
      setNotice(mode.reason);
      bus.dispatch(CONSOLE_INTENTS.unavailable, { mode: mode.id, reason: mode.reason, source: options.source || 'program' });
      return false;
    }
    if (currentMode === mode.id && rendered) return true;
    currentMode = mode.id;
    setNotice('');
    updateTabs();
    renderCurrentMode();
    bus.dispatch('ui:mode-change', { mode: mode.id });
    bus.dispatch(CONSOLE_INTENTS.modeChange, { mode: mode.id, source: options.source || 'program' });
    return true;
  }

  function expand() {
    if (expanded) return;
    expanded = true;
    container.classList.remove('collapsed');
    container.classList.add('expanded');
    bus.dispatch('ui:console-expand');
    bus.dispatch(CONSOLE_INTENTS.expand, { mode: currentMode });
    bus.dispatch('ui:camera-request', { reason: 'console-expand', mode: currentMode });
  }

  function collapse() {
    if (!expanded) return;
    expanded = false;
    container.classList.remove('expanded');
    container.classList.add('collapsed');
    bus.dispatch('ui:console-collapse');
    bus.dispatch(CONSOLE_INTENTS.collapse, { mode: currentMode });
  }

  function handleInput(action, details = {}) {
    const normalized = normalizeConsoleAction(action);
    const modeKey = normalized.match(/^mode_(\d)$/);
    if (modeKey) return setMode(MODE_REGISTRY[Number(modeKey[1]) - 1]?.id, { source: details.source || 'keyboard' });
    if (normalized === 'tab_next') {
      const start = MODE_REGISTRY.findIndex((mode) => mode.id === currentMode);
      for (let offset = 1; offset <= MODE_REGISTRY.length; offset++) {
        const mode = MODE_REGISTRY[(start + offset) % MODE_REGISTRY.length];
        if (mode.available(state)) return setMode(mode.id, { source: details.source || 'keyboard' });
      }
    }
    if (normalized === 'cancel') { collapse(); return true; }
    const mode = modeById(currentMode);
    const handled = mode.module.handleInput?.({ action: normalized }, createModeContext());
    if (handled == null) bus.dispatch('console:intent', { mode: mode.id, action: normalized, source: details.source || 'keyboard' });
    return true;
  }

  function refresh() {
    const next = firstAvailableMode(state, currentMode);
    currentMode = next;
    updateTabs();
    renderCurrentMode();
  }

  function render() {
    if (rendered) return container;
    for (const { tab } of modeTabs) tabBar.appendChild(tab);
    container.append(dimLayer, tabBar, contentArea, notice);
    rendered = true;
    updateTabs();
    renderCurrentMode();
    if (state?.inputHandler?.pushContext) {
      inputCleanup = state.inputHandler.pushContext({ id: 'console', onAction: handleInput });
    } else if (state?.inputHandler?.onAction) {
      inputCleanup = state.inputHandler.onAction(handleInput);
    }
    return container;
  }

  function destroy() {
    inputCleanup?.();
    inputCleanup = null;
    destroyMountedMode();
    clearChildren(container);
    rendered = false;
  }

  const api = { setMode, expand, collapse, refresh, render, destroy, container, get currentMode() { return currentMode; }, get expanded() { return expanded; }, getRegistry() { return MODE_REGISTRY; } };
  return api;
}
