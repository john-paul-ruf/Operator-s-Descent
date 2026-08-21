import { playNote } from './chip.js';
import { hash } from '../core/hash.js';

const MAX_DIST = 10;
const CUTOFF_MIN = 900;
const CUTOFF_RANGE = 2600;
const ECHO_SPARKLE_THRESHOLD = 0.5;
const REGISTER_MULT = 4;

function clampDistance(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_DIST, value)) : MAX_DIST;
}

function strideFor(sparkleAmount) {
  return sparkleAmount < 0.4 ? 4 : 2;
}

function buildArp(chord, direction) {
  const semis = chord?.semis ?? [0, 4, 7];
  const twoOct = [semis[0], semis[1], semis[2], semis[0] + 12, semis[1] + 12, semis[2] + 12];
  if (direction === 0) return twoOct;                                    // ascending
  if (direction === 1) return [...twoOct, ...twoOct.slice(0, -1).reverse()]; // up-down
  return [twoOct[0], twoOct[3], twoOct[1], twoOct[4], twoOct[2], twoOct[5]]; // broken (chord-tone leaps)
}

export function createSparkle(ctx, dest, conductor, echoInput) {
  let gain = null;
  let filter = null;
  let unsubscribe = null;
  let nearestDist = MAX_DIST;
  let volume = 0.75;
  let arpIndex = 0;
  let currentArp = null;
  let currentBarKey = '';

  function pressure() { return 1 - nearestDist / MAX_DIST; }
  function cutoff() { return CUTOFF_MIN + pressure() * CUTOFF_RANGE; }

  function ensureArp(tick) {
    const barKey = `${tick.pos.bar}:${tick.chord?.degree ?? 0}`;
    if (barKey === currentBarKey && currentArp) return;
    const h = hash(tick.pos.bar, tick.chord?.degree ?? 0, 'sparkle-dir');
    const direction = h % 3;
    currentArp = buildArp(tick.chord, direction);
    currentBarKey = barKey;
    arpIndex = 0;
  }

  function onTick(tick) {
    if (!filter) return;
    const sparkleAmount = tick.sparkle ?? 0;
    if (tick.pos.step === 0) ensureArp(tick);
    if (!currentArp) ensureArp(tick);
    const stride = strideFor(sparkleAmount);
    if (tick.pos.step % stride !== 0) return;
    const semi = currentArp[arpIndex % currentArp.length];
    arpIndex++;
    const freq = tick.rootFreq * REGISTER_MULT * Math.pow(2, semi / 12);
    const duration = tick.secondsPerSixteenth;
    const velocity = (0.10 + sparkleAmount * 0.18) * volume;
    filter.frequency.setValueAtTime?.(cutoff(), tick.time);
    playNote(ctx, filter, { wave: 'pulse25', time: tick.time, freq, duration, velocity });
    if (echoInput && sparkleAmount > ECHO_SPARKLE_THRESHOLD) {
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
      currentArp = null;
      currentBarKey = '';
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
