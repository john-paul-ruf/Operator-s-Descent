import { createButton, createProtocolCard, createChargeBar, createManualLink, createScrollArea } from '../components.js';
import { createIcon } from '../icon.js';
import { modifier, overclockTarget } from '../../rules/attributes.js';
import { getSignatureCapabilities } from '../../rules/classes.js';
import { applyProtocolEffect, deckSlotCapacity, deckSlotCost, protocolChargeCost, resolveProtocolAction, validateProtocolDeck } from '../../rules/protocols.js';

// SESSION-06 — fail-soft icon prefix; missing createElementNS (fake DOMs)
// short-circuits so the wider console tests never blow up on the sprite.
function safeIcon(id, opts = {}) {
  if (!id) return null;
  if (typeof document?.createElementNS !== 'function') return null;
  try { return createIcon(id, opts); } catch { return null; }
}

function prependChild(host, child) {
  if (!child) return;
  if (typeof host.prepend === 'function') host.prepend(child);
  else host.appendChild(child);
}

const uiByRun = new WeakMap();
const TARGET_CYCLE_ACTIONS = new Set(['tab_next', 'move_n', 'move_s', 'move_w', 'move_e', 'move_nw', 'move_ne', 'move_sw', 'move_se']);

function clear(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else while (container.firstChild) container.removeChild(container.firstChild);
}

function text(className, value, testid = null) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  if (testid) element.dataset.testid = testid;
  return element;
}

function stateFor(runState) {
  if (!uiByRun.has(runState)) uiByRun.set(runState, { charIndex: 0, phase: 'browse', protocol: null, overclocked: false, targetId: null, targetIndex: 0, notice: '', error: '', result: null });
  return uiByRun.get(runState);
}

function classDataFor(data, character) {
  return data?.classes?.classes?.find((entry) => entry.id === character?.classId) || null;
}

function protocolDataFor(data, protocol) {
  return data?.protocols?.schools?.[protocol?.school]?.tiers?.[protocol?.tier - 1] || null;
}

function protocolKey(protocol) {
  return `${protocol?.school || 'unknown'}-${protocol?.tier || 0}`;
}

function protocolName(data, protocol) {
  return protocolDataFor(data, protocol)?.name || `${protocol?.school || 'protocol'}-${protocol?.tier || '?'}`;
}

function chargeOf(actor) {
  return actor?.currentCHARGE ?? actor?.charge ?? 0;
}

function chargeMaxOf(actor) {
  return actor?.maxCHARGE ?? actor?.chargeMax ?? chargeOf(actor);
}

function activeCombatActor(context) {
  const combatants = context?.combatState?.combatants;
  const activeId = context?.combatState?.turnOrder?.[context?.combatState?.currentTurn];
  const actor = combatants instanceof Map ? combatants.get(activeId) : null;
  return actor?.side === 'party' ? actor : null;
}

function selectedRunCharacter(runState, ui, activeActor) {
  if (activeActor) return runState?.party?.find((member) => member.id === activeActor.id) || null;
  ui.charIndex = Math.max(0, Math.min(ui.charIndex, (runState?.party?.length || 1) - 1));
  return runState?.party?.[ui.charIndex] || null;
}

function casterFor(character, activeActor) {
  if (!character && !activeActor) return null;
  return {
    ...(character || {}),
    ...(activeActor || {}),
    attributes: { ...(character?.attributes || {}), ...(activeActor?.attributes || {}) },
    protocolDeck: activeActor?.protocols || activeActor?.protocolDeck || character?.protocolDeck || character?.protocols || [],
    currentCHARGE: activeActor?.charge ?? activeActor?.currentCHARGE ?? character?.currentCHARGE ?? character?.charge ?? 0,
    maxCHARGE: activeActor?.chargeMax ?? activeActor?.maxCHARGE ?? character?.maxCHARGE ?? character?.chargeMax ?? character?.currentCHARGE ?? character?.charge ?? 0,
    side: activeActor?.side || character?.side || 'party'
  };
}

