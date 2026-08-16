export const WIDE_MEDIA_QUERY = '(min-width: 900px) and (min-aspect-ratio: 1/1)';

export function currentLayoutClass() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'portrait';
  return window.matchMedia(WIDE_MEDIA_QUERY).matches ? 'wide' : 'portrait';
}

export function initLayoutController({ bus }) {
  const applyLayoutAttribute = () => {
    const layout = currentLayoutClass();
    if (typeof document !== 'undefined') document.documentElement.dataset.layout = layout;
    return layout;
  };
  applyLayoutAttribute();

  let query = null;
  let handleChange = null;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const candidate = window.matchMedia(WIDE_MEDIA_QUERY);
    if (typeof candidate?.addEventListener === 'function') {
      query = candidate;
      handleChange = () => {
        bus.dispatch('ui:layout-change', { layout: applyLayoutAttribute() });
      };
      query.addEventListener('change', handleChange);
    }
  }

  return function cleanup() {
    if (query && handleChange) query.removeEventListener('change', handleChange);
    query = null;
    handleChange = null;
    if (typeof document !== 'undefined') delete document.documentElement.dataset.layout;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Wide-layout pane controller (SESSION-05)
// Both docks in the wide 3-region shell can be resized (drag on a handle,
// arrow keys when a handle has focus) or collapsed (click a chevron). State
// persists via the settings passthrough (`widePanes` key). Playfield column
// keeps its portrait-proportioned track (Custom Rule 8).
// ─────────────────────────────────────────────────────────────────────────────

export const WIDE_PANE_LEFT_BOUNDS = { min: 200, max: 480, default: 280 };
export const WIDE_PANE_RIGHT_BOUNDS = { min: 280, max: 640, default: 360 };
export const WIDE_PANE_LEFT_COLLAPSED_PX = 48;
export const WIDE_PANE_RIGHT_COLLAPSED_PX = 96;
const KEYBOARD_STEP_PX = 16;

function clamp(value, { min, max }) {
  return Math.max(min, Math.min(max, value));
}

function normalizePaneWidth(value, bounds) {
  if (value === 'collapsed') return 'collapsed';
  const num = Number(value);
  if (!Number.isFinite(num)) return bounds.default;
  return clamp(Math.round(num), bounds);
}

function readPersistedPanes(loadSettings) {
  if (typeof loadSettings !== 'function') return {};
  let settings = null;
  try { settings = loadSettings(); } catch { return {}; }
  if (!settings || typeof settings !== 'object') return {};
  const persisted = settings.widePanes;
  return persisted && typeof persisted === 'object' ? persisted : {};
}

function applyWidthVar(shell, side, value) {
  const varName = side === 'left' ? '--wide-left-w' : '--wide-right-w';
  if (typeof value === 'number') shell.style?.setProperty?.(varName, `${value}px`);
  else if (typeof shell.style?.removeProperty === 'function') shell.style.removeProperty(varName);
  else shell.style?.setProperty?.(varName, '');
}

function applyPaneState(shell, side, state) {
  const key = side === 'left' ? 'paneLeft' : 'paneRight';
  const value = state[side];
  if (value === 'collapsed') {
    if (shell.dataset) shell.dataset[key] = 'collapsed';
    applyWidthVar(shell, side, '');
  } else {
    if (shell.dataset) shell.dataset[key] = 'open';
    applyWidthVar(shell, side, value);
  }
}

function makeHandle(doc, side, bounds) {
  const handle = doc.createElement('div');
  handle.className = `pane-resize-handle pane-resize-${side}`;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', side === 'left' ? 'Resize telemetry dock' : 'Resize console dock');
  handle.setAttribute('aria-valuemin', String(bounds.min));
  handle.setAttribute('aria-valuemax', String(bounds.max));
  handle.setAttribute('aria-valuenow', String(bounds.default));
  handle.tabIndex = 0;
  handle.dataset.testid = `pane-handle-${side}`;
  return handle;
}

function makeCollapseButton(doc, side) {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = `pane-collapse-btn pane-collapse-${side}`;
  btn.setAttribute('aria-label', side === 'left' ? 'Collapse telemetry dock' : 'Collapse console dock');
  btn.dataset.testid = `pane-collapse-${side}`;
  btn.textContent = side === 'left' ? '◀' : '▶';
  return btn;
}

export function attachWidePanes({ shell, saveSettings, loadSettings } = {}) {
  if (!shell) return () => {};
  const doc = shell.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return () => {};

  const persisted = readPersistedPanes(loadSettings);
  const state = {
    left: normalizePaneWidth(persisted.left, WIDE_PANE_LEFT_BOUNDS),
    right: normalizePaneWidth(persisted.right, WIDE_PANE_RIGHT_BOUNDS)
  };

  applyPaneState(shell, 'left', state);
  applyPaneState(shell, 'right', state);

  const leftHandle = makeHandle(doc, 'left', WIDE_PANE_LEFT_BOUNDS);
  const rightHandle = makeHandle(doc, 'right', WIDE_PANE_RIGHT_BOUNDS);
  const leftCollapse = makeCollapseButton(doc, 'left');
  const rightCollapse = makeCollapseButton(doc, 'right');

  shell.appendChild(leftHandle);
  shell.appendChild(rightHandle);
  shell.appendChild(leftCollapse);
  shell.appendChild(rightCollapse);

  function persist() {
    if (typeof saveSettings !== 'function') return;
    const widePanes = {
      left: state.left === 'collapsed' ? 'collapsed' : state.left,
      right: state.right === 'collapsed' ? 'collapsed' : state.right
    };
    try { saveSettings({ widePanes }); } catch { /* defensive */ }
  }

  function setWidth(side, width) {
    const bounds = side === 'left' ? WIDE_PANE_LEFT_BOUNDS : WIDE_PANE_RIGHT_BOUNDS;
    state[side] = clamp(Math.round(width), bounds);
    applyPaneState(shell, side, state);
    const handle = side === 'left' ? leftHandle : rightHandle;
    handle.setAttribute?.('aria-valuenow', String(state[side]));
  }

  function toggleCollapse(side) {
    const bounds = side === 'left' ? WIDE_PANE_LEFT_BOUNDS : WIDE_PANE_RIGHT_BOUNDS;
    if (state[side] === 'collapsed') state[side] = bounds.default;
    else state[side] = 'collapsed';
    applyPaneState(shell, side, state);
    persist();
  }

  function expandFromCollapse(side) {
    if (state[side] !== 'collapsed') return;
    const bounds = side === 'left' ? WIDE_PANE_LEFT_BOUNDS : WIDE_PANE_RIGHT_BOUNDS;
    state[side] = bounds.default;
    applyPaneState(shell, side, state);
    persist();
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const dragState = { active: null, pointerId: null, startX: 0, startWidth: 0 };

  function makeDragBinding(handle, side) {
    const bounds = side === 'left' ? WIDE_PANE_LEFT_BOUNDS : WIDE_PANE_RIGHT_BOUNDS;

    function onPointerDown(event) {
      if (state[side] === 'collapsed') return;
      dragState.active = side;
      dragState.pointerId = event.pointerId ?? null;
      dragState.startX = event.clientX ?? 0;
      dragState.startWidth = typeof state[side] === 'number' ? state[side] : bounds.default;
      if (dragState.pointerId != null) handle.setPointerCapture?.(dragState.pointerId);
      event.preventDefault?.();
    }
    function onPointerMove(event) {
      if (dragState.active !== side) return;
      const dx = (event.clientX ?? 0) - dragState.startX;
      const next = side === 'left' ? dragState.startWidth + dx : dragState.startWidth - dx;
      setWidth(side, next);
    }
    function onPointerUp(event) {
      if (dragState.active !== side) return;
      if (dragState.pointerId != null) handle.releasePointerCapture?.(dragState.pointerId);
      dragState.active = null;
      dragState.pointerId = null;
      persist();
    }
    function onDoubleClick() {
      state[side] = bounds.default;
      applyPaneState(shell, side, state);
      persist();
    }
    function onKeyDown(event) {
      const code = event.code || event.key;
      let delta = 0;
      if (code === 'ArrowLeft') delta = side === 'left' ? -KEYBOARD_STEP_PX : KEYBOARD_STEP_PX;
      else if (code === 'ArrowRight') delta = side === 'left' ? KEYBOARD_STEP_PX : -KEYBOARD_STEP_PX;
      else return;
      event.preventDefault?.();
      event.stopPropagation?.();
      if (state[side] === 'collapsed') return;
      setWidth(side, state[side] + delta);
      persist();
    }

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
    handle.addEventListener('dblclick', onDoubleClick);
    handle.addEventListener('keydown', onKeyDown);

    return function unbind() {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      handle.removeEventListener('dblclick', onDoubleClick);
      handle.removeEventListener('keydown', onKeyDown);
    };
  }

  const unbindLeftDrag = makeDragBinding(leftHandle, 'left');
  const unbindRightDrag = makeDragBinding(rightHandle, 'right');

  // ── Collapse-button click handlers ────────────────────────────────────────
  function onLeftCollapseClick(event) {
    event.preventDefault?.();
    toggleCollapse('left');
  }
  function onRightCollapseClick(event) {
    event.preventDefault?.();
    toggleCollapse('right');
  }
  leftCollapse.addEventListener('click', onLeftCollapseClick);
  rightCollapse.addEventListener('click', onRightCollapseClick);

  // ── Tab-click auto-expand (right pane) ────────────────────────────────────
  const tabs = typeof shell.querySelector === 'function' ? shell.querySelector('.wide-console-tabs') : null;
  function onTabsClick() {
    if (state.right === 'collapsed') expandFromCollapse('right');
  }
  if (tabs && typeof tabs.addEventListener === 'function') {
    tabs.addEventListener('click', onTabsClick);
  }

  return function cleanup() {
    unbindLeftDrag();
    unbindRightDrag();
    leftCollapse.removeEventListener('click', onLeftCollapseClick);
    rightCollapse.removeEventListener('click', onRightCollapseClick);
    if (tabs && typeof tabs.removeEventListener === 'function') {
      tabs.removeEventListener('click', onTabsClick);
    }
    for (const node of [leftHandle, rightHandle, leftCollapse, rightCollapse]) {
      if (typeof node.remove === 'function') node.remove();
      else node.parentNode?.removeChild?.(node);
    }
    shell.style?.removeProperty?.('--wide-left-w');
    shell.style?.removeProperty?.('--wide-right-w');
    if (shell.dataset) {
      delete shell.dataset.paneLeft;
      delete shell.dataset.paneRight;
    }
  };
}
