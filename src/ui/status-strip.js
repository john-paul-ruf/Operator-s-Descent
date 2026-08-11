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

function truncatedSeed(seed) {
  const text = String(seed ?? '—');
  return text.length > 10 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

function appendActorSummary(strip, actor, active = false) {
  const role = roleOf(actor);
  const sigil = createSigilToken(sigilOf(actor), 34, { role, label: `${role} sigil ${actor.name || actor.id || ''}`.trim() });
  sigil.classList.add(active ? 'status-active-sigil' : 'status-party-sigil');
  strip.appendChild(sigil);
  const hp = hpOf(actor);
  const hpBar = createHPBar(hp.current, hp.max);
  hpBar.classList.add('status-mini-hp');
  strip.appendChild(hpBar);
  sigil.setAttribute('data-glitch', '');
  sigil.dataset.glitchIntensity = '0.15';
  return { hp };
}

export function createStatusBar(runState, combatState = null) {
  const strip = document.createElement('div');
  strip.className = 'status-strip';
  strip.setAttribute('role', 'status');
  strip.setAttribute('aria-live', 'polite');
  strip.setAttribute('aria-atomic', 'true');
  const cleanups = [];

  appendText(strip, 'status-depth', `D${runState.depth}`, `Depth ${runState.depth}`);

  if (combatState) {
    renderCombatStatus(strip, runState, combatState);
  } else {
    cleanups.push(renderExplorationStatus(strip, runState));
  }

  strip.cleanup = () => cleanups.forEach((cleanup) => cleanup?.());
  return strip;
}

function renderExplorationStatus(strip, runState) {
  appendText(strip, 'status-seed', `SEED ${truncatedSeed(runState.worldSeed)}`, `World seed ${runState.worldSeed}`);
  const party = runState.party || [];
  for (const character of party) appendActorSummary(strip, character);
  appendText(strip, 'status-corruption', `COR ${Number(runState.corruption || 0).toFixed(2)}`, `Corruption ${Number(runState.corruption || 0).toFixed(2)}`);
  const clockEl = appendText(strip, 'status-clock', `CLK ${Number(runState.dangerClockProgress || 0).toFixed(2)}`, `Danger clock ${Number(runState.dangerClockProgress || 0).toFixed(2)}`);
  return bus.on('state:danger-clock-tick', (payload = {}) => {
    const progress = Number(payload.progress ?? runState.dangerClockProgress ?? 0).toFixed(2);
    clockEl.textContent = `CLK ${progress}`;
    clockEl.setAttribute('aria-label', `Danger clock ${progress}`);
  });
}

function renderCombatStatus(strip, runState, combatState) {
  appendText(strip, 'status-round', `R${combatState.round || 1}`, `Combat round ${combatState.round || 1}`);
  const actors = actorList(combatState);
  const activeId = combatState.turnOrder?.[combatState.currentTurn];
  const active = actors.find((actor) => actor.id === activeId);
  const preview = (combatState.turnOrder || []).slice(combatState.currentTurn || 0, (combatState.currentTurn || 0) + 5).join(' › ');
  appendText(strip, 'status-initiative', `INIT ${preview || '—'}`, `Initiative preview ${preview || 'none'}`);
  if (!active) return;
  appendActorSummary(strip, active, true);
  const charge = chargeOf(active);
  const chargeBar = createChargeBar(charge.current, charge.max);
  chargeBar.classList.add('status-mini-charge');
  strip.appendChild(chargeBar);
  appendText(strip, 'status-ap', `AP ${active.ap ?? 0}`, `Action points ${active.ap ?? 0}`);
  appendText(strip, 'status-move', active.moveAvailable ? 'MOVE READY' : 'MOVE SPENT', active.moveAvailable ? 'Move available' : 'Move spent');
}
