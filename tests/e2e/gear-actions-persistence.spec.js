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
  harness.runState.party[0].equipment.armor = null;
  harness.runState.inventory.push({
    id: 'persistence-armor', category: 'armor', baseType: 'light',
    rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false
  });
  return roundTripRunState(harness.runState).encoded.fragment;
}

// gear-inventory-filters SESSION-01 — deterministic fixture covering the
// four filter predicates. The party's first class (breacher, per
// createLegalParty's round-robin) legally equips 'light' armor but not the
// 'sniper' weapon (ghost-only), so this proves both the positive and
// negative EQUIPPABLE cases without touching the character's own gear.
function gearFilterFixture() {
  const harness = createGameHarness({ seed: 70456, partySize: 1, depth: 2 });
  harness.runState.party[0].equipment.armor = null;
  harness.runState.inventory.push(
    { id: 'filter-legal-armor', category: 'armor', baseType: 'light', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false },
    { id: 'filter-illegal-sniper', category: 'weapon', baseType: 'sniper', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false },
    { id: 'filter-consumable', category: 'consumable', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false },
    { id: 'filter-tagged', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: true }
  );
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

async function assertVisiblePaletteSafeEquip(page) {
  const equip = page.getByTestId('gear-equip-persistence-armor');
  await equip.scrollIntoViewIfNeeded();
  await expect(equip).toBeVisible();
  await expect(equip).toHaveText('EQUIP');
  await expect(equip).toHaveAttribute('aria-label', 'EQUIP ARMOR');
  await expect(page.getByTestId('gear-slot-armor')).toHaveCount(0);
  expect(await equip.evaluate((element) => getComputedStyle(element).color)).not.toBe('rgb(0, 0, 0)');
  return equip;
}

test('GEAR equip is visible, palette-safe, autosaved, and restored after reload', async ({ page }) => {
  await openGear(page, gearFixture());
  const equip = await assertVisiblePaletteSafeEquip(page);

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
  await expect(page.getByTestId('gear-equipped-armor')).toContainText('Light Armor');
});

test('wide GEAR controls remain visible and palette-safe', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await openGear(page, gearFixture());
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'wide');
    await assertVisiblePaletteSafeEquip(page);

    // gear-inventory-filters SESSION-01 — the shared styles/components.css
    // filter row must serve the wide dock without any wide-only markup.
    const equippableFilter = page.getByTestId('gear-filter-equippable');
    await expect(equippableFilter).toBeVisible();
    await equippableFilter.click();
    await expect(equippableFilter).toHaveAttribute('aria-checked', 'true');
    expect(await equippableFilter.evaluate((element) => getComputedStyle(element).color)).not.toBe('rgb(0, 0, 0)');
  } finally {
    await context.close();
  }
});

test('GEAR inventory filters narrow the production console without touching persisted state', async ({ page }) => {
  await openGear(page, gearFilterFixture());

  const filterGroup = page.getByTestId('gear-inventory-filters');
  await expect(filterGroup).toBeVisible();
  await expect(page.getByTestId('gear-filter-all')).toHaveAttribute('aria-checked', 'true');
  for (const id of ['all', 'equippable', 'consumables', 'junk']) {
    await expect(page.getByTestId(`gear-filter-${id}`)).toHaveJSProperty('tagName', 'BUTTON');
  }

  const before = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => /^od_run_\d+_\d+$/.test(entry));
    return { key, record: key ? localStorage.getItem(key) : null };
  });
  expect(before.key).toBeTruthy();

  await page.getByTestId('gear-filter-equippable').click();
  await expect(page.getByTestId('gear-item-filter-legal-armor')).toBeVisible();
  await expect(page.getByTestId('gear-item-filter-illegal-sniper')).toHaveCount(0);
  await expect(page.getByTestId('gear-item-filter-consumable')).toHaveCount(0);

  await page.getByTestId('gear-filter-consumables').click();
  await expect(page.getByTestId('gear-item-filter-consumable')).toBeVisible();
  await expect(page.getByTestId('gear-item-filter-legal-armor')).toHaveCount(0);

  await page.getByTestId('gear-filter-junk').click();
  await expect(page.getByTestId('gear-item-filter-tagged')).toBeVisible();
  await expect(page.getByTestId('gear-item-filter-consumable')).toHaveCount(0);

  await page.getByTestId('gear-filter-all').click();
  for (const id of ['filter-legal-armor', 'filter-illegal-sniper', 'filter-consumable', 'filter-tagged']) {
    await expect(page.getByTestId(`gear-item-${id}`)).toBeVisible();
  }

  const after = await page.evaluate((key) => localStorage.getItem(key), before.key);
  expect(after).toBe(before.record);
});
