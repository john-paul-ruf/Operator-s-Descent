import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HIGH_SCORE_CAP, listHighScores, recordHighScore } from '../../src/state/high-scores.js';
import { installMockStorage } from '../helpers/mock-storage.js';
import { makeParty } from '../helpers/fixtures.js';

let mock;
beforeEach(() => { mock = installMockStorage(); });
afterEach(() => { mock.uninstall(); });

function makeRunState(overrides = {}) {
  const party = makeParty(2);
  party[0].classId = 'breacher';
  party[1].classId = 'ghost';
  return {
    worldSeed: 42,
    depth: 5,
    party,
    ...overrides
  };
}

describe('high scores', () => {
  it('rejects a runState missing worldSeed/depth', () => {
    expect(recordHighScore({ depth: 5, party: [] })).toEqual({ success: false, error: 'invalid_run' });
    expect(recordHighScore({ worldSeed: 1, party: [] })).toEqual({ success: false, error: 'invalid_run' });
    expect(recordHighScore(null)).toEqual({ success: false, error: 'invalid_run' });
  });

  it('rejects when there is no storage', () => {
    mock.uninstall();
    expect(recordHighScore(makeRunState())).toEqual({ success: false, error: 'no_storage' });
    mock = installMockStorage();
  });

  it('round-trips a recorded entry through listHighScores with all fields intact', () => {
    const result = recordHighScore(makeRunState(), {
      theme: 'foundry',
      accentSwatch: '#e8632a',
      causeOfDeath: 'Party Wipe'
    });
    expect(result.success).toBe(true);
    expect(result.madeCut).toBe(true);
    const [entry] = listHighScores();
    expect(entry).toMatchObject({
      worldSeed: 42,
      depth: 5,
      theme: 'foundry',
      accentSwatch: '#e8632a',
      partySigils: [0xe000, 0xe000],
      partyClasses: ['breacher', 'ghost'],
      causeOfDeath: 'Party Wipe'
    });
    expect(entry.endedAt).toEqual(expect.any(Number));
    expect(entry.key).toBe(`42_${entry.endedAt}`);
  });

  it('derives partySigils/partyClasses from runState.party', () => {
    const party = makeParty(3);
    party[0].classId = 'breacher';
    party[1].classId = 'ghost';
    party[2].sigilCodepoint = 0xE010;
    party[2].classId = 'warden';
    recordHighScore(makeRunState({ party }), { causeOfDeath: 'Party Wipe' });
    const [entry] = listHighScores();
    expect(entry.partySigils).toEqual([0xe000, 0xe000, 0xe010]);
    expect(entry.partyClasses).toEqual(['breacher', 'ghost', 'warden']);
  });

  it('sorts strictly by depth descending, tiebreak by endedAt descending', () => {
    recordHighScore(makeRunState({ depth: 3 }));
    recordHighScore(makeRunState({ depth: 9 }));
    recordHighScore(makeRunState({ depth: 6 }));
    const depths = listHighScores().map((entry) => entry.depth);
    expect(depths).toEqual([9, 6, 3]);
  });

  it('keeps only HIGH_SCORE_CAP entries when over-filled, evicting the lowest depths', () => {
    for (let i = 0; i < HIGH_SCORE_CAP + 5; i++) {
      recordHighScore(makeRunState({ worldSeed: i + 1, depth: i + 1 }));
    }
    const list = listHighScores();
    expect(list).toHaveLength(HIGH_SCORE_CAP);
    expect(list[0].depth).toBe(HIGH_SCORE_CAP + 5);
    expect(list[list.length - 1].depth).toBe(6);

    const lowResult = recordHighScore(makeRunState({ worldSeed: 999, depth: 1 }));
    expect(lowResult.success).toBe(true);
    expect(lowResult.madeCut).toBe(false);
    expect(listHighScores()).toHaveLength(HIGH_SCORE_CAP);
  });

  it('degrades to [] on malformed JSON or non-array value without throwing', () => {
    localStorage.setItem('od_high_scores', '{not json');
    expect(listHighScores()).toEqual([]);
    localStorage.setItem('od_high_scores', JSON.stringify({ not: 'an array' }));
    expect(listHighScores()).toEqual([]);
  });
});
