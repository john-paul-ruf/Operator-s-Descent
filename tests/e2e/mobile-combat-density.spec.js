import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState, startStandardCombat } from '../helpers/game-fixture.js';

// mobile-combat-density-repair SESSION-02 — real-browser proof that the
// SESSION-01 recomposition (compact status overview, icon-forward actions,
// zero-cost inactive feedback rail, 3-col primary row, v8 cache) actually
// reaches a phone-sized viewport and an installed offline client. This is a
// substantive acceptance surface, not a wrapper over existing unit/e2e specs
// — see program/operator-s-descent/prompts/mobile-combat-density-repair/SESSION-02.md.

const REDUCED_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

// Mirrors src/ui/screens/combat.js camera constants — kept in lockstep so tap
// coordinates land on the same cell the production camera renders (same
// convention as tests/e2e/combat-touch.spec.js / portrait-usability.spec.js).
const COMBAT_CELL_SIZE = 48;
const COMBAT_PORTRAIT_CELL_PX = 64;
const MAX_ZOOM = 4;

const PHONE_PROJECT = 'chromium-phone-touch';
const V8_CACHE = 'operator-descent-2026-08-22-mobile-combat-density-v8';
const V7_CACHE = 'operator-descent-2026-08-21-icon-density-v7';
const CHANGED_ASSETS = [
  '/src/ui/status-strip.js',
  '/src/ui/console/combat.js',
  '/src/ui/screens/combat.js',
  '/styles/components.css'
];

