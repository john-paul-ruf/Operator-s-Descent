const TIMBRES = {
  'cold-ambient': { osc: 'sine', filterFreq: 800, detune: 5 },
  'foundry-industrial': { osc: 'sawtooth', filterFreq: 400, detune: 12 },
  'flowing-cyan': { osc: 'sine', filterFreq: 1200, detune: 3 },
  'compressed-yellow': { osc: 'square', filterFreq: 500, detune: 8 },
  'labyrinth-amber': { osc: 'triangle', filterFreq: 600, detune: 7 },
  'organic-green': { osc: 'sine', filterFreq: 1000, detune: 4 },
  'abyssal-magenta': { osc: 'sawtooth', filterFreq: 300, detune: 15 },
  'geometric-cyan': { osc: 'square', filterFreq: 900, detune: 6 },
  'layered-purple': { osc: 'triangle', filterFreq: 700, detune: 9 },
  'corrupted-red': { osc: 'sawtooth', filterFreq: 250, detune: 18 },
  'bioluminescent-teal': { osc: 'sine', filterFreq: 1400, detune: 3 },
  'ancient-bone': { osc: 'triangle', filterFreq: 450, detune: 10 }
};

const BASE_FREQ = 55;
const SCALE = [0, 3, 5, 7, 10];

export function createDrone(ctx, dest) {
  let oscs = [];
  let filter = null;
  let gain = null;
  let started = false;
  let currentMode = 'cold-ambient';
  let depth = 1;

  function build() {
    const timbre = TIMBRES[currentMode] || TIMBRES['cold-ambient'];
    const depthDrop = Math.min(depth - 1, 20) * 0.5;
    const detuneSpread = timbre.detune * (1 + Math.min(depth / 10, 2));

    const rootFreq = BASE_FREQ * Math.pow(2, -depthDrop / 12);

    gain = ctx.createGain();
    gain.gain.value = 0.15;
    gain.connect(dest);

    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = timbre.filterFreq;
    filter.Q.value = 1.5;
    filter.connect(gain);

    const scaleDegrees = [SCALE[0], SCALE[2], SCALE[4]];
    for (let i = 0; i < scaleDegrees.length; i++) {
      const semis = scaleDegrees[i];
      const freq = rootFreq * Math.pow(2, semis / 12);
      for (let d = 0; d < 2; d++) {
        const osc = ctx.createOscillator();
        osc.type = timbre.osc;
        osc.frequency.value = freq;
        osc.detune.value = (d === 0 ? -detuneSpread : detuneSpread);
        osc.connect(filter);
        oscs.push(osc);
      }
    }
  }

  return {
    start() {
      if (started) return;
      build();
      for (const o of oscs) o.start();
      started = true;
    },
    stop() {
      for (const o of oscs) { try { o.stop(); } catch {} }
      oscs = [];
      started = false;
    },
    setVolume(v) {
      if (gain) gain.gain.value = v * 0.15;
    },
    updateState(state) {
      if (!started) return;
      const mode = state?.theme?.audioMode || state?.audioMode;
      const newDepth = state?.depth || 1;
      if (mode && mode !== currentMode || newDepth !== depth) {
        currentMode = mode || currentMode;
        depth = newDepth;
        for (const o of oscs) { try { o.stop(); } catch {} }
        oscs = [];
        build();
        for (const o of oscs) o.start();
      }
    }
  };
}