import { createButton, createSigilToken, createHPBar, createChargeBar, createConditionTag, createScrollArea, createEquipmentCard, createProtocolCard } from '../components.js';
import { modifier, deriveStats, ATTRIBUTE_KEYS } from '../../rules/attributes.js';
import { getSignatureCapabilities } from '../../rules/classes.js';
import { resolveLoadout } from '../../rules/equipment.js';

const ATTR_LABELS = { mgt: 'MGT', fin: 'FIN', vit: 'VIT', res: 'RES', foc: 'FOC', sig: 'SIG' };
const SLOT_LABELS = { weapon: 'Weapon', armor: 'Armor', offhand: 'Off-hand' };
const SLOT_SHORT = { weapon: 'WPN', armor: 'ARM', offhand: 'OFH' };
const selectionByRun = new WeakMap();

function clear(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else while (container.firstChild) container.removeChild(container.firstChild);
}

function codepointFromSigilId(value) {
  const match = typeof value === 'string' && /^pua-([0-9a-f]{1,6})$/i.exec(value);
  return match ? Number.parseInt(match[1], 16) : null;
}

function sigilOf(character) {
  return character?.sigilCodepoint ?? codepointFromSigilId(character?.sigilId) ?? 0xE000;
}

function classDataFor(data, character) {
  return data?.classes?.classes?.find((entry) => entry.id === character?.classId) || null;
}

function combatActorFor(context, character) {
  const combatants = context?.combatState?.combatants;
  return combatants instanceof Map ? combatants.get(character?.id) || null : null;
}

function hpOf(character, combatActor) {
  return {
    current: combatActor?.hp ?? character?.currentHP ?? character?.hp ?? 0,
    max: combatActor?.hpMax ?? character?.maxHP ?? character?.hpMax ?? character?.currentHP ?? character?.hp ?? 0
  };
}

function chargeOf(character, combatActor) {
  return {
    current: combatActor?.charge ?? character?.currentCHARGE ?? character?.charge ?? 0,
    max: combatActor?.chargeMax ?? character?.maxCHARGE ?? character?.chargeMax ?? character?.currentCHARGE ?? character?.charge ?? 0
  };
}

function text(className, value, testid = null) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  if (testid) element.dataset.testid = testid;
  return element;
}

function row(label, value, testid = null) {
  const element = document.createElement('div');
  element.className = 'party-stat-row console-row';
  if (testid) element.dataset.testid = testid;
  const name = document.createElement('span');
  name.className = 'stat-label';
  name.textContent = label;
  const val = document.createElement('span');
  val.className = 'stat-value';
  val.textContent = value;
  element.append(name, val);
  return element;
}

