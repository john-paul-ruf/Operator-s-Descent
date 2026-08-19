import { createButton } from '../components.js';

const DIRECTIONS = [
  { action: 'move_nw', direction: 'nw', label: '↖', name: 'Northwest', icon: 'arrow-up-left' },
  { action: 'move_n', direction: 'n', label: '↑', name: 'North', icon: 'arrow-up' },
  { action: 'move_ne', direction: 'ne', label: '↗', name: 'Northeast', icon: 'arrow-up-right' },
  { action: 'move_w', direction: 'w', label: '←', name: 'West', icon: 'arrow-left' },
  { action: 'confirm', direction: null, label: 'CONFIRM', name: 'Confirm descent or selection', icon: null },
  { action: 'move_e', direction: 'e', label: '→', name: 'East', icon: 'arrow-right' },
  { action: 'move_sw', direction: 'sw', label: '↙', name: 'Southwest', icon: 'arrow-down-left' },
  { action: 'move_s', direction: 's', label: '↓', name: 'South', icon: 'arrow-down' },
  { action: 'move_se', direction: 'se', label: '↘', name: 'Southeast', icon: 'arrow-down-right' }
];

const ACTION_TO_DIRECTION = Object.fromEntries(DIRECTIONS.filter((entry) => entry.direction).map((entry) => [entry.action, entry.direction]));
const LEGACY_TO_ACTION = {
  'move-north': 'move_n', 'move-south': 'move_s', 'move-east': 'move_e', 'move-west': 'move_w',
  'move-northeast': 'move_ne', 'move-northwest': 'move_nw', 'move-southeast': 'move_se', 'move-southwest': 'move_sw'
};

function clear(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else while (container.firstChild) container.removeChild(container.firstChild);
}

function text(className, value) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  return element;
}

function noticeFor(result, canDescend) {
  if (canDescend) return 'DESCENT POINT — press CONFIRM to request descent.';
  if (!result) return 'MOVE with arrows, numpad, WASD/QEZC, or the console pad.';
  if (!result.moved) return result.interruptType === 'invalid-direction' ? 'INVALID DIRECTION.' : 'BLOCKED — wall or closed corner.';
  if (result.interruptType === 'hostile') return 'HOSTILE CONTACT — combat requested.';
  if (result.interruptType === 'hunt') return 'HUNT TRIGGERED — combat requested.';
  if (result.interruptType === 'container') return 'CONTAINER DISCOVERED — approach to enable LOOT.';
  if (result.interruptType === 'damage') return 'DAMAGE INTERRUPT — movement stopped.';
  if (result.interruptType === 'descent') return 'DESCENT DISCOVERED — step onto it and CONFIRM.';
  if (result.danger?.pendingHunt) return 'HUNT PENDING AFTER CURRENT INTERRUPT.';
  return `MOVED TO ${result.position?.x ?? '?'}:${result.position?.y ?? '?'}.`;
}

