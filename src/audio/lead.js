import { hash } from '../core/hash.js';

const MODES = {
  'cold-ambient': [0, 2, 3, 5, 7, 8, 10],
  'foundry-industrial': [0, 1, 3, 5, 6, 8, 10],
  'flowing-cyan': [0, 2, 4, 5, 7, 9, 11],
  'compressed-yellow': [0, 2, 3, 5, 7, 8, 10],
  'labyrinth-amber': [0, 1, 3, 4, 6, 8, 9],
  'organic-green': [0, 2, 4, 5, 7, 9, 11],
  'abyssal-magenta': [0, 1, 3, 4, 6, 7, 10],
  'geometric-cyan': [0, 2, 3, 5, 6, 8, 10],
  'layered-purple': [0, 2, 3, 5, 7, 8, 11],
  'corrupted-red': [0, 1, 3, 4, 6, 8, 10],
  'bioluminescent-teal': [0, 2, 4, 6, 7, 9, 11],
  'ancient-bone': [0, 2, 3, 5, 7, 8, 10]
};

const BEATS_PER_BAR = 4;
const BASE_TEMPO = 72;
const ROOT_FREQ = 220;
const PERTURB_RANGE = 7;

export function createLead(ctx, dest) {
  let started = false;
  let gain = null;
  let schedulerId = null;
  let nextBeatTime = 0;
  let worldSeed = 0;
  let depth = 1;
  let floorId = '';
  let barIndex = 0;
  const ledger = new Set();

  function barDuration() {
    return (60 / BASE_TEMPO) * BEATS_PER_BAR;
  }

  function generateBar(barIdx) {
    const mode = MODES['cold-ambient'];
    const notes = [];
    for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
      const h = hash(worldSeed, depth, floorId, barIdx, beat);
      const degreeIdx = h % mode.length;
      const octave = (h >>> 8) % 2;
      notes.push({ degree: mode[degreeIdx], octave, duration: 1 });
    }
    return notes;
  }

  function barHash(barIdx) {
    const notes = generateBar(barIdx);
    const key = notes.map(n => `${n.degree}:${n.octave}`).join(',');
    if (!ledger.has(key)) {
      ledger.add(key);
      return notes;
    }
    let attempts = 0;
    while (attempts < PERTURB_RANGE) {
      const perturbed = generateBar(barIdx + attempts + 1);
      const pKey = perturbed.map(n => `${n.degree}:${n.octave}`).join(',');
      if (!ledger.has(pKey)) {
        ledger.add(pKey);
        return perturbed;
      }
      attempts++;
    }
    return notes;
  }

  function playBar(time, notes) {
    const beatDur = barDuration() / BEATS_PER_BAR;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const freq = ROOT_FREQ * Math.pow(2, (note.degree + note.octave * 12) / 12);
      const noteStart = time + i * beatDur;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, noteStart);
      env.gain.linearRampToValueAtTime(0.07, noteStart + 0.02);
      env.gain.linearRampToValueAtTime(0.05, noteStart + beatDur * 0.6);
      env.gain.exponentialRampToValueAtTime(0.001, noteStart + beatDur * 0.9);

      osc.connect(env);
      env.connect(gain);
      osc.start(noteStart);
      osc.stop(noteStart + beatDur);
    }
  }

  function scheduler() {
    const lookahead = 0.3;
    while (nextBeatTime < ctx.currentTime + lookahead) {
      const notes = barHash(barIndex);
      playBar(nextBeatTime, notes);
      nextBeatTime += barDuration();
      barIndex++;
    }
  }

  return {
    start() {
      if (started) return;
      gain = ctx.createGain();
      gain.gain.value = 0.1;
      gain.connect(dest);

      nextBeatTime = ctx.currentTime + 0.1;
      ledger.clear();
      barIndex = 0;
      schedulerId = setInterval(scheduler, 100);
      started = true;
    },
    stop() {
      if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
      started = false;
    },
    setVolume(v) {
      if (gain) gain.gain.value = v * 0.1;
    },
    updateState(state) {
      if (state?.worldSeed !== undefined) worldSeed = state.worldSeed;
      if (state?.depth !== undefined) depth = state.depth;
      if (state?.floorId !== undefined) {
        if (state.floorId !== floorId) {
          floorId = state.floorId;
          ledger.clear();
          barIndex = 0;
        }
      }
    }
  };
}