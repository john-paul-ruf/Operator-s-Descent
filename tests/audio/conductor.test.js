import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeContext } from '../helpers/fake-audio.js';
import {
  bassBar,
  chordFor,
  createConductor,
  directorTargets,
  drumPattern,
  motifFor,
  phraseBar,
  progressionFor,
  ROOTS,
  SCALES
} from '../../src/audio/conductor.js';

describe('conductor.chordFor', () => {
  test('stacks scale degrees d, d+2, d+4 with octave wrap', () => {
    const major = [0, 2, 4, 5, 7, 9, 11];
    expect(chordFor(major, 0).semis).toEqual([0, 4, 7]);
    expect(chordFor(major, 4).semis).toEqual([7, 11, 12 + 2]);
    expect(chordFor(major, 5).semis).toEqual([9, 12, 12 + 4]);
    const cold = SCALES['cold-ambient'];
    expect(chordFor(cold, 0).semis).toEqual([0, 3, 7]);
  });
});

describe('conductor.progressionFor', () => {
  test('deterministic for identical args', () => {
    const a = progressionFor({ worldSeed: 42, depth: 5, floorId: 'f2', phraseIndex: 0, audioMode: 'organic-green' });
    const b = progressionFor({ worldSeed: 42, depth: 5, floorId: 'f2', phraseIndex: 0, audioMode: 'organic-green' });
    expect(b).toEqual(a);
    expect(a.chords).toHaveLength(4);
  });

  test('avoid list is honored when possible', () => {
    const first = progressionFor({ worldSeed: 7, depth: 3, floorId: 'x', phraseIndex: 0, audioMode: 'cold-ambient' });
    const second = progressionFor({ worldSeed: 7, depth: 3, floorId: 'x', phraseIndex: 0, audioMode: 'cold-ambient', avoid: [first.key] });
    expect(second.key).not.toBe(first.key);
  });

  test('degree 0 is fixed at tonic; degree 3 comes from the cadence set', () => {
    const cadenceSet = new Set([4, 6, 3]);
    for (let i = 0; i < 12; i++) {
      const p = progressionFor({ worldSeed: 3, depth: 4, floorId: 'w', phraseIndex: i, audioMode: 'flowing-cyan' });
      const degrees = p.key.split('-').map(Number);
      expect(degrees).toHaveLength(4);
      expect(degrees[0]).toBe(0);
      expect(cadenceSet.has(degrees[3])).toBe(true);
    }
  });

  test('deep runs lean toward minor-flavored degrees {3,5,6} at position 1 more than shallow runs', () => {
    const minorSet = new Set([3, 5, 6]);
    let shallowHits = 0;
    let deepHits = 0;
    for (let i = 0; i < 40; i++) {
      const shallow = progressionFor({ worldSeed: 99, depth: 1, floorId: 'shallow', phraseIndex: i, audioMode: 'organic-green' });
      const deep = progressionFor({ worldSeed: 99, depth: 30, floorId: 'deep', phraseIndex: i, audioMode: 'organic-green' });
      if (minorSet.has(Number(shallow.key.split('-')[1]))) shallowHits++;
      if (minorSet.has(Number(deep.key.split('-')[1]))) deepHits++;
    }
    expect(deepHits).toBeGreaterThan(shallowHits);
  });
});

