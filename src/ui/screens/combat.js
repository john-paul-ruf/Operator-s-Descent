import { createStatusBar, createTelemetryDock } from '../status-strip.js';
import { createPlayfield, cellAtPoint, COMBAT_CELL_SIZE, COMBAT_GRID_W, COMBAT_GRID_H } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { attachWidePanes, currentLayoutClass } from '../layout.js';
import { loadSettings, saveSettings } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createRNGCursorForRun } from '../../core/rng-cursor.js';
import { createLattice } from '../../exploration/lattice.js';
import { createEnemy } from '../../rules/enemies.js';
import { initiateCombat, executeAction, resolveTurn, checkCombatEnd, getLegalActions, getCharacterDeaths, toCombatSnapshot, reachableMoveCells, isLegalMoveStep, MOVE_RANGE } from '../../rules/combat.js';
import { createStandardEncounter, completeEncounter } from '../../rules/encounters.js';
import { distanceCells, getEdgeCoverBonus, isFlanked } from '../../rules/combat-geometry.js';
import { evaluateRange, resolveLoadout, getAffixHooks, useAffixReroll } from '../../rules/equipment.js';
import { deriveStats } from '../../rules/attributes.js';
import { createViewportCamera, attachViewportGestures, sizeCanvasToContainer } from '../viewport.js';

const ACTION_PHASES = {
  attack: 'choose-target',
  cast: 'choose-protocol',
  overclock: 'choose-protocol',
  item: 'choose-item',
  move: 'choose-path',
  retreat: 'confirm',
  'end-turn': 'confirm'
};
const DEFAULT_WINDOW = { originX: 0, originY: 0, width: 8, height: 16, cells: Array.from({ length: 16 }, () => Array(8).fill(1)) };
const UNARMED = { damageDie: 'd6', rangeBand: 'adjacent', maxRange: 1, minRange: 0, accuracyBonus: 0 };
const DIRECTION_DELTAS = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] };
// Playback pacing (M71 log-replay). Move cells step at MOVE_STEP_MS each; a whole path renders
// path.length × MOVE_STEP_MS. Reaction-heavy entries (attack/protocol/condition/item) hold their
// flash frame for ACTION_STEP_MS. Notice-only entries (wait/end-turn/retreat/death) tick at NOTICE_STEP_MS.
const MOVE_STEP_MS = 140;
const ACTION_STEP_MS = 320;
const NOTICE_STEP_MS = 240;
// Portrait combat opens zoomed in so a world cell renders roughly this many CSS pixels.
// zoomToCells clamps to [fit, 4×fit], so a tiny viewport still degrades to fit.
const COMBAT_PORTRAIT_CELL_PX = 64;

// Duplicated from status-strip.js (sibling-import boundary). Keep the two in lockstep.
function titleCasePlayback(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}
function humanizeActorName(actor) {
  if (!actor) return 'Actor';
  if (actor.name) return actor.name;
  if (actor.classId) return titleCasePlayback(actor.classId);
  if (actor.archetypeId) return titleCasePlayback(actor.archetypeId);
  const match = String(actor.id ?? '').match(/^enemy_\d+_([a-z][a-z0-9]*)(?:_.+)?$/);
  if (match) return titleCasePlayback(match[1]);
  return String(actor.id ?? 'Actor');
}

function clear(element) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else while (element.firstChild) element.removeChild(element.firstChild);
}

function codepointFromSigilId(value) {
  const match = typeof value === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(value);
  return match ? Number.parseInt(match[1], 16) : null;
}

function actorSigil(actor, side) {
  return actor?.sigilCodepoint ?? codepointFromSigilId(actor?.sigilId) ?? (side === 'enemy' ? 0xE030 : 0xE000);
}

function actorSide(actor, fallback = 'party') {
  if (actor?.side === 'enemy' || actor?.side === 'echo') return actor.side;
  return fallback;
}

function normalizeCondition(condition) {
  if (typeof condition === 'string') return { id: condition, conditionId: condition, duration: 0 };
  const id = condition?.id ?? condition?.conditionId;
  return { ...condition, id, conditionId: id, duration: condition?.duration ?? 0 };
}

// Derive hpMax/chargeMax/defenseBase/effectiveAttributes for a party actor from its class +
// loadout via the canonical rules.attributes.deriveStats function. Returns null when the class
// registry is unavailable (test envs without the data pack) so the caller falls back to the
// pre-derivation path.
function derivedPartyStats(actor, data) {
  const classData = data?.classes?.classes?.find((entry) => entry.id === actor?.classId) || null;
  if (!classData) return null;
  const loadout = data ? resolveLoadout(actor, data.equipment, data.affixes) : null;
  const derived = deriveStats(actor, classData, loadout || actor?.equipment || {});
  return { hpMax: derived.hpMax, chargeMax: derived.chargeMax, defenseBase: derived.defenseBase, effectiveAttributes: derived.effectiveAttributes };
}

// Lucky availability (D2/SESSION-01 contract): the first equipped item carrying an unclaimed
// once-per-floor reroll charge, scanned in equipment order (weapon, armor, offhand). Combat-only,
// never persisted (D6) — recomputed fresh at every construction from the persisted
// runState.affixFloorLedger. Returns null when no item qualifies (nothing to reroll with, or
// every qualifying item is already claimed this floor).
function luckyRerollFor(equipment, data, runState) {
  if (!data?.affixes) return null;
  const claimed = runState?.affixFloorLedger?.reroll || [];
  for (const item of Object.values(equipment || {})) {
    if (!item?.id || claimed.includes(item.id)) continue;
    if (getAffixHooks(item.affixes, data.affixes).reroll.perFloor > 0) return { available: true, itemId: item.id };
  }
  return null;
}

function normalizeCombatActor(actor, fallbackSide = 'party', data = null, runState = null) {
  const side = actorSide(actor, fallbackSide);
  const equipment = actor?.equipment || { weapon: actor?.weapon ?? null, armor: actor?.armor ?? null, offhand: actor?.offhand ?? null };
  const hp = actor?.hp ?? actor?.currentHP ?? 1;
  const charge = actor?.charge ?? actor?.currentCHARGE ?? 0;
  // Resolve object-form equipment through the catalog so the engine sees real
  // damageDie/rangeBand/maxRange. A null loadout (equipment-less enemy) falls
  // through so the caller's UNARMED_WEAPON / archetype fallback stays intact.
  const loadout = data && actor?.equipment ? resolveLoadout(actor, data.equipment, data.affixes) : null;
  // Derive party stats for every actor with a resolvable class (not only when hpMax/chargeMax
  // are missing) — SESSION-04: DEF and FIN-penalized effective attributes must be real for every
  // party combatant entering combat, not only the injured-resume fallback case. Enemies, echoes,
  // and actors without a resolvable class fall through to the pre-derivation path below.
  const derived = side === 'party' ? derivedPartyStats(actor, data) : null;
  return {
    ...actor,
    side,
    hp,
    hpMax: actor?.hpMax ?? actor?.maxHP ?? Math.max(derived?.hpMax ?? hp, hp),
    charge,
    chargeMax: actor?.chargeMax ?? actor?.maxCHARGE ?? Math.max(derived?.chargeMax ?? charge, charge),
    protocols: actor?.protocols ?? actor?.protocolDeck ?? [],
    protocolDeck: actor?.protocolDeck ?? actor?.protocols ?? [],
    equipment,
    weapon: loadout?.weapon ?? actor?.weapon ?? equipment.weapon ?? null,
    armor: loadout?.armor ?? actor?.armor ?? equipment.armor ?? null,
    offhand: loadout?.offhand ?? actor?.offhand ?? equipment.offhand ?? null,
    sigilCodepoint: actorSigil(actor, side),
    conditions: (actor?.conditions || []).map(normalizeCondition),
    defense: actor?.defense ?? derived?.defenseBase,
    effectiveAttributes: actor?.effectiveAttributes ?? derived?.effectiveAttributes,
    ...(side === 'party' ? { luckyReroll: luckyRerollFor(equipment, data, runState) } : {})
  };
}

function normalizeEncounter(encounter, data = null, runState = null) {
  if (!encounter || !Array.isArray(encounter.actors)) return null;
  return {
    ...encounter,
    window: encounter.window || DEFAULT_WINDOW,
    actors: encounter.actors.map((actor) => normalizeCombatActor(actor, actor?.side || 'enemy', data, runState))
  };
}

function normalizeCombatState(combatState, data = null, runState = null) {
  if (!combatState) return null;
  const entries = combatState.combatants instanceof Map
    ? [...combatState.combatants.entries()].map(([id, actor]) => [id, normalizeCombatActor(actor, actor?.side || 'party', data, runState)])
    : Array.isArray(combatState.combatants)
      ? combatState.combatants.map((actor) => [actor.id, normalizeCombatActor(actor, actor?.side || 'party', data, runState)])
      : null;
  if (!entries) return null;
  combatState.combatants = new Map(entries);
  combatState.turnOrder = [...(combatState.turnOrder || entries.map(([id]) => id))];
  combatState.log = [...(combatState.log || [])];
  combatState.window = combatState.window || DEFAULT_WINDOW;
  combatState.ended = Boolean(combatState.ended);
  combatState.result = combatState.result ?? null;
  combatState.turnStarted = Boolean(combatState.turnStarted);
  return combatState;
}

