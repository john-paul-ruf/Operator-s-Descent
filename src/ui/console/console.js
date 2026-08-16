import { bus } from '../../state/bus.js';
import { captureScroll, restoreScroll } from '../scroll-memory.js';
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
  { id: 'combat', label: 'CMBT', key: 'mode_2', module: combatMode, available: (state) => Boolean(state.combatState), reason: 'No active combat.' },
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

export function createConsole(state, options = {}) {
  const variant = options.variant === 'dock' ? 'dock' : 'bar';
  const isDock = variant === 'dock';
  const layout = isDock ? 'wide' : 'portrait';

  const container = document.createElement('section');
  container.className = isDock ? 'wide-console-dock' : 'console-bar collapsed';
  container.setAttribute('aria-label', 'Command console');
  const dimLayer = isDock ? null : document.createElement('div');
  if (dimLayer) {
    dimLayer.className = 'console-dim-layer';
    dimLayer.setAttribute('aria-hidden', 'true');
  }
  const tabBar = document.createElement('div');
  tabBar.className = isDock ? 'wide-console-tabs' : 'console-tab-bar';
  tabBar.setAttribute('role', 'tablist');
  const contentShell = isDock ? document.createElement('div') : null;
  const contentHeader = isDock ? document.createElement('div') : null;
  const contentHeaderLabel = isDock ? document.createElement('div') : null;
  if (contentShell) {
    contentShell.className = 'wide-console-content';
    contentHeader.className = 'wide-console-content-header';
    contentHeaderLabel.className = 'wide-console-content-mode';
    contentHeader.appendChild(contentHeaderLabel);
  }
  const contentArea = document.createElement('div');
  contentArea.className = isDock ? 'wide-console-content-body scroll-area' : 'console-content scroll-area';
  contentArea.setAttribute('role', 'tabpanel');
  contentArea.tabIndex = -1;
  const notice = document.createElement('div');
  notice.className = 'console-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');

  let currentMode = firstAvailableMode(state);
  let expanded = isDock;
  let mountedCleanup = null;
  let inputCleanup = null;
  let rendered = false;

  const modeTabs = MODE_REGISTRY.map((mode, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = isDock ? 'wide-mode-tab console-row' : 'mode-tab console-row';
    tab.textContent = mode.label;
    tab.id = `console-tab-${mode.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'console-content');
    tab.title = `Key ${index + 1}`;
    tab.dataset.testid = `console-tab-${mode.id}`;
    tab.addEventListener('click', () => {
      const wasActive = currentMode === mode.id;
      const wasExpanded = expanded;
      if (!setMode(mode.id, { source: 'touch' })) return;
      if (isDock) return;
      if (wasActive && wasExpanded) collapse();
      else expand();
    });
    return { tab, mode };
  });

  function createModeContext() {
    return { ...state, bus, refresh: refreshCurrentMode, expanded, layout, console: api };
  }

  function setNotice(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }

  function updateTabs() {
    container.dataset.mode = currentMode;
    container.setAttribute('aria-expanded', String(expanded));
    contentArea.setAttribute('aria-hidden', String(!expanded));
    if (dimLayer) dimLayer.hidden = !expanded;
    for (const { tab, mode } of modeTabs) {
      const active = mode.id === currentMode;
      const available = mode.available(state);
      tab.classList.toggle('active', active);
      tab.classList.toggle('disabled', !available);
      tab.disabled = !available;
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('aria-expanded', String(active && expanded));
      tab.setAttribute('aria-disabled', String(!available));
      tab.title = available ? `${mode.label} · ${mode.key.replace('mode_', 'Key ')}` : mode.reason;
    }
    if (contentHeaderLabel) {
      const mode = modeById(currentMode);
      contentHeaderLabel.textContent = `◈ ${mode.label} MODE`;
    }
  }

  function destroyMountedMode() {
    mountedCleanup?.();
    mountedCleanup = null;
    for (const child of [...contentArea.children]) child.cleanup?.();
    clearChildren(contentArea);
  }

  function renderCurrentMode() {
    const mode = modeById(currentMode);
    destroyMountedMode();
    const result = mode.module.render?.(contentArea, createModeContext());
    mountedCleanup = typeof result === 'function' ? result : result?.cleanup || null;
    contentArea.id = 'console-content';
    contentArea.setAttribute('aria-labelledby', `console-tab-${mode.id}`);
    contentArea.dataset.mode = mode.id;
    restoreScroll(contentArea, `console:${mode.id}`);
    contentArea.focus?.({ preventScroll: true });
  }

  function refreshCurrentMode() {
    captureScroll(contentArea, `console:${currentMode}`);
    renderCurrentMode();
  }

  function setMode(modeId, options = {}) {
    const mode = modeById(modeId);
    if (!mode.available(state)) {
      setNotice(mode.reason);
      bus.dispatch(CONSOLE_INTENTS.unavailable, { mode: mode.id, reason: mode.reason, source: options.source || 'program' });
      return false;
    }
    if (currentMode === mode.id && rendered) return true;
    if (rendered) captureScroll(contentArea, `console:${currentMode}`);
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
    if (!isDock) {
      container.classList.remove('collapsed');
      container.classList.add('expanded');
    }
    updateTabs();
    contentArea.focus?.({ preventScroll: true });
    bus.dispatch('ui:console-expand');
    bus.dispatch(CONSOLE_INTENTS.expand, { mode: currentMode });
    bus.dispatch('ui:camera-request', { reason: 'console-expand', mode: currentMode });
  }

  function collapse() {
    if (isDock || !expanded) return;
    expanded = false;
    container.classList.remove('expanded');
    container.classList.add('collapsed');
    updateTabs();
    bus.dispatch('ui:console-collapse');
    bus.dispatch(CONSOLE_INTENTS.collapse, { mode: currentMode });
  }

  function handleInput(action, details = {}) {
    const normalized = normalizeConsoleAction(action);
    const focusedTab = details.event?.target?.dataset?.testid?.match?.(/^console-tab-(.+)$/)?.[1];
    if ((normalized === 'confirm' || normalized === ' ') && focusedTab) {
      const wasActive = currentMode === focusedTab;
      const wasExpanded = expanded;
      if (!setMode(focusedTab, { source: details.source || 'keyboard' })) return false;
      if (isDock) return true;
      if (wasActive && wasExpanded) collapse();
      else expand();
      return true;
    }
    const modeKey = normalized.match(/^mode_(\d)$/);
    if (modeKey) return setMode(MODE_REGISTRY[Number(modeKey[1]) - 1]?.id, { source: details.source || 'keyboard' });
    if (normalized === 'tab_next') {
      const mode = modeById(currentMode);
      const handled = mode.module.handleInput?.({ action: normalized }, createModeContext());
      if (handled != null) return true;
      const start = MODE_REGISTRY.findIndex((entry) => entry.id === currentMode);
      for (let offset = 1; offset <= MODE_REGISTRY.length; offset++) {
        const entry = MODE_REGISTRY[(start + offset) % MODE_REGISTRY.length];
        if (entry.available(state)) return setMode(entry.id, { source: details.source || 'keyboard' });
      }
    }
    if (normalized === 'cancel') {
      if (isDock) {
        const mode = modeById(currentMode);
        const handled = mode.module.handleInput?.({ action: normalized }, createModeContext());
        return handled != null ? true : true;
      }
      collapse();
      return true;
    }
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
    if (isDock) {
      contentShell.append(contentHeader, contentArea, notice);
      container.append(tabBar, contentShell);
    } else {
      container.append(dimLayer, tabBar, contentArea, notice);
    }
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

  const api = { setMode, expand, collapse, refresh, render, destroy, container, variant, get currentMode() { return currentMode; }, get expanded() { return expanded; }, getRegistry() { return MODE_REGISTRY; } };
  return api;
}
