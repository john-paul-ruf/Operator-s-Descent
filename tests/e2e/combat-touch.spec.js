import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState, startStandardCombat } from '../helpers/game-fixture.js';

const REDUCED_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

const COMBAT_CELL_SIZE = 48;

// Same encounter recipe used by tests/e2e/touch-flow.spec.js (read-only reference).
// Seed 31, partySize 1: party lands at (1,6), enemy drone at (2,15), window 8×16,
// MOVE_RANGE=5. Party has a short-range weapon so no accidental melee triggers on move.
function combatFixture() {
  const harness = createGameHarness({ seed: 31, partySize: 1 });
  const combat = startStandardCombat(harness, {
    enemyHP: 20,
    partyOverrides: [{ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }]
  });
  const party = [...combat.combatState.combatants.values()].find((actor) => actor.side === 'party');
  return {
    fragment: roundTripRunState(harness.runState).encoded.fragment,
    partyPos: party.position,
    windowW: combat.combatState.window.width,
    windowH: combat.combatState.window.height
  };
}

async function installStableStorage(page) {
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, REDUCED_SETTINGS);
}

async function importCombat(page, fragment) {
  await page.goto(`/?run=${fragment.slice(0, 8)}#r=${fragment}`);
  await expect(page.getByTestId('import-run-summary')).toContainText('ACTIVE COMBAT SNAPSHOT');
  await page.getByTestId('import-resume').click();
  await expect(page.getByTestId('combat-canvas')).toBeVisible();
}

// Combat canvas draws an 8×16-cell world (world = 8*48 × 16*48 CSS px) through the
// M104 camera. On mount the camera is at fit(); world center sits inside the canvas
// rect with letterboxing on the smaller axis. Invert that mapping to hit a world cell.
async function canvasTap(page, x, y, isMobile) {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function tapCoordForCell(page, cellX, cellY, { windowW, windowH }) {
  return page.evaluate(({ cellX, cellY, windowW, windowH, cellSize }) => {
    const canvas = document.querySelector('[data-testid="combat-canvas"]');
    const rect = canvas.getBoundingClientRect();
    const WORLD_W = windowW * cellSize;
    const WORLD_H = windowH * cellSize;
    const scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    const spanX = rect.width / scale;
    const spanY = rect.height / scale;
    let camX = 0;
    let camY = 0;
    if (WORLD_W * scale <= rect.width) camX = (WORLD_W - spanX) / 2;
    if (WORLD_H * scale <= rect.height) camY = (WORLD_H - spanY) / 2;
    const worldX = cellX * cellSize + cellSize / 2;
    const worldY = cellY * cellSize + cellSize / 2;
    return {
      x: rect.left + (worldX - camX) * scale,
      y: rect.top + (worldY - camY) * scale
    };
  }, { cellX, cellY, windowW, windowH, cellSize: COMBAT_CELL_SIZE });
}

test('combat: two-tap on canvas routes then confirms the move; drag pans with no side effects', async ({ page, isMobile }) => {
  await installStableStorage(page);
  const { fragment, partyPos, windowW, windowH } = combatFixture();
  await importCombat(page, fragment);

  await page.getByTestId('console-tab-combat').click();
  await page.getByTestId('combat-action-move').click();
  // Collapse the console (portrait bar overlays the canvas at bottom half of the viewport at
  // z-index:30; wide dock stays open). This lets canvas taps land on the world layer while
  // combat-notice remains attached in the DOM for text assertions.
  if (isMobile) await page.getByTestId('console-tab-combat').click();

  // Party at (1,6). Target (1,8) is 2 south — reachable within MOVE_RANGE=5.
  const dest = { x: partyPos.x, y: partyPos.y + 2 };
  const p1 = await tapCoordForCell(page, dest.x, dest.y, { windowW, windowH });

  await expect(page.locator('.combat-ap')).toContainText('MOVE READY');

  // Tap 1: routes BFS path; party has NOT moved; combat-notice shows the confirm hint.
  await canvasTap(page, p1.x, p1.y, isMobile);
  await expect(page.getByTestId('combat-notice')).toHaveText('TAP DESTINATION AGAIN TO CONFIRM.');
  await expect(page.locator('.combat-ap')).toContainText('MOVE READY');

  // Tap 2: same cell → confirm resolves the move; MOVE SPENT + move action disabled.
  await canvasTap(page, p1.x, p1.y, isMobile);
  await expect(page.locator('.combat-ap')).toContainText('MOVE SPENT');
  await expect(page.getByTestId('combat-action-move')).toBeDisabled();

  // Drag across the canvas — pans the camera only. No new confirm notice, MOVE stays spent.
  const canvasBox = await page.getByTestId('combat-canvas').boundingBox();
  const centerX = canvasBox.x + canvasBox.width / 2;
  const centerY = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 120, centerY, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('combat-notice')).toHaveCount(0);
  await expect(page.locator('.combat-ap')).toContainText('MOVE SPENT');
});

