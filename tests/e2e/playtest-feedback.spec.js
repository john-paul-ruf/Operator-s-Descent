import { expect, test } from '@playwright/test';
import {
  createGameHarness,
  roundTripRunState,
  startStandardCombat,
  walkTo
} from '../helpers/game-fixture.js';
import { TECH_PROTOCOL_CASES, buildTechProtocolFixture } from '../helpers/tech-protocol-e2e-fixture.js';

// direct-actions-and-quick-starts SESSION-05 — final mobile regression story spanning the
// reported playtest friction points fixed across this feature: an editable quick-start party,
// self-evident loot pickup, a direct DESCEND control, and combat/TECH surfaces with no
// generic confirm step. Runs only in the mobile touch project — this is a touch acceptance
// story, matching the reported friction (small screens, scroll-buried CONFIRM controls).

test.skip(({ isMobile }) => !isMobile, 'mobile playtest acceptance runs in the phone touch project');

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

async function importRun(page, fragment) {
  await installStorage(page);
  await page.goto(`/?run=${fragment.slice(0, 8)}#r=${fragment}`);
  await expect(page.getByTestId('import-run-summary')).toBeVisible();
  await page.getByTestId('import-resume').tap();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Quick start: BREACH DRILL loads an editable draft and continues through
//    the ordinary creation path (direct-actions-and-quick-starts SESSION-01).
// ─────────────────────────────────────────────────────────────────────────────
test('a new player chooses BREACH DRILL, sees the editable Breacher/polearm/heavy-armor/Surge draft, and continues through the ordinary creation path', async ({ page }) => {
  await installStorage(page);
  await page.goto('/?seed=5#w=5');
  await expect(page.getByTestId('quick-start-breach-drill')).toBeVisible();
  await page.getByTestId('quick-start-breach-drill').tap();

  await expect(page.getByTestId('character-slot-0')).toHaveClass(/active/);
  await page.getByTestId('tab-gear').tap();
  await expect(page.getByTestId('weapon-polearm')).toHaveClass(/selected/);
  await expect(page.getByTestId('armor-heavy')).toHaveClass(/selected/);
  await expect(page.getByTestId('offhand-shield')).toHaveClass(/selected/);

  await page.getByTestId('tab-tech').tap();
  await expect(page.getByTestId('protocol-disrupt-2')).toHaveClass(/selected/); // SURGE

  // The draft is editable, not a locked preset — swap the offhand before deploying.
  await page.getByTestId('tab-gear').tap();
  await page.getByTestId('offhand-none').tap();
  await expect(page.getByTestId('offhand-none')).toHaveClass(/selected/);

  await page.getByTestId('finalize').tap();
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Loot: taking a controlled item shows its acquisition result above CONTENTS,
//    removes the source item, and updates inventory once (SESSION-02).
// ─────────────────────────────────────────────────────────────────────────────
test('taking a controlled loot item immediately shows its acquisition result above CONTENTS, removes the source item, and updates inventory once', async ({ page }) => {
  const harness = createGameHarness({ seed: 5, partySize: 1 });
  const container = harness.floor.containers[0];
  test.skip(!container, 'seed 5 exposes no container for this floor');
  const walk = walkTo(harness, container);
  test.skip(!walk.reached, 'seed 5 does not expose a reachable container for the loot pickup check');
  const fragment = roundTripRunState(harness.runState).encoded.fragment;

  await importRun(page, fragment);
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  await page.getByTestId('console-tab-loot').tap();

  const itemRow = page.locator('[data-testid^="loot-item-"]').first();
  await expect(itemRow).toBeVisible();
  const itemId = (await itemRow.getAttribute('data-testid')).replace('loot-item-', '');
  const initialItemCount = await page.locator('[data-testid^="loot-item-"]').count();

  await page.getByTestId(`loot-take-${itemId}`).tap();

  const pickupResult = page.getByTestId('loot-pickup-result');
  await expect(pickupResult).toBeVisible();
  // v7 cap is INVENTORY_CAP=40 (saves-never-fail SESSION-01 CP3). UI already
  // renders X/CAP dynamically (src/ui/console/loot.js reads INVENTORY_CAP),
  // so this literal follows the cap.
  await expect(pickupResult).toHaveText(/^(LOOT ACQUIRED|CONTAINER CLEARED) — .+ · INVENTORY \d+\/40$/);
  // Above CONTENTS: the pickup result renders before the heading in DOM order.
  const contentsHeading = page.getByTestId('loot-contents-heading');
  const order = await page.evaluate(() => {
    const result = document.querySelector('[data-testid="loot-pickup-result"]');
    const heading = document.querySelector('[data-testid="loot-contents-heading"]');
    if (!result || !heading) return null;
    return result.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING ? 'result-first' : 'heading-first';
  });
  expect(order).toBe('result-first');
  await expect(contentsHeading).toBeVisible();

  // The source item is gone from CONTENTS, and inventory updates exactly once —
  // no second take fires from the single tap.
  await expect(page.locator(`[data-testid="loot-item-${itemId}"]`)).toHaveCount(0);
  expect(await page.locator('[data-testid^="loot-item-"]').count()).toBe(Math.max(0, initialItemCount - 1));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Descent: a legal DESCEND activation uses the direct control with no
//    generic confirmation (SESSION-05).
// ─────────────────────────────────────────────────────────────────────────────
test('a legal descent uses the direct DESCEND control with no generic confirmation', async ({ page }) => {
  const harness = createGameHarness({ seed: 5, partySize: 1, depth: 1 });
  const descentPoint = harness.floor.descentPoint;
  harness.runState.partyPosition = { ...descentPoint };
  harness.lattice.setPartyPosition(descentPoint.x, descentPoint.y);
  const fragment = roundTripRunState(harness.runState).encoded.fragment;

  await importRun(page, fragment);
  await expect(page.getByTestId('exploration-canvas')).toBeVisible();
  await page.getByTestId('console-tab-move').tap();

  const descendButton = page.getByTestId('move-confirm');
  await expect(descendButton).toBeEnabled();
  await expect(descendButton).toHaveText('DESCEND');
  await descendButton.tap();

  await expect(page.locator('span.status-depth')).toHaveText('02', { timeout: 15_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Combat and TECH: the completed direct-action surfaces expose no generic
//    combat-confirm or tech-confirm control anywhere in the tested flow
//    (SESSION-03, SESSION-04).
// ─────────────────────────────────────────────────────────────────────────────
test('the completed COMBAT and TECH surfaces have no generic combat-confirm or tech-confirm control in the tested flow', async ({ page }) => {
  const combatHarness = createGameHarness({ seed: 31, partySize: 1 });
  startStandardCombat(combatHarness, {
    enemyHP: 20,
    partyOverrides: [{ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }]
  });
  const activeCombat = combatHarness.runState.activeCombat;
  const combatParty = activeCombat.actors.find((actor) => actor.side === 'party');
  const combatEnemy = activeCombat.actors.find((actor) => actor.side !== 'party');
  const dx = combatParty.x >= 1 ? -1 : 1;
  combatEnemy.x = Math.max(0, Math.min(7, combatParty.x + dx));
  combatEnemy.y = Math.max(0, Math.min(15, combatParty.y));
  const partyTurn = activeCombat.initiativeOrder?.findIndex((id) => String(id).startsWith('operator_'));
  if (partyTurn >= 0) activeCombat.currentIndex = partyTurn;
  const combatFragment = roundTripRunState(combatHarness.runState).encoded.fragment;

  await importRun(page, combatFragment);
  await expect(page.getByTestId('combat-canvas')).toBeVisible();
  await page.getByTestId('console-tab-combat').tap();
  await page.getByTestId('combat-action-attack').tap();
  await page.locator('[data-testid^="combat-target-"]').first().tap();
  await expect(page.getByTestId('combat-confirm')).toHaveCount(0);

  const techFixture = buildTechProtocolFixture(TECH_PROTOCOL_CASES.find((entry) => entry.id === 'disrupt-1'));
  await importRun(page, techFixture.fragment);
  await expect(page.getByTestId('combat-canvas')).toBeVisible();
  await page.getByTestId('console-tab-tech').tap();
  await expect(page.getByTestId('tech-confirm')).toHaveCount(0);
  await page.getByTestId(`tech-cast-${techFixture.protocol.id}`).tap();
  await expect(page.getByTestId('tech-confirm')).toHaveCount(0);
  await page.getByTestId(`tech-target-${techFixture.ids.primary}`).tap();
  await expect(page.getByTestId('tech-confirm')).toHaveCount(0);
  await expect(page.getByTestId('tech-result')).toContainText(techFixture.protocol.name, { timeout: 1_000 });
});
