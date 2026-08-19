import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeContext } from '../helpers/fake-audio.js';
import { createAudioEngine } from '../../src/audio/engine.js';
import { createDrone } from '../../src/audio/drone.js';
import { createLead } from '../../src/audio/lead.js';
import { createNoiseBed } from '../../src/audio/noise-bed.js';
import { createPulse } from '../../src/audio/pulse.js';
import { createSparkle } from '../../src/audio/sparkle.js';

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

    for (const fn of conductor.subs) fn(makeTick({
      chord: { degree: 3, semis: [3, 6, 10] },
      rootFreq: 90
    }));

    const padOsc = ctx.nodes.find((node) =>
      node.nodeKind === 'oscillator' && node.frequency?.events?.some((e) => e[0] === 'linear')
    );
    expect(padOsc).toBeTruthy();
    drone.stop();
  });

  test('pulse and sparkle clamp proximity and transform density without game coupling', () => {
    const ctx = new FakeContext();
    const pulse = createPulse(ctx, ctx.destination);
    const sparkle = createSparkle(ctx, ctx.destination);
    pulse.start();
    sparkle.start();
    pulse.updateState({ proximity: { hostile: 1 }, combatActive: true });
    sparkle.updateState({ proximity: { container: 2 } });

    expect(pulse.getState().tempo).toBeGreaterThan(180);
    expect(pulse.getState().combat).toBe(true);
    expect(sparkle.getState().cutoff).toBeGreaterThan(2500);
    pulse.stop();
    sparkle.stop();
  });

  test('lead ledger stays unique and combat raises tempo', async () => {
    const { generateLeadBar } = await import('../../src/audio/lead.js');
    const a = generateLeadBar({ worldSeed: 7, depth: 3, floorId: 'f1', barIndex: 2, audioMode: 'organic-green' });
    const b = generateLeadBar({ worldSeed: 7, depth: 3, floorId: 'f1', barIndex: 2, audioMode: 'organic-green' });
    expect(b).toEqual(a);

    const ctx = new FakeContext();
    const lead = createLead(ctx, ctx.destination);
    lead.updateState({ worldSeed: 7, depth: 3, floorId: 'f1', audioMode: 'organic-green' });
    lead.start();
    vi.advanceTimersByTime(100);
    expect(new Set(lead.getLedger()).size).toBe(lead.getLedger().length);
    lead.updateState({ combatActive: true });
    expect(lead.getState().tempo).toBeGreaterThan(72);
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
