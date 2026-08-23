import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState } from '../helpers/game-fixture.js';

const QUIET_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

function gearFixture() {
  const harness = createGameHarness({ seed: 70123, partySize: 1, depth: 2 });
  harness.runState.party[0].equipment.weapon = null;
  harness.runState.inventory.push({
    id: 'persistence-sidearm', category: 'weapon', baseType: 'sidearm',
    rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false
  });
  return roundTripRunState(harness.runState).encoded.fragment;
}

async function installStorage(page) {
  await page.addInitScript((settings) => {
    if (sessionStorage.getItem('gear-actions-persistence-ready')) return;
    sessionStorage.setItem('gear-actions-persistence-ready', 'true');
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, QUIET_SETTINGS);
}

async function openGear(page, fragment) {
  await installStorage(page);
  await page.goto(`/?run=${fragment.slice(0, 8)}#r=${fragment}`);
  await page.getByTestId('import-resume').click();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  await page.getByTestId('console-tab-gear').click();
}

test('GEAR equip is visible, palette-safe, autosaved, and restored after reload', async ({ page }) => {
  await openGear(page, gearFixture());
  const equip = page.getByTestId('gear-equip-persistence-sidearm');
  await equip.scrollIntoViewIfNeeded();
  await expect(equip).toBeVisible();
  await expect(equip).toHaveText('EQUIP');
  expect(await equip.evaluate((element) => getComputedStyle(element).color)).not.toBe('rgb(0, 0, 0)');

  const before = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => /^od_run_\d+_\d+$/.test(entry));
    return { key, record: key ? localStorage.getItem(key) : null };
  });
  expect(before.key).toBeTruthy();
  await equip.click();

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), before.key)).not.toBe(before.record);
  const index = await page.evaluate(() => JSON.parse(localStorage.getItem('od_runs') || '[]'));
  expect(index.some((entry) => `od_run_${entry.key}` === before.key)).toBe(true);

  await page.goto('/#a=exploration&save=current');
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  await page.getByTestId('console-tab-gear').click();
  await expect(page.getByTestId('gear-equipped-weapon')).toContainText('Sidearm');
});
