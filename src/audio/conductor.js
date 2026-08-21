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

const DEG_BASE = { 1: 2, 2: 3, 3: 2, 4: 3, 5: 3, 6: 1 };
const DEG_DARK_SHIFT = { 1: -1, 2: -2, 3: 2, 4: -1, 5: 2, 6: 2 };
const CADENCE_DEGREES = [4, 6, 3];
const CADENCE_BASE = { 4: 3, 6: 1, 3: 1 };
const CADENCE_DARK_SHIFT = { 4: -1, 6: 2, 3: 2 };

function pickWeighted(h, candidates) {
  let total = 0;
  for (const c of candidates) total += c.w;
  if (total <= 0) return candidates[0].d;
  const roll = ((h >>> 0) % 4096) / 4096 * total;
  let acc = 0;
  for (const c of candidates) {
    acc += c.w;
    if (roll < acc) return c.d;
  }
  return candidates[candidates.length - 1].d;
}

function nextDegree(h, prev, darkness) {
  const candidates = [];
  for (let d = 1; d <= 6; d++) {
    if (d === prev) continue;
    const w = Math.max(0.1, DEG_BASE[d] + darkness * DEG_DARK_SHIFT[d]);
    candidates.push({ d, w });
  }
  return pickWeighted(h, candidates);
}

function cadenceDegree(h, darkness) {
  const candidates = CADENCE_DEGREES.map((d) => ({
    d,
    w: Math.max(0.1, CADENCE_BASE[d] + darkness * CADENCE_DARK_SHIFT[d])
  }));
  return pickWeighted(h, candidates);
}

function snapToChordToneStep(step) {
  const rounded = Math.round(step);
  for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
    const cand = rounded + delta;
    const mod = ((cand % 7) + 7) % 7;
    if (mod === 0 || mod === 2 || mod === 4) return cand;
  }
  return rounded;
}

const PROGRESSION_MAX_PERTURB = 24;
const MOTIF_MAX_PERTURB = 12;

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
  let last = null;
  for (let perturb = 0; perturb < PROGRESSION_MAX_PERTURB; perturb++) {
    const degrees = [0];
    for (let i = 1; i <= 2; i++) {
      const h = hash(worldSeed, depth, floorId, phraseIndex, 'prog-step', i, perturb);
      degrees.push(nextDegree(h, degrees[i - 1], darkness));
    }
    const hC = hash(worldSeed, depth, floorId, phraseIndex, 'prog-cadence', perturb);
    degrees.push(cadenceDegree(hC, darkness));
    const key = degrees.join('-');
    last = { key, degrees };
    if (!avoidSet.has(key)) {
      return { key, chords: degrees.map((d) => chordFor(scale, d)) };
    }
  }
  const degrees = last ? last.degrees : [0, 2, 4, 5];
  return { key: degrees.join('-'), chords: degrees.map((d) => chordFor(scale, d)) };
}

export function motifFor({
  worldSeed = 0,
  depth = 1,
  floorId = '',
  phraseIndex = 0,
  intensity = 0.5,
  scale = SCALES['cold-ambient'],
  perturb = 0
} = {}) {
  const clampedIntensity = Math.min(Math.max(intensity, 0), 1);
  const count = 4 + Math.round(clampedIntensity * 3);
  const eighthGrid = [2, 4, 6, 8, 10, 12, 14];
  const remaining = eighthGrid.slice();
  const rhythmH = hash(worldSeed, depth, floorId, phraseIndex, 'motif-rhythm', perturb);
  const rhythmSet = new Set([0]);
  for (let i = 0; i < count - 1 && remaining.length; i++) {
    const idx = (rhythmH >>> (i * 3)) % remaining.length;
    rhythmSet.add(remaining.splice(idx, 1)[0]);
  }
  const rhythm = [...rhythmSet].sort((a, b) => a - b);

  const syncH = hash(worldSeed, depth, floorId, phraseIndex, 'motif-sync', perturb);
  const syncRoll = ((syncH >>> 0) & 0xffff) / 65536;
  if (syncRoll < clampedIntensity) {
    const strongIdxList = [];
    for (let i = 0; i < rhythm.length; i++) {
      const s = rhythm[i];
      if (s === 4 || s === 8 || s === 12) strongIdxList.push(i);
    }
    if (strongIdxList.length) {
      const pickIdx = strongIdxList[(syncH >>> 16) % strongIdxList.length];
      const displaced = rhythm[pickIdx] + 1;
      if (displaced <= 15 && !rhythm.includes(displaced)) {
        rhythm[pickIdx] = displaced;
        rhythm.sort((a, b) => a - b);
      }
    }
  }

  const startH = hash(worldSeed, depth, floorId, phraseIndex, 'motif-start', perturb);
  const startChoices = [0, 2, 4];
  const steps = [startChoices[startH % startChoices.length]];
  let cur = steps[0];
  for (let i = 1; i < rhythm.length; i++) {
    const h = hash(worldSeed, depth, floorId, phraseIndex, 'motif-note', i, perturb);
    const roll = ((h >>> 0) & 0xffff) / 65536;
    const dir = ((h >>> 16) & 1) ? 1 : -1;
    let next;
    if (roll < 0.55) {
      next = cur + dir;
    } else if (roll < 0.70) {
      next = cur;
    } else {
      const leap = 2 + (((h >>> 20) & 3) % 3);
      next = snapToChordToneStep(cur + dir * leap);
    }
    if (next < -2) next = -2 + (-2 - next);
    if (next > 9) next = 9 - (next - 9);
    if (next < -2) next = -2;
    if (next > 9) next = 9;
    if (rhythm[i] === 0 || rhythm[i] === 8) next = snapToChordToneStep(next);
    if (next < -2) next = -2;
    if (next > 9) next = 9;
    steps.push(next);
    cur = next;
  }

  // scale kept in signature so tests can reason about scale changes if desired later
  const signature = `${rhythm.join(',')}|${steps.join(',')}`;
  return { rhythm, steps, signature, scaleLength: scale.length };
}

