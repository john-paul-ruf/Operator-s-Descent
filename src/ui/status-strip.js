import { bus } from '../state/bus.js';
import { createSigilToken, createHPBar, createChargeBar, createManualLink } from './components.js';
import { createIcon } from './icon.js';
import { createLogEntryElement, collectLogEntries } from './console/log.js';
import { deriveStats } from '../rules/attributes.js';
import { resolveLoadout } from '../rules/equipment.js';

// SESSION-06 — telemetry dock field labels each lead with a lucide sprite
// so the wide-mode density pass reads as a proper "gauge dashboard" rather
// than a stack of ALL-CAPS text. `hash` is not in the current sprite subset;
// fall back to `chevron-right` for Seed per SESSION-06.md guidance.
const DOCK_ICONS = {
  Depth: 'gauge',
  Seed: 'chevron-right',
  Party: 'users',
  'Danger Clock': 'clock',
  Corruption: 'flame',
  Round: 'sparkles'
};

function safeIcon(id, opts = {}) {
  if (!id) return null;
  if (typeof document?.createElementNS !== 'function') return null;
  try { return createIcon(id, opts); } catch { return null; }
}

// the-manual SESSION-04 — `?` manual chip is the exploration/combat access point.
// Kept as a lightweight helper so both the portrait strip and the wide telemetry
// dock render an identical, testable affordance.
function appendManualChip(parent, source) {
  const chip = createManualLink(null, {
    variant: 'chip',
    label: '?',
    source,
    dispatch: (event, payload) => bus.dispatch(event, payload),
    testid: 'status-manual'
  });
  parent.appendChild(chip);
  return chip;
}

function actorList(combatState) {
  return combatState?.combatants instanceof Map
    ? [...combatState.combatants.values()]
    : Array.isArray(combatState?.combatants) ? combatState.combatants : [];
}

// Mirrors humanizeActorName in ./console/combat.js — duplicated (not imported) to
// respect the sibling-import boundary; keep the two in sync.
function titleCaseName(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}
function humanizeActorName(actor) {
  if (!actor) return 'Actor';
  if (actor.name) return actor.name;
  if (actor.classId) return titleCaseName(actor.classId);
  if (actor.archetypeId) return titleCaseName(actor.archetypeId);
  const match = String(actor.id ?? '').match(/^enemy_\d+_([a-z][a-z0-9]*)(?:_.+)?$/);
  if (match) return titleCaseName(match[1]);
  return String(actor.id ?? 'Actor');
}

// Fallback precedence for display maxes: explicit actor max → derived (from
// deriveStats when the game-data registry is available) → current. Combat
// actors carry true maxes after SESSION-01, so `derived` matters only for
// exploration-strip party rows (see `derivedFor` below).
function hpOf(actor, derived = null) {
  const current = actor.currentHP ?? actor.hp ?? 0;
  return {
    current,
    max: actor.maxHP ?? actor.hpMax ?? derived?.hpMax ?? current
  };
}

function chargeOf(actor, derived = null) {
  const current = actor.currentCHARGE ?? actor.charge ?? 0;
  return {
    current,
    max: actor.maxCHARGE ?? actor.chargeMax ?? derived?.chargeMax ?? current
  };
}

// Mirrors classDataFor in ./console/party.js — duplicated (not imported) to
// respect the sibling-import boundary; keep in sync.
function classDataFor(data, character) {
  return data?.classes?.classes?.find((entry) => entry.id === character?.classId) || null;
}

