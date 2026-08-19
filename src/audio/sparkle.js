import { playNote } from './chip.js';

const MAX_DIST = 10;

function clampDistance(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_DIST, value)) : MAX_DIST;
}

export function createSparkle(ctx, dest, conductor, echoInput) {
  let gain = null;
  let filter = null;
  let unsubscribe = null;
  let nearestDist = MAX_DIST;
  let volume = 0.75;
  let arpIndex = 0;

  function pressure() { return 1 - nearestDist / MAX_DIST; }
  function cutoff() { return 400 + pressure() * 3000; }

  function strideFor(sparkleAmount) {
    if (sparkleAmount < 0.35) return 8;
    if (sparkleAmount < 0.7) return 4;
    return 2;
  }

  function onTick(tick) {
    if (!filter) return;
    const sparkleAmount = tick.sparkle;
    if (sparkleAmount <= 0) return;
    const stride = strideFor(sparkleAmount);
    if (tick.pos.step % stride !== 0) return;
    const semis = tick.chord?.semis ?? [0, 4, 7];
    const arp = [semis[0], semis[1], semis[2], semis[0] + 12];
    const semi = arp[arpIndex % arp.length];
    arpIndex++;
    const freq = tick.rootFreq * 4 * Math.pow(2, semi / 12);
    const duration = tick.secondsPerSixteenth;
    const velocity = 0.3 * volume;
    playNote(ctx, filter, { wave: 'pulse25', time: tick.time, freq, duration, velocity });
    if (echoInput) {
      playNote(ctx, echoInput, { wave: 'pulse25', time: tick.time, freq, duration, velocity: velocity * 0.5 });
    }
  }

  return {
    start() {
      if (gain) return;
      gain = ctx.createGain();
      gain.gain.value = 0.08 * volume;
      gain.connect(dest);
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff();
      filter.Q.value = 0.5;
      filter.connect(gain);
      arpIndex = 0;
      unsubscribe = conductor?.subscribe?.(onTick) ?? null;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      filter?.disconnect?.();
      gain?.disconnect?.();
      filter = null;
      gain = null;
    },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * 0.08; },
    updateState(state) {
      nearestDist = clampDistance(state?.proximity?.container ?? state?.nearestContainerDistance);
      filter?.frequency?.linearRampToValueAtTime?.(cutoff(), ctx.currentTime + 0.1);
    },
    getState() { return { nearestDist, cutoff: cutoff() }; }
  };
}
