import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState, startStandardCombat } from '../helpers/game-fixture.js';

// portrait-usability-regression-repair SESSION-07 — integrated acceptance for
// portrait combat/exploration geometry, title/manual recovery, and wide-square
// settings, plus a compact cross-feature smoke. Assertions are behavioral
// (rectangles, containment, minimum hit sizes, non-overlap); screenshot
// attachments back the checks for human review. See MASTER.md acceptance list.

const REDUCED_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

// Mirror src/ui/screens/combat.js: cell size 48, portrait entry cell ~64 CSS px,
// viewport max-zoom 4× fit. Kept in lockstep with combat.js so tap coordinates
// derive from the same math the camera uses.
const COMBAT_CELL_SIZE = 48;
const COMBAT_PORTRAIT_CELL_PX = 64;
const MAX_ZOOM = 4;

const PHONE_PROJECT = 'chromium-phone-touch';
const TALL_PROJECT = 'chromium-portrait';
const PORTRAIT_PROJECTS = new Set([PHONE_PROJECT, TALL_PROJECT]);

// ─── Reusable helpers ────────────────────────────────────────────────────────

async function installStableStorage(page) {
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, REDUCED_SETTINGS);
}

// Serialise a map of selectors → getBoundingClientRect JSON in one page hop.
async function readRects(page, selectors) {
  return page.evaluate((sels) => {
    const out = {};
    for (const [key, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      out[key] = el ? el.getBoundingClientRect().toJSON() : null;
    }
    return out;
  }, selectors);
}

// Normalize `boundingBox()` payloads ({x, y, width, height}) and DOMRect
// payloads (getBoundingClientRect().toJSON(), carries top/left/right/bottom)
// into a common {top, left, right, bottom, width, height} shape so the geometry
// helpers accept either input.
function toRect(rect) {
  if (!rect) return null;
  if (typeof rect.top === 'number' && typeof rect.bottom === 'number') return rect;
  return {
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height
  };
}

function insideViewport(rect, viewport, tolerance = 1) {
  const r = toRect(rect);
  return (
    r.top >= -tolerance &&
    r.left >= -tolerance &&
    r.right <= viewport.width + tolerance &&
    r.bottom <= viewport.height + tolerance
  );
}

function containedIn(inner, outer, tolerance = 2) {
  const i = toRect(inner);
  const o = toRect(outer);
  return (
    i.left >= o.left - tolerance &&
    i.right <= o.right + tolerance &&
    i.top >= o.top - tolerance &&
    i.bottom <= o.bottom + tolerance
  );
}

function overlaps(a, b, tolerance = 1) {
  const ra = toRect(a);
  const rb = toRect(b);
  const dx = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left));
  const dy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top));
  return dx > tolerance && dy > tolerance;
}

function pointInRect(pt, rect) {
  const r = toRect(rect);
  return pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom;
}

// Minimum visible height across a selector — filters detached / display:none
// nodes so touch-floor claims aren't diluted by hidden mode content.
async function visibleMinHeight(page, selector) {
  const heights = await page.locator(selector).evaluateAll((els) => els
    .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
    .map((el) => Math.round(el.getBoundingClientRect().height)));
  return { min: heights.length ? Math.min(...heights) : null, count: heights.length, heights };
}

async function attachViewportShot(page, testInfo, name) {
  const shot = await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
  return shot;
}

// ─── Combat fixture (same recipe as combat-touch.spec.js) ────────────────────

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

// Reproduces src/ui/viewport.js clamp math so a target cell's screen point is
// deterministic under the portrait camera (centerOn(active) → zoomToCells 64px
// clamped to [fitScale, 4·fitScale]).
async function tapCoordForCombatCell(page, cellX, cellY, ctx) {
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
    const camX = WORLD_W * scale <= rect.width
      ? (WORLD_W - spanX) / 2
      : Math.max(0, Math.min(centerX - spanX / 2, WORLD_W - spanX));
    const camY = WORLD_H * scale <= rect.height
      ? (WORLD_H - spanY) / 2
      : Math.max(0, Math.min(centerY - spanY / 2, WORLD_H - spanY));
    const worldX = cellX * cellSize + cellSize / 2;
    const worldY = cellY * cellSize + cellSize / 2;
    return { x: rect.left + (worldX - camX) * scale, y: rect.top + (worldY - camY) * scale };
  }, {
    cellX, cellY,
    windowW: ctx.windowW, windowH: ctx.windowH,
    cellSize: COMBAT_CELL_SIZE,
    portraitCellPx: COMBAT_PORTRAIT_CELL_PX,
    maxZoom: MAX_ZOOM,
    partyPos: ctx.partyPos
  });
}