// Compute a display-side derived-stat record for a party character when the
// game-data registry is available (SESSION-01 wired `{ data }` into every
// createStatusBar/createTelemetryDock call site). Returns null when data is
// missing (unit tests without a registry) so hpOf/chargeOf fall back to the
// current value — preserving the pre-SESSION-02 behavior for those callers.
function derivedFor(character, data) {
  if (!data || !character) return null;
  const classData = classDataFor(data, character);
  try {
    const loadout = resolveLoadout(character, data.equipment, data.affixes) || character?.equipment || {};
    return deriveStats(character, classData, loadout);
  } catch { return null; }
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

function appendActorSummary(strip, actor, active = false, derived = null) {
  const summary = document.createElement('div');
  summary.className = active ? 'status-active-actor' : 'status-party-member';
  summary.style.display = 'flex';
  summary.style.alignItems = 'center';
  summary.style.gap = '4px';
  const role = roleOf(actor);
  const sigil = createSigilToken(sigilOf(actor), 34, { role, label: `${role} sigil ${humanizeActorName(actor)}` });
  sigil.classList.add(active ? 'status-active-sigil' : 'status-party-sigil');
  summary.appendChild(sigil);
  const hp = hpOf(actor, derived);
  const hpBar = createHPBar(hp.current, hp.max);
  hpBar.classList.add('status-mini-hp');
  summary.appendChild(hpBar);
  sigil.setAttribute('data-glitch', '');
  sigil.dataset.glitchIntensity = '0.15';
  strip.appendChild(summary);
  return { hp, summary };
}

// SESSION-02 — third-arg `options.data` is the M87 game-data registry, wired
// by SESSION-01 at every call site (screens/combat, screens/exploration, and
// the combat turn-rebuild path). It gives us the classes/equipment/affixes
// needed to derive display maxes for the exploration party row (`derivedFor`).
// It is also the registry read by createTelemetryDock's dock/log paths. When
// missing (unit tests without a registry) all derivations no-op and existing
// fallbacks apply.
export function createStatusBar(runState, combatState = null, options = {}) {
  const strip = document.createElement('div');
  strip.className = 'status-strip';
  strip.setAttribute('role', 'status');
  strip.setAttribute('aria-live', 'polite');
  strip.setAttribute('aria-atomic', 'true');
  const cleanups = [];
  const data = options.data || null;

  if (combatState) {
    strip.classList.add('status-strip-combat');
    strip.style.display = 'grid';
    strip.style.gridTemplateColumns = 'auto auto auto minmax(0, 1fr)';
    // SESSION-02 — tightened from `6px 12px` for phone density; the combat
    // strip is now the single source of truth for HP/CHARGE/AP/MV (SESSION-01
    // dropped the console-pane copy), so vertical room matters.
    strip.style.gap = '4px 8px';
    renderCombatStatus(strip, runState, combatState, data);
  } else {
    cleanups.push(renderExplorationStatus(strip, runState, data));
  }

  // Manual `?` chip — the last in-flow item of the strip so it never overlaps
  // other readouts. `margin-left: auto` pushes it to the trailing edge without
  // leaving the flex/grid flow. Cleanup registered via listen() in createManualLink.
  const chip = appendManualChip(strip, 'status-strip');
  chip.style.marginLeft = 'auto';
  chip.style.flexShrink = '0';
  cleanups.push(() => chip.cleanup?.());

  // Portrait collapse toggle (SESSION-02). Sits beside the manual chip and
  // adds/removes `status-collapsed` on the strip; CSS hides everything except
  // the summary row when collapsed. State is per-mount — the strip re-renders
  // per turn in combat, so persistence across turns is a future concern.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'status-collapse-toggle';
  toggle.dataset.testid = 'status-collapse';
  toggle.setAttribute('aria-controls', 'status-strip');
  toggle.setAttribute('aria-label', combatState ? 'Collapse combat status' : 'Collapse exploration status');
  toggle.setAttribute('aria-expanded', 'true');
  toggle.textContent = '▴';
  toggle.style.marginLeft = '4px';
  toggle.style.flexShrink = '0';
  toggle.addEventListener('click', () => {
    const collapsed = !strip.classList.contains('status-collapsed');
    strip.classList.toggle('status-collapsed', collapsed);
    toggle.textContent = collapsed ? '▾' : '▴';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });
  strip.appendChild(toggle);

  strip.cleanup = () => cleanups.forEach((cleanup) => cleanup?.());
  return strip;
}

function renderExplorationStatus(strip, runState, data = null) {
  appendText(createGroup(strip, 'status-depth', 'DEPTH'), 'status-depth', String(runState.depth).padStart(2, '0'), `Depth ${runState.depth}`);
  appendText(createGroup(strip, 'status-seed', 'SEED'), 'status-seed', truncatedSeed(runState.worldSeed), `World seed ${runState.worldSeed}`);
  const partyGroup = createGroup(strip, 'status-party', 'PARTY');
  const party = document.createElement('div');
  party.className = 'status-party-list';
  party.style.display = 'flex';
  party.style.gap = '4px';
  partyGroup.appendChild(party);
  for (const character of runState.party || []) appendActorSummary(party, character, false, derivedFor(character, data));
  appendText(createGroup(strip, 'status-danger', 'DANGER'), 'status-corruption', `COR ${Number(runState.corruption || 0).toFixed(2)}`, `Corruption ${Number(runState.corruption || 0).toFixed(2)}`);
  const clockEl = appendText(createGroup(strip, 'status-clock', 'CLK'), 'status-clock', Number(runState.dangerClockProgress || 0).toFixed(2), `Danger clock ${Number(runState.dangerClockProgress || 0).toFixed(2)}`);
  return bus.on('state:danger-clock-tick', (payload = {}) => {
    const progress = Number(payload.progress ?? runState.dangerClockProgress ?? 0).toFixed(2);
    clockEl.textContent = progress;
    clockEl.setAttribute('aria-label', `Danger clock ${progress}`);
  });
}

// SESSION-02 — the combat strip is portrait-phone-tight and the sole owner of
// HP/CHARGE/AP/MV, so its labels lose a pixel of type and its groups collapse
// their internal gap. Applied only to the combat branch; exploration keeps
// the createGroup defaults so its dense-info row stays legible.
function compactLabel(group) {
  group.style.gap = '1px';
  const label = group.firstChild;
  if (label && label.style) {
    label.style.fontSize = '8px';
    label.style.letterSpacing = '0.08em';
  }
  return group;
}

function renderCombatStatus(strip, runState, combatState, data = null) {
  appendText(compactLabel(createGroup(strip, 'status-depth-combat', 'DEPTH')), 'status-depth-combat', String(runState.depth).padStart(2, '0'), `Depth ${runState.depth}`);
  appendText(compactLabel(createGroup(strip, 'status-round', 'ROUND')), 'status-round', String(combatState.round || 1).padStart(2, '0'), `Combat round ${combatState.round || 1}`);
  appendText(compactLabel(createGroup(strip, 'status-seed-combat', 'SEED')), 'status-seed', truncatedSeed(runState.worldSeed), `World seed ${runState.worldSeed}`);
  const actors = actorList(combatState);
  const activeId = combatState.turnOrder?.[combatState.currentTurn];
  const active = actors.find((actor) => actor.id === activeId);
  const order = (combatState.turnOrder || []).slice(combatState.currentTurn || 0, (combatState.currentTurn || 0) + 6);
  const initiative = compactLabel(createGroup(strip, 'status-initiative', '◈ INITIATIVE ORDER'));
  initiative.style.gridColumn = '1 / -1';
  initiative.style.gridRow = '2';
  const rail = document.createElement('div');
  rail.className = 'init-rail status-initiative';
  // Slim the initiative rail to a single compact line (sigils remain 34px per
  // accessibility tiers). CSS default is 4px 8px — halve it inline.
  rail.style.padding = '2px 4px';
  rail.setAttribute('aria-label', `Initiative preview ${order.join(', ') || 'none'}`);
  for (const [index, id] of order.entries()) {
    const actor = actors.find((candidate) => candidate.id === id);
    if (!actor) continue;
    const slot = document.createElement('div');
    slot.className = `init-slot${index === 0 ? ' active' : ''}${roleOf(actor) === 'enemy' ? ' enemy' : ''}`;
    const sigil = createSigilToken(sigilOf(actor), 34, { role: roleOf(actor), label: `${humanizeActorName(actor)} initiative ${index + 1}` });
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
  // Combat actors already carry true maxHP/maxCHARGE after SESSION-01 (M71
  // normalizeCombatActor + M86 rehydrate). Derived is a defensive fallback
  // if a party member is somehow present without a derived max — the runState
  // party character (matched by id) still has attributes we can derive from.
  const partyMatch = (runState.party || []).find((c) => c.id === active.id);
  const derived = active.side === 'party' && partyMatch ? derivedFor(partyMatch, data) : null;
  appendActorSummary(activeGroup, active, true, derived);
  const charge = chargeOf(active, derived);
  const chargeBar = createChargeBar(charge.current, charge.max);
  chargeBar.classList.add('status-mini-charge');
  activeGroup.appendChild(chargeBar);
  appendText(activeGroup, 'status-ap', `AP ${active.ap ?? 0}`, `Action points ${active.ap ?? 0}`);
  appendText(activeGroup, 'status-move', active.moveAvailable ? '1 MV' : '0 MV', active.moveAvailable ? 'Move available' : 'Move spent');
}

function appendDockField(header, label, valueBuilder) {
  const row = document.createElement('div');
  row.className = 'wide-telemetry-field';
  const labelEl = document.createElement('span');
  labelEl.className = 'wide-telemetry-label';
  // textContent set first so tests reading `labelEl.textContent` still see
  // the label string; the icon child is then prepended so the sprite renders
  // before the text in the browser DOM. The fake-DOM `.textContent` remains
  // a plain stored property regardless of appended children.
  labelEl.textContent = label;
  labelEl.setAttribute('aria-label', label);
  const icon = safeIcon(DOCK_ICONS[label], { size: 14, tone: 'dim' });
  if (icon) {
    if (typeof labelEl.prepend === 'function') labelEl.prepend(icon);
    else labelEl.appendChild(icon);
  }
  const valueEl = valueBuilder();
  valueEl.classList.add('wide-telemetry-value');
  row.append(labelEl, valueEl);
  header.appendChild(row);
  return { row, valueEl };
}

function textSpan(className, text, ariaLabel = null) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
  return el;
}

function renderPartySigils(runState, data = null) {
  const wrap = document.createElement('span');
  wrap.className = 'wide-telemetry-party';
  wrap.style.display = 'flex';
  wrap.style.gap = '6px';
  wrap.style.alignItems = 'center';
  for (const character of runState?.party || []) {
    const role = roleOf(character);
    const sigil = createSigilToken(sigilOf(character), 34, { role, label: `${role} sigil ${humanizeActorName(character)}` });
    sigil.classList.add('wide-telemetry-party-sigil');
    const hp = hpOf(character, derivedFor(character, data));
    const bar = createHPBar(hp.current, hp.max);
    bar.classList.add('wide-telemetry-party-hp');
    wrap.append(sigil, bar);
  }
  return wrap;
}

function renderCombatDock(dock, runState, combatState, data = null) {
  const actors = actorList(combatState);
  const activeId = combatState.turnOrder?.[combatState.currentTurn];
  const active = actors.find((actor) => actor.id === activeId) || null;

  const initBlock = document.createElement('div');
  initBlock.className = 'wide-init-block';
  initBlock.dataset.testid = 'telemetry-init-block';
  const initHeader = document.createElement('div');
  initHeader.className = 'wide-init-header';
  initHeader.textContent = '◈ INITIATIVE ORDER';
  initBlock.appendChild(initHeader);
  const rail = document.createElement('div');
  rail.className = 'wide-init-rail init-rail';
  rail.setAttribute('aria-label', 'Combat initiative rail');
  const currentTurn = combatState.currentTurn || 0;
  const turnOrder = combatState.turnOrder || [];
  const nameByIndex = new Map();
  const seenCounts = new Map();
  const totals = new Map();
  for (const id of turnOrder) {
    const actor = actors.find((candidate) => candidate.id === id);
    if (!actor) continue;
    const base = humanizeActorName(actor);
    totals.set(base, (totals.get(base) || 0) + 1);
  }
  for (const [index, id] of turnOrder.entries()) {
    const actor = actors.find((candidate) => candidate.id === id);
    if (!actor) continue;
    const base = humanizeActorName(actor);
    if (totals.get(base) > 1) {
      const n = (seenCounts.get(base) || 0) + 1;
      seenCounts.set(base, n);
      nameByIndex.set(id, `${base} ${n}`);
    } else {
      nameByIndex.set(id, base);
    }
  }
  for (const [index, id] of turnOrder.entries()) {
    const actor = actors.find((candidate) => candidate.id === id);
    if (!actor) continue;
    const slot = document.createElement('div');
    const isActive = index === currentTurn;
    const isSpent = index < currentTurn || (actor.hp ?? actor.currentHP ?? 1) <= 0;
    slot.className = `init-slot${isActive ? ' active' : ''}${roleOf(actor) === 'enemy' ? ' enemy' : ''}${isSpent ? ' spent' : ''}`;
    slot.dataset.testid = `telemetry-init-${id}`;
    // Wide dock cell is 1fr in a 2-column grid; override the 34px .init-slot cap
    // so humanized labels fit without stacking on top of each other.
    slot.style.width = 'auto';
    slot.style.height = 'auto';
    slot.style.minWidth = '0';
    slot.style.padding = '6px 8px';
    slot.style.overflow = 'hidden';
    slot.style.justifyContent = 'flex-start';
    slot.style.gap = '8px';
    const displayName = nameByIndex.get(id) || humanizeActorName(actor);
    const sigil = createSigilToken(sigilOf(actor), 34, { role: roleOf(actor), label: `${displayName} initiative ${index + 1}` });
    sigil.classList.add('init-sigil');
    slot.appendChild(sigil);
    const order = document.createElement('span');
    order.className = 'init-order';
    order.textContent = `${index + 1} · ${displayName}`;
    order.style.overflow = 'hidden';
    order.style.textOverflow = 'ellipsis';
    order.style.whiteSpace = 'nowrap';
    order.style.minWidth = '0';
    slot.appendChild(order);
    rail.appendChild(slot);
  }
  initBlock.appendChild(rail);
  dock.appendChild(initBlock);

  if (!active) return;
  const activeBlock = document.createElement('div');
  activeBlock.className = 'wide-active-actor';
  activeBlock.dataset.testid = 'telemetry-active-actor';
  const header = document.createElement('div');
  header.className = 'wide-active-header';
  const activeName = humanizeActorName(active);
  header.appendChild(createSigilToken(sigilOf(active), 34, { role: roleOf(active), label: `Active ${activeName}` }));
  const nameEl = document.createElement('div');
  nameEl.className = 'wide-active-name';
  nameEl.textContent = `${activeName.toUpperCase()} · ACTIVE`;
  header.appendChild(nameEl);
  const apEl = document.createElement('div');
  apEl.className = 'wide-active-ap';
  apEl.textContent = `${active.ap ?? 0} AP · ${active.moveAvailable ? '1 MV' : '0 MV'}`;
  header.appendChild(apEl);
  activeBlock.appendChild(header);

  // Combat actors carry true maxes after SESSION-01, but keep a derived
  // fallback for a party-side active whose combat record was missing them.
  const partyMatch = (runState.party || []).find((c) => c.id === active.id);
  const derived = active.side === 'party' && partyMatch ? derivedFor(partyMatch, data) : null;
  const hp = hpOf(active, derived);
  const hpRow = document.createElement('div');
  hpRow.className = 'wide-active-bar-row';
  hpRow.append(textSpan('wide-active-hp-label', 'HP'), createHPBar(hp.current, hp.max), textSpan('wide-active-hp-value', `${hp.current} / ${hp.max}`));
  activeBlock.appendChild(hpRow);

  const charge = chargeOf(active, derived);
  const chargeRow = document.createElement('div');
  chargeRow.className = 'wide-active-bar-row';
  chargeRow.append(textSpan('wide-active-charge-label accent-text', 'CHG'), createChargeBar(charge.current, charge.max), textSpan('wide-active-charge-value accent-text', `${charge.current} / ${charge.max}`));
  activeBlock.appendChild(chargeRow);

  const conds = document.createElement('div');
  conds.className = 'wide-active-conds';
  for (const condition of active.conditions || []) {
    const tag = document.createElement('span');
    const id = condition.id || condition.conditionId || String(condition);
    tag.className = `condition-tag cond-${id}`;
    tag.textContent = condition.duration != null ? `${id} (${condition.duration})` : id;
    conds.appendChild(tag);
  }
  activeBlock.appendChild(conds);
  dock.appendChild(activeBlock);
}

export function createTelemetryDock(runState, combatState = null, options = {}) {
  const data = options.data || null;
  const dock = document.createElement('aside');
  dock.className = 'wide-telemetry-dock';
  dock.setAttribute('role', 'status');
  dock.setAttribute('aria-live', 'polite');
  dock.dataset.testid = 'telemetry-dock';
  const cleanups = [];

  const header = document.createElement('div');
  header.className = 'wide-telemetry-header';
  dock.appendChild(header);

  // Manual `?` chip — an in-flow participant in the dock header so it never
  // covers the DEPTH value. Placement/sizing live in styles/wide.css
  // `.wide-telemetry-manual-chip` (in-flow, not absolute).
  const chip = appendManualChip(header, 'status-strip');
  chip.classList.add('wide-telemetry-manual-chip');
  cleanups.push(() => chip.cleanup?.());

  appendDockField(header, 'Depth', () => textSpan('', String(runState?.depth ?? 0).padStart(2, '0'), `Depth ${runState?.depth ?? 0}`));
  if (combatState) {
    appendDockField(header, 'Round', () => textSpan('', String(combatState.round || 1).padStart(2, '0'), `Combat round ${combatState.round || 1}`));
  }
  appendDockField(header, 'Seed', () => textSpan('', truncatedSeed(runState?.worldSeed), `World seed ${runState?.worldSeed}`));
  appendDockField(header, 'Party', () => renderPartySigils(runState, data));

  const clockValue = String(Number(runState?.dangerClockProgress || 0).toFixed(2));
  const clockField = appendDockField(header, 'Danger Clock', () => {
    const el = textSpan('wide-telemetry-clock', clockValue, `Danger clock ${clockValue}`);
    el.dataset.testid = 'telemetry-clock';
    return el;
  });
  cleanups.push(bus.on('state:danger-clock-tick', (payload = {}) => {
    const progress = Number(payload.progress ?? runState?.dangerClockProgress ?? 0).toFixed(2);
    clockField.valueEl.textContent = progress;
    clockField.valueEl.setAttribute('aria-label', `Danger clock ${progress}`);
  }));

  appendDockField(header, 'Corruption', () => textSpan('', Number(runState?.corruption || 0).toFixed(2), `Corruption ${Number(runState?.corruption || 0).toFixed(2)}`));

  if (combatState) renderCombatDock(dock, runState, combatState, data);

  const feed = document.createElement('div');
  feed.className = 'wide-log-feed';
  const feedHeader = document.createElement('div');
  feedHeader.className = 'wide-log-feed-header';
  feedHeader.textContent = `◈ Event Log — Floor ${String(runState?.depth || 1).padStart(2, '0')}`;
  const scroll = document.createElement('div');
  scroll.className = 'wide-log-feed-scroll scroll-area';
  scroll.dataset.testid = 'telemetry-log-feed';
  feed.append(feedHeader, scroll);
  dock.appendChild(feed);

  const localEntries = [];
  function paint() {
    while (scroll.firstChild) scroll.removeChild(scroll.firstChild);
    const entries = collectLogEntries({ runState, logEntries: localEntries });
    entries.forEach((entry, index) => scroll.appendChild(createLogEntryElement(entry, index)));
    scroll.scrollTop = scroll.scrollHeight;
  }
  paint();
  cleanups.push(bus.on('ui:log-entry', (entry) => {
    if (!entry) return;
    localEntries.push(entry);
    if (localEntries.length > 128) localEntries.splice(0, localEntries.length - 128);
    paint();
  }));

  dock.cleanup = () => cleanups.forEach((cleanup) => cleanup?.());
  return dock;
}
