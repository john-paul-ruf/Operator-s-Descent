import { validateSigilToken } from './components.js';
const CELL_SIZE = 24;
const COMBAT_CELL_SIZE = 48;
const COMBAT_GRID_W = 8;
const COMBAT_GRID_H = 16;

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

export function createPlayfield(canvas) {
  const ctx = canvas.getContext('2d');
  let accentColor = '#7ec8e3';

  return {
    setAccent(color) { accentColor = color; },

    renderExploration(lattice, fogState, partyPos) {
      const grid = lattice.getGrid();
      const w = lattice.getWidth();
      const h = lattice.getHeight();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const fogIdx = y * w + x;
          const fog = fogState[fogIdx];
          if (fog === 0) continue;
          const cellType = grid[y][x];
          const px = x * CELL_SIZE;
          const py = y * CELL_SIZE;

          ctx.fillStyle = cellType === 0 ? '#1a0e36' : '#0a0612';
          ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);

          if (cellType === 2) {
            ctx.fillStyle = accentColor;
            ctx.fillRect(px + 8, py + 8, 8, 8);
          } else if (cellType === 3) {
            ctx.fillStyle = '#e8c63a';
            ctx.fillRect(px + 6, py + 10, 12, 4);
          }

          if (fog === 1) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(px, py, CELL_SIZE, CELL_SIZE);
          }
        }
      }

      const containers = lattice.getContainers();
      for (const c of containers) {
        const fogIdx = c.y * w + c.x;
        if (fogState[fogIdx] === 2) {
          ctx.fillStyle = accentColor;
          ctx.fillRect(c.x * CELL_SIZE + 8, c.y * CELL_SIZE + 8, 8, 8);
        }
      }

      const enemies = lattice.getEnemySpawns();
      for (const e of enemies) {
        const fogIdx = e.y * w + e.x;
        if (fogState[fogIdx] === 2) {
          ctx.fillStyle = '#e83a3a';
          ctx.fillRect(e.x * CELL_SIZE + 6, e.y * CELL_SIZE + 6, 12, 12);
        }
      }

      if (partyPos) {
        drawCreatureSigil(ctx, {
          codepoint: 0xE000,
          size: 108,
          role: 'player',
          x: partyPos.x * CELL_SIZE + CELL_SIZE / 2,
          y: partyPos.y * CELL_SIZE + CELL_SIZE / 2,
          color: accentColor
        });
      }
    },

    renderCombat(combatState, lattice, zoomOrigin) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const grid = lattice?.getGrid?.() || [];
      const w = lattice?.getWidth?.() || grid[0]?.length || COMBAT_GRID_W;
      const h = lattice?.getHeight?.() || grid.length || COMBAT_GRID_H;

      const cx = zoomOrigin?.x ?? Math.floor(w / 2);
      const cy = zoomOrigin?.y ?? Math.floor(h / 2);
      const ox = cx - Math.floor(COMBAT_GRID_W / 2);
      const oy = cy - Math.floor(COMBAT_GRID_H / 2);
      const combatants = combatState?.combatants instanceof Map
        ? [...combatState.combatants.values()]
        : Array.isArray(combatState?.combatants) ? combatState.combatants : [];
      const activeId = combatState?.turnOrder?.[combatState?.currentTurn];

      for (let dy = 0; dy < COMBAT_GRID_H; dy++) {
        for (let dx = 0; dx < COMBAT_GRID_W; dx++) {
          const gx = ox + dx;
          const gy = oy + dy;
          const px = dx * COMBAT_CELL_SIZE;
          const py = dy * COMBAT_CELL_SIZE;

          ctx.fillStyle = (gx < 0 || gx >= w || gy < 0 || gy >= h || grid[gy]?.[gx] === 0)
            ? '#1a0e36' : '#0a0612';
          ctx.fillRect(px, py, COMBAT_CELL_SIZE, COMBAT_CELL_SIZE);

          ctx.strokeStyle = 'rgba(126,200,227,0.1)';
          ctx.strokeRect(px, py, COMBAT_CELL_SIZE, COMBAT_CELL_SIZE);
        }
      }

      for (const c of combatants) {
        if (!c.position) continue;
        const dx = c.position.x - ox;
        const dy = c.position.y - oy;
        if (dx < 0 || dx >= COMBAT_GRID_W || dy < 0 || dy >= COMBAT_GRID_H) continue;

        const px = dx * COMBAT_CELL_SIZE;
        const py = dy * COMBAT_CELL_SIZE;
        const isActive = c.id === activeId;

        if (isActive) {
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 2, py + 2, COMBAT_CELL_SIZE - 4, COMBAT_CELL_SIZE - 4);
          ctx.lineWidth = 1;
        }

        const role = c.side === 'enemy' ? 'enemy' : c.side === 'echo' ? 'echo' : 'player';
        const codepoint = c.sigilCodepoint || (role === 'enemy' ? 0xE030 : 0xE000);
        drawCreatureSigil(ctx, {
          codepoint,
          size: 72,
          role,
          x: px + COMBAT_CELL_SIZE / 2,
          y: py + COMBAT_CELL_SIZE / 2,
          color: role === 'player' ? accentColor : '#e83a3a'
        });
      }
    }
  };
}
