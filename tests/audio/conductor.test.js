import { describe, expect, test } from 'vitest';
import {
  chordFor,
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
