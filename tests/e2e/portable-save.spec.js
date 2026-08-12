import { expect, test } from '@playwright/test';
import { createGameHarness, queueSingleDeathEcho, roundTripRunState, canonicalRun, startStandardCombat } from '../helpers/game-fixture.js';
import { decodeRun } from '../../src/state/save-decode.js';
import { encodeSeed } from '../../src/state/save-encode.js';

const QUIET_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

function stripVolatile(run) {
  const copy = JSON.parse(JSON.stringify(run));
  for (const entry of copy.recentEvents || []) delete entry.timestamp;
  return copy;
}

function portableFixture() {
  const harness = createGameHarness({ seed: 60013, partySize: 2, depth: 3 });
  harness.runState.party[0].currentHP = Math.max(1, harness.runState.party[0].currentHP - 3);
  harness.runState.party[0].currentCHARGE = Math.max(0, harness.runState.party[0].currentCHARGE - 2);
  harness.runState.party[0].conditions = [{ conditionId: 'jammed', duration: 2, stacks: 1 }];
  harness.runState.corruption = 0.17;
  harness.runState.scrapCounter = 9;
  harness.runState.markCellVisited(1, 1);
  harness.runState.markCellVisited(2, 1);
  harness.runState.markContainerOpened(1);
  harness.runState.markEnemyDefeated(1);
  harness.runState.inventory.push({ id: 'junk_sidearm', category: 'weapon', baseType: 'sidearm', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: true });
  queueSingleDeathEcho(harness);
  startStandardCombat(harness, {
    enemyHP: 20,
    partyOverrides: [{ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }]
  });
  const partyTurn = harness.runState.activeCombat?.initiativeOrder?.findIndex((id) => String(id).startsWith('operator_'));
  if (partyTurn >= 0) harness.runState.activeCombat.currentIndex = partyTurn;
  const { encoded, decoded } = roundTripRunState(harness.runState);
  return { fragment: encoded.fragment, length: encoded.length, expected: canonicalRun(decoded) };
}

function futureFixture() {
  const harness = createGameHarness({ seed: 60137, partySize: 1, depth: 2 });
  harness.runState.party[0].currentHP = Math.max(1, harness.runState.party[0].currentHP - 2);
  harness.runState.inventory.push({ id: 'spare_patch', category: 'consumable', baseType: 'repair_patch', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false });
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

async function importFragment(page, fragment) {
  await installStorage(page);
  await page.goto(`/?run=${fragment.slice(0, 8)}#r=${fragment}`);
  await expect(page.getByTestId('import-run-summary')).toContainText('ACTIVE COMBAT SNAPSHOT');
  await page.getByTestId('import-resume').click();
  await expect(page.getByTestId('combat-canvas')).toBeVisible();
}

async function copiedRun(page) {
  await page.getByTestId('console-tab-log').click();
  await page.getByTestId('log-copy-link').click();
  const link = await page.getByTestId('log-link-text').inputValue();
  const fragment = new URL(link).hash.slice(3);
  const decoded = decodeRun(fragment);
  expect(decoded.success).toBe(true);
  expect(fragment.length).toBeLessThan(1500);
  return { fragment, canonical: canonicalRun(decoded.runState) };
}

async function executeAttack(page) {
  await page.getByTestId('console-tab-combat').click();
  await page.getByTestId('combat-action-attack').click();
  await page.locator('[data-testid^="combat-target-"]').first().click();
  await page.getByTestId('combat-confirm').click();
  await expect(page.locator('.status-ap')).toContainText(/AP [01]/);
}

test('full-state links import into isolated contexts and keep deterministic future actions', async ({ browser, baseURL }) => {
  const fixture = portableFixture();
  expect(fixture.length).toBeLessThan(1500);

  const firstContext = await browser.newContext({ baseURL });
  const secondContext = await browser.newContext({ baseURL });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await importFragment(first, fixture.fragment);
    await importFragment(second, fixture.fragment);

    const firstInitial = await copiedRun(first);
    const secondInitial = await copiedRun(second);
    expect(firstInitial.canonical).toEqual(fixture.expected);
    expect(secondInitial.canonical).toEqual(fixture.expected);
    expect(firstInitial.fragment).toBe(secondInitial.fragment);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }

  const futureFragment = futureFixture();
  const futureAContext = await browser.newContext({ baseURL });
  const futureBContext = await browser.newContext({ baseURL });
  const futureA = await futureAContext.newPage();
  const futureB = await futureBContext.newPage();
  try {
    await importFragment(futureA, futureFragment);
    await importFragment(futureB, futureFragment);
    await executeAttack(futureA);
    await executeAttack(futureB);
    const firstFuture = await copiedRun(futureA);
    const secondFuture = await copiedRun(futureB);
    expect(stripVolatile(firstFuture.canonical)).toEqual(stripVolatile(secondFuture.canonical));
  } finally {
    await futureAContext.close();
    await futureBContext.close();
  }
});

test('world-share links open creation with no carried run state', async ({ page }) => {
  await installStorage(page);
  const seed = 60013;
  await page.goto(`/#w=${encodeSeed(seed)}`);
  await expect(page.getByTestId('add-character')).toBeVisible();
  await expect(page.getByTestId('seed')).toContainText(String(seed));
  await expect(page.getByTestId('exploration-canvas')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('od_run_')))).toEqual([]);
});
