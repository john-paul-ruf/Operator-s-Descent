// SESSION-06 — LOOT console icon coverage.
// Container header lucide glyph (box or archive), OPEN CONTAINER
// (chevron-right), TAKE (download), TAG/UNTAG JUNK (recycle),
// JUNK ALL TAGGED (recycle). Focus on icon presence + click gating.

import { beforeEach, describe, expect, it } from 'vitest';
import { createRunState } from '../../src/state/run-state.js';
import { render as renderLoot } from '../../src/ui/console/loot.js';
import { describeItem } from '../../src/rules/equipment.js';
import { loadData } from '../helpers/data.js';

const data = {
  classes: loadData('classes'),
  equipment: loadData('equipment'),
  affixes: loadData('affixes'),
  consumables: loadData('consumables'),
  symbolTable: loadData('symbol-table')
};

class FakeClassList {
  constructor(el) { this.el = el; this.values = new Set(); }
  add(...names) { for (const n of names) if (n) this.values.add(n); this.sync(); }
  remove(...names) { for (const n of names) this.values.delete(n); this.sync(); }
  toggle(n, force) { const next = force == null ? !this.values.has(n) : Boolean(force); if (next) this.values.add(n); else this.values.delete(n); this.sync(); return next; }
  contains(n) { return this.values.has(n); }
  sync() { this.el._className = [...this.values].join(' '); }
}

class FakeElement {
  constructor(tag, ns = null) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = { properties: {}, setProperty(name, value) { this.properties[name] = value; } };
    this.classList = new FakeClassList(this);
    this._className = '';
    this.textContent = '';
    this.disabled = false;
    this.parentNode = null;
  }
  set className(v) { this._className = String(v); this.classList.values = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this._className || this.attributes.get('class') || ''; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const c of children) this.appendChild(c); }
  prepend(...children) { this.children = [...children, ...this.children]; }
  replaceChildren() { this.children = []; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  setAttributeNS(_ns, name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((c) => c !== listener)); }
  dispatch(type, event = {}) { for (const l of this.listeners.get(type) || []) l({ type, target: this, ...event }); }
  click() { if (this.disabled) return; this.dispatch('click'); }
}

function installDocument() {
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (ns, tag) => new FakeElement(tag, ns),
    createTextNode: (v) => Object.assign(new FakeElement('#text'), { textContent: v })
  };
}

function byTestId(root, testid) {
  if (root.dataset?.testid === testid) return root;
  for (const c of root.children || []) {
    const hit = byTestId(c, testid);
    if (hit) return hit;
  }
  return null;
}

function firstIconChild(el) {
  return (el.children || []).find((c) => c.tagName === 'SVG') || null;
}

function collectSvgs(root, out = []) {
  if (root.tagName === 'SVG') out.push(root);
  for (const c of root.children || []) collectSvgs(c, out);
  return out;
}

function collectText(root, out = []) {
  if (typeof root.textContent === 'string' && root.textContent) out.push(root.textContent);
  for (const c of root.children || []) collectText(c, out);
  return out;
}

function countStringOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function item(id, baseType = 'sidearm', overrides = {}) {
  return { id, category: 'weapon', baseType, rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false, ...overrides };
}

function character(overrides = {}) {
  return {
    id: 'operator', classId: 'operator', sigilId: 'pua-e028',
    attributes: { mgt: 5, fin: 5, vit: 5, res: 6, foc: 5, sig: 4 },
    currentHP: 30, currentCHARGE: 10, calibrationCount: 0,
    equipment: { weapon: null, armor: null, offhand: null },
    protocolDeck: [], conditions: [], ...overrides
  };
}

function run(inventory = [], members = [character()]) {
  return createRunState(123, members, { creationTimestamp: 1, inventory, scrapCounter: 0, corruption: 0 });
}

beforeEach(installDocument);

