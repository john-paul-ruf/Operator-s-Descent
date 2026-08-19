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
    if (localStorage.getItem('od_settings')) return;
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, QUIET_SETTINGS);
}

async function currentHash(page) {
  return await page.evaluate(() => window.location.hash);
}

async function reachTitle(page) {
  await installStorage(page);
  await page.goto('/');
  await expect(page.getByTestId('title-start')).toBeVisible();
}

async function beginRun(page, seed = 60013) {
  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('title-branches')).toBeVisible();
  await page.goto(`/#w=${await page.evaluate((s) => {
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
  }, seed)}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
  await page.getByTestId('add-character').click();
  await page.getByTestId(/^(wide-class-breacher|class-breacher)$/).first().click();
  const sigilTab = page.getByTestId('tab-sigil');
  if (await sigilTab.count()) await sigilTab.click();
  await page.getByTestId(/^(wide-sigil-e000|sigil-e000)$/).first().click();
  await page.getByTestId('finalize').click();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

test.describe('navigation history', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-portrait', 'navigation-history covered by chromium-portrait');
  });

  // the-manual SESSION-07 — the tutorial branch is retired. The MANUAL button
  // opens a blocking modal that is NOT a route: opening/closing it must NOT
  // push a history entry, so the back-stack behaviour becomes "title → title"
  // with no navigation in between. Deep-link `#a=tutorial` back-compat lives
  // in the separate test below.
  test('title → open manual modal → close → still at title, no history push', async ({ page }) => {
    await reachTitle(page);
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('title-branches')).toBeVisible();
    const hashBeforeOpen = await currentHash(page);

    await page.getByTestId('title-manual').click();
    await expect(page.getByTestId('manual-modal')).toBeVisible();
    // Modal open must NOT change the fragment.
    expect(await currentHash(page)).toBe(hashBeforeOpen);

    await page.getByTestId('manual-close').click();
    await expect(page.getByTestId('manual-modal')).toBeHidden();
    // Modal close must NOT change the fragment either.
    expect(await currentHash(page)).toBe(hashBeforeOpen);
    // Title still mounted.
    await expect(page.getByTestId('title-start')).toBeVisible();
  });

  test('#a=tutorial back-compat: deep link mounts title AND opens the modal', async ({ page }) => {
    await installStorage(page);
    await page.goto('/#a=tutorial');
    await expect(page.getByTestId('manual-modal')).toBeVisible();
    await page.getByTestId('manual-close').click();
    // With the modal closed the reader lands on the title screen — the retired
    // tutorial route never mounts a screen of its own.
    await expect(page.getByTestId('title-start')).toBeVisible();
  });

  test('title → library → settings → back → library → back → title', async ({ page }) => {
    await reachTitle(page);
    await page.getByTestId('title-start').click();
    await page.getByTestId('title-run-library').click();
    await expect(page.getByTestId('library-list')).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe('#a=library');
    await page.goto('/#a=settings');
    await expect(page.getByTestId('settings-back')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('library-list')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('title-start')).toBeVisible();
  });

  test('exploration reload resumes autosaved run', async ({ page }) => {
    await reachTitle(page);
    await beginRun(page, 60013);
    const hashAfterStart = await currentHash(page);
    expect(hashAfterStart.startsWith('#a=exploration&save=current&seed=')).toBe(true);
    await page.reload();
    await expect(page.getByTestId('exploration-canvas')).toBeVisible();
    const hashAfterReload = await currentHash(page);
    expect(hashAfterReload).toBe(hashAfterStart);
  });

  test('cold #a=exploration&save=current with no library falls back to title', async ({ page }) => {
    await installStorage(page);
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.goto('/#a=exploration&save=current');
    await expect(page.getByTestId('title-start')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('cold #a=creation&seed=… enters creation with preloaded seed like #w=', async ({ page }) => {
    await installStorage(page);
    const seedBase32 = await page.evaluate((s) => {
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
    }, 60013);
    await page.goto(`/#a=creation&seed=${seedBase32}`);
    await expect(page.getByTestId('add-character')).toBeVisible();
    await expect(page.getByTestId('seed')).toContainText('60013');
  });

  test('paste-navigation triggers a hashchange mount', async ({ page }) => {
    await reachTitle(page);
    await page.evaluate(() => { window.location.hash = '#a=settings'; });
    await expect(page.getByTestId('settings-back')).toBeVisible();
  });
});