function allActors(context, runState, caster) {
  if (Array.isArray(context.techTargets)) return [caster, ...context.techTargets].filter(Boolean);
  const combatants = context?.combatState?.combatants;
  if (combatants instanceof Map) return [...combatants.values()];
  return runState?.party || [];
}

function targetKind(data, protocol) {
  const resolved = protocolDataFor(data, protocol);
  const effect = resolved?.effectData || {};
  if (effect.target === 'floor' || effect.target === 'all_enemies' || effect.target === 'enemies' || effect.target === 'aoe' || effect.type === 'reshape') return 'none';
  if (protocol?.school === 'ward' || ['swap', 'remove_condition'].includes(effect.type)) return 'ally';
  return 'hostile';
}

function targetsFor(context, runState, caster, protocol) {
  const kind = targetKind(context.data || {}, protocol);
  if (kind === 'none') return [];
  return allActors(context, runState, caster)
    .filter((actor) => actor && actor.id !== caster?.id && (actor.hp ?? actor.currentHP ?? 1) > 0)
    .filter((actor) => kind === 'ally' ? (actor.side || 'party') === (caster?.side || 'party') : (actor.side || 'party') !== (caster?.side || 'party'));
}

function overclockPreview(character, data, protocol) {
  const classData = classDataFor(data, character);
  const capabilities = getSignatureCapabilities(character, classData);
  const effects = capabilities.effects || [];
  const extraTiers = effects.some((effect) => effect.parameters?.additionalTiers === 2) ? 2 : 1;
  const clean = effects.some((effect) => effect.parameters?.ignoreCorruption || effect.parameters?.additionalTiers === 2);
  return {
    cost: protocolChargeCost(protocol.tier, { overclocked: true, capabilities }),
    effectiveTier: protocol.tier + extraTiers,
    threshold: overclockTarget(protocol.tier),
    corruptionRisk: clean ? 0 : 0.05
  };
}

function availabilityReason(context, character, caster, protocol, overclocked) {
  if (!protocolDataFor(context.data || {}, protocol)) return 'Unknown protocol.';
  if (context.combatState && (caster?.ap ?? 0) <= 0) return 'No AP remaining.';
  if ((caster?.conditions || []).some((condition) => (condition.id || condition.conditionId) === 'jammed')) return 'JAMMED blocks protocols.';
  const classData = classDataFor(context.data || {}, character);
  const deck = validateProtocolDeck(character || caster, classData, context.data?.protocols);
  if (!deck.valid) return `Deck invalid: ${deck.reason}.`;
  const capabilities = getSignatureCapabilities(character, classData);
  const cost = protocolChargeCost(protocol.tier, { overclocked, capabilities });
  if (chargeOf(caster) < cost) return `Need ${cost} CHARGE.`;
  return '';
}

function beginProtocol(context, protocol, overclocked) {
  const ui = stateFor(context.runState);
  const activeActor = activeCombatActor(context);
  const character = selectedRunCharacter(context.runState, ui, activeActor);
  const caster = casterFor(character, activeActor);
  const reason = availabilityReason(context, character, caster, protocol, overclocked);
  if (reason) {
    ui.error = reason;
    ui.notice = '';
    context.refresh?.();
    return false;
  }
  ui.protocol = { school: protocol.school, tier: protocol.tier };
  ui.overclocked = Boolean(overclocked);
  ui.targetId = null;
  ui.targetIndex = 0;
  ui.phase = targetKind(context.data || {}, protocol) === 'none' ? 'confirm' : 'select-target';
  ui.error = '';
  ui.notice = overclocked ? 'Overclock preview ready — select target and confirm.' : 'Protocol ready — select target and confirm.';
  context.refresh?.();
  return true;
}

