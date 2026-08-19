const WAVE_CACHE = new WeakMap();

const DUTY_TO_WAVE = { pulse125: 0.125, pulse25: 0.25, pulse50: 0.5 };

function waveMap(ctx) {
  let map = WAVE_CACHE.get(ctx);
  if (!map) { map = new Map(); WAVE_CACHE.set(ctx, map); }
  return map;
}

export function dutyWave(ctx, duty) {
  const cache = waveMap(ctx);
  const key = `duty:${duty}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const N = 32;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  const wave = ctx.createPeriodicWave(real, imag);
  cache.set(key, wave);
  return wave;
}

export function buildLFSRBuffer(ctx, { short = false } = {}) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let state = 1;
  for (let i = 0; i < length; i++) {
    const b0 = state & 1;
    const other = short ? ((state >> 6) & 1) : ((state >> 1) & 1);
    const fb = b0 ^ other;
    state = (state >> 1) | (fb << 14);
    data[i] = (state & 1) ? 0.5 : -0.5;
  }
  return buffer;
}

function configureOscWave(ctx, osc, wave) {
  if (wave === 'triangle') {
    osc.type = 'triangle';
    return;
  }
  const duty = DUTY_TO_WAVE[wave];
  if (duty === undefined) {
    osc.type = 'triangle';
    return;
  }
  const pw = dutyWave(ctx, duty);
  osc.type = 'custom';
  osc.setPeriodicWave(pw);
}

export function playNote(ctx, dest, {
  wave,
  time,
  freq,
  duration,
  velocity,
  decay = 0.9,
  vibrato = null,
  slideTo = null
}) {
  const osc = ctx.createOscillator();
  configureOscWave(ctx, osc, wave);
  osc.frequency.setValueAtTime(freq, time);
  if (slideTo && slideTo !== freq) {
    osc.frequency.linearRampToValueAtTime(slideTo, time + duration);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(velocity, time + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, time + duration * decay);
  osc.connect(env);
  env.connect(dest);
  if (vibrato && vibrato.rate && vibrato.depth) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(vibrato.rate, time);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(vibrato.depth, time);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start(time);
    lfo.stop(time + duration + 0.05);
  }
  osc.start(time);
  osc.stop(time + duration + 0.05);
}

export function playKick(ctx, dest, { time, velocity }) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(110, time);
  osc.frequency.exponentialRampToValueAtTime(38, time + 0.09);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(velocity, time + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  osc.connect(env);
  env.connect(dest);
  osc.start(time);
  osc.stop(time + 0.15);
}

export function playSnare(ctx, dest, { time, velocity, noiseBuffer }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const noiseEnv = ctx.createGain();
  noiseEnv.gain.setValueAtTime(0, time);
  noiseEnv.gain.linearRampToValueAtTime(velocity * 0.7, time + 0.003);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  src.connect(noiseEnv);
  noiseEnv.connect(dest);
  src.start(time);
  src.stop(time + 0.15);
  const thump = ctx.createOscillator();
  thump.type = 'triangle';
  thump.frequency.setValueAtTime(180, time);
  const thumpEnv = ctx.createGain();
  thumpEnv.gain.setValueAtTime(0, time);
  thumpEnv.gain.linearRampToValueAtTime(velocity * 0.4, time + 0.003);
  thumpEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  thump.connect(thumpEnv);
  thumpEnv.connect(dest);
  thump.start(time);
  thump.stop(time + 0.09);
}

export function playHat(ctx, dest, { time, velocity, shortBuffer }) {
  const src = ctx.createBufferSource();
  src.buffer = shortBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(6000, time);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(velocity * 0.5, time + 0.002);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
  src.connect(hp);
  hp.connect(env);
  env.connect(dest);
  src.start(time);
  src.stop(time + 0.05);
}

export function createEchoSend(ctx, { delayTime = 0.27, feedback = 0.25, level = 0.18 } = {}) {
  const input = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = delayTime;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 2200;
  const fbGain = ctx.createGain();
  fbGain.gain.value = feedback;
  const levelGain = ctx.createGain();
  levelGain.gain.value = level;
  input.connect(delay);
  delay.connect(lowpass);
  lowpass.connect(fbGain);
  fbGain.connect(delay);
  delay.connect(levelGain);
  return {
    input,
    connect(dest) { levelGain.connect(dest); },
    disconnect() {
      try { input.disconnect(); } catch {}
      try { delay.disconnect(); } catch {}
      try { lowpass.disconnect(); } catch {}
      try { fbGain.disconnect(); } catch {}
      try { levelGain.disconnect(); } catch {}
    }
  };
}
