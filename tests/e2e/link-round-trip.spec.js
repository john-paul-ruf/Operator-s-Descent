import { expect, test } from '@playwright/test';
import { encodeSeed } from '../../src/state/save-encode.js';

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

async function encodedSeedString(page, seed) {
  return await page.evaluate((s) => {
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

async function beginRunViaSeed(page, seed) {
  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('title-branches')).toBeVisible();
  const encoded = await encodedSeedString(page, seed);
  await page.goto(`/#w=${encoded}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
  await page.getByTestId('add-character').click();
  await page.getByTestId(/^(wide-class-breacher|class-breacher)$/).first().click();
  const sigilTab = page.getByTestId('tab-sigil');
  if (await sigilTab.count()) await sigilTab.click();
  await page.getByTestId(/^(wide-sigil-e000|sigil-e000)$/).first().click();
  await page.getByTestId('finalize').click();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

test.describe('link round trip — export → load', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-portrait', 'link round trip covered by chromium-portrait');
    await installStorage(page);
    await page.goto('/');
    await expect(page.getByTestId('title-start')).toBeVisible();
  });

  test('full-run link produced by LOG imports back into the same run', async ({ page }) => {
    const seed = 60013;
    await beginRunViaSeed(page, seed);

    await page.getByTestId('console-tab-log').click();
    await page.getByTestId('log-copy-link').click();

    // The share link is rendered by the app whether or not clipboard.writeText
    // succeeds — read the rendered field rather than the OS clipboard so this
    // spec is stable across browsers/permission modes.
    const link = await page.getByTestId('log-link-text').inputValue();
    expect(link.length).toBeGreaterThan(0);
    const url = new URL(link);
    expect(url.hash.startsWith('#r=')).toBe(true);
    expect(url.hash.length - 3).toBeLessThan(1500);

    // Paste-navigate to the import screen (same mechanism the runtime uses
    // for hashchange mounts) and feed the app's own link back to itself.
    await page.evaluate(() => { window.location.hash = '#a=import'; });
    await expect(page.getByTestId('import-input')).toBeVisible();
    await page.getByTestId('import-input').fill(link);
    await page.getByTestId('import-submit').click();

    const summary = page.getByTestId('import-run-summary');
    await expect(summary).toContainText(`SEED ${seed}`);
    await expect(summary).toContainText('DEPTH 1');

    await page.getByTestId('import-resume').click();
    await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  });

  test('seed link built via encodeSeed lands in creation with the same seed', async ({ page, baseURL }) => {
    const seed = 5150;
    const encoded = encodeSeed(seed);
    // Same shape the scorecard renders: `${origin}${pathname}#w=${encodeSeed(seed)}`.
    const link = new URL(`#w=${encoded}`, baseURL).toString();

    await page.getByTestId('title-start').click();
    await page.getByTestId('title-import-link').click();
    await expect(page.getByTestId('import-input')).toBeVisible();
    await page.getByTestId('import-input').fill(link);
    await page.getByTestId('import-submit').click();

    await expect(page.getByTestId('add-character')).toBeVisible();
    await expect(page.getByTestId('seed')).toContainText(String(seed));
  });
});
