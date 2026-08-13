import { CELL } from '../exploration/lattice.js';
import { validateSigilToken } from './components.js';

export const EXPLORATION_CELL_SIZE = 24;
export const COMBAT_CELL_SIZE = EXPLORATION_CELL_SIZE * 2;
export const COMBAT_GRID_W = 8;
export const COMBAT_GRID_H = 16;
const FLOOR_COLOR = '#0a0612';
const WALL_COLOR = '#1a0e36';
const VISITED_OVERLAY = 'rgba(0,0,0,0.55)';
const GRID_COLOR = 'rgba(126,200,227,0.1)';
const DANGER_COLOR = '#e83a3a';
const DESCENT_COLOR = '#3ae8a8';
const CONTAINER_COLOR = '#e8d23a';
const COVER_COLOR = '#e8c63a';
const PATH_COLOR = '#ffffff';
const ECHO_COLOR = '#b026d4';
const HIDDEN_COLOR = '#040108';

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

function drawCell(ctx, x, y, size, cellType, visible = true) {
  if (!visible) {
    ctx.fillStyle = HIDDEN_COLOR;
    ctx.fillRect(x, y, size, size);
    return;
  }
  ctx.fillStyle = cellType === 0 ? WALL_COLOR : FLOOR_COLOR;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = cellType === 0 ? 'rgba(74,32,144,0.28)' : 'rgba(126,200,227,0.06)';
  const textureX = x + 2 + ((x / size + y / size) % Math.max(2, size - 4));
  const textureY = y + 2 + ((x / size * 3 + y / size * 5) % Math.max(2, size - 4));
  ctx.fillRect(textureX, textureY, Math.max(1, size / 24), Math.max(1, size / 24));
  ctx.strokeStyle = GRID_COLOR;
  ctx.strokeRect(x, y, size, size);
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
    renderExploration(lattice, fogState, partyPos) {
      const grid = lattice.getGrid();
      const w = lattice.getWidth();
      const h = lattice.getHeight();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setCanvasDescription(canvas, `Exploration map, ${w} by ${h}. Party at ${partyPos?.x ?? '?'},${partyPos?.y ?? '?'}.`);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const fog = fogState[y * w + x];
          const px = x * EXPLORATION_CELL_SIZE;
          const py = y * EXPLORATION_CELL_SIZE;
          const cellType = grid[y][x];
          drawCell(ctx, px, py, EXPLORATION_CELL_SIZE, cellType, fog !== 0);
          if (fog === 0) continue;
          if (cellType === CELL.DESCENT) {
            ctx.fillStyle = 'rgba(58,232,168,0.12)';
            ctx.fillRect(px + 1, py + 1, EXPLORATION_CELL_SIZE - 2, EXPLORATION_CELL_SIZE - 2);
            ctx.fillStyle = DESCENT_COLOR;
            ctx.font = '10px ui-monospace, SF Mono, Roboto Mono, Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('◈', px + EXPLORATION_CELL_SIZE / 2, py + EXPLORATION_CELL_SIZE / 2);
          }
          if (fog === 1) {
            ctx.fillStyle = VISITED_OVERLAY;
            ctx.fillRect(px, py, EXPLORATION_CELL_SIZE, EXPLORATION_CELL_SIZE);
          }
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
          drawCell(ctx, px, py, COMBAT_CELL_SIZE, gx < 0 || gx >= width || gy < 0 || gy >= height ? 0 : grid[gy]?.[gx]);
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
        const tokenColor = isDead ? 'rgba(128,128,128,0.35)' : roleColor;
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
    ctx.fillStyle = 'rgba(126,200,227,0.08)';
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