function compactBar(label, current, max, colorVar) {
  const wrap = document.createElement('div');
  wrap.className = 'party-inline-bar console-row';
  const info = document.createElement('span');
  info.className = 'stat-label';
  info.textContent = `${label} ${current}/${max}`;
  const track = document.createElement('div');
  track.className = 'party-inline-track';
  const fill = document.createElement('div');
  fill.className = 'party-inline-fill';
  fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0}%`;
  fill.style.background = `var(${colorVar})`;
  track.appendChild(fill);
  wrap.append(info, track);
  return wrap;
}

function equipmentLine(character) {
  const pieces = [];
  for (const slot of ['weapon', 'offhand', 'armor']) {
    const item = character.equipment?.[slot];
    if (item) pieces.push(`${SLOT_SHORT[slot] || slot}: ${itemLabel(item)}`);
  }
  return pieces.join(' · ') || 'No gear.';
}

function itemLabel(item) {
  return item?.name || item?.baseType || item?.id || '—';
}

function protocolLabel(protocol, data) {
  return data?.protocols?.schools?.[protocol.school]?.tiers?.[protocol.tier - 1]?.name || `${protocol.school}-${protocol.tier}`;
}

function corruptionContribution(character) {
  return Object.values(character?.equipment || {}).reduce((sum, item) => sum + (item?.corrupt ? Number(item.corruptionValue || 0) : 0), 0);
}

function getSelection(runState) {
  if (!selectionByRun.has(runState)) selectionByRun.set(runState, { index: 0 });
  return selectionByRun.get(runState);
}

export function render(container, context = {}) {
  clear(container);
  const runState = context.runState;
  const living = (runState?.party || []).filter((member) => (member.currentHP ?? member.hp ?? 1) > 0);
  if (!runState || !living.length) {
    container.appendChild(text('console-empty', 'No living party members.', 'party-empty'));
    return;
  }

  const state = getSelection(runState);
  state.index = Math.max(0, Math.min(state.index, living.length - 1));
  const grid = document.createElement('div');
  grid.className = 'member-grid';
  grid.dataset.testid = 'party-roster';
  living.forEach((character, index) => {
    const combatActor = combatActorFor(context, character);
    const hp = hpOf(character, combatActor);
    const charge = chargeOf(character, combatActor);
    const selected = index === state.index;
    const card = document.createElement('div');
    card.className = `member-card console-row${selected ? ' selected' : ''}`;
    card.dataset.testid = `party-member-${character.id}`;
    card.addEventListener('click', () => { state.index = index; renderDetail(detail, living[state.index], context); });
    card.appendChild(createSigilToken(sigilOf(character), 34, { role: 'player', label: `Party member ${character.id}` }));
    const meta = document.createElement('div');
    meta.className = 'member-card-meta';
    const name = document.createElement('div');
    name.className = 'member-card-name';
    name.textContent = character.name || character.classId || `C${index + 1}`;
    meta.appendChild(name);
    card.appendChild(meta);
    card.appendChild(compactBar('HP', hp.current, hp.max, '--danger'));
    card.appendChild(compactBar('CHG', charge.current, charge.max, '--accent'));
    const equip = document.createElement('div');
    equip.className = 'member-card-equip';
    equip.textContent = equipmentLine(character);
    card.appendChild(equip);
    grid.appendChild(card);
  });
  container.appendChild(grid);

  const detail = createScrollArea({ label: 'Party member detail', focusable: true });
  detail.className = 'party-detail';
  detail.dataset.testid = 'party-detail';
  container.appendChild(detail);
  renderDetail(detail, living[state.index], context);
}

function renderDetail(area, character, context) {
  clear(area);
  if (!character) return;
  const data = context.data || {};
  const classData = classDataFor(data, character);
  const loadout = resolveLoadout(character, data.equipment, data.affixes);
  const derived = deriveStats(character, classData, loadout);
  const combatActor = combatActorFor(context, character);
  const hp = hpOf(character, combatActor);
  const charge = chargeOf(character, combatActor);
  const signature = getSignatureCapabilities(character, classData);

  const header = document.createElement('div');
  header.className = 'detail-header console-row';
  header.appendChild(createSigilToken(sigilOf(character), 72, { role: 'player', label: `${character.id} sigil` }));
  header.appendChild(text('detail-title', `${classData?.name || character.classId || 'Operator'} · Signature T${signature.tier} ${classData?.signature?.name || signature.signatureId || ''}`.trim(), 'party-class'));
  area.appendChild(header);
  area.appendChild(createHPBar(hp.current, hp.max));
  area.appendChild(createChargeBar(charge.current, charge.max));

  const combatLine = combatActor
    ? `AP ${combatActor.ap ?? 0} · ${combatActor.moveAvailable ? 'MOVE READY' : 'MOVE SPENT'} · ${combatActor.swapAvailable ? 'SWAP READY' : 'SWAP SPENT'}`
    : 'Not in combat';
  area.appendChild(row('Combat', combatLine, 'party-combat-resources'));
  area.appendChild(row('Run resources', `COR ${Number(context.runState.corruption || 0).toFixed(2)} · CRED ${context.runState.credits || 0} · SCRAP ${context.runState.scrapCounter || 0}`, 'party-resources'));
  area.appendChild(row('Corrupt load', corruptionContribution(character).toFixed(2), 'party-corrupt-load'));
  area.appendChild(row('Calibration', `${character.calibrationCount || 0} choices · T${signature.tier}`, 'party-calibration'));

  const attrs = document.createElement('div');
  attrs.className = 'party-attributes';
  attrs.dataset.testid = 'party-attributes';
  for (const key of ATTRIBUTE_KEYS) attrs.appendChild(row(ATTR_LABELS[key], `${character.attributes?.[key] ?? 0} (${modifier(character.attributes?.[key] ?? 3) >= 0 ? '+' : ''}${modifier(character.attributes?.[key] ?? 3)})`));
  area.appendChild(attrs);

  const stats = document.createElement('div');
  stats.className = 'party-derived';
  stats.dataset.testid = 'party-derived';
  stats.append(
    row('Defense', String(derived.defenseBase), 'party-defense'),
    row('Protocol Defense', String(derived.protocolDefenseBase)),
    row('Initiative', `${derived.initiativeMod >= 0 ? '+' : ''}${derived.initiativeMod}`),
    row('Melee / Ranged / Protocol', `${derived.meleeAccuracy >= 0 ? '+' : ''}${derived.meleeAccuracy} / ${derived.rangedAccuracy >= 0 ? '+' : ''}${derived.rangedAccuracy} / ${derived.protocolAccuracy >= 0 ? '+' : ''}${derived.protocolAccuracy}`),
    row('Detection', `${derived.detectionRadius} cells`),
    row('CHARGE regen', String(derived.chargeRegen))
  );
  area.appendChild(stats);

  const conditions = document.createElement('div');
  conditions.className = 'condition-list console-row';
  conditions.dataset.testid = 'party-conditions';
  conditions.appendChild(text('section-label', 'Conditions'));
  const activeConditions = combatActor?.conditions || character.conditions || [];
  if (!activeConditions.length) conditions.appendChild(text('condition-empty', 'None'));
  for (const condition of activeConditions) conditions.appendChild(createConditionTag(condition.id || condition.conditionId || condition, condition.duration));
  area.appendChild(conditions);

  const equipment = document.createElement('div');
  equipment.className = 'party-equipment';
  equipment.dataset.testid = 'party-equipment';
  equipment.appendChild(text('section-label', 'Equipment'));
  for (const [slot, label] of Object.entries(SLOT_LABELS)) equipment.appendChild(row(label, itemLabel(character.equipment?.[slot])));
  area.appendChild(equipment);

  const deck = document.createElement('div');
  deck.className = 'party-deck';
  deck.dataset.testid = 'party-deck';
  deck.appendChild(text('section-label', 'Deck'));
  const protocols = character.protocolDeck || character.protocols || [];
  if (!protocols.length) deck.appendChild(text('deck-empty', 'No protocols prepared.'));
  for (const protocol of protocols) deck.appendChild(createProtocolCard({ ...protocol, name: protocolLabel(protocol, data) }));
  area.appendChild(deck);
}

export function handleInput() { return null; }
