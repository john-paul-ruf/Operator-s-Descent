export function createNoiseBed(ctx, dest) {
  let started = false;
  let gain = null;
  let noiseSource = null;
  let wowOsc = null;
  let wowGain = null;
  let flutterOsc = null;
  let flutterGain = null;

  return {
    start() {
      if (started) return;
      gain = ctx.createGain();
      gain.gain.value = 0.03;
      gain.connect(dest);

      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      noiseSource = ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 2000;
      noiseFilter.Q.value = 0.3;

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(gain);
      noiseSource.start();

      wowOsc = ctx.createOscillator();
      wowOsc.frequency.value = 0.5;
      wowGain = ctx.createGain();
      wowGain.gain.value = 0.02;
      wowOsc.connect(wowGain);
      wowGain.connect(gain.gain);
      wowOsc.start();

      flutterOsc = ctx.createOscillator();
      flutterOsc.frequency.value = 5;
      flutterGain = ctx.createGain();
      flutterGain.gain.value = 0.005;
      flutterOsc.connect(flutterGain);
      flutterGain.connect(gain.gain);
      flutterOsc.start();

      started = true;
    },
    stop() {
      try { noiseSource?.stop(); } catch {}
      try { wowOsc?.stop(); } catch {}
      try { flutterOsc?.stop(); } catch {}
      started = false;
    },
    setVolume(v) {
      if (gain) gain.gain.value = v * 0.03;
    },
    updateState() {}
  };
}