export function render(container, context = {}) {
  clear(container);
  const cleanups = [];
  const root = document.createElement('div');
  root.className = 'move-mode';

  const header = document.createElement('div');
  header.className = 'move-header';
  const mode = text('mode-indicator', '◈ MOVE MODE');
  mode.dataset.testid = 'move-indicator';
  header.append(mode, text('move-input-hint', 'Arrows / WASD / Numpad'));
  root.appendChild(header);

  const dpad = document.createElement('div');
  dpad.className = 'dpad move-dpad';
  dpad.setAttribute('aria-label', 'Eight-way movement pad');
  const canDescend = Boolean(context.canDescend?.());
  const confirmLabel = canDescend ? 'DESCEND' : 'WAIT';
  const confirmAria = canDescend ? 'Confirm descent' : 'Wait; no descent point underfoot';
  for (const entry of DIRECTIONS) {
    const isConfirm = entry.action === 'confirm';
    const label = isConfirm ? confirmLabel : entry.label;
    const button = createButton(label, {
      label: isConfirm ? confirmAria : entry.name,
      disabled: isConfirm && !canDescend,
      icon: entry.icon || undefined,
      iconSize: 16
    });
    // classList.add (not className assignment) preserves the has-icon marker
    // set by createButton opts.icon. Reassigning className wipes it.
    button.classList.add(...(isConfirm ? ['dpad-center', 'console-row'] : ['dpad-btn', 'console-row']));
    button.dataset.testid = entry.direction ? `move-${entry.direction}` : 'move-confirm';
    dpad.appendChild(button);
    if (context.inputHandler?.bindActionControl) cleanups.push(context.inputHandler.bindActionControl(button, entry.action));
    else button.addEventListener('click', () => handleInput({ action: entry.action }, context));
  }
  root.appendChild(dpad);

  const toggles = context.autoStopToggles || {};
  if (context.layout !== 'wide') {
    const toggleRow = document.createElement('div');
    toggleRow.className = 'move-toggle-row';
    toggleRow.appendChild(createButton('HOSTILE STOP LOCKED', {
      selected: true, disabled: true, description: 'Hostile contact always stops movement.',
      icon: 'eye', iconSize: 14, iconTone: 'dim'
    }));
    const discoveryOn = toggles.discovery !== false;
    const discoveryToggle = createButton(`DISCOVERY STOP ${discoveryOn ? 'ON' : 'OFF'}`, {
      selected: discoveryOn,
      onClick: () => context.setAutoStopToggle?.('discovery', toggles.discovery === false),
      icon: discoveryOn ? 'eye' : 'eye-off', iconSize: 14, iconTone: 'dim'
    });
    discoveryToggle.dataset.testid = 'toggle-discovery';
    toggleRow.appendChild(discoveryToggle);
    const damageOn = toggles.damage !== false;
    const damageToggle = createButton(`DAMAGE STOP ${damageOn ? 'ON' : 'OFF'}`, {
      selected: damageOn,
      onClick: () => context.setAutoStopToggle?.('damage', toggles.damage === false),
      icon: damageOn ? 'eye' : 'eye-off', iconSize: 14, iconTone: 'dim'
    });
    damageToggle.dataset.testid = 'toggle-damage';
    toggleRow.appendChild(damageToggle);
    root.appendChild(toggleRow);
  } else {
    root.appendChild(autoStopRow('Auto-Stop on hostile detect', true, true, 'autostop-hostile'));
    root.appendChild(autoStopRow('Auto-Stop on container in view', toggles.discovery !== false, false, 'autostop-discovery'));
    root.appendChild(autoStopRow('Auto-Stop on damage taken', toggles.damage !== false, false, 'autostop-damage'));
  }

  const notice = text('console-notice', context.notice || noticeFor(context.lastMoveResult, context.canDescend?.()));
  notice.dataset.testid = 'move-notice';
  root.appendChild(notice);

  container.appendChild(root);
  return () => cleanups.forEach((cleanup) => cleanup?.());
}

function autoStopRow(label, on, locked, testid) {
  const row = document.createElement('div');
  row.className = 'autostop-row';
  row.dataset.testid = testid;
  const labelEl = document.createElement('span');
  labelEl.className = 'autostop-label';
  labelEl.textContent = locked ? `${label} (locked)` : label;
  const pill = document.createElement('span');
  pill.className = on ? 'autostop-pill' : 'autostop-pill off';
  pill.textContent = on ? 'ON' : 'OFF';
  row.append(labelEl, pill);
  return row;
}

export function handleInput(event, context = {}) {
  const action = LEGACY_TO_ACTION[event.action] || event.action;
  if (action === 'confirm') {
    return context.canDescend?.() ? context.onConfirmDescent?.() : false;
  }
  const direction = ACTION_TO_DIRECTION[action];
  if (!direction) return null;
  return context.onMove?.(direction, { source: event.source || 'console' });
}
