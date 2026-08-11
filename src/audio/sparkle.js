const MAX_DIST = 10;
const ARPEGGIO = [0, 7, 12, 19, 24];

function clampDistance(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_DIST, value)) : MAX_DIST;
}

export function createSparkle(ctx, dest) {
  let gain = null;
  let filter = null;
  let schedulerId = null;
  let nextBeatTime = 0;
  let nearestDist = MAX_DIST;
  let step = 0;
  let volume = 0.75;

  function pressure() { return 1 - nearestDist / MAX_DIST; }
  function cutoff() { return 400 + pressure() * 3000; }
  function beatInterval() { return 0.3 - pressure() * 0.22; }

  function playNote(time) {
    const degree = ARPEGGIO[step++ % ARPEGGIO.length];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 880 * Math.pow(2, degree / 12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.06 * volume, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.connect(env);
    env.connect(filter);
    osc.start(time);
    osc.stop(time + 0.35);
  }

  function scheduler() {
    while (nextBeatTime < ctx.currentTime + 0.2) {
      if (pressure() > 0) playNote(nextBeatTime);
      nextBeatTime += beatInterval();
    }
  }

  return {
    start() {
      if (schedulerId) return;
      gain = ctx.createGain();
      gain.gain.value = 0.08 * volume;
      gain.connect(dest);
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff();
      filter.Q.value = 0.5;
      filter.connect(gain);
      nextBeatTime = ctx.currentTime + 0.1;
      schedulerId = setInterval(scheduler, 50);
    },
    stop() { if (schedulerId) clearInterval(schedulerId); schedulerId = null; filter?.disconnect?.(); gain?.disconnect?.(); },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * 0.08; },
    updateState(state) {
      nearestDist = clampDistance(state?.proximity?.container ?? state?.nearestContainerDistance);
      filter?.frequency?.linearRampToValueAtTime?.(cutoff(), ctx.currentTime + 0.1);
    },
    getState() { return { nearestDist, cutoff: cutoff(), interval: beatInterval() }; }
  };
}
