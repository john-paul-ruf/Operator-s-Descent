import { beforeEach, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderParty } from '../../src/ui/console/party.js';
import { render as renderGear } from '../../src/ui/console/gear.js';
import { loadData } from '../helpers/data.js';

const data = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes'),
  protocols: loadData('protocols')
};

class FakeClassList {
  constructor(element) { this.element = element; this.values = new Set(); }
  add(...names) { for (const name of names) if (name) this.values.add(name); this.sync(); }
  remove(...names) { for (const name of names) this.values.delete(name); this.sync(); }
  toggle(name, force) { const next = force == null ? !this.values.has(name) : Boolean(force); if (next) this.values.add(name); else this.values.delete(name); this.sync(); return next; }
  contains(name) { return this.values.has(name); }
  sync() { this.element._className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = { properties: {}, setProperty(name, value) { this.properties[name] = value; } };
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.disabled = false;
    this.tabIndex = -1;
    this.hidden = false;
    this.parentNode = null;
    this.innerHTML = '';
  }
  set className(value) { this._className = String(value); this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return this._className; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; return child; }
  replaceChildren(...children) { this.children = []; for (const child of children) this.appendChild(child); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((candidate) => candidate !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener({ type, target: this, preventDefault() { this.prevented = true; }, ...event }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  focus() { this.focused = true; }
}

function installDocument() {
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (value) => { const node = new FakeElement('#text'); node.textContent = value; return node; }
  };
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const child of root.children || []) {
    const found = byTestId(child, testid);
    if (found) return found;
  }
  return null;
}

function textOf(root) {
  return [root.textContent, ...(root.children || []).flatMap((child) => textOf(child))].filter(Boolean).join(' ');
}

function collectAll(root, predicate, matches = []) {
  if (predicate(root)) matches.push(root);
  for (const child of root.children || []) collectAll(child, predicate, matches);
  return matches;
}

function isButton(el) {
  return el?.tagName === 'BUTTON';
}

function hasNestedButtonInButton(root) {
  const buttons = collectAll(root, isButton);
  for (const outer of buttons) {
    const nested = collectAll(outer, (el) => el !== outer && isButton(el));
    if (nested.length) return true;
  }
  return false;
}

function recordingBus() {
  const events = [];
  return {
    events,
    bus: { dispatch: (event, payload) => events.push([event, payload]) }
  };
}

function item(id, baseType = 'sidearm', overrides = {}) {
  const source = overrides.category === 'armor' ? data.equipment.armor[baseType] : data.equipment.weapons[baseType];
  return {
    id,
    category: overrides.category || (source?.defenseBonus != null && source?.damageDie == null ? 'armor' : 'weapon'),
    baseType,
    rarity: 'stock',
    affixes: [],
    corrupt: false,
    stats: {},
    salvageValue: source?.salvageValue ?? 1,
    junkTagged: false,
    ...overrides
  };
}

function consumable(id, count = 1, overrides = {}) {
  return { id, category: 'consumable', baseType: 'repair_patch', count, rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 2, junkTagged: false, ...overrides };
}

function character(overrides = {}) {
  return {
    id: 'breacher',
    classId: 'breacher',
    sigilId: 'pua-e000',
    attributes: { mgt: 6, fin: 6, vit: 6, res: 6, foc: 5, sig: 5 },
    currentHP: 40,
    currentCHARGE: 10,
    calibrationCount: 2,
    calibrationChoices: [{ floor: 3, optionId: 'breacher_mgt' }],
    signatureTier: 2,
    equipment: { weapon: item('equipped-sidearm'), armor: null, offhand: null },
    protocolDeck: [{ school: 'disrupt', tier: 1 }],
    conditions: [{ conditionId: 'shielded', duration: 2 }],
    ...overrides
  };
}

function run(inventory = [], members = [character()]) {
  return createRunState(77, members, { creationTimestamp: 1, inventory, scrapCounter: 3, corruption: 0.05 });
}

function renderGearWith(runState, extraContext = {}) {
  const container = new FakeElement('div');
  const context = { runState, data, refresh: () => renderGear(container, context), ...extraContext };
  renderGear(container, context);
  return { container, context };
}

beforeEach(installDocument);

describe('PARTY mode', () => {
  it('shows roster details, derived stats, conditions, equipment, deck, and combat resources', () => {
    const runState = run();
    const combatState = { turnOrder: ['breacher'], currentTurn: 0, combatants: new Map([['breacher', { id: 'breacher', side: 'party', hp: 35, hpMax: 40, charge: 8, chargeMax: 18, ap: 1, moveAvailable: false, swapAvailable: true, conditions: [{ id: 'burning', duration: 1 }] }]]) };
    const container = new FakeElement('div');

    renderParty(container, { runState, combatState, data });

    expect(textOf(byTestId(container, 'party-heading'))).toBe('◈ PARTY ROSTER');
    expect(byTestId(container, 'party-member-breacher').getAttribute('role')).toBe('button');
    expect(byTestId(container, 'party-member-breacher').getAttribute('aria-selected')).toBe('true');
    expect(textOf(byTestId(container, 'party-detail-heading'))).toContain('BREACHER');
    expect(textOf(byTestId(container, 'party-combat-resources'))).toContain('AP 1');
    expect(textOf(byTestId(container, 'party-combat-resources'))).toContain('MOVE SPENT');
    expect(textOf(byTestId(container, 'party-defense'))).toContain('Defense');
    expect(textOf(byTestId(container, 'party-conditions'))).toContain('burning');
    expect(textOf(byTestId(container, 'party-equipment'))).toContain('sidearm');
    expect(textOf(byTestId(container, 'party-deck'))).toContain('SPARK');
  });

  it('opens the manual for condition tags on the selected member', () => {
    const runState = run();
    const container = new FakeElement('div');
    const { bus, events } = recordingBus();

    renderParty(container, { runState, data, bus });

    const link = byTestId(container, 'manual-link-shielded');
    expect(link).toBeTruthy();
    expect(link.tagName).toBe('BUTTON');
    expect(link.className).toContain('manual-term-link');
    link.click();
    expect(events).toContainEqual(['ui:manual-open', { target: 'shielded', source: 'party-condition' }]);
  });

  it('opens the manual for each attribute label chip on the detail view', () => {
    const runState = run();
    const container = new FakeElement('div');
    const { bus, events } = recordingBus();

    renderParty(container, { runState, data, bus });

    for (const key of ['mgt', 'fin', 'vit', 'res', 'foc', 'sig']) {
      const attrRow = byTestId(container, `party-attr-${key}`);
      expect(attrRow).toBeTruthy();
      const link = byTestId(attrRow, `manual-link-${key}`);
      expect(link).toBeTruthy();
      expect(link.tagName).toBe('BUTTON');
      link.click();
    }
    for (const key of ['mgt', 'fin', 'vit', 'res', 'foc', 'sig']) {
      expect(events).toContainEqual(['ui:manual-open', { target: key, source: 'party-attribute' }]);
    }
  });

  it('opens the manual from the corrupt-load and calibration rows', () => {
    const runState = run();
    const container = new FakeElement('div');
    const { bus, events } = recordingBus();

    renderParty(container, { runState, data, bus });

    byTestId(container, 'manual-link-corruption').click();
    byTestId(container, 'manual-link-calibration').click();
    expect(events).toContainEqual(['ui:manual-open', { target: 'corruption', source: 'party' }]);
    expect(events).toContainEqual(['ui:manual-open', { target: 'calibration', source: 'party' }]);
  });

  it('never nests a button inside another button', () => {
    const runState = run();
    const container = new FakeElement('div');
    const { bus } = recordingBus();

    renderParty(container, { runState, data, bus });

    expect(hasNestedButtonInButton(container)).toBe(false);
  });

  it('applies sigil-lg to the selected member detail sigil in wide layout only', () => {
    const runState = run();
    const container = new FakeElement('div');
    renderParty(container, { runState, data, layout: 'wide' });

    const heading = byTestId(container, 'party-detail-heading');
    // The header sits under the same parent (party-detail scroll area); locate the detail-header row.
    const detailHeader = heading.parentNode.children.find((child) => child.className && child.className.split(/\s+/).includes('detail-header'));
    expect(detailHeader).toBeTruthy();
    const sigil = detailHeader.children[0];
    expect(sigil.classList.contains('sigil-lg')).toBe(true);

    const portraitContainer = new FakeElement('div');
    renderParty(portraitContainer, { runState, data });
    const portraitHeading = byTestId(portraitContainer, 'party-detail-heading');
    const portraitDetail = portraitHeading.parentNode.children.find((child) => child.className && child.className.split(/\s+/).includes('detail-header'));
    expect(portraitDetail.children[0].classList.contains('sigil-lg')).toBe(false);
  });
});

describe('GEAR mode', () => {
  it('uses mock-compatible character, equipped, and inventory groupings', () => {
    const runState = run([item('fresh-sidearm')]);
    const { container } = renderGearWith(runState);

    expect(byTestId(container, 'gear-character-breacher').className).toContain('member-pill');
    expect(byTestId(container, 'gear-character-breacher').className).toContain('active');
    expect(textOf(byTestId(container, 'gear-equipped-heading'))).toContain('EQUIPPED — breacher');
    expect(byTestId(container, 'gear-equipped-weapon').className).toContain('item-card equipped');
    expect(textOf(byTestId(container, 'gear-inventory-heading'))).toBe('◈ INVENTORY');
  });

  it('renders resolved names and descriptions on equipped and inventory cards', () => {
    const tuned = item('fresh-sidearm', 'sidearm', { rarity: 'tuned', affixes: ['precise'] });
    const runState = run([tuned]);
    const { container } = renderGearWith(runState);

    const equippedRow = byTestId(container, 'gear-equipped-weapon');
    expect(textOf(equippedRow)).toContain('Weapon: Sidearm');
    expect(textOf(equippedRow)).not.toContain('breacher-1-weapon-sidearm');
    expect(textOf(equippedRow)).not.toContain('equipped-sidearm');
    expect(textOf(equippedRow)).toContain('d6 dmg');
    expect(textOf(equippedRow)).toContain('scrap 1');

    const inventoryRow = byTestId(container, 'gear-item-fresh-sidearm');
    expect(textOf(inventoryRow)).toContain('Sidearm');
    expect(textOf(inventoryRow)).toContain('Precise: +1 accuracy bonus');
    expect(textOf(inventoryRow)).not.toContain('fresh-sidearm ');
  });

  it('surfaces dice chips (ATK/DMG/RANGE) on equipped and inventory cards, and upgraded dies show ↑', () => {
    const edged = item('edged-sidearm', 'sidearm', { rarity: 'custom', affixes: ['edged'] });
    const runState = run([edged], [character({ equipment: { weapon: item('base-sidearm', 'sidearm'), armor: null, offhand: null } })]);
    const { container } = renderGearWith(runState);

    const equippedRow = byTestId(container, 'gear-equipped-weapon');
    expect(textOf(equippedRow)).toContain('ATK d20+1+MGT');
    expect(textOf(equippedRow)).toContain('DMG d6');
    expect(textOf(equippedRow)).toContain('RANGE 1–1 · ADJACENT');

    const inventoryRow = byTestId(container, 'gear-item-edged-sidearm');
    expect(textOf(inventoryRow)).toContain('DMG d8↑');
    expect(textOf(inventoryRow)).toContain('ATK d20+1+MGT');
  });

  it('renders armor DEF/FIN chips on equipped armor and no chips for consumables', () => {
    const heavyArmor = item('worn-heavy', 'heavy', { category: 'armor' });
    const runState = run([consumable('spare-patches', 2)], [character({ equipment: { weapon: null, armor: heavyArmor, offhand: null } })]);
    const { container } = renderGearWith(runState);

    const armorRow = byTestId(container, 'gear-equipped-armor');
    expect(textOf(armorRow)).toContain('DEF +5');
    expect(textOf(armorRow)).toContain('FIN -2');

    // Consumable inventory rows render the projected-stat comparison line but
    // no describeItemStats chip row inside the equipment card itself.
    const patchRow = byTestId(container, 'gear-item-spare-patches');
    function findCardStats(node) {
      if (node?.className === 'card-stats') return node;
      for (const child of node?.children || []) {
        const hit = findCardStats(child);
        if (hit) return hit;
      }
      return null;
    }
    expect(findCardStats(patchRow)).toBe(null);
  });

  it('equips and unequips through atomic run-state transactions', () => {
    const runState = run([item('fresh-sidearm')], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const { container } = renderGearWith(runState);

    byTestId(container, 'gear-equip-fresh-sidearm').click();
    expect(runState.party[0].equipment.weapon.id).toBe('fresh-sidearm');
    expect(runState.inventory).toHaveLength(0);

    byTestId(container, 'gear-unequip-weapon').click();
    expect(runState.party[0].equipment.weapon).toBe(null);
    expect(runState.inventory.map((entry) => entry.id)).toContain('fresh-sidearm');
  });

  it('disables class-illegal equipment with a specific visible reason', () => {
    const runState = run([item('sniper', 'sniper')]);
    const { container } = renderGearWith(runState);

    const equip = byTestId(container, 'gear-equip-sniper');
    expect(equip.disabled).toBe(true);
    expect(equip.textContent).toBe('EQUIP BLOCKED');
    const ariaReason = equip.getAttribute('aria-description');
    expect(ariaReason).toContain('Breacher');
    expect(ariaReason).toContain('Sniper');
    expect(ariaReason).not.toBe('Class gate blocks this item.');

    const reasonNode = byTestId(container, 'gear-equip-reason-sniper');
    expect(reasonNode).toBeTruthy();
    expect(reasonNode.className).toContain('disabled-reason');
    expect(reasonNode.textContent).toContain('Breacher');
    expect(reasonNode.textContent).toContain('Sniper');
    expect(reasonNode.textContent).toContain('weapon');
    expect(reasonNode.textContent).not.toContain('Class gate blocks this item');
  });

  it('omits the equip-blocked reason node when the item is class-legal', () => {
    const runState = run([item('fresh-sidearm')]);
    const { container } = renderGearWith(runState);

    expect(byTestId(container, 'gear-equip-fresh-sidearm').disabled).toBe(false);
    expect(byTestId(container, 'gear-equip-reason-fresh-sidearm')).toBe(null);
  });

  it('requires CORRUPT consent once and never refunds or double-charges the implant', () => {
    const corrupt = item('corrupt-sidearm', 'sidearm', { rarity: 'corrupt', corrupt: true, corruptionValue: 0.1, affixes: ['lucky'], salvageValue: 5 });
    const runState = run([corrupt], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const { container } = renderGearWith(runState);

    byTestId(container, 'gear-equip-corrupt-sidearm').click();
    expect(runState.party[0].equipment.weapon).toBe(null);
    expect(byTestId(container, 'gear-corrupt-warning')).toBeTruthy();
    byTestId(container, 'gear-confirm-corrupt').click();

    expect(runState.party[0].equipment.weapon.id).toBe('corrupt-sidearm');
    expect(runState.corruption).toBeCloseTo(0.15);
    byTestId(container, 'gear-unequip-weapon').click();
    byTestId(container, 'gear-equip-corrupt-sidearm').click();
    expect(runState.corruption).toBeCloseTo(0.15);
  });

  it('preserves the inventory cap when unequipping and surfaces the reason visibly', () => {
    const runState = run([consumable('patches', 100)]);
    const { container } = renderGearWith(runState);

    expect(byTestId(container, 'gear-unequip-weapon').disabled).toBe(true);
    expect(runState.party[0].equipment.weapon.id).toBe('equipped-sidearm');

    const reasonNode = byTestId(container, 'gear-unequip-reason-weapon');
    expect(reasonNode).toBeTruthy();
    expect(reasonNode.className).toContain('disabled-reason');
    expect(reasonNode.textContent).toBe('Inventory full.');
  });

  it('toggles junk tags, confirms destruction, and adds exact scrap', () => {
    const runState = run([item('junk-sidearm', 'sidearm', { salvageValue: 7 }), item('keeper', 'sidearm', { salvageValue: 3 })], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const { container } = renderGearWith(runState);

    byTestId(container, 'gear-junk-junk-sidearm').click();
    expect(runState.inventory.find((entry) => entry.id === 'junk-sidearm').junkTagged).toBe(true);
    byTestId(container, 'gear-junk-all').click();
    expect(textOf(byTestId(container, 'gear-notice'))).toContain('Confirm permanent junking');
    byTestId(container, 'gear-junk-all').click();

    expect(runState.inventory.map((entry) => entry.id)).toEqual(['keeper']);
    expect(runState.scrapCounter).toBe(10);
  });

  it('enforces the once-per-turn combat swap without spending AP', () => {
    const runState = run([item('fresh-sidearm'), item('backup-sidearm')]);
    const actor = { id: 'breacher', side: 'party', ap: 2, swapAvailable: true, weapon: runState.party[0].equipment.weapon, equipment: { ...runState.party[0].equipment } };
    const combatState = { turnOrder: ['breacher'], currentTurn: 0, combatants: new Map([['breacher', actor]]) };
    const { container } = renderGearWith(runState, { combatState });

    byTestId(container, 'gear-equip-fresh-sidearm').click();

    expect(actor.ap).toBe(2);
    expect(actor.swapAvailable).toBe(false);
    // Smart auto-slot (rule A): the default character already holds
    // equipped-sidearm in the main-hand, so fresh-sidearm diverts to the
    // off-hand and the primary weapon is left untouched.
    expect(runState.party[0].equipment.offhand.id).toBe('fresh-sidearm');
    expect(runState.party[0].equipment.weapon.id).toBe('equipped-sidearm');
    expect(byTestId(container, 'gear-equip-backup-sidearm').disabled).toBe(true);
    expect(byTestId(container, 'gear-equip-backup-sidearm').getAttribute('aria-description')).toBe('Free combat swap already spent.');
  });

  // SESSION-03 — replaces the no-op `actor.hpMax = character.maxHP` pair with
  // a derived sync so a gear swap refreshes the combat actor's maxes instead
  // of stranding them at whatever value the actor started with. Post-
  // transaction, character.equipment already reflects the swapped loadout,
  // so runStats(data, character) IS the "preview" derivation.
  it('post-equip sync overwrites stale actor hpMax/chargeMax with derived values', () => {
    const runState = run([item('fresh-sidearm', 'sidearm')], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    // Actor holds stale maxes (30/12) that pre-date the derived truth
    // (breacher vit 6 + hitDieBase 16 + calibrations 2 * hpGrowth 8 → hpMax
    // 56; res 6 → chargeMax 18). The equip triggers the sync and refreshes
    // both instead of leaving them stale.
    const actor = {
      id: 'breacher', side: 'party', ap: 2, swapAvailable: true,
      hp: 40, hpMax: 30, charge: 10, chargeMax: 12,
      weapon: null, equipment: { weapon: null, armor: null, offhand: null }
    };
    const combatState = { turnOrder: ['breacher'], currentTurn: 0, combatants: new Map([['breacher', actor]]) };
    const { container } = renderGearWith(runState, { combatState });
    byTestId(container, 'gear-equip-fresh-sidearm').click();

    expect(runState.party[0].equipment.weapon?.id).toBe('fresh-sidearm');
    // Derived hpMax with sidearm (no armor) = 6*4 + 16 + 2*8 = 56.
    expect(actor.hpMax).toBe(56);
    // Derived chargeMax with sidearm (no armor bonus) = 6*3 + 0 = 18.
    expect(actor.chargeMax).toBe(18);
  });

  it('post-unequip sync with no context.data leaves actor maxes untouched', () => {
    // Character starts with the default equipped-sidearm. Unequip does not
    // hit the class-gate path, so it resolves even without data — perfect
    // probe for the "data absent → don't touch actor maxes" fallback.
    const runState = run([]);
    const actor = {
      id: 'breacher', side: 'party', ap: 2, swapAvailable: true,
      hp: 30, hpMax: 30, charge: 5, chargeMax: 12,
      weapon: runState.party[0].equipment.weapon,
      equipment: { ...runState.party[0].equipment }
    };
    const combatState = { turnOrder: ['breacher'], currentTurn: 0, combatants: new Map([['breacher', actor]]) };
    const container = new FakeElement('div');
    // Deliberately omit `data` from context so syncCombatActor's guard skips
    // the derived refresh.
    const context = { runState, combatState, refresh: () => renderGear(container, context) };
    renderGear(container, context);
    byTestId(container, 'gear-unequip-weapon').click();

    expect(runState.party[0].equipment.weapon).toBe(null);
    // Without data, actor's pre-existing maxes are preserved (no zeroing).
    expect(actor.hpMax).toBe(30);
    expect(actor.chargeMax).toBe(12);
  });

  it('renders the combat swap-locked reason visibly beside the disabled UNEQUIP button', () => {
    const runState = run([]);
    const actor = { id: 'breacher', side: 'party', ap: 2, swapAvailable: false, weapon: runState.party[0].equipment.weapon, equipment: { ...runState.party[0].equipment } };
    const combatState = { turnOrder: ['breacher'], currentTurn: 0, combatants: new Map([['breacher', actor]]) };
    const { container } = renderGearWith(runState, { combatState });

    const unequip = byTestId(container, 'gear-unequip-weapon');
    expect(unequip.disabled).toBe(true);
    expect(unequip.getAttribute('aria-description')).toBe('Free combat swap already spent.');

    const reasonNode = byTestId(container, 'gear-unequip-reason-weapon');
    expect(reasonNode).toBeTruthy();
    expect(reasonNode.className).toContain('disabled-reason');
    expect(reasonNode.textContent).toBe('Free combat swap already spent.');
  });

  it('omits the unequip-blocked reason node when the swap is allowed', () => {
    const runState = run([]);
    const { container } = renderGearWith(runState);

    expect(byTestId(container, 'gear-unequip-weapon').disabled).toBe(false);
    expect(byTestId(container, 'gear-unequip-reason-weapon')).toBe(null);
  });

  it('opens the manual for the equipped-weapon rarity and affix chips in the detail pane', () => {
    const tuned = item('detail-sidearm', 'sidearm', { rarity: 'tuned', affixes: ['precise'] });
    const runState = run([], [character({ equipment: { weapon: tuned, armor: null, offhand: null } })]);
    const { bus, events } = recordingBus();
    const { container } = renderGearWith(runState, { bus });

    const detail = byTestId(container, 'gear-item-detail-weapon');
    expect(detail).toBeTruthy();
    const rarity = byTestId(detail, 'manual-link-rarity_tuned');
    expect(rarity).toBeTruthy();
    expect(rarity.tagName).toBe('BUTTON');
    expect(rarity.className).toContain('rarity-tag');
    rarity.click();
    const affix = byTestId(detail, 'gear-affix-link-weapon-precise');
    expect(affix).toBeTruthy();
    expect(affix.tagName).toBe('BUTTON');
    affix.click();

    expect(events).toContainEqual(['ui:manual-open', { target: 'rarity_tuned', source: 'gear-rarity' }]);
    expect(events).toContainEqual(['ui:manual-open', { target: 'affixes', source: 'gear-affix' }]);
  });

  it('opens the manual from the salvage/scrap header chip', () => {
    const runState = run([item('fresh-sidearm')]);
    const { bus, events } = recordingBus();
    const { container } = renderGearWith(runState, { bus });

    const link = byTestId(container, 'gear-salvage-link');
    expect(link).toBeTruthy();
    expect(link.tagName).toBe('BUTTON');
    link.click();
    expect(events).toContainEqual(['ui:manual-open', { target: 'loot_and_salvage', source: 'gear-salvage' }]);
  });

  it('surfaces the corrupt manual link inside the pending consent warning', () => {
    const corrupt = item('corrupt-sidearm', 'sidearm', { rarity: 'corrupt', corrupt: true, corruptionValue: 0.1 });
    const runState = run([corrupt], [character({ equipment: { weapon: null, armor: null, offhand: null } })]);
    const { bus, events } = recordingBus();
    const { container } = renderGearWith(runState, { bus });

    byTestId(container, 'gear-equip-corrupt-sidearm').click();
    const warning = byTestId(container, 'gear-corrupt-warning');
    expect(warning).toBeTruthy();
    const link = byTestId(warning, 'gear-corrupt-link');
    expect(link).toBeTruthy();
    expect(link.tagName).toBe('BUTTON');
    link.click();
    expect(events).toContainEqual(['ui:manual-open', { target: 'corrupt_items', source: 'gear-corrupt' }]);
  });

  it('never nests a button inside another button', () => {
    const corrupt = item('corrupt-sidearm', 'sidearm', { rarity: 'corrupt', corrupt: true, corruptionValue: 0.1, affixes: ['precise'] });
    const runState = run([corrupt, item('fresh-sidearm', 'sidearm', { rarity: 'tuned', affixes: ['edged'] })]);
    const { bus } = recordingBus();
    const { container } = renderGearWith(runState, { bus });

    byTestId(container, 'gear-equip-corrupt-sidearm').click();
    expect(hasNestedButtonInButton(container)).toBe(false);
  });
});

describe('PARTY/GEAR — SESSION-02 shared density semantics', () => {
  it('separates static detail metadata from retained interactive PARTY and GEAR rows', () => {
    const partyContainer = new FakeElement('div');
    renderParty(partyContainer, { runState: run(), data });
    expect(byTestId(partyContainer, 'party-detail').classList.contains('scroll-area')).toBe(true);
    expect(byTestId(partyContainer, 'party-defense').classList.contains('console-static-row')).toBe(true);
    expect(byTestId(partyContainer, 'party-member-breacher').classList.contains('console-row')).toBe(true);

    const { container: gearContainer } = renderGearWith(run([item('density-shared')]));
    expect(byTestId(gearContainer, 'gear-inventory').classList.contains('scroll-area')).toBe(true);
    expect(byTestId(gearContainer, 'gear-item-density-shared').classList.contains('console-row')).toBe(true);
    expect(byTestId(gearContainer, 'gear-inventory-header').classList.contains('console-static-row')).toBe(true);
  });
});
