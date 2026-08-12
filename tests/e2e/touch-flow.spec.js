import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState, startStandardCombat } from '../helpers/game-fixture.js';

const REDUCED_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

test.skip(({ isMobile }) => !isMobile, 'touch acceptance runs in the mobile touch project');

async function installStableStorage(page) {
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, REDUCED_SETTINGS);
}

async function createRunByTouch(page, seed = 2) {
  await page.goto(`/?seed=${seed}#w=${seed}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
  await page.getByTestId('add-character').tap();
  await page.getByTestId('class-breacher').tap();
  await page.getByTestId('tab-sigil').tap();
  await page.getByTestId('sigil-e000').tap();
  await page.getByTestId('finalize').tap();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
}

function activeCombatFragment() {
  const harness = createGameHarness({ seed: 31, partySize: 1 });
  startStandardCombat(harness, {
    enemyHP: 20,
    partyOverrides: [{ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }]
  });
  return roundTripRunState(harness.runState).encoded.fragment;
}

test('touch journey mirrors movement controls and never treats canvas as input', async ({ page }) => {
  await installStableStorage(page);
  await createRunByTouch(page);

  await page.getByTestId('console-tab-move').tap();
  await expect(page.locator('.console-bar')).toHaveClass(/expanded/);

  const visibleRows = page.locator('.console-row:visible, .mode-tab:visible');
  const heights = await visibleRows.evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(96);

  await page.getByTestId('move-s').tap();
  await expect(page.getByTestId('move-notice')).toContainText(/MOVED TO|CONTAINER|DESCENT|HOSTILE|DAMAGE|BLOCKED/);
  const noticeAfterMove = await page.getByTestId('move-notice').textContent();
  const clockAfterMove = await page.locator('.status-clock').textContent();

  await page.getByTestId('console-tab-move').tap();
  await expect(page.locator('.console-bar')).toHaveClass(/collapsed/);
  const canvasBox = await page.getByTestId('exploration-canvas').boundingBox();
  expect(canvasBox).toBeTruthy();
  await page.touchscreen.tap(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height * 0.2);
  await expect(page.getByTestId('move-notice')).toHaveText(noticeAfterMove ?? '');
  await expect(page.locator('.status-clock')).toHaveText(clockAfterMove ?? '');

  for (const mode of ['party', 'gear', 'tech', 'log', 'move']) {
    await page.getByTestId(`console-tab-${mode}`).tap();
    await expect(page.getByTestId(`console-tab-${mode}`)).toHaveAttribute('aria-selected', 'true');
  }
});

test('touch combat selects a target first and requires explicit confirm', async ({ page }) => {
  await installStableStorage(page);
  const fragment = activeCombatFragment();
  await page.goto(`/?run=${fragment.slice(0, 8)}#r=${fragment}`);
  await expect(page.getByTestId('import-run-summary')).toContainText('ACTIVE COMBAT SNAPSHOT');
  await page.getByTestId('import-resume').tap();
  await expect(page.getByTestId('combat-canvas')).toBeVisible();

  await page.getByTestId('console-tab-combat').tap();
  await page.getByTestId('combat-action-attack').tap();
  await expect(page.getByTestId('combat-targets')).toBeVisible();
  await expect(page.getByTestId('combat-confirm')).toHaveCount(0);

  await page.locator('[data-testid^="combat-target-"]').first().tap();
  await expect(page.getByTestId('combat-confirm')).toBeVisible();
  await expect(page.locator('.status-ap')).toHaveText('AP 2');
  await expect(page.locator('button[data-glitch], [role="button"][data-glitch], [data-decision-pending="true"][data-glitch]')).toHaveCount(0);

  await page.getByTestId('combat-confirm').tap();
  await expect(page.locator('.status-ap')).toContainText(/AP [01]/);
});