// A weapon whose range already covers the whole combat window (8×16, max
// Chebyshev distance well under 16) so Attack is legal from any on-window
// position — the enemy is ALSO placed adjacent to the party below so Attack
// is enabled by distance alone too, not only by the long weapon range.
const ATTACK_WEAPON = { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 };

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Builds a real, resumable combat snapshot (via the same startStandardCombat +
// roundTripRunState recipe used by the existing combat e2e specs) with the
// enemy placed adjacent to the party so Attack is genuinely enabled on
// resume — not a fabricated DOM-only action state.
function attackReadyCombatFixture(seed = 31) {
  const harness = createGameHarness({ seed, partySize: 1 });
  const combat = startStandardCombat(harness, {
    enemyHP: 20,
    partyOverrides: [{ weapon: ATTACK_WEAPON }]
  });
  const windowW = combat.combatState.window.width;
  const windowH = combat.combatState.window.height;
  const activeCombat = harness.runState.activeCombat;
  const party = activeCombat.actors.find((actor) => actor.side === 'party');
  const enemy = activeCombat.actors.find((actor) => actor.side !== 'party');
  if (party && enemy) {
    enemy.x = Math.max(0, Math.min(windowW - 1, party.x + (party.x > 0 ? -1 : 1)));
    enemy.y = party.y;
  }
  const partyTurn = activeCombat.initiativeOrder?.findIndex((id) => String(id).startsWith('operator_'));
  if (partyTurn >= 0) activeCombat.currentIndex = partyTurn;
  return {
    fragment: roundTripRunState(harness.runState).encoded.fragment,
    partyPos: { x: party.x, y: party.y },
    windowW,
    windowH
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
  // COMBAT is already the mounted console mode when combatState is present
  // (src/ui/console/console.js firstAvailableMode) and mount() opens it at
  // 'half' exactly once — assert that precondition rather than clicking the
  // already-active tab, which would fire its own tap-cycle (half → full) and
  // corrupt the very "opens once at half on mount" geometry this spec proves.
  await expect(page.getByTestId('console-tab-combat')).toHaveAttribute('aria-selected', 'true');
}

// Reproduces src/ui/viewport.js's clamp math for the portrait camera
// (centerOn(active) → zoomToCells(64) clamped to [fitScale, 4·fitScale]) so a
// destination cell's screen point is deterministic under any live viewport.
async function tapCoordForCombatCell(page, cellX, cellY, { windowW, windowH, partyPos }) {
  return page.evaluate(({ cellX, cellY, windowW, windowH, cellSize, portraitCellPx, maxZoom, partyPos }) => {
    const canvas = document.querySelector('[data-testid="combat-canvas"]');
    const rect = canvas.getBoundingClientRect();
    const WORLD_W = windowW * cellSize;
    const WORLD_H = windowH * cellSize;
    const fitScale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    const rawScale = portraitCellPx / cellSize;
    const scale = Math.max(fitScale, Math.min(fitScale * maxZoom, rawScale));
    const spanX = rect.width / scale;
    const spanY = rect.height / scale;
    const centerX = (partyPos.x + 0.5) * cellSize;
    const centerY = (partyPos.y + 0.5) * cellSize;
    const camX = WORLD_W * scale <= rect.width ? (WORLD_W - spanX) / 2 : Math.max(0, Math.min(centerX - spanX / 2, WORLD_W - spanX));
    const camY = WORLD_H * scale <= rect.height ? (WORLD_H - spanY) / 2 : Math.max(0, Math.min(centerY - spanY / 2, WORLD_H - spanY));
    const worldX = cellX * cellSize + cellSize / 2;
    const worldY = cellY * cellSize + cellSize / 2;
    return { x: rect.left + (worldX - camX) * scale, y: rect.top + (worldY - camY) * scale };
  }, { cellX, cellY, windowW, windowH, cellSize: COMBAT_CELL_SIZE, portraitCellPx: COMBAT_PORTRAIT_CELL_PX, maxZoom: MAX_ZOOM, partyPos });
}

async function canvasTap(page, x, y, isMobile) {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function toRect(box) {
  if (!box) return null;
  return { top: box.y, left: box.x, right: box.x + box.width, bottom: box.y + box.height, width: box.width, height: box.height };
}

function overlaps(a, b, tolerance = 1) {
  const dx = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const dy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return dx > tolerance && dy > tolerance;
}

function containedIn(inner, outer, tolerance = 3) {
  return inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance
    && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;
}

async function assertNoHorizontalOverflow(page, selector, label) {
  const measured = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null;
  }, selector);
  expect(measured, `${label} (${selector}) present in DOM`).not.toBeNull();
  expect(measured.scrollWidth, `${label} horizontal overflow: scrollWidth ${measured.scrollWidth} vs clientWidth ${measured.clientWidth}`)
    .toBeLessThanOrEqual(measured.clientWidth + 1);
}

async function visibleMinHeight(page, selector) {
  const heights = await page.locator(selector).evaluateAll((els) => els
    .filter((el) => el.offsetParent !== null)
    .map((el) => Math.round(el.getBoundingClientRect().height)));
  return { min: heights.length ? Math.min(...heights) : null, count: heights.length };
}

// ─── Shared acceptance assertions (used by both the phone test and the
// offline-cache test, which repeats the primary subset per checkpoint 2) ────

async function assertCombatDensityCore(page, { statusMax, canvasMin, label }) {
  const statusRect = toRect(await page.locator('.status-strip').boundingBox());
  expect(statusRect, `${label} status strip present`).not.toBeNull();
  expect(statusRect.height, `${label} combat status height measured ${statusRect.height}px (budget ≤${statusMax}px)`)
    .toBeLessThanOrEqual(statusMax);

  for (const selector of [
    '.status-depth-combat', '.status-round', '.status-seed', '.status-initiative',
    '.status-active-sigil', '.status-mini-hp', '.status-mini-charge', '.status-ap', '.status-move'
  ]) {
    await expect(page.locator(selector).first(), `${label} ${selector} visible`).toBeVisible();
  }
  await expect(page.getByTestId('status-manual'), `${label} manual access chip visible`).toBeVisible();

  const canvasRect = toRect(await page.getByTestId('combat-canvas').boundingBox());
  expect(canvasRect, `${label} combat canvas present`).not.toBeNull();
  expect(canvasRect.height, `${label} combat canvas height measured ${canvasRect.height}px (floor ${canvasMin}px)`)
    .toBeGreaterThanOrEqual(canvasMin);

  const feedbackRect = toRect(await page.getByTestId('combat-feedback').boundingBox());
  expect(feedbackRect, `${label} feedback rail present`).not.toBeNull();
  expect(feedbackRect.height, `${label} inactive feedback rail cost measured ${feedbackRect.height}px`).toBeLessThanOrEqual(1);
  expect(overlaps(feedbackRect, canvasRect), `${label} inactive feedback rail does not obscure canvas`).toBe(false);

  const consoleRect = toRect(await page.locator('.console-bar').boundingBox());
  expect(consoleRect, `${label} console bar present`).not.toBeNull();
  expect(Math.abs(canvasRect.bottom - feedbackRect.top), `${label} no blank gap between canvas and feedback rail`).toBeLessThanOrEqual(2);
  expect(Math.abs(feedbackRect.bottom - consoleRect.top), `${label} no blank gap between feedback rail and console`).toBeLessThanOrEqual(2);

  // The requirement is "fully inside the INITIAL CONSOLE CONTENT rectangle" —
  // the scrollable pane itself (which sits below the mode indicator + active
  // conditions row), not the wider console-bar (which also spans the tab bar
  // above it). A button can sit inside console-bar's box while still being
  // clipped below console-content's own overflow fold, so contain against the
  // content pane specifically.
  const contentRect = toRect(await page.locator('.console-content').boundingBox());
  expect(contentRect, `${label} console content present`).not.toBeNull();

  const actionIds = ['move', 'attack', 'end-turn'];
  const actionRects = {};
  for (const id of actionIds) {
    const locator = page.getByTestId(`combat-action-${id}`);
    await expect(locator, `${label} combat-action-${id} visible`).toBeVisible();
    const box = toRect(await locator.boundingBox());
    actionRects[id] = box;
    expect(box.height, `${label} combat-action-${id} height measured ${box.height}px (96px floor)`).toBeGreaterThanOrEqual(96);
    expect(containedIn(box, contentRect, 2), `${label} combat-action-${id} fully inside the initial console content rectangle (no scroll needed) — measured top ${box.top} bottom ${box.bottom} vs content top ${contentRect.top} bottom ${contentRect.bottom}`).toBe(true);
  }
  // First visual row: Move, Attack, End Turn share the same vertical band —
  // the 3-col grid puts them in DOM/focus order without a grid-column span.
  const tops = actionIds.map((id) => actionRects[id].top);
  const bottoms = actionIds.map((id) => actionRects[id].bottom);
  expect(Math.max(...tops) - Math.min(...tops), `${label} primary action row top alignment`).toBeLessThanOrEqual(3);
  expect(Math.max(...bottoms) - Math.min(...bottoms), `${label} primary action row bottom alignment`).toBeLessThanOrEqual(3);

  await assertNoHorizontalOverflow(page, '.status-strip', `${label} status strip`);
  await assertNoHorizontalOverflow(page, '.console-content', `${label} console content`);
  await assertNoHorizontalOverflow(page, '[data-testid="combat-actions"]', `${label} action list`);
}

async function assertIconsAndAccessibleNames(page, label) {
  const statusIconHrefs = await page.locator('.status-combat-topline svg.icon use, .status-combat-active svg.icon use').evaluateAll(
    (els) => els.map((el) => el.getAttribute('href') || '')
  );
  expect(statusIconHrefs.length, `${label} status metric icons rendered`).toBeGreaterThan(0);
  for (const expected of ['#gauge', '#sparkles', '#hash', '#heart', '#battery', '#zap', '#footprints']) {
    expect(statusIconHrefs.some((href) => href.endsWith(expected)), `${label} status icon ${expected} present`).toBe(true);
  }

  const actionExpectations = [
    { id: 'move', icon: '#arrow-down-right', name: 'Move · up to 5 cells' },
    { id: 'attack', icon: '#sword', name: 'Attack · 1 AP' },
    { id: 'end-turn', icon: '#clock', name: 'End Turn · explicit' }
  ];
  for (const { id, icon, name } of actionExpectations) {
    const button = page.getByTestId(`combat-action-${id}`);
    const href = await button.locator('svg.icon use').getAttribute('href');
    expect(href, `${label} combat-action-${id} icon`).toContain(icon);
    await expect(button, `${label} combat-action-${id} full accessible name`).toHaveAttribute('aria-label', name);
  }

  const touchFloor = await visibleMinHeight(page, '.console-row:visible, .mode-tab:visible');
  expect(touchFloor.count, `${label} visible touch-capable rows`).toBeGreaterThan(0);
  expect(touchFloor.min, `${label} min touch row height measured ${touchFloor.min}px`).toBeGreaterThanOrEqual(96);
}

async function assertRetreatReachableByScroll(page, label) {
  await page.evaluate(() => {
    const el = document.querySelector('.console-content');
    el.scrollTop = el.scrollHeight;
  });
  const retreat = page.getByTestId('combat-action-retreat');
  await expect(retreat, `${label} Retreat reachable after natural scroll`).toBeVisible();
  const retreatRect = toRect(await retreat.boundingBox());
  const contentRect = toRect(await page.locator('.console-content').boundingBox());
  expect(containedIn(retreatRect, contentRect, 2), `${label} Retreat sits inside the visible console content pane after scroll`).toBe(true);
}

async function assertMoveFeedbackExpansion(page, testInfo, { partyPos, windowW, windowH, isMobile, label }) {
  await page.getByTestId('combat-action-move').click();
  const dest = { x: partyPos.x, y: partyPos.y + 2 };
  const point = await tapCoordForCombatCell(page, dest.x, dest.y, { windowW, windowH, partyPos });
  await canvasTap(page, point.x, point.y, isMobile);

  const notice = page.getByTestId('combat-notice');
  await expect(notice, `${label} move feedback message visible`).toHaveText('TAP DESTINATION AGAIN TO CONFIRM.');
  const rail = page.getByTestId('combat-feedback');
  await expect(rail, `${label} feedback rail marked active`).toHaveAttribute('data-active', 'true');

  const noticeRect = toRect(await notice.boundingBox());
  const railRect = toRect(await rail.boundingBox());
  const tabBarRect = toRect(await page.locator('.console-tab-bar').boundingBox());
  const playfieldRect = toRect(await page.getByTestId('combat-canvas').boundingBox());
  expect(containedIn(noticeRect, railRect, 2), `${label} move feedback message contained in the rail`).toBe(true);
  expect(overlaps(noticeRect, tabBarRect), `${label} move feedback does not overlap the console tab bar`).toBe(false);
  expect(overlaps(noticeRect, playfieldRect), `${label} move feedback does not overlap the playfield`).toBe(false);
  expect(railRect.height, `${label} active feedback rail expanded height measured ${railRect.height}px`).toBeGreaterThan(1);

  // Reset through the console's own BACK control (renderConfirm's combat-back
  // button calls combatCancel() directly) so the selection does not leak into
  // any later assertion — the party has not moved and AP is untouched.
  await page.getByTestId('combat-back').click();
  await expect(page.getByTestId('combat-action-move'), `${label} console returns to choose-action after reset`).toBeVisible();
}

async function runPhoneDensityAcceptance(page, testInfo, { label, statusMax, canvasMin, isMobile, shotName }) {
  const { fragment, partyPos, windowW, windowH } = attackReadyCombatFixture(31);
  await installStableStorage(page);
  await importCombat(page, fragment);

  await assertCombatDensityCore(page, { statusMax, canvasMin, label });
  await assertIconsAndAccessibleNames(page, label);
  await assertRetreatReachableByScroll(page, label);
  await assertMoveFeedbackExpansion(page, testInfo, { partyPos, windowW, windowH, isMobile, label });

  const shot = await page.screenshot({ fullPage: false });
  await testInfo.attach(shotName, { body: shot, contentType: 'image/png' });
}

// ─── Checkpoint 1 — deterministic phone geometry and interaction acceptance ─

test.describe('mobile combat density — phone acceptance', () => {
  test('portrait combat proves compact status, icon-forward actions, zero-cost feedback, and reachable scroll at 412×915 and the 360×800 lower bound', async ({ page, browser, isMobile }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE_PROJECT, 'phone density acceptance runs at the configured chromium-phone-touch project');
    test.slow();

    await runPhoneDensityAcceptance(page, testInfo, {
      label: '412×915', statusMax: 128, canvasMin: 470, isMobile, shotName: 'combat-phone-412x915.png'
    });

    // 360×800 is the explicit lower bound named by the session; no configured
    // project uses this viewport, so a fresh context is created here rather
    // than silently skipping the check.
    const lowerBoundContext = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
    try {
      const lowerPage = await lowerBoundContext.newPage();
      await runPhoneDensityAcceptance(lowerPage, testInfo, {
        label: '360×800', statusMax: 136, canvasMin: 400, isMobile: true, shotName: 'combat-phone-360x800.png'
      });
    } finally {
      await lowerBoundContext.close();
    }
  });
});

