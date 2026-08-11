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
const LEDGER_LIMIT = 32;

export function generateLeadBar({ worldSeed = 0, depth = 1, floorId = '', barIndex = 0, audioMode = 'cold-ambient', perturb = 0 }) {
  const mode = MODES[audioMode] || MODES['cold-ambient'];
  return Array.from({ length: BEATS_PER_BAR }, (_, beat) => {
    const h = hash(worldSeed, depth, floorId, barIndex, beat, perturb);
    return { degree: mode[h % mode.length], octave: (h >>> 8) % 2, duration: 1, velocity: 0.05 + ((h >>> 16) % 4) * 0.01 };
  });
}

function keyFor(notes) {
  return notes.map((note) => `${note.degree}:${note.octave}:${note.velocity.toFixed(2)}`).join(',');
}

export function createLead(ctx, dest) {
  let gain = null;
  let schedulerId = null;
  let nextBarTime = 0;
  let barIndex = 0;
  let volume = 0.75;
  let tempo = BASE_TEMPO;
  let state = { worldSeed: 0, depth: 1, floorId: '', audioMode: 'cold-ambient', combat: false };
  const ledger = [];

  function barDuration() { return (60 / tempo) * BEATS_PER_BAR; }

  function uniqueBar(index) {
    let perturb = 0;
    let notes = generateLeadBar({ ...state, barIndex: index, perturb });
    let key = keyFor(notes);
    while (ledger.includes(key)) {
      perturb++;
      notes = generateLeadBar({ ...state, barIndex: index, perturb });
      key = keyFor(notes);
    }
    ledger.push(key);
    while (ledger.length > LEDGER_LIMIT) ledger.shift();
    return notes;
  }

  function playBar(time, notes) {
    const beatDur = barDuration() / BEATS_PER_BAR;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const noteStart = time + i * beatDur;
      const osc = ctx.createOscillator();
      osc.type = state.combat ? 'square' : 'triangle';
      osc.frequency.value = ROOT_FREQ * Math.pow(2, (note.degree + note.octave * 12) / 12);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, noteStart);
      env.gain.linearRampToValueAtTime(note.velocity * volume * (state.combat ? 1.25 : 1), noteStart + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, noteStart + beatDur * (state.combat ? 0.55 : 0.9));
      osc.connect(env);
      env.connect(gain);
      osc.start(noteStart);
      osc.stop(noteStart + beatDur);
    }
  }

  function scheduler() {
    while (nextBarTime < ctx.currentTime + 0.3) {
      playBar(nextBarTime, uniqueBar(barIndex++));
      nextBarTime += barDuration();
    }
  }

  return {
    start() { if (schedulerId) return; gain = ctx.createGain(); gain.gain.value = 0.1 * volume; gain.connect(dest); nextBarTime = ctx.currentTime + 0.1; barIndex = 0; ledger.length = 0; schedulerId = setInterval(scheduler, 100); },
    stop() { if (schedulerId) clearInterval(schedulerId); schedulerId = null; gain?.disconnect?.(); },
    destroy() { this.stop(); },
    setVolume(v) { volume = v; if (gain) gain.gain.value = v * 0.1; },
    updateState(nextState) {
      const nextFloor = nextState?.floorId;
      const nextMode = nextState?.theme?.audioMode || nextState?.audioMode;
      if (nextState?.worldSeed !== undefined) state.worldSeed = nextState.worldSeed;
      if (nextState?.depth !== undefined) state.depth = nextState.depth;
      if (nextMode) state.audioMode = nextMode;
      state.combat = Boolean(nextState?.combatActive || nextState?.combatState);
      tempo = BASE_TEMPO * (state.combat ? 1.25 : 1);
      if (nextFloor !== undefined && nextFloor !== state.floorId) { state.floorId = nextFloor; barIndex = 0; ledger.length = 0; }
    },
    getLedger() { return [...ledger]; },
    getState() { return { ...state, tempo, barIndex }; }
  };
}
