import { dutyWave, playNote } from './chip.js';

const TIMBRES = {
  'cold-ambient': { filterFreq: 800, detune: 5 },
  'foundry-industrial': { filterFreq: 400, detune: 12 },
  'flowing-cyan': { filterFreq: 1200, detune: 3 },
  'compressed-yellow': { filterFreq: 500, detune: 8 },
  'labyrinth-amber': { filterFreq: 600, detune: 7 },
  'organic-green': { filterFreq: 1000, detune: 4 },
  'abyssal-magenta': { filterFreq: 300, detune: 15 },
  'geometric-cyan': { filterFreq: 900, detune: 6 },
  'layered-purple': { filterFreq: 700, detune: 9 },
  'corrupted-red': { filterFreq: 250, detune: 18 },
  'bioluminescent-teal': { filterFreq: 1400, detune: 3 },
  'ancient-bone': { filterFreq: 450, detune: 10 }
};

const PAD_GLIDE = 0.08;
const FILTER_GLIDE = 0.5;

export function createDrone(ctx, dest, conductor) {
  let padOscs = [];
  let padFilter = null;
  let padGain = null;
  let bassGain = null;
  let unsubscribe = null;
  let started = false;
  let volume = 0.75;
  let audioMode = 'cold-ambient';
  let depth = 1;
  let lastChordKey = '';

  function timbre() { return TIMBRES[audioMode] || TIMBRES['cold-ambient']; }

  function build() {
    const t = timbre();
    padGain = ctx.createGain();
    padGain.gain.value = volume * 0.15;
    padGain.connect(dest);
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = t.filterFreq;
    padFilter.Q.value = 0.9;
    padFilter.connect(padGain);
    padOscs = [-1, 1].map((side) => {
      const osc = ctx.createOscillator();
      osc.type = 'custom';
      osc.setPeriodicWave(dutyWave(ctx, 0.5));
      osc.frequency.value = 110;
      osc.detune.value = side * t.detune;
      osc.connect(padFilter);
      return osc;
    });
    bassGain = ctx.createGain();
    bassGain.gain.value = volume * 0.5;
    bassGain.connect(dest);
  }

  function retunePad(tick) {
    const rootFreq = tick.rootFreq;
    const semis = tick.chord?.semis ?? [0, 4, 7];
    const voiceSemi = [semis[0], semis[2]];
    for (let i = 0; i < padOscs.length; i++) {
      const osc = padOscs[i];
      const target = rootFreq * Math.pow(2, voiceSemi[i] / 12);
      const now = tick.time;
      osc.frequency.cancelScheduledValues?.(now);
      osc.frequency.setValueAtTime?.(osc.frequency.value ?? target, now);
      osc.frequency.linearRampToValueAtTime?.(target, now + PAD_GLIDE);
    }
  }

  function onTick(tick) {
    if (!started) return;
    const chordKey = tick.chord ? `${tick.chord.degree}:${tick.chord.semis.join(',')}` : '';
    if (tick.pos.step === 0 && chordKey !== lastChordKey) {
      lastChordKey = chordKey;
      retunePad(tick);
    }
    const step = tick.pos.step;
    const intensity = tick.intensity;
    if (step !== 0 && step !== 8 && !(intensity > 0.4 && step === 4) && !(intensity > 0.7 && (step === 10 || step === 14))) return;
    const rootSemi = tick.chord?.semis?.[0] ?? 0;
    const bassFreq = Math.max(27.5, (tick.rootFreq / 2) * Math.pow(2, rootSemi / 12));
    playNote(ctx, bassGain, {
      wave: 'triangle',
      time: tick.time,
      freq: bassFreq,
      duration: tick.secondsPerSixteenth * 3,
      velocity: 0.5 * volume
    });
  }

  return {
    start() {
      if (started) return;
      build();
      for (const osc of padOscs) osc.start();
      unsubscribe = conductor?.subscribe?.(onTick) ?? null;
      started = true;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      for (const osc of padOscs) { try { osc.stop(); } catch {} osc.disconnect?.(); }
      padOscs = [];
      padFilter?.disconnect?.();
      padGain?.disconnect?.();
      bassGain?.disconnect?.();
      padFilter = null;
      padGain = null;
      bassGain = null;
      lastChordKey = '';
      started = false;
    },
    destroy() { this.stop(); },
    setVolume(v) {
      volume = v;
      if (padGain) padGain.gain.value = v * 0.15;
      if (bassGain) bassGain.gain.value = v * 0.5;
    },
    updateState(state) {
      const nextMode = state?.theme?.audioMode || state?.audioMode || audioMode;
      const nextDepth = state?.depth || depth;
      if (nextMode === audioMode && nextDepth === depth) return;
      audioMode = nextMode;
      depth = nextDepth;
      if (started && padFilter) {
        const t = timbre();
        const now = ctx.currentTime;
        padFilter.frequency.cancelScheduledValues?.(now);
        padFilter.frequency.setValueAtTime?.(padFilter.frequency.value ?? t.filterFreq, now);
        padFilter.frequency.linearRampToValueAtTime?.(t.filterFreq, now + FILTER_GLIDE);
        for (const osc of padOscs) {
          osc.detune.cancelScheduledValues?.(now);
          osc.detune.setValueAtTime?.(osc.detune.value ?? 0, now);
        }
      }
    },
    getState() { return { audioMode, depth, oscillatorCount: padOscs.length }; }
  };
}
