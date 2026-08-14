import { createButton, createHPBar, createChargeBar, createSigilToken, createConditionTag, createProtocolCard } from '../components.js';

const ACTIONS = [
  { id: 'move', label: 'Move', needs: 'move action' },
  { id: 'attack', label: 'Attack', needs: '1 AP' },
  { id: 'cast', label: 'Protocol', needs: '1 AP + CHARGE' },
  { id: 'overclock', label: 'Overclock', needs: '1 AP + overclock CHARGE' },
  { id: 'item', label: 'Item', needs: '1 AP' },
  { id: 'retreat', label: 'Retreat', needs: '1 AP' },
  { id: 'end-turn', label: 'End Turn', needs: 'explicit' }
];
const DIRECTION_GRID = [
  ['nw', '↖'], ['n', '↑'], ['ne', '↗'],
  ['w', '←'], [null, '·'], ['e', '→'],
  ['sw', '↙'], ['s', '↓'], ['se', '↘']
];
const ACTION_TO_DIRECTION = {
  move_n: 'n', move_s: 's', move_w: 'w', move_e: 'e',
  move_nw: 'nw', move_ne: 'ne', move_sw: 'sw', move_se: 'se'
};

function clear(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else while (container.firstChild) container.removeChild(container.firstChild);
}

function getActors(combatState) {
  return combatState?.combatants instanceof Map ? [...combatState.combatants.values()] : Array.isArray(combatState?.combatants) ? combatState.combatants : [];
}

function roleOf(actor) {
  return actor?.side === 'enemy' ? 'enemy' : actor?.side === 'echo' ? 'echo' : 'player';
}

function sigilOf(actor) {
  return actor?.sigilCodepoint || (roleOf(actor) === 'enemy' ? 0xE030 : 0xE000);
}

function appendText(parent, className, value, testid = null) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  if (testid) element.dataset.testid = testid;
  parent.appendChild(element);
  return element;
}

function selectedClass(base, selected) {
  return selected ? `${base} selected` : base;
}

function actorName(actor) {
  return actor?.name || actor?.classId || actor?.archetypeId || String(actor?.id ?? 'actor');
}

function activeSummary(container, active) {
  if (!active) return;
  const panel = document.createElement('div');
  panel.className = 'combat-active-panel panel-elevated console-row';
  panel.dataset.testid = 'combat-active';
  panel.appendChild(createSigilToken(sigilOf(active), 34, { role: roleOf(active), label: `Active ${actorName(active)}` }));
  appendText(panel, 'combat-active-name', `${actorName(active)} · ${active.side?.toUpperCase() || 'ACTOR'}`);
  panel.appendChild(createHPBar(active.hp ?? active.currentHP ?? 0, active.hpMax ?? active.maxHP ?? active.hp ?? active.currentHP ?? 0));
  panel.appendChild(createChargeBar(active.charge ?? active.currentCHARGE ?? 0, active.chargeMax ?? active.maxCHARGE ?? active.charge ?? active.currentCHARGE ?? 0));
  appendText(panel, 'combat-ap', `AP ${active.ap ?? 0} · ${active.moveAvailable ? 'MOVE READY' : 'MOVE SPENT'}`);
  for (const condition of active.conditions || []) panel.appendChild(createConditionTag(condition.id || condition.conditionId || condition, condition.duration));
  container.appendChild(panel);
}

function initiativeRail(container, combatState) {
  const rail = document.createElement('div');
  rail.className = 'init-rail panel console-row';
  rail.dataset.testid = 'initiative-rail';
  const actors = new Map(getActors(combatState).map((actor) => [actor.id, actor]));
  for (const id of combatState.turnOrder || []) {
    const actor = actors.get(id);
    if (!actor || actor.hp <= 0) continue;
    const token = createSigilToken(sigilOf(actor), 34, { role: roleOf(actor), label: `Initiative ${actorName(actor)}` });
    if (id === combatState.turnOrder?.[combatState.currentTurn]) token.classList.add('active');
    rail.appendChild(token);
  }
  container.appendChild(rail);
}

