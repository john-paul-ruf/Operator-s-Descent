import { expect, test } from '@playwright/test';

const REDUCED_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  // Scanline + grain kept enabled so CRT layer geometry can be asserted; runtime pauses
  // per-frame animation independently when reducedMotion === 'reduce'.
  scanlineGrainEnabled: true
};

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!/^chromium-wide-/.test(testInfo.project.name), 'adaptive-layout battery runs in the wide viewport projects only');
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, REDUCED_SETTINGS);
});

async function gotoTitle(page) {
  await page.goto('/');
  await expect(page.getByTestId('title-start')).toBeVisible();
}

async function openBranchesFromTitle(page) {
  await gotoTitle(page);
  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('title-begin-new-run')).toBeVisible();
}

async function finalizeOneOperatorRun(page, seed = 2026) {
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. Class selection — data-layout switches on the (900px ∧ 1:1) boundary
// ─────────────────────────────────────────────────────────────────────────────
test('data-layout resolves to wide at each wide viewport and portrait when boundary breaks', async ({ page }) => {
  await gotoTitle(page);
  expect(await page.evaluate(() => document.documentElement.dataset.layout)).toBe('wide');

  // Portrait cases — width < 900 OR aspect < 1
  const portraitCases = [
    { width: 450, height: 800, why: 'width < 900' },
    { width: 899, height: 1000, why: 'width 899 < 900' },
    { width: 1000, height: 1200, why: 'aspect 0.83 < 1' }
  ];
  for (const c of portraitCases) {
    await page.setViewportSize({ width: c.width, height: c.height });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.layout))
      .toBe('portrait');
  }

  // Wide again — width ≥ 900 AND aspect ≥ 1
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.layout))
    .toBe('wide');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Game shell — three-region grid on exploration
