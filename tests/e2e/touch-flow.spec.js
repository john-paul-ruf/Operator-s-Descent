import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState, startStandardCombat } from '../helpers/game-fixture.js';

const REDUCED_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

test.skip(({ isMobile }) => !isMobile, 'touch acceptance runs in the mobile touch project');

async function installStableStorage(page) {
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, REDUCED_SETTINGS);
}

// Seed 5 puts the party at (10, 2) — inside the exploration camera's still-hardcoded
// LATTICE_WORLD_W/H of 20×32 cells (src/ui/screens/exploration.js:46-47), so canvas
// coordinates map correctly even though the underlying lattice was widened to 40×64
// (playtest-clarity-and-4x-floors S06). Nearest enemy is Chebyshev 13 away, so
// `nearestConnectedHostile` (HOSTILE_CONTACT_RANGE=2) never fires during south/north
// steps. Followup logged: the exploration camera should adopt the true 40×64 world
// bounds so any spawn cell tap-maps correctly.
async function createRunByTouch(page, seed = 5) {
  await page.goto(`/?seed=${seed}#w=${seed}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
  await page.getByTestId('add-character').tap();
  await page.getByTestId('class-breacher').tap();
  await page.getByTestId('tab-sigil').tap();
  await page.getByTestId('sigil-e000').tap();
  await page.getByTestId('finalize').tap();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

// partyOverrides.weapon only affects the fresh in-fixture combat state — toCombatSnapshot
// preserves per-instance state (hp/ap/position) but not weapon overrides, so on resume
// the party actor's weapon reverts to character.equipment (a sidearm — adjacent range 1).
// Move the enemy adjacent and force the party's initiative slot so combat-action-attack
// stays enabled through the loot-combat-ux "no targets in range" gate.
function activeCombatFragment() {
  const harness = createGameHarness({ seed: 31, partySize: 1 });
  startStandardCombat(harness, {
    enemyHP: 20,
    partyOverrides: [{ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }]
  });
  const activeCombat = harness.runState.activeCombat;
  if (activeCombat) {
    const party = activeCombat.actors.find((actor) => actor.side === 'party');
    const enemy = activeCombat.actors.find((actor) => actor.side !== 'party');
    if (party && enemy) {
      const dx = party.x >= 1 ? -1 : 1;
      enemy.x = Math.max(0, Math.min(7, party.x + dx));
      enemy.y = Math.max(0, Math.min(15, party.y));
    }
    const partyTurn = activeCombat.initiativeOrder?.findIndex((id) => String(id).startsWith('operator_'));
    if (partyTurn >= 0) activeCombat.currentIndex = partyTurn;
  }
  return roundTripRunState(harness.runState).encoded.fragment;
}

async function readPartyCell(page) {
  // Party coords are surfaced through the canvas aria-label
  // ("Exploration map, W by H. Party at X,Y.") so tests never crack open bus events.
  const label = await page.getByTestId('exploration-canvas').getAttribute('aria-label');
  const match = /Party at (-?\d+),(-?\d+)\./.exec(label ?? '');
  if (!match) throw new Error(`could not read party cell from aria-label: ${label}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

// Given a target world cell, compute a client-space tap coordinate on the exploration
// canvas by reproducing the live entry-camera transform: zoomToCells(24, 40) sets
// scale = clamp(40/24, fitScale, 4·fitScale); mount then centers on the party
// (subject to world-edge clamp). Callers pass the party cell so this stays robust
// even when the party spawns near a world edge (camera clamped, party not at canvas
// center). Keep target cells within ±1 of the party — beyond that, camera auto-follow
// after a step can shift the anchor before the next assertion polls.
async function tapCoordForCell(page, cellX, cellY, partyCell) {
  return page.evaluate(({ cellX, cellY, party }) => {
    const canvas = document.querySelector('[data-testid="exploration-canvas"]');
    const rect = canvas.getBoundingClientRect();
    // World is 40×64 cells at 24px each (playtest-clarity-and-4x-floors S06 widened
    // the lattice from 20×32 to 40×64). WORLD_H stays > WORLD_W so fitScale is still
    // rect.height / WORLD_H at portrait/phone viewports.
    const WORLD_W = 40 * 24;
    const WORLD_H = 64 * 24;
    const CELL = 24;
    const ENTRY_CELL_PX = 40;      // DEFAULT_ENTRY_CELL_PX from exploration.js
    const MAX_ZOOM = 4;            // MAX_ZOOM_SCALE from viewport.js
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const fit = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    const scale = clamp(ENTRY_CELL_PX / CELL, fit, MAX_ZOOM * fit);
    const spanX = rect.width / scale;
    const spanY = rect.height / scale;
    const partyPxX = party.x * CELL + CELL / 2;
    const partyPxY = party.y * CELL + CELL / 2;
    // centerOn(partyPx, partyPy) → state.x = partyPx − viewSpan/2, then clampAxis:
    // if world fits, center world; else clamp into [0, worldSize − viewSpan].
    const camX = WORLD_W * scale <= rect.width
      ? (WORLD_W - spanX) / 2
      : clamp(partyPxX - spanX / 2, 0, WORLD_W - spanX);
    const camY = WORLD_H * scale <= rect.height
      ? (WORLD_H - spanY) / 2
      : clamp(partyPxY - spanY / 2, 0, WORLD_H - spanY);
    const worldX = cellX * CELL + CELL / 2;
    const worldY = cellY * CELL + CELL / 2;
    return {
      x: rect.left + (worldX - camX) * scale,
      y: rect.top + (worldY - camY) * scale
    };
  }, { cellX, cellY, party: partyCell });
}

test('touch journey: tap-to-move advances party; drag pans without moving', async ({ page }) => {
  await installStableStorage(page);
  await createRunByTouch(page);

  // Portrait tab-tap cycle (SESSION-02): collapsed → half → full → collapsed.
  // The `expanded` class stays applied for BOTH open sizes so mock parity,
  // the M97 design-scan check-mock-classes rule, and keyboard-flow.spec.js's
  // `/expanded/` regex keep working; `data-expand-state` disambiguates which.
  await page.getByTestId('console-tab-move').tap();
  await expect(page.locator('.console-bar')).toHaveClass(/expanded/);
  await expect(page.locator('.console-bar')).toHaveAttribute('data-expand-state', 'half');

  // Touch-target floor per M97 (≥44px). Every visible `.console-row` /
  // `.mode-tab` must respect the 48px min-height set in components.css.
  const visibleRows = page.locator('.console-row:visible, .mode-tab:visible');
  const heights = await visibleRows.evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(48);

  // Tap 2: half → full.
  await page.getByTestId('console-tab-move').tap();
  await expect(page.locator('.console-bar')).toHaveAttribute('data-expand-state', 'full');
  await expect(page.locator('.console-bar')).toHaveClass(/expanded/);

  // Tap 3: full → collapsed (playfield the primary tap target again).
  await page.getByTestId('console-tab-move').tap();
  await expect(page.locator('.console-bar')).toHaveClass(/collapsed/);
  await expect(page.locator('.console-bar')).toHaveAttribute('data-expand-state', 'collapsed');

  const startCell = await readPartyCell(page);

  // 1) Tap a cell one step south of the party — inside LOS, single-step BFS path.
  const step1 = await tapCoordForCell(page, startCell.x, startCell.y + 1, startCell);
  await page.touchscreen.tap(step1.x, step1.y);
  await expect.poll(async () => JSON.stringify(await readPartyCell(page)))
    .toBe(JSON.stringify({ x: startCell.x, y: startCell.y + 1 }));
  await expect(page.getByTestId('move-notice')).not.toContainText('NO PATH');

  const afterTapCell = await readPartyCell(page);

  // 2) Wheel-zoom in anchored on the party (so party's screen position stays
  //    fixed), then tap the tile ONE cell north (the previous spawn cell —
  //    guaranteed walkable). Runs before the drag so the camera is still
  //    party-centered — otherwise a prior pan would move the party away from
  //    partyScreen and the wheel would anchor the wrong world cell. Use
  //    page.mouse.wheel first per the plan; if the mobile emulator's wheel
  //    factor is small, fall back to a synthetic WheelEvent with a large
  //    deltaY that clamps to MAX_ZOOM_SCALE (4× fit). Either way, the
  //    post-wheel scale is bounded by [4× fit] so one cell displacement in
  //    screen space is at most 96px.
  const partyScreen = await tapCoordForCell(page, afterTapCell.x, afterTapCell.y, afterTapCell);
  await page.mouse.move(partyScreen.x, partyScreen.y);
  await page.mouse.wheel(0, -400);
  await page.evaluate(({ x, y }) => {
    const body = document.querySelector('.exploration-playfield');
    body.dispatchEvent(new WheelEvent('wheel', {
      clientX: x, clientY: y, deltaY: -1200, bubbles: true, cancelable: true
    }));
  }, { x: partyScreen.x, y: partyScreen.y });
  // At max zoom (4× fit), one world cell = 24 * (4 * fitScale) screen px. For
  // a Pixel-7-portrait fit-scale of ~0.75, that's ~72px. Tap 72px north.
  await page.touchscreen.tap(partyScreen.x, partyScreen.y - 72);
  await expect.poll(async () => JSON.stringify(await readPartyCell(page)))
    .toBe(JSON.stringify(startCell));

  const afterZoomTapCell = await readPartyCell(page);
  const canvasBox = await page.getByTestId('exploration-canvas').boundingBox();
  expect(canvasBox).toBeTruthy();

  // 3) Drag across the canvas → gesture engine treats as pan; party must not move.
  //    Mouse events on hasTouch=true Chromium fire as pointer events with pointerType=touch.
  await page.mouse.move(canvasBox.x + 40, canvasBox.y + canvasBox.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width - 40, canvasBox.y + canvasBox.height * 0.7, { steps: 8 });
  await page.mouse.up();
  const afterDragCell = await readPartyCell(page);
  expect(afterDragCell).toEqual(afterZoomTapCell);
});

test('touch combat selects a target first and requires explicit confirm', async ({ page }) => {
  await installStableStorage(page);
  const fragment = activeCombatFragment();
  await page.goto(`/?run=${fragment.slice(0, 8)}#r=${fragment}`);
  await expect(page.getByTestId('import-run-summary')).toContainText('ACTIVE COMBAT SNAPSHOT');
  await page.getByTestId('import-resume').tap();
  await expect(page.getByTestId('combat-canvas')).toBeVisible();

  await page.getByTestId('console-tab-combat').tap();
  await page.getByTestId('combat-action-attack').tap();
  await expect(page.getByTestId('combat-targets')).toBeVisible();
  await expect(page.getByTestId('combat-confirm')).toHaveCount(0);

  await page.locator('[data-testid^="combat-target-"]').first().tap();
  await expect(page.getByTestId('combat-confirm')).toBeVisible();
  await expect(page.locator('.status-ap')).toHaveText('AP 2');
  await expect(page.locator('button[data-glitch], [role="button"][data-glitch], [data-decision-pending="true"][data-glitch]')).toHaveCount(0);

  await page.getByTestId('combat-confirm').tap();
  await expect(page.locator('.status-ap')).toContainText(/AP [01]/);
});