// ─── Exploration touch flow (fresh run via tap-through creation) ─────────────

async function createRunByTouch(page, seed = 5) {
  await page.goto(`/?seed=${seed}#w=${seed}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
  await page.getByTestId('add-character').tap();
  await page.getByTestId('class-breacher').tap();
  const sigilTab = page.getByTestId('tab-sigil');
  if (await sigilTab.count()) await sigilTab.tap();
  await page.getByTestId('sigil-e000').tap();
  await page.getByTestId('finalize').tap();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

async function readPartyCell(page) {
  const label = await page.getByTestId('exploration-canvas').getAttribute('aria-label');
  const match = /Party at (-?\d+),(-?\d+)\./.exec(label ?? '');
  if (!match) throw new Error(`could not read party cell from aria-label: ${label}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('portrait usability integrated acceptance', () => {
  // ── Checkpoint 1 — portrait combat evidence at phone + tall projects ─────
  test('portrait combat: regions contained, ordered, non-overlapping; move tap surfaces confirm notice', async ({ page, isMobile }, testInfo) => {
    test.skip(!PORTRAIT_PROJECTS.has(testInfo.project.name), 'portrait combat evidence runs at phone + tall portrait projects only');
    test.slow();
    await installStableStorage(page);
    const { fragment, partyPos, windowW, windowH } = combatFixture();
    await importCombat(page, fragment);

    // Portrait frame occupies the viewport (no letterbox after the SESSION-06 fix).
    const viewport = page.viewportSize();
    const frameRect = await page.locator('#portrait-frame').boundingBox();
    expect(frameRect).not.toBeNull();
    expect(frameRect.width).toBeGreaterThanOrEqual(viewport.width - 2);
    expect(frameRect.height).toBeGreaterThanOrEqual(viewport.height - 2);

    // Open the MOVE action so the console tab bar + action grid + feedback rail
    // are all instantiated. combat mode is already the mounted console mode
    // (see src/ui/screens/combat.js line ~563).
    await page.getByTestId('console-tab-combat').click();
    await page.getByTestId('combat-action-move').click();

    // Regions present and contained inside the viewport (top-level layout).
    const rawRects = await readRects(page, {
      status: '.status-strip',
      playfield: '[data-testid="combat-canvas"]',
      feedback: '[data-testid="combat-feedback"]',
      tabBar: '.console-tab-bar',
      consoleBar: '.console-bar'
    });
    const rects = Object.fromEntries(Object.entries(rawRects).map(([k, v]) => [k, toRect(v)]));
    for (const [name, r] of Object.entries(rects)) {
      if (!r) throw new Error(`missing region rect: ${name}`);
      expect(insideViewport(r, viewport, 2), `${name} inside viewport`).toBe(true);
    }

    // Vertical ordering: status → playfield → feedback → tabBar. Console body
    // sits below (or shares the console-bar box with) the tab bar.
    expect(rects.status.bottom, 'status → playfield').toBeLessThanOrEqual(rects.playfield.top + 1);
    expect(rects.playfield.bottom, 'playfield → feedback').toBeLessThanOrEqual(rects.feedback.top + 1);
    expect(rects.feedback.bottom, 'feedback → tabBar').toBeLessThanOrEqual(rects.tabBar.top + 1);

    // Top-level regions pairwise non-overlapping.
    const topLevel = ['status', 'playfield', 'feedback', 'tabBar'];
    for (let i = 0; i < topLevel.length; i++) {
      for (let j = i + 1; j < topLevel.length; j++) {
        expect(overlaps(rects[topLevel[i]], rects[topLevel[j]]), `${topLevel[i]} overlaps ${topLevel[j]}`).toBe(false);
      }
    }

    // The action list is a scrollable child of the console body; its total
    // rect may exceed the visible tray. Assert (a) the list is anchored inside
    // the console-bar box and (b) at least one action row is visible inside
    // the viewport so the operator can reach an action without scrolling.
    const actionsRect = toRect(await page.locator('[data-testid="combat-actions"]').boundingBox());
    expect(actionsRect).not.toBeNull();
    expect(actionsRect.top).toBeGreaterThanOrEqual(rects.consoleBar.top - 2);
    const firstActionRect = toRect(await page.locator('.combat-action').first().boundingBox());
    expect(firstActionRect).not.toBeNull();
    expect(insideViewport(firstActionRect, viewport, 2), 'first action row inside viewport').toBe(true);
    expect(containedIn(firstActionRect, rects.consoleBar, 4), 'first action row inside console-bar').toBe(true);

    // Critical combat status text renders (Depth, Round, Seed, Initiative,
    // active sigil, HP mini-bar, CHARGE mini-bar, AP, MV).
    await expect(page.locator('.status-depth-combat').first()).toBeVisible();
    await expect(page.locator('.status-round').first()).toBeVisible();
    await expect(page.locator('.status-seed').first()).toBeVisible();
    await expect(page.locator('.status-initiative').first()).toBeVisible();
    await expect(page.locator('.status-active-sigil').first()).toBeVisible();
    await expect(page.locator('.status-mini-hp').first()).toBeVisible();
    await expect(page.locator('.status-mini-charge').first()).toBeVisible();
    await expect(page.locator('.status-ap').first()).toBeVisible();
    await expect(page.locator('.status-move').first()).toBeVisible();

    // Map retains a meaningful positive interaction area after the compact
    // console tray is open — SESSION-01 opens the tray to 'half' once on mount.
    // Icon-first density (SESSION-08) locks the reclaimed floors from GAP §5:
    // phone (412×915) → ≥ 224px playfield; tall (1080×1920) → ≥ 240px.
    // Never weakens the prior 200px floor.
    const playfieldFloor = testInfo.project.name === PHONE_PROJECT ? 224 : 240;
    expect(rects.playfield.height, 'playfield height (icon-first floor)')
      .toBeGreaterThanOrEqual(playfieldFloor);

    // Cap the console tab bar height (SESSION-08) — mode-tab min-height is 96,
    // and the icon-only tab treatment collapses padding so the bar row itself
    // stays close to that minimum. 104px leaves 8px slack for the flex-row
    // wrapper without allowing a re-inflation to text-tab heights.
    expect(rects.tabBar.height, 'console tab bar max height').toBeLessThanOrEqual(104);

    // Every visible touch-capable console row honors the 96 CSS-px floor
    // (portrait rule from styles/components.css). Tabs, action rows, direction
    // cells, target rows, confirm buttons all match either `.console-row` or
    // `.mode-tab`. `:not(.console-static-row):not(.console-static-card)`
    // (console-submenu-density-and-scroll SESSION-04) keeps compact read-only
    // rows — which intentionally reclaim space below the floor — out of this
    // control-surface query.
    const consoleTouch = await visibleMinHeight(page, '.console-row:not(.console-static-row):not(.console-static-card):visible, .mode-tab:visible');
    expect(consoleTouch.count, 'visible touch-capable row count').toBeGreaterThan(0);
    expect(consoleTouch.min, 'min touch-row height (portrait)').toBeGreaterThanOrEqual(96);

    // First reachable move destination — 2 south of party — derived from the
    // live canvas rect and the same camera math the runtime uses.
    const dest = { x: partyPos.x, y: partyPos.y + 2 };
    const dp = await tapCoordForCombatCell(page, dest.x, dest.y, { partyPos, windowW, windowH });
    expect(pointInRect(dp, rects.playfield), 'destination inside playfield').toBe(true);
    for (const key of ['status', 'feedback', 'tabBar']) {
      expect(pointInRect(dp, rects[key]), `destination not inside ${key}`).toBe(false);
    }
    await expect(page.locator('.combat-ap').first()).toContainText('MOVE READY');
    await canvasTap(page, dp.x, dp.y, isMobile);
    await expect(page.getByTestId('combat-notice')).toHaveText('TAP DESTINATION AGAIN TO CONFIRM.');

    // Feedback text must be inside the viewport AND inside its rail parent —
    // never clipped by the console tray or the tab bar underneath.
    const noticeRect = await page.getByTestId('combat-notice').boundingBox();
    expect(noticeRect).not.toBeNull();
    expect(insideViewport(noticeRect, viewport, 2), 'combat-notice inside viewport').toBe(true);
    const feedbackAfter = await page.getByTestId('combat-feedback').boundingBox();
    expect(containedIn(noticeRect, feedbackAfter, 2), 'combat-notice inside feedback rail').toBe(true);
    const tabBarAfter = await page.locator('.console-tab-bar').boundingBox();
    expect(overlaps(noticeRect, tabBarAfter), 'combat-notice not covered by tab bar').toBe(false);

    const shotName = testInfo.project.name === PHONE_PROJECT ? 'combat-phone.png' : 'combat-tall.png';
    await attachViewportShot(page, testInfo, shotName);
  });

  // ── Checkpoint 2 — touch exploration + title/manual evidence ─────────────
  test('phone exploration: touch drag pans without moving the party; regions contained + non-overlapping', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE_PROJECT, 'phone-touch project only');
    test.slow();
    await installStableStorage(page);
    await createRunByTouch(page);
    const viewport = page.viewportSize();

    const rects = await readRects(page, {
      status: '.status-strip',
      playfield: '[data-testid="exploration-canvas"]',
      tabBar: '.console-tab-bar'
    });
    for (const [name, r] of Object.entries(rects)) {
      if (!r) throw new Error(`missing region: ${name}`);
      expect(insideViewport(r, viewport, 2), `${name} inside viewport`).toBe(true);
    }
    const regionKeys = ['status', 'playfield', 'tabBar'];
    for (let i = 0; i < regionKeys.length; i++) {
      for (let j = i + 1; j < regionKeys.length; j++) {
        expect(overlaps(rects[regionKeys[i]], rects[regionKeys[j]]), `${regionKeys[i]} overlaps ${regionKeys[j]}`).toBe(false);
      }
    }

    // SESSION-08 chrome ceilings for exploration mode. Icon-first density
    // measured the portrait exploration strip at ~66px in SESSION-05 and the
    // tab bar at 96px; caps at 72/104 give small slack for font-metric
    // variance while blocking any re-inflation.
    const stripRect = toRect(rects.status);
    const tabBarRect = toRect(rects.tabBar);
    expect(stripRect.height, 'exploration status strip max height').toBeLessThanOrEqual(72);
    expect(tabBarRect.height, 'console tab bar max height').toBeLessThanOrEqual(104);

    const startCell = await readPartyCell(page);

    // Real synthetic touch drag on the exploration playfield. Multiple
    // pointermove steps take the pointer well past DRAG_THRESHOLD_PX so the
    // gesture engine classifies as a pan and never falls through to onTap.
    const box = await page.getByTestId('exploration-canvas').boundingBox();
    const xStart = box.x + 40;
    const y = box.y + box.height * 0.6;
    const xEnd = box.x + box.width - 40;
    const dragReport = await page.evaluate(({ xStart, xEnd, y }) => {
      const el = document.querySelector('.exploration-playfield');
      if (!el || typeof PointerEvent !== 'function') return { supported: false };
      const opts = (x) => ({
        clientX: x, clientY: y, pointerId: 42, pointerType: 'touch',
        bubbles: true, cancelable: true, isPrimary: true, button: 0
      });
      el.dispatchEvent(new PointerEvent('pointerdown', opts(xStart)));
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const x = xStart + ((xEnd - xStart) * i) / steps;
        el.dispatchEvent(new PointerEvent('pointermove', opts(x)));
      }
      el.dispatchEvent(new PointerEvent('pointerup', opts(xEnd)));
      return { supported: true };
    }, { xStart, xEnd, y });
    expect(dragReport.supported).toBe(true);
    const afterDragCell = await readPartyCell(page);
    expect(afterDragCell).toEqual(startCell);

    await attachViewportShot(page, testInfo, 'touch-exploration-phone.png');
  });

  test('title/manual: START ↔ branches toggle; modal contained; close restores START without changing history or leaving app-root inert', async ({ page }, testInfo) => {
    test.skip(!PORTRAIT_PROJECTS.has(testInfo.project.name), 'phone + tall portrait only');
    await installStableStorage(page);
    await page.goto('/');
    const viewport = page.viewportSize();

    const start = page.getByTestId('title-start');
    const branches = page.getByTestId('title-branches');
    const modal = page.getByTestId('manual-modal');

    // START visible initially; branches hidden until START is pressed.
    await expect(start).toBeVisible();
    await expect(branches).toBeHidden();

    await start.click();
    await expect(branches).toBeVisible();
    const hashBeforeOpen = await page.evaluate(() => window.location.hash);

    await page.getByTestId('title-manual').click();
    await expect(modal).toBeVisible();
    const modalRect = await modal.boundingBox();
    expect(modalRect).not.toBeNull();
    expect(insideViewport(modalRect, viewport, 2), 'manual modal inside viewport').toBe(true);
    expect(await page.evaluate(() => window.location.hash)).toBe(hashBeforeOpen);
    // While the modal is open, app-root should be inert / aria-hidden.
    const openState = await page.evaluate(() => {
      const root = document.getElementById('app-root');
      return { ariaHidden: root?.getAttribute('aria-hidden'), inert: root ? Boolean(root.inert) : null };
    });
    expect(openState.ariaHidden).toBe('true');

    const openShot = testInfo.project.name === PHONE_PROJECT ? 'title-manual-phone.png' : 'title-manual-tall.png';
    await attachViewportShot(page, testInfo, openShot);

    await page.getByTestId('manual-close').click();
    await expect(modal).toBeHidden();
    // Title reset: START back, branches hidden, focus on START.
    await expect(start).toBeVisible();
    await expect(branches).toBeHidden();
    await expect(start).toBeFocused();
    // Hash unchanged — modal is not a route.
    expect(await page.evaluate(() => window.location.hash)).toBe(hashBeforeOpen);
    // #app-root free of stuck aria-hidden or inert.
    const rootState = await page.evaluate(() => {
      const root = document.getElementById('app-root');
      return { ariaHidden: root?.getAttribute('aria-hidden'), inert: root ? Boolean(root.inert) : null };
    });
    expect(rootState.ariaHidden === 'true', 'app-root aria-hidden not stuck').toBe(false);
    expect(rootState.inert, 'app-root inert not stuck').toBe(false);

    const closeShot = testInfo.project.name === PHONE_PROJECT ? 'title-after-close-phone.png' : 'title-after-close-tall.png';
    await attachViewportShot(page, testInfo, closeShot);
  });

  // ── Checkpoint 3 — wide-square settings + cross-feature smoke ────────────
  test('wide-square settings at 1024×1024: rows ≥ 96px, contained, labels/inputs/values disjoint, consecutive rows disjoint, BACK usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== TALL_PROJECT, 'wide-square case runs at chromium-portrait (viewport reshape)');
    test.slow();
    await installStableStorage(page);
    await page.setViewportSize({ width: 1024, height: 1024 });
    const viewport = { width: 1024, height: 1024 };
    await page.goto('/');
    await expect(page.getByTestId('title-start')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.layout)).toBe('wide');
    await page.getByTestId('title-start').click();
    await page.getByTestId('title-settings').click();
    await expect(page.locator('.wide-settings-shell')).toBeVisible();

    // Two scroll columns reachable.
    await expect(page.getByTestId('settings-audio-column')).toBeVisible();
    await expect(page.getByTestId('settings-visual-column')).toBeVisible();

    const rows = page.locator('.wide-settings-body .toggle-row, .wide-settings-body .slider-row, .wide-settings-body .motion-options');
    const heights = await rows.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights), 'min settings row height').toBeGreaterThanOrEqual(96);

    const rowInfo = await rows.evaluateAll((els) => els.map((el) => {
      const rect = el.getBoundingClientRect().toJSON();
      const columnEl = el.closest('.wide-settings-column');
      const columnRect = columnEl ? columnEl.getBoundingClientRect().toJSON() : null;
      return { rect, columnRect };
    }));
    for (const info of rowInfo) {
      expect(info.columnRect, 'row parent column').not.toBeNull();
      expect(info.rect.left).toBeGreaterThanOrEqual(info.columnRect.left - 1);
      expect(info.rect.right).toBeLessThanOrEqual(info.columnRect.right + 1);
      expect(info.rect.left).toBeGreaterThanOrEqual(0);
      expect(info.rect.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(info.rect.top).toBeGreaterThanOrEqual(0);
      expect(info.rect.bottom).toBeLessThanOrEqual(viewport.height + 1);
    }

    // Slider label / input / value rects never intersect horizontally.
    const sliderTrios = await page.locator('.wide-settings-body .slider-row').evaluateAll((rows) => rows.map((row) => {
      const label = row.querySelector('.slider-label')?.getBoundingClientRect().toJSON() || null;
      const input = row.querySelector('input[type="range"]')?.getBoundingClientRect().toJSON() || null;
      const value = row.querySelector('.slider-value')?.getBoundingClientRect().toJSON() || null;
      return { label, input, value };
    }));
    expect(sliderTrios.length).toBeGreaterThan(0);
    const overlapsX = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1;
    for (const trio of sliderTrios) {
      expect(trio.label, 'slider label rect').not.toBeNull();
      expect(trio.input, 'slider input rect').not.toBeNull();
      expect(trio.value, 'slider value rect').not.toBeNull();
      expect(overlapsX(trio.label, trio.input), 'label vs input').toBe(false);
      expect(overlapsX(trio.input, trio.value), 'input vs value').toBe(false);
      expect(overlapsX(trio.label, trio.value), 'label vs value').toBe(false);
    }

    // Consecutive rows within the same column do not overlap vertically.
    const byColumn = new Map();
    for (const info of rowInfo) {
      const key = `${info.columnRect.left}:${info.columnRect.top}`;
      if (!byColumn.has(key)) byColumn.set(key, []);
      byColumn.get(key).push(info.rect);
    }
    for (const rects of byColumn.values()) {
      rects.sort((a, b) => a.top - b.top);
      for (let i = 1; i < rects.length; i++) {
        expect(rects[i - 1].bottom, 'consecutive rows disjoint').toBeLessThanOrEqual(rects[i].top + 1);
      }
    }

    // BACK usable — inside viewport and clickable to return to title.
    const backRect = await page.getByTestId('settings-back').boundingBox();
    expect(backRect).not.toBeNull();
    expect(insideViewport(backRect, viewport, 2), 'BACK inside viewport').toBe(true);

    await attachViewportShot(page, testInfo, 'settings-wide-square.png');

    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('title-start')).toBeVisible();
  });

  test('cross-feature smoke: state:settings-change (masterVolume) reaches runtime audio graph; invalid state:inventory-change returns false', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== TALL_PROJECT, 'runtime snapshot smoke runs at chromium-portrait only');
    await installStableStorage(page);
    await page.goto('/');
    await expect(page.getByTestId('title-start')).toBeVisible();

    const initial = await page.evaluate(() =>
      import('/src/runtime.js').then((m) => m.getRuntimeSnapshot().masterVolume)
    );
    expect(initial, 'initial masterVolume readable').not.toBeNull();

    const target = initial === 42 ? 63 : 42;
    const result = await page.evaluate(async (volume) => {
      const bus = (await import('/src/state/bus.js')).bus;
      const goodDispatch = bus.dispatch('state:settings-change', { key: 'masterVolume', value: volume });
      const badInventory = bus.dispatch('state:inventory-change', {});
      const runtime = await import('/src/runtime.js');
      return { goodDispatch, badInventory, masterVolume: runtime.getRuntimeSnapshot().masterVolume };
    }, target);
    expect(result.goodDispatch, 'valid settings-change accepted').toBe(true);
    expect(result.badInventory, 'invalid inventory-change payload returns false').toBe(false);
    expect(result.masterVolume, 'live masterVolume reflected in runtime graph').toBe(target);
  });
});
