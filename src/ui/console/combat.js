import { createButton, createHPBar, createChargeBar, createSigilToken, createConditionTag } from '../components.js';

const ACTIONS = [
  { id: 'attack', label: 'Attack' },
  { id: 'cast', label: 'Cast' },
  { id: 'item', label: 'Item' },
  { id: 'retreat', label: 'Retreat' }
];

export function render(container, context) {
  container.innerHTML = '';
  const combatState = context?.combatState;
  if (!combatState) {
    container.textContent = 'No active combat.';
    return;
  }

  const active = combatState.combatants?.[combatState.activeIndex];
  if (active) {
    const activePanel = document.createElement('div');
    activePanel.className = 'combat-active-panel';
    activePanel.appendChild(createSigilToken(active.sigilCodepoint || 0xE000, 34));
    if (active.hp !== undefined) activePanel.appendChild(createHPBar(active.hp, active.hpMax || active.hp));
    if (active.charge !== undefined) activePanel.appendChild(createChargeBar(active.charge, active.chargeMax || active.charge));
    if (active.ap !== undefined) {
      const apEl = document.createElement('span');
      apEl.textContent = `AP ${active.ap}`;
      activePanel.appendChild(apEl);
    }
    if (active.conditions) {
      for (const c of active.conditions) {
        activePanel.appendChild(createConditionTag(c.id || c, c.duration));
      }
    }
    container.appendChild(activePanel);
  }

  const actionList = document.createElement('div');
  actionList.className = 'action-list';
  for (const action of ACTIONS) {
    const btn = createButton(action.label, {
      onClick: () => {
        if (context?.bus) context.bus.dispatch('combat:action', { type: action.id, actor: active });
      }
    });
    actionList.appendChild(btn);
  }
  container.appendChild(actionList);

  if (combatState.targets && combatState.targets.length > 0) {
    const targetList = document.createElement('div');
    targetList.className = 'target-list';
    targetList.textContent = 'Targets:';
    for (const target of combatState.targets) {
      const btn = createButton(target.name || `0x${(target.sigilCodepoint || 0).toString(16)}`, {
        onClick: () => {
          if (context?.bus) context.bus.dispatch('combat:select-target', target);
        }
      });
      targetList.appendChild(btn);
    }
    container.appendChild(targetList);
  }
}

export function handleInput(event, context) {
  if (event.action === 'confirm' && context?.combatState) {
    if (context?.bus) context.bus.dispatch('combat:confirm');
  }
  if (event.action === 'cancel' && context?.combatState) {
    if (context?.bus) context.bus.dispatch('combat:cancel');
  }
}