// ─── Checkpoint 2 — cache delivery proof ─────────────────────────────────────

test.describe('mobile combat density — release cache acceptance', () => {
  test('service worker serves the v8 combat density assets online and repeats the geometry proof fully offline; v7 is evicted', async ({ browser, baseURL, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'service-worker cache acceptance runs in Chromium');
    test.slow();

    const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
    const page = await context.newPage();
    try {
      await installStableStorage(page);
      await page.goto('/');
      await page.getByTestId('title-start').click();
      await expect(page.getByTestId('title-branches')).toBeVisible();

      await page.waitForFunction(async () => {
        if (!('serviceWorker' in navigator)) return false;
        const registration = await navigator.serviceWorker.ready;
        return Boolean(registration.active);
      }, null, { timeout: 15000 });
      if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
        await page.reload();
        await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
      }

      const cacheState = await page.evaluate(async (assets) => {
        const keys = await caches.keys();
        const activeKey = keys.find((key) => key.startsWith('operator-descent-'));
        const cache = activeKey ? await caches.open(activeKey) : null;
        const present = {};
        if (cache) {
          for (const asset of assets) present[asset] = Boolean(await cache.match(new URL(asset, location.href).href));
        }
        return { keys, activeKey, present };
      }, CHANGED_ASSETS);

      expect(cacheState.activeKey, `active cache key measured among [${cacheState.keys.join(', ')}]`).toBe(V8_CACHE);
      expect(cacheState.keys, 'v7 predecessor cache evicted').not.toContain(V7_CACHE);
      for (const asset of CHANGED_ASSETS) {
        expect(cacheState.present[asset], `${asset} cached under ${V8_CACHE}`).toBe(true);
      }

      // Resume the deterministic combat snapshot fully offline, from the
      // release cache — proves the repaired screen (not the pre-repair one)
      // is what an installed offline client actually receives.
      const { fragment } = attackReadyCombatFixture(97);
      await context.setOffline(true);
      await page.goto(`/?offline=1#r=${fragment}`);
      await expect(page.getByTestId('import-run-summary')).toContainText('ACTIVE COMBAT SNAPSHOT');
      await page.getByTestId('import-resume').click();
      await expect(page.getByTestId('combat-canvas')).toBeVisible();
      await expect(page.getByTestId('console-tab-combat')).toHaveAttribute('aria-selected', 'true');

      await assertCombatDensityCore(page, { statusMax: 128, canvasMin: 470, label: 'offline v8 resume' });

      const finalKeys = await page.evaluate(() => caches.keys());
      expect(finalKeys, 'v8 cache retained offline').toContain(V8_CACHE);
      expect(finalKeys, 'v7 predecessor cache stays evicted offline').not.toContain(V7_CACHE);
    } finally {
      await context.close();
    }
  });
});
