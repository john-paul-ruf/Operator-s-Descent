import { createStatusBar, createTelemetryDock } from '../status-strip.js';
import { createPlayfield } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { attachWidePanes, currentLayoutClass } from '../layout.js';
import { loadSettings, saveSettings } from '../../state/library.js';
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

const EXPLORATION_CELL_PX = 24;
const AUTO_FOLLOW_MARGIN_CELLS = 2;
const DRAG_THRESHOLD_PX = 6;
const MOVE_INTENT_PATTERN = /^move_(n|s|w|e|nw|ne|sw|se)$/;
const STAGE_MAX_STEPS = 24;
const DIR_DELTAS = {
  n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0],
  nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1]
};

function isInterruptType(result) {
  if (!result || !result.interruptType) return false;
  return result.interruptType !== 'invalid-direction' && result.interruptType !== 'blocked';
}

function scheduleFrame(callback) {
  const raf = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame : null;
  if (raf) raf(callback);
  else callback();
}

export function mount(container, params = {}) {
  const runState = params.runState;
  const floor = params.floor;
  const data = params.data || {};
  const inputHandler = createInputHandler({ legacyActions: false });
  inputHandler.bindToElement(container);
  clear(container);
  container.classList.add('exploration-screen', 'in-run-screen');
  container.style.position = 'relative';
  container.style.overflow = 'hidden';

  const layout = currentLayoutClass();
  const isWide = layout === 'wide';

  let statusBar = null;
  let telemetryDock = null;
  let alertBanner;
  let playfieldBody;
  let widePlayfieldColumn = null;

  if (isWide) {
    const shell = document.createElement('div');
    shell.className = 'wide-shell';
    shell.dataset.wideRoot = '';
    shell.dataset.testid = 'wide-shell';

    telemetryDock = createTelemetryDock(runState);
    shell.appendChild(telemetryDock);

    widePlayfieldColumn = document.createElement('section');
    widePlayfieldColumn.className = 'wide-playfield-column';

    alertBanner = document.createElement('div');
    alertBanner.className = 'alert-banner playfield-alert-banner';
    alertBanner.hidden = true;
    alertBanner.textContent = '◈ HOSTILE DETECTED — MOVEMENT HALTED — TAP TO ENGAGE';
    alertBanner.dataset.testid = 'alert-banner';
    widePlayfieldColumn.appendChild(alertBanner);

    playfieldBody = document.createElement('div');
    playfieldBody.className = 'exploration-playfield playfield-body wide-playfield-inner';
    playfieldBody.style.overflow = 'hidden';
    playfieldBody.style.position = 'relative';
    widePlayfieldColumn.appendChild(playfieldBody);

    shell.appendChild(widePlayfieldColumn);
    container.appendChild(shell);
  } else {
    statusBar = createStatusBar(runState);
    statusBar.classList.add('panel', 'in-run-status');
    statusBar.style.flex = '0 0 auto';
    container.appendChild(statusBar);

    alertBanner = document.createElement('div');
    alertBanner.className = 'alert-banner';
    alertBanner.hidden = true;
    alertBanner.textContent = '◈ HOSTILE DETECTED — MOVEMENT HALTED — TAP TO ENGAGE';
    alertBanner.dataset.testid = 'alert-banner';
    container.appendChild(alertBanner);

    playfieldBody = document.createElement('div');
    playfieldBody.className = 'exploration-playfield playfield-body';
    playfieldBody.style.flex = '1 1 auto';
    playfieldBody.style.minHeight = '0';
    playfieldBody.style.marginBottom = '96px';
    playfieldBody.style.overflow = 'hidden';
    playfieldBody.style.position = 'relative';
    container.appendChild(playfieldBody);
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'playfield-canvas lattice-canvas';
  canvas.width = 480;
  canvas.height = 768;
  canvas.dataset.testid = 'exploration-canvas';
  playfieldBody.appendChild(canvas);
  playfieldBody.style.cursor = 'grab';
  const playfield = createPlayfield(canvas);

  const panOffset = { x: 0, y: 0 };
  let suppressFollow = false;
  let dragState = null;

  function readSizes() {
    const canvasRect = canvas.getBoundingClientRect?.() || { width: canvas.width, height: canvas.height };
    const bodyRect = playfieldBody.getBoundingClientRect?.() || { width: canvasRect.width, height: canvasRect.height };
    return {
      canvasW: canvasRect.width || canvas.width,
      canvasH: canvasRect.height || canvas.height,
      bodyW: bodyRect.width || canvasRect.width || canvas.width,
      bodyH: bodyRect.height || canvasRect.height || canvas.height
    };
  }

  function clampPan() {
    const { canvasW, canvasH, bodyW, bodyH } = readSizes();
    const minX = Math.min(0, bodyW - canvasW);
    const minY = Math.min(0, bodyH - canvasH);
    panOffset.x = Math.max(minX, Math.min(0, panOffset.x));
    panOffset.y = Math.max(minY, Math.min(0, panOffset.y));
  }

  function applyPan() {
    canvas.style.transform = `translate3d(${panOffset.x}px, ${panOffset.y}px, 0)`;
  }

  function ensurePartyVisible() {
    if (suppressFollow) return;
    const partyPos = lattice.getPartyPosition();
    if (!partyPos) return;
    const { canvasW, canvasH, bodyW, bodyH } = readSizes();
    const scaleX = canvas.width ? canvasW / canvas.width : 1;
    const scaleY = canvas.height ? canvasH / canvas.height : 1;
    const cellPxX = EXPLORATION_CELL_PX * scaleX;
    const cellPxY = EXPLORATION_CELL_PX * scaleY;
    const partyPxX = partyPos.x * cellPxX + cellPxX / 2;
    const partyPxY = partyPos.y * cellPxY + cellPxY / 2;
    const visibleLeft = -panOffset.x;
    const visibleTop = -panOffset.y;
    const visibleRight = visibleLeft + bodyW;
    const visibleBottom = visibleTop + bodyH;
    const marginX = AUTO_FOLLOW_MARGIN_CELLS * cellPxX;
    const marginY = AUTO_FOLLOW_MARGIN_CELLS * cellPxY;
    let dx = 0;
    let dy = 0;
    if (partyPxX < visibleLeft + marginX) dx = visibleLeft + marginX - partyPxX;
    else if (partyPxX > visibleRight - marginX) dx = visibleRight - marginX - partyPxX;
    if (partyPxY < visibleTop + marginY) dy = visibleTop + marginY - partyPxY;
    else if (partyPxY > visibleBottom - marginY) dy = visibleBottom - marginY - partyPxY;
    if (dx === 0 && dy === 0) return;
    panOffset.x += dx;
    panOffset.y += dy;
    clampPan();
    applyPan();
  }

  function refocusContainer() {
    const active = globalThis.document?.activeElement;
    if (active === container) return;
    if (typeof container.contains === 'function' && container.contains(active)) return;
    container.focus?.({ preventScroll: true });
  }

  function onPointerDown(event) {
    refocusContainer();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX ?? 0,
      startY: event.clientY ?? 0,
      startPanX: panOffset.x,
      startPanY: panOffset.y,
      moved: false
    };
    if (event.pointerId != null) playfieldBody.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragState) return;
    if (event.pointerId != null && dragState.pointerId != null && event.pointerId !== dragState.pointerId) return;
    const dx = (event.clientX ?? 0) - dragState.startX;
    const dy = (event.clientY ?? 0) - dragState.startY;
    if (!dragState.moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    dragState.moved = true;
    suppressFollow = true;
    playfieldBody.style.cursor = 'grabbing';
    panOffset.x = dragState.startPanX + dx;
    panOffset.y = dragState.startPanY + dy;
    clampPan();
    applyPan();
  }

  function onPointerEnd(event) {
    if (!dragState) return;
    if (event.pointerId != null && dragState.pointerId != null) {
      playfieldBody.releasePointerCapture?.(event.pointerId);
    }
    dragState = null;
    playfieldBody.style.cursor = 'grab';
  }

  function onTouchMove(event) {
    if (dragState) event.preventDefault?.();
  }

  playfieldBody.addEventListener('pointerdown', onPointerDown);
  playfieldBody.addEventListener('pointermove', onPointerMove);
  playfieldBody.addEventListener('pointerup', onPointerEnd);
  playfieldBody.addEventListener('pointercancel', onPointerEnd);
  playfieldBody.addEventListener('touchmove', onTouchMove, { passive: false });

  const lattice = createLattice(floor, runState);
  runState.partyPosition = lattice.getPartyPosition();
  const initialVisibleCells = computeLOS(lattice, runState.partyPosition.x, runState.partyPosition.y, losRadius(runState));
  const fogState = createFogState(runState.fogOfWar, initialVisibleCells);
  let visibleCells = initialVisibleCells;
  let notice = '';
  let unmounted = false;

  const rngCursor = createRNGCursorForRun(runState.worldSeed, runState.rngState);
  const autoStopToggles = { discovery: true, damage: true };
  const stagedPath = [];
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
    get stagedPath() { return stagedPath.slice(); },
    canLoot: () => Boolean(findEligibleLootContainer(lattice, runState)),
    canDescend: () => sameCell(lattice.getPartyPosition(), lattice.getDescentPoint()),
    onMove,
    onConfirmDescent,
    stageMove,
    onCommitStagedMoves,
    onUndoStagedMove,
    onClearStagedMoves,
    setAutoStopToggle(name, value) {
      autoStopToggles[name] = Boolean(value);
      notice = `${name.toUpperCase()} AUTO-STOP ${autoStopToggles[name] ? 'ON' : 'OFF'}`;
      consoleController.refresh();
    }
  };

  const consoleController = createConsole(viewState, { variant: isWide ? 'dock' : 'bar' });
  let widePanesCleanup = null;
  if (isWide) {
    container.firstChild.appendChild(consoleController.render());
    widePanesCleanup = attachWidePanes({ shell: container.firstChild, loadSettings, saveSettings });
  } else {
    container.appendChild(consoleController.render());
  }

  const theme = themeFor(floor, data);
  playfield.setAccent(theme?.accentColor || '#7ec8e3');
  refreshVisibility();
  renderPlayfield();
  refreshLootState();
  pushAudioProximity();

  scheduleFrame(() => {
    if (unmounted) return;
    clampPan();
    ensurePartyVisible();
    applyPan();
  });
  container.focus?.({ preventScroll: true });

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
    }),
    bus.on('console:intent', (payload = {}) => {
      if (unmounted) return;
      const match = MOVE_INTENT_PATTERN.exec(payload.action || '');
      if (!match) return;
      if (runState.activeCombat) return;
      stageMove(match[1]);
    })
  ];

  function onKeyDownEscape(event) {
    const key = event.key || event.code;
    if (key !== 'Escape') return;
    if (stagedPath.length === 0) return;
    onClearStagedMoves();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  container.addEventListener('keydown', onKeyDownEscape);

  function refreshVisibility() {
    const position = lattice.getPartyPosition();
    visibleCells = computeLOS(lattice, position.x, position.y, losRadius(runState));
    updateFogOfWar(fogState, visibleCells);
    syncVisitedBitmap(fogState, runState.fogOfWar);
  }

  function renderPlayfield() {
    playfield.renderExploration(lattice, fogState, lattice.getPartyPosition(), { stagedPath: stagedPath.slice() });
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
    suppressFollow = false;
    ensurePartyVisible();
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

  function stageOrigin() {
    if (stagedPath.length === 0) return lattice.getPartyPosition();
    const tail = stagedPath[stagedPath.length - 1];
    return { x: tail.x, y: tail.y };
  }

  function stageMove(direction) {
    if (unmounted || runState.activeCombat) return false;
    const delta = DIR_DELTAS[direction];
    if (!delta) return false;
    if (stagedPath.length >= STAGE_MAX_STEPS) {
      notice = `STAGING FULL (${STAGE_MAX_STEPS}) — CONFIRM or CLEAR to continue.`;
      consoleController.refresh();
      return false;
    }
    const origin = stageOrigin();
    const nx = origin.x + delta[0];
    const ny = origin.y + delta[1];
    if (!lattice.isWalkable(nx, ny)) {
      notice = 'CANNOT STAGE — wall or closed corner.';
      consoleController.refresh();
      return false;
    }
    if (delta[0] !== 0 && delta[1] !== 0) {
      const hWalk = lattice.isWalkable(origin.x + delta[0], origin.y);
      const vWalk = lattice.isWalkable(origin.x, origin.y + delta[1]);
      if (!hWalk && !vWalk) {
        notice = 'CANNOT STAGE — wall or closed corner.';
        consoleController.refresh();
        return false;
      }
    }
    stagedPath.push({ direction, x: nx, y: ny });
    notice = '';
    renderPlayfield();
    consoleController.refresh();
    return true;
  }

  function onUndoStagedMove() {
    if (stagedPath.length === 0) return false;
    stagedPath.pop();
    notice = '';
    renderPlayfield();
    consoleController.refresh();
    return true;
  }

  function onClearStagedMoves() {
    if (stagedPath.length === 0) return false;
    stagedPath.length = 0;
    notice = 'STAGED PATH CLEARED.';
    renderPlayfield();
    consoleController.refresh();
    return true;
  }

  function onCommitStagedMoves() {
    if (stagedPath.length === 0) return false;
    const queue = stagedPath.slice();
    stagedPath.length = 0;
    let lastResult = null;
    for (const step of queue) {
      if (unmounted) break;
      if (runState.activeCombat) break;
      lastResult = onMove(step.direction);
      if (!lastResult || !lastResult.moved) break;
      if (isInterruptType(lastResult)) break;
    }
    if (!unmounted) renderPlayfield();
    return lastResult;
  }

  return {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      container.removeEventListener('keydown', onKeyDownEscape);
      playfieldBody.removeEventListener('pointerdown', onPointerDown);
      playfieldBody.removeEventListener('pointermove', onPointerMove);
      playfieldBody.removeEventListener('pointerup', onPointerEnd);
      playfieldBody.removeEventListener('pointercancel', onPointerEnd);
      playfieldBody.removeEventListener('touchmove', onTouchMove);
      widePanesCleanup?.();
      statusBar?.cleanup?.();
      telemetryDock?.cleanup?.();
      consoleController.destroy();
      inputHandler.destroy();
    }
  };
}
