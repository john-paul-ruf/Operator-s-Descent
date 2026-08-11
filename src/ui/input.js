const ACTIONS = new Set([
  'move_n', 'move_s', 'move_w', 'move_e', 'move_nw', 'move_ne', 'move_sw', 'move_se',
  'confirm', 'cancel', 'mode_1', 'mode_2', 'mode_3', 'mode_4', 'mode_5', 'mode_6', 'mode_7', 'tab_next'
]);

const KEY_MAP = {
  ArrowUp: 'move_n', ArrowDown: 'move_s', ArrowLeft: 'move_w', ArrowRight: 'move_e',
  Numpad7: 'move_nw', Numpad9: 'move_ne', Numpad1: 'move_sw', Numpad3: 'move_se',
  Numpad8: 'move_n', Numpad2: 'move_s', Numpad4: 'move_w', Numpad6: 'move_e',
  KeyW: 'move_n', KeyS: 'move_s', KeyA: 'move_w', KeyD: 'move_e',
  KeyQ: 'move_nw', KeyE: 'move_ne', KeyZ: 'move_sw', KeyC: 'move_se',
  Digit1: 'mode_1', Digit2: 'mode_2', Digit3: 'mode_3', Digit4: 'mode_4',
  Digit5: 'mode_5', Digit6: 'mode_6', Digit7: 'mode_7',
  Dig1: 'mode_1', Dig2: 'mode_2', Dig3: 'mode_3', Dig4: 'mode_4',
  Dig5: 'mode_5', Dig6: 'mode_6', Dig7: 'mode_7',
  Tab: 'tab_next', Enter: 'confirm', Escape: 'cancel', Space: 'confirm', Backspace: 'cancel'
};

const LEGACY_ACTIONS = {
  move_n: 'move-north', move_s: 'move-south', move_w: 'move-west', move_e: 'move-east',
  move_nw: 'move-northwest', move_ne: 'move-northeast', move_sw: 'move-southwest', move_se: 'move-southeast',
  mode_1: 'mode-1', mode_2: 'mode-2', mode_3: 'mode-3', mode_4: 'mode-4',
  mode_5: 'mode-5', mode_6: 'mode-6', mode_7: 'mode-7', tab_next: 'tab-next'
};

const ACTION_ALIASES = new Map(Object.entries(LEGACY_ACTIONS).map(([canonical, legacy]) => [legacy, canonical]));
for (const action of ACTIONS) ACTION_ALIASES.set(action, action);

const REPEATABLE_ACTIONS = new Set(['move_n', 'move_s', 'move_w', 'move_e', 'move_nw', 'move_ne', 'move_sw', 'move_se']);
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function normalizeAction(action) {
  return ACTION_ALIASES.get(action) || null;
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return TYPING_TAGS.has(target.tagName);
}

function removeFromStack(stack, context) {
  const index = stack.lastIndexOf(context);
  if (index >= 0) stack.splice(index, 1);
}

export function createInputHandler(options = {}) {
  const contexts = [];
  const legacyCallbacks = [];
  const boundCleanups = [];
  const legacyActions = options.legacyActions !== false;

  function dispatch(action, details = {}) {
    const canonical = normalizeAction(action);
    if (!canonical) return false;
    const topContext = contexts.at(-1);
    if (topContext) {
      if (topContext.actions && !topContext.actions.has(canonical)) return false;
      if (details.repeat && !topContext.repeat.has(canonical)) return false;
      topContext.onAction(canonical, details);
      return true;
    }
    if (details.repeat && !REPEATABLE_ACTIONS.has(canonical)) return false;
    for (const callback of [...legacyCallbacks]) {
      callback(legacyActions ? LEGACY_ACTIONS[canonical] || canonical : canonical, details);
    }
    return legacyCallbacks.length > 0;
  }

  function handleKeydown(event) {
    if (isTypingTarget(event.target)) return;
    const action = KEY_MAP[event.code] || KEY_MAP[event.key];
    if (!action) return;
    const handled = dispatch(action, { source: 'keyboard', repeat: Boolean(event.repeat), event });
    if (handled && typeof event.preventDefault === 'function') event.preventDefault();
  }

  return {
    actions: ACTIONS,
    onAction(callback) {
      legacyCallbacks.push(callback);
      return () => {
        const index = legacyCallbacks.indexOf(callback);
        if (index >= 0) legacyCallbacks.splice(index, 1);
      };
    },
    pushContext(config) {
      const context = {
        id: config.id || `input-${contexts.length + 1}`,
        onAction: config.onAction,
        actions: config.actions ? new Set([...config.actions].map(normalizeAction).filter(Boolean)) : null,
        repeat: new Set([...(config.repeat || REPEATABLE_ACTIONS)].map(normalizeAction).filter(Boolean))
      };
      contexts.push(context);
      return () => removeFromStack(contexts, context);
    },
    bindToElement(element) {
      element.addEventListener('keydown', handleKeydown);
      if (element.tabIndex == null || element.tabIndex < 0) element.tabIndex = 0;
      const cleanup = () => element.removeEventListener('keydown', handleKeydown);
      boundCleanups.push(cleanup);
      return cleanup;
    },
    bindActionControl(element, action) {
      const canonical = normalizeAction(action);
      const activate = (event) => {
        const handled = dispatch(canonical, { source: event?.type?.startsWith('touch') ? 'touch' : 'control', event });
        if (handled && typeof event?.preventDefault === 'function') event.preventDefault();
      };
      element.addEventListener('click', activate);
      element.addEventListener('touchend', activate, { passive: false });
      const cleanup = () => {
        element.removeEventListener('click', activate);
        element.removeEventListener('touchend', activate);
      };
      boundCleanups.push(cleanup);
      return cleanup;
    },
    triggerAction(action, details = {}) {
      return dispatch(action, { source: 'program', ...details });
    },
    destroy() {
      while (boundCleanups.length) boundCleanups.pop()();
      contexts.length = 0;
      legacyCallbacks.length = 0;
    }
  };
}

export const CONSOLE_ACTIONS = Object.freeze(['mode_1', 'mode_2', 'mode_3', 'mode_4', 'mode_5', 'mode_6', 'mode_7', 'tab_next', 'confirm', 'cancel']);
