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

async function createRunByTouch(page, seed = 2) {
  await page.goto(`/?seed=${seed}#w=${seed}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
  await page.getByTestId('add-character').tap();
  await page.getByTestId('class-breacher').tap();
  await page.getByTestId('tab-sigil').tap();
  await page.getByTestId('sigil-e000').tap();
  await page.getByTestId('finalize').tap();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

function activeCombatFragment() {
  const harness = createGameHarness({ seed: 31, partySize: 1 });
  startStandardCombat(harness, {
    enemyHP: 20,
    partyOverrides: [{ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }]
  });
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
    const WORLD_W = 480;
    const WORLD_H = 768;
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

  await page.getByTestId('console-tab-move').tap();
  await expect(page.locator('.console-bar')).toHaveClass(/expanded/);

  const visibleRows = page.locator('.console-row:visible, .mode-tab:visible');
  const heights = await visibleRows.evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(96);

  // Collapse the console so the canvas is the main tap target.
  await page.getByTestId('console-tab-move').tap();
  await expect(page.locator('.console-bar')).toHaveClass(/collapsed/);

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
