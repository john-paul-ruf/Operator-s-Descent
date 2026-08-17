import { expect, test } from '@playwright/test';

const QUIET_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

async function installStorage(page) {
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, QUIET_SETTINGS);
}

async function reachTitle(page) {
  await installStorage(page);
  await page.goto('/');
  await expect(page.getByTestId('title-start')).toBeVisible();
}

function seedFragment(page, seed) {
  return page.evaluate((s) => {
    const bytes = new Uint8Array(5);
    bytes[0] = 1;
    new DataView(bytes.buffer).setUint32(1, s, false);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
      out += alphabet[b1 >>> 2] + alphabet[((b1 & 3) << 4) | ((b2 ?? 0) >>> 4)];
      if (b2 !== undefined) out += alphabet[((b2 & 15) << 2) | ((b3 ?? 0) >>> 6)];
      if (b3 !== undefined) out += alphabet[b3 & 63];
    }
    return out;
  }, seed);
}

async function reachCreation(page, seed = 60013) {
  await reachTitle(page);
  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('title-branches')).toBeVisible();
  const b32 = await seedFragment(page, seed);
  await page.goto(`/#w=${b32}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
}

async function beginRun(page, seed = 60013) {
  await reachCreation(page, seed);
  await page.getByTestId('add-character').click();
  await page.getByTestId(/^(wide-class-breacher|class-breacher)$/).first().click();
  const sigilTab = page.getByTestId('tab-sigil');
  if (await sigilTab.count()) await sigilTab.click();
  await page.getByTestId(/^(wide-sigil-e000|sigil-e000)$/).first().click();
  await page.getByTestId('finalize').click();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

async function expandConsole(page) {
  const bar = page.locator('.console-bar');
  if (!(await bar.count())) return;
  const state = await bar.getAttribute('aria-expanded');
  if (state !== 'true') await page.getByTestId('console-tab-move').click();
  await expect(bar).toHaveAttribute('aria-expanded', 'true');
}

async function forceScrollable(page, selector, height = 240) {
  await page.addStyleTag({
    content: `${selector} { flex: none !important; height: ${height}px !important; max-height: ${height}px !important; overflow-y: auto !important; }`
  });
  await page.evaluate(({ sel }) => {
    const el = document.querySelector(sel);
    if (el) void el.offsetHeight;
  }, { sel: selector });
}

async function scrollTopOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.scrollTop : null;
  }, selector);
}

async function setScrollTop(page, selector, value) {
  await page.evaluate(({ sel, v }) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing element for ${sel}`);
    el.scrollTop = v;
  }, { sel: selector, v: value });
}

async function clickWithoutScroll(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing element for ${sel}`);
    el.click();
  }, selector);
}

async function waitTwoFrames(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(20);
}

async function clickAndSampleFrames(page, containerSelector, targetSelector, frames = 3) {
  return page.evaluate(async ({ containerSel, targetSel, count }) => {
    const container = document.querySelector(containerSel);
    const target = document.querySelector(targetSel);
    if (!container) throw new Error(`missing container for ${containerSel}`);
    if (!target) throw new Error(`missing target for ${targetSel}`);
    target.click();
    const samples = [container.scrollTop];
    for (let i = 0; i < count; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      samples.push(container.scrollTop);
    }
    return samples;
  }, { containerSel: containerSelector, targetSel: targetSelector, count: frames });
}

test.describe('scroll memory', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-portrait', 'scroll-restore covered by chromium-portrait');
  });

  test('GEAR mode refresh preserves scroll position of the console content', async ({ page }) => {
    await reachTitle(page);
    await beginRun(page, 60013);
    await expandConsole(page);
    await page.getByTestId('console-tab-gear').click();
    await expect(page.getByTestId('gear-selectors')).toBeVisible();
    const scrollSelector = '.console-content.scroll-area';
    await forceScrollable(page, scrollSelector, 200);
    await setScrollTop(page, scrollSelector, 120);
    const before = await scrollTopOf(page, scrollSelector);
    expect(before).toBeGreaterThan(0);
    const samples = await clickAndSampleFrames(page, scrollSelector, '[data-testid="gear-slot-armor"]', 3);
    // No sampled frame — including the one right after the click's synchronous
    // re-render — should show a top-flash. Every sample must be at (or near)
    // the pre-click offset.
    for (const s of samples) expect(Math.abs(s - before)).toBeLessThanOrEqual(2);
    const after = samples[samples.length - 1];
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });

  test('mode switch GEAR → LOG → GEAR restores GEAR scroll position', async ({ page }) => {
    await reachTitle(page);
    await beginRun(page, 60013);
    await expandConsole(page);
    await page.getByTestId('console-tab-gear').click();
    await expect(page.getByTestId('gear-selectors')).toBeVisible();
    const scrollSelector = '.console-content.scroll-area';
    await forceScrollable(page, scrollSelector, 200);
    await setScrollTop(page, scrollSelector, 140);
    const gearBefore = await scrollTopOf(page, scrollSelector);
    expect(gearBefore).toBeGreaterThan(0);
    await clickWithoutScroll(page, '[data-testid="console-tab-log"]');
    await waitTwoFrames(page);
    await expect(page.locator('.console-content')).toHaveAttribute('data-mode', 'log');
    await clickWithoutScroll(page, '[data-testid="console-tab-gear"]');
    await waitTwoFrames(page);
    await expect(page.locator('.console-content')).toHaveAttribute('data-mode', 'gear');
    const gearAfter = await scrollTopOf(page, scrollSelector);
    expect(Math.abs(gearAfter - gearBefore)).toBeLessThanOrEqual(2);
  });

  test('creation editor pane preserves scroll across attribute stepper click', async ({ page }) => {
    await reachCreation(page, 60013);
    await page.getByTestId('add-character').click();
    await page.getByTestId(/^(wide-class-breacher|class-breacher)$/).first().click();
    const attrsTab = page.getByTestId('tab-attrs');
    const wideIncCount = await page.getByTestId('wide-attribute-mgt-inc').count();
    if (!wideIncCount) {
      await attrsTab.click();
      await expect(page.getByTestId('attribute-mgt')).toBeVisible();
    }
    const isWide = wideIncCount > 0;
    const scrollSelector = isWide ? '[data-testid="wide-editor"]' : '[data-testid="creation-body"]';
    await forceScrollable(page, scrollSelector, 300);
    await setScrollTop(page, scrollSelector, 160);
    const before = await scrollTopOf(page, scrollSelector);
    expect(before).toBeGreaterThan(0);
    const incSelector = isWide ? '[data-testid="wide-attribute-mgt-inc"]' : '[data-testid="attribute-mgt"] button[aria-label^="Increase"]';
    await clickWithoutScroll(page, incSelector);
    await waitTwoFrames(page);
    const after = await scrollTopOf(page, scrollSelector);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });

  test('library re-render preserves scroll position of the list', async ({ page }) => {
    await reachTitle(page);
    await beginRun(page, 60013);
    await page.evaluate(() => { window.location.hash = '#a=library'; });
    await expect(page.getByTestId('library-list')).toBeVisible();
    const scrollSelector = '[data-testid="library-list"]';
    await forceScrollable(page, scrollSelector, 100);
    await setScrollTop(page, scrollSelector, 40);
    const before = await scrollTopOf(page, scrollSelector);
    expect(before).toBeGreaterThan(0);
    const rowSelector = '[data-testid^="run-row-"]';
    await clickWithoutScroll(page, rowSelector);
    await waitTwoFrames(page);
    const after = await scrollTopOf(page, scrollSelector);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });
});
