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
// canvas by inverting the fit-centered camera transform. Assumes the camera is at fit
// with letterboxing and no user pan — which holds at mount and after any successful
// move (auto-follow resets suppressFollow, but for cells in-view the tap point
// remains inside the visible rect).
async function tapCoordForCell(page, cellX, cellY) {
  return page.evaluate(({ cellX, cellY }) => {
    const canvas = document.querySelector('[data-testid="exploration-canvas"]');
    const rect = canvas.getBoundingClientRect();
    const WORLD_W = 480;
    const WORLD_H = 768;
    const CELL = 24;
    const scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    const spanX = rect.width / scale;
    const spanY = rect.height / scale;
    let camX = 0;
    let camY = 0;
    if (WORLD_W * scale <= rect.width) camX = (WORLD_W - spanX) / 2;
    if (WORLD_H * scale <= rect.height) camY = (WORLD_H - spanY) / 2;
    const worldX = cellX * CELL + CELL / 2;
    const worldY = cellY * CELL + CELL / 2;
    return {
      x: rect.left + (worldX - camX) * scale,
      y: rect.top + (worldY - camY) * scale
    };
  }, { cellX, cellY });
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
  const step1 = await tapCoordForCell(page, startCell.x, startCell.y + 1);
  await page.touchscreen.tap(step1.x, step1.y);
  await expect.poll(async () => JSON.stringify(await readPartyCell(page)))
    .toBe(JSON.stringify({ x: startCell.x, y: startCell.y + 1 }));
  await expect(page.getByTestId('move-notice')).not.toContainText('NO PATH');

  const afterTapCell = await readPartyCell(page);
  const canvasBox = await page.getByTestId('exploration-canvas').boundingBox();
  expect(canvasBox).toBeTruthy();

  // 2) Drag across the canvas → gesture engine treats as pan; party must not move.
  //    Mouse events on hasTouch=true Chromium fire as pointer events with pointerType=touch.
  await page.mouse.move(canvasBox.x + 40, canvasBox.y + canvasBox.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width - 40, canvasBox.y + canvasBox.height * 0.7, { steps: 8 });
  await page.mouse.up();
  const afterDragCell = await readPartyCell(page);
  expect(afterDragCell).toEqual(afterTapCell);

  // 3) Wheel-zoom in anchored on the party (so party's screen position stays
  //    fixed), then tap the tile ONE cell north (the previous spawn cell —
  //    guaranteed walkable). Use page.mouse.wheel first per the plan; if the
  //    mobile emulator's wheel factor is small, fall back to a synthetic
  //    WheelEvent with a large deltaY that clamps to MAX_ZOOM_SCALE (4× fit).
  //    Either way, the post-wheel scale is bounded by [4× fit] so one cell
  //    displacement in screen space is at most 96px.
  const partyScreen = await tapCoordForCell(page, afterTapCell.x, afterTapCell.y);
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