function scaleStepToSemi(step, scale, chordDegree) {
  const absStep = chordDegree + step;
  const wrap = Math.floor(absStep / scale.length);
  const idx = ((absStep % scale.length) + scale.length) % scale.length;
  return scale[idx] + 12 * wrap;
}

function fitRegister(semi) {
  let value = semi;
  let octave = 0;
  if (value < -6) { value += 12; }
  while (value > 18) value -= 12;
  while (value < -6) value += 12;
  return { degree: value, octave };
}

function applyVariation(rhythm, steps, varH, variant) {
  const rhy = rhythm.slice();
  const stp = steps.slice();
  if (variant === 0 && stp.length >= 1) {
    const dir = ((varH >>> 4) & 1) ? 1 : -1;
    stp[stp.length - 1] = stp[stp.length - 1] + dir;
  } else if (variant === 1 && rhy.length >= 2) {
    const idx = 1 + ((varH >>> 4) % (rhy.length - 1));
    const disp = rhy[idx] + 1;
    if (disp <= 15 && !rhy.includes(disp)) {
      rhy[idx] = disp;
      const paired = rhy.map((s, i) => ({ s, step: stp[i] })).sort((a, b) => a.s - b.s);
      for (let i = 0; i < paired.length; i++) { rhy[i] = paired[i].s; stp[i] = paired[i].step; }
    }
  } else if (variant === 2 && stp.length >= 2) {
    stp[stp.length - 1] = stp[stp.length - 1] + 7;
    stp[stp.length - 2] = stp[stp.length - 2] + 7;
  }
  return { rhythm: rhy, steps: stp };
}

function invertTail(steps) {
  const out = steps.slice();
  const mid = Math.floor(out.length / 2);
  for (let i = mid + 1; i < out.length; i++) {
    const delta = out[i] - out[i - 1];
    out[i] = out[i - 1] - delta;
  }
  return out;
}

export function phraseBar({
  motif,
  chord,
  scale = SCALES['cold-ambient'],
  barInPhrase = 0,
  worldSeed = 0,
  depth = 1,
  floorId = '',
  phraseIndex = 0
} = {}) {
  const slots = new Array(16).fill(null);
  if (!motif || !chord) return slots;
  const varH = hash(worldSeed, depth, floorId, phraseIndex, 'phrase-var', barInPhrase);

  let rhythm = motif.rhythm.slice();
  let steps = motif.steps.slice();

  const role = ({
    0: 'A', 1: 'A1', 2: 'B', 3: 'A_half',
    4: 'A', 5: 'A2', 6: 'B', 7: 'C_full'
  })[barInPhrase] || 'A';

  if (role === 'A1' || role === 'A2') {
    const variant = varH % 3;
    ({ rhythm, steps } = applyVariation(rhythm, steps, varH, variant));
  } else if (role === 'B') {
    steps = invertTail(steps);
  } else if (role === 'A_half') {
    if (steps.length >= 1) steps[steps.length - 1] = ((varH >>> 4) & 1) ? 4 : 2;
  } else if (role === 'C_full') {
    if (steps.length >= 1) steps[steps.length - 1] = 0;
  }

  for (let idx = 0; idx < rhythm.length; idx++) {
    if (rhythm[idx] === 0 || rhythm[idx] === 8) steps[idx] = snapToChordToneStep(steps[idx] ?? 0);
  }

  const chordDegree = chord.degree ?? 0;
  for (let idx = 0; idx < rhythm.length; idx++) {
    const slotIdx = rhythm[idx];
    if (slotIdx < 0 || slotIdx > 15) continue;
    const step = steps[idx] ?? 0;
    const semi = scaleStepToSemi(step, scale, chordDegree);
    const { degree, octave } = fitRegister(semi);

    let velocity = 0.55;
    if (slotIdx === 0 || slotIdx === 8) velocity += 0.15;
    if (barInPhrase >= 4 && barInPhrase <= 6) velocity += 0.05 * (barInPhrase - 3);
    if (barInPhrase === 7) velocity = 0.6;
    velocity = Math.max(0.3, Math.min(1, velocity));

    const nextSlot = rhythm[idx + 1] ?? 16;
    let lengthSlots = Math.min(8, nextSlot - slotIdx);
    if (role === 'A_half' && idx === rhythm.length - 1) lengthSlots = Math.max(lengthSlots, 4);
    if (role === 'C_full' && idx === rhythm.length - 1) lengthSlots = Math.max(lengthSlots, 6);
    lengthSlots = Math.min(8, lengthSlots);

    slots[slotIdx] = { degree, octave, velocity, lengthSlots };
  }
  return slots;
}

