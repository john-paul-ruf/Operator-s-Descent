import { expect, test } from '@playwright/test';

test('manifest is served with the correct MIME type and installable fields', async ({ page, baseURL }) => {
  const response = await page.request.get(new URL('manifest.webmanifest', baseURL).href);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/manifest+json');

  const manifest = await response.json();
  expect(manifest.name).toBe("Operator's Descent");
  expect(manifest.short_name).toBe('Descent');
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation).toBe('portrait');
  expect(manifest.start_url).toBe('./');
  expect(manifest.scope).toBe('./');
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons) expect(icon.purpose).toBe('any maskable');
});

test('the viewport stays browser-zoomable and every linked PWA asset is same-origin and reachable', async ({ page, baseURL }) => {
  await page.goto('/');

  const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportContent).toContain('viewport-fit=cover');
  expect(viewportContent).not.toMatch(/maximum-scale/);
  expect(viewportContent).not.toMatch(/user-scalable/);

  const hrefs = await page.locator('link[rel="manifest"], link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(hrefs).toEqual(expect.arrayContaining(['manifest.webmanifest', 'assets/app-icon.svg', 'assets/app-icon-180.png']));

  const baseOrigin = new URL(baseURL).origin;
  for (const href of hrefs) {
    const assetURL = new URL(href, baseURL).href;
    expect(new URL(assetURL).origin).toBe(baseOrigin);
    const response = await page.request.get(assetURL);
    expect(response.ok()).toBe(true);
  }

  for (const iconSrc of ['assets/app-icon-192.png', 'assets/app-icon-512.png']) {
    const response = await page.request.get(new URL(iconSrc, baseURL).href);
    expect(response.ok()).toBe(true);
  }
});
