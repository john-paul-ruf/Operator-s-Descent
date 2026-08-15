import { expect, test } from '@playwright/test';

test.beforeEach(async ({ }, testInfo) => {
  test.skip(!/^chromium-wide-/.test(testInfo.project.name), 'adaptive-layout battery runs in the wide viewport projects only');
});

test('wide viewport boots with data-layout="wide"', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title-start')).toBeVisible();
  const layout = await page.evaluate(() => document.documentElement.dataset.layout);
  expect(layout).toBe('wide');
});
