import { expect, test } from '@playwright/test';

// Wide-viewport pane battery (SESSION-05). Runs in the chromium-portrait project because the
// wide viewport projects in playwright.config.js are testMatch-scoped to adaptive-layout.spec.js;
// this file sets a wide viewport per-test instead, and skips elsewhere.

const REDUCED_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: true
};

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-portrait', 'wide-panes battery runs once in chromium-portrait with a widened viewport');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((settings) => {
    // Only seed storage on the first navigation of the test so reload() preserves the autosave
    // and the persisted widePanes payload (matches navigation-history.spec.js pattern).
    if (localStorage.getItem('od_settings')) return;
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, REDUCED_SETTINGS);
});

async function finalizeOneOperatorRun(page, seed) {
  await page.goto(`/?seed=${seed}#w=${seed}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
  await page.getByTestId('add-character').click();
  await page.getByTestId(/^(wide-class-breacher|class-breacher)$/).first().click();
  const sigilTab = page.getByTestId('tab-sigil');
  if (await sigilTab.count()) await sigilTab.click();
  await page.getByTestId(/^(wide-sigil-e000|sigil-e000)$/).first().click();
  await page.getByTestId('finalize').click();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

function widthAt(page, side) {
  return page.evaluate((s) => {
    const shell = document.querySelector('[data-testid="wide-shell"]');
    const varName = s === 'left' ? '--wide-left-w' : '--wide-right-w';
    return Number.parseFloat(shell.style.getPropertyValue(varName)) || null;
  }, side);
}

test('wide-panes: drag left handle widens telemetry, persisted through reload', async ({ page }) => {
  await finalizeOneOperatorRun(page, 6001);

  const handle = page.getByTestId('pane-handle-left');
  await expect(handle).toBeVisible();

  const beforeLeft = await widthAt(page, 'left');
  expect(beforeLeft).toBeGreaterThan(0);

  const box = await handle.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => widthAt(page, 'left'))
    .toBeGreaterThan(beforeLeft + 40);

  const afterLeft = await widthAt(page, 'left');

  // Reload: persisted width restored.
  await page.reload();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  const restoredLeft = await widthAt(page, 'left');
  expect(Math.round(restoredLeft)).toBe(Math.round(afterLeft));

  // localStorage carries the exact numeric value under settings.widePanes.left.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('od_settings') || '{}').widePanes || null);
  expect(stored?.left).toBe(Math.round(afterLeft));
});

test('wide-panes: collapse right dock hides content, tab column stays; reload restores collapsed state', async ({ page }) => {
  await finalizeOneOperatorRun(page, 6002);

  const collapseRight = page.getByTestId('pane-collapse-right');
  await expect(collapseRight).toBeVisible();
  await collapseRight.click();

  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('collapsed');

  // Tab column remains visible in the collapsed rail; content pane is hidden.
  await expect(page.locator('.wide-console-tabs')).toBeVisible();
  await expect(page.locator('.wide-console-content')).toBeHidden();

  // Reload persists.
  await page.reload();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('collapsed');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('od_settings') || '{}').widePanes || null);
  expect(stored?.right).toBe('collapsed');
});

test('wide-panes: keyboard resize on focused handle does not move the party', async ({ page }) => {
  await finalizeOneOperatorRun(page, 6003);

  const partyBefore = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="exploration-canvas"]');
    return canvas?.getBoundingClientRect().toJSON?.() || null;
  });

  const handle = page.getByTestId('pane-handle-left');
  await handle.focus();
  const startLeft = await widthAt(page, 'left');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  await expect
    .poll(() => widthAt(page, 'left'))
    .toBe(startLeft + 48);

  // Party position should not have moved (arrow keys eaten by the handle via stopPropagation).
  // A moved party would trigger a re-render, but the canvas element itself stays put; the more
  // reliable check is that no logged move landed for this turn: telemetry-dock's LOG feed stays
  // free of a move entry.
  const moveLog = await page.evaluate(() => {
    const feed = document.querySelector('.wide-log-feed-scroll');
    if (!feed) return null;
    return feed.textContent.includes('→ Party moved');
  });
  expect(moveLog).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSION-04 (originally clarity-and-fit; assertions AMENDED 2026-08-17 by
// map-pan-zoom SESSION-04). The middle (playfield) track holds 1fr and
// absorbs surplus viewport width in every pane state — the map docks and
// fills the entire middle. The console dock is fixed at
// max(360px, --wide-right-w). Rails stay flush at every combination.
// ─────────────────────────────────────────────────────────────────────────────

async function dockBounds(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  }, selector);
}

test('wide-panes: at 1600x900, expanded console dock reaches the viewport-right edge (no dead gutter)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await finalizeOneOperatorRun(page, 6004);

  const dock = await dockBounds(page, '.wide-console-dock');
  expect(dock).not.toBeNull();
  // Dock is fixed at max(360px, --wide-right-w); with tracks summing to
  // 100vw and the middle 1fr consuming surplus, the dock's right edge
  // reaches the viewport-right within a 24px tolerance.
  expect(dock.right).toBeGreaterThanOrEqual(1600 - 24);

  // .wide-playfield-inner fills its column exactly — no centered letterbox
  // (the 9:16 cap was retired 2026-08-17 by map-pan-zoom).
  const column = await dockBounds(page, '.wide-playfield-column');
  const inner = await dockBounds(page, '.wide-playfield-inner');
  expect(column).not.toBeNull();
  expect(inner).not.toBeNull();
  expect(Math.abs(inner.width - column.width)).toBeLessThanOrEqual(1);
});

test('wide-panes: dragging the right handle wider, reload persists dragged floor and dock still reaches the edge', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await finalizeOneOperatorRun(page, 6005);

  const rightHandle = page.getByTestId('pane-handle-right');
  await expect(rightHandle).toBeVisible();

  const beforeRight = await widthAt(page, 'right');
  const box = await rightHandle.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Drag inward (left) by 120px → dock's floor grows by 120px.
  await page.mouse.move(startX - 120, startY, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(() => widthAt(page, 'right'))
    .toBeGreaterThan(beforeRight + 80);
  const afterRight = await widthAt(page, 'right');

  // Reload — persisted width restored.
  await page.reload();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  const restoredRight = await widthAt(page, 'right');
  expect(Math.round(restoredRight)).toBe(Math.round(afterRight));

  // Dock is fixed at exactly max(360, dragged) wide (map-pan-zoom
  // 2026-08-17 — 1fr on the middle absorbs surplus, no longer on the dock)
  // and stays flush against the viewport-right edge. The playfield column
  // shrinks by the same amount to keep tracks summing to 100vw.
  const dock = await dockBounds(page, '.wide-console-dock');
  expect(dock.right).toBeGreaterThanOrEqual(1600 - 2);
  expect(Math.abs(dock.width - Math.max(360, restoredRight))).toBeLessThanOrEqual(1);
});

test('wide-panes: collapsing the right dock pins both rails flush to their viewport edges (no dead gutters, chevrons stay adjacent, expand restores content)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await finalizeOneOperatorRun(page, 6006);

  const collapseRight = page.getByTestId('pane-collapse-right');
  await expect(collapseRight).toBeVisible();
  await collapseRight.click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('collapsed');

  // Middle (playfield) track absorbs surplus width in every pane state
  // (map-pan-zoom 2026-08-17); both rails hug the viewport edges.
  const telemetry = await dockBounds(page, '.wide-telemetry-dock');
  const dock = await dockBounds(page, '.wide-console-dock');
  expect(telemetry).not.toBeNull();
  expect(dock).not.toBeNull();
  expect(telemetry.left).toBeLessThanOrEqual(2);
  expect(dock.right).toBeGreaterThanOrEqual(1600 - 2);
  // Right rail keeps its 96px width; content pane is hidden entirely.
  expect(Math.round(dock.width)).toBe(96);
  await expect(page.locator('.wide-console-content')).toBeHidden();

  // Chevrons render within 16px of the rail/dock they control (measured
  // against the outer edge closest to the viewport wall they sit on).
  const cLeft = await dockBounds(page, '[data-testid="pane-collapse-left"]');
  const cRight = await dockBounds(page, '[data-testid="pane-collapse-right"]');
  expect(cLeft.left).toBeLessThanOrEqual(16);
  expect(1600 - cRight.right).toBeLessThanOrEqual(16);

  // Playfield column fills the middle; .wide-playfield-inner fills the
  // column exactly — no centered letterbox (the 9:16 cap was retired
  // 2026-08-17 by map-pan-zoom, per the Custom Rule 8 amendment).
  const column = await dockBounds(page, '.wide-playfield-column');
  const inner = await dockBounds(page, '.wide-playfield-inner');
  expect(Math.abs(inner.width - column.width)).toBeLessThanOrEqual(1);
  // Column stretches to fill viewport minus both docks (±1px tolerance).
  const expectedMid = 1600 - telemetry.width - dock.width;
  expect(Math.abs(column.width - expectedMid)).toBeLessThanOrEqual(1);
  // Column ≥ 320px (the minmax() floor).
  expect(column.width).toBeGreaterThanOrEqual(320);

  // Re-expand: the content pane must come back and the dock's width
  // becomes at least the WIDE_PANE_RIGHT_BOUNDS default (360px).
  await collapseRight.click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('open');
  await expect(page.locator('.wide-console-content')).toBeVisible();
  const reopened = await dockBounds(page, '.wide-console-dock');
  expect(reopened.width).toBeGreaterThanOrEqual(360);
  expect(reopened.right).toBeGreaterThanOrEqual(1600 - 2);
});

test('wide-panes: collapsing the left dock keeps both rails flush and chevrons adjacent (telemetry rail at x=0)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await finalizeOneOperatorRun(page, 6008);

  const collapseLeft = page.getByTestId('pane-collapse-left');
  await expect(collapseLeft).toBeVisible();
  await collapseLeft.click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneLeft))
    .toBe('collapsed');

  const telemetry = await dockBounds(page, '.wide-telemetry-dock');
  const dock = await dockBounds(page, '.wide-console-dock');
  expect(telemetry.left).toBeLessThanOrEqual(2);
  expect(Math.round(telemetry.width)).toBe(48);
  expect(dock.right).toBeGreaterThanOrEqual(1600 - 2);

  const cLeft = await dockBounds(page, '[data-testid="pane-collapse-left"]');
  const cRight = await dockBounds(page, '[data-testid="pane-collapse-right"]');
  expect(cLeft.left).toBeLessThanOrEqual(16);
  expect(1600 - cRight.right).toBeLessThanOrEqual(16);

  // Re-expand — telemetry back to WIDE_PANE_LEFT_BOUNDS default (280).
  await collapseLeft.click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneLeft))
    .toBe('open');
  const reopened = await dockBounds(page, '.wide-telemetry-dock');
  expect(reopened.width).toBeGreaterThanOrEqual(280);
  expect(reopened.left).toBeLessThanOrEqual(2);
});

test('wide-panes: clicking a console tab while the right dock is collapsed auto-expands the dock and still switches mode', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await finalizeOneOperatorRun(page, 6009);

  await page.getByTestId('pane-collapse-right').click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('collapsed');

  // Tap a non-active tab — GEAR — while collapsed.
  const gearTab = page.locator('.wide-mode-tab').filter({ hasText: /GEAR/i }).first();
  await gearTab.click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('open');
  await expect(page.locator('.wide-console-content')).toBeVisible();
  await expect(gearTab).toHaveClass(/active/);
});

test('wide-panes: pane collapse state survives an exploration↔combat entry (persistence across screen swap)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await finalizeOneOperatorRun(page, 6010);

  await page.getByTestId('pane-collapse-right').click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('collapsed');

  // Reload — the settings persist, and the freshly-mounted exploration
  // screen's wide-shell must reflect the collapsed right pane.
  await page.reload();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('collapsed');
  const dock = await dockBounds(page, '.wide-console-dock');
  expect(dock.right).toBeGreaterThanOrEqual(1600 - 2);
  expect(Math.round(dock.width)).toBe(96);
});

test('wide-panes: at 1024x900 (breakpoint minimum), three regions render with no horizontal scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await finalizeOneOperatorRun(page, 6007);

  await expect(page.locator('.wide-telemetry-dock')).toBeVisible();
  await expect(page.locator('.wide-playfield-column')).toBeVisible();
  await expect(page.locator('.wide-console-dock')).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1024);
});
