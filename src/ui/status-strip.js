import { bus } from '../state/bus.js';
import { createSigilToken, createHPBar, createChargeBar } from './components.js';

function actorList(combatState) {
  return combatState?.combatants instanceof Map
    ? [...combatState.combatants.values()]
    : Array.isArray(combatState?.combatants) ? combatState.combatants : [];
}

function hpOf(actor) {
  return {
    current: actor.currentHP ?? actor.hp ?? 0,
    max: actor.maxHP ?? actor.hpMax ?? actor.currentHP ?? actor.hp ?? 0
  };
}

function chargeOf(actor) {
  return {
    current: actor.currentCHARGE ?? actor.charge ?? 0,
    max: actor.maxCHARGE ?? actor.chargeMax ?? actor.currentCHARGE ?? actor.charge ?? 0
  };
}

function roleOf(actor) {
  return actor.side === 'enemy' ? 'enemy' : actor.side === 'echo' ? 'echo' : 'player';
}

function sigilOf(actor) {
  return actor.sigilCodepoint || actor.sigilId || (roleOf(actor) === 'enemy' ? 0xE030 : 0xE000);
}

function appendText(parent, className, text, ariaLabel = null) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
  parent.appendChild(el);
  return el;
}

function createGroup(strip, className, label) {
  const group = document.createElement('div');
  group.className = `status-group ${className}-group`;
  group.style.display = 'flex';
  group.style.flexDirection = 'column';
  group.style.justifyContent = 'center';
  group.style.gap = '2px';
  group.style.flexShrink = '0';
  const labelEl = appendText(group, 'status-label', label);
  labelEl.style.color = 'var(--text-secondary)';
  labelEl.style.fontSize = '9px';
  labelEl.style.letterSpacing = '0.1em';
  labelEl.style.textTransform = 'uppercase';
  labelEl.setAttribute('aria-hidden', 'true');
  strip.appendChild(group);
  return group;
}

