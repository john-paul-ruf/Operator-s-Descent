import { expect, test } from '@playwright/test';

// Regression guard for `restore-audio-output` SESSION-01 + `restore-audio-output-v2`
// SESSION-01. Before those sessions production shipped silent for two reasons:
// (1) the runtime never constructed an AudioContext (removed in visual-parity-v2
// SESSION-03, `30b7172`), so `createAudioEngine(null).start()` bailed silently;
// (2) `src/audio/drone.js` and `src/audio/chip.js` assigned
// `OscillatorNode.type = 'custom'` before `setPeriodicWave(...)`, which real
// Chromium rejects with InvalidStateError, leaving the engine unstarted even
// with a live context. Both are fixed: the runtime creates the context eagerly
// and installs a one-time capture-phase gesture listener that resumes it, and
// the illegal type assignments are gone.
//
// This spec proves the full chain end-to-end: a real AudioContext exists after
// cold boot AND the engine builds cleanly AND the context reaches 'running'
// after the first user gesture.
test('cold boot creates the AudioContext eagerly and the first gesture resumes it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('title-start')).toBeVisible();

  const preSnapshot = await page.evaluate(() =>
    import('/src/runtime.js').then((mod) => mod.getRuntimeSnapshot())
  );
  expect(preSnapshot.hasAudio).toBe(true);
  // Accept 'suspended' (autoplay-honoring, expected) or 'running' (headless
  // Chromium sometimes relaxes autoplay when the tab already has focus).
  expect(['suspended', 'running']).toContain(preSnapshot.audioContextState);

  await page.locator('[data-testid="title-start"]').click();

  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          import('/src/runtime.js').then((mod) => {
            const snapshot = mod.getRuntimeSnapshot();
            return {
              audioStarted: snapshot?.audioStarted,
              audioContextState: snapshot?.audioContextState
            };
          })
        ),
      { timeout: 5000, message: 'expected engine started + context running after first gesture' }
    )
    .toEqual({ audioStarted: true, audioContextState: 'running' });
});