test('combat desktop: wheel-zoom keeps the two-tap flow landing on the intended cell', async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), 'wheel-zoom check runs in the desktop project');

  await installStableStorage(page);
  const { fragment, partyPos, windowW, windowH } = combatFixture();
  await importCombat(page, fragment);

  await page.getByTestId('console-tab-combat').click();
  await page.getByTestId('combat-action-move').click();

  const partyScreen = await tapCoordForCell(page, partyPos.x, partyPos.y, { windowW, windowH });
  // Chromium-portrait (desktop) is 1080×1920: the 720px console at bottom occupies y=1200..1920.
  // The party at (1,6) sits high in the world so partyScreen falls well above the console overlay.

  // Wheel-zoom anchored on the party. page.mouse.wheel first per the spec plan, then
  // fall back to a synthetic large-delta WheelEvent that clamps to MAX_ZOOM_SCALE (4×fit)
  // so the destination screen coord is deterministic under any wheel-normalisation quirk.
  await page.mouse.move(partyScreen.x, partyScreen.y);
  await page.mouse.wheel(0, -800);
  await page.evaluate(({ x, y }) => {
    const body = document.querySelector('.combat-playfield');
    body.dispatchEvent(new WheelEvent('wheel', {
      clientX: x, clientY: y, deltaY: -1200, bubbles: true, cancelable: true
    }));
  }, { x: partyScreen.x, y: partyScreen.y });

  // At the MAX_ZOOM_SCALE ceiling the camera anchors world (partyPos) to (partyScreen.x,
  // partyScreen.y). Any other cell's screen position is (partyScreen + Δworld · finalScale)
  // where finalScale = fitScale × 4. Pick a destination that stays on-screen at 4× fit and
  // above the bottom-docked console overlay (chromium-portrait: console occupies y ≥ 1200).
  // (2, 6) is 1 cell east of party (1, 6) — reachable, on-screen, above the console.
  const dest = { x: partyPos.x + 1, y: partyPos.y };
  const destScreen = await page.evaluate(({ cellX, cellY, pX, pY, aX, aY, windowW, windowH, cellSize }) => {
    const canvas = document.querySelector('[data-testid="combat-canvas"]');
    const rect = canvas.getBoundingClientRect();
    const fitScale = Math.min(rect.width / (windowW * cellSize), rect.height / (windowH * cellSize));
    const finalScale = fitScale * 4; // MAX_ZOOM_SCALE
    const dx = (cellX - pX) * cellSize;
    const dy = (cellY - pY) * cellSize;
    return { x: aX + dx * finalScale, y: aY + dy * finalScale };
  }, { cellX: dest.x, cellY: dest.y, pX: partyPos.x, pY: partyPos.y, aX: partyScreen.x, aY: partyScreen.y, windowW, windowH, cellSize: COMBAT_CELL_SIZE });

  await page.mouse.click(destScreen.x, destScreen.y);
  await expect(page.getByTestId('combat-notice')).toHaveText('TAP DESTINATION AGAIN TO CONFIRM.');
  await page.mouse.click(destScreen.x, destScreen.y);
  await expect(page.locator('.combat-ap')).toContainText('MOVE SPENT');
});
