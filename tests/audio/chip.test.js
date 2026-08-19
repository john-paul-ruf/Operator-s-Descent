import { describe, expect, test } from 'vitest';
import { FakeContext } from '../helpers/fake-audio.js';
import {
  buildLFSRBuffer,
  createEchoSend,
  dutyWave,
  playHat,
  playKick,
  playNote,
  playSnare
} from '../../src/audio/chip.js';

describe('chip.dutyWave', () => {
  test('imag[n] follows (2/(n*pi))*sin(n*pi*duty) and real is zero', () => {
    const ctx = new FakeContext();
    const wave = dutyWave(ctx, 0.5);
    expect(wave.real.length).toBe(33);
    expect(wave.imag.length).toBe(33);
    expect(wave.real[0]).toBe(0);
    expect(wave.imag[0]).toBe(0);
    for (let n = 1; n <= 32; n++) {
      expect(wave.imag[n]).toBeCloseTo((2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.5), 6);
      expect(wave.real[n]).toBe(0);
    }
  });

  test('caches PeriodicWaves per (context, duty)', () => {
    const ctx = new FakeContext();
    const a = dutyWave(ctx, 0.125);
    const b = dutyWave(ctx, 0.125);
    expect(a).toBe(b);
    const c = dutyWave(ctx, 0.25);
    expect(c).not.toBe(a);
    const other = new FakeContext();
    const d = dutyWave(other, 0.125);
    expect(d).not.toBe(a);
  });
});

describe('chip.buildLFSRBuffer', () => {
  test('generates ~0.5s of ±0.5 samples, deterministic across builds', () => {
    const ctx = new FakeContext();
    const buf1 = buildLFSRBuffer(ctx);
    const buf2 = buildLFSRBuffer(ctx);
    expect(buf1.length).toBe(Math.floor(ctx.sampleRate * 0.5));
    const a = Array.from(buf1.getChannelData(0));
    const b = Array.from(buf2.getChannelData(0));
    expect(a).toEqual(b);
    for (const v of a) expect(Math.abs(v)).toBeCloseTo(0.5, 10);
  });

  test('short mode differs from long mode', () => {
    const ctx = new FakeContext();
    const longMode = Array.from(buildLFSRBuffer(ctx).getChannelData(0));
    const shortMode = Array.from(buildLFSRBuffer(ctx, { short: true }).getChannelData(0));
    expect(shortMode).not.toEqual(longMode);
  });
});

describe('chip.playNote', () => {
  test('schedules the exact envelope events and stops the osc', () => {
    const ctx = new FakeContext();
    const dest = ctx.createGain();
    playNote(ctx, dest, { wave: 'pulse25', time: 1, freq: 440, duration: 0.5, velocity: 0.6 });
    const osc = ctx.nodes.find((n) => n.nodeKind === 'oscillator');
    expect(osc.type).toBe('custom');
    expect(osc.periodicWaves.length).toBe(1);
    expect(osc.frequency.events).toContainEqual(['set', 440, 1]);
    const env = ctx.nodes.find((n) => n.type === 'gain' && n.gain.events.length >= 3);
    expect(env).toBeTruthy();
    expect(env.gain.events[0]).toEqual(['set', 0, 1]);
    expect(env.gain.events[1]).toEqual(['linear', 0.6, 1.005]);
    expect(env.gain.events[2][0]).toBe('exp');
    expect(env.gain.events[2][1]).toBeCloseTo(0.001);
    expect(env.gain.events[2][2]).toBeCloseTo(1 + 0.5 * 0.9);
    expect(osc.started).toEqual([1]);
    expect(osc.stopped[0]).toBeCloseTo(1 + 0.5 + 0.05);
  });

  test('triangle wave skips setPeriodicWave', () => {
    const ctx = new FakeContext();
    playNote(ctx, ctx.destination, { wave: 'triangle', time: 0, freq: 220, duration: 0.2, velocity: 0.4 });
    const osc = ctx.nodes.find((n) => n.nodeKind === 'oscillator');
    expect(osc.type).toBe('triangle');
    expect(osc.periodicWaves.length).toBe(0);
  });

  test('slideTo schedules a linear frequency ramp', () => {
    const ctx = new FakeContext();
    playNote(ctx, ctx.destination, { wave: 'triangle', time: 0, freq: 100, duration: 0.4, velocity: 0.3, slideTo: 200 });
    const osc = ctx.nodes.find((n) => n.nodeKind === 'oscillator');
    expect(osc.frequency.events.some((e) => e[0] === 'linear' && e[1] === 200 && Math.abs(e[2] - 0.4) < 1e-9)).toBe(true);
  });

  test('vibrato wires an LFO into osc.frequency', () => {
    const ctx = new FakeContext();
    playNote(ctx, ctx.destination, { wave: 'triangle', time: 0, freq: 220, duration: 0.4, velocity: 0.3, vibrato: { rate: 6, depth: 4 } });
    const oscs = ctx.nodes.filter((n) => n.nodeKind === 'oscillator');
    expect(oscs.length).toBe(2);
    const lfo = oscs[1];
    expect(lfo.frequency.events).toContainEqual(['set', 6, 0]);
    const lfoGain = ctx.nodes.filter((n) => n.nodeKind === 'gain').find((g) => g.gain.events.some((e) => e[0] === 'set' && e[1] === 4));
    expect(lfoGain).toBeTruthy();
    expect(lfoGain.connections).toContain(oscs[0].frequency);
  });
});

