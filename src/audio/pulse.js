import { buildLFSRBuffer, playHat, playKick, playSnare } from './chip.js';

const MAX_DIST = 10;

function clampDistance(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_DIST, value)) : MAX_DIST;
}

export function createPulse(ctx, dest, conductor) {
  let gain = null;
  let filter = null;
  let noiseBuffer = null;
  let shortBuffer = null;
  let unsubscribe = null;
  let nearestDist = MAX_DIST;
  let combat = false;
  let volume = 0.75;
  let lastTempo = 96;

  function pressure() { return 1 - nearestDist / MAX_DIST; }

  function onTick(tick) {
    if (!filter) return;
    lastTempo = tick.tempo;
    const step = tick.pos.step;
    const velocity = (0.5 + Math.max(0, Math.min(1, tick.intensity)) * 0.5) * volume;
    if (tick.drums?.kick?.[step]) playKick(ctx, filter, { time: tick.time, velocity });
    if (tick.drums?.snare?.[step]) playSnare(ctx, filter, { time: tick.time, velocity, noiseBuffer });
    if (tick.drums?.hat?.[step]) playHat(ctx, filter, { time: tick.time, velocity, shortBuffer });
  }

  return {
    start() {
      if (gain) return;
      gain = ctx.createGain();
      gain.gain.value = 0.12 * volume;
      gain.connect(dest);
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.Q.value = 2;
      filter.connect(gain);
      noiseBuffer = buildLFSRBuffer(ctx);
      shortBuffer = buildLFSRBuffer(ctx, { short: true });
      unsubscribe = conductor?.subscribe?.(onTick) ?? null;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      filter?.disconnect?.();
      gain?.disconnect?.();
      filter = null;
      gain = null;
      noiseBuffer = null;
      shortBuffer = null;
    },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * 0.12; },
    updateState(state) {
      nearestDist = clampDistance(state?.proximity?.hostile ?? state?.nearestHostileDistance);
      combat = Boolean(state?.combatActive || state?.combatState);
      if (filter?.frequency) filter.frequency.linearRampToValueAtTime?.(400 + pressure() * (combat ? 1600 : 900), ctx.currentTime + 0.1);
    },
    getState() { return { nearestDist, combat, tempo: lastTempo }; }
  };
}
