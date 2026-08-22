import { bus } from '../../state/bus.js';
import { createIcon } from '../icon.js';
import { captureScroll, restoreScroll } from '../scroll-memory.js';
import * as moveMode from './move.js';
import * as combatMode from './combat.js';
import * as partyMode from './party.js';
import * as gearMode from './gear.js';
import * as techMode from './tech.js';
import * as lootMode from './loot.js';
import * as logMode from './log.js';

// SESSION-05 (icon-first-ui-density) — mirrors the fail-soft prefix pattern
// used across the console modes. Test docs without createElementNS get a
// text-only tab; the aria-label carries the label + shortcut for AT.
function safeCreateIcon(id, opts = {}) {
  if (!id) return null;
  if (typeof document?.createElementNS !== 'function') return null;
  try { return createIcon(id, opts); } catch { return null; }
}

export const CONSOLE_INTENTS = Object.freeze({
  expand: 'console:expand',
  collapse: 'console:collapse',
  modeChange: 'console:mode-change',
  unavailable: 'console:unavailable'
});

const MODE_MODULES = { move: moveMode, combat: combatMode, party: partyMode, gear: gearMode, tech: techMode, loot: lootMode, log: logMode };

// SESSION-05 — `icon` maps each tab to its lucide sprite id per GAP §3.1. Every
// id is already in the M107 subset (assets/icons.svg).
export const MODE_REGISTRY = [
  { id: 'move', label: 'MOVE', key: 'mode_1', module: moveMode, icon: 'footprints', available: (state) => !state.combatState, reason: 'Only available while exploring.' },
  { id: 'combat', label: 'CMBT', key: 'mode_2', module: combatMode, icon: 'sword', available: (state) => Boolean(state.combatState), reason: 'No active combat.' },
  { id: 'party', label: 'PARTY', key: 'mode_3', module: partyMode, icon: 'users', available: (state) => Boolean(state.runState?.party?.length), reason: 'No party.' },
  { id: 'gear', label: 'GEAR', key: 'mode_4', module: gearMode, icon: 'backpack', available: (state) => Boolean(state.runState), reason: 'No run data.' },
  { id: 'tech', label: 'TECH', key: 'mode_5', module: techMode, icon: 'flask-conical', available: (state) => Boolean(state.runState?.party?.length), reason: 'No protocol deck.' },
  { id: 'loot', label: 'LOOT', key: 'mode_6', module: lootMode, icon: 'box', available: (state) => Boolean(state.lootState || state.canLoot?.()), reason: 'No unopened nearby container.' },
  { id: 'log', label: 'LOG', key: 'mode_7', module: logMode, icon: 'scroll-text', available: () => true, reason: '' }
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
  contentArea.dataset.scrollOwner = 'console-mode';
  contentArea.setAttribute('role', 'tabpanel');
  contentArea.tabIndex = -1;
  const notice = document.createElement('div');
  notice.className = 'console-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');

  let currentMode = firstAvailableMode(state);
  // Portrait console cycles through three sizes; dock is always the full-size
  // wide dock. `expanded` is derived (`expandState !== 'collapsed'`) so every
  // existing consumer of `.expanded` / `aria-expanded` keeps working while the
  // tab-tap cycle walks `collapsed → half → full → collapsed`.
  let expandState = isDock ? 'full' : 'collapsed';
  let mountedCleanup = null;
  let inputCleanup = null;
  let rendered = false;

  const EXPAND_CYCLE = { collapsed: 'half', half: 'full', full: 'collapsed' };

  function isExpanded() { return expandState !== 'collapsed'; }

  function applyExpandState(next) {
    expandState = next;
    if (isDock) return;
    container.classList.toggle('collapsed', next === 'collapsed');
    container.classList.toggle('expanded', next !== 'collapsed');
    container.classList.toggle('expanded-half', next === 'half');
    container.classList.toggle('expanded-full', next === 'full');
    container.dataset.expandState = next;
  }

  const modeTabs = MODE_REGISTRY.map((mode, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    // SESSION-05 (icon-first-ui-density): `icon-only` marks the tab for the
    // portrait/wide density rules that landed in SESSION-03 (styles/components.css,
    // styles/wide.css). The visible label is now the lucide sprite; the
    // accessible name still lives on aria-label (LABEL · Key N, verbatim).
    tab.className = isDock ? 'wide-mode-tab console-row icon-only' : 'mode-tab console-row icon-only';
    tab.id = `console-tab-${mode.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'console-content');
    // Pointer discoverability — the icon carries no visible text, so a plain
    // `title` names it on hover. The mocks (SESSION-03) added this back; the
    // TARGET-panel overlap that killed titles pre-icon is moot when the tab is
    // icon-only.
    tab.setAttribute('title', mode.label);
    // Sprite first, then the numeric shortcut badge — matches the mock DOM
    // order (svg + tab-key). Icon-24 per the SESSION-03 tab-bar mocks.
    const icon = safeCreateIcon(mode.icon, { size: 24 });
    if (icon) tab.appendChild(icon);
    // In-tab shortcut badge. The number is decorative (aria-label carries the
    // spoken shortcut); disabled tabs keep their reason in aria-label only.
    const keyBadge = document.createElement('span');
    keyBadge.className = 'tab-key';
    keyBadge.textContent = String(index + 1);
    keyBadge.setAttribute('aria-hidden', 'true');
    tab.appendChild(keyBadge);
    tab.dataset.testid = `console-tab-${mode.id}`;
    tab.addEventListener('click', () => {
      const wasActive = currentMode === mode.id;
      const wasExpanded = isExpanded();
      if (!setMode(mode.id, { source: 'touch' })) return;
      if (isDock) return;
      // Active tab while open → cycle to the next size in EXPAND_CYCLE.
      // Inactive tab (setMode switched mode) → open at half if collapsed, else keep size.
      if (wasActive && wasExpanded) cycleExpandState();
      else if (!wasExpanded) expand();
    });
    return { tab, mode };
  });

  function createModeContext() {
    return { ...state, bus, refresh: refreshCurrentMode, expanded: isExpanded(), layout, console: api };
  }

  function setNotice(text) {
    notice.textContent = text;
    notice.hidden = !text;
  }

  function updateTabs() {
    const expanded = isExpanded();
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
      tab.setAttribute('aria-label', available
        ? `${mode.label} · ${mode.key.replace('mode_', 'Key ')}`
        : `${mode.label} · ${mode.reason}`);
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

  // Portrait size transitions funnel through here so every landing state fires
  // the same intent + camera events. `size` is 'collapsed' | 'half' | 'full'.
  function setExpandSize(size) {
    if (isDock) return;
    if (expandState === size) return;
    applyExpandState(size);
    updateTabs();
    if (size === 'collapsed') {
      bus.dispatch('ui:console-collapse');
      bus.dispatch(CONSOLE_INTENTS.collapse, { mode: currentMode, size });
    } else {
      contentArea.focus?.({ preventScroll: true });
      bus.dispatch('ui:console-expand');
      bus.dispatch(CONSOLE_INTENTS.expand, { mode: currentMode, size });
      bus.dispatch('ui:camera-request', { reason: 'console-expand', mode: currentMode });
    }
  }

  function expand(options = {}) {
    if (isDock) return;
    // No-arg expand from collapsed opens to 'half' (compat with existing
    // console.expand() callers). Explicit `options.size` is respected — a
    // caller may jump directly to 'full' or step back to 'half'.
    const requested = options.size || (isExpanded() ? expandState : 'half');
    setExpandSize(requested);
  }

  function collapse() {
    if (isDock) return;
    setExpandSize('collapsed');
  }

  function cycleExpandState() {
    if (isDock) return;
    setExpandSize(EXPAND_CYCLE[expandState] || 'half');
  }

  function handleInput(action, details = {}) {
    const normalized = normalizeConsoleAction(action);
    const focusedTab = details.event?.target?.dataset?.testid?.match?.(/^console-tab-(.+)$/)?.[1];
    if ((normalized === 'confirm' || normalized === ' ') && focusedTab) {
      const wasActive = currentMode === focusedTab;
      const wasExpanded = isExpanded();
      if (!setMode(focusedTab, { source: details.source || 'keyboard' })) return false;
      if (isDock) return true;
      // Keyboard focus + confirm mirrors the tab-tap cycle: active tab cycles
      // size; a mode switch either opens to half (was collapsed) or leaves the
      // current size alone (was already expanded).
      if (wasActive && wasExpanded) cycleExpandState();
      else if (!wasExpanded) expand();
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
    if (rendered) captureScroll(contentArea, `console:${currentMode}`);
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

  // Seed the portrait dataset early so consumers reading `data-expand-state`
  // before any render/expand call see a stable value.
  applyExpandState(expandState);

  const api = { setMode, expand, collapse, refresh, render, destroy, container, variant, get currentMode() { return currentMode; }, get expanded() { return isExpanded(); }, get expandState() { return expandState; }, getRegistry() { return MODE_REGISTRY; } };
  return api;
}