export function bassBar({ chord, nextChord, tier = 0, barInPhrase = 0, h = 0 } = {}) {
  const slots = new Array(16).fill(null);
  if (!chord) return slots;
  const rootSemi = chord.semis[0];
  const fifthSemi = chord.semis[2];
  const nextRootSemi = nextChord?.semis?.[0] ?? rootSemi;
  const approachSemi = nextRootSemi + (((h >>> 0) & 1) ? -1 : 1);
  const accent = (idx) => (idx === 0 || idx === 8) ? 0.9 : 0.7;

  if (tier <= 0) {
    const slotList = [0, 4, 8, 12];
    const pattern = [rootSemi, fifthSemi, rootSemi, fifthSemi];
    for (let i = 0; i < slotList.length; i++) {
      slots[slotList[i]] = { semi: pattern[i], octave: -1, velocity: accent(slotList[i]), lengthSlots: 4 };
    }
    slots[14] = { semi: approachSemi, octave: -1, velocity: 0.65, lengthSlots: 2 };
  } else if (tier === 1) {
    const eighths = [0, 2, 4, 6, 8, 10, 12];
    const pattern = [rootSemi, rootSemi, fifthSemi, rootSemi, rootSemi, rootSemi, fifthSemi];
    for (let i = 0; i < eighths.length; i++) {
      const slotIdx = eighths[i];
      const pop = ((h >>> (i + 4)) & 1) === 1;
      const octave = (pop && (slotIdx === 6 || slotIdx === 10)) ? 0 : -1;
      slots[slotIdx] = { semi: pattern[i], octave, velocity: accent(slotIdx), lengthSlots: 2 };
    }
    slots[14] = { semi: approachSemi, octave: -1, velocity: 0.75, lengthSlots: 2 };
  } else {
    const eighths = [0, 2, 4, 6, 8, 10, 12];
    for (let i = 0; i < eighths.length; i++) {
      const slotIdx = eighths[i];
      const octave = (i % 2 === 0) ? -1 : 0;
      slots[slotIdx] = { semi: rootSemi, octave, velocity: accent(slotIdx), lengthSlots: 2 };
    }
    slots[14] = { semi: approachSemi, octave: -1, velocity: 0.8, lengthSlots: 2 };
  }
  return slots;
}

// Back-compat: `melodyBar` remains exported so `scripts/report-budget.js` (its
// audioSchedulingProxy hot path) keeps loading. New callers should use motifFor
// + phraseBar directly. The shim renders a single bar from a fresh motif.
export function melodyBar(args = {}) {
  const motif = motifFor(args);
  return phraseBar({
    motif,
    chord: args.chord,
    scale: args.scale,
    barInPhrase: args.barInPhrase ?? 0,
    worldSeed: args.worldSeed,
    depth: args.depth,
    floorId: args.floorId,
    phraseIndex: args.phraseIndex ?? 0
  });
}

export function drumPattern({ tier = 0, barInPhrase = 0, h = 0 } = {}) {
  const kick = new Array(16).fill(false);
  const snare = new Array(16).fill(false);
  const hat = new Array(16).fill(false);
  const set = (arr, indices) => { for (const i of indices) arr[i] = true; };
  const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
  const sixteenths = Array.from({ length: 16 }, (_, i) => i);

  if (tier <= 0) {
    set(kick, [0, 8]);
    set(hat, eighths);
  } else if (tier === 1) {
    set(kick, [0, 8]);
    set(hat, eighths);
    set(snare, [4, 12]);
  } else if (tier === 2) {
    set(kick, [0, 8]);
    const syncChoices = [3, 6, 10];
    set(kick, [syncChoices[(h >>> 4) % syncChoices.length]]);
    set(snare, [4, 12]);
    set(hat, sixteenths);
  } else {
    const kickPatterns = [[0, 4, 8, 12], [0, 3, 6, 10]];
    set(kick, kickPatterns[(h >>> 4) & 1]);
    set(snare, [4, 12]);
    set(hat, sixteenths);
  }

  if (barInPhrase === 3) set(snare, [14, 15]);
  if (barInPhrase === 7) { set(snare, [12, 13, 14, 15]); set(kick, [12]); }

  if (barInPhrase % 2 === 1) {
    const idx = (h >>> 8) % 16;
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
    for (let perturb = 0; perturb <= MOTIF_MAX_PERTURB; perturb++) {
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
