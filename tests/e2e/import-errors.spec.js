import { expect, test } from '@playwright/test';
import { createGameHarness, roundTripRunState } from '../helpers/game-fixture.js';
import { base64urlEncode } from '../../src/state/save-encode.js';
import { base64urlDecode } from '../../src/state/save-decode.js';

const QUIET_SETTINGS = {
  masterMute: true,
  layerVolumes: { drone: 0, pulse: 0, sparkle: 0, lead: 0, noiseBed: 0 },
  glitchEnabled: false,
  reducedMotion: 'reduce',
  scanlineGrainEnabled: false
};

function importCases() {
  const harness = createGameHarness({ seed: 777331, partySize: 1 });
  const fragment = roundTripRunState(harness.runState).encoded.fragment;
  const bytes = base64urlDecode(fragment);
  const version = bytes.slice();
  version[2] += 1;
  const checksum = bytes.slice();
  checksum[checksum.length - 5] ^= 0xff;
  const malformed = bytes.slice();
  malformed[13] = 255;
  return [
    ['truncated', base64urlEncode(bytes.slice(0, 18)), 'Truncated — the link was cut short.'],
    ['version_mismatch', base64urlEncode(version), 'Version mismatch — this link was made by a different version.'],
    ['checksum_failed', base64urlEncode(checksum), 'Checksum failed — the link was corrupted in transit.'],
    ['malformed', base64urlEncode(malformed), 'Malformed — the link is not a valid save.']
  ];
}

async function installStorage(page) {
  await page.addInitScript((settings) => {
    localStorage.clear();
    localStorage.setItem('od_settings', JSON.stringify(settings));
    localStorage.setItem('od_flags', JSON.stringify({ tutorialDeclined: true }));
  }, QUIET_SETTINGS);
}

test('import diagnostics show named failures, title return, and seed recovery when readable', async ({ page }) => {
  await installStorage(page);
  await page.goto('/');
  await page.getByTestId('title-start').click();
  await page.getByTestId('title-import-link').click();

  for (const [code, fragment, message] of importCases()) {
    await page.getByTestId('import-input').fill(`#r=${fragment}`);
    await page.getByTestId('import-submit').click();
    await expect(page.getByTestId(`import-failure-${code}`)).toContainText(message);
    await expect(page.getByTestId('import-fresh-world')).toBeVisible();
    await expect(page.getByTestId('import-return-title-result')).toBeVisible();
  }

  await page.getByTestId('import-input').fill('#r=not-a-save');
  await page.getByTestId('import-submit').click();
  await expect(page.getByTestId('import-failure-malformed')).toContainText('Malformed — the link is not a valid save.');
  await expect(page.getByTestId('import-fresh-world')).toHaveCount(0);
  await page.getByTestId('import-return-title-result').click();
  // Single-state title (commit 30b7172): return lands collapsed; re-expand via
  // START to reveal the branch list.
  await expect(page.getByTestId('title-start')).toBeVisible();
  await page.getByTestId('title-start').click();
  await expect(page.getByTestId('title-begin-new-run')).toBeVisible();
});
