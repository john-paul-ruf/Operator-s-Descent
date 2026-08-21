import { buildLFSRBuffer, playHat, playKick, playSnare } from './chip.js';

const MAX_DIST = 10;
const KICK_PATH_GAIN = 0.9;
const BRIGHT_PATH_GAIN = 0.75;
const LAYER_GAIN = 0.2;

function clampDistance(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_DIST, value)) : MAX_DIST;
}

function clamp01(value) {
  const v = Number.isFinite(value) ? value : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function createPulse(ctx, dest, conductor) {
  let gain = null;
  let kickGain = null;
  let brightGain = null;
  let noiseBuffer = null;
  let shortBuffer = null;
  let unsubscribe = null;
  let nearestDist = MAX_DIST;
  let combat = false;
  let volume = 0.75;
  let lastTempo = 96;

  function onTick(tick) {
    if (!kickGain || !brightGain) return;
    lastTempo = tick.tempo;
    const step = tick.pos.step;
    const drums = tick.drums;
    if (!drums) return;
    const energy = clamp01(tick.intensity);
    const velocity = (0.55 + energy * 0.45) * volume;
    if (drums.kick?.[step]) playKick(ctx, kickGain, { time: tick.time, velocity });
    if (drums.snare?.[step]) playSnare(ctx, brightGain, { time: tick.time, velocity, noiseBuffer });
    if (drums.hat?.[step]) {
      const weak = (step === 2 || step === 6 || step === 10 || step === 14);
      const hatVel = weak ? velocity * 0.5 : velocity;
      playHat(ctx, brightGain, { time: tick.time, velocity: hatVel, shortBuffer });
    }
  }

  return {
    start() {
      if (gain) return;
      gain = ctx.createGain();
      gain.gain.value = LAYER_GAIN * volume;
      gain.connect(dest);
      kickGain = ctx.createGain();
      kickGain.gain.value = KICK_PATH_GAIN;
      kickGain.connect(gain);
      brightGain = ctx.createGain();
      brightGain.gain.value = BRIGHT_PATH_GAIN;
      brightGain.connect(gain);
      noiseBuffer = buildLFSRBuffer(ctx);
      shortBuffer = buildLFSRBuffer(ctx, { short: true });
      unsubscribe = conductor?.subscribe?.(onTick) ?? null;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      kickGain?.disconnect?.();
      brightGain?.disconnect?.();
      gain?.disconnect?.();
      kickGain = null;
      brightGain = null;
      gain = null;
      noiseBuffer = null;
      shortBuffer = null;
    },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * LAYER_GAIN; },
    updateState(state) {
      nearestDist = clampDistance(state?.proximity?.hostile ?? state?.nearestHostileDistance);
      combat = Boolean(state?.combatActive || state?.combatState || state?.combat);
    },
    getState() { return { nearestDist, combat, tempo: lastTempo }; }
  };
}
