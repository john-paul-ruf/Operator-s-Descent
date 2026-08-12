import { expect, test } from '@playwright/test';

test('cold boot eagerly loads the runtime and shows the title screen', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));

  await page.goto('/');
  await expect(page.getByTestId('title-start')).toBeVisible();

  expect(requests.some((path) => path.startsWith('/data/'))).toBe(true);
  expect(requests.some((path) => path.endsWith('/runtime.js'))).toBe(true);
  expect(requests.some((path) => path.includes('/glitch/'))).toBe(true);
});