function normalizeEnemySpawns(spawns, depth, rngCursor, enemiesData) {
  return (spawns || []).map((spawn, index) => {
    if (!spawn) return null;
    const position = spawn.position || { x: spawn.x ?? 0, y: spawn.y ?? 0 };
    if (spawn.hp !== undefined && spawn.hpMax !== undefined && spawn.defense !== undefined) {
      return normalizeCombatActor({ ...spawn, id: spawn.id ?? `enemy_${depth}_${index}`, side: 'enemy', position }, 'enemy');
    }
    const enemy = createEnemy(spawn.archetypeId, depth, rngCursor, enemiesData);
    return enemy ? normalizeCombatActor({ ...enemy, id: spawn.id ?? enemy.id, side: 'enemy', position }, 'enemy') : null;
  }).filter(Boolean);
}

function fallbackEncounter(floor, runState, rngCursor, data) {
  const enemies = data.enemies ? normalizeEnemySpawns(floor?.enemySpawns, runState.depth, rngCursor, data.enemies) : [];
  return normalizeEncounter(createStandardEncounter(floor, runState.partyPosition || floor?.entryPoint || { x: 0, y: 0 }, runState.party || [], enemies, rngCursor), data, runState);
}

function windowLattice(window) {
  const cells = window?.cells || DEFAULT_WINDOW.cells;
  return {
    getGrid: () => cells,
    getWidth: () => window?.width || cells[0]?.length || 8,
    getHeight: () => window?.height || cells.length || 16,
    isWall: (x, y) => cells[y]?.[x] === 0
  };
}

function getActors(combatState) {
  return combatState?.combatants instanceof Map ? [...combatState.combatants.values()] : [];
}

function getActiveActor(combatState) {
  const id = combatState?.turnOrder?.[combatState.currentTurn];
  return combatState?.combatants?.get(id) || null;
}

function themeFor(floor, data) {
  return data?.themes?.themes?.find((entry) => entry.id === floor?.themeId) ?? null;
}

function protocolData(data, protocol) {
  return data?.protocols?.schools?.[protocol?.school]?.tiers?.[protocol?.tier - 1] || null;
}

function consumableItems(runState) {
  return (runState?.inventory || []).filter((item) => item.category === 'consumable' && item.baseType);
}

function conditionForSave(condition) {
  const id = condition?.conditionId ?? condition?.id;
  return { conditionId: id, duration: condition?.duration ?? 0, ...(condition?.stacks == null ? {} : { stacks: condition.stacks }) };
}

function syncRunStateFromCombat(runState, combatState, { removeDead = false } = {}) {
  const actorsById = new Map(getActors(combatState).filter((actor) => actor.side === 'party').map((actor) => [actor.id, actor]));
  const dead = new Set();
  for (const member of runState.party || []) {
    const actor = actorsById.get(member.id);
    if (!actor) continue;
    member.currentHP = Math.max(0, Math.floor(actor.hp ?? member.currentHP ?? 0));
    member.currentCHARGE = Math.max(0, Math.floor(actor.charge ?? member.currentCHARGE ?? 0));
    member.conditions = (actor.conditions || []).map(conditionForSave).filter((condition) => condition.conditionId);
    if (member.currentHP <= 0) dead.add(member.id);
  }
  if (removeDead && dead.size) runState.party = runState.party.filter((member) => !dead.has(member.id));
}

function updateRunCombatSnapshot(runState, combatState) {
  runState.activeCombat = combatState.ended ? null : toCombatSnapshot(combatState);
}

function formatLog(entry) {
  if (!entry) return 'Combat event.';
  if (entry.type === 'attack') return `${entry.actorId} attacks ${entry.targetId}: ${entry.hit ? `${entry.damage} damage` : 'miss'}.`;
  if (entry.type === 'move') return `${entry.actorId} moves ${entry.direction}.`;
  if (entry.type === 'protocol') return `${entry.actorId} casts ${entry.school}-${entry.tier}.`;
  if (entry.type === 'item') return `${entry.actorId} uses ${entry.consumableId}.`;
  if (entry.type === 'retreat') return `${entry.actorId} retreat ${entry.success ? 'succeeds' : 'fails'}.`;
  if (entry.type === 'death') return `${entry.targetId || entry.actorId} dies.`;
  if (entry.type === 'end-turn' || entry.type === 'wait') return `${entry.actorId} ends turn.`;
  return `${entry.type || 'combat'} event.`;
}

