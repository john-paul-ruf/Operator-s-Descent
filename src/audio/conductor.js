import { hash } from '../core/hash.js';

export const SCALES = {
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

export const ROOTS = {
  'cold-ambient': 0,
  'foundry-industrial': -4,
  'flowing-cyan': 2,
  'compressed-yellow': -2,
  'labyrinth-amber': 1,
  'organic-green': 5,
  'abyssal-magenta': -7,
  'geometric-cyan': 3,
  'layered-purple': -5,
  'corrupted-red': 6,
  'bioluminescent-teal': 7,
  'ancient-bone': -1
};

const DARK_POOL = [
  [0, 5, 3, 6],
  [0, 3, 4, 0],
  [0, 6, 5, 6],
  [0, 2, 5, 4],
  [0, 4, 5, 3],
  [0, 6, 2, 4]
];

const BRIGHT_POOL = [
  [0, 4, 5, 3],
  [0, 3, 4, 3],
  [0, 5, 3, 4],
  [0, 2, 3, 4],
  [0, 4, 0, 4],
  [0, 3, 0, 4]
];

const RHYTHM_MASKS = {
  low: [
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
  ],
  mid: [
    [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1],
    [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0]
  ],
  high: [
    [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1],
    [1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
    [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1]
  ]
};

const PROGRESSION_MAX_PERTURB = 24;
const MELODY_MAX_PERTURB = 12;

export function chordFor(scale, degree) {
  const semis = [];
  for (const offset of [0, 2, 4]) {
    const step = degree + offset;
    const wrap = Math.floor(step / scale.length);
    semis.push(scale[((step % scale.length) + scale.length) % scale.length] + 12 * wrap);
  }
  return { degree, semis };
}

export function progressionFor({
  worldSeed = 0,
  depth = 1,
  floorId = '',
  phraseIndex = 0,
  audioMode = 'cold-ambient',
  avoid = []
} = {}) {
  const scale = SCALES[audioMode] || SCALES['cold-ambient'];
  const darkness = Math.min(Math.max(depth, 0), 30) / 30;
  const avoidSet = new Set(avoid);
  for (let perturb = 0; perturb < PROGRESSION_MAX_PERTURB; perturb++) {
    const h = hash(worldSeed, depth, floorId, phraseIndex, 'progression', perturb);
    const roll = ((h >>> 8) & 0xff) / 256;
    const useDark = roll < darkness;
    const pool = useDark ? DARK_POOL : BRIGHT_POOL;
    const degrees = pool[(h >>> 16) % pool.length];
    const key = degrees.join('-');
    if (!avoidSet.has(key)) {
      return { key, chords: degrees.map((d) => chordFor(scale, d)) };
    }
  }
  const h = hash(worldSeed, depth, floorId, phraseIndex, 'progression', PROGRESSION_MAX_PERTURB);
  const pool = darkness >= 0.5 ? DARK_POOL : BRIGHT_POOL;
  const degrees = pool[h % pool.length];
  return { key: degrees.join('-'), chords: degrees.map((d) => chordFor(scale, d)) };
}

export function melodyBar({
  worldSeed = 0,
  depth = 1,
  floorId = '',
  phraseIndex = 0,
  barInPhrase = 0,
  chord = { degree: 0, semis: [0, 4, 7] },
  scale = SCALES['cold-ambient'],
  intensity = 0.15,
  perturb = 0
} = {}) {
  const band = intensity < 0.35 ? 'low' : intensity < 0.7 ? 'mid' : 'high';
  const masks = RHYTHM_MASKS[band];
  const maskHash = hash(worldSeed, depth, floorId, phraseIndex, barInPhrase, 'mask', perturb);
  const mask = masks[maskHash % masks.length].slice();
  const zeros = [];
  for (let i = 0; i < 16; i++) if (!mask[i]) zeros.push(i);
  const flipCount = (maskHash >>> 4) % 3;
  for (let f = 0; f < flipCount && zeros.length; f++) {
    const pickIndex = (maskHash >>> (8 + f * 4)) % zeros.length;
    const slot = zeros.splice(pickIndex, 1)[0];
    mask[slot] = 1;
  }
  const onsets = [];
  for (let i = 0; i < 16; i++) if (mask[i]) onsets.push(i);
  const slots = new Array(16).fill(null);
  const chordSemis = chord.semis;
  for (let idx = 0; idx < onsets.length; idx++) {
    const i = onsets[idx];
    const noteHash = hash(worldSeed, depth, floorId, phraseIndex, barInPhrase, 'note', i, perturb);
    const isDownbeat = i === 0 || i === 4 || i === 8 || i === 12;
    let degree = isDownbeat
      ? chordSemis[noteHash % chordSemis.length]
      : scale[noteHash % scale.length];
    if (barInPhrase >= 6 && idx === onsets.length - 1) degree = chordSemis[0];
    const octave = (noteHash >>> 8) & 1;
    const velocity = 0.4 + ((noteHash >>> 12) & 0xf) / 15 * 0.5;
    const next = onsets[idx + 1] ?? 16;
    const lengthSlots = Math.min(4, next - i);
    slots[i] = { degree, octave, velocity, lengthSlots };
  }
  return slots;
}

export function drumPattern({ tier = 0, barInPhrase = 0, h = 0 } = {}) {
  const kick = new Array(16).fill(false);
  const snare = new Array(16).fill(false);
  const hat = new Array(16).fill(false);
  const set = (arr, indices) => { for (const i of indices) arr[i] = true; };
  if (tier <= 0) {
    set(kick, [0, 3]);
  } else if (tier === 1) {
    set(kick, [0, 8]);
    set(hat, [4, 12]);
  } else if (tier === 2) {
    set(kick, [0, 6, 8]);
    set(snare, [8]);
    for (let i = 0; i < 16; i += 2) hat[i] = true;
  } else {
    const kickChoices = [[0, 4, 8, 12], [0, 3, 6, 10]];
    set(kick, kickChoices[(h >>> 4) % kickChoices.length]);
    set(snare, [4, 12]);
    for (let i = 0; i < 16; i++) hat[i] = true;
  }
  if (tier >= 2 && barInPhrase === 7) set(snare, [12, 13, 14, 15]);
  const flipCount = (h >>> 8) % 3;
  for (let f = 0; f < flipCount; f++) {
    const idx = (h >>> (12 + f * 4)) % 16;
    hat[idx] = !hat[idx];
  }
  return { kick, snare, hat };
}

export function directorTargets({
  depth = 1,
  proximity = {},
  combatActive = false,
  combatState = null
} = {}) {
  const combat = Boolean(combatActive || combatState);
  const hostileDist = Number.isFinite(proximity.hostile) ? proximity.hostile : 10;
  const containerDist = Number.isFinite(proximity.container) ? proximity.container : 10;
  const danger = 1 - Math.min(Math.max(hostileDist, 0), 10) / 10;
  const clampedDepth = Math.min(Math.max(depth - 1, 0), 30);
  const floorBase = 0.15 + (clampedDepth / 30) * 0.25;
  const intensity = combat ? 1 : Math.max(floorBase, danger * 0.9);
  const sparkle = 1 - Math.min(Math.max(containerDist, 0), 10) / 10;
  const tempoRaw = 92 + clampedDepth + intensity * 26 + (combat ? 18 : 0);
  const tempo = Math.max(92, Math.min(176, Math.round(tempoRaw)));
  return { intensity, sparkle, tempo, combat };
}

const LOOKAHEAD_MS = 25;
const HORIZON_S = 0.12;
const PROGRESSION_LEDGER_CAP = 4;
const MELODY_LEDGER_CAP = 64;

function tierFor(intensity, combat) {
  if (combat) return 3;
  if (intensity < 0.25) return 0;
  if (intensity < 0.5) return 1;
  if (intensity < 0.75) return 2;
  return 3;
}

function smooth(current, target) {
  const rate = target > current ? 0.35 : 0.06;
  return current + (target - current) * rate;
}

export function createConductor(ctx) {
  const subs = new Set();
  const active = { worldSeed: 0, depth: 1, floorId: '', audioMode: 'cold-ambient' };
  let pending = null;
  let latestGameState = {};

  let running = false;
  let intervalId = null;
  let nextTickTime = 0;

  let step = 0;
  let bar = 0;
  let barInPhrase = 0;
  let phraseIndex = 0;

  let barTempo = 96;
  let smoothedIntensity = 0;
  let smoothedSparkle = 0;
  let combatOn = false;

  let currentProgression = null;
  let currentChord = null;
  let currentMelody = new Array(16).fill(null);
  let currentDrums = { kick: new Array(16).fill(false), snare: new Array(16).fill(false), hat: new Array(16).fill(false) };

  let progressionLedger = [];
  let melodyLedger = new Set();
  let melodyLedgerOrder = [];

  function refreshProgression() {
    currentProgression = progressionFor({
      worldSeed: active.worldSeed,
      depth: active.depth,
      floorId: active.floorId,
      phraseIndex,
      audioMode: active.audioMode,
      avoid: [...progressionLedger]
    });
    progressionLedger.push(currentProgression.key);
    while (progressionLedger.length > PROGRESSION_LEDGER_CAP) progressionLedger.shift();
  }

  function refreshBar() {
    const chordIdx = Math.floor(barInPhrase / 2);
    currentChord = currentProgression.chords[chordIdx];
    const scale = SCALES[active.audioMode] || SCALES['cold-ambient'];
    let candidate = null;
    let key = '';
    for (let perturb = 0; perturb <= MELODY_MAX_PERTURB; perturb++) {
      candidate = melodyBar({
        worldSeed: active.worldSeed,
        depth: active.depth,
        floorId: active.floorId,
        phraseIndex,
        barInPhrase,
        chord: currentChord,
        scale,
        intensity: smoothedIntensity,
        perturb
      });
      key = candidate.map((s) => (s ? `${s.degree}.${s.octave}.${s.lengthSlots}` : '_')).join('|');
      if (!melodyLedger.has(key)) break;
    }
    melodyLedger.add(key);
    melodyLedgerOrder.push(key);
    while (melodyLedgerOrder.length > MELODY_LEDGER_CAP) {
      const dropped = melodyLedgerOrder.shift();
      melodyLedger.delete(dropped);
    }
    currentMelody = candidate;
    const drumHash = hash(active.worldSeed, active.depth, active.floorId, phraseIndex, barInPhrase, 'drums');
    currentDrums = drumPattern({ tier: tierFor(smoothedIntensity, combatOn), barInPhrase, h: drumHash });
  }

  function emitTick() {
    const target = directorTargets(latestGameState);
    combatOn = target.combat;
    smoothedIntensity = smooth(smoothedIntensity, target.intensity);
    smoothedSparkle = smooth(smoothedSparkle, target.sparkle);

    if (step === 0) {
      let floorChanged = false;
      if (pending) {
        if (pending.floorId !== undefined && pending.floorId !== active.floorId) floorChanged = true;
        Object.assign(active, pending);
        pending = null;
      }
      if (floorChanged) {
        phraseIndex = 0;
        barInPhrase = 0;
        progressionLedger.length = 0;
        melodyLedger.clear();
        melodyLedgerOrder.length = 0;
        currentProgression = null;
      }
      if (!currentProgression || barInPhrase === 0) refreshProgression();
      refreshBar();
      barTempo = target.tempo;
    }

    const secondsPerSixteenth = (60 / barTempo) / 4;
    const scale = SCALES[active.audioMode] || SCALES['cold-ambient'];
    const rootShift = ROOTS[active.audioMode] ?? 0;
    const octaveDrop = Math.floor(Math.min(Math.max(active.depth, 0), 24) / 12);
    const rootFreq = 110 * Math.pow(2, rootShift / 12) * Math.pow(2, -octaveDrop);

    const payload = {
      time: nextTickTime,
      pos: { step, beat: Math.floor(step / 4), bar, barInPhrase, phraseIndex },
      tempo: barTempo,
      secondsPerSixteenth,
      chord: currentChord,
      scale,
      rootFreq,
      intensity: smoothedIntensity,
      sparkle: smoothedSparkle,
      combat: combatOn,
      melody: currentMelody,
      drums: currentDrums
    };

    for (const fn of [...subs]) {
      try { fn(payload); } catch { /* audio never crashes the app */ }
    }

    nextTickTime += secondsPerSixteenth;
    step++;
    if (step >= 16) {
      step = 0;
      bar++;
      barInPhrase++;
      if (barInPhrase >= 8) {
        barInPhrase = 0;
        phraseIndex++;
      }
    }
  }

  function tick() {
    if (!running) return;
    while (nextTickTime < ctx.currentTime + HORIZON_S) emitTick();
  }

  return {
    start() {
      if (running) return;
      running = true;
      step = 0; bar = 0; barInPhrase = 0; phraseIndex = 0;
      progressionLedger = [];
      melodyLedger = new Set();
      melodyLedgerOrder = [];
      currentProgression = null;
      currentChord = null;
      currentMelody = new Array(16).fill(null);
      currentDrums = { kick: new Array(16).fill(false), snare: new Array(16).fill(false), hat: new Array(16).fill(false) };
      smoothedIntensity = 0;
      smoothedSparkle = 0;
      combatOn = false;
      barTempo = directorTargets(latestGameState).tempo;
      nextTickTime = ctx.currentTime + 0.05;
      intervalId = setInterval(tick, LOOKAHEAD_MS);
    },
    stop() {
      running = false;
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = null;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    updateState(gameState) {
      latestGameState = gameState || {};
      if (!gameState) return;
      const nextMode = gameState.theme?.audioMode || gameState.audioMode;
      const staged = pending || {};
      if (gameState.worldSeed !== undefined) staged.worldSeed = gameState.worldSeed;
      if (gameState.depth !== undefined) staged.depth = gameState.depth;
      if (nextMode) staged.audioMode = nextMode;
      if (gameState.floorId !== undefined) staged.floorId = gameState.floorId;
      if (Object.keys(staged).length) pending = staged;
    },
    getState() {
      return {
        tempo: barTempo,
        pos: { step, beat: Math.floor(step / 4), bar, barInPhrase, phraseIndex },
        intensity: smoothedIntensity,
        sparkle: smoothedSparkle,
        combat: combatOn,
        audioMode: active.audioMode,
        phraseKey: currentProgression?.key ?? null,
        ledgerSize: melodyLedger.size
      };
    }
  };
}
