import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeContext } from '../helpers/fake-audio.js';
import { createAudioEngine } from '../../src/audio/engine.js';
import { createDrone } from '../../src/audio/drone.js';
import { createLead } from '../../src/audio/lead.js';
import { createNoiseBed } from '../../src/audio/noise-bed.js';
import { createSparkle } from '../../src/audio/sparkle.js';
import { dutyWave } from '../../src/audio/chip.js';

function makeFakeConductor() {
  const subs = new Set();
  return {
    subs,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    start() {},
    stop() {},
    updateState() {},
    getState() { return { tempo: 96, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 }, intensity: 0, sparkle: 0, combat: false, audioMode: 'cold-ambient', phraseKey: null, ledgerSize: 0 }; }
  };
}

function emptyDrums() {
  return { kick: new Array(16).fill(false), snare: new Array(16).fill(false), hat: new Array(16).fill(false) };
}

function makeTick(overrides = {}) {
  return {
    time: 0.05,
    pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 },
    tempo: 100,
    secondsPerSixteenth: 0.15,
    chord: { degree: 0, semis: [0, 4, 7] },
    scale: [0, 2, 4, 5, 7, 9, 11],
    rootFreq: 110,
    intensity: 0.3,
    sparkle: 0,
    combat: false,
    melody: new Array(16).fill(null),
    drums: emptyDrums(),
    ...overrides
  };
}

function emit(conductor, tick) {
  for (const fn of conductor.subs) fn(tick);
}