describe('conductor.motifFor', () => {
  test('deterministic for identical args', () => {
    const args = { worldSeed: 3, depth: 4, floorId: 'f', phraseIndex: 1, intensity: 0.5, scale: SCALES['flowing-cyan'] };
    expect(motifFor(args)).toEqual(motifFor(args));
  });

  test('slot 0 is present and rhythm count scales with intensity (4..7)', () => {
    for (const intensity of [0, 0.5, 1]) {
      const m = motifFor({ worldSeed: 2, depth: 6, floorId: 'r', phraseIndex: 0, intensity, scale: SCALES['cold-ambient'] });
      expect(m.rhythm[0]).toBe(0);
      expect(m.rhythm.length).toBeGreaterThanOrEqual(4);
      expect(m.rhythm.length).toBeLessThanOrEqual(7);
      expect(m.rhythm.length).toBe(m.steps.length);
    }
  });

  test('rhythm slots are unique, sorted, and 0..15', () => {
    const m = motifFor({ worldSeed: 7, depth: 12, floorId: 'a', phraseIndex: 3, intensity: 0.9, scale: SCALES['organic-green'] });
    const set = new Set(m.rhythm);
    expect(set.size).toBe(m.rhythm.length);
    for (let i = 1; i < m.rhythm.length; i++) expect(m.rhythm[i]).toBeGreaterThan(m.rhythm[i - 1]);
    for (const s of m.rhythm) { expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(15); }
  });

  test('starting step is a chord-tone step {0,2,4}', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const m = motifFor({ worldSeed: seed, depth: 8, floorId: 's', phraseIndex: 0, intensity: 0.5, scale: SCALES['cold-ambient'] });
      expect([0, 2, 4]).toContain(m.steps[0]);
    }
  });

  test('steps stay inside the reflected bounds [-2, 9]', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const m = motifFor({ worldSeed: seed, depth: 5, floorId: 'b', phraseIndex: seed, intensity: 1, scale: SCALES['flowing-cyan'] });
      for (const s of m.steps) {
        expect(s).toBeGreaterThanOrEqual(-2);
        expect(s).toBeLessThanOrEqual(9);
      }
    }
  });

  test('≥55% of consecutive motif moves are steps (|Δstep| ≤ 1) across a sample', () => {
    let steps = 0, total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const m = motifFor({ worldSeed: seed, depth: 7, floorId: 'c', phraseIndex: 0, intensity: 0.6, scale: SCALES['organic-green'] });
      for (let i = 1; i < m.steps.length; i++) {
        total++;
        if (Math.abs(m.steps[i] - m.steps[i - 1]) <= 1) steps++;
      }
    }
    expect(steps / total).toBeGreaterThanOrEqual(0.55);
  });

  test('signature encodes both rhythm and steps and matches identical calls', () => {
    const m1 = motifFor({ worldSeed: 8, depth: 3, floorId: 'g', phraseIndex: 2, intensity: 0.5, scale: SCALES['cold-ambient'] });
    const m2 = motifFor({ worldSeed: 8, depth: 3, floorId: 'g', phraseIndex: 2, intensity: 0.5, scale: SCALES['cold-ambient'] });
    expect(m1.signature).toBe(m2.signature);
    expect(m1.signature).toContain('|');
  });
});

