import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, it, expect } from 'vitest';
import {
  SAVE_VERSION,
  base64urlEncode,
  crc32,
  encodeRun,
  encodeSeed,
  initEncoder,
} from '../../src/state/save-encode.js';
import { decodeRun, decodeSeed } from '../../src/state/save-decode.js';
import { createRunState } from '../../src/state/run-state.js';
import { makeParty } from '../helpers/fixtures.js';
import { buildMaximumRun, buildRealisticRun } from '../helpers/run-builder.js';
import { loadData } from '../helpers/data.js';

beforeAll(() => {
  initEncoder(loadData('symbol-table'));
});

function makeState() {
  const state = createRunState(42, makeParty(2));
  state.creationTimestamp = 1_000_000;
  return state;
}

describe('save-encode constants', () => {
  it('SAVE_VERSION === 2', () => {
    expect(SAVE_VERSION).toBe(2);
  });
});

describe('base64urlEncode', () => {
  it('empty array → empty string', () => {
    expect(base64urlEncode(new Uint8Array(0))).toBe('');
  });

  it('[0] → "AA"', () => {
    expect(base64urlEncode(new Uint8Array([0]))).toBe('AA');
  });

  it('[255,255,255] → "____"', () => {
    expect(base64urlEncode(new Uint8Array([255, 255, 255]))).toBe('____');
  });

  for (let len = 0; len <= 20; len++) {
    it(`matches Node base64url for length ${len}`, () => {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      expect(base64urlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    });
  }
});

describe('crc32', () => {
  it('empty input → 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('"123456789" → 0xCBF43926 (standard check value)', () => {
    const bytes = new Uint8Array(Array.from('123456789', c => c.charCodeAt(0)));
    expect(crc32(bytes)).toBe(0xCBF43926);
  });

  it('stability: same input → same output', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(crc32(bytes)).toBe(crc32(bytes));
  });

  it('sensitivity: single-bit flip changes result', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    expect(crc32(a)).not.toBe(crc32(b));
  });
});

describe('encodeSeed', () => {
  it('fragment length is 7 (5 bytes → 7 base64url chars)', () => {
    expect(encodeSeed(42).length).toBe(7);
  });

  it('decodeSeed restores seed 0', () => {
    expect(decodeSeed(encodeSeed(0))).toEqual({ success: true, seed: 0 });
  });

  it('decodeSeed restores seed 1', () => {
    expect(decodeSeed(encodeSeed(1))).toEqual({ success: true, seed: 1 });
  });

  it('decodeSeed restores seed 0xDEADBEEF', () => {
    expect(decodeSeed(encodeSeed(0xDEADBEEF))).toEqual({ success: true, seed: 0xDEADBEEF });
  });

  it('decodeSeed restores seed 0xFFFFFFFF', () => {
    expect(decodeSeed(encodeSeed(0xFFFFFFFF))).toEqual({ success: true, seed: 0xFFFFFFFF });
  });
});

