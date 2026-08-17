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
const DANGER_COLOR = '#e83a3a';
const DESCENT_COLOR = '#3ae8a8';
const CONTAINER_COLOR = '#e8d23a';
const COVER_COLOR = '#e8c63a';
const PATH_COLOR = '#d8d8d8';
const PATH_PREVIEW_ALPHA = 0.55;
const ECHO_COLOR = '#b026d4';

function bounded(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
      let anyRevealedFloor = false;
      let allDim = true;
      const neighbors = [
        [gx - 1, gy - 1], [gx, gy - 1],
        [gx - 1, gy], [gx, gy]
      ];
      for (const [nx, ny] of neighbors) {
        if (!isFloor(nx, ny)) continue;
        if (!isRevealed(nx, ny)) continue;
        anyRevealedFloor = true;
        if (!isDim(nx, ny)) allDim = false;
      }
      if (!anyRevealedFloor) continue;
      const px = rx * size;
      const py = ry * size;
      if (allDim) ctx.globalAlpha = TICK_DIM_ALPHA;
      ctx.fillRect(px - arm, py, span, 1);
      ctx.fillRect(px, py - arm, 1, span);
      if (allDim) ctx.globalAlpha = 1;
    }
  }
}

function drawWallLines(ctx, { isTraversable, isRevealed, colStart, rowStart, cols, rows, size }) {
  ctx.fillStyle = WALL_LINE_COLOR;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const gx = colStart + rx;
      const gy = rowStart + ry;
      if (!isTraversable(gx, gy)) continue;
      if (!isRevealed(gx, gy)) continue;
      const px = rx * size;
      const py = ry * size;
      if (!isTraversable(gx, gy - 1)) ctx.fillRect(px + 1, py + 1, size - 2, 2);
      if (!isTraversable(gx, gy + 1)) ctx.fillRect(px + 1, py + size - 3, size - 2, 2);
      if (!isTraversable(gx - 1, gy)) ctx.fillRect(px + 1, py + 1, 2, size - 2);
      if (!isTraversable(gx + 1, gy)) ctx.fillRect(px + size - 3, py + 1, 2, size - 2);
    }
  }
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

// Client-coord → grid-cell hit test for a canvas. Accounts for CSS scaling (canvases render at
// their intrinsic width but display at `width: 100%`) and adds the camera offset so callers get a
// world-space cell, not a viewport-space one. Returns null when the point is outside the canvas
// rect or when the canvas has no measurable bounding rect.
export function cellAtPoint({ canvas, camera, cellSize }, clientX, clientY) {
  if (!canvas || typeof canvas.getBoundingClientRect !== 'function' || !cellSize) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return null;
  if (clientX < rect.left || clientY < rect.top || clientX > rect.right || clientY > rect.bottom) return null;
  const scaleX = (canvas.width || rect.width) / rect.width;
  const scaleY = (canvas.height || rect.height) / rect.height;
  const canvasX = (clientX - rect.left) * scaleX;
  const canvasY = (clientY - rect.top) * scaleY;
  const cellX = (camera?.x ?? 0) + Math.floor(canvasX / cellSize);
  const cellY = (camera?.y ?? 0) + Math.floor(canvasY / cellSize);
  return { x: cellX, y: cellY };
}