function driveEngine(ctx, seconds, stepMs = 25) {
  const endMs = Math.round(seconds * 1000);
  const startMs = Math.round(ctx.currentTime * 1000);
  for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
    ctx.currentTime = t / 1000;
    vi.advanceTimersByTime(stepMs);
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('five layer audio score', () => {
  test('engine API — layer keys, mute, conductor lifecycle, idempotent destroy', () => {
    const ctx = new FakeContext();
    const engine = createAudioEngine(ctx);

    expect(engine.start()).toBe(true);
    expect(engine.start()).toBe(false);
    expect(engine.getGraphState().layers.sort()).toEqual(['drone', 'lead', 'noiseBed', 'pulse', 'sparkle']);
    expect(engine.getGraphState().conductor).not.toBeNull();
    engine.applySettings({ masterMute: true, layerVolumes: { drone: 25, pulse: 0, sparkle: 50, lead: 75, noiseBed: 100 } });
    expect(engine.getGraphState().muted).toBe(true);

    // applySettings honors an explicit masterVolume; a subsequent settings
    // object that omits the key leaves master untouched (the guard prevents
    // Number(undefined)=NaN from silencing the bus). Out-of-range clamps.
    engine.applySettings({ masterVolume: 40 });
    expect(engine.getGraphState().masterVolume).toBe(40);
    engine.applySettings({ masterMute: false });
    expect(engine.getGraphState().masterVolume).toBe(40);
    engine.applySettings({ masterVolume: 250 });
    expect(engine.getGraphState().masterVolume).toBe(100);
    engine.applySettings({ masterVolume: -20 });
    expect(engine.getGraphState().masterVolume).toBe(0);

    engine.destroy();
    engine.destroy();
    expect(engine.isStarted()).toBe(false);
    expect(engine.getGraphState().conductor).toBeNull();
    expect(ctx.nodes.some((node) => node.disconnected)).toBe(true);
  });

  test('engine does not create a context when none is injected', () => {
    const engine = createAudioEngine();
    expect(engine.start()).toBe(false);
    expect(engine.isStarted()).toBe(false);
  });

  test('rendered notes align to the conductor 16th grid', () => {
    const ctx = new FakeContext();
    const engine = createAudioEngine(ctx);
    engine.start();
    engine.updateState({
      worldSeed: 1, depth: 1, floorId: 'align', audioMode: 'organic-green',
      proximity: { hostile: 10, container: 10 }, combatActive: false
    });
    const sustainedCount = ctx.nodes.length;

    driveEngine(ctx, 3);

    const later = ctx.nodes.slice(sustainedCount);
    // Filter out vibrato LFOs (type='sine' oscillators added by playNote for
    // sustained lead notes) — they start at note-time + delay by design and
    // are modulation, not rendered notes. Musical oscillators are either
    // triangle-typed (kick) or use setPeriodicWave (pulse waves); percussion
    // is bufferSource. Sine oscillators are only ever vibrato LFOs.
    const times = later
      .filter((n) => (n.nodeKind === 'oscillator' || n.nodeKind === 'bufferSource') && n.started.length && n.type !== 'sine')
      .map((n) => n.started[0])
      .filter((t) => t > 0)
      .sort((a, b) => a - b);
    expect(times.length).toBeGreaterThan(4);

    // Derive the 16th grid from the live conductor tempo instead of hardcoding
    // it — the intensity/depth → tempo curve is subject to composition tuning
    // (floor 112, upbeat-melodic-score S01) and every future adjustment should
    // stay covered without another test edit (Custom Rule 11 — strengthen).
    const conductorTempo = engine.getGraphState().conductor?.tempo;
    expect(Number.isFinite(conductorTempo)).toBe(true);
    const secondsPerSixteenth = 60 / conductorTempo / 4;
    const firstTickTime = times[0];
    for (const t of times) {
      const k = (t - firstTickTime) / secondsPerSixteenth;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-3);
    }
    engine.destroy();
  });

  describe('reactivity', () => {
    test('drum tier climbs when a hostile is close', () => {
      const ctx = new FakeContext();
      const engine = createAudioEngine(ctx);
      engine.start();
      engine.updateState({
        worldSeed: 1, depth: 3, floorId: 'danger', audioMode: 'organic-green',
        proximity: { hostile: 1, container: 10 }, combatActive: false
      });
      const sustainedCount = ctx.nodes.length;

      driveEngine(ctx, 5);

      const drumBufferSources = ctx.nodes.slice(sustainedCount).filter(
        (n) => n.nodeKind === 'bufferSource' && n.started.length && n.started[0] > 0
      );
      expect(drumBufferSources.length).toBeGreaterThan(5);
      engine.destroy();
    });

    test('sparkle arps chord tones when a container is close', () => {
      const ctx = new FakeContext();
      const conductor = makeFakeConductor();
      const sparkle = createSparkle(ctx, ctx.destination, conductor);
      sparkle.updateState({ proximity: { container: 2 } });
      sparkle.start();
      const before = ctx.nodes.length;

      emit(conductor, makeTick({
        chord: { degree: 0, semis: [0, 3, 7] },
        rootFreq: 110,
        sparkle: 0.9,
        pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 }
      }));
      emit(conductor, makeTick({
        chord: { degree: 0, semis: [0, 3, 7] },
        rootFreq: 110,
        sparkle: 0.9,
        pos: { step: 2, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 }
      }));

      expect(ctx.nodes.length).toBeGreaterThan(before);
      const wave = dutyWave(ctx, 0.25);
      const arpOsc = ctx.nodes.slice(before).find(
        (n) => n.nodeKind === 'oscillator' && n.periodicWaves?.includes?.(wave)
      );
      expect(arpOsc).toBeTruthy();
      expect(sparkle.getState().cutoff).toBeGreaterThan(2500);
      sparkle.stop();
    });

    test('combat switches the lead to a 12.5% duty pulse and taps the echo', () => {
      const ctx = new FakeContext();
      const conductor = makeFakeConductor();
      const echoInput = ctx.createGain();
      const lead = createLead(ctx, ctx.destination, conductor, echoInput);
      lead.start();

      const melody = new Array(16).fill(null);
      melody[0] = { degree: 0, octave: 0, velocity: 0.6, lengthSlots: 3 };

      emit(conductor, makeTick({
        pos: { step: 0, beat: 0, bar: 5, barInPhrase: 5, phraseIndex: 1 },
        tempo: 128,
        combat: true,
        rootFreq: 110,
        melody
      }));

      expect(lead.getState()).toEqual({ tempo: 128, barIndex: 5 });
      const combatWave = dutyWave(ctx, 0.125);
      const combatOsc = ctx.nodes.find((n) => n.nodeKind === 'oscillator' && n.periodicWaves?.includes?.(combatWave));
      expect(combatOsc).toBeTruthy();

      const echoRoutedOsc = ctx.nodes.find((n) =>
        n.nodeKind === 'oscillator' &&
        n.periodicWaves?.includes?.(combatWave) &&
        n.connections?.length &&
        n.connections[0].connections?.includes?.(echoInput)
      );
      expect(echoRoutedOsc).toBeTruthy();
      lead.stop();
    });
  });

  test('drone builds the pad without illegal OscillatorNode.type assignment', () => {
    const ctx = new FakeContext();
    const conductor = makeFakeConductor();
    const dest = ctx.createGain();
    const drone = createDrone(ctx, dest, conductor);
    expect(() => drone.start()).not.toThrow();
    const padOscs = ctx.nodes.filter(
      (n) => n.nodeKind === 'oscillator' && n.periodicWaves.length >= 1
    );
    expect(padOscs.length).toBeGreaterThanOrEqual(1);
    for (const osc of ctx.nodes) {
      if (osc.nodeKind === 'oscillator') expect(osc.type).not.toBe('custom');
    }
    drone.destroy();
  });

  test('noise bed is fixed machine texture and ignores game state', () => {
    const ctx = new FakeContext();
    const noise = createNoiseBed(ctx, ctx.destination);
    noise.start();
    const buffer = ctx.nodes.find((node) => node.type === 'bufferSource').buffer;
    const first = Array.from(buffer.getChannelData(0).slice(0, 4));
    noise.updateState({ depth: 99, proximity: { hostile: 0 } });
    expect(Array.from(buffer.getChannelData(0).slice(0, 4))).toEqual(first);
    expect(noise.getNodeCount()).toBeGreaterThan(0);
    noise.destroy();
    expect(noise.getNodeCount()).toBe(0);
  });
});
