import { expect, test } from '@playwright/test';
import { TECH_PROTOCOL_CASES, buildTechProtocolFixture } from '../helpers/tech-protocol-e2e-fixture.js';

async function installStorage(page) {
  await page.addInitScript(() => {
    const store = new Map();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
        clear: () => store.clear(),
        key: index => [...store.keys()][index] ?? null,
        get length() { return store.size; }
      }
    });
  });
}

async function runtimeCombatSnapshot(page) {
  return page.evaluate(() => import('/src/runtime.js').then(module => module.getRuntimeSnapshot().currentRun));
}

for (const caseDescriptor of TECH_PROTOCOL_CASES) {
  test(`${caseDescriptor.school.toUpperCase()} T${caseDescriptor.tier} ${caseDescriptor.name} follows the real TECH workflow`, async ({ page }) => {
    const fixture = buildTechProtocolFixture(caseDescriptor);
    await installStorage(page);
    await page.goto(`/?run=${fixture.fragment.slice(0, 8)}#r=${fixture.fragment}`);
    await expect(page.getByTestId('import-run-summary')).toContainText('ACTIVE COMBAT SNAPSHOT');
    await page.getByTestId('import-resume').click();
    await expect(page.getByTestId('combat-canvas')).toBeVisible();
    await page.getByTestId('console-tab-tech').click();

    const card = page.getByTestId(`tech-protocol-${caseDescriptor.id}`);
    await expect(card).toContainText(caseDescriptor.name);
    await expect(card).toContainText(`${caseDescriptor.chargeCost}`);
    await expect(card).toContainText(caseDescriptor.effect);
    await page.getByTestId(`tech-cast-${caseDescriptor.id}`).click();
    await expect(page.getByTestId('tech-confirm')).toHaveCount(0);
    if (fixture.protocol.target) {
      const targetId = fixture.protocol.target === 'ally' ? fixture.ids.ally : fixture.ids.primary;
      await expect(page.getByTestId(`tech-target-${targetId}`)).toBeVisible();
      await page.getByTestId(`tech-target-${targetId}`).click();
    } else {
      await expect(page.locator('[data-testid^="tech-target-"]')).toHaveCount(0);
    }
    await expect(page.getByTestId('tech-confirm')).toHaveCount(0);
    await expect(page.getByTestId('tech-result')).toContainText(caseDescriptor.name, { timeout: 1_000 });
    await expect.poll(async () => {
      const currentRun = await runtimeCombatSnapshot(page);
      return fixture.expected.outcome(currentRun, fixture.before, fixture.ids);
    }, { timeout: 1_000 }).toBe(true);
    await expect.poll(async () => {
      const currentRun = await runtimeCombatSnapshot(page);
      const caster = currentRun.activeCombat?.actors.find(actor => actor.id === fixture.ids.caster);
      return Boolean(currentRun.activeCombat) && caster !== undefined;
    }, { timeout: 1_000 }).toBe(true);
  });
}
