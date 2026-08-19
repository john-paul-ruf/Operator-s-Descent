import { CELL } from '../exploration/lattice.js';
import { validateSigilToken } from './components.js';

export const EXPLORATION_CELL_SIZE = 24;
export const COMBAT_CELL_SIZE = EXPLORATION_CELL_SIZE * 2;
export const COMBAT_GRID_W = 8;
export const COMBAT_GRID_H = 16;
export const FLOOR_COLOR = '#101010';
export const FLOOR_DIM_COLOR = '#0a0a0a';
export const WALL_COLOR = '#000000';
export const HIDDEN_COLOR = '#000000';
export const GRID_COLOR = '#3a3a3a';
export const WALL_LINE_COLOR = '#7ec8e3';
export const TICK_DIM_ALPHA = 0.45;
export const WALL_PULSE_PERIOD_MS = 2400;
export const WALL_PULSE_FPS = 30;
export const WALL_GLOW_BLUR = [4, 12];
export const WALL_GLOW_ALPHA = [0.7, 1];
const WALL_STATIC_GLOW = 0.7;
const DANGER_COLOR = '#e83a3a';
const DESCENT_COLOR = '#3ae8a8';
const CONTAINER_COLOR = '#e8d23a';
const COVER_COLOR = '#e8c63a';
const PATH_COLOR = '#d8d8d8';
const PATH_PREVIEW_ALPHA = 0.55;
const ECHO_COLOR = '#b026d4';

function lerp(range, t) {
  return range[0] + t * (range[1] - range[0]);
}

export function wallThickness(size) {
  return Math.max(3, Math.round(size / 8));
}

function cssColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function themeAccent(input) {
  return cssColor(input?.accentColor) || cssColor(input?.accent) || cssColor(input?.color) || cssColor(input);
}

function getCombatants(combatState) {
  return combatState?.combatants instanceof Map
    ? [...combatState.combatants.values()]
    : Array.isArray(combatState?.combatants) ? combatState.combatants : [];
}

function actorRole(actor) {
  return actor.side === 'enemy' ? 'enemy' : actor.side === 'echo' ? 'echo' : 'player';
}

function codepointFromSigilId(value) {
  const match = typeof value === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(value);
  return match ? Number.parseInt(match[1], 16) : null;
}

function actorSigil(actor) {
  const role = actorRole(actor);
  return actor.sigilCodepoint || codepointFromSigilId(actor.sigilId) || (role === 'enemy' ? 0xE030 : 0xE000);
}

function drawCreatureSigil(ctx, { codepoint, size, renderSize = size, role, x, y, color }) {
  const validation = validateSigilToken(codepoint, size, role);
  if (!validation.valid) return false;
  ctx.font = `${renderSize}px 'DESCENT SIGIL'`;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = role === 'player' ? 8 : 5;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String.fromCodePoint(codepoint), x, y);
  ctx.shadowBlur = 0;
  return true;
}

function drawCell(ctx, x, y, size, cellType, visible = true, dim = false) {
  if (!visible) {
    ctx.fillStyle = HIDDEN_COLOR;
    ctx.fillRect(x, y, size, size);
    return;
  }
  if (cellType === CELL.WALL) {
    ctx.fillStyle = WALL_COLOR;
    ctx.fillRect(x, y, size, size);
    return;
  }
  ctx.fillStyle = dim ? FLOOR_DIM_COLOR : FLOOR_COLOR;
  ctx.fillRect(x, y, size, size);
}

function drawGridTicks(ctx, { isFloor, isRevealed, isDim, colStart, rowStart, cols, rows, size }) {
  const arm = Math.round(size / 6);
  const span = arm * 2 + 1;
  ctx.fillStyle = GRID_COLOR;
  for (let ry = 1; ry < rows; ry++) {
    for (let rx = 1; rx < cols; rx++) {
      const gx = colStart + rx;
      const gy = rowStart + ry;
      const neighbors = [
        [gx - 1, gy - 1], [gx, gy - 1],
        [gx - 1, gy], [gx, gy]
      ];
      let allRevealedFloor = true;
      let allDim = true;
      for (const [nx, ny] of neighbors) {
        if (!isFloor(nx, ny) || !isRevealed(nx, ny)) { allRevealedFloor = false; break; }
        if (!isDim(nx, ny)) allDim = false;
      }
      if (!allRevealedFloor) continue;
      const px = rx * size;
      const py = ry * size;
      if (allDim) ctx.globalAlpha = TICK_DIM_ALPHA;
      ctx.fillRect(px - arm, py, span, 1);
      ctx.fillRect(px, py - arm, 1, span);
      if (allDim) ctx.globalAlpha = 1;
    }
  }
}

