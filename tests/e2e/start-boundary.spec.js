import { expect, test } from '@playwright/test';

const COLD_ALLOWED = new Set([
  '/',
  '/index.html',
  '/styles/base.css',
  '/styles/components.css',
  '/styles/crt.css',
  '/src/main.js'
]);

test('cold title performs no hot work before START', async ({ page }) => {
  const requests = [];
  await page.addInitScript(() => {
    const audit = { audioConstructed: 0, audioResumed: 0, serviceWorkerRegistered: 0, randomCalls: 0 };
    const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
    if (OriginalAudioContext) {
      class AuditedAudioContext extends OriginalAudioContext {
        constructor(...args) {
          audit.audioConstructed += 1;
          super(...args);
        }
        resume(...args) {
          audit.audioResumed += 1;
          return super.resume(...args);
        }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: AuditedAudioContext });
      Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: AuditedAudioContext });
    }
    if (navigator.serviceWorker?.register) {
      const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = (...args) => {
        audit.serviceWorkerRegistered += 1;
        return register(...args);
      };
    }
    const random = Math.random.bind(Math);
    Math.random = () => {
      audit.randomCalls += 1;
      return random();
    };
    window.__odPreStartAudit = audit;
  });
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'START' })).toBeVisible();
  await expect(page.locator('#grain-canvas')).toHaveCount(0);

  const audit = await page.evaluate(() => window.__odPreStartAudit);
  expect(audit).toEqual({ audioConstructed: 0, audioResumed: 0, serviceWorkerRegistered: 0, randomCalls: 0 });
  expect(requests.filter((path) => !COLD_ALLOWED.has(path))).toEqual([]);
  expect(requests.some((path) => path.startsWith('/data/') || path.endsWith('.woff2') || path.endsWith('/runtime.js') || path.includes('/glitch/'))).toBe(false);
});
