import { createButton, createHPBar, createChargeBar, createSigilToken, createConditionTag, createManualLink, createProtocolCard } from '../components.js';
import { createIcon } from '../icon.js';

// Mirror src/ui/console/party.js:safeCreateIcon — tests and older runtimes may render
// through a document that lacks `createElementNS` (createIcon builds SVG through it). The
// production DOM always exposes it; the guard degrades icon-less rendering to a plain
// button label instead of throwing, keeping the console usable in every environment.
function safeCreateIcon(id, opts = {}) {
  if (!id) return null;
  if (typeof document?.createElementNS !== 'function') return null;
  try { return createIcon(id, opts); } catch { return null; }
}

const MOVE_RANGE = 5;
// Icon ids come from the sprite compiled at dev time (assets/icons.svg) — see
// tools/icons/subset.json + src/ui/icon.js ICON_IDS. Adding a new action icon here
// requires updating both, which the icon.test.js lockstep assertion enforces.
const ACTIONS = [
  { id: 'move', label: 'Move', needs: `up to ${MOVE_RANGE} cells`, icon: 'arrow-down-right' },
  { id: 'attack', label: 'Attack', needs: '1 AP', icon: 'sword' },
  { id: 'cast', label: 'Protocol', needs: '1 AP + CHARGE', icon: 'wand-sparkles' },
  { id: 'overclock', label: 'Overclock', needs: '1 AP + overclock CHARGE', icon: 'zap' },
  { id: 'item', label: 'Item', needs: '1 AP', icon: 'flame' },
  { id: 'retreat', label: 'Retreat', needs: '1 AP', icon: 'arrow-up-right' },
  { id: 'end-turn', label: 'End Turn', needs: 'explicit', icon: 'clock' }
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

const REASON_LABEL = {
  not_a_weapon: 'no weapon equipped',
  out_of_range: 'out of range',
  // evaluateRange (src/rules/equipment.js) returns 'beyond_maximum' for out-of-range weapons;
  // the range gate for protocols uses the same reason. Map both here so the reason chip reads
  // as "OUT OF RANGE" instead of falling through to the generic 'illegal' text.
  beyond_maximum: 'out of range',
  no_line_of_sight: 'no line of sight',
  blocked: 'blocked'
};

function titleCase(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function parseEnemyId(id) {
  const match = String(id ?? '').match(/^enemy_\d+_([a-z][a-z0-9]*)(?:_.+)?$/);
  return match ? match[1] : null;
}

export function humanizeActorName(actor) {
  if (!actor) return 'Actor';
  if (actor.name) return actor.name;
  if (actor.classId) return titleCase(actor.classId);
  if (actor.archetypeId) return titleCase(actor.archetypeId);
  const parsed = parseEnemyId(actor.id);
  if (parsed) return titleCase(parsed);
  return String(actor.id ?? 'Actor');
}

function humanizeActorNames(actors) {
  const bases = actors.map((actor) => humanizeActorName(actor));
  const counts = new Map();
  for (const name of bases) counts.set(name, (counts.get(name) || 0) + 1);
  const running = new Map();
  const map = new Map();
  actors.forEach((actor, index) => {
    const base = bases[index];
    if (counts.get(base) > 1) {
      const n = (running.get(base) || 0) + 1;
      running.set(base, n);
      map.set(actor.id, `${base} ${n}`);
    } else {
      map.set(actor.id, base);
    }
  });
  return map;
}

function activeSummary(container, active, dispatch) {
  if (!active) return;
  const panel = document.createElement('div');
  panel.className = 'combat-active-panel panel-elevated console-row';
  panel.dataset.testid = 'combat-active';
  panel.appendChild(createSigilToken(sigilOf(active), 34, { role: roleOf(active), label: `Active ${humanizeActorName(active)}` }));
  appendText(panel, 'combat-active-name', `${humanizeActorName(active)} · ${active.side?.toUpperCase() || 'ACTOR'}`);
  panel.appendChild(createHPBar(active.hp ?? active.currentHP ?? 0, active.hpMax ?? active.maxHP ?? active.hp ?? active.currentHP ?? 0));
  panel.appendChild(createChargeBar(active.charge ?? active.currentCHARGE ?? 0, active.chargeMax ?? active.maxCHARGE ?? active.charge ?? active.currentCHARGE ?? 0));
  const apLine = appendText(panel, 'combat-ap', `AP ${active.ap ?? 0} · ${active.moveAvailable ? 'MOVE READY' : 'MOVE SPENT'}`);
  apLine.appendChild(createManualLink('ap_and_initiative', {
    variant: 'chip', source: 'combat-ap', dispatch, testid: 'combat-ap-link'
  }));
  for (const condition of active.conditions || []) {
    const conditionId = condition.id || condition.conditionId || condition;
    panel.appendChild(createConditionTag(conditionId, condition.duration, {
      manualLink: { source: 'combat-condition', dispatch }
    }));
  }
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
    const token = createSigilToken(sigilOf(actor), 34, { role: roleOf(actor), label: `Initiative ${humanizeActorName(actor)}` });
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
    // Prepend the action's icon (SESSION-01's createIcon returns an <svg> element with class
    // "icon"). Uses prepend() so the sprite sits before the button's textContent, giving the
    // "◈ ATTACK · 1 AP" glyph-then-label rhythm the mocks establish. safeCreateIcon returns
    // null in test envs without createElementNS — the button still renders, minus the sprite.
    const icon = safeCreateIcon(action.icon, { size: 16 });
    if (icon) button.prepend(icon);
    list.appendChild(button);
  }
  container.appendChild(list);
}

function renderDirections(container, context) {
  const selection = context.selection || {};
  const path = selection.movePath || [];
  const stepsLeft = Math.max(0, MOVE_RANGE - path.length);
  const legalNext = new Set(context.combatGetPathSteps?.() || []);
  const grid = document.createElement('div');
  grid.className = 'combat-direction-grid';
  grid.dataset.testid = 'combat-directions';
  for (const [direction, label] of DIRECTION_GRID) {
    if (!direction) {
      const center = document.createElement('div');
      center.className = 'combat-direction console-row dpad-center';
      center.dataset.testid = 'combat-dir-center';
      center.textContent = `${stepsLeft} LEFT`;
      grid.appendChild(center);
      continue;
    }
    const button = createButton(label, {
      label: `Step ${direction}`,
      disabled: !legalNext.has(direction) || selection.resolving,
      onClick: () => context.combatStepPath?.(direction)
    });
    button.className = `combat-direction console-row`;
    button.dataset.testid = `combat-dir-${direction}`;
    grid.appendChild(button);
  }
  container.appendChild(grid);
  if (path.length > 0) {
    const undo = createButton('UNDO', {
      disabled: selection.resolving,
      onClick: () => context.combatPopPath?.()
    });
    undo.className = 'combat-undo console-row';
    undo.dataset.testid = 'combat-undo';
    container.appendChild(undo);
  }
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
  if (!preview) return 'Range —';
  const range = preview.range?.legal === false
    ? (REASON_LABEL[preview.range.reason] || 'illegal')
    : `${titleCase(preview.range?.band || 'range')} ${preview.distance ?? '—'}`;
  const parts = [`Range: ${range}`];
  parts.push(preview.coverBonus ? `Cover: +${preview.coverBonus}` : 'Cover: none');
  if (preview.flanked) parts.push('Flanked');
  return parts.join(' · ');
}

function renderTargets(container, context) {
  const selection = context.selection || {};
  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
  const targets = context.combatGetTargets?.() || [];
  const nameMap = humanizeActorNames(targets);
  const nameOf = (actor) => nameMap.get(actor?.id) ?? humanizeActorName(actor);
  const list = document.createElement('div');
  list.className = 'combat-target-list';
  list.dataset.testid = 'combat-targets';
  const selected = targets.find((target) => String(target.id) === String(selection.targetId));
  if (selected) {
    if (context.layout === 'wide') {
      const info = document.createElement('div');
      info.className = 'target-info';
      info.dataset.testid = 'combat-selected-preview';
      const name = document.createElement('div');
      name.className = 'target-name';
      name.textContent = `◈ TARGET: ${nameOf(selected)}`;
      const detail = document.createElement('div');
      detail.className = 'target-detail';
      detail.textContent = previewText(context.combatGetPreview?.(selected.id));
      detail.appendChild(createManualLink('cover_and_range', {
        variant: 'chip', source: 'combat-cover', dispatch, testid: 'combat-cover-link'
      }));
      info.append(name, detail);
      list.appendChild(info);
    } else {
      const preview = appendText(list, 'mode-indicator combat-target-preview', `◈ TARGET: ${nameOf(selected)} · ${previewText(context.combatGetPreview?.(selected.id))}`, 'combat-selected-preview');
      preview.appendChild(createManualLink('cover_and_range', {
        variant: 'chip', source: 'combat-cover', dispatch, testid: 'combat-cover-link'
      }));
    }
  }
  if (!targets.length) appendText(list, 'console-empty', 'No valid targets.');
  for (const target of targets) {
    const preview = context.combatGetPreview?.(target.id);
    // Range-gate integration (SESSION-05 checkpoint 4). preview.targetLegal is authored by
    // src/ui/screens/combat.js:previewForTarget. `illegal` is only ever true for attack + cast +
    // overclock — item targeting always returns targetLegal:true because item consumers are the
    // party itself. Illegal rows: disabled, is-illegal class hook (SESSION-06 styles it),
    // circle-x icon prefix with a tone-danger label so the reason is readable to assistive tech.
    const illegal = preview && preview.targetLegal === false;
    const reason = illegal ? (REASON_LABEL[preview.range?.reason] || 'out of range') : null;
    const label = `${nameOf(target)} · HP ${target.hp ?? 0}/${target.hpMax ?? target.hp ?? 0} · ${previewText(preview)}${illegal ? ` · ${reason.toUpperCase()}` : ''}`;
    // A keyboard cycle can land the internal selection on an illegal target — the row still
    // reads as `selected` so the player sees which target they're on, but the disabled +
    // is-illegal state (and the OUT OF RANGE reason) explains why CONFIRM is refusing.
    const isSelected = selection.targetId === target.id;
    const button = createButton(label, {
      selected: isSelected,
      disabled: illegal,
      onClick: illegal ? undefined : () => context.combatSelectTarget?.(target.id)
    });
    if (illegal) {
      const chip = safeCreateIcon('circle-x', { size: 14, tone: 'danger', label: reason });
      if (chip) button.prepend(chip);
    }
    button.className = selectedClass(`combat-target console-row${illegal ? ' is-illegal' : ''}`, isSelected);
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
  if (context.layout === 'wide') confirm.classList.add('btn-confirm');
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
  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
  const active = context.combatGetActiveActor?.() || null;
  appendText(container, 'mode-indicator', `COMBAT · ${selection.phase || 'choose-action'}`, 'combat-indicator');
  initiativeRail(container, combatState);
  activeSummary(container, active, dispatch);
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
  if (action === 'cancel') {
    const selection = context.selection || {};
    if (selection.actionType === 'move' && (selection.movePath?.length ?? 0) > 0) {
      return context.combatPopPath?.() ?? null;
    }
    return context.combatCancel?.() ?? null;
  }
  if (action === 'tab_next') return context.combatCycleTarget?.(1) ?? null;
  if (ACTION_TO_DIRECTION[action]) {
    if (context.selection?.actionType === 'move') return context.combatStepPath?.(ACTION_TO_DIRECTION[action]) ?? null;
    if (['choose-target', 'confirm'].includes(context.selection?.phase)) return context.combatCycleTarget?.(action === 'move_n' || action === 'move_w' || action === 'move_nw' || action === 'move_sw' ? -1 : 1) ?? null;
  }
  return null;
}
