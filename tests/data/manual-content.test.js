import { describe, it, expect } from 'vitest';
import { loadData } from '../helpers/data.js';

const manual = loadData('manual');
const conditions = loadData('conditions');

const ids = new Set(manual.sections.map(section => section.id));

function bodyText(section) {
  return section.body
    .map(paragraph => paragraph.map(run => (run[0] === 'link' ? run[2] : run[1])).join(''))
    .join('\n');
}

// (a) Tutorial parity: the 12 tutorial page titles the manual absorbs.
// Ported from src/ui/screens/tutorial.js PAGES (owner decision 2026-08-18: manual absorbs tutorial).
const TUTORIAL_INTERFACE_TITLES = [
  'Console Overview',
  'MOVE Mode',
  'The Map',
  'COMBAT Mode',
  'PARTY Mode',
  'GEAR Mode',
  'TECH Mode',
  'LOOT Mode',
  'LOG Mode',
  'Status Strip',
  'Settings',
  'Seed & Share Links'
];

const CONDITION_ANCHOR_PHRASES = {
  jammed: ['cannot use protocols', 'charge'],
  overloaded: ['+50%', 'damage'],
  shielded: ['+4 defense', 'immunity'],
  blinded: ['1 cell', 'ranged'],
  immobilized: ['move action'],
  corroded: ['2 defense', 'cumulative'],
  marked: ['visible', '+2 to attack'],
  panicked: ['nearest hostile', 'cannot attack'],
  burning: ['d6 damage', '3 turns']
};

describe('manual-content: tutorial parity', () => {
  it('all 12 tutorial page titles are present as interface sections', () => {
    const interfaceTitles = new Set(
      manual.sections.filter(section => section.chapter === 'interface').map(section => section.title)
    );
    for (const title of TUTORIAL_INTERFACE_TITLES) {
      expect(interfaceTitles.has(title)).toBe(true);
    }
  });

  it('the interface chapter has exactly the 12 tutorial-derived sections', () => {
    const interfaceSections = manual.sections.filter(section => section.chapter === 'interface');
    expect(interfaceSections).toHaveLength(TUTORIAL_INTERFACE_TITLES.length);
  });
});

describe('manual-content: link and seeAlso integrity', () => {
  it('every link run target resolves to a section id', () => {
    for (const section of manual.sections) {
      for (const paragraph of section.body) {
        for (const run of paragraph) {
          if (run[0] === 'link') {
            expect(ids.has(run[1])).toBe(true);
          }
        }
      }
    }
  });

  it('every seeAlso entry resolves to a section id', () => {
    for (const section of manual.sections) {
      for (const target of section.seeAlso) {
        expect(ids.has(target)).toBe(true);
      }
    }
  });
});

describe('manual-content: no section body empty', () => {
  it('every section has non-empty body text', () => {
    for (const section of manual.sections) {
      const text = bodyText(section).replace(/\s+/g, '');
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe('manual-content: glossary condition sections mirror data/conditions.json semantics', () => {
  for (const conditionId of Object.keys(conditions.conditions)) {
    it(`glossary section ${conditionId} exists`, () => {
      const section = manual.sections.find(s => s.id === conditionId);
      expect(section).toBeDefined();
      expect(section.chapter).toBe('glossary');
      expect(section.group).toBe('conditions');
    });

    it(`glossary section ${conditionId} mentions the effect semantics`, () => {
      const section = manual.sections.find(s => s.id === conditionId);
      const text = bodyText(section).toLowerCase();
      const anchors = CONDITION_ANCHOR_PHRASES[conditionId];
      expect(anchors).toBeDefined();
      for (const anchor of anchors) {
        expect(text.includes(anchor.toLowerCase())).toBe(true);
      }
    });
  }
});