describe('conductor.phraseBar', () => {
  function makeMotif(overrides = {}) {
    return motifFor({
      worldSeed: 3, depth: 4, floorId: 'p', phraseIndex: 1, intensity: 0.6, scale: SCALES['flowing-cyan'],
      ...overrides
    });
  }

  test('deterministic for identical args', () => {
    const motif = makeMotif();
    const chord = chordFor(SCALES['flowing-cyan'], 0);
    const args = { motif, chord, scale: SCALES['flowing-cyan'], barInPhrase: 0, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex: 1 };
    expect(phraseBar(args)).toEqual(phraseBar(args));
  });

  test('slot 0 (and slot 8 when present) is a chord tone', () => {
    const scale = SCALES['flowing-cyan'];
    for (let phraseIndex = 0; phraseIndex < 4; phraseIndex++) {
      const motif = makeMotif({ phraseIndex, intensity: 0.9 });
      for (const chordDeg of [0, 2, 3, 5]) {
        const chord = chordFor(scale, chordDeg);
        for (const bar of [0, 1, 2, 4, 5, 6]) {
          const slots = phraseBar({ motif, chord, scale, barInPhrase: bar, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex });
          const s0 = slots[0];
          expect(s0).not.toBeNull();
          expect(scale.includes(((s0.degree % 12) + 12) % 12)).toBe(true);
          const chordPC = new Set(chord.semis.map((v) => ((v % 12) + 12) % 12));
          expect(chordPC.has(((s0.degree % 12) + 12) % 12)).toBe(true);
          if (slots[8]) {
            const s8pc = ((slots[8].degree % 12) + 12) % 12;
            expect(chordPC.has(s8pc)).toBe(true);
          }
        }
      }
    }
  });

  test('bar 3 half-cadence sustains the final note (lengthSlots >= 4)', () => {
    const scale = SCALES['organic-green'];
    const motif = makeMotif({ phraseIndex: 2 });
    const chord = chordFor(scale, 4);
    const slots = phraseBar({ motif, chord, scale, barInPhrase: 3, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex: 2 });
    const last = [...slots].reverse().find((s) => s !== null);
    expect(last).toBeTruthy();
    expect(last.lengthSlots).toBeGreaterThanOrEqual(4);
  });

  test('bar 7 full-cadence lands on chord root with lengthSlots >= 6', () => {
    const scale = SCALES['organic-green'];
    const motif = makeMotif({ phraseIndex: 5 });
    const chord = chordFor(scale, 3);
    const slots = phraseBar({ motif, chord, scale, barInPhrase: 7, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex: 5 });
    let lastIdx = -1;
    for (let i = 15; i >= 0; i--) if (slots[i]) { lastIdx = i; break; }
    expect(lastIdx).toBeGreaterThanOrEqual(0);
    const last = slots[lastIdx];
    const rootPC = ((chord.semis[0] % 12) + 12) % 12;
    expect(((last.degree % 12) + 12) % 12).toBe(rootPC);
    expect(last.lengthSlots).toBeGreaterThanOrEqual(6);
  });

  test('lengthSlots cap at 8', () => {
    const scale = SCALES['cold-ambient'];
    const motif = makeMotif();
    const chord = chordFor(scale, 0);
    for (const bar of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const slots = phraseBar({ motif, chord, scale, barInPhrase: bar, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex: 1 });
      for (const s of slots) if (s) expect(s.lengthSlots).toBeLessThanOrEqual(8);
    }
  });

  test('bar 0 vs bar 1 (A vs A′) share ≥60% onsets and ≥50% pitches', () => {
    const scale = SCALES['flowing-cyan'];
    for (let phraseIndex = 0; phraseIndex < 4; phraseIndex++) {
      const motif = makeMotif({ phraseIndex, intensity: 0.7 });
      const chord0 = chordFor(scale, 0);
      const bar0 = phraseBar({ motif, chord: chord0, scale, barInPhrase: 0, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex });
      const bar1 = phraseBar({ motif, chord: chord0, scale, barInPhrase: 1, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex });
      const set0 = new Set(); const set1 = new Set();
      for (let i = 0; i < 16; i++) { if (bar0[i]) set0.add(i); if (bar1[i]) set1.add(i); }
      const onsetOverlap = [...set0].filter((i) => set1.has(i)).length / set0.size;
      expect(onsetOverlap).toBeGreaterThanOrEqual(0.6);
      const pitches0 = new Set(bar0.filter(Boolean).map((s) => s.degree));
      const pitches1 = new Set(bar1.filter(Boolean).map((s) => s.degree));
      const pitchOverlap = [...pitches0].filter((p) => pitches1.has(p)).length / pitches0.size;
      expect(pitchOverlap).toBeGreaterThanOrEqual(0.5);
    }
  });

  test('bar 4 vs bar 5 (A vs A″) share ≥60% onsets and ≥50% pitches', () => {
    const scale = SCALES['organic-green'];
    for (let phraseIndex = 0; phraseIndex < 4; phraseIndex++) {
      const motif = makeMotif({ phraseIndex, intensity: 0.8, scale });
      const chord = chordFor(scale, 4);
      const bar4 = phraseBar({ motif, chord, scale, barInPhrase: 4, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex });
      const bar5 = phraseBar({ motif, chord, scale, barInPhrase: 5, worldSeed: 3, depth: 4, floorId: 'p', phraseIndex });
      const set4 = new Set(); const set5 = new Set();
      for (let i = 0; i < 16; i++) { if (bar4[i]) set4.add(i); if (bar5[i]) set5.add(i); }
      const onsetOverlap = [...set4].filter((i) => set5.has(i)).length / set4.size;
      expect(onsetOverlap).toBeGreaterThanOrEqual(0.6);
      const pitches4 = new Set(bar4.filter(Boolean).map((s) => s.degree));
      const pitches5 = new Set(bar5.filter(Boolean).map((s) => s.degree));
      const pitchOverlap = [...pitches4].filter((p) => pitches5.has(p)).length / pitches4.size;
      expect(pitchOverlap).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('conductor.bassBar', () => {
  test('16-slot array with valid shape at every onset', () => {
    const scale = SCALES['flowing-cyan'];
    const chord = chordFor(scale, 0);
    const nextChord = chordFor(scale, 4);
    for (const tier of [0, 1, 2, 3]) {
      const bar = bassBar({ chord, nextChord, tier, barInPhrase: 0, h: 12345 });
      expect(bar.length).toBe(16);
      for (const slot of bar) {
        if (!slot) continue;
        expect(typeof slot.semi).toBe('number');
        expect([-1, 0]).toContain(slot.octave);
        expect(slot.velocity).toBeGreaterThan(0);
        expect(slot.velocity).toBeLessThanOrEqual(1);
        expect(slot.lengthSlots).toBeGreaterThan(0);
      }
    }
  });

  test('tier 0 approach note at slot 14 targets nextChord root ±1 semitone', () => {
    const scale = SCALES['cold-ambient'];
    const chord = chordFor(scale, 0);
    const nextChord = chordFor(scale, 4);
    for (const h of [0, 1, 42, 999]) {
      const bar = bassBar({ chord, nextChord, tier: 0, barInPhrase: 0, h });
      expect(bar[14]).toBeTruthy();
      expect(Math.abs(bar[14].semi - nextChord.semis[0])).toBe(1);
    }
  });

  test('root and fifth alternate on downbeats at tier 0', () => {
    const scale = SCALES['organic-green'];
    const chord = chordFor(scale, 1);
    const nextChord = chordFor(scale, 3);
    const bar = bassBar({ chord, nextChord, tier: 0, barInPhrase: 0, h: 0 });
    expect(bar[0].semi).toBe(chord.semis[0]);
    expect(bar[4].semi).toBe(chord.semis[2]);
    expect(bar[8].semi).toBe(chord.semis[0]);
    expect(bar[12].semi).toBe(chord.semis[2]);
  });
});

describe('conductor.drumPattern', () => {
  test('tier 0 has hats and a kick — no static heartbeat', () => {
    const p = drumPattern({ tier: 0, barInPhrase: 0, h: 0 });
    expect(p.hat.some(Boolean)).toBe(true);
    expect(p.kick.some(Boolean)).toBe(true);
    expect(p.snare.some(Boolean)).toBe(false);
  });

  test('density monotonic across tiers with fixed h=0, barInPhrase=0', () => {
    const counts = [0, 1, 2, 3].map((tier) => {
      const p = drumPattern({ tier, barInPhrase: 0, h: 0 });
      return p.kick.filter(Boolean).length + p.snare.filter(Boolean).length + p.hat.filter(Boolean).length;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  test('bar 3 half-cadence fill: snare 14,15', () => {
    for (const tier of [1, 2, 3]) {
      const p = drumPattern({ tier, barInPhrase: 3, h: 0 });
      expect(p.snare[14] && p.snare[15]).toBe(true);
    }
  });

  test('bar 7 full-cadence fill: snare 12..15 and kick 12', () => {
    for (const tier of [1, 2, 3]) {
      const p = drumPattern({ tier, barInPhrase: 7, h: 0 });
      expect(p.snare[12] && p.snare[13] && p.snare[14] && p.snare[15]).toBe(true);
      expect(p.kick[12]).toBe(true);
    }
  });
});

describe('conductor.directorTargets', () => {
  test('no signals — depth 1 lands on the upbeat floors (intensity 0.35, sparkle 0.25)', () => {
    const t = directorTargets({ depth: 1 });
    expect(t.intensity).toBeCloseTo(0.35);
    expect(t.sparkle).toBeCloseTo(0.25);
    expect(t.combat).toBe(false);
    expect(t.tempo).toBe(Math.round(116 + 0 + 0.35 * 22));
  });

  test('hostile at distance 1 raises intensity via danger 0.9 * 0.9 above the floor', () => {
    const t = directorTargets({ depth: 1, proximity: { hostile: 1 } });
    expect(t.intensity).toBeCloseTo(0.81);
    expect(t.tempo).toBe(Math.round(116 + 0 + 0.81 * 22));
  });

  test('container at distance 3 raises sparkle to 0.7 above its 0.25 floor', () => {
    const t = directorTargets({ depth: 1, proximity: { container: 3 } });
    expect(t.sparkle).toBeCloseTo(0.7);
    expect(t.intensity).toBeCloseTo(0.35);
  });

  test('combat pins intensity to 1 and adds +22 to tempo, regardless of key spelling', () => {
    const asActive = directorTargets({ depth: 1, combatActive: true });
    const asState = directorTargets({ depth: 1, combatState: { any: true } });
    const asCombat = directorTargets({ depth: 1, combat: true });
    for (const t of [asActive, asState, asCombat]) {
      expect(t.intensity).toBe(1);
      expect(t.combat).toBe(true);
      expect(t.tempo).toBe(Math.round(116 + 0 + 22 + 22));
    }
  });

  test('depth 30 raises the intensity floor toward 0.55 and shifts tempo above depth 1', () => {
    const t = directorTargets({ depth: 30 });
    expect(t.intensity).toBeCloseTo(0.35 + 29 / 30 * 0.2);
    expect(t.tempo).toBe(Math.round(116 + 29 * 0.8 + (0.35 + 29 / 30 * 0.2) * 22));
    expect(t.tempo).toBeGreaterThanOrEqual(112);
    expect(t.tempo).toBeLessThanOrEqual(180);
  });

  test('tempo is clamped to [112, 180] at extremes', () => {
    const low = directorTargets({ depth: 1 });
    expect(low.tempo).toBeGreaterThanOrEqual(112);
    const high = directorTargets({ depth: 30, proximity: { hostile: 0 }, combat: true });
    expect(high.tempo).toBeLessThanOrEqual(180);
  });
});

describe('conductor.ROOTS coverage', () => {
  test('every SCALES audioMode has a ROOTS entry', () => {
    for (const key of Object.keys(SCALES)) {
      expect(typeof ROOTS[key]).toBe('number');
    }
  });
});

describe('conductor clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function drive(ctxOrList, endTimeSeconds, stepMs = 25) {
    const ctxs = Array.isArray(ctxOrList) ? ctxOrList : [ctxOrList];
    const startMs = Math.round(ctxs[0].currentTime * 1000);
    const endMs = Math.round(endTimeSeconds * 1000);
    for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
      for (const c of ctxs) c.currentTime = t / 1000;
      vi.advanceTimersByTime(stepMs);
    }
  }

  test('ticks are monotonic in time and pos.step wraps 0..15 with bar++', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    const events = [];
    c.subscribe((p) => events.push({ time: p.time, step: p.pos.step, bar: p.pos.bar }));
    c.start();
    drive(ctx, 6);
    c.stop();

    expect(events.length).toBeGreaterThan(16);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].time).toBeGreaterThan(events[i - 1].time);
      const prev = events[i - 1];
      const cur = events[i];
      if (prev.step === 15) {
        expect(cur.step).toBe(0);
        expect(cur.bar).toBe(prev.bar + 1);
      } else {
        expect(cur.step).toBe(prev.step + 1);
        expect(cur.bar).toBe(prev.bar);
      }
    }
  });

  test('tempo change requested mid-bar applies only at next bar boundary', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    const events = [];
    c.subscribe((p) => events.push({ step: p.pos.step, tempo: p.tempo }));
    c.start();
    drive(ctx, 0.6);
    const midBarTempo = events.at(-1).tempo;
    c.updateState({ depth: 30 });
    drive(ctx, 3);
    c.stop();

    let boundaryIndex = -1;
    for (let i = 1; i < events.length; i++) {
      if (events[i].step === 0 && events[i - 1].step === 15) { boundaryIndex = i; break; }
    }
    expect(boundaryIndex).toBeGreaterThan(-1);
    for (let i = 0; i < boundaryIndex; i++) expect(events[i].tempo).toBe(midBarTempo);
    expect(events[boundaryIndex].tempo).toBeGreaterThan(midBarTempo);
  });

  test('floor change resets phraseIndex at next bar boundary', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    c.updateState({ worldSeed: 5, depth: 3, floorId: 'a', audioMode: 'organic-green' });
    const events = [];
    c.subscribe((p) => events.push({ step: p.pos.step, bar: p.pos.bar, phraseIndex: p.pos.phraseIndex }));
    c.start();
    drive(ctx, 6);
    c.updateState({ floorId: 'b' });
    const beforeSwapLength = events.length;
    drive(ctx, 10);
    c.stop();

    const afterSwap = events.slice(beforeSwapLength);
    const boundary = afterSwap.find((e, i, arr) => i > 0 && arr[i - 1].step === 15 && e.step === 0);
    expect(boundary).toBeTruthy();
    expect(boundary.phraseIndex).toBe(0);
  });

  test('subscriber exception does not stall other subscribers', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    let goodCalls = 0;
    c.subscribe(() => { throw new Error('boom'); });
    c.subscribe(() => { goodCalls++; });
    c.start();
    drive(ctx, 2);
    c.stop();
    expect(goodCalls).toBeGreaterThan(3);
  });

  test('stop halts scheduling and start after stop resumes ticks', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    const events = [];
    c.subscribe(() => events.push(1));
    c.start();
    drive(ctx, 1);
    const firstRun = events.length;
    expect(firstRun).toBeGreaterThan(0);
    c.stop();
    drive(ctx, 2);
    expect(events.length).toBe(firstRun);
    c.start();
    drive(ctx, 4);
    c.stop();
    expect(events.length).toBeGreaterThan(firstRun);
  });

  test('two conductors with identical ctx timing + state emit identical streams', () => {
    const ctx1 = new FakeContext();
    const ctx2 = new FakeContext();
    const c1 = createConductor(ctx1);
    const c2 = createConductor(ctx2);
    const e1 = [], e2 = [];
    const capture = (arr) => (p) => arr.push({
      pos: { ...p.pos },
      tempo: p.tempo,
      chordDegree: p.chord?.degree ?? null,
      chordSemis: p.chord ? [...p.chord.semis] : null,
      drumsKick: [...p.drums.kick],
      drumsSnare: [...p.drums.snare],
      drumsHat: [...p.drums.hat],
      melody: p.melody.map((s) => (s ? { ...s } : null)),
      bass: p.bass.map((s) => (s ? { ...s } : null))
    });
    c1.subscribe(capture(e1));
    c2.subscribe(capture(e2));
    c1.updateState({ worldSeed: 42, depth: 7, floorId: 'shared', audioMode: 'geometric-cyan' });
    c2.updateState({ worldSeed: 42, depth: 7, floorId: 'shared', audioMode: 'geometric-cyan' });
    c1.start();
    c2.start();
    drive([ctx1, ctx2], 5);
    c1.stop();
    c2.stop();
    expect(e1.length).toBeGreaterThan(16);
    expect(e2).toEqual(e1);
  });

  test('getState reports pos/tempo/audioMode/phraseKey/ledgerSize', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    c.updateState({ worldSeed: 1, depth: 2, floorId: 'aa', audioMode: 'cold-ambient' });
    c.start();
    drive(ctx, 3);
    const s = c.getState();
    expect(s).toHaveProperty('tempo');
    expect(s.pos).toHaveProperty('step');
    expect(s.pos).toHaveProperty('phraseIndex');
    expect(s.audioMode).toBe('cold-ambient');
    expect(typeof s.phraseKey).toBe('string');
    expect(s.ledgerSize).toBeGreaterThan(0);
    c.stop();
  });

  test('rootFreq reflects ROOTS shift and drops an octave per 12 depth', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    c.updateState({ worldSeed: 0, depth: 15, floorId: 'f', audioMode: 'flowing-cyan' });
    let payload = null;
    c.subscribe((p) => { if (!payload) payload = p; });
    c.start();
    drive(ctx, 0.5);
    c.stop();
    expect(payload).toBeTruthy();
    const expected = 110 * Math.pow(2, ROOTS['flowing-cyan'] / 12) * Math.pow(2, -1);
    expect(payload.rootFreq).toBeCloseTo(expected, 6);
  });

  test('updateState merges — a lone {combat:true} preserves depth/tempo and pins intensity target to 1', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    c.updateState({ worldSeed: 9, depth: 20, floorId: 'deep', audioMode: 'cold-ambient', proximity: { hostile: 10, container: 10 } });
    const events = [];
    c.subscribe((p) => events.push({ tempo: p.tempo, intensity: p.intensity, combat: p.combat, depth: p.pos.bar >= 0 ? 20 : null }));
    c.start();
    drive(ctx, 2);
    const preTempo = events.at(-1).tempo;
    expect(preTempo).toBeGreaterThan(0);

    c.updateState({ combat: true });
    drive(ctx, 5);
    c.stop();

    const postCombat = events.slice(events.length - 20);
    expect(postCombat.some((e) => e.combat === true)).toBe(true);
    const settledIntensity = postCombat.at(-1).intensity;
    expect(settledIntensity).toBeGreaterThan(0.9);
    const settledTempo = postCombat.at(-1).tempo;
    const combatBonus = 22;
    const combatMin = Math.round(116 + 19 * 0.8 + 1 * 22 + combatBonus);
    expect(settledTempo).toBeGreaterThanOrEqual(Math.min(combatMin - 5, 180));
    expect(settledTempo).toBeLessThanOrEqual(180);
  });

  test('every payload includes a 16-slot bass array with valid slot shape', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    c.updateState({ worldSeed: 4, depth: 5, floorId: 'x', audioMode: 'organic-green' });
    const payloads = [];
    c.subscribe((p) => payloads.push(p));
    c.start();
    drive(ctx, 3);
    c.stop();
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      expect(Array.isArray(p.bass)).toBe(true);
      expect(p.bass.length).toBe(16);
      for (const slot of p.bass) {
        if (!slot) continue;
        expect(typeof slot.semi).toBe('number');
        expect([-1, 0]).toContain(slot.octave);
        expect(slot.velocity).toBeGreaterThan(0);
        expect(slot.lengthSlots).toBeGreaterThan(0);
      }
    }
  });

  test('motif signatures differ across phrases 0..3 on a single floor', () => {
    const ctx = new FakeContext();
    const c = createConductor(ctx);
    c.updateState({ worldSeed: 21, depth: 6, floorId: 'phraseDiv', audioMode: 'organic-green' });
    c.start();
    // enough time for at least 4 phrases (8 bars each) at ~124bpm ⇒ ~15.5s per phrase; drive plenty
    drive(ctx, 80);
    c.stop();
    const s = c.getState();
    expect(s.ledgerSize).toBeGreaterThanOrEqual(4);
  });
});