describe('encodeRun', () => {
  it('returns {success: true, fragment, length}', () => {
    const result = encodeRun(makeState());
    expect(result.success).toBe(true);
    expect(typeof result.fragment).toBe('string');
    expect(typeof result.length).toBe('number');
  });

  it('length === fragment.length < 1500', () => {
    const result = encodeRun(makeState());
    expect(result.length).toBe(result.fragment.length);
    expect(result.length).toBeLessThan(1500);
  });

  it('charset ⊆ [A-Za-z0-9_-]', () => {
    const result = encodeRun(makeState());
    expect(result.fragment).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('deterministic: same state twice → identical fragment', () => {
    const a = encodeRun(makeState());
    const b = encodeRun(makeState());
    expect(a.fragment).toBe(b.fragment);
  });

  it('reports payload and compression metrics without affecting its deterministic fragment', () => {
    const result = encodeRun(makeState());
    expect(result.metrics.rawBytes).toBeGreaterThanOrEqual(result.metrics.compressedBytes);
    expect(result.metrics.layers).toBeGreaterThanOrEqual(0);
  });

  it('reports eventsKept === events on a state that already fits without trimming', () => {
    const state = buildRealisticRun(42, { depth: 3, recentEvents: 4 });
    const result = encodeRun(state);
    expect(result.length).toBeLessThan(1500);
    expect(result.metrics.eventsKept).toBe(4);
    expect(result.metrics.eventsDropped).toBe(0);
  });
});

describe('encodeRun — trim-to-fit ladder', () => {
  it('fits a 64-event tail and reports how many survived the ladder', () => {
    const state = buildRealisticRun(42, { depth: 3, recentEvents: 64 });
    expect(state.recentEvents).toHaveLength(64);
    const result = encodeRun(state);
    expect(result.success).toBe(true);
    expect(result.length).toBeLessThan(1500);
    expect(result.metrics.eventsKept).toBeGreaterThan(0);
    expect(result.metrics.eventsKept).toBeLessThanOrEqual(64);
    expect(result.metrics.eventsDropped).toBe(64 - result.metrics.eventsKept);
  });

  it('keeps the newest events when the ladder trims oldest first', () => {
    const state = buildRealisticRun(42, { depth: 3, recentEvents: 64 });
    // Rewrite events so we can identify which survived by index in message.
    state.recentEvents = state.recentEvents.map((event, index) => ({ ...event, message: `evt-${String(index).padStart(2, '0')}: ${event.message}` }));
    const result = encodeRun(state);
    const decoded = decodeRun(result.fragment);
    expect(decoded.success).toBe(true);
    const survived = decoded.runState.recentEvents.map((event) => event.message);
    // Survivors must all be the tail — newest are events with the highest indices.
    const firstSurvivorIndex = 64 - result.metrics.eventsKept;
    for (let index = 0; index < survived.length; index++) {
      expect(survived[index]).toBe(`evt-${String(firstSurvivorIndex + index).padStart(2, '0')}: ${state.recentEvents[firstSurvivorIndex + index].message.split(': ').slice(1).join(': ')}`);
    }
  });

  it('does not mutate the caller runState during trimming', () => {
    const state = buildRealisticRun(42, { depth: 3, recentEvents: 64 });
    const snapshot = state.recentEvents.map((event) => ({ ...event }));
    encodeRun(state);
    expect(state.recentEvents).toEqual(snapshot);
  });

  it('rescues a state that only overflows because of the event tail', () => {
    // A realistic depth-3 state with 64 events overflows on a naive encode
    // but survives when the ladder drops the oldest events to fit.
    const state = buildRealisticRun(42, { depth: 3, recentEvents: 64 });
    const naive = state.recentEvents.length; // 64
    const result = encodeRun(state);
    expect(result.success).toBe(true);
    expect(result.metrics.eventsDropped).toBeGreaterThan(0);
    expect(result.metrics.eventsKept + result.metrics.eventsDropped).toBe(naive);
  });

  it('throws save_budget_exceeded when the non-event payload alone busts the budget', () => {
    // buildMaximumRun crams every field at once — 100-item inventory, 4-op
    // party at max attrs/equipment, 2-echo queue, full active combat, etc.
    // The baseline exceeds the budget even with an empty event tail.
    const state = buildMaximumRun(42);
    state.recentEvents = [];
    expect(() => encodeRun(state)).toThrow(/save_budget_exceeded/);
  });
});

// Temporary CP2 assertion — the v7 wire compaction lives in three levers:
//   1. Calibration `optionId` → 1-bit known + 5-bit index (was varUint +
//      raw bytes) — the direct-measurement lever worth ~15.6 chars per
//      choice, so a full 4-op × 16-cal state (max legal) sheds ~1000 chars.
//   2. Combat actor position → 3+4 bits (was 7+7) for the fixed 8×16 window.
//   3. Newly-generated loot ids → ≤9 chars (was ~15).
// v6-maxed captured at CP1 has none of these (no calibrations, no combat,
// its loot ids were pre-shortened by the fixture generator), so it can't
// show the compaction. Build a calibration-heavy state instead and assert
// it fits under SAVE_BUDGET — the shrinkage is proven by "this doesn't
// throw under a state that busted 1500 in v6 direct-measurement" (D8 probe).
// The fuller apex attribution table is the CP4 budget-model responsibility.
describe('v7 wire compaction (SESSION-01 CP2)', () => {
  it('a 4-op × 16-calibration state encodes under SAVE_BUDGET (v6 direct-measurement placed calibration history at +998 chars)', () => {
    const state = buildRealisticRun(42, { depth: 5, inventoryItems: 0, fogCells: 0, echoes: 0, recentEvents: 0 });
    // Grow the party to 4 (buildRealisticRun defaults to 2).
    while (state.party.length < 4) {
      const template = state.party[0];
      state.party.push({
        ...template,
        id: `operator_${state.party.length + 1}`,
        attributes: { ...template.attributes },
        equipment: { weapon: null, armor: null, offhand: null },
        protocolDeck: [],
        conditions: []
      });
    }
    // 16 calibration choices per operator × 4 operators = 64 choices.
    for (let index = 0; index < state.party.length; index++) {
      state.party[index].calibrationCount = 16;
      state.party[index].calibrationChoices = Array.from({ length: 16 }, (_, choice) => ({
        floor: choice + 1,
        // Rotate through the 24-entry CALIBRATION_OPTION_IDS pool so the enum
        // path is fully exercised. All ids fit — no escape path.
        optionId: [
          'anchor_deck', 'anchor_mgt', 'anchor_projector', 'anchor_vit',
          'breacher_deck', 'breacher_mgt', 'breacher_range', 'breacher_vit',
          'compiler_deck', 'compiler_foc', 'compiler_res', 'compiler_shield',
          'ghost_deck', 'ghost_fin', 'ghost_polearm', 'ghost_sig'
        ][(index * 4 + choice) % 16]
      }));
      state.party[index].signatureTier = 3;
    }
    const encoded = encodeRun(state);
    expect(encoded.success).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[CP2 wire] 4-op × 16-cal state: ${encoded.length} chars (SAVE_BUDGET=1500 today, 1900 after CP3)`);
    expect(encoded.length).toBeLessThan(1500);
  });
});