describe('LOOT mode — SESSION-06 icon coverage', () => {
  it('container header keeps its glyph as children[0] and appends a box (standard) or archive (vault) lucide icon after it', () => {
    const runState = run();
    const lootState = { container: { id: 1, kind: 'standard', x: 1, y: 1 }, items: [item('loot-sidearm')] };
    const container = new FakeElement('div');
    renderLoot(container, { runState, data, lootState, floor: { id: 'floor-1', themeId: 'printer_meat' } });
    const header = byTestId(container, 'loot-container');
    expect(header.children[0].className.split(/\s+/)).toContain('container-icon');
    // Second child is the lucide sprite (box for standard kind).
    const lucide = header.children[1];
    expect(lucide.tagName).toBe('SVG');
    expect(lucide.className.split(/\s+/)).toContain('icon');

    // Vault kind uses the archive glyph. Rebuild with kind='vault'.
    const runState2 = run();
    const vaultState = { container: { id: 2, kind: 'vault', x: 1, y: 1 }, items: [item('vault-sidearm')] };
    const container2 = new FakeElement('div');
    renderLoot(container2, { runState: runState2, data, lootState: vaultState, floor: { id: 'floor-1', themeId: 'printer_meat' } });
    const vaultHeader = byTestId(container2, 'loot-container');
    // Same shape: glyph first, then lucide icon.
    expect(vaultHeader.children[0].className.split(/\s+/)).toContain('container-icon');
    expect(vaultHeader.children[1].tagName).toBe('SVG');
  });

  it('SESSION-03 — container row renders the item description exactly once, keeps the rarity link, and drops loot-detail', () => {
    const runState = run();
    const weapon = item('loot-polearm', 'polearm');
    const lootState = { container: { id: 4, kind: 'standard', x: 1, y: 1 }, items: [weapon] };
    const container = new FakeElement('div');
    renderLoot(container, { runState, data, lootState, floor: { id: 'floor-1', themeId: 'printer_meat' } });

    const row = byTestId(container, 'loot-item-loot-polearm');
    expect(row).toBeTruthy();
    const description = describeItem(weapon, data);
    expect(description).toBeTruthy();
    const combined = collectText(row).join('\n');
    expect(countStringOccurrences(combined, description)).toBe(1);

    expect(byTestId(container, 'loot-rarity-link-loot-polearm')).toBeTruthy();
    expect(byTestId(container, 'loot-detail-loot-polearm')).toBeNull();
  });

  it('TAKE / OPEN CONTAINER / JUNK buttons expose lucide sprites and disabled TAKE is inert on click', () => {
    // Full pack disables the TAKE button.
    const runState = run(Array.from({ length: 100 }, (_, i) => ({ id: `c-${i}`, category: 'consumable', baseType: 'repair_patch', count: 1, rarity: 'stock', affixes: [], stats: {}, salvageValue: 2, junkTagged: false })));
    const lootState = { container: { id: 3, kind: 'standard', x: 1, y: 1 }, items: [item('loot-blocked')] };
    const container = new FakeElement('div');
    renderLoot(container, { runState, data, lootState, floor: { id: 'floor-1', themeId: 'printer_meat' } });

    const open = byTestId(container, 'loot-open');
    expect(firstIconChild(open)).toBeTruthy();

    const take = byTestId(container, 'loot-take-loot-blocked');
    expect(take).toBeTruthy();
    expect(take.disabled).toBe(true);
    expect(firstIconChild(take)).toBeTruthy();
    take.click();
    expect(runState.inventory.map((entry) => entry.id)).not.toContain('loot-blocked');

    // Every junk toggle in the inventory list gets a recycle icon.
    const junkList = byTestId(container, 'loot-junk-list');
    expect(junkList).toBeTruthy();
    const junkSvgs = collectSvgs(junkList);
    expect(junkSvgs.length).toBeGreaterThan(0);

    const junkAll = byTestId(container, 'loot-junk-all');
    expect(firstIconChild(junkAll)).toBeTruthy();
  });
});