function renderActions(container, context, legalActions) {
  const list = document.createElement('div');
  list.className = 'combat-action-list';
  list.dataset.testid = 'combat-actions';
  const selection = context.selection || {};
  for (const action of ACTIONS) {
    const disabled = selection.resolving || !legalActions.actions?.includes(action.id) || (action.id === 'retreat' && (context.combatGetActiveActor?.()?.ap ?? 0) <= 0);
    const button = createButton(`${action.label.toUpperCase()} · ${action.needs.toUpperCase()}`, {
      disabled,
      selected: selection.actionType === action.id,
      onClick: () => context.combatChooseAction?.(action.id)
    });
    button.className = selectedClass(`combat-action action-btn console-row${action.id === 'retreat' ? ' danger' : ''}`, selection.actionType === action.id);
    button.dataset.testid = `combat-action-${action.id}`;
    list.appendChild(button);
  }
  container.appendChild(list);
}

function renderDirections(container, context) {
  const selection = context.selection || {};
  const legal = new Set(context.combatGetDirections?.() || []);
  const grid = document.createElement('div');
  grid.className = 'combat-direction-grid';
  grid.dataset.testid = 'combat-directions';
  for (const [direction, label] of DIRECTION_GRID) {
    const button = createButton(label, {
      label: direction ? `Move ${direction}` : 'Center',
      disabled: !direction || !legal.has(direction) || selection.resolving,
      selected: selection.direction === direction,
      onClick: () => context.combatSelectDirection?.(direction)
    });
    button.className = selectedClass(`combat-direction console-row${direction ? '' : ' dpad-center'}`, selection.direction === direction);
    button.dataset.testid = direction ? `combat-dir-${direction}` : 'combat-dir-center';
    grid.appendChild(button);
  }
  container.appendChild(grid);
}

function renderProtocols(container, context, active) {
  const selection = context.selection || {};
  const protocols = active?.protocols || active?.protocolDeck || [];
  const list = document.createElement('div');
  list.className = 'combat-protocol-list';
  list.dataset.testid = 'combat-protocols';
  if (!protocols.length) appendText(list, 'console-empty', 'No protocols prepared.');
  for (const protocol of protocols) {
    const data = context.protocolsData?.schools?.[protocol.school]?.tiers?.[protocol.tier - 1];
    const card = createProtocolCard({ ...protocol, name: data?.name || `${protocol.school}-${protocol.tier}`, chargeCost: data?.chargeCost || 0 }, {
      selected: selection.protocol?.school === protocol.school && selection.protocol?.tier === protocol.tier,
      onClick: () => context.combatSelectProtocol?.(protocol)
    });
    card.dataset.testid = `combat-protocol-${protocol.school}-${protocol.tier}`;
    list.appendChild(card);
  }
  container.appendChild(list);
}

function renderItems(container, context) {
  const selection = context.selection || {};
  const items = context.combatGetItems?.() || [];
  const list = document.createElement('div');
  list.className = 'combat-item-list';
  list.dataset.testid = 'combat-items';
  if (!items.length) appendText(list, 'console-empty', 'No consumables available.');
  for (const item of items) {
    const button = createButton(item.name || item.baseType || item.id, {
      selected: selection.itemId === item.id || selection.itemId === item.baseType,
      onClick: () => context.combatSelectItem?.(item)
    });
    button.className = selectedClass('combat-item console-row', selection.itemId === item.id || selection.itemId === item.baseType);
    button.dataset.testid = `combat-item-${item.id || item.baseType}`;
    list.appendChild(button);
  }
  container.appendChild(list);
}

function previewText(preview) {
  if (!preview) return 'range — · cover 0 · flank no';
  const range = preview.range?.legal === false ? `illegal ${preview.range.reason || ''}`.trim() : `${preview.range?.band || 'range'} ${preview.distance ?? '—'}`;
  return `range ${range} · cover +${preview.coverBonus || 0} · flank ${preview.flanked ? 'yes' : 'no'}`;
}

