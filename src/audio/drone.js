const TIMBRES = {
  'cold-ambient': { osc: 'sine', filterFreq: 800, detune: 5, mode: [0, 5, 10] },
  'foundry-industrial': { osc: 'sawtooth', filterFreq: 400, detune: 12, mode: [0, 3, 6] },
  'flowing-cyan': { osc: 'sine', filterFreq: 1200, detune: 3, mode: [0, 4, 11] },
  'compressed-yellow': { osc: 'square', filterFreq: 500, detune: 8, mode: [0, 3, 7] },
  'labyrinth-amber': { osc: 'triangle', filterFreq: 600, detune: 7, mode: [0, 1, 8] },
  'organic-green': { osc: 'sine', filterFreq: 1000, detune: 4, mode: [0, 4, 9] },
  'abyssal-magenta': { osc: 'sawtooth', filterFreq: 300, detune: 15, mode: [0, 4, 10] },
  'geometric-cyan': { osc: 'square', filterFreq: 900, detune: 6, mode: [0, 6, 10] },
  'layered-purple': { osc: 'triangle', filterFreq: 700, detune: 9, mode: [0, 3, 11] },
  'corrupted-red': { osc: 'sawtooth', filterFreq: 250, detune: 18, mode: [0, 1, 6] },
  'bioluminescent-teal': { osc: 'sine', filterFreq: 1400, detune: 3, mode: [0, 6, 11] },
  'ancient-bone': { osc: 'triangle', filterFreq: 450, detune: 10, mode: [0, 3, 10] }
};
const BASE_FREQ = 55;
const DEPTH_GLIDE = 1.2;

function setParam(param, value, time, glide = 0) {
  param.cancelScheduledValues?.(time);
  param.setValueAtTime?.(param.value ?? value, time);
  if (glide && param.linearRampToValueAtTime) param.linearRampToValueAtTime(value, time + glide);
  else param.value = value;
}

function depthBias(depth) {
  return Math.min(Math.max(depth - 1, 0), 30) * -0.35;
}

export function createDrone(ctx, dest) {
  let oscs = [];
  let filter = null;
  let gain = null;
  let started = false;
  let volume = 0.75;
  let audioMode = 'cold-ambient';
  let depth = 1;

  function timbre() { return TIMBRES[audioMode] || TIMBRES['cold-ambient']; }

  function voiceFreq(semitone) {
    return BASE_FREQ * Math.pow(2, (semitone + depthBias(depth)) / 12);
  }

  function build() {
    const t = timbre();
    gain = ctx.createGain();
    gain.gain.value = volume * 0.15;
    gain.connect(dest);
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = t.filterFreq;
    filter.Q.value = 1.5;
    filter.connect(gain);
    oscs = t.mode.flatMap((semitone) => [-1, 1].map((side) => {
      const osc = ctx.createOscillator();
      osc.type = t.osc;
      osc.frequency.value = voiceFreq(semitone);
      osc.detune.value = side * t.detune * (1 + Math.min(depth / 10, 2));
      osc.connect(filter);
      return osc;
    }));
  }

  function retune() {
    const t = timbre();
    setParam(filter.frequency, t.filterFreq, ctx.currentTime, DEPTH_GLIDE);
    let index = 0;
    for (const semitone of t.mode) {
      for (const side of [-1, 1]) {
        const osc = oscs[index++];
        if (!osc) continue;
        osc.type = t.osc;
        setParam(osc.frequency, voiceFreq(semitone), ctx.currentTime, DEPTH_GLIDE);
        setParam(osc.detune, side * t.detune * (1 + Math.min(depth / 10, 2)), ctx.currentTime, DEPTH_GLIDE);
      }
    }
  }

  return {
    start() { if (started) return; build(); for (const osc of oscs) osc.start(); started = true; },
    stop() { for (const osc of oscs) { try { osc.stop(); } catch {} osc.disconnect?.(); } filter?.disconnect?.(); gain?.disconnect?.(); oscs = []; started = false; },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * 0.15; },
    updateState(state) {
      const nextMode = state?.theme?.audioMode || state?.audioMode || audioMode;
      const nextDepth = state?.depth || depth;
      if (nextMode === audioMode && nextDepth === depth) return;
      audioMode = nextMode;
      depth = nextDepth;
      if (started) retune();
    },
    getState() { return { audioMode, depth, oscillatorCount: oscs.length }; }
  };
}
