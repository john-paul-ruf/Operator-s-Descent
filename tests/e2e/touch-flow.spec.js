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

// Seed 5 places the party inside the true 40×64 world (see tapCoordForCell for
// the exploration camera math). Nearest enemy is Chebyshev 13 away so
// `nearestConnectedHostile` (HOSTILE_CONTACT_RANGE=2) never fires during
// south/north steps, keeping the tap/drag journey deterministic.
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

// Screen-space size of one world cell after the wheel-zoom leg has clamped the
// camera to MAX_ZOOM_SCALE × fitScale. The prior implementation hard-coded 72px,
// which was correct only for the retired 20×32 lattice at a specific Pixel-7
// canvas rect; on the 40×64 world (playtest-clarity-and-4x-floors S06) fitScale
// changes and the cell falls closer to ~38px. Derive it live from the current
// canvas geometry so the tap lands one full cell north regardless of device.
async function postWheelCellStepPx(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="exploration-canvas"]');
    const rect = canvas.getBoundingClientRect();
    const WORLD_W = 40 * 24;
    const WORLD_H = 64 * 24;
    const CELL = 24;
    const MAX_ZOOM = 4;
    const fit = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    // Two consecutive wheel events drive scale past MAX_ZOOM * fit; the
    // clampScale in viewport.js pins it at exactly the ceiling.
    return CELL * MAX_ZOOM * fit;
  });
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

  // Icon-first density (SESSION-08): every visible interactive/composite
  // `.console-row` / `.mode-tab` honors the strict 96px touch floor set in
  // components.css. The 48px blanket exception is retired now that icon-only
  // tabs meet the same minimum as every other touchable row (portrait-usability.spec.js:290
  // already asserts 96). `:not(.console-static-row):not(.console-static-card)`
  // (console-submenu-density-and-scroll SESSION-04) keeps this query pointed
  // at actual touch surfaces only — static/read-only content intentionally
  // reclaims space below the floor and must never be counted as a control.
  const visibleRows = page.locator('.console-row:not(.console-static-row):not(.console-static-card):visible, .mode-tab:visible');
  const heights = await visibleRows.evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(96);

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
  // At max zoom (4× fit), one world cell = 24 × (4 × fitScale) screen px. The
  // exact number varies by canvas rect, so read it live rather than hard-coding.
  const cellStepPx = await postWheelCellStepPx(page);
  expect(cellStepPx).toBeGreaterThan(0);
  await page.touchscreen.tap(partyScreen.x, partyScreen.y - cellStepPx);
  await expect.poll(async () => JSON.stringify(await readPartyCell(page)))
    .toBe(JSON.stringify(startCell));

  const afterZoomTapCell = await readPartyCell(page);
  const canvasBox = await page.getByTestId('exploration-canvas').boundingBox();
  expect(canvasBox).toBeTruthy();

  // 3) Drag across the canvas → gesture engine treats as pan; party must not move.
  //    Mouse events on hasTouch=true Chromium fire as pointer events with pointerType=touch.
  //    Sweep well past DRAG_THRESHOLD_PX so this is unambiguously a pan, never a tap.
  await page.mouse.move(canvasBox.x + 40, canvasBox.y + canvasBox.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width - 40, canvasBox.y + canvasBox.height * 0.7, { steps: 8 });
  await page.mouse.up();
  const afterDragCell = await readPartyCell(page);
  expect(afterDragCell).toEqual(afterZoomTapCell);

  // 4) Release-only displacement in the real browser path: synthesize a
  //    pointerdown at one client coord and a pointerup at another with NO
  //    pointermove between them. Playwright's touchscreen and mouse APIs both
  //    inject an intermediate move, so the release-only edge case has to be
  //    dispatched directly. The gesture engine must fold release coords into
  //    classification — if it did not, this would fall through to onTap and
  //    move the party. The unit test remains the authoritative fine-grained
  //    coverage; this asserts the wired-up production path also holds.
  const releaseOnlyReport = await page.evaluate(({ startX, y }) => {
    const body = document.querySelector('.exploration-playfield');
    if (!body || typeof PointerEvent !== 'function') return { supported: false };
    const opts = (cx) => ({
      clientX: cx, clientY: y, pointerId: 999, pointerType: 'touch',
      bubbles: true, cancelable: true, isPrimary: true, button: 0
    });
    body.dispatchEvent(new PointerEvent('pointerdown', opts(startX)));
    body.dispatchEvent(new PointerEvent('pointerup', opts(startX + 24)));
    return { supported: true };
  }, { startX: canvasBox.x + 40, y: canvasBox.y + canvasBox.height * 0.5 });
  expect(releaseOnlyReport.supported).toBe(true);
  const afterReleaseOnlyCell = await readPartyCell(page);
  expect(afterReleaseOnlyCell).toEqual(afterZoomTapCell);
});

test('touch combat attacks directly on a single target tap — no confirm step', async ({ page }) => {
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
  await expect(page.locator('.status-ap')).toHaveText('AP 2');
  await expect(page.locator('button[data-glitch], [role="button"][data-glitch], [data-decision-pending="true"][data-glitch]')).toHaveCount(0);

  // One tap on a legal target executes the attack directly — no separate confirm gesture.
  await page.locator('[data-testid^="combat-target-"]').first().tap();
  await expect(page.getByTestId('combat-confirm')).toHaveCount(0);
  await expect(page.locator('.status-ap')).toContainText(/AP [01]/);
});
