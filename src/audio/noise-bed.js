const BASE_GAIN = 0.007;
const DRIFT_LFO_HZ = 0.05;
const DRIFT_CENTER = 1900;
const DRIFT_DEPTH = 700;

function noiseSample(index) {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export function createNoiseBed(ctx, dest) {
  let gain = null;
  let nodes = [];
  let volume = 0.75;

  function remember(node) {
    nodes.push(node);
    return node;
  }

  return {
    start() {
      if (nodes.length) return;
      gain = remember(ctx.createGain());
      gain.gain.value = BASE_GAIN * volume;
      gain.connect(dest);
      const bufferSize = Math.floor(ctx.sampleRate * 2);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = noiseSample(i);
      const source = remember(ctx.createBufferSource());
      source.buffer = buffer;
      source.loop = true;
      const filter = remember(ctx.createBiquadFilter());
      filter.type = 'bandpass';
      filter.frequency.value = DRIFT_CENTER;
      filter.Q.value = 0.3;
      source.connect(filter);
      filter.connect(gain);
      source.start();
      const wow = remember(ctx.createOscillator());
      const wowGain = remember(ctx.createGain());
      wow.frequency.value = 0.5;
      wowGain.gain.value = 0.02;
      wow.connect(wowGain);
      wowGain.connect(gain.gain);
      wow.start();
      const flutter = remember(ctx.createOscillator());
      const flutterGain = remember(ctx.createGain());
      flutter.frequency.value = 5;
      flutterGain.gain.value = 0.005;
      flutter.connect(flutterGain);
      flutterGain.connect(gain.gain);
      flutter.start();
      const drift = remember(ctx.createOscillator());
      const driftGain = remember(ctx.createGain());
      drift.type = 'sine';
      drift.frequency.value = DRIFT_LFO_HZ;
      driftGain.gain.value = DRIFT_DEPTH;
      drift.connect(driftGain);
      driftGain.connect(filter.frequency);
      drift.start();
    },
    stop() { for (const node of nodes) { try { node.stop?.(); } catch {} node.disconnect?.(); } nodes = []; gain = null; },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * BASE_GAIN; },
    updateState() {},
    getNodeCount() { return nodes.length; }
  };
}