function drawWallLines(ctx, { isTraversable, isRevealed, colStart, rowStart, cols, rows, size, glow = WALL_STATIC_GLOW }) {
  const t = wallThickness(size);
  const blur = lerp(WALL_GLOW_BLUR, glow);
  const alpha = lerp(WALL_GLOW_ALPHA, glow);
  ctx.fillStyle = WALL_LINE_COLOR;
  ctx.shadowColor = WALL_LINE_COLOR;
  ctx.shadowBlur = blur;
  ctx.globalAlpha = alpha;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const gx = colStart + rx;
      const gy = rowStart + ry;
      if (!isTraversable(gx, gy)) continue;
      if (!isRevealed(gx, gy)) continue;
      const px = rx * size;
      const py = ry * size;
      const wallN = !isTraversable(gx, gy - 1);
      const wallS = !isTraversable(gx, gy + 1);
      const wallW = !isTraversable(gx - 1, gy);
      const wallE = !isTraversable(gx + 1, gy);
      if (wallN) ctx.fillRect(px, py - t, size, t);
      if (wallS) ctx.fillRect(px, py + size, size, t);
      if (wallW) ctx.fillRect(px - t, py, t, size);
      if (wallE) ctx.fillRect(px + size, py, t, size);
      if (wallN && wallW) ctx.fillRect(px - t, py - t, t, t);
      if (wallN && wallE) ctx.fillRect(px + size, py - t, t, t);
      if (wallS && wallW) ctx.fillRect(px - t, py + size, t, t);
      if (wallS && wallE) ctx.fillRect(px + size, py + size, t, t);
    }
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.globalAlpha = 1;
}

function drawToken(ctx, { x, y, radius, color, codepoint, size, renderSize, role }) {
  ctx.fillStyle = role === 'player' ? color : 'rgba(232,58,58,0.18)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  if (typeof ctx.beginPath === 'function' && typeof ctx.arc === 'function') {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.shadowBlur = 0;
  return drawCreatureSigil(ctx, { codepoint, size, renderSize, role, x, y, color });
}

function setCanvasDescription(canvas, text) {
  canvas.setAttribute?.('role', 'img');
  canvas.setAttribute?.('aria-label', text);
  canvas.style.pointerEvents = 'none';
}

