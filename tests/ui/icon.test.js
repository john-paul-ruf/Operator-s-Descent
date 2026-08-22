import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { ICON_IDS, createIcon, isIconId } from '../../src/ui/icon.js';

const here = dirname(fileURLToPath(import.meta.url));
const spritePath = resolve(here, '..', '..', 'assets', 'icons.svg');
const sprite = readFileSync(spritePath, 'utf8');

class FakeElement {
  constructor(tagName, namespaceURI = null) {
    this.tagName = String(tagName).toUpperCase();
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.attributes = new Map();
    this.attributesNS = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttributeNS(ns, name, value) { this.attributesNS.set(`${ns}|${name}`, String(value)); }
  getAttributeNS(ns, name) {
    if (this.attributesNS.has(`${ns}|${name}`)) return this.attributesNS.get(`${ns}|${name}`);
    return this.attributes.get(name) ?? null;
  }
  get className() { return this.attributes.get('class') ?? ''; }
  appendChild(child) { this.children.push(child); return child; }
}

beforeEach(() => {
  globalThis.document = {
    createElementNS: (ns, tag) => new FakeElement(tag, ns)
  };
});

describe('createIcon', () => {
  test('default svg has icon + icon-16 classes and a <use> child pointing at the sprite', () => {
    const svg = createIcon('sword');
    expect(svg.tagName).toBe('SVG');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.className).toBe('icon icon-16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.children).toHaveLength(1);
    const use = svg.children[0];
    expect(use.tagName).toBe('USE');
    expect(use.getAttribute('href')).toBe('assets/icons.svg#sword');
    expect(use.getAttributeNS('http://www.w3.org/2000/svg', 'href')).toBe('assets/icons.svg#sword');
  });

  test('label + size options set role, aria-label, and size class', () => {
    const svg = createIcon('sword', { size: 24, label: 'Attack' });
    expect(svg.className).toBe('icon icon-24');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Attack');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });

  test('tone option appends icon-<tone>', () => {
    const svg = createIcon('sword', { tone: 'danger' });
    expect(svg.className).toContain('icon-danger');
  });

  test('unknown tones and unsupported sizes fall back to defaults', () => {
    const svg = createIcon('sword', { size: 99, tone: 'rainbow' });
    expect(svg.className).toBe('icon icon-16');
  });

  test('caller-supplied className is appended', () => {
    const svg = createIcon('sword', { className: 'mode-btn' });
    expect(svg.className).toBe('icon icon-16 mode-btn');
  });

  test('empty id throws', () => {
    expect(() => createIcon('')).toThrow(/unknown icon id/);
    expect(() => createIcon(null)).toThrow(/unknown icon id/);
    expect(() => createIcon(undefined)).toThrow(/unknown icon id/);
  });
});

describe('isIconId', () => {
  test('known ids return true', () => {
    expect(isIconId('sword')).toBe(true);
    expect(isIconId('triangle-alert')).toBe(true);
  });
  test('unknown ids return false', () => {
    expect(isIconId('nonexistent')).toBe(false);
    expect(isIconId('')).toBe(false);
    expect(isIconId(null)).toBe(false);
  });
  // icon-first-ui-density SESSION-02: two new sprite ids requested by
  // SESSION-01 (§3.7 loot MANAGE JUNK toggle, §3.9 wide-dock Seed label).
  // Pinned explicitly so a regression at either end fails loudly.
  test('SESSION-02 sprite additions are members of ICON_IDS', () => {
    expect(isIconId('chevron-down')).toBe(true);
    expect(isIconId('hash')).toBe(true);
  });
});

describe('ICON_IDS lockstep with sprite', () => {
  test('every ICON_IDS entry has a matching <symbol id="…"> in the sprite', () => {
    for (const id of ICON_IDS) {
      const pattern = new RegExp(`<symbol id="${id}"`);
      expect(pattern.test(sprite), `missing symbol for '${id}'`).toBe(true);
    }
  });

  test('every <symbol id="…"> in the sprite is present in ICON_IDS', () => {
    const spriteIds = [...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]);
    for (const id of spriteIds) {
      expect(ICON_IDS.has(id), `sprite id '${id}' missing from ICON_IDS`).toBe(true);
    }
  });
});
