import { expect, test } from '@playwright/test';

test('START reveals the branch list and hides itself on the title screen', async ({ page }) => {
  await page.goto('/');

  const start = page.getByTestId('title-start');
  const branches = page.getByTestId('title-branches');

  await expect(start).toBeVisible();
  // Regression guard: branches must be visually hidden on first paint.
  await expect(branches).toBeHidden();

  await start.click();
  await expect(branches).toBeVisible();
  await expect(page.getByTestId('title-begin-new-run')).toBeVisible();
  await expect(start).toBeHidden();
});