export function calculateCombatCamera({ width, height, active, selected, consoleExpanded = false }) {
  const targets = [active, selected].filter(Boolean);
  const center = targets.length === 2
    ? { x: Math.floor((targets[0].x + targets[1].x) / 2), y: Math.floor((targets[0].y + targets[1].y) / 2) }
    : targets[0] || { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  const visibleRows = consoleExpanded ? 12 : COMBAT_GRID_H;
  const maxX = Math.max(0, width - COMBAT_GRID_W);
  const maxY = Math.max(0, height - visibleRows);
  return {
    x: bounded(center.x - Math.floor(COMBAT_GRID_W / 2), 0, maxX),
    y: bounded(center.y - Math.floor(visibleRows / 2), 0, maxY),
    w: COMBAT_GRID_W,
    h: visibleRows
  };
}

export function createPlayfield(canvas) {
  const ctx = canvas.getContext('2d');
  let accentColor = '#7ec8e3';
  let camera = { x: 0, y: 0, w: COMBAT_GRID_W, h: COMBAT_GRID_H };

  return {
    getCamera() { return { ...camera }; },
    setAccent(themeOrColor) {
      const nextAccent = themeAccent(themeOrColor);
      if (!nextAccent) return false;
      accentColor = nextAccent;
      document.documentElement?.style?.setProperty?.('--accent', nextAccent);
      return true;
    },
    autoPan(bounds) {
      camera = calculateCombatCamera(bounds);
      return { ...camera };
    },
    renderExploration(lattice, fogState, partyPos, options = {}) {
      const grid = lattice.getGrid();
      const w = lattice.getWidth();
      const h = lattice.getHeight();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
        colStart: 0, rowStart: 0, cols: w, rows: h, size: EXPLORATION_CELL_SIZE
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

      for (const c of lattice.getContainers?.() || []) {
        if (fogState[c.y * w + c.x] !== 2) continue;
        ctx.fillStyle = 'rgba(232,210,58,0.1)';
        ctx.fillRect(c.x * EXPLORATION_CELL_SIZE + 2, c.y * EXPLORATION_CELL_SIZE + 2, EXPLORATION_CELL_SIZE - 4, EXPLORATION_CELL_SIZE - 4);
        ctx.fillStyle = CONTAINER_COLOR;
        ctx.font = '10px ui-monospace, SF Mono, Roboto Mono, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.kind === 'vault' ? '◈' : '▣', c.x * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2, c.y * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2);
      }
      for (const e of lattice.getEnemySpawns?.() || []) {
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
    },
    renderCombat(combatState, lattice, options = {}) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const grid = lattice?.getGrid?.() || [];
      const width = lattice?.getWidth?.() || grid[0]?.length || COMBAT_GRID_W;
      const height = lattice?.getHeight?.() || grid.length || COMBAT_GRID_H;
      const combatants = getCombatants(combatState);
      const activeId = combatState?.turnOrder?.[combatState?.currentTurn];
      const active = combatants.find((actor) => actor.id === activeId)?.position;
      const selected = combatants.find((actor) => actor.id === options.selectedTargetId)?.position;
      const requestedOrigin = options.zoomOrigin || (Number.isInteger(options.x) && Number.isInteger(options.y) ? options : null);
      camera = options.camera || calculateCombatCamera({ width, height, active: requestedOrigin || active, selected, consoleExpanded: options.consoleExpanded });
      setCanvasDescription(canvas, `Combat map, window ${camera.x},${camera.y} through ${camera.x + camera.w - 1},${camera.y + camera.h - 1}. Round ${combatState?.round || 1}.`);

      for (let dy = 0; dy < camera.h; dy++) {
        for (let dx = 0; dx < camera.w; dx++) {
          const gx = camera.x + dx;
          const gy = camera.y + dy;
          const px = dx * COMBAT_CELL_SIZE;
          const py = dy * COMBAT_CELL_SIZE;
          const outOfBounds = gx < 0 || gx >= width || gy < 0 || gy >= height;
          drawCell(ctx, px, py, COMBAT_CELL_SIZE, outOfBounds ? CELL.WALL : grid[gy]?.[gx], true, false);
        }
      }

      const combatIsFloor = (gx, gy) => gx >= 0 && gx < width && gy >= 0 && gy < height && grid[gy]?.[gx] !== CELL.WALL;
      drawGridTicks(ctx, {
        isFloor: combatIsFloor,
        isRevealed: () => true,
        isDim: () => false,
        colStart: camera.x, rowStart: camera.y, cols: camera.w, rows: camera.h, size: COMBAT_CELL_SIZE
      });

      drawWallLines(ctx, {
        isTraversable: combatIsFloor,
        isRevealed: () => true,
        colStart: camera.x, rowStart: camera.y, cols: camera.w, rows: camera.h, size: COMBAT_CELL_SIZE
      });

      for (let dy = 0; dy < camera.h; dy++) {
        for (let dx = 0; dx < camera.w; dx++) {
          const gx = camera.x + dx;
          const gy = camera.y + dy;
          const px = dx * COMBAT_CELL_SIZE;
          const py = dy * COMBAT_CELL_SIZE;
          drawOverlay(ctx, px, py, options, gx, gy, accentColor);
        }
      }

      for (const actor of combatants) {
        if (!actor.position) continue;
        const dx = actor.position.x - camera.x;
        const dy = actor.position.y - camera.y;
        if (dx < 0 || dx >= camera.w || dy < 0 || dy >= camera.h) continue;
        const px = dx * COMBAT_CELL_SIZE;
        const py = dy * COMBAT_CELL_SIZE;
        const role = actorRole(actor);
        const isDead = actor.hp <= 0;
        const roleColor = role === 'player' ? accentColor : role === 'echo' ? ECHO_COLOR : DANGER_COLOR;
        const tokenColor = isDead ? 'rgba(40,40,40,0.6)' : roleColor;
        if (!isDead && actor.id === activeId) drawFrame(ctx, px, py, accentColor, 'ACTIVE');
        if (!isDead && actor.id === options.selectedTargetId) drawFrame(ctx, px + 4, py + 4, DANGER_COLOR, 'TARGET');
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
