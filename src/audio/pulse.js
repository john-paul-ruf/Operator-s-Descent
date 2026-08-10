const BASE_TEMPO = 60;
const MIN_DIST = 1;
const MAX_DIST = 10;

export function createPulse(ctx, dest) {
  let started = false;
  let gain = null;
  let filter = null;
  let schedulerId = null;
  let nextBeatTime = 0;
  let nearestDist = MAX_DIST;

  function tempo() {
    const t = Math.min(nearestDist / MAX_DIST, 1);
    return BASE_TEMPO * (1 + (1 - t) * 2);
  }

  function beatInterval() {
    return 60 / tempo();
  }

  function dissonance() {
    const t = Math.min(nearestDist / MAX_DIST, 1);
    return (1 - t);
  }

  function playBeat(time) {
    const dis = dissonance();
    const intervals = dis > 0.5 ? [0, 1, 6] : dis > 0.2 ? [0, 3] : [0];
    const baseFreq = 110;

    for (const semis of intervals) {
      const freq = baseFreq * Math.pow(2, semis / 12);
      const osc = ctx.createOscillator();
      osc.type = dis > 0.5 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.08, time + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

      osc.connect(env);
      env.connect(filter);
      osc.start(time);
      osc.stop(time + 0.2);
    }
  }

  function scheduler() {
    const lookahead = 0.2;
    while (nextBeatTime < ctx.currentTime + lookahead) {
      playBeat(nextBeatTime);
      nextBeatTime += beatInterval();
    }
  }

  return {
    start() {
      if (started) return;
      gain = ctx.createGain();
      gain.gain.value = 0.12;
      gain.connect(dest);

      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.Q.value = 2;
      filter.connect(gain);

      nextBeatTime = ctx.currentTime + 0.1;
      schedulerId = setInterval(scheduler, 50);
      started = true;
    },
    stop() {
      if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
      started = false;
    },
    setVolume(v) {
      if (gain) gain.gain.value = v * 0.12;
    },
    updateState(state) {
      const d = state?.nearestHostileDistance;
      if (d !== undefined) nearestDist = Math.max(MIN_DIST, Math.min(MAX_DIST, d));
    }
  };
}