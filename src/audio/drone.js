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
const PAD_BASE_GAIN = 0.15;
const BASS_BUS_GAIN = 0.55;
const FILTER_LFO_HZ = 0.07;
const FILTER_LFO_DEPTH_RATIO = 0.15;
const PAD_LFO_HZ = 0.05;
const PAD_LFO_DEPTH_RATIO = 0.10;

export function createDrone(ctx, dest, conductor) {
  let padOscs = [];
  let padFilter = null;
  let padGain = null;
  let bassGain = null;
  let filterLFO = null;
  let filterLFOGain = null;
  let padGainLFO = null;
  let padGainLFOGain = null;
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
    padGain.gain.value = volume * PAD_BASE_GAIN;
    padGain.connect(dest);
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = t.filterFreq;
    padFilter.Q.value = 0.9;
    padFilter.connect(padGain);
    padOscs = [-1, 1].map((side) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(dutyWave(ctx, 0.5));
      osc.frequency.value = 110;
      osc.detune.value = side * t.detune;
      osc.connect(padFilter);
      return osc;
    });
    bassGain = ctx.createGain();
    bassGain.gain.value = volume * BASS_BUS_GAIN;
    bassGain.connect(dest);

    filterLFO = ctx.createOscillator();
    filterLFO.type = 'sine';
    filterLFO.frequency.value = FILTER_LFO_HZ;
    filterLFOGain = ctx.createGain();
    filterLFOGain.gain.value = t.filterFreq * FILTER_LFO_DEPTH_RATIO;
    filterLFO.connect(filterLFOGain);
    filterLFOGain.connect(padFilter.frequency);

    padGainLFO = ctx.createOscillator();
    padGainLFO.type = 'sine';
    padGainLFO.frequency.value = PAD_LFO_HZ;
    padGainLFOGain = ctx.createGain();
    padGainLFOGain.gain.value = (volume * PAD_BASE_GAIN) * PAD_LFO_DEPTH_RATIO;
    padGainLFO.connect(padGainLFOGain);
    padGainLFOGain.connect(padGain.gain);
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
    const slot = tick.bass?.[tick.pos.step];
    if (!slot) return;
    const freq = Math.max(
      27.5,
      (tick.rootFreq / 2) * Math.pow(2, slot.semi / 12) * Math.pow(2, slot.octave)
    );
    const duration = slot.lengthSlots * tick.secondsPerSixteenth;
    const velocity = slot.velocity * volume;
    playNote(ctx, bassGain, {
      wave: 'triangle',
      time: tick.time,
      freq,
      duration,
      velocity
    });
  }

  return {
    start() {
      if (started) return;
      build();
      for (const osc of padOscs) osc.start();
      filterLFO?.start?.();
      padGainLFO?.start?.();
      unsubscribe = conductor?.subscribe?.(onTick) ?? null;
      started = true;
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      for (const osc of padOscs) { try { osc.stop(); } catch {} osc.disconnect?.(); }
      padOscs = [];
      try { filterLFO?.stop?.(); } catch {}
      filterLFO?.disconnect?.();
      filterLFOGain?.disconnect?.();
      try { padGainLFO?.stop?.(); } catch {}
      padGainLFO?.disconnect?.();
      padGainLFOGain?.disconnect?.();
      padFilter?.disconnect?.();
      padGain?.disconnect?.();
      bassGain?.disconnect?.();
      filterLFO = null;
      filterLFOGain = null;
      padGainLFO = null;
      padGainLFOGain = null;
      padFilter = null;
      padGain = null;
      bassGain = null;
      lastChordKey = '';
      started = false;
    },
    destroy() { this.stop(); },
    setVolume(v) {
      volume = v;
      if (padGain) padGain.gain.value = v * PAD_BASE_GAIN;
      if (bassGain) bassGain.gain.value = v * BASS_BUS_GAIN;
      if (padGainLFOGain) padGainLFOGain.gain.value = (v * PAD_BASE_GAIN) * PAD_LFO_DEPTH_RATIO;
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
        if (filterLFOGain) filterLFOGain.gain.value = t.filterFreq * FILTER_LFO_DEPTH_RATIO;
        for (const osc of padOscs) {
          osc.detune.cancelScheduledValues?.(now);
          osc.detune.setValueAtTime?.(osc.detune.value ?? 0, now);
        }
      }
    },
    getState() { return { audioMode, depth, oscillatorCount: padOscs.length }; }
  };
}
