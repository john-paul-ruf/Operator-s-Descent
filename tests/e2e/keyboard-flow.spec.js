import { expect, test } from '@playwright/test';

const REDUCED_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

async function installStableStorage(page, { rejectClipboard = false } = {}) {
  await page.addInitScript(({ settings, rejectClipboard }) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
    if (rejectClipboard) {
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('clipboard blocked by test')) }
        });
      } catch {}
    }
  }, { settings: REDUCED_SETTINGS, rejectClipboard });
}

async function openCreationFromSeed(page, seed = 777) {
  await page.goto(`/?seed=${seed}#w=${seed}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
}

async function finalizeOneOperatorRun(page) {
  await page.getByTestId('add-character').click();
  await page.getByTestId('class-breacher').click();
  await page.getByTestId('tab-sigil').click();
  await page.getByTestId('sigil-e000').click();
  await page.getByTestId('finalize').click();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /CLK/ })).toBeVisible();
}

async function expectMode(page, mode) {
  await expect(page.getByTestId(`console-tab-${mode}`)).toHaveAttribute('aria-selected', 'true');
}

test('keyboard route and console journey covers modes, movement, copy fallback, and collapse focus', async ({ page }) => {
  await installStableStorage(page, { rejectClipboard: true });
  await openCreationFromSeed(page);
  await finalizeOneOperatorRun(page);
  await page.locator('.screen-container').focus();

  await page.keyboard.press('Digit3');
  await expectMode(page, 'party');
  await page.keyboard.press('Digit4');
  await expectMode(page, 'gear');
  await page.keyboard.press('Digit5');
  await expectMode(page, 'tech');
  await page.keyboard.press('Digit7');
  await expectMode(page, 'log');

  await page.getByTestId('console-tab-log').click();
  await expect(page.locator('.console-bar')).toHaveClass(/expanded/);
  await expect(page.locator('#console-content')).toBeFocused();

  await page.getByTestId('log-copy-link').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('log-link-text')).toHaveValue(/#r=/);
  await expect(page.getByTestId('log-notice')).toContainText(/LINK COPIED|CLIPBOARD UNAVAILABLE/);

  await page.keyboard.press('Escape');
  await expect(page.locator('.console-bar')).toHaveClass(/collapsed/);
  await page.getByTestId('console-tab-log').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.console-bar')).toHaveClass(/expanded/);
  await expect(page.locator('#console-content')).toBeFocused();

  await page.locator('.screen-container').focus();
  await page.keyboard.press('Digit1');
  await expectMode(page, 'move');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => {
    const notice = await page.getByTestId('move-notice').count() ? await page.getByTestId('move-notice').textContent() : '';
    const combat = await page.getByTestId('combat-canvas').count() ? 'COMBAT' : '';
    const clock = await page.locator('.status-clock').count() ? await page.locator('.status-clock').textContent() : '';
    return `${notice} ${combat} ${clock}`;
  }).toMatch(/MOVED TO|CONTAINER|DESCENT|HOSTILE|DAMAGE|BLOCKED|COMBAT|CLK 0\.(?!00)/);
});

test('keyboard can enter settings and return without a trap', async ({ page }) => {
  await installStableStorage(page);
  await page.goto('/');
  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('title-settings')).toBeVisible();

  await page.getByTestId('title-settings').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'SETTINGS' })).toBeVisible();
  await page.getByTestId('settings-motion-full').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('settings-status')).toContainText('SAVED');
  await page.getByTestId('settings-back').focus();
  await page.keyboard.press('Enter');
  // Single-state title (commit 30b7172): return lands collapsed; START is
  // focusable — no trap. Re-expand via START to reach the branch list.
  await expect(page.getByTestId('title-start')).toBeVisible();
  await page.getByTestId('title-start').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('title-begin-new-run')).toBeVisible();
});
