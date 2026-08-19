import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeContext } from '../helpers/fake-audio.js';
import { createAudioEngine } from '../../src/audio/engine.js';
import { createDrone } from '../../src/audio/drone.js';
import { createLead } from '../../src/audio/lead.js';
import { createNoiseBed } from '../../src/audio/noise-bed.js';
import { createPulse } from '../../src/audio/pulse.js';
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('five layer audio score', () => {
  test('engine owns one injected graph, wires the conductor, cleans up idempotently', () => {
    const ctx = new FakeContext();
    const engine = createAudioEngine(ctx);

    expect(engine.start()).toBe(true);
    expect(engine.start()).toBe(false);
    expect(engine.getGraphState().layers.sort()).toEqual(['drone', 'lead', 'noiseBed', 'pulse', 'sparkle']);
    expect(engine.getGraphState().conductor).not.toBeNull();
    engine.applySettings({ masterMute: true, layerVolumes: { drone: 25, pulse: 0, sparkle: 50, lead: 75, noiseBed: 100 } });
    expect(engine.getGraphState().muted).toBe(true);
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

  test('drone pad ramps to the new chord voicing on a step-0 chord change', () => {
    const ctx = new FakeContext();
    const conductor = makeFakeConductor();
    const drone = createDrone(ctx, ctx.destination, conductor);
    drone.updateState({ theme: { audioMode: 'foundry-industrial' }, depth: 9 });
    drone.start();
    expect(drone.getState()).toMatchObject({ audioMode: 'foundry-industrial', depth: 9, oscillatorCount: 2 });

    emit(conductor, makeTick({
      chord: { degree: 3, semis: [3, 6, 10] },
      rootFreq: 90
    }));

    const padOsc = ctx.nodes.find((node) =>
      node.nodeKind === 'oscillator' && node.frequency?.events?.some((e) => e[0] === 'linear')
    );
    expect(padOsc).toBeTruthy();
    drone.stop();
  });

  test('pulse renders conductor drums, tracks tempo from ticks, and applies danger cutoff', () => {
    const ctx = new FakeContext();
    const conductor = makeFakeConductor();
    const pulse = createPulse(ctx, ctx.destination, conductor);
    pulse.start();
    pulse.updateState({ proximity: { hostile: 1 }, combatActive: true });

    const before = ctx.nodes.length;
    const drums = emptyDrums();
    drums.kick[0] = true;
    drums.snare[4] = true;
    drums.hat[2] = true;
    for (const step of [0, 2, 4]) {
      emit(conductor, makeTick({
        time: 0.1 + step * 0.15,
        pos: { step, beat: Math.floor(step / 4), bar: 0, barInPhrase: 0, phraseIndex: 0 },
        tempo: 140,
        intensity: 1,
        combat: true,
        drums
      }));
    }

    expect(ctx.nodes.length).toBeGreaterThan(before);
    expect(pulse.getState()).toMatchObject({ tempo: 140, combat: true });
    expect(pulse.getState().nearestDist).toBe(1);
    pulse.stop();
  });

  test('sparkle clamps proximity and opens its lowpass on nearby containers', () => {
    const ctx = new FakeContext();
    const sparkle = createSparkle(ctx, ctx.destination);
    sparkle.start();
    sparkle.updateState({ proximity: { container: 2 } });
    expect(sparkle.getState().cutoff).toBeGreaterThan(2500);
    sparkle.stop();
  });

  test('lead renders conductor melody, switches to 12.5% duty on combat, and taps the echo', () => {
    const ctx = new FakeContext();
    const conductor = makeFakeConductor();
    const echoInput = ctx.createGain();
    const lead = createLead(ctx, ctx.destination, conductor, echoInput);
    lead.start();
    const before = ctx.nodes.length;

    const melody = new Array(16).fill(null);
    melody[0] = { degree: 0, octave: 0, velocity: 0.6, lengthSlots: 3 };
    melody[4] = { degree: 7, octave: 0, velocity: 0.5, lengthSlots: 2 };

    emit(conductor, makeTick({
      time: 0.1,
      pos: { step: 0, beat: 0, bar: 5, barInPhrase: 5, phraseIndex: 1 },
      tempo: 128,
      combat: true,
      rootFreq: 110,
      melody
    }));

    expect(ctx.nodes.length).toBeGreaterThan(before);
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