function resetTransform(ctx) {
  if (typeof ctx.setTransform === 'function') ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function applyViewTransform(ctx, viewTransform) {
  if (typeof ctx.setTransform !== 'function' || !viewTransform) return;
  ctx.setTransform(viewTransform.scale, 0, 0, viewTransform.scale, viewTransform.dx, viewTransform.dy);
}

// Client-coord → grid-cell hit test for a canvas. Accounts for CSS scaling (canvases render at
// their intrinsic width but display at `width: 100%`) and inverts the caller's `viewTransform`
// to land on the correct world cell. Returns null when the point is outside the canvas rect,
// when the canvas has no measurable bounding rect, or when no viewTransform is supplied.
export function cellAtPoint({ canvas, cellSize, viewTransform }, clientX, clientY) {
  if (!canvas || typeof canvas.getBoundingClientRect !== 'function' || !cellSize) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return null;
  if (clientX < rect.left || clientY < rect.top || clientX > rect.right || clientY > rect.bottom) return null;
  const scaleX = (canvas.width || rect.width) / rect.width;
  const scaleY = (canvas.height || rect.height) / rect.height;
  const canvasX = (clientX - rect.left) * scaleX;
  const canvasY = (clientY - rect.top) * scaleY;
  if (!viewTransform || !viewTransform.scale) return null;
  const worldX = (canvasX - viewTransform.dx) / viewTransform.scale;
  const worldY = (canvasY - viewTransform.dy) / viewTransform.scale;
  return { x: Math.floor(worldX / cellSize), y: Math.floor(worldY / cellSize) };
}

export function createPlayfield(canvas) {
  const ctx = canvas.getContext('2d');
  let accentColor = '#7ec8e3';
  let pulseEnabled = false;
  let lastRender = null;
  let rafHandle = null;
  let pulseOriginMs = null;
  let lastFrameMs = 0;

  function glowLevel() {
    if (!pulseEnabled || pulseOriginMs == null) return WALL_STATIC_GLOW;
    const elapsed = lastFrameMs - pulseOriginMs;
    return 0.5 + 0.5 * Math.sin((2 * Math.PI * elapsed) / WALL_PULSE_PERIOD_MS);
  }

  function scheduleTick() {
    if (!pulseEnabled || !lastRender) return;
    if (rafHandle != null) return;
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== 'function') return;
    rafHandle = raf(onFrame);
  }

  function onFrame(now) {
    rafHandle = null;
    if (!pulseEnabled || !lastRender) return;
    const t = typeof now === 'number' ? now : 0;
    if (lastFrameMs === 0 || t - lastFrameMs >= 1000 / WALL_PULSE_FPS) {
      if (pulseOriginMs == null) pulseOriginMs = t;
      lastFrameMs = t;
      replayRender();
    }
    scheduleTick();
  }

  function replayRender() {
    if (!lastRender) return;
    if (lastRender.kind === 'exploration') renderExplorationImpl(...lastRender.args);
    else if (lastRender.kind === 'combat') renderCombatImpl(...lastRender.args);
  }

  function cancelPulseFrame() {
    const cancel = globalThis.cancelAnimationFrame;
    if (rafHandle != null && typeof cancel === 'function') cancel(rafHandle);
    rafHandle = null;
    pulseOriginMs = null;
    lastFrameMs = 0;
  }

  function renderExplorationImpl(lattice, fogState, partyPos, options = {}) {
    const grid = lattice.getGrid();
    const w = lattice.getWidth();
    const h = lattice.getHeight();
    resetTransform(ctx);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyViewTransform(ctx, options.viewTransform);
    setCanvasDescription(canvas, `Exploration map, ${w} by ${h}. Party at ${partyPos?.x ?? '?'},${partyPos?.y ?? '?'}.`);

    const inBounds = (gx, gy) => gx >= 0 && gx < w && gy >= 0 && gy < h;
    const isFloor = (gx, gy) => inBounds(gx, gy) && grid[gy][gx] !== CELL.WALL;
    const isRevealed = (gx, gy) => inBounds(gx, gy) && fogState[gy * w + gx] !== 0;
    const isDim = (gx, gy) => inBounds(gx, gy) && fogState[gy * w + gx] === 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fog = fogState[y * w + x];
        const px = x * EXPLORATION_CELL_SIZE;
        const py = y * EXPLORATION_CELL_SIZE;
        const cellType = grid[y][x];
        drawCell(ctx, px, py, EXPLORATION_CELL_SIZE, cellType, fog !== 0, fog === 1);
        if (fog !== 0 && cellType === CELL.DESCENT) {
          ctx.fillStyle = 'rgba(58,232,168,0.12)';
          ctx.fillRect(px + 1, py + 1, EXPLORATION_CELL_SIZE - 2, EXPLORATION_CELL_SIZE - 2);
        }
      }
    }

    drawGridTicks(ctx, {
      isFloor, isRevealed, isDim,
      colStart: 0, rowStart: 0, cols: w, rows: h, size: EXPLORATION_CELL_SIZE
    });

    drawWallLines(ctx, {
      isTraversable: isFloor,
      isRevealed,
      colStart: 0, rowStart: 0, cols: w, rows: h, size: EXPLORATION_CELL_SIZE,
      glow: glowLevel()
    });

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (fogState[y * w + x] === 0) continue;
        if (grid[y][x] !== CELL.DESCENT) continue;
        const px = x * EXPLORATION_CELL_SIZE;
        const py = y * EXPLORATION_CELL_SIZE;
        ctx.fillStyle = DESCENT_COLOR;
        ctx.font = '10px ui-monospace, SF Mono, Roboto Mono, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('◈', px + EXPLORATION_CELL_SIZE / 2, py + EXPLORATION_CELL_SIZE / 2);
      }
    }

    // SESSION-04: use the active accessors so opened / culled containers and
    // defeated / culled enemies are filtered out, and hunter-overridden enemy
    // positions render at the moved cell (not the spawn cell).
    for (const c of lattice.getActiveContainers?.() || []) {
      if (fogState[c.y * w + c.x] !== 2) continue;
      ctx.fillStyle = 'rgba(232,210,58,0.1)';
      ctx.fillRect(c.x * EXPLORATION_CELL_SIZE + 2, c.y * EXPLORATION_CELL_SIZE + 2, EXPLORATION_CELL_SIZE - 4, EXPLORATION_CELL_SIZE - 4);
      ctx.fillStyle = CONTAINER_COLOR;
      ctx.font = '10px ui-monospace, SF Mono, Roboto Mono, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.kind === 'vault' ? '◈' : '▣', c.x * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2, c.y * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2);
    }
    for (const e of lattice.getActiveEnemySpawns?.() || []) {
      if (fogState[e.y * w + e.x] !== 2) continue;
      drawToken(ctx, {
        codepoint: e.sigilCodepoint || codepointFromSigilId(e.sigilId) || 0xE030,
        size: 72,
        renderSize: 14,
        role: 'enemy',
        x: e.x * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2,
        y: e.y * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2,
        radius: EXPLORATION_CELL_SIZE * 0.35,
        color: DANGER_COLOR
      });
    }
    const stagedPath = Array.isArray(options.stagedPath) ? options.stagedPath : null;
    if (stagedPath && stagedPath.length > 0) {
      ctx.globalAlpha = PATH_PREVIEW_ALPHA;
      ctx.fillStyle = PATH_COLOR;
      for (const step of stagedPath) {
        if (!Number.isFinite(step?.x) || !Number.isFinite(step?.y)) continue;
        const cx = step.x * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2;
        const cy = step.y * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2;
        ctx.fillRect(cx - 2, cy - 2, 5, 5);
      }
      ctx.globalAlpha = 1;
      const last = stagedPath[stagedPath.length - 1];
      if (Number.isFinite(last?.x) && Number.isFinite(last?.y)) {
        ctx.strokeStyle = PATH_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(
          last.x * EXPLORATION_CELL_SIZE + 1,
          last.y * EXPLORATION_CELL_SIZE + 1,
          EXPLORATION_CELL_SIZE - 2,
          EXPLORATION_CELL_SIZE - 2
        );
      }
    }
    if (partyPos) {
      drawToken(ctx, {
        codepoint: 0xE000,
        size: 108,
        renderSize: 18,
        role: 'player',
        x: partyPos.x * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2,
        y: partyPos.y * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2,
        radius: EXPLORATION_CELL_SIZE * 0.39,
        color: accentColor
      });
    }
    resetTransform(ctx);
  }

  function renderCombatImpl(combatState, lattice, options = {}) {
    resetTransform(ctx);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const grid = lattice?.getGrid?.() || [];
    const width = lattice?.getWidth?.() || grid[0]?.length || COMBAT_GRID_W;
    const height = lattice?.getHeight?.() || grid.length || COMBAT_GRID_H;
    const combatants = getCombatants(combatState);
    // Log-replay playback (M71): callers may override which actor draws the ACTIVE frame
    // (turnOrder has already advanced past the enemy the log entry belongs to).
    const activeId = options.activeOverrideId != null
      ? options.activeOverrideId
      : combatState?.turnOrder?.[combatState?.currentTurn];
    applyViewTransform(ctx, options.viewTransform);
    setCanvasDescription(canvas, `Combat map, window ${width}x${height}, round ${combatState?.round || 1}.`);

    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const px = gx * COMBAT_CELL_SIZE;
        const py = gy * COMBAT_CELL_SIZE;
        drawCell(ctx, px, py, COMBAT_CELL_SIZE, grid[gy]?.[gx], true, false);
      }
    }

    const combatIsFloor = (gx, gy) => gx >= 0 && gx < width && gy >= 0 && gy < height && grid[gy]?.[gx] !== CELL.WALL;
    drawGridTicks(ctx, {
      isFloor: combatIsFloor,
      isRevealed: () => true,
      isDim: () => false,
      colStart: 0, rowStart: 0, cols: width, rows: height, size: COMBAT_CELL_SIZE
    });

    drawWallLines(ctx, {
      isTraversable: combatIsFloor,
      isRevealed: () => true,
      colStart: 0, rowStart: 0, cols: width, rows: height, size: COMBAT_CELL_SIZE,
      glow: glowLevel()
    });

    for (let gy = 0; gy < height; gy++) {
      for (let gx = 0; gx < width; gx++) {
        const px = gx * COMBAT_CELL_SIZE;
        const py = gy * COMBAT_CELL_SIZE;
        drawOverlay(ctx, px, py, options, gx, gy, accentColor);
      }
    }

    for (const actor of combatants) {
      if (!actor.position) continue;
      // Log-replay playback (M71): positionOverrides shifts an actor's drawn cell without
      // mutating combatState — the engine has already advanced positions to their final values.
      const override = options.positionOverrides?.get?.(actor.id);
      const pos = override || actor.position;
      const px = pos.x * COMBAT_CELL_SIZE;
      const py = pos.y * COMBAT_CELL_SIZE;
      const role = actorRole(actor);
      const isDead = actor.hp <= 0;
      const roleColor = role === 'player' ? accentColor : role === 'echo' ? ECHO_COLOR : DANGER_COLOR;
      const tokenColor = isDead ? 'rgba(40,40,40,0.6)' : roleColor;
      if (!isDead && actor.id === activeId) drawFrame(ctx, px, py, accentColor, 'ACTIVE');
      if (!isDead && actor.id === options.selectedTargetId) drawFrame(ctx, px, py, DANGER_COLOR, 'TARGET', 4);
      drawCreatureSigil(ctx, {
        codepoint: actorSigil(actor),
        size: 72,
        renderSize: 32,
        role,
        x: px + COMBAT_CELL_SIZE / 2,
        y: py + COMBAT_CELL_SIZE / 2,
        color: tokenColor
      });
    }
    resetTransform(ctx);
  }

  return {
    setAccent(themeOrColor) {
      const nextAccent = themeAccent(themeOrColor);
      if (!nextAccent) return false;
      accentColor = nextAccent;
      document.documentElement?.style?.setProperty?.('--accent', nextAccent);
      return true;
    },
    renderExploration(lattice, fogState, partyPos, options = {}) {
      lastRender = { kind: 'exploration', args: [lattice, fogState, partyPos, options] };
      renderExplorationImpl(lattice, fogState, partyPos, options);
      scheduleTick();
    },
    renderCombat(combatState, lattice, options = {}) {
      lastRender = { kind: 'combat', args: [combatState, lattice, options] };
      renderCombatImpl(combatState, lattice, options);
      scheduleTick();
    },
    setPulse(enabled) {
      const next = Boolean(enabled);
      if (pulseEnabled === next) return;
      pulseEnabled = next;
      if (!pulseEnabled) {
        cancelPulseFrame();
        return;
      }
      if (lastRender) scheduleTick();
    },
    destroy() {
      pulseEnabled = false;
      cancelPulseFrame();
      lastRender = null;
    }
  };
}

