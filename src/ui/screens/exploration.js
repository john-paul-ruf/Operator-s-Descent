import { createStatusBar, createTelemetryDock } from '../status-strip.js';
import { createPlayfield, cellAtPoint } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { attachWidePanes, currentLayoutClass } from '../layout.js';
import { createViewportCamera, attachViewportGestures, sizeCanvasToContainer } from '../viewport.js';
import { loadSettings, saveSettings } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createRNGCursorForRun } from '../../core/rng-cursor.js';
import { createLattice } from '../../exploration/lattice.js';
import { findExplorationPath, moveParty, computeExplorationProximity } from '../../exploration/movement.js';
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
const DEFAULT_ENTRY_CELL_PX = 40;
const LATTICE_WORLD_W = 20 * EXPLORATION_CELL_PX;
const LATTICE_WORLD_H = 32 * EXPLORATION_CELL_PX;
const AUTO_FOLLOW_MARGIN_CELLS = 2;
const TAP_PATH_MAX_STEPS = 64;
const MOVE_INTENT_PATTERN = /^move_(n|s|w|e|nw|ne|sw|se)$/;

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
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.dataset.testid = 'exploration-canvas';
  playfieldBody.appendChild(canvas);
  const playfield = createPlayfield(canvas);
  const reducedMotionSetting = loadSettings().reducedMotion;
  const prefersReduced = typeof globalThis.window?.matchMedia === 'function'
    && globalThis.window.matchMedia('(prefers-reduced-motion: reduce)')?.matches;
  const reduceMotion = reducedMotionSetting === 'reduce'
    || (reducedMotionSetting !== 'full' && prefersReduced);
  playfield.setPulse(!reduceMotion);

  const camera = createViewportCamera({ worldW: LATTICE_WORLD_W, worldH: LATTICE_WORLD_H });
  let cameraDpr = 1;
  let suppressFollow = false;
  let firstSized = false;
  let activeTrail = null;
  let tapRunToken = 0;

  function refocusContainer() {
    const active = globalThis.document?.activeElement;
    if (active === container) return;
    if (typeof container.contains === 'function' && container.contains(active)) return;
    container.focus?.({ preventScroll: true });
  }

  function onPointerDownCapture() {
    refocusContainer();
  }
  playfieldBody.addEventListener('pointerdown', onPointerDownCapture, true);

  const gestureCleanup = attachViewportGestures(playfieldBody, camera, {
    onChange: () => {
      suppressFollow = true;
      renderPlayfield();
    },
    onTap: handleTap
  });

  function primeCamera(w, h) {
    camera.setViewport(w, h);
    if (!firstSized) {
      firstSized = true;
      camera.zoomToCells(EXPLORATION_CELL_PX, DEFAULT_ENTRY_CELL_PX);
      const p = lattice?.getPartyPosition?.();
      if (p) {
        const px = p.x * EXPLORATION_CELL_PX + EXPLORATION_CELL_PX / 2;
        const py = p.y * EXPLORATION_CELL_PX + EXPLORATION_CELL_PX / 2;
        camera.centerOn(px, py);
      }
    }
  }

  function resizeCanvas() {
    const rect = playfieldBody.getBoundingClientRect?.();
    const rectW = rect?.width || 0;
    const rectH = rect?.height || 0;
    if (rectW <= 0 || rectH <= 0) {
      // Pre-observer fallback: no measurable body yet. Keep the 480×768 canvas
      // defaults, prime the camera with those dims so viewTransform is usable
      // for the initial paint. The ResizeObserver will call back with real
      // dims once layout settles.
      primeCamera(canvas.width, canvas.height);
      return;
    }
    const { w, h, dpr } = sizeCanvasToContainer(canvas, playfieldBody);
    cameraDpr = dpr;
    primeCamera(w, h);
  }

  let resizeObserver = null;
  if (typeof globalThis.ResizeObserver === 'function') {
    resizeObserver = new globalThis.ResizeObserver(() => {
      resizeCanvas();
      renderPlayfield();
    });
    resizeObserver.observe(playfieldBody);
  }

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
  refreshLootState();
  pushAudioProximity();

  resizeCanvas();
  ensurePartyVisible();
  renderPlayfield();
  scheduleFrame(() => {
    if (unmounted) return;
    resizeCanvas();
    ensurePartyVisible();
    renderPlayfield();
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
      onMove(match[1]);
    })
  ];

  function refreshVisibility() {
    const position = lattice.getPartyPosition();
    visibleCells = computeLOS(lattice, position.x, position.y, losRadius(runState));
    updateFogOfWar(fogState, visibleCells);
    syncVisitedBitmap(fogState, runState.fogOfWar);
  }

  function renderPlayfield() {
    playfield.renderExploration(lattice, fogState, lattice.getPartyPosition(), {
      viewTransform: camera.viewTransform(cameraDpr),
      stagedPath: activeTrail ? activeTrail.slice() : []
    });
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
    const contactEntity = result.contactEntity || result.discoveredEntity;
    const contact = contactEntity || position;
    const encounter = result.interruptType === 'hunt'
      ? createHuntEncounter(floor, position, runState.party, runState, rngCursor, data)
      : createStandardEncounter(floor, contact, runState.party, [contactEntity].filter(Boolean), rngCursor);
    runState.rngState = rngCursor.getState();
    notice = result.interruptType === 'hunt' ? 'HUNT CONTACT REQUESTED.' : 'HOSTILE CONTACT — ENGAGING.';
    bus.dispatch('state:combat-start', { runState, floor, lattice, encounter, reason: result.interruptType || 'contact', contact, moveResult: result });
  }

  function ensurePartyVisible() {
    if (suppressFollow) return;
    const partyPos = lattice.getPartyPosition();
    if (!partyPos) return;
    const st = camera.getState();
    if (!st.scale || !st.viewW || !st.viewH) return;
    const spanX = st.viewW / st.scale;
    const spanY = st.viewH / st.scale;
    const partyPxX = partyPos.x * EXPLORATION_CELL_PX + EXPLORATION_CELL_PX / 2;
    const partyPxY = partyPos.y * EXPLORATION_CELL_PX + EXPLORATION_CELL_PX / 2;
    const margin = AUTO_FOLLOW_MARGIN_CELLS * EXPLORATION_CELL_PX;
    let dx = 0;
    let dy = 0;
    if (partyPxX < st.x + margin) dx = partyPxX - (st.x + margin);
    else if (partyPxX > st.x + spanX - margin) dx = partyPxX - (st.x + spanX - margin);
    if (partyPxY < st.y + margin) dy = partyPxY - (st.y + margin);
    else if (partyPxY > st.y + spanY - margin) dy = partyPxY - (st.y + spanY - margin);
    if (dx === 0 && dy === 0) return;
    camera.panBy(dx * st.scale, dy * st.scale);
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
    suppressFollow = false;
    ensurePartyVisible();
    renderPlayfield();
    runState.rngState = rngCursor.getState();
    bus.dispatch('state:danger-clock-tick', { progress: runState.dangerClockProgress });
    pushAudioProximity();
    if (result.combatContact || result.interruptType === 'hunt') {
      alertBanner.hidden = false;
      requestCombat(result);
    } else if (result.interruptType === 'hostile') {
      alertBanner.hidden = false;
      const off = result.proximity?.nearestHostile;
      notice = off != null
        ? `HOSTILE SIGHTED — ${off} SQUARES OFF. CLOSE TO ENGAGE.`
        : 'HOSTILE SIGHTED — CLOSE TO ENGAGE.';
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

  function handleTap({ clientX, clientY }) {
    if (unmounted || runState.activeCombat) return;
    const cell = cellAtPoint({ canvas, cellSize: EXPLORATION_CELL_PX, viewTransform: camera.viewTransform(cameraDpr) }, clientX, clientY);
    if (!cell) return;
    const party = lattice.getPartyPosition();
    if (!party || (cell.x === party.x && cell.y === party.y)) return;
    const path = findExplorationPath(lattice, fogState, party, cell, { maxSteps: TAP_PATH_MAX_STEPS });
    if (!path) {
      notice = 'NO PATH.';
      consoleController.refresh();
      return;
    }
    activeTrail = path.cells;
    renderPlayfield();
    const token = ++tapRunToken;
    scheduleFrame(() => runTapPath(path.path, token));
  }

  function runTapPath(steps, token) {
    if (token !== tapRunToken || unmounted) return;
    for (const step of steps) {
      if (token !== tapRunToken || unmounted) return;
      if (runState.activeCombat) break;
      const result = onMove(step);
      if (!result || !result.moved) break;
      if (isInterruptType(result)) break;
    }
    if (token === tapRunToken) {
      activeTrail = null;
      if (!unmounted) renderPlayfield();
    }
  }

  return {
    unmount() {
      if (unmounted) return;
      unmounted = true;
      tapRunToken++;
      for (const unsubscribe of unsubscribers) unsubscribe();
      gestureCleanup?.();
      playfieldBody.removeEventListener('pointerdown', onPointerDownCapture, true);
      resizeObserver?.disconnect();
      widePanesCleanup?.();
      statusBar?.cleanup?.();
      telemetryDock?.cleanup?.();
      playfield.destroy();
      consoleController.destroy();
      inputHandler.destroy();
    }
  };
}
