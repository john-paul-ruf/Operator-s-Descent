import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 4173);
const HOST = process.env.E2E_HOST || '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}/`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: `node ./tools/serve.mjs --host ${HOST} --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  },
  projects: [
    {
      name: 'chromium-portrait',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1080, height: 1920 } }
    },
    {
      name: 'chromium-phone-touch',
      use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }
    },
    {
      name: 'firefox-portrait',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1080, height: 1920 } }
    },
    {
      name: 'webkit-portrait',
      use: { ...devices['Desktop Safari'], viewport: { width: 1080, height: 1920 } }
    }
  ]
});
