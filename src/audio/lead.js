import { playNote } from './chip.js';

const BASE_TEMPO = 96;
const BUS_GAIN = 0.22;
const REGISTER_MULT = 4;
const ECHO_VELOCITY_SCALE = 0.4;
const SUSTAIN_LENGTH_SLOTS = 4;
const SUSTAIN_VIBRATO = { rate: 5.5, depth: 8, delay: 0.15 };

function waveFor(intensity, combat) {
  if (combat) return 'pulse125';
  return intensity >= 0.55 ? 'pulse25' : 'pulse50';
}

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
    const freq = tick.rootFreq * REGISTER_MULT * Math.pow(2, semitone / 12);
    const duration = Math.max(1, slot.lengthSlots) * tick.secondsPerSixteenth;
    const wave = waveFor(tick.intensity, tick.combat);
    const isSustain = slot.lengthSlots >= SUSTAIN_LENGTH_SLOTS;
    const vibrato = isSustain ? SUSTAIN_VIBRATO : null;
    const velocity = slot.velocity * volume;
    playNote(ctx, gain, { wave, time: tick.time, freq, duration, velocity, sustain: isSustain, vibrato });
    if (echoInput) {
      playNote(ctx, echoInput, {
        wave, time: tick.time, freq, duration,
        velocity: velocity * ECHO_VELOCITY_SCALE,
        sustain: isSustain, vibrato
      });
    }
  }

  return {
    start() {
      if (gain) return;
      gain = ctx.createGain();
      gain.gain.value = BUS_GAIN * volume;
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
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * BUS_GAIN; },
    updateState() {},
    getState() { return { tempo: lastTempo, barIndex: lastBar }; }
  };
}
