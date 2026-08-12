import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState, startStandardCombat } from '../helpers/game-fixture.js';

const QUIET_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

function activeDepthTwoFragment() {
  const harness = createGameHarness({ seed: 91357, partySize: 1, depth: 2 });
  startStandardCombat(harness, {
    enemyHP: 12,
    partyOverrides: [{ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }]
  });
  const partyTurn = harness.runState.activeCombat?.initiativeOrder?.findIndex((id) => String(id).startsWith('operator_'));
  if (partyTurn >= 0) harness.runState.activeCombat.currentIndex = partyTurn;
  return roundTripRunState(harness.runState).encoded.fragment;
}

async function installStorage(page) {
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, QUIET_SETTINGS);
}

async function waitForCache(page) {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return false;
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    return keys.some((key) => key.startsWith('operator-descent-'));
  }, null, { timeout: 15000 });
}

test('first offline load fails, then cached activated load resumes and plays offline', async ({ browser, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline service-worker acceptance runs in Chromium');

  const coldContext = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
  const coldPage = await coldContext.newPage();
  let firstOfflineFailed = false;
  await coldContext.setOffline(true);
  try {
    await coldPage.goto('/', { waitUntil: 'domcontentloaded', timeout: 5000 });
  } catch {
    firstOfflineFailed = true;
  }
  expect(firstOfflineFailed).toBe(true);
  await coldContext.close();

  const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
  const page = await context.newPage();
  try {
    await installStorage(page);
    await page.goto('/');
    await page.getByTestId('title-start').click();
    await expect(page.getByTestId('title-import-link')).toBeVisible();
    await waitForCache(page);

    const fragment = activeDepthTwoFragment();
    await context.setOffline(true);
    await page.goto(`/?offline=1#r=${fragment}`);
    await expect(page.getByTestId('import-run-summary')).toContainText('DEPTH 2');
    await page.getByTestId('import-resume').click();
    await expect(page.getByTestId('combat-canvas')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /D2/ })).toBeVisible();

    for (const mode of ['combat', 'party', 'gear', 'tech', 'log']) {
      await page.getByTestId(`console-tab-${mode}`).click();
      await expect(page.getByTestId(`console-tab-${mode}`)).toHaveAttribute('aria-selected', 'true');
    }
    await page.getByTestId('console-tab-combat').click();
    await page.getByTestId('combat-action-attack').click();
    await page.locator('[data-testid^="combat-target-"]').first().click();
    await page.getByTestId('combat-confirm').click();
    await expect(page.locator('.status-ap')).toContainText(/AP [01]/);

    await page.getByTestId('console-tab-log').click();
    await page.getByTestId('log-copy-link').click();
    await expect(page.getByTestId('log-link-text')).toHaveValue(/#r=/);
    expect(await page.evaluate(() => {
      const family = getComputedStyle(document.querySelector('.creature-sigil')).fontFamily;
      return document.fonts.check(`34px ${family}`, '\uE000');
    })).toBe(true);
    expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('od_run_')))).toBe(true);
  } finally {
    await context.close();
  }
});