function applyCaster(context, character, activeActor, casterDelta) {
  const nextCharge = casterDelta.currentCHARGE ?? casterDelta.charge;
  if (Number.isFinite(nextCharge)) {
    if (character) character.currentCHARGE = nextCharge;
    if (activeActor) {
      activeActor.charge = nextCharge;
      activeActor.currentCHARGE = nextCharge;
    }
  }
  if (context.combatState && activeActor) activeActor.ap = Math.max(0, (activeActor.ap ?? 0) - 1);
}

function applyActorDeltas(context, deltas) {
  const combatants = context?.combatState?.combatants;
  if (!(combatants instanceof Map)) return;
  for (const delta of deltas || []) Object.assign(combatants.get(delta.id) || {}, delta);
}

function protocolContext(context) {
  return {
    runState: context.runState,
    protocolsData: context.data?.protocols || context.protocolsData,
    classesData: context.data?.classes || context.classesData,
    conditionsData: context.data?.conditions || context.conditionsData,
    actors: allActors(context, context.runState, activeCombatActor(context)),
    combatants: context.combatState?.combatants,
    floor: context.floor,
    lattice: context.lattice,
    hasLineOfSight: context.hasLineOfSight || context.hasLOS || (() => true),
    isHostile: context.isHostile || ((source, target) => (source?.side || 'party') !== (target?.side || 'party')),
    distance: context.distance
  };
}

function logProtocol(context, action, effect) {
  const roll = action.rolls?.overclock;
  const attack = action.rolls?.attack;
  const parts = [
    `${action.protocol.name} ${action.costs.overclocked ? 'overclock' : 'cast'}`,
    `CHARGE -${action.costs.charge}`,
    attack ? `attack ${attack.natural}+${attack.modifier}=${attack.total} vs ${attack.target} ${attack.hit ? 'hit' : 'miss'}` : null,
    roll ? `overclock ${roll.natural}+${roll.modifier}=${roll.total} vs ${roll.target} ${roll.success ? 'success' : 'fail'}` : null,
    action.corruptionDelta ? `corruption +${action.corruptionDelta.toFixed(2)}` : null
  ].filter(Boolean);
  context.bus?.dispatch('ui:log-entry', { type: 'combat', message: parts.join(' · '), entry: { action, effect }, sequence: Date.now(), timestamp: Date.now() });
}

function confirmProtocol(context) {
  const ui = stateFor(context.runState);
  const activeActor = activeCombatActor(context);
  const character = selectedRunCharacter(context.runState, ui, activeActor);
  const caster = casterFor(character, activeActor);
  if (!ui.protocol || !caster) return false;
  const targets = targetsFor(context, context.runState, caster, ui.protocol);
  const target = ui.targetId ? targets.find((entry) => entry.id === ui.targetId) : null;
  if (targetKind(context.data || {}, ui.protocol) !== 'none' && !target) {
    ui.error = 'Select a valid target.';
    context.refresh?.();
    return false;
  }
  const result = resolveProtocolAction(caster, ui.protocol, target ? [target] : [], { overclocked: ui.overclocked, apAvailable: !context.combatState || (caster.ap ?? 0) > 0 }, context.rngCursor, protocolContext(context));
  if (!result.success) {
    ui.error = result.reason;
    ui.notice = '';
    context.refresh?.();
    return false;
  }
  let effect = null;
  if (result.effectRequest) {
    effect = applyProtocolEffect(result.stateDelta.caster, result, protocolContext(context), context.rngCursor);
    if (effect.success) applyActorDeltas(context, effect.stateDelta.actors);
  }
  applyCaster(context, character, activeActor, result.stateDelta.caster);
  if (result.corruptionDelta) context.runState.addCorruption?.(result.corruptionDelta) || (context.runState.corruption = (context.runState.corruption || 0) + result.corruptionDelta);
  context.runState.rngState = context.rngCursor?.getState?.() || context.runState.rngState;
  logProtocol(context, result, effect);
  ui.result = result;
  ui.phase = 'browse';
  ui.protocol = null;
  ui.targetId = null;
  ui.error = '';
  ui.notice = `${result.protocol.name} resolved${result.corruptionDelta ? ` · COR +${result.corruptionDelta.toFixed(2)}` : ''}.`;
  context.refresh?.();
  return true;
}

