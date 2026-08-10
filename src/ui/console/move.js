import { createButton } from '../components.js';
import { moveParty } from '../../exploration/movement.js';
import { computeLOS, updateFogOfWar } from '../../exploration/shadowcast.js';

const DIRECTIONS = [
  { id: 'move-northwest', label: '↖', dx: -1, dy: -1 },
  { id: 'move-north', label: '↑', dx: 0, dy: -1 },
  { id: 'move-northeast', label: '↗', dx: 1, dy: -1 },
  { id: 'move-west', label: '←', dx: -1, dy: 0 },
  { id: 'wait', label: 'WAIT', dx: 0, dy: 0 },
  { id: 'move-east', label: '→', dx: 1, dy: 0 },
  { id: 'move-southwest', label: '↙', dx: -1, dy: 1 },
  { id: 'move-south', label: '↓', dx: 0, dy: 1 },
  { id: 'move-southeast', label: '↘', dx: 1, dy: 1 }
];

export function render(container, context) {
  container.innerHTML = '';
  const dpad = document.createElement('div');
  dpad.className = 'dpad';

  for (const dir of DIRECTIONS) {
    const btn = document.createElement('button');
    btn.className = dir.id === 'wait' ? 'dpad-center' : 'dpad-btn';
    btn.textContent = dir.label;
    btn.addEventListener('click', () => {
      if (dir.id === 'wait') {
        if (context?.bus) context.bus.dispatch('action:wait');
        return;
      }
      if (context?.lattice && context?.fogState && context?.runState) {
        const dirMap = {
          'move-north': 'n', 'move-south': 's', 'move-east': 'e', 'move-west': 'w',
          'move-northeast': 'ne', 'move-northwest': 'nw',
          'move-southeast': 'se', 'move-southwest': 'sw'
        };
        const moveDir = dirMap[dir.id];
        if (moveDir && context.rngCursor) {
          const result = moveParty(context.lattice, context.fogState, moveDir, context.rngCursor, context.runState);
          if (context.bus) context.bus.dispatch('action:move', result);
        }
      }
    });
    dpad.appendChild(btn);
  }

  container.appendChild(dpad);

  if (context?.lastMoveResult?.interruptType) {
    const indicator = document.createElement('div');
    indicator.className = 'auto-stop-indicator';
    indicator.textContent = `AUTO-STOP: ${context.lastMoveResult.interruptType.toUpperCase()}`;
    container.appendChild(indicator);
  }
}

export function handleInput(event, context) {
  const dirMap = {
    'move-north': 'n', 'move-south': 's', 'move-east': 'e', 'move-west': 'w',
    'move-northeast': 'ne', 'move-northwest': 'nw',
    'move-southeast': 'se', 'move-southwest': 'sw'
  };
  if (dirMap[event.action]) {
    if (context?.lattice && context?.fogState && context?.runState && context?.rngCursor) {
      return moveParty(context.lattice, context.fogState, dirMap[event.action], context.rngCursor, context.runState);
    }
  }
}