function renderTargets(container, context) {
  const selection = context.selection || {};
  const targets = context.combatGetTargets?.() || [];
  const list = document.createElement('div');
  list.className = 'combat-target-list';
  list.dataset.testid = 'combat-targets';
  const selected = targets.find((target) => String(target.id) === String(selection.targetId));
  if (selected) appendText(list, 'mode-indicator combat-target-preview', `◈ TARGET: ${actorName(selected)} · ${previewText(context.combatGetPreview?.(selected.id))}`, 'combat-selected-preview');
  if (!targets.length) appendText(list, 'console-empty', 'No valid targets.');
  for (const target of targets) {
    const preview = context.combatGetPreview?.(target.id);
    const label = `${actorName(target)} · HP ${target.hp ?? 0}/${target.hpMax ?? target.hp ?? 0} · ${previewText(preview)}`;
    const button = createButton(label, {
      selected: selection.targetId === target.id,
      onClick: () => context.combatSelectTarget?.(target.id)
    });
    button.className = selectedClass('combat-target console-row', selection.targetId === target.id);
    button.dataset.testid = `combat-target-${target.id}`;
    list.appendChild(button);
  }
  container.appendChild(list);
}

function renderConfirm(container, context) {
  const selection = context.selection || {};
  const row = document.createElement('div');
  row.className = 'combat-confirm-row';
  const confirm = createButton(selection.resolving ? 'RESOLVING' : 'CONFIRM', {
    primary: true,
    disabled: !context.combatCanConfirm?.(),
    onClick: () => context.combatConfirm?.()
  });
  confirm.dataset.testid = 'combat-confirm';
  row.appendChild(confirm);
  const back = createButton('BACK', { disabled: selection.resolving, onClick: () => context.combatCancel?.() });
  back.dataset.testid = 'combat-back';
  row.appendChild(back);
  container.appendChild(row);
}

export function render(container, context = {}) {
  clear(container);
  const combatState = context.combatState;
  if (!combatState) {
    appendText(container, 'console-empty', 'No active combat.');
    return;
  }
  const selection = context.selection || {};
  const active = context.combatGetActiveActor?.() || null;
  appendText(container, 'mode-indicator', `COMBAT · ${selection.phase || 'choose-action'}`, 'combat-indicator');
  initiativeRail(container, combatState);
  activeSummary(container, active);
  if (combatState.ended) {
    appendText(container, 'combat-terminal console-row', `COMBAT ${String(combatState.result || 'ENDED').toUpperCase()}`, 'combat-terminal');
    return;
  }
  if (!active || active.side !== 'party') {
    appendText(container, 'combat-resolving console-row', 'Enemy turn resolving…', 'combat-resolving');
    return;
  }
  const legalActions = context.combatGetLegalActions?.() || { actions: [], legalMoveDirections: [] };
  renderActions(container, context, legalActions);
  if (selection.phase === 'choose-path' || (selection.phase === 'confirm' && selection.actionType === 'move')) renderDirections(container, context);
  if (selection.phase === 'choose-protocol') renderProtocols(container, context, active);
  if (selection.phase === 'choose-item') renderItems(container, context);
  if (selection.phase === 'choose-target' || (selection.phase === 'confirm' && ['attack', 'cast', 'overclock', 'item'].includes(selection.actionType))) renderTargets(container, context);
  if (selection.phase === 'confirm') renderConfirm(container, context);
  else if (selection.actionType) appendText(container, 'combat-hint console-row', 'Select an option, then confirm.', 'combat-hint');
  if (selection.notice) appendText(container, 'combat-notice console-row', selection.notice, 'combat-notice');
  if (selection.error) appendText(container, 'combat-error console-row', selection.error, 'combat-error');
}

export function handleInput(event, context = {}) {
  const action = event.action;
  if (action === 'confirm') return context.combatConfirm?.() ?? null;
  if (action === 'cancel') return context.combatCancel?.() ?? null;
  if (action === 'tab_next') return context.combatCycleTarget?.(1) ?? null;
  if (ACTION_TO_DIRECTION[action]) {
    if (context.selection?.actionType === 'move') return context.combatSelectDirection?.(ACTION_TO_DIRECTION[action]) ?? null;
    if (['choose-target', 'confirm'].includes(context.selection?.phase)) return context.combatCycleTarget?.(action === 'move_n' || action === 'move_w' || action === 'move_nw' || action === 'move_sw' ? -1 : 1) ?? null;
  }
  return null;
}