function truncatedSeed(seed) {
  const text = String(seed ?? '—');
  return text.length > 10 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

function appendActorSummary(strip, actor, active = false) {
  const summary = document.createElement('div');
  summary.className = active ? 'status-active-actor' : 'status-party-member';
  summary.style.display = 'flex';
  summary.style.alignItems = 'center';
  summary.style.gap = '4px';
  const role = roleOf(actor);
  const sigil = createSigilToken(sigilOf(actor), 34, { role, label: `${role} sigil ${actor.name || actor.id || ''}`.trim() });
  sigil.classList.add(active ? 'status-active-sigil' : 'status-party-sigil');
  summary.appendChild(sigil);
  const hp = hpOf(actor);
  const hpBar = createHPBar(hp.current, hp.max);
  hpBar.classList.add('status-mini-hp');
  summary.appendChild(hpBar);
  sigil.setAttribute('data-glitch', '');
  sigil.dataset.glitchIntensity = '0.15';
  strip.appendChild(summary);
  return { hp, summary };
}

export function createStatusBar(runState, combatState = null) {
  const strip = document.createElement('div');
  strip.className = 'status-strip';
  strip.setAttribute('role', 'status');
  strip.setAttribute('aria-live', 'polite');
  strip.setAttribute('aria-atomic', 'true');
  const cleanups = [];

  if (combatState) {
    strip.classList.add('status-strip-combat');
    strip.style.display = 'grid';
    strip.style.gridTemplateColumns = 'auto auto auto minmax(0, 1fr)';
    strip.style.gap = '6px 12px';
    renderCombatStatus(strip, runState, combatState);
  } else {
    cleanups.push(renderExplorationStatus(strip, runState));
  }

  strip.cleanup = () => cleanups.forEach((cleanup) => cleanup?.());
  return strip;
}

function renderExplorationStatus(strip, runState) {
  appendText(createGroup(strip, 'status-depth', 'DEPTH'), 'status-depth', String(runState.depth).padStart(2, '0'), `Depth ${runState.depth}`);
  appendText(createGroup(strip, 'status-seed', 'SEED'), 'status-seed', truncatedSeed(runState.worldSeed), `World seed ${runState.worldSeed}`);
  const partyGroup = createGroup(strip, 'status-party', 'PARTY');
  const party = document.createElement('div');
  party.className = 'status-party-list';
  party.style.display = 'flex';
  party.style.gap = '4px';
  partyGroup.appendChild(party);
  for (const character of runState.party || []) appendActorSummary(party, character);
  appendText(createGroup(strip, 'status-danger', 'DANGER'), 'status-corruption', `COR ${Number(runState.corruption || 0).toFixed(2)}`, `Corruption ${Number(runState.corruption || 0).toFixed(2)}`);
  const clockEl = appendText(createGroup(strip, 'status-clock', 'CLK'), 'status-clock', Number(runState.dangerClockProgress || 0).toFixed(2), `Danger clock ${Number(runState.dangerClockProgress || 0).toFixed(2)}`);
  return bus.on('state:danger-clock-tick', (payload = {}) => {
    const progress = Number(payload.progress ?? runState.dangerClockProgress ?? 0).toFixed(2);
    clockEl.textContent = progress;
    clockEl.setAttribute('aria-label', `Danger clock ${progress}`);
  });
}

function renderCombatStatus(strip, runState, combatState) {
  appendText(createGroup(strip, 'status-depth-combat', 'DEPTH'), 'status-depth-combat', String(runState.depth).padStart(2, '0'), `Depth ${runState.depth}`);
  appendText(createGroup(strip, 'status-round', 'ROUND'), 'status-round', String(combatState.round || 1).padStart(2, '0'), `Combat round ${combatState.round || 1}`);
  appendText(createGroup(strip, 'status-seed-combat', 'SEED'), 'status-seed', truncatedSeed(runState.worldSeed), `World seed ${runState.worldSeed}`);
  const actors = actorList(combatState);
  const activeId = combatState.turnOrder?.[combatState.currentTurn];
  const active = actors.find((actor) => actor.id === activeId);
  const order = (combatState.turnOrder || []).slice(combatState.currentTurn || 0, (combatState.currentTurn || 0) + 6);
  const initiative = createGroup(strip, 'status-initiative', '◈ INITIATIVE ORDER');
  initiative.style.gridColumn = '1 / -1';
  initiative.style.gridRow = '2';
  const rail = document.createElement('div');
  rail.className = 'init-rail status-initiative';
  rail.setAttribute('aria-label', `Initiative preview ${order.join(', ') || 'none'}`);
  for (const [index, id] of order.entries()) {
    const actor = actors.find((candidate) => candidate.id === id);
    if (!actor) continue;
    const slot = document.createElement('div');
    slot.className = `init-slot${index === 0 ? ' active' : ''}${roleOf(actor) === 'enemy' ? ' enemy' : ''}`;
    const sigil = createSigilToken(sigilOf(actor), 34, { role: roleOf(actor), label: `${actor.name || actor.id} initiative ${index + 1}` });
    sigil.classList.add('init-sigil');
    sigil.setAttribute('data-glitch', '');
    sigil.dataset.glitchIntensity = '0.05';
    slot.appendChild(sigil);
    appendText(slot, 'init-position', String(index + 1));
    rail.appendChild(slot);
  }
  initiative.appendChild(rail);
  if (!active) return;
  const activeGroup = createGroup(strip, 'status-active', 'ACTIVE');
  activeGroup.style.gridColumn = '4';
  activeGroup.style.gridRow = '1';
  activeGroup.style.minWidth = '0';
  appendActorSummary(activeGroup, active, true);
  const charge = chargeOf(active);
  const chargeBar = createChargeBar(charge.current, charge.max);
  chargeBar.classList.add('status-mini-charge');
  activeGroup.appendChild(chargeBar);
  appendText(activeGroup, 'status-ap', `AP ${active.ap ?? 0}`, `Action points ${active.ap ?? 0}`);
  appendText(activeGroup, 'status-move', active.moveAvailable ? '1 MV' : '0 MV', active.moveAvailable ? 'Move available' : 'Move spent');
}
