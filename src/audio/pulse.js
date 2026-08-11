const MAX_DIST = 10;

function clampDistance(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_DIST, value)) : MAX_DIST;
}

export function createPulse(ctx, dest) {
  let gain = null;
  let filter = null;
  let schedulerId = null;
  let nextBeatTime = 0;
  let nearestDist = MAX_DIST;
  let combat = false;
  let volume = 0.75;

  function pressure() { return 1 - nearestDist / MAX_DIST; }
  function tempo() { return 60 + pressure() * (combat ? 150 : 90); }
  function beatInterval() { return 60 / tempo(); }

  function playBeat(time) {
    const p = pressure();
    const intervals = p > 0.6 ? [0, 1, 6] : p > 0.25 ? [0, 3] : [0];
    for (const semitone of intervals) {
      const osc = ctx.createOscillator();
      osc.type = p > 0.5 || combat ? 'sawtooth' : 'triangle';
      osc.frequency.value = 110 * Math.pow(2, semitone / 12);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime((combat ? 0.11 : 0.08) * volume, time + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      osc.connect(env);
      env.connect(filter);
      osc.start(time);
      osc.stop(time + 0.2);
    }
  }

  function scheduler() {
    while (nextBeatTime < ctx.currentTime + 0.2) {
      playBeat(nextBeatTime);
      nextBeatTime += beatInterval();
    }
  }

  return {
    start() {
      if (schedulerId) return;
      gain = ctx.createGain();
      gain.gain.value = 0.12 * volume;
      gain.connect(dest);
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.Q.value = 2;
      filter.connect(gain);
      nextBeatTime = ctx.currentTime + 0.1;
      schedulerId = setInterval(scheduler, 50);
    },
    stop() { if (schedulerId) clearInterval(schedulerId); schedulerId = null; filter?.disconnect?.(); gain?.disconnect?.(); },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * 0.12; },
    updateState(state) {
      nearestDist = clampDistance(state?.proximity?.hostile ?? state?.nearestHostileDistance);
      combat = Boolean(state?.combatActive || state?.combatState);
      if (filter?.frequency) filter.frequency.linearRampToValueAtTime?.(400 + pressure() * (combat ? 1600 : 900), ctx.currentTime + 0.1);
    },
    getState() { return { nearestDist, combat, tempo: tempo() }; }
  };
}
