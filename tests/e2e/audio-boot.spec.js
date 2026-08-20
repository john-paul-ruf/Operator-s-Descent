import { expect, test } from '@playwright/test';

// Regression guard for `restore-audio-output` SESSION-01.
//
// Before this session the runtime never constructed an AudioContext (removed in
// visual-parity-v2 SESSION-03, `30b7172`), so `createAudioEngine(null).start()`
// silently bailed and production shipped silent. The fix creates the context
// eagerly and installs a one-time capture-phase gesture listener that resumes
// it — which honors Rule 10 (cold shell boots audio, browser autoplay policy
// holds it suspended until the first user gesture).
//
// This spec proves the RUNTIME LIFECYCLE half of the fix through the runtime
// snapshot: a real AudioContext exists after cold boot and reaches 'running'
// after the first user gesture. `audioStarted` is not asserted here because a
// separate pre-existing bug in `src/audio/drone.js` (setting
// `OscillatorNode.type = 'custom'` directly is rejected by real browsers) can
// leave the engine unstarted in production — see the audio boot lifecycle
// unit tests for the FakeContext-driven end-to-end proof, and the SESSION-01
// handoff for the drone follow-up.
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
          import('/src/runtime.js').then((mod) => mod.getRuntimeSnapshot()?.audioContextState)
        ),
      { timeout: 5000, message: 'expected AudioContext to reach running after first gesture' }
    )
    .toBe('running');
});
