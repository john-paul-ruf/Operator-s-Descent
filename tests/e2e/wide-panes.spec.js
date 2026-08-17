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
// SESSION-04 — surplus width distribution (no dead right gutter, centered when
// docks collapse). The console-dock column absorbs viewport width beyond the
// left + playfield tracks via a trailing 1fr; --wide-right-w becomes the
// user-chosen minimum share, not a fixed width.
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
  // Trailing 1fr in the console-dock column consumes all surplus width; the
  // dock's right edge must reach the viewport-right within a 24px tolerance.
  expect(dock.right).toBeGreaterThanOrEqual(1600 - 24);
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

  // Reload — persisted floor restored.
  await page.reload();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  const restoredRight = await widthAt(page, 'right');
  expect(Math.round(restoredRight)).toBe(Math.round(afterRight));

  // Dock still reaches the viewport-right edge, and its rendered width is at
  // least the user-chosen floor (1fr expands beyond the floor when surplus
  // remains).
  const dock = await dockBounds(page, '.wide-console-dock');
  expect(dock.right).toBeGreaterThanOrEqual(1600 - 24);
  expect(dock.width).toBeGreaterThanOrEqual(restoredRight - 1);
});

test('wide-panes: collapsing the right dock centers the track group (symmetric gutters)', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await finalizeOneOperatorRun(page, 6006);

  const collapseRight = page.getByTestId('pane-collapse-right');
  await expect(collapseRight).toBeVisible();
  await collapseRight.click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-testid="wide-shell"]').dataset.paneRight))
    .toBe('collapsed');

  const telemetry = await dockBounds(page, '.wide-telemetry-dock');
  const dock = await dockBounds(page, '.wide-console-dock');
  expect(telemetry).not.toBeNull();
  expect(dock).not.toBeNull();
  // With no 1fr in play (collapsed right → 96px rail), justify-content: center
  // on the shell distributes free space evenly to either side of the track
  // group. The left gutter (telemetry's left edge from viewport-left) equals
  // the right gutter (viewport-right from dock's right edge).
  const leftGutter = telemetry.left;
  const rightGutter = 1600 - dock.right;
  expect(leftGutter).toBeGreaterThan(0);
  expect(Math.abs(leftGutter - rightGutter)).toBeLessThanOrEqual(2);
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
