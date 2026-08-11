import { describe, expect, it } from 'vitest';
import { listMockFiles, extractMock, extractAllMocks } from '../../scripts/design-scan/extract-mocks.js';

describe('extract-mocks', () => {
  it('lists 14 mock screens, excluding the prototype hub', () => {
    const files = listMockFiles();
    expect(files).toHaveLength(14);
    expect(files).not.toContain('index.html');
    expect(files).toContain('combat.html');
  });

  it('extracts combat.html root tokens, classes, and mode tabs', () => {
    const mock = extractMock('combat.html');
    expect(mock.rootTokens['--accent']).toBe('#7ec8e3');
    expect(mock.rootTokens['--bg-base']).toBe('#0a0612');
    expect(mock.classes.has('mode-tab')).toBe(true);
    expect(mock.classes.has('combat-grid')).toBe(true);
    expect(mock.modeTabLabels).toEqual(['MOVE', 'CMBT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG']);
  });

  it('extracts console-gear.html with no disabled tabs', () => {
    const mock = extractMock('console-gear.html');
    expect(mock.modeTabLabels).toEqual(['MOVE', 'CMBT', 'PARTY', 'GEAR', 'TECH', 'LOOT', 'LOG']);
    expect(mock.minHeightValues).toContain(48);
  });

  it('extracts all 14 mocks without throwing', () => {
    const mocks = extractAllMocks();
    expect(mocks).toHaveLength(14);
    for (const mock of mocks) expect(mock.file).toMatch(/\.html$/);
  });
});