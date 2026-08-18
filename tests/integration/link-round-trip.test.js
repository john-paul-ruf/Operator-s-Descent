import { describe, expect, it } from 'vitest';
import { encodeRun, encodeSeed, base64urlEncode } from '../../src/state/save-encode.js';
import { decodeRun, decodeSeed, base64urlDecode } from '../../src/state/save-decode.js';
import { parseFragment } from '../../src/router.js';
import {
  createGameHarness,
  roundTripRunState,
  startStandardCombat
} from '../helpers/game-fixture.js';

const SEED_CASES = [0, 1, 42, 5150, 2 ** 31, 2 ** 32 - 1];

describe('link round trip — seed (#w=)', () => {
  it.each(SEED_CASES)('encodeSeed → parseFragment → decodeSeed for seed %s', (rawSeed) => {
    const seed = rawSeed >>> 0;
    const encoded = encodeSeed(seed);

    expect(typeof encoded).toBe('string');
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);

    const parsed = parseFragment('#w=' + encoded);
    expect(parsed).toEqual({ kind: 'seed', seed: encoded });

    const decoded = decodeSeed(encoded);
    expect(decoded).toEqual({ success: true, seed });
  });

  it('parseFragment recognises the seed regardless of hash / bare / URL shape', () => {
    const seed = 60013 >>> 0;
    const encoded = encodeSeed(seed);
    const bareBody = 'w=' + encoded;
    const hashed = '#' + bareBody;
    const url = new URL(`https://host.example/path/${hashed}`);

    // All three shapes reduce to the same fragment body once the leading
    // '#' (if any) is stripped — the exact reduction the import screen does
    // before handing the body to parseFragment / decodeSeed.
    expect(parseFragment(hashed)).toEqual({ kind: 'seed', seed: encoded });
    expect(parseFragment(bareBody)).toEqual({ kind: 'seed', seed: encoded });
    expect(parseFragment(url.hash)).toEqual({ kind: 'seed', seed: encoded });
  });

  it('rejects an invalid seed encoding without silently producing a wrong seed', () => {
    expect(parseFragment('#w=')).toEqual({ kind: 'invalid' });
    expect(parseFragment('#w=$$$')).toEqual({ kind: 'invalid' });
    expect(decodeSeed('')).toEqual({ success: false, error: 'truncated' });
    expect(decodeSeed('AA')).toEqual({ success: false, error: 'truncated' });
  });
});

describe('link round trip — full run (#r=)', () => {
  it('encodes / decodes a fresh exploration run and reconstructs load-bearing fields', () => {
    const harness = createGameHarness({ seed: 777331, partySize: 2 });
    const { encoded, decoded } = roundTripRunState(harness.runState);

    expect(encoded.success).toBe(true);
    expect(encoded.fragment.length).toBeLessThan(1500);

    const parsed = parseFragment('#r=' + encoded.fragment);
    expect(parsed).toEqual({ kind: 'run', fragment: encoded.fragment });

    const direct = decodeRun(encoded.fragment);
    expect(direct.success).toBe(true);
    expect(direct.runState.worldSeed).toBe(harness.runState.worldSeed);
    expect(direct.runState.depth).toBe(harness.runState.depth);
    expect(direct.runState.party.length).toBe(harness.runState.party.length);
    expect(direct.runState.activeCombat).toBeNull();

    expect(decoded.worldSeed).toBe(harness.runState.worldSeed);
    expect(decoded.depth).toBe(harness.runState.depth);
    expect(decoded.party.length).toBe(harness.runState.party.length);
  });

  it('preserves an active combat snapshot through the #r= round trip', () => {
    const harness = createGameHarness({ seed: 60013, partySize: 2, depth: 3 });
    startStandardCombat(harness, { enemyHP: 6 });
    expect(harness.runState.activeCombat).toBeTruthy();

    const { encoded, decoded } = roundTripRunState(harness.runState);
    expect(encoded.success).toBe(true);

    const parsed = parseFragment('#r=' + encoded.fragment);
    expect(parsed.kind).toBe('run');
    expect(parsed.fragment).toBe(encoded.fragment);

    const direct = decodeRun(encoded.fragment);
    expect(direct.success).toBe(true);
    expect(direct.runState.activeCombat).toBeTruthy();
    expect(direct.runState.worldSeed).toBe(harness.runState.worldSeed);
    expect(direct.runState.depth).toBe(harness.runState.depth);
    expect(direct.runState.party.length).toBe(harness.runState.party.length);
    expect(decoded.activeCombat).toBeTruthy();
  });
});

describe('link round trip — corruption is rejected, not mis-loaded', () => {
  const harness = createGameHarness({ seed: 424242, partySize: 1 });
  const baseline = roundTripRunState(harness.runState).encoded.fragment;
  const rawBytes = base64urlDecode(baseline);

  it('flipping the version byte returns version_mismatch (never a wrong-but-successful run)', () => {
    const bytes = rawBytes.slice();
    bytes[2] += 1;
    const result = decodeRun(base64urlEncode(bytes));
    expect(result.success).toBe(false);
    expect(result.error).toBe('version_mismatch');
  });

  it('flipping a checksum byte returns checksum_failed', () => {
    const bytes = rawBytes.slice();
    bytes[bytes.length - 5] ^= 0xff;
    const result = decodeRun(base64urlEncode(bytes));
    expect(result.success).toBe(false);
    expect(result.error).toBe('checksum_failed');
  });

  it('a truncated fragment returns truncated (still an explicit failure)', () => {
    const result = decodeRun(base64urlEncode(rawBytes.slice(0, 18)));
    expect(result.success).toBe(false);
    expect(result.error).toBe('truncated');
  });

  it('a completely bogus fragment returns malformed', () => {
    const result = decodeRun('not-a-save');
    expect(result.success).toBe(false);
    expect(result.error).toBe('malformed');
  });

  it('sanity: the untouched baseline still decodes cleanly', () => {
    const result = decodeRun(baseline);
    expect(result.success).toBe(true);
    expect(result.runState.worldSeed).toBe(harness.runState.worldSeed);
  });
});

describe('link round trip — encoder guarantees', () => {
  it('encodeRun.fragment matches encodeRun/parseFragment/decodeRun composed end-to-end', () => {
    const harness = createGameHarness({ seed: 90210, partySize: 1 });
    const encoded = encodeRun(harness.runState);
    expect(encoded.success).toBe(true);
    expect(encoded.fragment.length).toBe(encoded.length);

    const parsed = parseFragment('#r=' + encoded.fragment);
    expect(parsed).toEqual({ kind: 'run', fragment: encoded.fragment });

    const decoded = decodeRun(parsed.fragment);
    expect(decoded.success).toBe(true);
    expect(decoded.runState.worldSeed).toBe(harness.runState.worldSeed);
  });
});