function cycleTarget(context, direction = 1) {
  const ui = stateFor(context.runState);
  if (!ui.protocol) return null;
  const activeActor = activeCombatActor(context);
  const caster = casterFor(selectedRunCharacter(context.runState, ui, activeActor), activeActor);
  const targets = targetsFor(context, context.runState, caster, ui.protocol);
  if (!targets.length) return false;
  const current = Math.max(0, targets.findIndex((target) => target.id === ui.targetId));
  const next = (current + direction + targets.length) % targets.length;
  ui.targetId = targets[next].id;
  ui.targetIndex = next;
  ui.phase = 'confirm';
  context.refresh?.();
  return true;
}

function renderCharacters(container, context, ui, activeActor) {
  const row = document.createElement('div');
  row.className = 'tech-character-row';
  row.dataset.testid = 'tech-characters';
  if (activeActor) {
    row.appendChild(text('tech-active console-row', `ACTIVE: ${activeActor.name || activeActor.id}`));
  } else {
    for (let index = 0; index < (context.runState.party || []).length; index++) {
      const character = context.runState.party[index];
      const button = createButton(character.name || character.classId || `C${index + 1}`, {
        selected: index === ui.charIndex,
        onClick: () => { ui.charIndex = index; ui.phase = 'browse'; ui.protocol = null; context.refresh?.(); }
      });
      button.className = `member-pill console-row${index === ui.charIndex ? ' active' : ''}`;
      button.dataset.testid = `tech-character-${character.id}`;
      row.appendChild(button);
    }
  }
  container.appendChild(row);
}

function renderProtocolRow(list, context, character, caster, protocol) {
  const data = context.data || {};
  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
  const resolved = protocolDataFor(data, protocol);
  const classData = classDataFor(data, character);
  const capabilities = getSignatureCapabilities(character, classData);
  const normalCost = protocolChargeCost(protocol.tier, { capabilities });
  const overclock = overclockPreview(character, data, protocol);
  const row = document.createElement('div');
  row.className = 'tech-protocol-row console-row';
  row.dataset.testid = `tech-protocol-${protocolKey(protocol)}`;
  const castReason = availabilityReason(context, character, caster, protocol, false);
  row.appendChild(createProtocolCard({ ...protocol, name: protocolName(data, protocol), chargeCost: normalCost }, { insufficient: Boolean(castReason) }));
  const detail = text('tech-protocol-detail', `${String(protocol.school).toUpperCase()} T${protocol.tier} · slot ${deckSlotCost(protocol.tier)} · range ${resolved?.range || '—'} · ${resolved?.effect || ''}`, `tech-detail-${protocolKey(protocol)}`);
  detail.appendChild(createManualLink(protocol.school, {
    variant: 'chip', source: 'tech-school', dispatch,
    testid: `tech-school-link-${protocolKey(protocol)}`
  }));
  row.appendChild(detail);
  const btnWrap = document.createElement('div');
  btnWrap.className = 'protocol-buttons';
  const cast = createButton(castReason ? 'CAST BLOCKED' : 'CAST', {
    disabled: Boolean(castReason), description: castReason,
    onClick: () => beginProtocol(context, protocol, false),
    icon: 'wand-sparkles', iconSize: 14
  });
  cast.classList.add('tech-cast-btn');
  cast.dataset.testid = `tech-cast-${protocolKey(protocol)}`;
  btnWrap.appendChild(cast);
  const overReason = availabilityReason(context, character, caster, protocol, true);
  const over = createButton(overReason ? 'OVERCLOCK BLOCKED' : `OVERCLOCK ${overclock.cost} CHG`, {
    danger: true, disabled: Boolean(overReason), description: overReason,
    onClick: () => beginProtocol(context, protocol, true),
    icon: 'zap', iconSize: 14, iconTone: 'danger'
  });
  over.classList.add('tech-overclock-btn');
  over.dataset.testid = `tech-overclock-${protocolKey(protocol)}`;
  btnWrap.appendChild(over);
  row.appendChild(btnWrap);
  list.appendChild(row);
}

