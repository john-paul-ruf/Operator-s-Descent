import { describe, expect, test } from 'vitest';
import { FakeContext } from '../helpers/fake-audio.js';
import { createPulse } from '../../src/audio/pulse.js';
import { createDrone } from '../../src/audio/drone.js';
import { createLead } from '../../src/audio/lead.js';
import { createSparkle } from '../../src/audio/sparkle.js';
import { createNoiseBed } from '../../src/audio/noise-bed.js';
import { dutyWave } from '../../src/audio/chip.js';

function makeStubConductor() {
  let subscriber = null;
  return {
    subscribe(fn) { subscriber = fn; return () => { subscriber = null; }; },
    emit(tick) { if (subscriber) subscriber(tick); },
    hasSubscriber() { return subscriber !== null; }
  };
}

function emptyDrums() {
  return { kick: new Array(16).fill(false), snare: new Array(16).fill(false), hat: new Array(16).fill(false) };
}

function makeTick(overrides = {}) {
  return {
    time: 1,
    pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 },
    tempo: 128,
    secondsPerSixteenth: 60 / 128 / 4,
    chord: { degree: 0, semis: [0, 4, 7] },
    scale: [0, 2, 4, 5, 7, 9, 11],
    rootFreq: 220,
    intensity: 0.5,
    sparkle: 0.25,
    combat: false,
    melody: new Array(16).fill(null),
    bass: new Array(16).fill(null),
    drums: emptyDrums(),
    ...overrides
  };
}

