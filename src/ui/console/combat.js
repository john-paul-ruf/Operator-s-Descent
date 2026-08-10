import { createButton, createHPBar, createChargeBar, createSigilToken, createConditionTag } from '../components.js';

const ACTIONS = [
  { id: 'attack', label: 'Attack' },
  { id: 'cast', label: 'Cast' },
  { id: 'overclock', label: 'Overclock' },
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

  const selection = context.selection || {};
  const active = getActiveActor(combatState);
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
      for (const condition of active.conditions) {
        activePanel.appendChild(createConditionTag(condition.id || condition, condition.duration));
      }
    }
    container.appendChild(activePanel);
  }

  const actionList = document.createElement('div');
  actionList.className = 'action-list';
  for (const action of ACTIONS) {
    const btn = createButton(action.label, {
      onClick: () => context?.bus?.dispatch('combat:action', { type: action.id })
    });
    if (selection.type === action.id) btn.classList.add('selected');
    actionList.appendChild(btn);
  }
  container.appendChild(actionList);

  if (selection.type === 'cast' || selection.type === 'overclock') {
    renderProtocols(container, context, active, selection);
  }
  if (selection.type === 'item') {
    renderItems(container, context, selection);
  }

  if (selection.type !== 'retreat') {
    renderTargets(container, context, combatState, selection);
  }

  const selected = document.createElement('div');
  selected.className = 'combat-selection';
  selected.textContent = `SELECTED: ${(selection.type || 'attack').toUpperCase()}${selection.targetId != null ? ` → ${selection.targetId}` : ''}`;
  container.appendChild(selected);

  if (selection.error) {
    const error = document.createElement('div');
    error.className = 'combat-error';
    error.textContent = selection.error;
    container.appendChild(error);
  }

  container.appendChild(createButton('CONFIRM', {
    primary: true,
    onClick: () => context?.bus?.dispatch('combat:confirm')
  }));
}

function renderProtocols(container, context, active, selection) {
  const protocols = active?.protocols || [];
  const area = document.createElement('div');
  area.className = 'protocol-list';
  if (protocols.length === 0) {
    area.textContent = 'No protocols available.';
    container.appendChild(area);
    return;
  }

  for (const protocol of protocols) {
    const name = context.protocolsData?.schools?.[protocol.school]?.tiers?.[protocol.tier - 1]?.name;
    const btn = createButton(name || `${protocol.school} ${protocol.tier}`, {
      onClick: () => context?.bus?.dispatch('combat:select-protocol', protocol)
    });
    if (selection.school === protocol.school && selection.tier === protocol.tier) btn.classList.add('selected');
    area.appendChild(btn);
  }
  container.appendChild(area);
}

function renderItems(container, context, selection) {
  const area = document.createElement('div');
  area.className = 'item-list';
  const items = (context.runState?.inventory || []).filter(item => item.category === 'consumable' && item.baseType);
  if (items.length === 0) {
    area.textContent = 'No consumables available.';
    container.appendChild(area);
    return;
  }

  for (const item of items) {
    const btn = createButton(item.name || item.baseType, {
      onClick: () => context?.bus?.dispatch('combat:select-item', item)
    });
    if (selection.consumableId === item.baseType || selection.consumableId === item.id) btn.classList.add('selected');
    area.appendChild(btn);
  }
  container.appendChild(area);
}

function renderTargets(container, context, combatState, selection) {
  const targetList = document.createElement('div');
  targetList.className = 'target-list';
  targetList.textContent = 'Targets:';
  const targets = getTargets(combatState, selection.type);
  for (const target of targets) {
    const label = target.name || `0x${(target.sigilCodepoint || 0).toString(16)}`;
    const btn = createButton(label, {
      onClick: () => context?.bus?.dispatch('combat:select-target', { targetId: target.id })
    });
    if (selection.targetId === target.id) btn.classList.add('selected');
    targetList.appendChild(btn);
  }
  if (targets.length === 0) targetList.appendChild(document.createTextNode(' None available.'));
  container.appendChild(targetList);
}

function getActiveActor(combatState) {
  const activeId = combatState.turnOrder?.[combatState.currentTurn];
  const actors = getActors(combatState);
  return actors.find(actor => actor.id === activeId) || null;
}

function getTargets(combatState, actionType) {
  const actors = getActors(combatState).filter(actor => actor.hp > 0);
  if (Array.isArray(combatState.targets)) return combatState.targets.filter(target => target.hp > 0);
  if (actionType === 'attack') return actors.filter(actor => actor.side === 'enemy');
  if (actionType === 'item') return actors.filter(actor => actor.side === 'party');
  return actors;
}

function getActors(combatState) {
  if (combatState.combatants instanceof Map) return [...combatState.combatants.values()];
  return Array.isArray(combatState.combatants) ? combatState.combatants : [];
}

export function handleInput(event, context) {
  if (!context?.combatState) return;
  if (event.action === 'confirm') context.bus?.dispatch('combat:confirm');
  if (event.action === 'cancel') context.bus?.dispatch('combat:cancel');
}