function renderTargets(container, context, ui, caster) {
  if (!ui.protocol || !['select-target', 'confirm'].includes(ui.phase)) return;
  const targets = targetsFor(context, context.runState, caster, ui.protocol);
  const list = document.createElement('div');
  list.className = 'tech-target-list';
  list.dataset.testid = 'tech-targets';
  if (!targets.length) list.appendChild(text('console-empty', 'No valid targets.'));
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const label = `${target.name || target.id} · HP ${target.hp ?? target.currentHP ?? 0}/${target.hpMax ?? target.maxHP ?? target.hp ?? target.currentHP ?? 0}`;
    const button = createButton(label, {
      selected: ui.targetId === target.id,
      onClick: () => { ui.targetId = target.id; ui.targetIndex = index; ui.phase = 'confirm'; context.refresh?.(); }
    });
    button.dataset.testid = `tech-target-${target.id}`;
    list.appendChild(button);
  }
  container.appendChild(list);
}

function renderConfirm(container, context, ui, character) {
  if (!ui.protocol || !['select-target', 'confirm'].includes(ui.phase)) return;
  const data = context.data || {};
  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
  const resolved = protocolDataFor(data, ui.protocol);
  const overclock = overclockPreview(character, data, ui.protocol);
  const preview = ui.overclocked
    ? `OVERCLOCK: cost ${overclock.cost} CHARGE, effective T${overclock.effectiveTier}, d20+FOC ${modifier(character?.attributes?.foc)} vs ${overclock.threshold}, corruption risk +${overclock.corruptionRisk.toFixed(2)}.`
    : `CAST: cost ${protocolChargeCost(ui.protocol.tier)} CHARGE, range ${resolved?.range || '—'}, effect ${resolved?.effect || '—'}.`;
  const previewNode = text('tech-preview console-row', preview, 'tech-preview');
  if (ui.overclocked) {
    previewNode.appendChild(createManualLink('charge_and_overclock', {
      variant: 'chip', source: 'tech-overclock', dispatch, testid: 'tech-overclock-link'
    }));
  }
  container.appendChild(previewNode);
  const row = document.createElement('div');
  row.className = 'tech-confirm-row';
  const confirm = createButton('CONFIRM', { primary: true, disabled: ui.phase !== 'confirm', onClick: () => confirmProtocol(context) });
  confirm.dataset.testid = 'tech-confirm';
  row.appendChild(confirm);
  const back = createButton('BACK', { onClick: () => { ui.phase = 'browse'; ui.protocol = null; ui.targetId = null; context.refresh?.(); } });
  back.dataset.testid = 'tech-back';
  row.appendChild(back);
  container.appendChild(row);
}

function renderCatalog(container, data) {
  const catalog = document.createElement('div');
  catalog.className = 'tech-catalog';
  catalog.dataset.testid = 'tech-catalog';
  catalog.appendChild(text('section-label', 'Protocol catalog'));
  for (const [school, schoolData] of Object.entries(data.protocols?.schools || {})) {
    const line = document.createElement('div');
    line.className = 'tech-school-row console-row';
    line.textContent = `${school.toUpperCase()}: ${(schoolData.tiers || []).map((tier) => `T${tier.tier} ${tier.name} ${tier.chargeCost}CHG`).join(' · ')}`;
    catalog.appendChild(line);
  }
  container.appendChild(catalog);
}

