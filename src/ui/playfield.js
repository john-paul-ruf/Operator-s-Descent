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
const COVER_COLOR = '#e8c63a';
const PATH_COLOR = '#ffffff';
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

function actorSigil(actor) {
  const role = actorRole(actor);
  return actor.sigilCodepoint || actor.sigilId || (role === 'enemy' ? 0xE030 : 0xE000);
}

function drawCreatureSigil(ctx, { codepoint, size, role, x, y, color }) {
  const validation = validateSigilToken(codepoint, size, role);
  if (!validation.valid) return false;
  ctx.font = `${size}px 'DESCENT SIGIL'`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String.fromCodePoint(codepoint), x, y);
  return true;
}

function drawCell(ctx, x, y, size, cellType) {
  ctx.fillStyle = cellType === 0 ? WALL_COLOR : FLOOR_COLOR;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = GRID_COLOR;
  ctx.strokeRect(x, y, size, size);
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
          if (fog === 0) continue;
          const px = x * EXPLORATION_CELL_SIZE;
          const py = y * EXPLORATION_CELL_SIZE;
          const cellType = grid[y][x];
          drawCell(ctx, px, py, EXPLORATION_CELL_SIZE, cellType);
          if (cellType === 3) {
            ctx.fillStyle = COVER_COLOR;
            ctx.fillText('DESCENT', px + EXPLORATION_CELL_SIZE / 2, py + EXPLORATION_CELL_SIZE / 2);
          }
          if (fog === 1) {
            ctx.fillStyle = VISITED_OVERLAY;
            ctx.fillRect(px, py, EXPLORATION_CELL_SIZE, EXPLORATION_CELL_SIZE);
          }
        }
      }

      for (const c of lattice.getContainers?.() || []) {
        if (fogState[c.y * w + c.x] !== 2) continue;
        ctx.fillStyle = accentColor;
        ctx.fillRect(c.x * EXPLORATION_CELL_SIZE + 8, c.y * EXPLORATION_CELL_SIZE + 8, 8, 8);
      }
      for (const e of lattice.getEnemySpawns?.() || []) {
        if (fogState[e.y * w + e.x] !== 2) continue;
        ctx.fillStyle = DANGER_COLOR;
        ctx.fillText('HOSTILE', e.x * EXPLORATION_CELL_SIZE + 12, e.y * EXPLORATION_CELL_SIZE + 12);
      }
      if (partyPos) {
        drawCreatureSigil(ctx, {
          codepoint: 0xE000,
          size: 108,
          role: 'player',
          x: partyPos.x * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2,
          y: partyPos.y * EXPLORATION_CELL_SIZE + EXPLORATION_CELL_SIZE / 2,
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
  if (options.validTargets?.has?.(key)) drawFrame(ctx, px + 8, py + 8, DANGER_COLOR, 'VALID');
  if (options.rangeCells?.has?.(key)) drawMark(ctx, px, py, accentColor, 'R');
  if (options.coverCells?.has?.(key)) drawMark(ctx, px, py, COVER_COLOR, 'C');
  if (options.pathCells?.has?.(key)) drawMark(ctx, px, py, PATH_COLOR, 'P');
}

function drawFrame(ctx, px, py, color, label) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 2, py + 2, COMBAT_CELL_SIZE - 4, COMBAT_CELL_SIZE - 4);
  ctx.lineWidth = 1;
  drawMark(ctx, px, py, color, label);
}

function drawMark(ctx, px, py, color, label) {
  ctx.fillStyle = color;
  ctx.fillText(label, px + 8, py + 10);
}
