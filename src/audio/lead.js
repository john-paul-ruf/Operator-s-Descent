import { playNote } from './chip.js';

const BASE_TEMPO = 96;

export function createLead(ctx, dest, conductor, echoInput) {
  let gain = null;
  let unsubscribe = null;
  let volume = 0.75;
  let lastTempo = BASE_TEMPO;
  let lastBar = 0;

  function onTick(tick) {
    if (!gain) return;
    lastTempo = tick.tempo;
    lastBar = tick.pos.bar;
    const slot = tick.melody?.[tick.pos.step];
    if (!slot) return;
    const semitone = slot.degree + 12 * slot.octave;
    const freq = tick.rootFreq * 2 * Math.pow(2, semitone / 12);
    const duration = Math.max(1, slot.lengthSlots) * tick.secondsPerSixteenth;
    const wave = tick.combat ? 'pulse125' : 'pulse25';
    const vibrato = slot.lengthSlots >= 3 ? { rate: 5.5, depth: 6 } : null;
    const velocity = slot.velocity * volume;
    playNote(ctx, gain, { wave, time: tick.time, freq, duration, velocity, vibrato });
    if (echoInput) {
      playNote(ctx, echoInput, { wave, time: tick.time, freq, duration, velocity: velocity * 0.5, vibrato });
    }
  }

  return {
    start() {
      if (gain) return;
      gain = ctx.createGain();
      gain.gain.value = 0.1 * volume;
      gain.connect(dest);
      unsubscribe = conductor?.subscribe?.(onTick) ?? null;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      gain?.disconnect?.();
      gain = null;
    },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * 0.1; },
    updateState() {},
    getState() { return { tempo: lastTempo, barIndex: lastBar }; }
  };
}