export function render(container, context = {}) {
  clear(container);
  const runState = context.runState;
  if (!runState) {
    container.appendChild(text('console-empty', 'No data.', 'tech-empty'));
    return;
  }
  const ui = stateFor(runState);
  const activeActor = activeCombatActor(context);
  const character = selectedRunCharacter(runState, ui, activeActor);
  const caster = casterFor(character, activeActor);
  if (!character && !caster) {
    container.appendChild(text('console-empty', 'No active character.', 'tech-empty'));
    return;
  }
  const data = context.data || {};
  const classData = classDataFor(data, character);
  const deck = caster.protocolDeck || [];
  const deckStatus = validateProtocolDeck(character || caster, classData, data.protocols);

  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
  renderCharacters(container, context, ui, activeActor);
  const chargePanel = document.createElement('div');
  chargePanel.className = 'tech-charge-panel panel-elevated';
  chargePanel.dataset.testid = 'tech-charge-panel';
  const chargeHeading = text('mode-indicator', '◈ CHARGE POOL');
  chargeHeading.appendChild(createManualLink('charge_and_overclock', {
    variant: 'chip', source: 'tech-charge', dispatch, testid: 'tech-charge-link'
  }));
  chargePanel.append(
    chargeHeading,
    createChargeBar(chargeOf(caster), chargeMaxOf(caster)),
    text('tech-charge-regen', `Regen ${Math.max(0, Math.floor((character?.attributes?.res || 0) / 3))} per floor descent`)
  );
  container.appendChild(chargePanel);

  const slotPanel = document.createElement('div');
  slotPanel.className = 'tech-slot-panel panel';
  slotPanel.dataset.testid = 'tech-slot-panel';
  slotPanel.appendChild(text('tech-slots console-row', `Deck slots ${deckStatus.slotsUsed}/${deckStatus.capacity} · ${deckStatus.valid ? 'valid' : deckStatus.reason}`, 'tech-slots'));
  const pipRow = document.createElement('div');
  pipRow.className = 'tech-pip-row console-row';
  for (let i = 0; i < deckStatus.capacity; i++) {
    const pip = document.createElement('span');
    pip.className = `deck-pip${i < deckStatus.slotsUsed ? ' filled' : ''}`;
    pipRow.appendChild(pip);
  }
  slotPanel.appendChild(pipRow);
  container.appendChild(slotPanel);
  container.appendChild(text('mode-indicator', '◈ EQUIPPED PROTOCOLS', 'tech-deck-heading'));

  const list = createScrollArea({ label: 'Prepared protocols', focusable: true });
  list.className = 'tech-deck';
  list.dataset.testid = 'tech-deck';
  if (!deck.length) list.appendChild(text('console-empty', 'No protocols prepared.'));
  for (const protocol of deck) renderProtocolRow(list, context, character, caster, protocol);
  container.appendChild(list);
  renderTargets(container, context, ui, caster);
  renderConfirm(container, context, ui, character || caster);
  renderCatalog(container, data);
  if (ui.result) container.appendChild(text('tech-result console-row', `Last: ${ui.result.protocol.name} · CHARGE -${ui.result.costs.charge}${ui.result.rolls.overclock ? ` · overclock ${ui.result.rolls.overclock.success ? 'success' : 'failed'}` : ''}`, 'tech-result'));
  if (ui.notice) container.appendChild(text('tech-notice console-row', ui.notice, 'tech-notice'));
  if (ui.error) {
    const err = text('tech-error console-row', ui.error, 'tech-error');
    prependChild(err, safeIcon('triangle-alert', { size: 14, tone: 'danger' }));
    container.appendChild(err);
  }
}

export function handleInput(event, context = {}) {
  const ui = context.runState ? stateFor(context.runState) : null;
  if (!ui) return null;
  if (event.action === 'confirm') {
    if (ui.phase === 'confirm') return confirmProtocol(context);
    if (ui.phase === 'select-target') return cycleTarget(context, 1);
  }
  if (event.action === 'cancel') {
    ui.phase = 'browse';
    ui.protocol = null;
    ui.targetId = null;
    context.refresh?.();
    return true;
  }
  if (TARGET_CYCLE_ACTIONS.has(event.action) && ui.protocol) return cycleTarget(context, event.action === 'move_n' || event.action === 'move_w' || event.action === 'move_nw' || event.action === 'move_sw' ? -1 : 1);
  return null;
}
