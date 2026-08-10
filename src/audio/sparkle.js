const BASE_FREQ = 880;
const ARPEGGIO = [0, 7, 12, 19, 24];
const MAX_DIST = 10;

export function createSparkle(ctx, dest) {
  let started = false;
  let gain = null;
  let filter = null;
  let schedulerId = null;
  let nextBeatTime = 0;
  let nearestDist = MAX_DIST;

  function density() {
    const t = Math.min(nearestDist / MAX_DIST, 1);
    return 1 - t;
  }

  function cutoff() {
    const t = Math.min(nearestDist / MAX_DIST, 1);
    return 400 + (1 - t) * 3000;
  }

  function beatInterval() {
    return 0.3 - density() * 0.22;
  }

  function playNote(time) {
    const degree = ARPEGGIO[Math.floor(Math.random() * ARPEGGIO.length)];
    const freq = BASE_FREQ * Math.pow(2, degree / 12);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.06, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

    osc.connect(env);
    env.connect(filter);
    osc.start(time);
    osc.stop(time + 0.35);
  }

  function scheduler() {
    const lookahead = 0.2;
    while (nextBeatTime < ctx.currentTime + lookahead) {
      if (Math.random() < density()) {
        playNote(nextBeatTime);
      }
      nextBeatTime += beatInterval();
    }
  }

  return {
    start() {
      if (started) return;
      gain = ctx.createGain();
      gain.gain.value = 0.08;
      gain.connect(dest);

      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff();
      filter.Q.value = 0.5;
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
      if (gain) gain.gain.value = v * 0.08;
    },
    updateState(state) {
      const d = state?.nearestContainerDistance;
      if (d !== undefined) {
        nearestDist = Math.max(0, Math.min(MAX_DIST, d));
        if (filter) {
          const t = Math.min(nearestDist / MAX_DIST, 1);
          filter.frequency.value = 400 + (1 - t) * 3000;
        }
      }
    }
  };
}