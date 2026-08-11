import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createAudioEngine } from '../../src/audio/engine.js';
import { createDrone } from '../../src/audio/drone.js';
import { createLead, generateLeadBar } from '../../src/audio/lead.js';
import { createNoiseBed } from '../../src/audio/noise-bed.js';
import { createPulse } from '../../src/audio/pulse.js';
import { createSparkle } from '../../src/audio/sparkle.js';

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exp', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}

class Node {
  constructor(type) {
    this.type = type;
    this.connections = [];
    this.started = [];
    this.stopped = [];
    this.gain = new Param(1);
    this.frequency = new Param(440);
    this.detune = new Param(0);
    this.Q = new Param(0);
  }
  connect(dest) { this.connections.push(dest); return dest; }
  disconnect() { this.disconnected = true; }
  start(time = 0) { this.started.push(time); }
  stop(time = 0) { this.stopped.push(time); }
}

class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 100;
    this.destination = new Node('destination');
    this.nodes = [];
  }
  make(type) { const node = new Node(type); this.nodes.push(node); return node; }
  createGain() { return this.make('gain'); }
  createOscillator() { return this.make('oscillator'); }
  createBiquadFilter() { return this.make('filter'); }
  createBufferSource() { return this.make('bufferSource'); }
  createBuffer(channels, length) { return { channels, length, sampleRate: this.sampleRate, data: new Float32Array(length), getChannelData(index) { return this.data; } }; }
  suspend() { this.suspended = true; return Promise.resolve(); }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('five layer audio score', () => {
  test('engine owns one injected graph and cleans it up idempotently', () => {
    const ctx = new FakeContext();
    const engine = createAudioEngine(ctx);

    expect(engine.start()).toBe(true);
    expect(engine.start()).toBe(false);
    expect(engine.getGraphState().layers.sort()).toEqual(['drone', 'lead', 'noiseBed', 'pulse', 'sparkle']);
    engine.applySettings({ masterMute: true, layerVolumes: { drone: 25, pulse: 0, sparkle: 50, lead: 75, noiseBed: 100 } });
    expect(engine.getGraphState().muted).toBe(true);
    engine.destroy();
    engine.destroy();
    expect(engine.isStarted()).toBe(false);
    expect(ctx.nodes.some((node) => node.disconnected)).toBe(true);
  });

  test('engine does not create a context when none is injected', () => {
    const engine = createAudioEngine();
    expect(engine.start()).toBe(false);
    expect(engine.isStarted()).toBe(false);
  });

  test('drone maps theme and depth with a 1.2s retune glide', () => {
    const ctx = new FakeContext();
    const drone = createDrone(ctx, ctx.destination);
    drone.start();
    drone.updateState({ theme: { audioMode: 'foundry-industrial' }, depth: 9 });

    expect(drone.getState()).toMatchObject({ audioMode: 'foundry-industrial', depth: 9, oscillatorCount: 6 });
    const oscillator = ctx.nodes.find((node) => node.frequency?.events?.some((event) => event[0] === 'linear' && event[2] === 1.2));
    expect(oscillator).toBeTruthy();
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

  test('lead bars are deterministic and avoid rolling ledger repeats', () => {
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
