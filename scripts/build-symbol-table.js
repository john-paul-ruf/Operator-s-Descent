import { readFile, writeFile } from 'node:fs/promises';
import { hash } from '../src/core/hash.js';
const IDS = {
  classes: ['breacher', 'ghost', 'compiler', 'anchor', 'oracle', 'operator'],
  enemies: ['drone', 'warden', 'stalker', 'choir', 'null', 'construct', 'phantom', 'apex'],
  themes: ['cold_storage', 'foundry', 'data_stream', 'data_cache', 'archive', 'hive', 'void', 'lattice', 'stack', 'terminal', 'nursery', 'crypt'],
  schools: ['disrupt', 'ward', 'scry', 'rewrite'],
  weapons: ['sidearm', 'heavy_melee', 'polearm', 'light_ranged', 'heavy_ranged', 'sniper', 'area_projector', 'shield'],
  armor: ['none', 'light', 'medium', 'heavy'],
  consumables: ['repair_patch', 'med_kit', 'charge_cell', 'boost_cell', 'purge_spike', 'shield_capacitor', 'adrenal_injector'],
  conditions: ['jammed', 'overloaded', 'shielded', 'blinded', 'immobilized', 'corroded', 'marked', 'panicked', 'burning'],
  affixes: ['reinforced', 'overcharged', 'lucky', 'phasing', 'edged', 'precise', 'extended', 'vampiric', 'conducting', 'incendiary', 'corrosive', 'jamming', 'lightweight', 'shielding', 'fortified', 'resonant']
};

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function table(entries) {
  const width = Math.ceil(Math.log2(entries.length + 1));
  return { width, escape: (2 ** width) - 1, entries };
}

function requireIds(record, ids, label) {
  if (!record || ids.some((id) => !Object.hasOwn(record, id))) throw new Error(`invalid_${label}`);
  return ids;
}

async function load(name) {
  return JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));
}

async function build() {
  const [sigils, themes, classes, protocols, equipment, affixes, conditions, consumables] = await Promise.all([
    load('sigils'), load('themes'), load('classes'), load('protocols'), load('equipment'), load('affixes'), load('conditions'), load('consumables')
  ]);
  requireIds(Object.fromEntries(classes.classes.map((entry) => [entry.id, entry])), IDS.classes, 'classes');
  requireIds(sigils.playerBank.families, IDS.classes, 'player_sigils');
  requireIds(sigils.bestiaryBank.archetypes, IDS.enemies, 'bestiary_sigils');
  requireIds(Object.fromEntries(themes.themes.map((entry) => [entry.id, entry])), IDS.themes, 'themes');
  requireIds(protocols.schools, IDS.schools, 'schools');
  requireIds(equipment.weapons, IDS.weapons, 'weapons');
  requireIds(equipment.armor, IDS.armor, 'armor');
  requireIds(consumables.consumables, IDS.consumables, 'consumables');
  requireIds(conditions.conditions, IDS.conditions, 'conditions');
  requireIds(affixes.affixes, IDS.affixes, 'affixes');

  const codepoints = [
    ...IDS.classes.flatMap((id) => sigils.playerBank.families[id].codepoints),
    ...IDS.enemies.flatMap((id) => sigils.bestiaryBank.archetypes[id].codepoints)
  ];
  if (codepoints.length !== 72 || new Set(codepoints).size !== 72) throw new Error('invalid_sigil_range');
  const output = {
    version: 1,
    tables: {
      class: table(IDS.classes),
      sigil_id: table(codepoints.map((codepoint) => `pua-${codepoint.toString(16)}`)),
      sigil_codepoint: table(codepoints),
      attribute: table(range(1, 10)),
      hp: table(range(0, 80)),
      charge: table(range(0, 80)),
      condition_mask: table(range(0, 63)),
      item_id: table([...IDS.weapons, ...IDS.armor, ...IDS.consumables]),
      equipment: table([
        ...IDS.weapons.map((id) => [id, equipment.weapons[id].slot]),
        ...IDS.armor.map((id) => [id, 'armor'])
      ]),
      calibration_count: table(range(0, 16)),
      signature_tier: table(range(1, 3)),
      theme_id: table(IDS.themes),
      protocol_ref: table(IDS.schools.flatMap((school) => range(1, 5).map((tier) => [school, tier]))),
      affix_id: table(IDS.affixes),
      inventory_default: table(['empty'])
    }
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}

function reportCollisions(serialized) {
  const { tables } = JSON.parse(serialized);
  for (const [name, table] of Object.entries(tables)) {
    const hashes = new Map();
    for (const entry of table.entries) {
      const key = hash(JSON.stringify(entry));
      hashes.set(key, (hashes.get(key) || 0) + 1);
    }
    const collisions = [...hashes.values()].filter((count) => count > 1).reduce((total, count) => total + count - 1, 0);
    process.stdout.write(`${name}: ${table.entries.length} entries, ${collisions} hash collisions\n`);
  }
}

const expected = await build();
const destination = new URL('../data/symbol-table.json', import.meta.url);
if (process.argv.includes('--check')) {
  const actual = await readFile(destination, 'utf8');
  if (actual !== expected) {
    process.stderr.write('data/symbol-table.json is not generated from current content.\n');
    process.exitCode = 1;
  }
} else {
  await writeFile(destination, expected);
}
if (process.argv.includes('--report')) reportCollisions(expected);
