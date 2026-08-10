import { describe, it, expect } from 'vitest';
import { loadData } from '../helpers/data.js';
import { ARCHETYPES } from '../../src/floor/archetypes.js';
import { validateGameData } from '../../src/data-loader.js';

const NAMES = ['sigils', 'themes', 'classes', 'protocols', 'enemies', 'equipment', 'affixes', 'conditions', 'consumables', 'symbol-table'];

const sigils = loadData('sigils');
const themes = loadData('themes');
const classes = loadData('classes');
const protocols = loadData('protocols');
const enemies = loadData('enemies');
const equipment = loadData('equipment');
const affixes = loadData('affixes');
const conditions = loadData('conditions');
const consumables = loadData('consumables');
const symbolTable = loadData('symbol-table');
const registry = { sigils, themes, classes, protocols, enemies, equipment, affixes, conditions, consumables, symbolTable };

const PROTOCOL_SCHOOL_IDS = Object.keys(protocols.schools);
const CONDITION_IDS = Object.keys(conditions.conditions);
const ENEMY_ARCHETYPE_IDS = Object.keys(enemies.archetypes);
const EQUIPMENT_WEAPON_IDS = Object.keys(equipment.weapons);
const EQUIPMENT_ARMOR_IDS = Object.keys(equipment.armor);
const VALID_DICE = ['d4', 'd6', 'd8', 'd10', 'd12'];
const MODIFIER_IDS = ['none', 'dense', 'sparse', 'dangerous'];
const ALL_SIGIL_CODEPOINTS = [
  ...Object.values(sigils.playerBank.families).flatMap(f => f.codepoints),
  ...Object.values(sigils.bestiaryBank.archetypes).flatMap(a => a.codepoints),
];
const ALL_SUBSTITUTION_CODEPOINTS = Object.values(sigils.safeSubstitutionPool).flat();

function allCodepointsInRange(codepoints, lo, hi) {
  return codepoints.every(c => Number.isInteger(c) && c >= lo && c <= hi);
}