describe('pulse layer', () => {
  test('creates no lowpass between drum players and the layer bus', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const pulse = createPulse(ctx, ctx.destination, conductor);
    pulse.start();
    const filters = ctx.nodes.filter((n) => n.nodeKind === 'filter');
    expect(filters).toEqual([]);
    pulse.stop();
  });

  test('kick routes through the kick path (0.9 gain) and reaches the layer bus', () => {
    const ctx = new FakeContext();
    const dest = ctx.createGain();
    const conductor = makeStubConductor();
    const pulse = createPulse(ctx, dest, conductor);
    pulse.start();

    const layerBus = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.connections.includes(dest));
    expect(layerBus).toBeTruthy();
    const kickPath = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.gain.value === 0.9 && n.connections.includes(layerBus));
    expect(kickPath).toBeTruthy();
    const brightPath = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.gain.value === 0.75 && n.connections.includes(layerBus));
    expect(brightPath).toBeTruthy();

    const before = ctx.nodes.length;
    const drums = emptyDrums(); drums.kick[0] = true;
    conductor.emit(makeTick({ drums, intensity: 1 }));

    const kickNodes = ctx.nodes.slice(before);
    const kickOsc = kickNodes.find((n) => n.nodeKind === 'oscillator');
    expect(kickOsc).toBeTruthy();
    expect(kickOsc.type).toBe('triangle');
    const kickEnv = kickNodes.find((n) => n.nodeKind === 'gain' && n.connections.includes(kickPath));
    expect(kickEnv).toBeTruthy();
    pulse.stop();
  });

  test('snare and hat route through the bright path, kick does not', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const pulse = createPulse(ctx, ctx.destination, conductor);
    pulse.start();
    const layerBus = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.connections.includes(ctx.destination));
    const brightPath = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.gain.value === 0.75 && n.connections.includes(layerBus));
    const kickPath = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.gain.value === 0.9 && n.connections.includes(layerBus));

    let before = ctx.nodes.length;
    const snareDrums = emptyDrums(); snareDrums.snare[4] = true;
    conductor.emit(makeTick({ pos: { step: 4, beat: 1, bar: 0, barInPhrase: 0, phraseIndex: 0 }, drums: snareDrums }));
    const snareNodes = ctx.nodes.slice(before);
    // The snare noise envelope and the thump envelope both connect to brightGain.
    const snareConnectsToBright = snareNodes.filter((n) => n.nodeKind === 'gain' && n.connections.includes(brightPath));
    expect(snareConnectsToBright.length).toBeGreaterThanOrEqual(2);
    const snareConnectsToKick = snareNodes.filter((n) => n.connections.includes(kickPath));
    expect(snareConnectsToKick.length).toBe(0);

    before = ctx.nodes.length;
    const hatDrums = emptyDrums(); hatDrums.hat[0] = true;
    conductor.emit(makeTick({ pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 }, drums: hatDrums }));
    const hatNodes = ctx.nodes.slice(before);
    const hatConnectsToBright = hatNodes.filter((n) => n.nodeKind === 'gain' && n.connections.includes(brightPath));
    expect(hatConnectsToBright.length).toBeGreaterThanOrEqual(1);
    pulse.stop();
  });

  test('drum velocity comes from tick intensity, and weak-beat hats are halved', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const pulse = createPulse(ctx, ctx.destination, conductor);
    pulse.setVolume(1);
    pulse.start();

    // Strong hat at step 0: velocity = (0.55 + intensity * 0.45) * volume
    let before = ctx.nodes.length;
    const strongDrums = emptyDrums(); strongDrums.hat[0] = true;
    conductor.emit(makeTick({ intensity: 1, drums: strongDrums, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    const strongEnv = ctx.nodes.slice(before)
      .find((n) => n.nodeKind === 'gain' && n.gain.events.some((e) => e[0] === 'linear'));
    const strongLinear = strongEnv.gain.events.find((e) => e[0] === 'linear');
    // playHat multiplies incoming velocity by 0.5 inside its envelope; caller velocity is 1.0 at intensity=1.
    // So the linear ramp target = 1.0 * 0.5 = 0.5.
    expect(strongLinear[1]).toBeCloseTo(0.5);

    // Weak hat at step 6: caller velocity = 1.0 * 0.5 = 0.5, playHat halves to 0.25.
    before = ctx.nodes.length;
    const weakDrums = emptyDrums(); weakDrums.hat[6] = true;
    conductor.emit(makeTick({ intensity: 1, drums: weakDrums, pos: { step: 6, beat: 1, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    const weakEnv = ctx.nodes.slice(before)
      .find((n) => n.nodeKind === 'gain' && n.gain.events.some((e) => e[0] === 'linear'));
    const weakLinear = weakEnv.gain.events.find((e) => e[0] === 'linear');
    expect(weakLinear[1]).toBeCloseTo(0.25);
    pulse.stop();
  });

  test('updateState stores proximity/combat for getState but does not schedule filter ramps', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const pulse = createPulse(ctx, ctx.destination, conductor);
    pulse.start();
    pulse.updateState({ proximity: { hostile: 2 }, combatActive: true });
    const state = pulse.getState();
    expect(state.nearestDist).toBe(2);
    expect(state.combat).toBe(true);
    expect(ctx.nodes.filter((n) => n.nodeKind === 'filter')).toEqual([]);
    pulse.stop();
  });
});

describe('drone layer', () => {
  test('schedules a triangle note exactly when tick.bass[step] is non-null at the computed freq', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const drone = createDrone(ctx, ctx.destination, conductor);
    drone.setVolume(1);
    drone.start();
    const before = ctx.nodes.length;

    const bass = new Array(16).fill(null);
    bass[4] = { semi: 2, octave: 0, velocity: 0.8, lengthSlots: 3 };
    conductor.emit(makeTick({
      pos: { step: 4, beat: 1, bar: 0, barInPhrase: 0, phraseIndex: 0 },
      rootFreq: 220,
      secondsPerSixteenth: 0.1,
      bass
    }));

    const newOscs = ctx.nodes.slice(before).filter((n) => n.nodeKind === 'oscillator');
    expect(newOscs.length).toBe(1);
    const noteOsc = newOscs[0];
    expect(noteOsc.type).toBe('triangle');
    const expectedFreq = Math.max(27.5, (220 / 2) * Math.pow(2, 2 / 12) * Math.pow(2, 0));
    expect(noteOsc.frequency.events[0][0]).toBe('set');
    expect(noteOsc.frequency.events[0][1]).toBeCloseTo(expectedFreq);

    // Duration = lengthSlots * secondsPerSixteenth = 3 * 0.1 = 0.3; velocity = slot.velocity * volume.
    const env = ctx.nodes.slice(before).find((n) => n.nodeKind === 'gain' && n.gain.events.some((e) => e[0] === 'linear'));
    const linear = env.gain.events.find((e) => e[0] === 'linear');
    expect(linear[1]).toBeCloseTo(0.8);
    drone.stop();
  });

  test('bass output stays silent when tick.bass[step] is null (no step-gate heartbeat)', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const drone = createDrone(ctx, ctx.destination, conductor);
    drone.start();
    const before = ctx.nodes.length;

    // Empty bass across all 16 sixteenths — the old heartbeat gate would have fired at step 0.
    for (let step = 0; step < 16; step++) {
      conductor.emit(makeTick({
        pos: { step, beat: Math.floor(step / 4), bar: 0, barInPhrase: 0, phraseIndex: 0 },
        rootFreq: 220,
        secondsPerSixteenth: 0.1,
        chord: { degree: 0, semis: [0, 4, 7] }
      }));
    }
    const oscsFromBass = ctx.nodes.slice(before).filter((n) => n.nodeKind === 'oscillator');
    expect(oscsFromBass).toEqual([]);
    drone.stop();
  });

  test('bass bus is single-gain (0.55 * volume) and slot velocity is not double-scaled', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const drone = createDrone(ctx, ctx.destination, conductor);
    drone.setVolume(1);
    drone.start();

    const bassBus = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.connections.includes(ctx.destination) && Math.abs(n.gain.value - 0.55) < 1e-9);
    expect(bassBus).toBeTruthy();

    const before = ctx.nodes.length;
    const bass = new Array(16).fill(null);
    bass[0] = { semi: 0, octave: 0, velocity: 0.9, lengthSlots: 4 };
    conductor.emit(makeTick({
      pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 },
      rootFreq: 220,
      secondsPerSixteenth: 0.1,
      bass
    }));
    const env = ctx.nodes.slice(before).find((n) => n.nodeKind === 'gain' && n.gain.events.some((e) => e[0] === 'linear'));
    const linear = env.gain.events.find((e) => e[0] === 'linear');
    // Envelope peak = slot.velocity * volume = 0.9 * 1 = 0.9 (no extra 0.5×).
    expect(linear[1]).toBeCloseTo(0.9);
    drone.stop();
  });

  test('pad has two running LFO oscillators (breathing filter + gain) beyond the two pad oscs', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const drone = createDrone(ctx, ctx.destination, conductor);
    drone.start();

    const oscs = ctx.nodes.filter((n) => n.nodeKind === 'oscillator');
    const padOscs = oscs.filter((n) => n.periodicWaves.length >= 1);
    const lfoOscs = oscs.filter((n) => n.type === 'sine' && n.periodicWaves.length === 0);
    expect(padOscs.length).toBe(2);
    expect(lfoOscs.length).toBe(2);
    for (const lfo of lfoOscs) {
      expect(lfo.started.length).toBe(1);
    }
    const filterLFO = lfoOscs.find((n) => Math.abs(n.frequency.value - 0.07) < 1e-9);
    const padGainLFO = lfoOscs.find((n) => Math.abs(n.frequency.value - 0.05) < 1e-9);
    expect(filterLFO).toBeTruthy();
    expect(padGainLFO).toBeTruthy();

    // Filter LFO amplitude = theme.filterFreq * 0.15 (cold-ambient default: 800 * 0.15 = 120).
    const filterLFOGain = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.connections.length === 1
      && filterLFO.connections.includes(n) && Math.abs(n.gain.value - 800 * 0.15) < 1e-6);
    expect(filterLFOGain).toBeTruthy();
    drone.stop();
  });
});