// ─────────────────────────────────────────────────────────────────────────────
test('exploration wide shell: three regions with canonical grid columns', async ({ page }) => {
  await finalizeOneOperatorRun(page, 5150);
  const shell = page.getByTestId('wide-shell');
  await expect(shell).toBeVisible();

  // Three regions present: telemetry dock, playfield column, console dock.
  await expect(page.getByTestId('telemetry-dock')).toBeVisible();
  await expect(page.locator('.wide-playfield-column')).toBeVisible();
  await expect(page.locator('.wide-console-dock')).toBeVisible();

  // Canonical grid columns from styles/wide.css (values resolved as "Npx Npx Npx").
  const cols = await shell.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  const parts = cols.trim().split(/\s+/);
  expect(parts).toHaveLength(3);
  const [left, mid, right] = parts.map(parseFloat);
  const vh = await page.evaluate(() => window.innerHeight);
  const vw = await page.evaluate(() => window.innerWidth);
  // Middle track absorbs surplus (map-pan-zoom 2026-08-17): mid ≈ vw − left − right (±1px)
  // and mid ≥ 320 per the minmax() floor.
  expect(mid).toBeGreaterThanOrEqual(320);
  expect(Math.abs(mid - (vw - left - right))).toBeLessThanOrEqual(1);
  // Left ≥ 280, right ≥ 360 per the minmax() / max() floors.
  expect(left).toBeGreaterThanOrEqual(279);
  expect(right).toBeGreaterThanOrEqual(359);

  // Playfield column height ≈ viewport height.
  const box = await shell.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(vh - 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Console dock — vertical rail, always expanded, disabled conventions,
//    touch floor, keyboard hotkeys, no dim layer.
// ─────────────────────────────────────────────────────────────────────────────
test('console dock: 7 vertical tabs, always expanded, no dim layer, keyboard 1–7 switches modes', async ({ page }) => {
  await finalizeOneOperatorRun(page, 5151);

  const tabs = page.locator('.wide-mode-tab');
  await expect(tabs).toHaveCount(7);

  // Stacked vertically → all share the same x, and y strictly ascending.
  const boxes = await tabs.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  const xs = boxes.map((b) => Math.round(b.x));
  expect(new Set(xs).size).toBe(1);
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);

  // Dim layer never renders in the dock variant.
  await expect(page.locator('.console-dim-layer')).toHaveCount(0);

  // Always expanded: content body visible and aria-hidden false.
  const contentBody = page.locator('.wide-console-content-body');
  await expect(contentBody).toBeVisible();
  await expect(contentBody).toHaveAttribute('aria-hidden', 'false');

  // CMBT disabled during exploration; LOOT disabled without a container.
  await expect(page.getByTestId('console-tab-combat')).toBeDisabled();
  await expect(page.getByTestId('console-tab-loot')).toBeDisabled();

  // Clicking the active MOVE tab does NOT collapse the dock.
  await page.getByTestId('console-tab-move').click();
  await expect(contentBody).toBeVisible();
  await expect(contentBody).toHaveAttribute('aria-hidden', 'false');

  // Keyboard hotkeys 1..7 switch modes (skip 1=MOVE first — start elsewhere).
  await page.locator('.screen-container').focus();
  await page.keyboard.press('Digit3');
  await expect(page.getByTestId('console-tab-party')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Digit4');
  await expect(page.getByTestId('console-tab-gear')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Digit5');
  await expect(page.getByTestId('console-tab-tech')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Digit7');
  await expect(page.getByTestId('console-tab-log')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Digit1');
  await expect(page.getByTestId('console-tab-move')).toHaveAttribute('aria-selected', 'true');
});

test('console dock: touch floor ≥ 96px per tab at the 1024×1024 touch project', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-wide-square', 'touch floor honored at the tablet-landscape project');
  await finalizeOneOperatorRun(page, 5152);
  const heights = await page.locator('.wide-mode-tab').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(96);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Telemetry dock — stacked fields, numeric clock, live feed appends
// ─────────────────────────────────────────────────────────────────────────────
test('telemetry dock: stacked status fields with numeric clock and live event feed', async ({ page }) => {
  await finalizeOneOperatorRun(page, 5153);

  const dock = page.getByTestId('telemetry-dock');
  await expect(dock).toBeVisible();

  // Danger clock renders as numeric "0.00"-style text.
  const clockText = await page.getByTestId('telemetry-clock').textContent();
  expect(clockText?.trim()).toMatch(/^\d+\.\d{2}$/);

  // Live log feed is present and the LOG mode remains reachable.
  const feed = page.getByTestId('telemetry-log-feed');
  await expect(feed).toBeVisible();

  // Dispatch a real log entry through the runtime bus and confirm it appends live.
  await page.evaluate(async () => {
    const mod = await import('/src/state/bus.js');
    mod.bus.dispatch('ui:log-entry', {
      type: 'combat',
      message: 'TEST HIT',
      entry: {},
      sequence: 999,
      turn: 3,
      timestamp: 1
    });
  });

  const feedEntry = feed.locator('.log-entry').first();
  await expect(feedEntry).toBeAttached();
  const stampText = await feedEntry.locator('.log-turn').textContent();
  expect(stampText?.trim()).toMatch(/^\[(T|E):\d{3}\]$/);
  // LOG mode remains reachable with a copy-link surface.
  await page.getByTestId('console-tab-log').click();
  await expect(page.getByTestId('log-copy-link')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Live switch — wide↔portrait↔wide without page reload, run state persists
// ─────────────────────────────────────────────────────────────────────────────
test('live layout switch re-mounts route without page reload', async ({ page }) => {
  await finalizeOneOperatorRun(page, 5154);
  await expect(page.locator('.wide-shell')).toBeVisible();

  await page.evaluate(() => { window.__persistenceMarker = 'alive'; });

  // wide → portrait
  await page.setViewportSize({ width: 480, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.layout))
    .toBe('portrait');
  await expect(page.locator('.wide-shell')).toHaveCount(0);
  await expect(page.locator('.console-bar')).toBeVisible();

  // portrait → wide
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.layout))
    .toBe('wide');
  await expect(page.locator('.wide-shell')).toBeVisible();
  await expect(page.locator('.console-bar')).toHaveCount(0);

  // No reload → window-scope marker survives.
  expect(await page.evaluate(() => window.__persistenceMarker)).toBe('alive');
  // Run state intact — exploration canvas still mounted.
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Flow screens — title, library, settings, manual modal, import, creation, scorecard
// ─────────────────────────────────────────────────────────────────────────────
test('title screen wide: centered lockup, tagline, branch list with primary + secondary rows', async ({ page }) => {
  await openBranchesFromTitle(page);
  await expect(page.locator('.wide-title-screen')).toBeVisible();
  await expect(page.getByTestId('title-tagline')).toHaveText('DEPTH IS THE SCORE');
  await expect(page.getByTestId('title-branches')).toBeVisible();
  await expect(page.getByTestId('title-begin-new-run')).toBeVisible();
  await expect(page.getByTestId('title-run-library')).toBeVisible();
  await expect(page.getByTestId('title-import-link')).toBeVisible();
  const secondary = page.getByTestId('title-secondary-branches');
  await expect(secondary).toBeVisible();
  // the-manual SESSION-04 — MANUAL replaces the retired TUTORIAL branch.
  await expect(secondary.locator('[data-testid="title-manual"]')).toBeVisible();
  await expect(secondary.locator('[data-testid="title-settings"]')).toBeVisible();
});

test('library screen wide: grid shell renders after a run is saved', async ({ page }) => {
  await finalizeOneOperatorRun(page, 6161);
  // Navigate to library via the runtime bus (avoids exiting the run flow).
  await page.evaluate(async () => {
    const mod = await import('/src/state/bus.js');
    mod.bus.dispatch('ui:navigate', { screen: 'library', params: {} });
  });

  await expect(page.locator('.wide-library-shell')).toBeVisible();
  const grid = page.getByTestId('library-grid');
  await expect(grid).toBeVisible();
  // Grid resolves grid-template-columns to one or more track sizes (auto-fill minmax(320px, 1fr)).
  const columnCount = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
  expect(columnCount).toBeGreaterThanOrEqual(1);

  const row = page.locator('[data-testid^="run-row-"]').first();
  await expect(row).toBeVisible();
  await expect(row.locator('[data-testid^="run-resume-"]')).toBeVisible();
  const del = row.locator('[data-testid^="run-delete-"]');
  await expect(del).toBeVisible();
  await expect(del).toHaveClass(/btn-danger/);
});

test('settings screen wide: two columns with 96px row floor and back returns to title', async ({ page }, testInfo) => {
  await openBranchesFromTitle(page);
  await page.getByTestId('title-settings').click();

  await expect(page.locator('.wide-settings-shell')).toBeVisible();
  await expect(page.getByTestId('settings-audio-column')).toBeVisible();
  await expect(page.getByTestId('settings-visual-column')).toBeVisible();

  if (testInfo.project.name === 'chromium-wide-square') {
    // SESSION-06 — extend the touch-floor guard with layout assertions so the
    // wide settings dock at 1024×1024 (a) hits 96px on every touch-capable row
    // container, (b) contains every row and its interactive children inside
    // the column/viewport, (c) never overlaps a slider's label / range input /
    // value rectangles, and (d) never overlaps consecutive rows. Screenshot
    // attaches for the handoff.
    const rows = page.locator('.wide-settings-body .toggle-row, .wide-settings-body .slider-row, .wide-settings-body .motion-options');
    const heights = await rows.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(96);

    // Every row's rect stays inside its column rect AND inside the viewport.
    const viewport = page.viewportSize();
    const columnRects = await page.locator('.wide-settings-column').evaluateAll(
      (els) => els.map((el) => el.getBoundingClientRect().toJSON())
    );
    expect(columnRects.length).toBeGreaterThanOrEqual(2);
    const rowInfo = await rows.evaluateAll((els) => els.map((el) => {
      const rect = el.getBoundingClientRect();
      const columnEl = el.closest('.wide-settings-column');
      const columnRect = columnEl ? columnEl.getBoundingClientRect() : null;
      return {
        rect: rect.toJSON(),
        columnRect: columnRect ? columnRect.toJSON() : null
      };
    }));
    for (const info of rowInfo) {
      expect(info.columnRect).not.toBeNull();
      expect(info.rect.left).toBeGreaterThanOrEqual(info.columnRect.left - 1);
      expect(info.rect.right).toBeLessThanOrEqual(info.columnRect.right + 1);
      expect(info.rect.left).toBeGreaterThanOrEqual(0);
      expect(info.rect.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(info.rect.top).toBeGreaterThanOrEqual(0);
      expect(info.rect.bottom).toBeLessThanOrEqual(viewport.height + 1);
    }

    // For every slider row: label rect / range input rect / value rect must
    // not intersect each other (each has zero horizontal overlap after gap).
    const sliderChildRects = await page.locator('.wide-settings-body .slider-row').evaluateAll((rows) => rows.map((row) => {
      const label = row.querySelector('.slider-label')?.getBoundingClientRect().toJSON() || null;
      const input = row.querySelector('input[type="range"]')?.getBoundingClientRect().toJSON() || null;
      const value = row.querySelector('.slider-value')?.getBoundingClientRect().toJSON() || null;
      return { label, input, value };
    }));
    expect(sliderChildRects.length).toBeGreaterThan(0);
    const intersectsX = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1;
    for (const trio of sliderChildRects) {
      expect(trio.label).not.toBeNull();
      expect(trio.input).not.toBeNull();
      expect(trio.value).not.toBeNull();
      expect(intersectsX(trio.label, trio.input)).toBe(false);
      expect(intersectsX(trio.input, trio.value)).toBe(false);
      expect(intersectsX(trio.label, trio.value)).toBe(false);
    }

    // Consecutive row rects within the same column do not overlap vertically
    // (bottom of row N ≤ top of row N+1). Group by column, then compare.
    const rowRectsByColumn = new Map();
    for (const info of rowInfo) {
      const key = `${info.columnRect.left}:${info.columnRect.top}`;
      if (!rowRectsByColumn.has(key)) rowRectsByColumn.set(key, []);
      rowRectsByColumn.get(key).push(info.rect);
    }
    for (const rects of rowRectsByColumn.values()) {
      rects.sort((a, b) => a.top - b.top);
      for (let i = 1; i < rects.length; i++) {
        expect(rects[i - 1].bottom).toBeLessThanOrEqual(rects[i].top + 1);
      }
    }

    const shot = await page.locator('.wide-settings-shell').screenshot();
    await testInfo.attach('wide-settings-1024x1024.png', { body: shot, contentType: 'image/png' });
  }

  await page.getByTestId('settings-back').click();
  // Title screen renders START; branch list stays hidden until START is pressed.
  await expect(page.getByTestId('title-start')).toBeVisible();
  await expect(page.getByTestId('title-header')).toBeVisible();
});

// the-manual SESSION-04 — the tutorial screen is retired; MANUAL opens a
// blocking modal instead. Wide presentation of the modal is a two-pane grid
// (persistent TOC rail + scrollable content) rather than a two-page spread.
// SESSION-07 replaces the tutorial-spread test with modal presentation +
// live-layout-switch resilience.
test('manual modal wide: two-pane grid with a persistent TOC rail, survives layout switch', async ({ page }) => {
  await openBranchesFromTitle(page);
  await page.getByTestId('title-manual').click();

  await expect(page.getByTestId('manual-modal')).toBeVisible();
  await expect(page.getByTestId('manual-modal')).toHaveAttribute('role', 'dialog');
  await expect(page.getByTestId('manual-modal')).toHaveAttribute('aria-modal', 'true');
  // TOC rail is visible in wide.
  await expect(page.getByTestId('manual-toc')).toBeVisible();
  // Manual body resolves to a 2-track grid in wide layout.
  const columnCount = await page.locator('.manual-body').evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length
  );
  expect(columnCount).toBe(2);

  // Chapters are surfaced under the shipped SESSION-01 inventory (12+12+38=62).
  await expect(page.getByTestId('manual-chapter-interface')).toBeVisible();
  await expect(page.getByTestId('manual-chapter-systems')).toBeVisible();
  await expect(page.getByTestId('manual-chapter-glossary')).toBeVisible();

  // Live-switch to portrait — the modal survives the underlying layout re-mount
  // because it is a sibling of #app-root, not a child of the route container.
  await page.setViewportSize({ width: 480, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.layout))
    .toBe('portrait');
  await expect(page.getByTestId('manual-modal')).toBeVisible();
});

test('import screen wide: single centered column preserves reading posture', async ({ page }) => {
  await openBranchesFromTitle(page);
  await page.getByTestId('title-import-link').click();

  await expect(page.locator('.wide-import-shell')).toBeVisible();
  const column = page.getByTestId('import-column');
  await expect(column).toBeVisible();
  const width = await column.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(600);
  await expect(page.getByTestId('import-input')).toBeVisible();
  await expect(page.getByTestId('import-submit')).toBeVisible();
  await expect(page.getByTestId('import-return-title')).toBeVisible();
});

test('creation screen wide: two-pane roster/editor shell reachable from the title', async ({ page }) => {
  await openBranchesFromTitle(page);
  await page.getByTestId('title-begin-new-run').click();

  await expect(page.locator('.wide-creation-shell')).toBeVisible();
  await expect(page.getByTestId('wide-creation-left')).toBeVisible();
  await expect(page.getByTestId('wide-creation-right')).toBeVisible();
  await expect(page.getByTestId('wide-editor')).toBeVisible();
  await expect(page.getByTestId('add-character')).toBeVisible();
  await expect(page.getByTestId('remaining')).toBeVisible();
  await expect(page.getByTestId('credits')).toBeVisible();
  await expect(page.getByTestId('ap')).toBeVisible();

  // Choose class + sigil, then verify finalize is reachable from the footer.
  await page.getByTestId('add-character').click();
  await page.getByTestId('wide-class-breacher').click();
  await page.getByTestId('wide-sigil-e000').click();
  await expect(page.getByTestId('finalize')).toBeEnabled();
  const footer = page.getByTestId('wide-creation-footer');
  await expect(footer).toBeVisible();
  const finalize = footer.getByTestId('finalize');
  await expect(finalize).toBeVisible();
});

test('scorecard screen wide: two-pane summary and share layout render on navigate', async ({ page }) => {
  await gotoTitle(page);
  await page.evaluate(() => {
    const bus = { dispatch: (name, payload) => window.dispatchEvent(new CustomEvent(name, { detail: payload })) };
    // The runtime already listens on its bus; drive navigation through its imported bus module.
  });
  // Force a scorecard mount by triggering the runtime's ui:navigate via the actual bus module.
  await page.evaluate(async () => {
    const mod = await import('/src/state/bus.js');
    mod.bus.dispatch('ui:navigate', {
      screen: 'scorecard',
      params: {
        runState: { worldSeed: 42, depth: 3, party: [{ classId: 'breacher', currentHP: 0, maxHP: 10, sigilCodepoint: 0xE000 }] },
        seed: 42,
        depth: 3,
        party: [{ classId: 'breacher', currentHP: 0, maxHP: 10, sigilCodepoint: 0xE000 }],
        causeOfDeath: 'Test Wipe'
      }
    });
  });

  await expect(page.locator('.wide-scorecard-shell')).toBeVisible();
  await expect(page.getByTestId('scorecard-summary-pane')).toBeVisible();
  await expect(page.getByTestId('scorecard-share-pane')).toBeVisible();
  await expect(page.getByTestId('scorecard-depth')).toContainText('3');
  await expect(page.getByTestId('scorecard-cause')).toContainText('Test Wipe');
  await expect(page.getByTestId('scorecard-seed')).toContainText('42');
  await expect(page.getByTestId('scorecard-share-link')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Full-viewport CRT — letterbox retired, scanlines span viewport in both classes
// ─────────────────────────────────────────────────────────────────────────────
test('CRT scanlines span the viewport in wide and in a portrait-resized state', async ({ page }) => {
  await gotoTitle(page);

  async function assertScanlinesFillViewport() {
    // CRT overlays load via a deferred import — wait for the layer div to be attached.
    const scan = page.locator('.crt-scanlines').first();
    await expect(scan).toBeAttached({ timeout: 10_000 });
    // Poll until the browser has laid it out at viewport size.
    await expect
      .poll(async () => {
        const rect = await scan.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        });
        const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
        return rect.w >= vp.w - 2 && rect.h >= vp.h - 2;
      }, { timeout: 5_000 })
      .toBe(true);
  }

  await assertScanlinesFillViewport();

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.layout))
    .toBe('portrait');
  await assertScanlinesFillViewport();

  await page.setViewportSize({ width: 450, height: 800 });
  await assertScanlinesFillViewport();
  // Frame occupies the full viewport width (no dead letterbox margins).
  const frame = await page.locator('#portrait-frame').boundingBox();
  expect(frame?.width).toBeGreaterThanOrEqual(448);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Input floors — 44px baseline in wide (pointer-only) plus 96px on touch
// ─────────────────────────────────────────────────────────────────────────────
test('pointer-only input floor: interactive controls ≥ 44px tall at wide desktop viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'chromium-wide-square', 'square variant is the touch-floor case');
  await openBranchesFromTitle(page);
  await page.getByTestId('title-settings').click();
  await expect(page.getByTestId('settings-back')).toBeVisible();

  const controls = page.locator('.wide-settings-shell').locator(
    '[data-testid="settings-back"], [data-testid="settings-master-mute"], [data-testid="settings-glitch"], [data-testid="settings-scanline-grain"], [data-testid^="settings-motion-"]'
  );
  await expect(controls.first()).toBeVisible();
  const heights = await controls.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(0);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});
