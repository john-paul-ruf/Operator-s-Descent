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
