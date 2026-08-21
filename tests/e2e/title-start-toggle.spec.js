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

// portrait-usability-regression-repair SESSION-04 — the title must return to
// its canonical START state after the manual modal closes: START visible +
// focused, branches hidden, modal gone, and a subsequent START click still
// reveals the branch list. The reset is a local ui:manual-close listener on
// the mounted title controller; it must not navigate or mutate history.
test('manual open/close from the title resets START and stays clickable', async ({ page }) => {
  await page.goto('/');

  const start = page.getByTestId('title-start');
  const branches = page.getByTestId('title-branches');
  const manual = page.getByTestId('title-manual');
  const modal = page.getByTestId('manual-modal');

  await expect(start).toBeVisible();
  await expect(branches).toBeHidden();

  // Reveal branches, then open the modal from the MANUAL branch.
  await start.click();
  await expect(branches).toBeVisible();
  await expect(start).toBeHidden();

  await manual.click();
  await expect(modal).toBeVisible();

  // Close via the modal's close button — reset back to the initial START view.
  await page.getByTestId('manual-close').click();
  await expect(modal).toBeHidden();
  await expect(start).toBeVisible();
  await expect(branches).toBeHidden();
  await expect(start).toBeFocused();

  // A second START click must still reveal branches (unmount/remount would
  // wipe our listener; a stuck reset would leave START permanently visible).
  await start.click();
  await expect(branches).toBeVisible();
  await expect(start).toBeHidden();
});