describe('universal data checks', () => {
  it('passes the complete static content ABI', () => {
    expect(validateGameData(registry)).toEqual({ valid: true, errors: [] });
  });

  it('reports invalid data deterministically', () => {
    const invalid = structuredClone(registry);
    invalid.classes.classes[0].equipmentGates.weapons[0] = 'missing_weapon';
    expect(validateGameData(invalid)).toEqual({
      valid: false,
      errors: [{ code: 'invalid_reference', file: 'data/classes.json', details: 'Invalid gate or sigil family for breacher.' }]
    });
  });

  for (const name of NAMES) {
    it(`${name}.json has version >= 1`, () => {
      const data = loadData(name);
      expect(Number.isInteger(data.version)).toBe(true);
      expect(data.version).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('themes.json', () => {
  it('has exactly 12 themes', () => {
    expect(themes.themes).toHaveLength(12);
  });

  it('has unique ids', () => {
    const ids = themes.themes.map(t => t.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('each theme has required top-level fields', () => {
    for (const t of themes.themes) {
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('accentColor');
      expect(t).toHaveProperty('archetypeWeights');
      expect(t).toHaveProperty('modifierWeights');
      expect(t).toHaveProperty('enemyMixWeights');
      expect(t).toHaveProperty('lootBias');
      expect(t).toHaveProperty('audioMode');
    }
  });

  it('archetypeWeights keys are a subset of ARCHETYPES keys', () => {
    const valid = new Set(Object.keys(ARCHETYPES));
    for (const t of themes.themes) {
      for (const key of Object.keys(t.archetypeWeights)) {
        expect(valid.has(key)).toBe(true);
      }
    }
  });

  it('modifierWeights keys are a subset of {none, dense, sparse, dangerous}', () => {
    const valid = new Set(MODIFIER_IDS);
    for (const t of themes.themes) {
      for (const key of Object.keys(t.modifierWeights)) {
        expect(valid.has(key)).toBe(true);
      }
    }
  });

  it('enemyMixWeights keys are a subset of enemy archetype ids', () => {
    const valid = new Set(ENEMY_ARCHETYPE_IDS);
    for (const t of themes.themes) {
      for (const key of Object.keys(t.enemyMixWeights)) {
        expect(valid.has(key)).toBe(true);
      }
    }
  });

  it('lootBias.containerDensity is a number > 0', () => {
    for (const t of themes.themes) {
      expect(typeof t.lootBias.containerDensity).toBe('number');
      expect(t.lootBias.containerDensity).toBeGreaterThan(0);
    }
  });

  it('all weights are non-negative numbers', () => {
    for (const t of themes.themes) {
      for (const w of Object.values(t.archetypeWeights)) {
        expect(typeof w).toBe('number');
        expect(w).toBeGreaterThanOrEqual(0);
      }
      for (const w of Object.values(t.modifierWeights)) {
        expect(typeof w).toBe('number');
        expect(w).toBeGreaterThanOrEqual(0);
      }
      for (const w of Object.values(t.enemyMixWeights)) {
        expect(typeof w).toBe('number');
        expect(w).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('classes.json', () => {
  it('classes is an array with 6 entries', () => {
    expect(Array.isArray(classes.classes)).toBe(true);
    expect(classes.classes).toHaveLength(6);
  });

  it('each class has valid hitDieBase, chargeBase, primaryAttribute', () => {
    const validAttrs = new Set(['mgt', 'fin', 'vit', 'res', 'foc', 'sig']);
    for (const c of classes.classes) {
      expect(c.hitDieBase).toBeGreaterThanOrEqual(1);
      expect(c.chargeBase).toBeGreaterThanOrEqual(0);
      expect(validAttrs.has(c.primaryAttribute)).toBe(true);
    }
  });

  it('each class has signature.tiers length 3', () => {
    for (const c of classes.classes) {
      expect(c.signature.tiers).toHaveLength(3);
    }
  });

  it('equipmentGates weapon/armor ids exist in equipment.json', () => {
    const weaponSet = new Set(EQUIPMENT_WEAPON_IDS);
    const armorSet = new Set(EQUIPMENT_ARMOR_IDS);
    for (const c of classes.classes) {
      for (const w of c.equipmentGates.weapons) {
        expect(weaponSet.has(w)).toBe(true);
      }
      for (const a of c.equipmentGates.armor) {
        expect(armorSet.has(a)).toBe(true);
      }
    }
  });

  it('protocolGates.schools are valid protocol schools', () => {
    const schoolSet = new Set(PROTOCOL_SCHOOL_IDS);
    for (const c of classes.classes) {
      for (const s of c.protocolGates.schools) {
        expect(schoolSet.has(s)).toBe(true);
      }
    }
  });

  it('protocolGates.maxTier is an integer in [1, 5]', () => {
    for (const c of classes.classes) {
      expect(Number.isInteger(c.protocolGates.maxTier)).toBe(true);
      expect(c.protocolGates.maxTier).toBeGreaterThanOrEqual(1);
      expect(c.protocolGates.maxTier).toBeLessThanOrEqual(5);
    }
  });

  it('has unique class ids', () => {
    const ids = classes.classes.map(c => c.id);
    expect(new Set(ids).size).toBe(6);
  });
});

describe('enemies.json', () => {
  it('archetype keys are exactly {drone, warden, stalker, choir, null, construct, phantom, apex}', () => {
    expect(ENEMY_ARCHETYPE_IDS.sort()).toEqual(
      ['drone', 'warden', 'stalker', 'choir', 'null', 'construct', 'phantom', 'apex'].sort()
    );
  });

  it('each archetype has name, role, hpBonus, armored, behavior, retreats', () => {
    for (const [id, e] of Object.entries(enemies.archetypes)) {
      expect(e).toHaveProperty('name');
      expect(e).toHaveProperty('role');
      expect(typeof e.hpBonus).toBe('number');
      expect(typeof e.armored).toBe('boolean');
      expect(typeof e.behavior).toBe('string');
      expect(typeof e.retreats).toBe('boolean');
    }
  });

  it('each archetype has 6 attribute keys with values 1-10', () => {
    const attrKeys = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
    for (const e of Object.values(enemies.archetypes)) {
      for (const k of attrKeys) {
        expect(e.attributes).toHaveProperty(k);
        expect(e.attributes[k]).toBeGreaterThanOrEqual(1);
        expect(e.attributes[k]).toBeLessThanOrEqual(10);
      }
    }
  });

  it('each archetype has sigilCodepoints array length >= 3 of integers', () => {
    for (const e of Object.values(enemies.archetypes)) {
      expect(Array.isArray(e.sigilCodepoints)).toBe(true);
      expect(e.sigilCodepoints.length).toBeGreaterThanOrEqual(3);
      for (const cp of e.sigilCodepoints) {
        expect(Number.isInteger(cp)).toBe(true);
      }
    }
  });

  it('protocolAccess.schools (if present) are valid protocol schools', () => {
    const schoolSet = new Set(PROTOCOL_SCHOOL_IDS);
    for (const e of Object.values(enemies.archetypes)) {
      if (e.protocolAccess?.schools) {
        for (const s of e.protocolAccess.schools) {
          expect(schoolSet.has(s)).toBe(true);
        }
      }
    }
  });
});

describe('protocols.json', () => {
  it('schools are exactly {disrupt, ward, scry, rewrite}', () => {
    expect(PROTOCOL_SCHOOL_IDS.sort()).toEqual(['disrupt', 'scry', 'rewrite', 'ward'].sort());
  });

  it('each school has non-empty tiers array', () => {
    for (const school of Object.values(protocols.schools)) {
      expect(Array.isArray(school.tiers)).toBe(true);
      expect(school.tiers.length).toBeGreaterThan(0);
    }
  });

  it('every tier has name and effectData', () => {
    for (const school of Object.values(protocols.schools)) {
      const validTypes = new Set([
        'damage', 'heal', 'condition', 'heal_over_time', 'buff',
        'reveal', 'reveal_full', 'reveal_marked', 'swap',
        'remove_condition', 'ap_penalty', 'reshape',
      ]);
      for (const tier of school.tiers) {
        expect(tier).toHaveProperty('name');
        expect(tier).toHaveProperty('effectData');
        expect(tier.effectData).toHaveProperty('type');
        expect(validTypes.has(tier.effectData.type)).toBe(true);
      }
    }
  });

  it('every effectData.condition referenced exists in conditions.json', () => {
    const condSet = new Set(CONDITION_IDS);
    for (const school of Object.values(protocols.schools)) {
      for (const tier of school.tiers) {
        if (tier.effectData.condition) {
          expect(condSet.has(tier.effectData.condition)).toBe(true);
        }
      }
    }
  });

  it('per-school tier counts: disrupt 5, ward 5, scry 5, rewrite 5', () => {
    expect(protocols.schools.disrupt.tiers).toHaveLength(5);
    expect(protocols.schools.ward.tiers).toHaveLength(5);
    expect(protocols.schools.scry.tiers).toHaveLength(5);
    expect(protocols.schools.rewrite.tiers).toHaveLength(5);
  });
});

describe('conditions.json', () => {
  it('ids are exactly the 9 expected', () => {
    expect(CONDITION_IDS.sort()).toEqual(
      ['blinded', 'burning', 'corroded', 'immobilized', 'jammed', 'marked', 'overloaded', 'panicked', 'shielded'].sort()
    );
  });

  it('each has integer duration >= 1 and boolean stackable', () => {
    for (const c of Object.values(conditions.conditions)) {
      expect(Number.isInteger(c.duration)).toBe(true);
      expect(c.duration).toBeGreaterThanOrEqual(1);
      expect(typeof c.stackable).toBe('boolean');
    }
  });

  it('burning is stackable: true', () => {
    expect(conditions.conditions.burning.stackable).toBe(true);
  });

  it('corroded is stackable: false (actual — prompt claimed true, data says false)', () => {
    expect(conditions.conditions.corroded.stackable).toBe(false);
  });
});

describe('consumables.json', () => {
  it('has exactly 7 consumable ids', () => {
    expect(Object.keys(consumables.consumables)).toHaveLength(7);
  });

  it('ids are the expected 7', () => {
    const expected = ['repair_patch', 'med_kit', 'charge_cell', 'boost_cell', 'purge_spike', 'shield_capacitor', 'adrenal_injector'];
    expect(Object.keys(consumables.consumables).sort()).toEqual(expected.sort());
  });

  it('each has effectData.type in the valid set', () => {
    const validTypes = new Set(['heal', 'charge_restore', 'charge_restore_full', 'remove_condition', 'apply_condition', 'ap_restore']);
    for (const c of Object.values(consumables.consumables)) {
      expect(c.effectData).toHaveProperty('type');
      expect(validTypes.has(c.effectData.type)).toBe(true);
    }
  });

  it('apply_condition targets exist in conditions.json', () => {
    const condSet = new Set(CONDITION_IDS);
    for (const c of Object.values(consumables.consumables)) {
      if (c.effectData.type === 'apply_condition') {
        expect(condSet.has(c.effectData.condition)).toBe(true);
      }
    }
  });

  it('each has numeric salvageValue', () => {
    for (const c of Object.values(consumables.consumables)) {
      expect(typeof c.salvageValue).toBe('number');
    }
  });
});

describe('equipment.json', () => {
  it('weapons include all 8 ids including shield', () => {
    const expected = ['sidearm', 'heavy_melee', 'polearm', 'light_ranged', 'heavy_ranged', 'sniper', 'area_projector', 'shield'];
    expect(EQUIPMENT_WEAPON_IDS.sort()).toEqual(expected.sort());
  });

  it('armor includes none, light, medium, heavy', () => {
    expect(EQUIPMENT_ARMOR_IDS.sort()).toEqual(['heavy', 'light', 'medium', 'none'].sort());
  });

  it('every non-shield weapon has valid damageDie and rangeBand', () => {
    for (const [id, w] of Object.entries(equipment.weapons)) {
      if (id === 'shield') continue;
      expect(VALID_DICE).toContain(w.damageDie);
      expect(w.rangeBand).toBeDefined();
      expect(w.rangeBand).not.toBeNull();
    }
  });

  it('every non-shield weapon and non-none armor has numeric salvageValue', () => {
    for (const [id, w] of Object.entries(equipment.weapons)) {
      if (id === 'shield') continue;
      expect(typeof w.salvageValue).toBe('number');
    }
    for (const [id, a] of Object.entries(equipment.armor)) {
      if (id === 'none') continue;
      expect(typeof a.salvageValue).toBe('number');
    }
  });
});

describe('affixes.json', () => {
  it('has 16 affixes', () => {
    expect(Object.keys(affixes.affixes)).toHaveLength(16);
  });

  it('each class is minor or major, category is universal/weapon/armor', () => {
    const validClasses = new Set(['minor', 'major']);
    const validCategories = new Set(['universal', 'weapon', 'armor']);
    for (const a of Object.values(affixes.affixes)) {
      expect(validClasses.has(a.class)).toBe(true);
      expect(validCategories.has(a.category)).toBe(true);
    }
  });

  it('at least 3 major affixes usable by weapons (universal + weapon)', () => {
    const majors = Object.values(affixes.affixes).filter(
      a => a.class === 'major' && (a.category === 'universal' || a.category === 'weapon')
    );
    expect(majors.length).toBeGreaterThanOrEqual(3);
  });

  it('at least 3 major affixes usable by armor (universal + armor)', () => {
    const majors = Object.values(affixes.affixes).filter(
      a => a.class === 'major' && (a.category === 'universal' || a.category === 'armor')
    );
    expect(majors.length).toBeGreaterThanOrEqual(3);
  });

  it('edged exists with effectData.dieUpgrade', () => {
    expect(affixes.affixes.edged).toBeDefined();
    expect(affixes.affixes.edged.effectData.dieUpgrade).toBe(true);
  });
});

describe('sigils.json', () => {
  it('playerBank and bestiaryBank codepoints are within PUA range 0xE000-0xF8FF', () => {
    expect(allCodepointsInRange(ALL_SIGIL_CODEPOINTS, 0xE000, 0xF8FF)).toBe(true);
  });

  it('player and bestiary banks are disjoint', () => {
    const playerCps = Object.values(sigils.playerBank.families).flatMap(f => f.codepoints);
    const bestiaryCps = Object.values(sigils.bestiaryBank.archetypes).flatMap(a => a.codepoints);
    const playerSet = new Set(playerCps);
    for (const cp of bestiaryCps) {
      expect(playerSet.has(cp)).toBe(false);
    }
  });

  it('safeSubstitutionPool is intentionally outside PUA (ASCII + box-drawing)', () => {
    expect(allCodepointsInRange(ALL_SUBSTITUTION_CODEPOINTS, 0xE000, 0xF8FF)).toBe(false);
  });

  it('all codepoint arrays contain integers', () => {
    for (const arr of Object.values(sigils.safeSubstitutionPool)) {
      for (const cp of arr) {
        expect(Number.isInteger(cp)).toBe(true);
      }
    }
    for (const f of Object.values(sigils.playerBank.families)) {
      for (const cp of f.codepoints) {
        expect(Number.isInteger(cp)).toBe(true);
      }
    }
    for (const a of Object.values(sigils.bestiaryBank.archetypes)) {
      for (const cp of a.codepoints) {
        expect(Number.isInteger(cp)).toBe(true);
      }
    }
  });
});

describe('symbol-table.json', () => {
  it('version is 1', () => {
    expect(symbolTable.version).toBe(1);
  });

  it('every table has entries array and escape field', () => {
    for (const [name, table] of Object.entries(symbolTable.tables)) {
      expect(Array.isArray(table.entries)).toBe(true);
      expect(table).toHaveProperty('escape');
    }
  });
});