// Signed modifier chunk formatter used by describeEntryDetail. Returns null for a
// zero/absent value so callers can drop the chunk entirely; positives get `+N`,
// negatives get `−N` (unicode minus, matches the design spec's line examples).
function formatSignedModifier(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function describeAttackDetail(entry) {
  if (!Number.isFinite(entry.naturalRoll)) return '';
  const parts = [`d20 ${entry.naturalRoll}`];
  const attrLabel = entry.attribute ? String(entry.attribute).toUpperCase() : null;
  const attrMod = formatSignedModifier(entry.attributeModifier);
  if (attrMod && attrLabel) parts.push(`${attrMod} ${attrLabel}`);
  const accMod = formatSignedModifier(entry.weaponAccuracy);
  if (accMod) parts.push(`${accMod} ACC`);
  const markMod = formatSignedModifier(entry.markedBonus);
  if (markMod) parts.push(`${markMod} MARK`);
  const blindMod = formatSignedModifier(entry.blindedPenalty);
  if (blindMod) parts.push(`${blindMod} BLIND`);
  const flankMod = formatSignedModifier(entry.flankBonus);
  if (flankMod) parts.push(`${flankMod} FLANK`);
  const total = Number.isFinite(entry.roll) ? ` = ${entry.roll}` : '';
  let defense = '';
  if (Number.isFinite(entry.targetDefense)) {
    defense = ` vs DEF ${entry.targetDefense}`;
    const coverMod = formatSignedModifier(entry.coverBonus);
    if (coverMod) defense += ` (incl. ${coverMod} COVER)`;
  }
  let outcome;
  if (entry.hit) {
    outcome = ' → HIT';
    if (entry.crit) outcome += ' CRIT';
    if (entry.damageDie && Number.isFinite(entry.damage)) {
      outcome += ` · ${entry.damageDie}=${entry.damage} dmg`;
    } else if (Number.isFinite(entry.damage)) {
      outcome += ` · ${entry.damage} dmg`;
    }
  } else {
    outcome = ' → MISS';
    if (entry.fumble) outcome += ' FUMBLE';
  }
  return parts.join(' ') + total + defense + outcome;
}

function describeRetreatDetail(entry) {
  if (!Number.isFinite(entry.roll)) return '';
  return `d20 ${entry.roll} vs 15 → ${entry.success ? 'ESCAPE' : 'FAIL'}`;
}

function describeConditionDetail(entry) {
  const save = entry?.save;
  if (!save || !Number.isFinite(save.natural)) return '';
  const parts = [`d20 ${save.natural}`];
  const attrLabel = save.attribute ? String(save.attribute).toUpperCase() : null;
  const modChunk = formatSignedModifier(save.modifier);
  if (modChunk && attrLabel) parts.push(`${modChunk} ${attrLabel}`);
  const total = Number.isFinite(save.total) ? ` = ${save.total}` : '';
  const dc = Number.isFinite(entry.dc) ? ` vs DC ${entry.dc}` : '';
  const outcome = save.success ? ' → SAVE' : ' → FAIL';
  return parts.join(' ') + total + dc + outcome;
}

function describeProtocolDetail(entry) {
  const rolls = entry?.result?.rolls;
  const chunks = [];
  const attack = rolls?.attack;
  if (attack && Number.isFinite(attack.natural)) {
    const parts = [`d20 ${attack.natural}`];
    const modChunk = formatSignedModifier(attack.modifier);
    if (modChunk) parts.push(`${modChunk} FOC`);
    const total = Number.isFinite(attack.total) ? ` = ${attack.total}` : '';
    const def = Number.isFinite(attack.target) ? ` vs PDEF ${attack.target}` : '';
    chunks.push(parts.join(' ') + total + def + ` → ${attack.hit ? 'HIT' : 'MISS'}`);
  }
  const overclock = rolls?.overclock;
  if (overclock && Number.isFinite(overclock.natural)) {
    const parts = [`OC d20 ${overclock.natural}`];
    const modChunk = formatSignedModifier(overclock.modifier);
    if (modChunk) parts.push(`${modChunk} FOC`);
    const total = Number.isFinite(overclock.total) ? ` = ${overclock.total}` : '';
    const target = Number.isFinite(overclock.target) ? ` vs ${overclock.target}` : '';
    chunks.push(parts.join(' ') + total + target + ` → ${overclock.success ? 'OK' : 'FAIL'}`);
  }
  return chunks.join(' · ');
}

// Derived breakdown line for log entries that carry dice/roll data. Reads the same fields the
// rules layer already logs (src/rules/combat.js performAttackRoll + retreat/condition/protocol
// pushLog sites) — this function is pure, never mutates the entry, and returns '' whenever the
// entry has no numeric payload so notice-only entry types render exactly one line as before.
export function describeEntryDetail(entry) {
  if (!entry || typeof entry !== 'object') return '';
  switch (entry.type) {
    case 'attack': return describeAttackDetail(entry);
    case 'retreat': return describeRetreatDetail(entry);
    case 'condition': return describeConditionDetail(entry);
    case 'protocol': return describeProtocolDetail(entry);
    default: return '';
  }
}

// Compact Vibration API pattern for a resolved combat-log entry. Feedback is scoped to
// outcomes the player couldn't have anticipated before resolution — a landed hit, a crit,
// or a death — never misses, navigation, controls, or actions before their outcome is known.
// Pure and directly testable; the mount()-scoped emitter below applies the opt-in/support gates.
export function hapticPatternForCombatEntry(entry) {
  if (entry?.type === 'death') return [24, 24, 44];
  if (entry?.type !== 'attack' || entry.hit !== true) return null;

  return entry.crit === true ? [12, 24, 24] : 12;
}

function markDefeated(runState, ids) {
  for (const id of ids || []) {
    const numeric = typeof id === 'number' ? id : /^\d+$/.test(String(id)) ? Number(id) : NaN;
    if (Number.isInteger(numeric)) runState.markEnemyDefeated?.(numeric);
  }
}

function actionFailureMessage(reason) {
  const messages = {
    'invalid-target': 'SELECT A VALID TARGET',
    'invalid-protocol': 'SELECT A VALID PROTOCOL',
    'invalid-item': 'SELECT A VALID ITEM',
    'insufficient-charge': 'INSUFFICIENT CHARGE',
    'no-ap': 'NO AP REMAINING',
    'no-move': 'MOVE ALREADY SPENT',
    'illegal-cell': 'ILLEGAL MOVE CELL',
    'invalid-direction': 'SELECT A VALID DIRECTION',
    'no-window': 'NO COMBAT WINDOW',
    jammed: 'PROTOCOLS JAMMED',
    panicked: 'PANICKED: ATTACK BLOCKED',
    'invalid-turn': 'WAIT FOR THE ACTIVE TURN'
  };
  return messages[reason] || 'ACTION FAILED';
}

export function mount(container, params = {}) {
  // Reassigned once, at combat-end, when a Lucky reroll charge is claimed onto a cloned
  // runState (SESSION-04 checkpoint 2) — every other reference in this closure reads the
  // current binding, so the claim rides the same combat-resolution autosave as the rest of
  // the terminal sync.
  let runState = params.runState;
  const floor = params.floor;
  const data = params.data || {};
  const rngCursor = createRNGCursorForRun(runState.worldSeed, runState.rngState);
  const lattice = params.lattice || (floor ? createLattice(floor, runState) : null);
  const encounter = normalizeEncounter(params.encounter, data, runState) || fallbackEncounter(floor, runState, rngCursor, data) || { id: 'combat', kind: 'standard', window: DEFAULT_WINDOW, actors: [] };
  const combatState = normalizeCombatState(params.combatState, data, runState) || initiateCombat(encounter, rngCursor);
  const combatLattice = windowLattice(combatState.window);
  const rulesContext = {
    runState,
    protocolsData: data.protocols,
    conditionsData: data.conditions,
    consumablesData: data.consumables,
    classData: data.classes,
    classesData: data.classes,
    lattice: combatState.window
  };

  let mounted = true;
  let terminalDispatched = false;
  let logCursor = combatState.log.length;
  let userAdjusted = false;
  let currentDpr = 1;
  // Log-replay playback state (M71). While `active`, `selection.resolving` gates input, the
  // playfield draws with position/active/flash overrides, and the console shows the current
  // entry's notice. `entries` is the sliced tail of combatState.log we're stepping through;
  // `index` counts entries already consumed by advancePlayback (dispatched to bus + rendered).
  const playback = {
    timerId: null,
    active: false,
    entries: null,
    index: 0,
    positionOverrides: new Map(),
    activeOverrideId: null,
    flashCells: new Set(),
    onComplete: null
  };
  const selection = {
    phase: 'choose-action',
    actionType: null,
    actorId: null,
    targetId: null,
    targetIndex: 0,
    direction: null,
    movePath: [],
    protocol: null,
    itemId: null,
    error: null,
    notice: null,
    resolving: false,
    combatId: combatState.id ?? 'combat'
  };

  clear(container);
  container.classList.add('combat-screen', 'in-run-screen');
  container.style.position = 'relative';
  container.style.overflow = 'hidden';
  const inputHandler = createInputHandler({ legacyActions: false });
  inputHandler.bindToElement(container);

  const layout = currentLayoutClass();
  const isWide = layout === 'wide';

  let statusBar = null;
  let telemetryDock = null;
  let playfieldBody;
  let widePlayfieldColumn = null;
  let shell = null;

  if (isWide) {
    shell = document.createElement('div');
    shell.className = 'wide-shell';
    shell.dataset.wideRoot = '';
    shell.dataset.testid = 'wide-shell';

    telemetryDock = createTelemetryDock(runState, combatState, { data });
    shell.appendChild(telemetryDock);

    widePlayfieldColumn = document.createElement('section');
    widePlayfieldColumn.className = 'wide-playfield-column';
    playfieldBody = document.createElement('div');
    playfieldBody.className = 'combat-grid playfield-body combat-playfield wide-playfield-inner';
    playfieldBody.style.overflow = 'hidden';
    playfieldBody.style.position = 'relative';
    widePlayfieldColumn.appendChild(playfieldBody);
    shell.appendChild(widePlayfieldColumn);
    container.appendChild(shell);
  } else {
    statusBar = createStatusBar(runState, combatState, { data });
    statusBar.classList.add('panel', 'combat-status', 'in-run-status');
    statusBar.style.flex = '0 0 auto';
    container.appendChild(statusBar);

    playfieldBody = document.createElement('div');
    playfieldBody.className = 'combat-grid playfield-body combat-playfield';
    playfieldBody.style.display = 'block';
    playfieldBody.style.flex = '1 1 auto';
    playfieldBody.style.minHeight = '0';
    // Portrait-usability-regression-repair SESSION-01: the console is an in-flow
    // bounded tray (SESSION-06), so the playfield no longer needs a synthetic
    // bottom margin to escape an absolute overlay. The screen-owned feedback
    // rail sits between the playfield and the console (see below).
    playfieldBody.style.overflow = 'hidden';
    playfieldBody.style.position = 'relative';
    container.appendChild(playfieldBody);
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'playfield-canvas combat-grid-canvas';
  canvas.width = 384;
  canvas.height = 768;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.dataset.testid = 'combat-canvas';

  playfieldBody.appendChild(canvas);
  const playfield = createPlayfield(canvas);
  playfield.setAccent(themeFor(floor, data) || '#7ec8e3');
  const settings = loadSettings();
  const reducedMotionSetting = settings.reducedMotion;
  const prefersReduced = typeof globalThis.window?.matchMedia === 'function'
    && globalThis.window.matchMedia('(prefers-reduced-motion: reduce)')?.matches;
  const reduceMotion = reducedMotionSetting === 'reduce'
    || (reducedMotionSetting !== 'full' && prefersReduced);
  playfield.setPulse(!reduceMotion);
  // Opt-in preference (SESSION-03 of mobile-pwa-hardening) read once at mount, same as
  // reducedMotion above — no bus event exists for a live-preview of this setting today.
  const hapticsEnabled = Boolean(settings.hapticsEnabled);

  const viewState = {
    runState,
    floor,
    combatState,
    selection,
    // Live deterministic cursor (M65 direct TECH resolution). Combat owns this
    // instance — TECH mode consumes it via context.rngCursor rather than creating
    // its own, so both the attack/effect rolls and the resulting cursor state
    // stay on the single combat-scoped RNG stream.
    rngCursor,
    // Screen-owned commit contract: TECH calls this after a successful direct
    // cast so the live combat map's post-cast actor deltas (hp/currentHP,
    // charge/ap, conditions, position) land in runState.rngState and the
    // resumable runState.activeCombat snapshot — the same persistence path
    // party-turn actions already go through via afterAction/runResolveWithPlayback.
    commitTechProtocol() {
      runState.rngState = rngCursor.getState();
      syncRunStateFromCombat(runState, combatState);
      updateRunCombatSnapshot(runState, combatState);
    },
    // Full-shell redraw (map + status strip + console) distinct from the console's
    // own local `refresh` — a successful TECH cast mutates the live combat map, so
    // the playfield/status must repaint too, not just the TECH panel.
    refreshShell: renderAll,
    // Full game-data registry — LOG mode uses `data.symbolTable` to init the save
    // encoder on demand, and party/tech/gear panes (S03) read class/loadout tables
    // to derive maxes for the display.
    data,
    // Runtime-tracked log entries injected via params.logEntries — LOG mode merges
    // them with runState.recentEvents so post-resume history stays visible alongside
    // live activity.
    logEntries: params.logEntries,
    protocolsData: data.protocols,
    consumablesData: data.consumables,
    inputHandler,
    lattice: combatLattice,
    combatGetActiveActor: () => getActiveActor(combatState),
    combatGetLegalActions: () => legalActions(),
    combatGetTargets: () => targetsForSelection(),
    combatActionTargeting: (actionType) => actionTargeting(actionType),
    combatGetItems: () => consumableItems(runState),
    combatGetPreview: (targetId) => previewForTarget(targetId),
    combatGetMoveRange: () => getMoveRange(),
    combatGetPathSteps: () => nextStepDirections(),
    combatChooseAction: chooseAction,
    combatSelectTarget: selectTarget,
    combatStepPath: stepPath,
    combatPopPath: popPath,
    combatSelectDestination: selectDestination,
    combatSelectProtocol: selectProtocol,
    combatSelectItem: selectItem,
    combatCycleTarget: cycleTarget,
    combatCancel: cancelSelection,
    combatConfirm: confirmSelection
  };
  // Screen-owned feedback rail. Sibling of the console (NOT a child of
  // `.console-content`) so notices/errors stay visible regardless of console
  // scroll position or expand state. Polite live region, portrait-only —
  // wide keeps its feedback inside the dock (see console/combat.js).
  let feedbackRail = null;
  let noticeEl = null;
  let errorEl = null;
  if (!isWide) {
    feedbackRail = document.createElement('div');
    feedbackRail.className = 'combat-feedback-rail';
    feedbackRail.dataset.testid = 'combat-feedback';
    feedbackRail.setAttribute('role', 'status');
    feedbackRail.setAttribute('aria-live', 'polite');
    feedbackRail.setAttribute('aria-atomic', 'true');
    feedbackRail.style.flex = '0 0 auto';
    noticeEl = document.createElement('div');
    noticeEl.className = 'combat-feedback-notice';
    noticeEl.dataset.testid = 'combat-notice';
    noticeEl.hidden = true;
    errorEl = document.createElement('div');
    errorEl.className = 'combat-feedback-error';
    errorEl.dataset.testid = 'combat-error';
    errorEl.hidden = true;
    feedbackRail.append(noticeEl, errorEl);
    container.appendChild(feedbackRail);
  }

  const consoleController = createConsole(viewState, { variant: isWide ? 'dock' : 'bar' });
  let widePanesCleanup = null;
  if (isWide) {
    shell.appendChild(consoleController.render());
    widePanesCleanup = attachWidePanes({ shell, loadSettings, saveSettings });
  } else {
    container.appendChild(consoleController.render());
  }
  consoleController.setMode('combat');
  // Portrait-usability-regression-repair SESSION-01: open the console at 'half'
  // once on mount so actions are immediately reachable. Enemy playback, action
  // completion, and party-turn boundaries never resize it — an explicit user
  // collapse (tab click, Escape) stays collapsed until the user reopens it.
  if (!isWide) consoleController.expand({ size: 'half' });
  syncFeedbackRail();

  // Canvas-space camera (M104) owns pan/zoom and hit-tests. The gesture controller emits
  // drag-pans (>= DRAG_THRESHOLD_PX) that set `userAdjusted` so the turn-change auto-center
  // won't fight the user; a release inside the threshold fires `onCanvasTap`.
  const worldW = (combatState.window?.width || COMBAT_GRID_W) * COMBAT_CELL_SIZE;
  const worldH = (combatState.window?.height || COMBAT_GRID_H) * COMBAT_CELL_SIZE;
  const camera = createViewportCamera({ worldW, worldH });
  currentDpr = syncCameraViewport();
  if (isWide) {
    // Wide dock keeps a fit view so the full window stays visible in the middle track.
    camera.fit();
  } else {
    // Portrait: center on the active actor first, then zoom in so cells read legibly on a phone.
    const initialActor = getActiveActor(combatState);
    if (initialActor?.position) {
      camera.centerOn(
        (initialActor.position.x + 0.5) * COMBAT_CELL_SIZE,
        (initialActor.position.y + 0.5) * COMBAT_CELL_SIZE
      );
    }
    camera.zoomToCells(COMBAT_CELL_SIZE, COMBAT_PORTRAIT_CELL_PX);
  }

  const gestureCleanup = attachViewportGestures(playfieldBody, camera, {
    onChange: () => { userAdjusted = true; renderAll(); },
    onTap: onCanvasTap
  });

  let resizeObserverInstance = null;
  if (typeof globalThis.ResizeObserver === 'function') {
    resizeObserverInstance = new globalThis.ResizeObserver(() => {
      currentDpr = syncCameraViewport();
      renderAll();
    });
    resizeObserverInstance.observe(playfieldBody);
  }

  // Initial pre-party enemy resolution (mid-run reload, enemy-first initiative). Playback runs
  // exactly like a mid-combat turn: input is gated, state/autosave land immediately, terminal
  // dispatch waits for playback completion. On the common path (party first in turnOrder),
  // resolveTurn returns without adding log entries and beginPlayback fires onComplete inline.
  selection.resolving = true;
  runResolveWithPlayback(() => {
    selection.resolving = false;
    syncSelectionActor();
    renderAll();
    dispatchTerminal();
  });

  // Portrait feedback rail sync — mirrors selection.notice / selection.error onto
  // the screen-owned live region so console scroll position / expand state can't
  // hide the feedback. Wide mode owns its feedback inside the dock; this is a
  // no-op there. Called from every path that can change selection.notice / error.
  function syncFeedbackRail() {
    if (!mounted || !feedbackRail) return;
    const notice = selection.notice || '';
    const error = selection.error || '';
    if (noticeEl.textContent !== notice) noticeEl.textContent = notice;
    noticeEl.hidden = !notice;
    if (errorEl.textContent !== error) errorEl.textContent = error;
    errorEl.hidden = !error;
    // SESSION-01 (mobile-combat-density-repair) — explicit active flag so CSS
    // can collapse the rail's own padding/border to zero when both message
    // children are hidden. The rail element itself is never display:none;
    // only its cost, not its live-region mount, is conditional.
    const active = Boolean(notice || error);
    feedbackRail.classList.toggle('is-active', active);
    feedbackRail.dataset.active = String(active);
  }

  function syncCameraViewport() {
    const rect = playfieldBody.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      const size = sizeCanvasToContainer(canvas, playfieldBody);
      camera.setViewport(size.w, size.h);
      return size.dpr;
    }
    // Fallback (test envs without layout): keep the initial backing store, treat it as CSS px.
    camera.setViewport(canvas.width, canvas.height);
    return 1;
  }

  function legalActions() {
    const actor = getActiveActor(combatState);
    return actor ? getLegalActions(combatState, actor.id, rulesContext) : { canAct: false, actions: [], legalMoveDirections: [] };
  }

  function isPartyTurn() {
    const actor = getActiveActor(combatState);
    return Boolean(actor && actor.side === 'party' && !combatState.ended && !selection.resolving);
  }

  function targetsForAction(actionType = selection.actionType) {
    const actors = getActors(combatState).filter((actor) => actor.hp > 0);
    if (actionType === 'attack') return actors.filter((actor) => actor.side === 'enemy');
    if (actionType === 'item') return actors.filter((actor) => actor.side === 'party');
    if (actionType === 'cast' || actionType === 'overclock') return actors.filter((actor) => actor.id !== getActiveActor(combatState)?.id);
    return [];
  }

  function targetsForSelection() {
    return targetsForAction(selection.actionType);
  }

  // Census of how many targets an action has, and how many are *legally reachable*
  // right now. The console reads this to disable ATTACK when nothing is in range
  // (user feedback: "if not able to attack anything, attack should not be enabled").
  // The attack legality here mirrors previewForTarget's attack branch exactly so the
  // action gate and the per-row range gate never disagree: distance null / same-cell
  // is legal, otherwise evaluateRange decides. Non-attack actions have no range gate
  // today, so legal === total for them.
  function actionTargeting(actionType = selection.actionType) {
    const targets = targetsForAction(actionType);
    if (actionType !== 'attack') return { total: targets.length, legal: targets.length };
    const actor = getActiveActor(combatState);
    const weapon = actor?.weapon || UNARMED;
    let legal = 0;
    for (const target of targets) {
      const distance = distanceCells(actor?.position, target.position);
      const inRange = distance == null || distance < 1 ? true : evaluateRange(weapon, distance).legal;
      if (inRange) legal += 1;
    }
    return { total: targets.length, legal };
  }

  function syncSelectionActor() {
    const actor = getActiveActor(combatState);
    if (selection.actorId === actor?.id) return;
    selection.actorId = actor?.id ?? null;
    selection.phase = 'choose-action';
    selection.actionType = null;
    selection.targetId = null;
    selection.targetIndex = 0;
    selection.direction = null;
    selection.movePath = [];
    selection.protocol = null;
    selection.itemId = null;
    selection.error = null;
    selection.notice = actor?.side === 'enemy' ? 'ENEMY TURN RESOLVING.' : null;
    // Turn change → auto-centering resumes: forget any within-turn user pan and re-center.
    userAdjusted = false;
    if (actor?.position) {
      camera.centerOn((actor.position.x + 0.5) * COMBAT_CELL_SIZE, (actor.position.y + 0.5) * COMBAT_CELL_SIZE);
    }
  }

  function chooseAction(type) {
    if (!isPartyTurn()) return false;
    const actor = getActiveActor(combatState);
    const legal = legalActions().actions || [];
    if (!legal.includes(type) || (type === 'retreat' && actor.ap <= 0)) {
      selection.error = 'ACTION NOT AVAILABLE';
      renderAll();
      return false;
    }
    selection.actionType = type;
    selection.phase = ACTION_PHASES[type] || 'choose-action';
    selection.targetId = null;
    selection.targetIndex = 0;
    selection.direction = null;
    selection.movePath = [];
    selection.protocol = null;
    selection.itemId = null;
    selection.error = null;
    selection.notice = null;
    const targets = targetsForAction(type);
    if ((type === 'attack' || type === 'cast' || type === 'overclock' || type === 'item') && targets.length) {
      selection.targetId = targets[0].id;
    }
    // Explicit END TURN / RETREAT controls execute directly on their single press — there is no
    // subsequent target/destination tap for either, so ACTION_PHASES already parked them at
    // 'confirm' above. Route straight through the same guarded execution boundary every other
    // direct activation uses (validationError, stale-selection check, executeAction).
    if (type === 'retreat' || type === 'end-turn') return confirmSelection();
    renderAll();
    return true;
  }

  // Protocol data classifier local to this screen (mirrors src/ui/console/tech.js's private
  // targetKind — no shared export exists in src/rules/protocols.js, and that module is outside
  // this session's Reads). A protocol whose authored effect resolves against the floor/every
  // enemy/an area rather than a single picked actor has no legal target tap to wait for, so
  // selecting it IS the explicit cast action.
  function protocolIsTargetless(protocol) {
    const effect = protocolData(data, protocol)?.effectData || {};
    return effect.target === 'floor' || effect.target === 'all_enemies' || effect.target === 'enemies' || effect.target === 'aoe' || effect.type === 'reshape';
  }

  function selectProtocol(protocol) {
    if (!isPartyTurn()) return false;
    if (!protocolData(data, protocol)) {
      selection.error = 'SELECT A VALID PROTOCOL';
      renderAll();
      return false;
    }
    selection.protocol = { school: protocol.school, tier: protocol.tier };
    selection.error = null;
    if (protocolIsTargetless(protocol)) {
      // Browsing the protocol card IS the cast action — no target tap follows.
      selection.targetId = null;
      selection.targetIndex = 0;
      selection.phase = 'confirm';
      return confirmSelection();
    }
    selection.phase = 'choose-target';
    const targets = targetsForSelection();
    selection.targetId = targets[0]?.id ?? null;
    selection.targetIndex = 0;
    renderAll();
    return true;
  }

  function selectItem(item) {
    if (!isPartyTurn()) return false;
    selection.itemId = item?.id || item?.baseType || null;
    selection.phase = 'choose-target';
    const targets = targetsForSelection();
    selection.targetId = targets[0]?.id ?? null;
    selection.targetIndex = 0;
    selection.error = null;
    renderAll();
    return true;
  }

  // Direct activation: one legal target tap executes the pending action (attack/cast/
  // overclock/item) immediately — there is no separate confirm step to wait for. Keyboard
  // target cycling (cycleTarget, below) stays browse-only; Enter remains the non-visual
  // commit for that path.
  function selectTarget(targetId) {
    if (!isPartyTurn()) return false;
    const targets = targetsForSelection();
    const index = targets.findIndex((target) => String(target.id) === String(targetId));
    if (index < 0) {
      selection.error = 'SELECT A VALID TARGET';
      renderAll();
      return false;
    }
    // Range gate: attack + cast + overclock refuse to commit an out-of-range target. The
    // console still renders the illegal row (disabled, with an OUT OF RANGE chip) so the
    // player can see why — the row just doesn't advance selection.
    const candidate = targets[index];
    if (['attack', 'cast', 'overclock'].includes(selection.actionType)) {
      const preview = previewForTarget(candidate.id);
      if (preview && preview.targetLegal === false) {
        selection.error = 'OUT OF RANGE — MOVE OR RETARGET';
        renderAll();
        return false;
      }
    }
    selection.targetId = candidate.id;
    selection.targetIndex = index;
    selection.phase = 'confirm';
    selection.error = null;
    return confirmSelection();
  }

  function cycleTarget(delta) {
    if (!isPartyTurn() || !['choose-target', 'confirm'].includes(selection.phase)) return null;
    const targets = targetsForSelection();
    if (!targets.length) return false;
    const current = targets.findIndex((target) => String(target.id) === String(selection.targetId));
    const index = (Math.max(0, current) + delta + targets.length) % targets.length;
    selection.targetId = targets[index].id;
    selection.targetIndex = index;
    selection.error = null;
    renderAll();
    return true;
  }

  function getMoveRange() {
    const actor = getActiveActor(combatState);
    return actor ? reachableMoveCells(combatState, actor.id, MOVE_RANGE) : new Map();
  }

  function pathEndpoint(actor) {
    let cursor = { x: actor.position?.x ?? 0, y: actor.position?.y ?? 0 };
    for (const dir of selection.movePath || []) {
      const delta = DIRECTION_DELTAS[dir];
      if (!delta) break;
      cursor = { x: cursor.x + delta[0], y: cursor.y + delta[1] };
    }
    return cursor;
  }

  function nextStepDirections() {
    const actor = getActiveActor(combatState);
    if (!actor || selection.actionType !== 'move') return [];
    const path = selection.movePath || [];
    if (path.length >= MOVE_RANGE) return [];
    const cursor = pathEndpoint(actor);
    return Object.keys(DIRECTION_DELTAS).filter((direction) => isLegalMoveStep(combatState, actor.id, cursor, direction));
  }

  // Append one direction to the current movePath. Any legal single step from the current
  // cursor is accepted (users may zig-zag), capped at MOVE_RANGE total. Tap-to-destination
  // uses BFS-shortest routes; button/keyboard stepping is free-form.
  function stepPath(direction) {
    if (!isPartyTurn() || selection.actionType !== 'move') return false;
    const path = selection.movePath || [];
    if (path.length >= MOVE_RANGE) {
      selection.error = 'PATH FULL';
      renderAll();
      return false;
    }
    const actor = getActiveActor(combatState);
    const cursor = pathEndpoint(actor);
    if (!isLegalMoveStep(combatState, actor.id, cursor, direction)) {
      selection.error = 'SELECT A VALID DIRECTION';
      renderAll();
      return false;
    }
    selection.movePath = [...path, direction];
    selection.direction = selection.movePath[0];
    selection.phase = 'confirm';
    selection.error = null;
    renderAll();
    return true;
  }

  function popPath() {
    if (!isPartyTurn() || selection.actionType !== 'move') return false;
    const path = selection.movePath || [];
    if (path.length === 0) return false;
    const nextPath = path.slice(0, -1);
    selection.movePath = nextPath;
    selection.direction = nextPath[0] || null;
    if (nextPath.length === 0) selection.phase = 'choose-path';
    selection.error = null;
    renderAll();
    return true;
  }

  // Direct activation: one legal map destination tap replaces movePath with the full BFS
  // shortest route to the tapped cell AND executes it immediately — no second "tap again to
  // confirm" gesture. A D-pad-built path stays reachable through the keyboard/D-pad Enter
  // accelerator (handleInput → combatConfirm) for accessibility.
  function selectDestination(cell) {
    if (!isPartyTurn() || selection.actionType !== 'move') return false;
    const info = getMoveRange().get(`${cell.x},${cell.y}`);
    if (!info) {
      selection.error = 'SELECT A VALID DIRECTION';
      renderAll();
      return false;
    }
    selection.movePath = [...info.path];
    selection.direction = selection.movePath[0];
    selection.phase = 'confirm';
    selection.error = null;
    return confirmSelection();
  }

  function cancelSelection() {
    if (selection.resolving) return false;
    if (selection.phase === 'confirm') {
      selection.phase = selection.actionType === 'move' ? 'choose-path' : selection.actionType === 'retreat' || selection.actionType === 'end-turn' ? 'choose-action' : 'choose-target';
    } else if (selection.phase === 'choose-target' && (selection.actionType === 'cast' || selection.actionType === 'overclock')) {
      selection.phase = 'choose-protocol';
      selection.targetId = null;
    } else if (selection.phase === 'choose-target' && selection.actionType === 'item') {
      selection.phase = 'choose-item';
      selection.targetId = null;
    } else {
      selection.phase = 'choose-action';
      selection.actionType = null;
      selection.targetId = null;
      selection.direction = null;
      selection.movePath = [];
      selection.protocol = null;
      selection.itemId = null;
    }
    selection.error = null;
    renderAll();
    return true;
  }

  function validationError() {
    const actor = getActiveActor(combatState);
    if (!actor || actor.side !== 'party') return 'WAIT FOR A PARTY TURN';
    if (!selection.actionType) return 'SELECT AN ACTION';
    if (selection.actionType !== 'move' && selection.actionType !== 'end-turn' && actor.ap <= 0) return 'NO AP REMAINING';
    if (selection.actionType === 'attack') {
      const target = combatState.combatants.get(selection.targetId);
      if (!target || target.hp <= 0 || target.side !== 'enemy') return 'SELECT A LIVING HOSTILE';
      const preview = previewForTarget(selection.targetId);
      if (preview && preview.targetLegal === false) return 'OUT OF RANGE — MOVE OR RETARGET';
    }
    if (selection.actionType === 'move') {
      const path = selection.movePath || [];
      if (path.length < 1 || path.length > MOVE_RANGE) return 'SELECT A VALID DIRECTION';
      const reachable = getMoveRange();
      const dest = pathEndpoint(actor);
      if (!reachable.has(`${dest.x},${dest.y}`)) return 'SELECT A VALID DIRECTION';
    }
    if (selection.actionType === 'cast' || selection.actionType === 'overclock') {
      if (!selection.protocol || !actor.protocols?.some((protocol) => protocol.school === selection.protocol.school && protocol.tier === selection.protocol.tier)) return 'SELECT A VALID PROTOCOL';
      if (!protocolIsTargetless(selection.protocol)) {
        const target = combatState.combatants.get(selection.targetId);
        if (!target || target.hp <= 0) return 'SELECT A LIVING TARGET';
        const preview = previewForTarget(selection.targetId);
        if (preview && preview.targetLegal === false) return 'OUT OF RANGE — MOVE OR RETARGET';
      }
    }
    if (selection.actionType === 'item') {
      if (!consumableItems(runState).some((item) => item.id === selection.itemId || item.baseType === selection.itemId)) return 'SELECT A VALID ITEM';
      const target = combatState.combatants.get(selection.targetId);
      if (!target || target.hp <= 0 || target.side !== 'party') return 'SELECT A PARTY TARGET';
    }
    return null;
  }

  function actionFromSelection(actor) {
    if (selection.actionType === 'end-turn') return { type: 'end-turn', actorId: actor.id };
    if (selection.actionType === 'move') return { type: 'move', actorId: actor.id, path: [...(selection.movePath || [])] };
    if (selection.actionType === 'attack') return { type: 'attack', actorId: actor.id, targetId: selection.targetId };
    if (selection.actionType === 'cast' || selection.actionType === 'overclock') return { type: selection.actionType, actorId: actor.id, targetId: selection.targetId, school: selection.protocol.school, tier: selection.protocol.tier };
    if (selection.actionType === 'item') return { type: 'item', actorId: actor.id, targetId: selection.targetId, consumableId: selection.itemId };
    if (selection.actionType === 'retreat') return { type: 'retreat', actorId: actor.id };
    return null;
  }

  function confirmSelection() {
    if (!mounted || selection.resolving || terminalDispatched) return false;
    if (selection.phase !== 'confirm') {
      const readyFromKeyboard = selection.phase === 'choose-target' && ['attack', 'cast', 'overclock', 'item'].includes(selection.actionType) && !validationError();
      const readyFromMovePath = selection.actionType === 'move' && (selection.movePath?.length ?? 0) > 0 && !validationError();
      if (readyFromKeyboard || readyFromMovePath) selection.phase = 'confirm';
      else {
        selection.error = validationError() || 'CONFIRM A SELECTED OPTION';
        renderAll();
        return false;
      }
    }
    const error = validationError();
    if (error) {
      selection.error = error;
      renderAll();
      return false;
    }
    const actor = getActiveActor(combatState);
    if (selection.actorId !== actor.id || selection.combatId !== (combatState.id ?? 'combat')) {
      selection.error = 'STALE COMBAT SELECTION';
      renderAll();
      return false;
    }
    selection.resolving = true;
    selection.error = null;
    renderAll();
    const action = actionFromSelection(actor);
    const result = executeAction(combatState, action, rngCursor, rulesContext);
    if (!result.success && !(selection.actionType === 'retreat' && result.retreated === false)) {
      selection.resolving = false;
      selection.error = actionFailureMessage(result.reason);
      renderAll();
      return false;
    }
    afterAction(result);
    return true;
  }

  function afterAction(result) {
    runState.rngState = rngCursor.getState();
    // Party-turn log entries stream immediately — the player just saw those actions run live.
    dispatchNewLogs();
    handleCharacterDeaths();
    checkCombatEnd(combatState);
    if (combatState.ended) {
      finalizeAfterAction(result);
      return;
    }
    runResolveWithPlayback(() => finalizeAfterAction(result));
  }

  function finalizeAfterAction(result) {
    if (!mounted) return;
    selection.resolving = false;
    selection.notice = result?.retreated === false ? 'RETREAT FAILED.' : null;
    syncSelectionActor();
    if (!combatState.ended) {
      selection.phase = 'choose-action';
      selection.actionType = null;
      selection.targetId = null;
      selection.direction = null;
      selection.protocol = null;
      selection.itemId = null;
    }
    renderAll();
    dispatchTerminal();
  }

  // Snapshots positions BEFORE calling resolveTurn so playback can start each moved actor at its
  // pre-resolution cell (the engine has already advanced them to their final cells). State sync
  // (runState.rngState, syncRunStateFromCombat, updateRunCombatSnapshot) lands immediately —
  // exactly as before playback existed — so a crash mid-playback still autosaves the final state.
  // Enemy-side deaths and terminal combat-end fire after playback so the user sees the actions
  // that caused them.
  function runResolveWithPlayback(onDone) {
    // SESSION-01 (portrait-usability-regression-repair): enemy playback no longer
    // toggles the console. The console is a bounded in-flow tray; the map stays
    // visible above it whether the console is at 'half' or 'full', and an
    // explicit user collapse stays collapsed until the user reopens it.
    const startCursor = logCursor;
    const preResolvePositions = snapshotPositions();
    resolveTurn(combatState, rngCursor, rulesContext);
    runState.rngState = rngCursor.getState();
    checkCombatEnd(combatState);
    syncRunStateFromCombat(runState, combatState, { removeDead: !combatState.ended || combatState.result !== 'wipe' });
    updateRunCombatSnapshot(runState, combatState);
    const entries = combatState.log.slice(startCursor);
    beginPlayback(entries, preResolvePositions, () => {
      handleCharacterDeaths();
      onDone?.();
    });
  }

  function handleCharacterDeaths() {
    for (const death of getCharacterDeaths(combatState)) {
      bus.dispatch('state:character-death', { character: death.character, runState, combatState });
    }
  }

  // Guarded, best-effort Vibration API emitter for a resolved combat-log entry. Opt-in only
  // (hapticsEnabled), silently inert when the pattern mapper declines, the API is absent
  // (notably iOS Safari), or the browser call throws. Never touches combat state and never
  // blocks the surrounding visual/audio feedback in dispatchLogEntry below.
  function triggerHaptic(entry) {
    if (!hapticsEnabled) return;
    const pattern = hapticPatternForCombatEntry(entry);
    if (pattern == null) return;
    const vibrate = globalThis.navigator?.vibrate;
    if (typeof vibrate !== 'function') return;
    try { vibrate.call(globalThis.navigator, pattern); } catch { /* unsupported/throwing browsers stay silent */ }
  }

  // dispatchLogEntry is the single point every resolved combat-log entry passes through exactly
  // once — party actions dispatch here immediately (dispatchNewLogs), enemy actions dispatch here
  // per playback step (advancePlayback) or all at once on fast-forward/reduced-motion/unmount
  // flush — so triggerHaptic here can never double-fire for one outcome.
  function dispatchLogEntry(entry) {
    if (!entry) return;
    triggerHaptic(entry);
    bus.dispatch('ui:log-entry', {
      type: entry.type || 'combat',
      message: formatLog(entry),
      detail: describeEntryDetail(entry),
      entry,
      sequence: entry.sequence,
      timestamp: Date.now()
    });
  }

  function dispatchNewLogs() {
    while (logCursor < combatState.log.length) {
      dispatchLogEntry(combatState.log[logCursor++]);
    }
  }

  function snapshotPositions() {
    const map = new Map();
    for (const actor of getActors(combatState)) {
      if (actor.position) map.set(actor.id, { x: actor.position.x, y: actor.position.y });
    }
    return map;
  }

  // Play only enemy-side actor entries, plus death/condition-damage on any side. Party-actor
  // entries (opportunity attacks the player triggered during an enemy move) already ran live for
  // the user and are dispatched inline without a paced step.
  function shouldPlayEntry(entry) {
    if (!entry) return false;
    if (entry.type === 'death' || entry.type === 'condition-damage') return true;
    const actor = entry.actorId != null ? combatState.combatants.get(entry.actorId) : null;
    return Boolean(actor && actor.side !== 'party');
  }

  function noticeFor(entry) {
    if (!entry) return null;
    const actor = entry.actorId != null ? combatState.combatants.get(entry.actorId) : null;
    const target = entry.targetId != null ? combatState.combatants.get(entry.targetId) : null;
    const name = (a) => (humanizeActorName(a) || 'Actor').toUpperCase();
    switch (entry.type) {
      case 'attack':
        return entry.hit
          ? `${name(actor)} ATTACKS ${name(target)} — ${entry.damage} DMG.`
          : `${name(actor)} ATTACKS ${name(target)} — MISS.`;
      case 'protocol':
        return target
          ? `${name(actor)} CASTS ${String(entry.school || '').toUpperCase()}-${entry.tier} ON ${name(target)}.`
          : `${name(actor)} CASTS ${String(entry.school || '').toUpperCase()}-${entry.tier}.`;
      case 'condition':
        return entry.applied
          ? `${name(actor)} APPLIES ${String(entry.conditionId || 'condition').toUpperCase()} TO ${name(target)}.`
          : `${name(target)} RESISTS ${String(entry.conditionId || 'condition').toUpperCase()}.`;
      case 'item':
        return `${name(actor)} USES ${String(entry.consumableId || 'item').toUpperCase()}.`;
      case 'move':
        return `${name(actor)} MOVES.`;
      case 'wait':
        return `${name(actor)} WAITS.`;
      case 'end-turn':
        return `${name(actor)} ENDS TURN.`;
      case 'retreat':
        return `${name(actor)} ${entry.success ? 'RETREATS' : 'RETREAT FAILS'}.`;
      case 'death':
        return `${name(target || actor)} FALLS.`;
      case 'condition-damage':
        return `${name(actor)} — ${String(entry.source || 'condition').toUpperCase()} ${entry.amount}.`;
      default:
        return `${String(entry.type || 'event').toUpperCase()}.`;
    }
  }

  function flashKeyFor(entry) {
    const targetId = entry?.targetId ?? entry?.actorId;
    if (targetId == null) return null;
    const target = combatState.combatants.get(targetId);
    if (!target?.position) return null;
    const override = playback.positionOverrides.get(target.id);
    const pos = override || target.position;
    return `${pos.x},${pos.y}`;
  }

  function centerOnCellIfIdle(cell) {
    if (!cell || userAdjusted) return;
    camera.centerOn((cell.x + 0.5) * COMBAT_CELL_SIZE, (cell.y + 0.5) * COMBAT_CELL_SIZE);
  }

  function scheduleTimeout(fn, ms) {
    const timerFn = globalThis.setTimeout;
    return typeof timerFn === 'function' ? timerFn(fn, ms) : null;
  }

  function clearPlaybackTimer() {
    if (playback.timerId == null) return;
    const clearFn = globalThis.clearTimeout;
    if (typeof clearFn === 'function') clearFn(playback.timerId);
    playback.timerId = null;
  }

  // Playfield-only redraw during playback: avoids the full renderAll pass (which rebuilds the
  // portrait status strip on every call). Console refresh is triggered separately per entry so
  // the notice slot updates without re-creating the status bar element every 140ms.
  function renderPlayfieldOnly() {
    if (!mounted) return;
    playfield.renderCombat(combatState, combatLattice, {
      ...overlayOptions(),
      viewTransform: camera.viewTransform(currentDpr),
      positionOverrides: playback.positionOverrides.size ? playback.positionOverrides : undefined,
      activeOverrideId: playback.activeOverrideId ?? undefined,
      flashCells: playback.flashCells.size ? playback.flashCells : undefined
    });
    // Playback advances write selection.notice in noticeFor(); mirror onto the
    // screen-owned rail so live-region announcements stay in sync with each entry.
    syncFeedbackRail();
  }

  function beginPlayback(entries, preResolvePositions, onDone) {
    if (!mounted) { onDone?.(); return; }
    const hasVisual = entries.some(shouldPlayEntry);
    // Reduced-motion or no enemy-visible entries → instant path. Dispatches every entry to the
    // bus immediately (log-feed sync stays intact) and fires onComplete inline.
    if (reduceMotion || !hasVisual) {
      for (const entry of entries) dispatchLogEntry(entry);
      logCursor = combatState.log.length;
      onDone?.();
      return;
    }
    playback.positionOverrides = new Map();
    for (const [id, pos] of preResolvePositions) {
      const actor = combatState.combatants.get(id);
      if (!actor?.position) continue;
      if (actor.position.x !== pos.x || actor.position.y !== pos.y) {
        playback.positionOverrides.set(id, { x: pos.x, y: pos.y });
      }
    }
    playback.flashCells = new Set();
    playback.activeOverrideId = null;
    playback.onComplete = onDone;
    playback.entries = entries;
    playback.index = 0;
    playback.active = true;
    renderPlayfieldOnly();
    advancePlayback();
  }

  function advancePlayback() {
    if (!mounted || !playback.active) return;
    playback.flashCells = new Set();
    if (playback.index >= playback.entries.length) {
      finishPlayback();
      return;
    }
    const entry = playback.entries[playback.index++];
    dispatchLogEntry(entry);
    if (logCursor < combatState.log.length) logCursor++;

    if (!shouldPlayEntry(entry)) {
      // Party-side entries (OA attacks provoked by enemy moves) dispatch to the log feed but
      // don't consume a visible step — they already ran live for the user.
      advancePlayback();
      return;
    }

    const actor = entry.actorId != null ? combatState.combatants.get(entry.actorId) : null;
    if (actor && actor.side !== 'party') playback.activeOverrideId = entry.actorId;
    selection.notice = noticeFor(entry);

    if (entry.type === 'move' && Array.isArray(entry.path) && entry.path.length > 0 && entry.from) {
      playMoveEntry(entry);
      return;
    }
    if (['attack', 'protocol', 'condition', 'item'].includes(entry.type)) {
      const key = flashKeyFor(entry);
      if (key) playback.flashCells.add(key);
      const cell = playback.positionOverrides.get(actor?.id) || actor?.position;
      centerOnCellIfIdle(cell);
      renderPlayfieldOnly();
      consoleController.refresh();
      playback.timerId = scheduleTimeout(() => {
        playback.flashCells = new Set();
        advancePlayback();
      }, ACTION_STEP_MS);
      return;
    }
    // Notice-only entries: wait / end-turn / retreat / death / condition-damage.
    const cell = playback.positionOverrides.get(actor?.id) || actor?.position;
    centerOnCellIfIdle(cell);
    renderPlayfieldOnly();
    consoleController.refresh();
    playback.timerId = scheduleTimeout(advancePlayback, NOTICE_STEP_MS);
  }

  function playMoveEntry(entry) {
    const path = entry.path;
    let cursor = { x: entry.from.x, y: entry.from.y };
    let step = 0;
    playback.positionOverrides.set(entry.actorId, { x: cursor.x, y: cursor.y });
    centerOnCellIfIdle(cursor);
    renderPlayfieldOnly();
    consoleController.refresh();
    const walk = () => {
      if (!mounted || !playback.active) return;
      if (step >= path.length) {
        // Align override with the engine's final position so subsequent entries see the same cell.
        if (entry.to) playback.positionOverrides.set(entry.actorId, { x: entry.to.x, y: entry.to.y });
        advancePlayback();
        return;
      }
      const delta = DIRECTION_DELTAS[path[step++]];
      if (!delta) { advancePlayback(); return; }
      cursor = { x: cursor.x + delta[0], y: cursor.y + delta[1] };
      playback.positionOverrides.set(entry.actorId, { x: cursor.x, y: cursor.y });
      centerOnCellIfIdle(cursor);
      renderPlayfieldOnly();
      playback.timerId = scheduleTimeout(walk, MOVE_STEP_MS);
    };
    playback.timerId = scheduleTimeout(walk, MOVE_STEP_MS);
  }

  function finishPlayback() {
    clearPlaybackTimer();
    playback.active = false;
    playback.entries = null;
    playback.index = 0;
    playback.positionOverrides = new Map();
    playback.activeOverrideId = null;
    playback.flashCells = new Set();
    logCursor = combatState.log.length;
    const done = playback.onComplete;
    playback.onComplete = null;
    done?.();
  }

  // Tap during playback fast-forwards: cancels the current timer, dispatches every not-yet-seen
  // entry to the bus (log feed catches up), and fires the onComplete callback — same effect as
  // waiting for every remaining timer to fire, minus the pacing.
  function fastForwardPlayback() {
    if (!playback.active) return;
    clearPlaybackTimer();
    while (playback.index < playback.entries.length) {
      dispatchLogEntry(playback.entries[playback.index++]);
      if (logCursor < combatState.log.length) logCursor++;
    }
    finishPlayback();
  }

  // Claims the once-per-floor ledger charge for every Lucky reroll this combat actually used
  // (D2). One useAffixReroll call per distinct itemId — a duplicate luckyReroll log entry for
  // the same item (can't happen today since luckyRerollUsed gates one reroll per actor per
  // combat, but the dedupe stays defensive) never double-claims. A mid-combat autosave made
  // BEFORE this point can still resurrect the charge on resume — accepted v1 edge, see STATE.md.
  function claimLuckyRerolls() {
    const itemIds = new Set();
    for (const entry of combatState.log) {
      if (entry?.luckyReroll?.itemId) itemIds.add(entry.luckyReroll.itemId);
    }
    for (const itemId of itemIds) {
      const claim = useAffixReroll(runState, itemId, data.affixes);
      if (claim.success) runState = claim.runState;
    }
  }

  function dispatchTerminal() {
    if (!mounted || terminalDispatched || !combatState.ended) return;
    terminalDispatched = true;
    syncRunStateFromCombat(runState, combatState, { removeDead: combatState.result !== 'wipe' });
    claimLuckyRerolls();
    runState.activeCombat = null;
    const completion = completeEncounter(encounter, combatState);
    if (encounter.kind === 'hunt' && (combatState.result === 'victory' || combatState.result === 'retreat')) runState.dangerClockProgress = 0;
    if (combatState.result === 'victory') markDefeated(runState, completion.defeatedSpawnIds);
    const payload = { runState, floor, lattice, encounter, combatState, result: combatState.result, completion, autosaveReason: 'combat-resolution' };
    if (combatState.result === 'wipe') bus.dispatch('state:party-wipe', payload);
    else bus.dispatch('state:combat-end', payload);
  }

  function previewForTarget(targetId) {
    const actor = getActiveActor(combatState);
    const target = combatState.combatants.get(targetId);
    if (!actor || !target) return null;
    const distance = distanceCells(actor.position, target.position);
    const weapon = actor.weapon || UNARMED;
    let range;
    let targetLegal = true;
    if (selection.actionType === 'attack') {
      // evaluateRange requires a positive integer distance. Unpositioned actors (distance === null)
      // and same-cell (distance === 0) fall through as legal — matches the rules-layer treatment
      // in performAttackRoll (combat.js:451-455) where `positioned = distance !== null` short-circuits.
      range = distance != null && distance >= 1
        ? evaluateRange(weapon, distance)
        : { legal: true, band: weapon.rangeBand ?? 'adjacent', accuracyModifier: 0, reason: 'in_range' };
      targetLegal = range.legal;
    } else if (selection.actionType === 'cast' || selection.actionType === 'overclock') {
      // Protocol range gate: honor a numeric `range` on the protocol tier when present. Every
      // shipped protocol in data/protocols.json today declares range as a human-readable string
      // ("SIG×2", "adjacent"), so Number.isFinite is false and this stays a no-op. When a future
      // protocol adopts a numeric range the check becomes live without a UI change.
      const p = data?.protocols?.schools?.[selection.protocol?.school]?.tiers?.[selection.protocol?.tier - 1];
      const pRange = Number.isFinite(p?.range) ? p.range : Infinity;
      const withinRange = distance == null || distance <= pRange;
      range = {
        legal: withinRange,
        band: 'protocol',
        accuracyModifier: 0,
        reason: withinRange ? 'in_range' : 'beyond_maximum'
      };
      targetLegal = withinRange;
    } else if (selection.actionType === 'item') {
      // Consumable targets are always party members from the actor's own list; no ranged item
      // exists today so item targeting is always legal.
      range = { legal: true, band: 'self-or-adjacent', accuracyModifier: 0, reason: 'in_range' };
    } else {
      range = { legal: true, band: selection.actionType || 'effect', accuracyModifier: 0, reason: 'in_range' };
    }
    const coverBonus = selection.actionType === 'attack' ? getEdgeCoverBonus(combatState.window, actor, target) : 0;
    const flanked = selection.actionType === 'attack' ? isFlanked(target, getActors(combatState).filter((other) => other.side === actor.side && other.hp > 0), combatState.window) : false;
    return { distance, range, coverBonus, flanked, targetLegal };
  }

  function overlayOptions() {
    const targets = targetsForSelection();
    const validTargets = new Set(targets.filter((target) => target.position).map((target) => `${target.position.x},${target.position.y}`));
    const selected = combatState.combatants.get(selection.targetId);
    const selectedKey = selected?.position ? `${selected.position.x},${selected.position.y}` : null;
    const preview = selected ? previewForTarget(selected.id) : null;
    const actor = getActiveActor(combatState);
    const isMoveMode = selection.actionType === 'move' && (selection.phase === 'choose-path' || selection.phase === 'confirm');
    const pathCells = new Set();
    let rangeCells;
    if (isMoveMode && actor?.position) {
      const reachable = getMoveRange();
      rangeCells = new Set(reachable.keys());
      let cursor = { x: actor.position.x, y: actor.position.y };
      for (const dir of selection.movePath || []) {
        const delta = DIRECTION_DELTAS[dir];
        if (!delta) break;
        cursor = { x: cursor.x + delta[0], y: cursor.y + delta[1] };
        pathCells.add(`${cursor.x},${cursor.y}`);
      }
    } else {
      rangeCells = selectedKey ? new Set([selectedKey]) : new Set();
    }
    return {
      selectedTargetId: selection.targetId,
      validTargets,
      rangeCells,
      coverCells: selectedKey && preview?.coverBonus > 0 ? new Set([selectedKey]) : new Set(),
      pathCells,
      confirmCell: isMoveMode && (selection.movePath?.length ?? 0) > 0 && actor?.position
        ? `${pathEndpoint(actor).x},${pathEndpoint(actor).y}`
        : null
    };
  }

  // Direct activation: one legal canvas tap executes. Attack/cast/overclock/item tap a target
  // cell; move taps a reachable destination cell — both route through selectTarget/
  // selectDestination, which now confirm inline. No second "tap again" gesture.
  function onCanvasTap({ clientX, clientY }) {
    if (!mounted) return;
    // A tap during enemy playback fast-forwards to completion instead of selecting anything.
    if (playback.active) {
      fastForwardPlayback();
      return;
    }
    const cell = cellAtPoint({ canvas, cellSize: COMBAT_CELL_SIZE, viewTransform: camera.viewTransform(currentDpr) }, clientX, clientY);
    if (!cell) return;
    if (['attack', 'cast', 'overclock', 'item'].includes(selection.actionType) && ['choose-target', 'confirm'].includes(selection.phase)) {
      const hit = targetsForSelection().find((target) => target.position && target.position.x === cell.x && target.position.y === cell.y);
      if (hit) selectTarget(hit.id);
      return;
    }
    if (selection.actionType === 'move' && (selection.phase === 'choose-path' || selection.phase === 'confirm')) {
      if (getMoveRange().has(`${cell.x},${cell.y}`)) selectDestination(cell);
      return;
    }
    if (selection.phase === 'choose-action') {
      const legal = legalActions().actions || [];
      if (!legal.includes('move')) return;
      if (!getMoveRange().has(`${cell.x},${cell.y}`)) return;
      if (chooseAction('move')) selectDestination(cell);
    }
  }

  function renderAll() {
    if (!mounted) return;
    playfield.renderCombat(combatState, combatLattice, {
      ...overlayOptions(),
      viewTransform: camera.viewTransform(currentDpr),
      positionOverrides: playback.positionOverrides.size ? playback.positionOverrides : undefined,
      activeOverrideId: playback.activeOverrideId ?? undefined,
      flashCells: playback.flashCells.size ? playback.flashCells : undefined
    });
    if (!isWide) {
      const nextStatusBar = createStatusBar(runState, combatState, { data });
      nextStatusBar.classList.add('panel', 'combat-status', 'in-run-status');
      nextStatusBar.style.flex = '0 0 auto';
      statusBar.cleanup?.();
      if (typeof statusBar.replaceWith === 'function') statusBar.replaceWith(nextStatusBar);
      else statusBar.parentNode?.replaceChild?.(nextStatusBar, statusBar);
      statusBar = nextStatusBar;
    }
    consoleController.refresh();
    syncFeedbackRail();
  }

  return {
    unmount() {
      if (!mounted) return;
      // Flush any log entries still queued by an in-progress playback BEFORE tearing down —
      // logCursor must end equal to combatState.log.length on every path so LOG mode stays whole.
      // Runs before listeners detach so the telemetry feed still receives them.
      clearPlaybackTimer();
      if (playback.active && playback.entries) {
        while (playback.index < playback.entries.length) {
          dispatchLogEntry(playback.entries[playback.index++]);
        }
      }
      logCursor = combatState.log.length;
      mounted = false;
      playback.active = false;
      playback.entries = null;
      playback.onComplete = null;
      gestureCleanup?.();
      resizeObserverInstance?.disconnect?.();
      widePanesCleanup?.();
      statusBar?.cleanup?.();
      telemetryDock?.cleanup?.();
      playfield.destroy();
      consoleController.destroy();
      inputHandler.destroy();
    }
  };
}
