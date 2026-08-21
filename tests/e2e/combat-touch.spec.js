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
// Mirrors COMBAT_PORTRAIT_CELL_PX in src/ui/screens/combat.js: camera opens
// zoomed so a world cell ≈ 64 CSS px, clamped to [fit, 4×fit].
const COMBAT_PORTRAIT_CELL_PX = 64;
const MAX_ZOOM = 4;

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

async function canvasTap(page, x, y, isMobile) {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * Compute the client-space tap point for a world cell using the live combat
 * playfield rect plus the SESSION-01 in-flow camera semantics. The portrait
 * camera opens with `centerOn(active)` then `zoomToCells(COMBAT_CELL_SIZE,
 * COMBAT_PORTRAIT_CELL_PX)`, so the scale is clamped to `[fitScale,
 * MAX_ZOOM * fitScale]` and the offset is clamped so the world fills the
 * viewport when scaled world ≤ view. No magic screen offsets, no fit-only
 * assumption; the math mirrors src/ui/viewport.js exactly.
 */
async function tapCoordForCell(page, cellX, cellY, { windowW, windowH, partyPos }) {
  return page.evaluate(
    ({ cellX, cellY, windowW, windowH, cellSize, portraitCellPx, maxZoom, partyPos }) => {
      const canvas = document.querySelector('[data-testid="combat-canvas"]');
      const rect = canvas.getBoundingClientRect();
      const WORLD_W = windowW * cellSize;
      const WORLD_H = windowH * cellSize;
      const fitScale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
      const rawScale = portraitCellPx / cellSize;
      const scale = Math.max(fitScale, Math.min(fitScale * maxZoom, rawScale));
      const spanX = rect.width / scale;
      const spanY = rect.height / scale;
      const centerWorldX = (partyPos.x + 0.5) * cellSize;
      const centerWorldY = (partyPos.y + 0.5) * cellSize;
      let camX;
      let camY;
      if (WORLD_W * scale <= rect.width) {
        camX = (WORLD_W - spanX) / 2;
      } else {
        camX = Math.max(0, Math.min(centerWorldX - spanX / 2, WORLD_W - spanX));
      }
      if (WORLD_H * scale <= rect.height) {
        camY = (WORLD_H - spanY) / 2;
      } else {
        camY = Math.max(0, Math.min(centerWorldY - spanY / 2, WORLD_H - spanY));
      }
      const worldX = cellX * cellSize + cellSize / 2;
      const worldY = cellY * cellSize + cellSize / 2;
      return {
        x: rect.left + (worldX - camX) * scale,
        y: rect.top + (worldY - camY) * scale
      };
    },
    {
      cellX, cellY, windowW, windowH,
      cellSize: COMBAT_CELL_SIZE,
      portraitCellPx: COMBAT_PORTRAIT_CELL_PX,
      maxZoom: MAX_ZOOM,
      partyPos
    }
  );
}

// SESSION-06 — rect assertions for the failing portrait engines (chromium-
// phone-touch 412×915 + chromium-portrait 1080×1920). Every in-run region
// (status, playfield, feedback rail, console-bar) must sit inside the viewport
// AND pairwise non-overlap now that the console is a flex-in-flow child.
async function assertPortraitLayoutRegions(page) {
  const viewport = page.viewportSize();
  const rects = await page.evaluate(() => {
    const selectors = {
      status: '.status-strip',
      playfield: '[data-testid="combat-canvas"]',
      feedback: '[data-testid="combat-feedback"]',
      console: '.console-bar'
    };
    const out = {};
    for (const [key, sel] of Object.entries(selectors)) {
      const el = document.querySelector(sel);
      if (el) out[key] = el.getBoundingClientRect().toJSON();
      else out[key] = null;
    }
    return out;
  });
  for (const [name, r] of Object.entries(rects)) {
    if (!r) throw new Error(`missing region rect for ${name}`);
    expect(r.top, `${name} top`).toBeGreaterThanOrEqual(-1);
    expect(r.left, `${name} left`).toBeGreaterThanOrEqual(-1);
    expect(r.right, `${name} right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(r.bottom, `${name} bottom`).toBeLessThanOrEqual(viewport.height + 1);
  }
  const overlap = (a, b) => {
    const dx = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const dy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return dx > 1 && dy > 1;
  };
  const pairs = [
    ['status', 'playfield'],
    ['status', 'feedback'],
    ['status', 'console'],
    ['playfield', 'feedback'],
    ['playfield', 'console'],
    ['feedback', 'console']
  ];
  for (const [a, b] of pairs) {
    expect(overlap(rects[a], rects[b]), `${a} overlaps ${b}`).toBe(false);
  }
  return rects;
}

test('combat: two-tap on canvas routes then confirms the move; drag pans with no side effects', async ({ page, isMobile }) => {
  await installStableStorage(page);
  const { fragment, partyPos, windowW, windowH } = combatFixture();
  await importCombat(page, fragment);

  await page.getByTestId('console-tab-combat').click();
  await page.getByTestId('combat-action-move').click();
  // SESSION-06 — the portrait console is a bounded in-flow tray, no longer an
  // absolute overlay above the canvas. There is no need to cycle the console
  // size by re-clicking the active COMBAT tab; canvas taps always land on the
  // world layer regardless of console expand state.

  // Portrait layout invariants: every region is inside the viewport and
  // pairwise non-overlapping (status | playfield | feedback | console).
  const regions = await assertPortraitLayoutRegions(page);

  // Party at (1,6). Target (1,8) is 2 south — reachable within MOVE_RANGE=5.
  const dest = { x: partyPos.x, y: partyPos.y + 2 };
  const p1 = await tapCoordForCell(page, dest.x, dest.y, { windowW, windowH, partyPos });

  // Destination point must lie inside the playfield rect AND outside every
  // non-playfield region (console-bar, tab bar, feedback rail, status).
  const insidePlayfield =
    p1.x >= regions.playfield.left && p1.x <= regions.playfield.right &&
    p1.y >= regions.playfield.top && p1.y <= regions.playfield.bottom;
  expect(insidePlayfield, 'destination lies inside playfield').toBe(true);
  for (const key of ['console', 'feedback', 'status']) {
    const r = regions[key];
    const insideOther =
      p1.x >= r.left && p1.x <= r.right && p1.y >= r.top && p1.y <= r.bottom;
    expect(insideOther, `destination is NOT inside ${key}`).toBe(false);
  }

  await expect(page.locator('.combat-ap')).toContainText('MOVE READY');

  // Tap 1: routes BFS path; party has NOT moved; feedback rail shows the exact
  // confirm hint text.
  await canvasTap(page, p1.x, p1.y, isMobile);
  await expect(page.getByTestId('combat-notice')).toHaveText('TAP DESTINATION AGAIN TO CONFIRM.');
  await expect(page.locator('.combat-ap')).toContainText('MOVE READY');

  // Tap 2 must land on the SAME world cell as tap 1. Tap 1 causes a
  // re-render whose flex layout may shift the playfield rect by a few
  // pixels; recompute the tap coord from the live camera state before tap 2
  // so we hit the same cell instead of the same client pixel.
  const p2 = await tapCoordForCell(page, dest.x, dest.y, { windowW, windowH, partyPos });
  await canvasTap(page, p2.x, p2.y, isMobile);
  await expect(page.locator('.combat-ap')).toContainText('MOVE SPENT');
  await expect(page.getByTestId('combat-action-move')).toBeDisabled();

  // Snapshot notice text after tap 2 so we can assert the drag doesn't invent
  // a new notice below.
  const noticeAfterSpend = await page.getByTestId('combat-notice').textContent();

  // Drag across the canvas — pans the camera only. Notice stays as-is (the
  // rail may still be showing the last message; the assertion is that a drag
  // did not overwrite it), MOVE stays spent, no new action fired.
  const canvasBox = await page.getByTestId('combat-canvas').boundingBox();
  const centerX = canvasBox.x + canvasBox.width / 2;
  const centerY = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 120, centerY, { steps: 8 });
  await page.mouse.up();
  const noticeAfterDrag = await page.getByTestId('combat-notice').textContent();
  expect(noticeAfterDrag).toBe(noticeAfterSpend);
  await expect(page.locator('.combat-ap')).toContainText('MOVE SPENT');
});

test('combat desktop: wheel-zoom keeps the two-tap flow landing on the intended cell', async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), 'wheel-zoom check runs in the desktop project');

  await installStableStorage(page);
  const { fragment, partyPos, windowW, windowH } = combatFixture();
  await importCombat(page, fragment);

  await page.getByTestId('console-tab-combat').click();
  await page.getByTestId('combat-action-move').click();

  // Derive the party's screen position from the live camera state (not a
  // fit-only offset). partyPos is at (1,6); after mount the camera has
  // centered on party and zoomed to COMBAT_PORTRAIT_CELL_PX.
  const partyScreen = await tapCoordForCell(page, partyPos.x, partyPos.y, {
    windowW, windowH, partyPos
  });

  // Wheel-zoom anchored on the party. page.mouse.wheel first per the spec plan,
  // then a synthetic large-delta WheelEvent that clamps to MAX_ZOOM_SCALE (4×
  // post-wheel fit) so the destination screen coord is deterministic under any
  // wheel-normalisation quirk.
  await page.mouse.move(partyScreen.x, partyScreen.y);
  await page.mouse.wheel(0, -800);
  await page.evaluate(({ x, y }) => {
    const body = document.querySelector('.combat-playfield');
    body.dispatchEvent(new WheelEvent('wheel', {
      clientX: x, clientY: y, deltaY: -1200, bubbles: true, cancelable: true
    }));
  }, { x: partyScreen.x, y: partyScreen.y });

  // At the MAX_ZOOM_SCALE ceiling the camera anchors world (partyPos) to
  // (partyScreen.x, partyScreen.y). Any other cell's screen position is
  // (partyScreen + Δworld · finalScale) where finalScale = fitScale × 4.
  // (2, 6) is 1 cell east of party (1, 6) — reachable, on-screen, above the
  // in-flow console-bar (no overlay concern after SESSION-06).
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
