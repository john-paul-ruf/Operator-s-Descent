import { createPRNG } from '../../src/core/prng.js';

export function makeCharacter(overrides = {}) {
  return {
    id: 'char_a',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 5, foc: 5, sig: 5 },
    hp: 30,
    hpMax: 30,
    charge: 10,
    chargeMax: 10,
    ap: 2,
    conditions: [],
    protocols: [],
    weapon: null,
    position: { x: 0, y: 0 },
    sigilCodepoint: 0xE000,
    ...overrides
  };
}

export function makeClassData(overrides = {}) {
  return {
    hitDieBase: 10,
    chargeBase: 4,
    primaryAttribute: 'mgt',
    signature: { tiers: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] },
    equipmentGates: { weapons: ['sidearm'], armor: ['light'] },
    protocolGates: { schools: ['disrupt'], maxTier: 2 },
    calibrationOptions: {},
    ...overrides
  };
}

export function makeWeapon(overrides = {}) {
  return {
    damageDie: 'd6',
    rangeBand: 'adjacent',
    maxRange: 1,
    minRange: 0,
    accuracyBonus: 0,
    defenseBonus: 0,
    ...overrides
  };
}

export function makeParty(n) {
  const ids = ['char_a', 'char_b', 'char_c', 'char_d', 'char_e', 'char_f'];
  return Array.from({ length: n }, (_, i) =>
    makeCharacter({ id: ids[i] ?? `char_${i}` })
  );
}

export function findSeed(predicate, limit = 10000) {
  for (let seed = 0; seed < limit; seed++) {
    if (predicate(seed)) return seed;
  }
  throw new Error(`findSeed: no matching seed within ${limit} iterations`);
}