describe('chip.playKick', () => {
  test('triangle osc, freq ramps 110→38 Hz over 0.09s, env decays over 0.12s', () => {
    const ctx = new FakeContext();
    playKick(ctx, ctx.destination, { time: 2, velocity: 0.8 });
    const osc = ctx.nodes.find((n) => n.nodeKind === 'oscillator');
    expect(osc.type).toBe('triangle');
    expect(osc.frequency.events[0]).toEqual(['set', 110, 2]);
    expect(osc.frequency.events[1][0]).toBe('exp');
    expect(osc.frequency.events[1][1]).toBe(38);
    expect(osc.frequency.events[1][2]).toBeCloseTo(2.09);
    const env = ctx.nodes.filter((n) => n.nodeKind === 'gain').find((g) => g.gain.events.some((e) => e[0] === 'linear' && e[1] === 0.8));
    expect(env).toBeTruthy();
    expect(env.gain.events[2][2]).toBeCloseTo(2.12);
  });
});

describe('chip.playSnare', () => {
  test('noise burst + triangle thump both scheduled at time', () => {
    const ctx = new FakeContext();
    const noiseBuffer = buildLFSRBuffer(ctx);
    playSnare(ctx, ctx.destination, { time: 5, velocity: 0.5, noiseBuffer });
    const src = ctx.nodes.find((n) => n.nodeKind === 'bufferSource');
    expect(src.buffer).toBe(noiseBuffer);
    expect(src.started).toEqual([5]);
    const thump = ctx.nodes.find((n) => n.nodeKind === 'oscillator');
    expect(thump.type).toBe('triangle');
    expect(thump.frequency.events).toContainEqual(['set', 180, 5]);
  });
});

describe('chip.playHat', () => {
  test('short-noise buffer through highpass 6000, quick 0.03s envelope', () => {
    const ctx = new FakeContext();
    const shortBuffer = buildLFSRBuffer(ctx, { short: true });
    playHat(ctx, ctx.destination, { time: 0.4, velocity: 0.6, shortBuffer });
    const src = ctx.nodes.find((n) => n.nodeKind === 'bufferSource');
    expect(src.buffer).toBe(shortBuffer);
    const hp = ctx.nodes.find((n) => n.nodeKind === 'filter');
    expect(hp.type).toBe('highpass');
    expect(hp.frequency.events).toContainEqual(['set', 6000, 0.4]);
    const env = ctx.nodes.filter((n) => n.nodeKind === 'gain').find((g) => g.gain.events.some((e) => e[0] === 'exp' && Math.abs(e[2] - 0.43) < 1e-9));
    expect(env).toBeTruthy();
  });
});

describe('chip.createEchoSend', () => {
  test('wires input→delay→lowpass→feedback→delay and delay→level', () => {
    const ctx = new FakeContext();
    const dest = ctx.createGain();
    const echo = createEchoSend(ctx, { delayTime: 0.3, feedback: 0.4, level: 0.2 });
    echo.connect(dest);

    const delay = ctx.nodes.find((n) => n.nodeKind === 'delay');
    expect(delay).toBeTruthy();
    expect(delay.delayTime.value).toBe(0.3);
    const lowpass = ctx.nodes.find((n) => n.nodeKind === 'filter');
    expect(lowpass.type).toBe('lowpass');
    expect(lowpass.frequency.value).toBe(2200);
    expect(echo.input.connections).toContain(delay);
    expect(delay.connections).toContain(lowpass);
    const fbGain = ctx.nodes.filter((n) => n.nodeKind === 'gain').find((g) => g.gain.value === 0.4);
    expect(fbGain).toBeTruthy();
    expect(lowpass.connections).toContain(fbGain);
    expect(fbGain.connections).toContain(delay);
    const levelGain = ctx.nodes.filter((n) => n.nodeKind === 'gain').find((g) => g.gain.value === 0.2);
    expect(levelGain).toBeTruthy();
    expect(delay.connections).toContain(levelGain);
    expect(levelGain.connections).toContain(dest);

    echo.disconnect();
    expect(echo.input.disconnected).toBe(true);
    expect(delay.disconnected).toBe(true);
    expect(lowpass.disconnected).toBe(true);
    expect(fbGain.disconnected).toBe(true);
    expect(levelGain.disconnected).toBe(true);
  });
});
