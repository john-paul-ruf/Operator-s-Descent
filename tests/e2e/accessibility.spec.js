import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState, startStandardCombat } from '../helpers/game-fixture.js';

const QUIET_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'system',
  scanlineGrainEnabled: false
};

async function installStableStorage(page, settings = QUIET_SETTINGS) {
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, settings);
}

async function createExploration(page) {
  await page.goto('/?seed=5150#w=5150');
  await page.getByTestId('add-character').click();
  await page.getByTestId('class-breacher').click();
  await page.getByTestId('tab-sigil').click();
  await page.getByTestId('sigil-e000').click();
  await page.getByTestId('finalize').click();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

function activeCombatFragment() {
  const harness = createGameHarness({ seed: 41, partySize: 1 });
  startStandardCombat(harness, { enemyHP: 20 });
  return roundTripRunState(harness.runState).encoded.fragment;
}

test('native semantics, focus, status text, and no-playfield-input contracts hold in browser', async ({ page }) => {
  await installStableStorage(page);
  await page.goto('/');
  await expect(page.getByTestId('title-start')).toBeVisible();

  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('title-begin-new-run')).toBeVisible();
  await createExploration(page);

  await expect(page.locator('.status-strip')).toContainText(/CLK\d+\.\d{2}/);
  await expect(page.getByRole('img', { name: /Exploration map/ })).toBeVisible();
  await expect(page.getByTestId('exploration-canvas')).toHaveCSS('pointer-events', 'none');
  await expect(page.getByRole('tab', { name: 'MOVE' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'CMBT' })).toBeDisabled();

  await page.getByTestId('console-tab-move').focus();
  const outlineStyle = await page.getByTestId('console-tab-move').evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outlineStyle).not.toBe('none');
});

test('portrait frame keeps fixed ratio and centered letterbox without tab reordering', async ({ page }) => {
  await installStableStorage(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await createExploration(page);

  const frame = await page.locator('#portrait-frame').boundingBox();
  expect(frame).toBeTruthy();
  expect(Math.abs((frame.width / frame.height) - (1080 / 1920))).toBeLessThan(0.01);
  expect(Math.abs(frame.x - (1600 - frame.width) / 2)).toBeLessThan(2);

  const labels = await page.locator('.mode-tab').evaluateAll((tabs) => tabs.map((tab) => tab.textContent?.trim()));
  expect(labels).toEqual(['MOVE', 'CMBT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG']);
  await expect(page.locator('.console-bar')).toHaveCSS('bottom', '0px');
});

test('reduced-motion and manual overrides preserve text and protect pending decisions from glitch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installStableStorage(page, { ...QUIET_SETTINGS, glitchEnabled: true, reducedMotion: 'system' });
  await page.goto('/');
  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('title-settings')).toBeVisible();
  await page.getByTestId('title-settings').click();
  await expect(page.getByTestId('settings-motion-system')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('heading', { name: 'SETTINGS' })).toBeVisible();

  for (const option of ['reduce', 'full', 'system']) {
    await page.getByTestId(`settings-motion-${option}`).click();
    await expect(page.getByTestId('settings-status')).toContainText('SAVED');
    await expect(page.getByRole('heading', { name: 'SETTINGS' })).toBeVisible();
  }

  const fragment = activeCombatFragment();
  await page.goto(`/?run=${fragment.slice(0, 8)}#r=${fragment}`);
  await page.getByTestId('import-resume').click();
  await expect(page.getByTestId('combat-canvas')).toBeVisible();
  await page.getByTestId('console-tab-combat').click();
  await page.getByTestId('combat-action-attack').click();
  await page.locator('[data-testid^="combat-target-"]').first().click();
  await expect(page.getByTestId('combat-confirm')).toBeVisible();
  await expect(page.locator('button[data-glitch], input[data-glitch], textarea[data-glitch], [role="button"][data-glitch]')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /AP/ })).toBeVisible();
});
