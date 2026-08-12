import { createStatusBar } from '../status-strip.js';
import { createPlayfield } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { bus } from '../../state/bus.js';
import { createRNGCursorForRun } from '../../core/rng-cursor.js';
import { createLattice } from '../../exploration/lattice.js';
import { moveParty, computeExplorationProximity } from '../../exploration/movement.js';
import { computeLOS, createFogState, updateFogOfWar, syncVisitedBitmap } from '../../exploration/shadowcast.js';
import { createHuntEncounter, createStandardEncounter } from '../../rules/encounters.js';
import { findEligibleLootContainer } from '../console/loot.js';

function clear(element) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else while (element.firstChild) element.removeChild(element.firstChild);
}

function losRadius(runState) {
  const sig = runState?.party?.[0]?.attributes?.sig;
  return sig ? Math.max(1, sig * 2) : 8;
}

function sameCell(left, right) {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

function themeFor(floor, data) {
  return data?.themes?.themes?.find((entry) => entry.id === floor?.themeId) ?? null;
}

function normalizeMoveOptions(toggles) {
  return {
    autoStopToggles: {
      container: toggles.discovery !== false,
      descent: toggles.discovery !== false,
      damage: toggles.damage !== false
    }
  };
}

export function mount(container, params = {}) {
  const runState = params.runState;
  const floor = params.floor;
  const data = params.data || {};
  const inputHandler = createInputHandler({ legacyActions: false });
  inputHandler.bindToElement(container);
  clear(container);

  const statusBar = createStatusBar(runState);
  container.appendChild(statusBar);

  const alertBanner = document.createElement('div');
  alertBanner.className = 'alert-banner';
  alertBanner.hidden = true;
  alertBanner.textContent = '◈ HOSTILE DETECTED — MOVEMENT HALTED — TAP TO ENGAGE';
  alertBanner.dataset.testid = 'alert-banner';
  container.appendChild(alertBanner);

  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 768;
  canvas.dataset.testid = 'exploration-canvas';
  container.appendChild(canvas);
  const playfield = createPlayfield(canvas);

  const lattice = createLattice(floor, runState);
  runState.partyPosition = lattice.getPartyPosition();
  const initialVisibleCells = computeLOS(lattice, runState.partyPosition.x, runState.partyPosition.y, losRadius(runState));
  const fogState = createFogState(runState.fogOfWar, initialVisibleCells);
  let visibleCells = initialVisibleCells;
  let notice = '';
  let unmounted = false;

  const rngCursor = createRNGCursorForRun(runState.worldSeed, runState.rngState);
  const autoStopToggles = { discovery: true, damage: true };
  const viewState = {
    runState,
    floor,
    data,
    inputHandler,
    lattice,
    fogState,
    autoStopToggles,
    lastMoveResult: null,
    lootState: null,
    get notice() { return notice; },
    canLoot: () => Boolean(findEligibleLootContainer(lattice, runState)),
    canDescend: () => sameCell(lattice.getPartyPosition(), lattice.getDescentPoint()),
    onMove,
    onConfirmDescent,
    setAutoStopToggle(name, value) {
      autoStopToggles[name] = Boolean(value);
      notice = `${name.toUpperCase()} AUTO-STOP ${autoStopToggles[name] ? 'ON' : 'OFF'}`;
      consoleController.refresh();
    }
  };

  const consoleController = createConsole(viewState);
  container.appendChild(consoleController.render());

  const theme = themeFor(floor, data);
  playfield.setAccent(theme?.accentColor || '#7ec8e3');
  refreshVisibility();
  renderPlayfield();
  refreshLootState();
  pushAudioProximity();

  const unsubscribers = [
    bus.on('state:combat-end', ({ result } = {}) => {
      if (result === 'victory') {
        alertBanner.hidden = true;
        refreshVisibility();
        refreshLootState();
        renderPlayfield();
        pushAudioProximity({ combatActive: false });
        consoleController.refresh();
      }
    })
  ];

  function refreshVisibility() {
    const position = lattice.getPartyPosition();
    visibleCells = computeLOS(lattice, position.x, position.y, losRadius(runState));
    updateFogOfWar(fogState, visibleCells);
    syncVisitedBitmap(fogState, runState.fogOfWar);
  }

  function renderPlayfield() {
    playfield.renderExploration(lattice, fogState, lattice.getPartyPosition());
  }

  function refreshLootState() {
    const container = findEligibleLootContainer(lattice, runState);
    viewState.lootState = container ? { container, items: [] } : null;
    return container;
  }

  function pushAudioProximity(extra = {}) {
    const proximity = computeExplorationProximity(lattice, visibleCells, runState);
    const payload = {
      worldSeed: runState.worldSeed,
      depth: runState.depth,
      floorId: `${runState.worldSeed}:${runState.depth}:${floor?.floorSubSeed ?? 0}`,
      theme,
      audioMode: theme?.audioMode,
      proximity: { hostile: proximity.nearestHostile, container: proximity.nearestContainer },
      nearestHostileDistance: proximity.nearestHostile,
      nearestContainerDistance: proximity.nearestContainer,
      ...extra
    };
    bus.dispatch('audio:update-state', payload);
    return payload;
  }

  function requestCombat(result) {
    const position = lattice.getPartyPosition();
    const encounter = result.interruptType === 'hunt'
      ? createHuntEncounter(floor, position, runState.party, runState, rngCursor, data)
      : createStandardEncounter(floor, result.discoveredEntity || position, runState.party, [result.discoveredEntity].filter(Boolean), rngCursor);
    runState.rngState = rngCursor.getState();
    notice = result.interruptType === 'hunt' ? 'HUNT CONTACT REQUESTED.' : 'HOSTILE CONTACT REQUESTED.';
    bus.dispatch('state:combat-start', { runState, floor, lattice, encounter, reason: result.interruptType, contact: result.discoveredEntity, moveResult: result });
  }

  function handleMoveResult(result) {
    viewState.lastMoveResult = result;
    if (!result.moved) {
      notice = result.interruptType === 'blocked' ? 'BLOCKED — wall or closed corner.' : 'MOVE FAILED.';
      consoleController.refresh();
      return result;
    }
    refreshVisibility();
    refreshLootState();
    renderPlayfield();
    runState.rngState = rngCursor.getState();
    bus.dispatch('state:danger-clock-tick', { progress: runState.dangerClockProgress });
    pushAudioProximity();
    if (result.interruptType === 'hostile' || result.interruptType === 'hunt') {
      alertBanner.hidden = false;
      requestCombat(result);
    } else {
      alertBanner.hidden = true;
      if (result.interruptType === 'container' && viewState.lootState) {
        notice = 'CONTAINER IN REACH — LOOT MODE READY.';
        consoleController.setMode('loot', { source: 'container' });
      } else if (result.interruptType === 'descent') notice = 'DESCENT DISCOVERED — step onto it and confirm.';
      else if (result.interruptType === 'damage') notice = 'DAMAGE INTERRUPT — movement stopped.';
      else notice = '';
    }
    consoleController.refresh();
    return result;
  }

  function onMove(direction) {
    if (unmounted) return false;
    const result = moveParty(lattice, fogState, direction, rngCursor, runState, { ...normalizeMoveOptions(autoStopToggles), combatActive: Boolean(runState.activeCombat) });
    return handleMoveResult(result);
  }

  function onConfirmDescent() {
    if (!viewState.canDescend()) {
      notice = 'NO DESCENT POINT UNDERFOOT.';
      consoleController.refresh();
      return false;
    }
    notice = 'DESCENT REQUESTED.';
    bus.dispatch('state:floor-change', { runState, floor, lattice, reason: 'descent-confirmed' });
    return true;
  }

  return {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      statusBar.cleanup?.();
      consoleController.destroy();
      inputHandler.destroy();
    }
  };
}
