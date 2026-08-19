import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeContext } from '../helpers/fake-audio.js';
import {
  chordFor,
  createConductor,
  directorTargets,
  drumPattern,
  melodyBar,
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

  test('deep runs bias toward DARK pool (bright theme, depth 30, ≥16/32 phrases dark)', () => {
    const DARK_KEYS = new Set([
      '0-5-3-6', '0-3-4-0', '0-6-5-6', '0-2-5-4', '0-4-5-3', '0-6-2-4'
    ]);
    let darkHits = 0;
    for (let i = 0; i < 32; i++) {
      const p = progressionFor({ worldSeed: 99, depth: 30, floorId: 'deep', phraseIndex: i, audioMode: 'organic-green' });
      if (DARK_KEYS.has(p.key)) darkHits++;
    }
    expect(darkHits).toBeGreaterThanOrEqual(16);
  });
});

describe('conductor.melodyBar', () => {
  test('deterministic for identical args', () => {
    const args = {
      worldSeed: 3,
      depth: 4,
      floorId: 'f',
      phraseIndex: 1,
      barInPhrase: 2,
      chord: chordFor(SCALES['flowing-cyan'], 0),
      scale: SCALES['flowing-cyan'],
      intensity: 0.5
    };
    expect(melodyBar(args)).toEqual(melodyBar(args));
  });

  test('downbeat onsets pick from chord tones, off-downbeats from scale tones', () => {
    const scale = SCALES['flowing-cyan'];
    const chord = chordFor(scale, 0);
    const bar = melodyBar({ worldSeed: 11, depth: 10, floorId: 'g', phraseIndex: 0, barInPhrase: 0, chord, scale, intensity: 1.0 });
    const chordSet = new Set(chord.semis);
    const scaleSet = new Set(scale);
    for (let i = 0; i < 16; i++) {
      const slot = bar[i];
      if (!slot) continue;
      if (i === 0 || i === 4 || i === 8 || i === 12) {
        expect(chordSet.has(slot.degree)).toBe(true);
      } else {
        expect(scaleSet.has(slot.degree)).toBe(true);
      }
    }
  });

  test('cadence: barInPhrase >= 6 forces final onset to chord root', () => {
    const scale = SCALES['organic-green'];
    const chord = chordFor(scale, 2);
    for (const barInPhrase of [6, 7]) {
      const bar = melodyBar({ worldSeed: 4, depth: 8, floorId: 'y', phraseIndex: 0, barInPhrase, chord, scale, intensity: 0.8 });
      const lastOnset = [...bar].reverse().find((s) => s !== null);
      if (lastOnset) expect(lastOnset.degree).toBe(chord.semis[0]);
    }
  });

  test('lengthSlots caps at 4', () => {
    const scale = SCALES['cold-ambient'];
    const chord = chordFor(scale, 0);
    const bar = melodyBar({ worldSeed: 1, depth: 1, floorId: 'a', phraseIndex: 0, barInPhrase: 0, chord, scale, intensity: 0.1 });
    for (const slot of bar) {
      if (slot) expect(slot.lengthSlots).toBeLessThanOrEqual(4);
    }
  });
});

describe('conductor.drumPattern', () => {
  test('tier 0 heartbeat: kick on [0,3] only, no snare, no hat', () => {
    const p = drumPattern({ tier: 0, barInPhrase: 0, h: 0 });
    expect(p.kick.filter(Boolean).length).toBe(2);
    expect(p.kick[0] && p.kick[3]).toBe(true);
    expect(p.snare.some(Boolean)).toBe(false);
    expect(p.hat.some(Boolean)).toBe(false);
  });

  test('density monotonic across tiers with fixed h=0', () => {
    const counts = [0, 1, 2, 3].map((tier) => {
      const p = drumPattern({ tier, barInPhrase: 0, h: 0 });
      return p.kick.filter(Boolean).length + p.snare.filter(Boolean).length + p.hat.filter(Boolean).length;
    });
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  });

  test('tier >= 2 bar 7 adds snare fill on [12..15]', () => {
    const p = drumPattern({ tier: 2, barInPhrase: 7, h: 0 });
    expect(p.snare[12] && p.snare[13] && p.snare[14] && p.snare[15]).toBe(true);
    const p3 = drumPattern({ tier: 3, barInPhrase: 7, h: 0 });
    expect(p3.snare[12] && p3.snare[13] && p3.snare[14] && p3.snare[15]).toBe(true);
  });
});

describe('conductor.directorTargets', () => {
  test('no signals — depth 1', () => {
    const t = directorTargets({ depth: 1 });
    expect(t.intensity).toBeCloseTo(0.15);
    expect(t.sparkle).toBe(0);
    expect(t.combat).toBe(false);
    expect(t.tempo).toBe(Math.round(92 + 0 + 0.15 * 26));
  });

  test('hostile at distance 1 raises intensity via danger 0.9 * 0.9', () => {
    const t = directorTargets({ depth: 1, proximity: { hostile: 1 } });
    expect(t.intensity).toBeCloseTo(0.81);
    expect(t.tempo).toBe(Math.round(92 + 0 + 0.81 * 26));
  });

  test('container at distance 3 raises sparkle to 0.7', () => {
    const t = directorTargets({ depth: 1, proximity: { container: 3 } });
    expect(t.sparkle).toBeCloseTo(0.7);
    expect(t.intensity).toBeCloseTo(0.15);
  });

  test('combat pins intensity to 1 and adds +18 to tempo', () => {
    const t = directorTargets({ depth: 1, combatActive: true });
    expect(t.intensity).toBe(1);
    expect(t.combat).toBe(true);
    expect(t.tempo).toBe(Math.round(92 + 0 + 26 + 18));
  });

  test('depth 30 raises floor to ~0.3917 and tempo shifts by 29', () => {
    const t = directorTargets({ depth: 30 });
    expect(t.intensity).toBeCloseTo(0.15 + 29 / 30 * 0.25);
    expect(t.tempo).toBe(Math.round(92 + 29 + (0.15 + 29 / 30 * 0.25) * 26));
    expect(t.tempo).toBeGreaterThanOrEqual(92);
    expect(t.tempo).toBeLessThanOrEqual(176);
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
      melody: p.melody.map((s) => (s ? { ...s } : null))
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
});