function drawOverlay(ctx, px, py, options, gx, gy, accentColor) {
  const key = `${gx},${gy}`;
  if (options.rangeCells?.has?.(key)) {
    ctx.fillStyle = 'rgba(126,200,227,0.25)';
    ctx.fillRect(px + 1, py + 1, COMBAT_CELL_SIZE - 2, COMBAT_CELL_SIZE - 2);
    drawMark(ctx, px, py, accentColor, 'R');
  }
  if (options.coverCells?.has?.(key)) {
    ctx.fillStyle = 'rgba(232,198,58,0.22)';
    ctx.fillRect(px + COMBAT_CELL_SIZE - 12, py + COMBAT_CELL_SIZE - 12, 10, 10);
    drawMark(ctx, px, py, COVER_COLOR, 'C');
  }
  if (options.pathCells?.has?.(key)) drawMark(ctx, px, py, PATH_COLOR, 'P');
  if (options.validTargets?.has?.(key)) drawFrame(ctx, px, py, DANGER_COLOR, 'VALID', 7);
  if (options.confirmCell === key) drawFrame(ctx, px, py, PATH_COLOR, 'GO', 4);
  // Log-replay playback (M71): danger-colored impact frame on cells taking a hit/effect.
  if (options.flashCells?.has?.(key)) drawFrame(ctx, px, py, DANGER_COLOR, 'FLASH', 3);
}

function drawFrame(ctx, px, py, color, label, inset = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + inset, py + inset, COMBAT_CELL_SIZE - inset * 2, COMBAT_CELL_SIZE - inset * 2);
  ctx.lineWidth = 1;
  drawMark(ctx, px, py, color, label);
}

function drawMark(ctx, px, py, color, label) {
  ctx.fillStyle = color;
  ctx.font = '7px ui-monospace, SF Mono, Roboto Mono, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, px + 8, py + 10);
}