describe('lead layer', () => {
  test('freq for a known slot = rootFreq * 4 * 2^(semitone/12)', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const lead = createLead(ctx, ctx.destination, conductor, null);
    lead.start();
    const before = ctx.nodes.length;

    const melody = new Array(16).fill(null);
    melody[0] = { degree: 7, octave: 0, velocity: 0.6, lengthSlots: 2 };
    conductor.emit(makeTick({
      pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 },
      rootFreq: 100,
      melody,
      intensity: 0.3
    }));

    const osc = ctx.nodes.slice(before).find((n) => n.nodeKind === 'oscillator');
    expect(osc).toBeTruthy();
    const expected = 100 * 4 * Math.pow(2, 7 / 12);
    expect(osc.frequency.events[0][0]).toBe('set');
    expect(osc.frequency.events[0][1]).toBeCloseTo(expected);
    lead.stop();
  });

  test('long notes (lengthSlots >= 4) use sustain envelope + delayed vibrato; short notes use pluck', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const lead = createLead(ctx, ctx.destination, conductor, null);
    lead.start();

    // lengthSlots 6 → sustain, vibrato delay 0.15
    let before = ctx.nodes.length;
    const longMelody = new Array(16).fill(null);
    longMelody[0] = { degree: 0, octave: 0, velocity: 0.6, lengthSlots: 6 };
    conductor.emit(makeTick({
      pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 },
      secondsPerSixteenth: 0.1,
      melody: longMelody
    }));
    const longNodes = ctx.nodes.slice(before);
    const longEnv = longNodes.find((n) => n.nodeKind === 'gain' && n.gain.events.length === 4);
    expect(longEnv).toBeTruthy(); // sustain = 4 events (set 0, linear velocity, set 0.85·velocity, exp release)
    expect(longEnv.gain.events[2][0]).toBe('set');
    expect(longEnv.gain.events[3][0]).toBe('exp');
    const longOscs = longNodes.filter((n) => n.nodeKind === 'oscillator');
    expect(longOscs.length).toBe(2); // note osc + LFO
    const lfo = longOscs[1];
    // Delayed vibrato: lfo starts at time + 0.15
    expect(lfo.started[0]).toBeCloseTo(1 + 0.15);

    // lengthSlots 1 → pluck (3 events), no LFO
    before = ctx.nodes.length;
    const shortMelody = new Array(16).fill(null);
    shortMelody[0] = { degree: 0, octave: 0, velocity: 0.6, lengthSlots: 1 };
    conductor.emit(makeTick({
      pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 },
      secondsPerSixteenth: 0.1,
      melody: shortMelody
    }));
    const shortNodes = ctx.nodes.slice(before);
    const shortEnv = shortNodes.find((n) => n.nodeKind === 'gain' && n.gain.events.length === 3);
    expect(shortEnv).toBeTruthy();
    const shortOscs = shortNodes.filter((n) => n.nodeKind === 'oscillator');
    expect(shortOscs.length).toBe(1); // only the note osc, no LFO
    lead.stop();
  });

  test('duty switches by intensity: intensity<0.55 → pulse50, ≥0.55 → pulse25, combat → pulse125', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const lead = createLead(ctx, ctx.destination, conductor, null);
    lead.start();

    const melody = new Array(16).fill(null);
    melody[0] = { degree: 0, octave: 0, velocity: 0.6, lengthSlots: 2 };

    // Calm: intensity 0.3 → pulse50
    const wave50 = dutyWave(ctx, 0.5);
    let before = ctx.nodes.length;
    conductor.emit(makeTick({ intensity: 0.3, combat: false, melody, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    expect(ctx.nodes.slice(before).find((n) => n.periodicWaves?.includes?.(wave50))).toBeTruthy();

    // Busy: intensity 0.8 → pulse25
    const wave25 = dutyWave(ctx, 0.25);
    before = ctx.nodes.length;
    conductor.emit(makeTick({ intensity: 0.8, combat: false, melody, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    expect(ctx.nodes.slice(before).find((n) => n.periodicWaves?.includes?.(wave25))).toBeTruthy();

    // Combat: pulse125 regardless of intensity
    const wave125 = dutyWave(ctx, 0.125);
    before = ctx.nodes.length;
    conductor.emit(makeTick({ intensity: 0.3, combat: true, melody, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    expect(ctx.nodes.slice(before).find((n) => n.periodicWaves?.includes?.(wave125))).toBeTruthy();
    lead.stop();
  });

  test('bus gain is 0.22 * volume and echo double is emitted at velocity * 0.4', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const echoInput = ctx.createGain();
    const lead = createLead(ctx, ctx.destination, conductor, echoInput);
    lead.setVolume(1);
    lead.start();

    const bus = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.connections.includes(ctx.destination) && Math.abs(n.gain.value - 0.22) < 1e-9);
    expect(bus).toBeTruthy();

    const melody = new Array(16).fill(null);
    melody[0] = { degree: 0, octave: 0, velocity: 0.6, lengthSlots: 2 };
    const before = ctx.nodes.length;
    conductor.emit(makeTick({ intensity: 0.3, combat: false, melody, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    const newEnvs = ctx.nodes.slice(before)
      .filter((n) => n.nodeKind === 'gain' && n.gain.events.some((e) => e[0] === 'linear'));
    // Two envelopes: one to bus (velocity 0.6), one to echo (velocity 0.6 * 0.4 = 0.24).
    const peaks = newEnvs.map((env) => env.gain.events.find((e) => e[0] === 'linear')[1]).sort((a, b) => a - b);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(peaks[0]).toBeCloseTo(0.6 * 0.4);
    expect(peaks[peaks.length - 1]).toBeCloseTo(0.6);
    lead.stop();
  });
});

describe('sparkle layer', () => {
  test('schedules notes when sparkle=0.25 with no container state pushed', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const sparkle = createSparkle(ctx, ctx.destination, conductor, null);
    sparkle.start();
    // No updateState → nearestDist stays MAX_DIST, pressure = 0. Sparkle=0.25 → stride 4 → step 0 fires.
    const before = ctx.nodes.length;
    conductor.emit(makeTick({
      sparkle: 0.25,
      pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 },
      chord: { degree: 0, semis: [0, 3, 7] },
      rootFreq: 110
    }));
    const wave25 = dutyWave(ctx, 0.25);
    const arpOsc = ctx.nodes.slice(before).find((n) => n.nodeKind === 'oscillator' && n.periodicWaves?.includes?.(wave25));
    expect(arpOsc).toBeTruthy();
    sparkle.stop();
  });

  test('stride is 4 for sparkle<0.4 and 2 for sparkle>=0.4', () => {
    // sparkle 0.3 → stride 4: steps 0,4,8,12 fire; step 2 skipped
    const ctxA = new FakeContext();
    const condA = makeStubConductor();
    const sparkleA = createSparkle(ctxA, ctxA.destination, condA, null);
    sparkleA.start();
    const beforeA = ctxA.nodes.length;
    condA.emit(makeTick({ sparkle: 0.3, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    const afterStep0 = ctxA.nodes.length;
    condA.emit(makeTick({ sparkle: 0.3, pos: { step: 2, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    expect(ctxA.nodes.length).toBe(afterStep0); // step 2 skipped
    expect(afterStep0).toBeGreaterThan(beforeA);
    sparkleA.stop();

    // sparkle 0.5 → stride 2: step 2 fires
    const ctxB = new FakeContext();
    const condB = makeStubConductor();
    const sparkleB = createSparkle(ctxB, ctxB.destination, condB, null);
    sparkleB.start();
    condB.emit(makeTick({ sparkle: 0.5, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    const afterStep0B = ctxB.nodes.length;
    condB.emit(makeTick({ sparkle: 0.5, pos: { step: 2, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    expect(ctxB.nodes.length).toBeGreaterThan(afterStep0B);
    sparkleB.stop();
  });

  test('echo send fires only when sparkle > 0.5', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const echoInput = ctx.createGain();
    const sparkle = createSparkle(ctx, ctx.destination, conductor, echoInput);
    sparkle.start();

    // sparkle 0.5 (exactly threshold, not >) → no echo
    let before = ctx.nodes.length;
    conductor.emit(makeTick({ sparkle: 0.5, pos: { step: 0, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    const belowEnvs = ctx.nodes.slice(before)
      .filter((n) => n.nodeKind === 'gain' && n.connections.includes(echoInput));
    expect(belowEnvs.length).toBe(0);

    // sparkle 0.9 → echo emitted (env connects to echoInput)
    before = ctx.nodes.length;
    conductor.emit(makeTick({ sparkle: 0.9, pos: { step: 2, beat: 0, bar: 0, barInPhrase: 0, phraseIndex: 0 } }));
    const aboveEnvs = ctx.nodes.slice(before)
      .filter((n) => n.nodeKind === 'gain' && n.connections.includes(echoInput));
    expect(aboveEnvs.length).toBeGreaterThanOrEqual(1);
    sparkle.stop();
  });

  test('arp resets and rebuilds on step 0 when the chord degree changes across bars', () => {
    const ctx = new FakeContext();
    const conductor = makeStubConductor();
    const sparkle = createSparkle(ctx, ctx.destination, conductor, null);
    sparkle.start();

    // Bar 0, chord [0,4,7], sparkle 0.9 → stride 2 → 4 notes fire across steps 0,2,4,6.
    for (let step = 0; step < 8; step += 2) {
      conductor.emit(makeTick({
        sparkle: 0.9,
        pos: { step, beat: Math.floor(step / 4), bar: 0, barInPhrase: 0, phraseIndex: 0 },
        chord: { degree: 0, semis: [0, 4, 7] },
        rootFreq: 100
      }));
    }

    // Advance to bar 1 step 0 with a different chord → arp rebuilds. Regardless of direction,
    // every direction path yields arp[0] === semis[0] of the new chord.
    const priorLen = ctx.nodes.length;
    conductor.emit(makeTick({
      sparkle: 0.9,
      pos: { step: 0, beat: 0, bar: 1, barInPhrase: 1, phraseIndex: 0 },
      chord: { degree: 2, semis: [5, 9, 12] },
      rootFreq: 100
    }));
    const newOscs = ctx.nodes.slice(priorLen).filter((n) => n.nodeKind === 'oscillator');
    expect(newOscs.length).toBe(1);
    // arp[0] on the new chord = semis[0] = 5. freq = rootFreq*4*2^(5/12).
    const expected = 100 * 4 * Math.pow(2, 5 / 12);
    expect(newOscs[0].frequency.events[0][1]).toBeCloseTo(expected);
    sparkle.stop();
  });
});

describe('noise-bed layer', () => {
  test('base gain <= 0.008 with a frequency-drift LFO connected to the bandpass', () => {
    const ctx = new FakeContext();
    const noise = createNoiseBed(ctx, ctx.destination);
    noise.start();

    const baseGain = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.connections.includes(ctx.destination));
    expect(baseGain).toBeTruthy();
    expect(baseGain.gain.value).toBeLessThanOrEqual(0.008); // 0.75 * 0.007 = 0.00525

    const filter = ctx.nodes.find((n) => n.nodeKind === 'filter');
    expect(filter).toBeTruthy();
    expect(filter.type).toBe('bandpass');
    expect(filter.frequency.value).toBeCloseTo(1900);

    const driftGain = ctx.nodes.find((n) => n.nodeKind === 'gain' && n.gain.value === 700);
    expect(driftGain).toBeTruthy();
    expect(driftGain.connections).toContain(filter.frequency);

    const driftLFO = ctx.nodes.find((n) => n.nodeKind === 'oscillator'
      && n.type === 'sine'
      && Math.abs(n.frequency.value - 0.05) < 1e-9);
    expect(driftLFO).toBeTruthy();
    expect(driftLFO.connections).toContain(driftGain);
    expect(driftLFO.started.length).toBe(1);
    noise.destroy();
  });
});
