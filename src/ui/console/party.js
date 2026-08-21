import { createButton, createSigilToken, createHPBar, createChargeBar, createConditionTag, createManualLink, createScrollArea, createEquipmentCard, createProtocolCard } from '../components.js';
import { createIcon } from '../icon.js';
import { modifier, deriveStats, ATTRIBUTE_KEYS } from '../../rules/attributes.js';
import { getSignatureCapabilities } from '../../rules/classes.js';
import { resolveLoadout } from '../../rules/equipment.js';

// SESSION-06 — roster stat rows tone icons for their category. The icon is
// prefixed on the derived-stat row via `row()`'s new `icon` param.
const DERIVED_ICONS = {
  Defense: 'shield',
  'Protocol Defense': 'shield',
  Initiative: 'sparkles',
  'Melee / Ranged / Protocol': 'sword',
  Detection: 'eye',
  'CHARGE regen': 'battery'
};

function safeCreateIcon(id, opts = {}) {
  if (!id) return null;
  if (typeof document?.createElementNS !== 'function') return null;
  try { return createIcon(id, opts); } catch { return null; }
}

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

// SESSION-03 — max HP/CHARGE is derived, never stored. Callers pass this into
// hpOf/chargeOf so the fallback chain resolves to derived before current.
// Duplicated in tech.js / gear.js by design (sibling-import boundary per
// src/ui/status-strip.js:46-47 precedent); three copies is the accepted ceiling.
function derivedMaxesFor(character, data) {
  const classData = classDataFor(data, character);
  if (!classData) return null;
  const loadout = resolveLoadout(character, data?.equipment, data?.affixes);
  const derived = deriveStats(character, classData, loadout || character?.equipment || {});
  return { hpMax: derived.hpMax, chargeMax: derived.chargeMax };
}

function combatActorFor(context, character) {
  const combatants = context?.combatState?.combatants;
  return combatants instanceof Map ? combatants.get(character?.id) || null : null;
}

function hpOf(character, combatActor, derived) {
  const current = combatActor?.hp ?? character?.currentHP ?? character?.hp ?? 0;
  return {
    current,
    max: combatActor?.hpMax ?? character?.maxHP ?? character?.hpMax ?? Math.max(derived?.hpMax ?? current, current)
  };
}

function chargeOf(character, combatActor, derived) {
  const current = combatActor?.charge ?? character?.currentCHARGE ?? character?.charge ?? 0;
  return {
    current,
    max: combatActor?.chargeMax ?? character?.maxCHARGE ?? character?.chargeMax ?? Math.max(derived?.chargeMax ?? current, current)
  };
}

function text(className, value, testid = null) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  if (testid) element.dataset.testid = testid;
  return element;
}

function row(label, value, testid = null, iconId = null) {
  const element = document.createElement('div');
  element.className = 'party-stat-row console-row';
  if (testid) element.dataset.testid = testid;
  const name = document.createElement('span');
  name.className = 'stat-label';
  name.textContent = label;
  const icon = safeCreateIcon(iconId, { size: 14, tone: 'dim' });
  const val = document.createElement('span');
  val.className = 'stat-value';
  val.textContent = value;
  if (icon) element.append(icon, name, val);
  else element.append(name, val);
  return element;
}

function rowWithLink(label, value, target, dispatch, source, testid = null, linkTestid = null) {
  const element = document.createElement('div');
  element.className = 'party-stat-row console-row';
  if (testid) element.dataset.testid = testid;
  const name = document.createElement('span');
  name.className = 'stat-label';
  name.textContent = label;
  const link = createManualLink(target, { variant: 'chip', source, dispatch, testid: linkTestid || undefined });
  const val = document.createElement('span');
  val.className = 'stat-value';
  val.textContent = value;
  element.append(name, link, val);
  return element;
}

function compactBar(label, current, max, colorVar, iconId = null) {
  const wrap = document.createElement('div');
  wrap.className = 'party-inline-bar console-row';
  const info = document.createElement('span');
  info.className = 'stat-label';
  info.textContent = `${label} ${current}/${max}`;
  const icon = safeCreateIcon(iconId, { size: 14, tone: 'dim' });
  const track = document.createElement('div');
  track.className = 'party-inline-track';
  const fill = document.createElement('div');
  fill.className = 'party-inline-fill';
  fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0}%`;
  fill.style.background = `var(${colorVar})`;
  track.appendChild(fill);
  if (icon) wrap.append(icon, info, track);
  else wrap.append(info, track);
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
  container.appendChild(text('mode-indicator', '◈ PARTY ROSTER', 'party-heading'));

  const grid = document.createElement('div');
  grid.className = 'member-grid';
  grid.dataset.testid = 'party-roster';
  const cards = [];
  living.forEach((character, index) => {
    const combatActor = combatActorFor(context, character);
    const derived = derivedMaxesFor(character, context.data || {});
    const hp = hpOf(character, combatActor, derived);
    const charge = chargeOf(character, combatActor, derived);
    const selected = index === state.index;
    const card = document.createElement('div');
    card.className = `member-card console-row${selected ? ' selected' : ''}`;
    card.dataset.testid = `party-member-${character.id}`;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-selected', String(selected));
    const select = () => {
      state.index = index;
      for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
        cards[cardIndex].classList.toggle('selected', cardIndex === index);
        cards[cardIndex].setAttribute('aria-selected', String(cardIndex === index));
      }
      renderDetail(detail, living[state.index], context);
    };
    card.addEventListener('click', select);
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') select(); });
    card.appendChild(createSigilToken(sigilOf(character), 34, { role: 'player', label: `Party member ${character.id}` }));
    const roleIcon = safeCreateIcon('user', { size: 14, tone: 'dim' });
    if (roleIcon) card.appendChild(roleIcon);
    const meta = document.createElement('div');
    meta.className = 'member-card-meta';
    const name = document.createElement('div');
    name.className = 'member-card-name';
    name.textContent = character.name || character.classId || `C${index + 1}`;
    meta.appendChild(name);
    meta.appendChild(text('member-card-calibration', `Cal ${character.calibrationCount || 0} · T${getSignatureCapabilities(character, classDataFor(context.data || {}, character)).tier}`));
    card.appendChild(meta);
    card.appendChild(compactBar('HP', hp.current, hp.max, '--danger', 'heart'));
    card.appendChild(compactBar('CHG', charge.current, charge.max, '--accent', 'battery'));
    const equip = document.createElement('div');
    equip.className = 'member-card-equip';
    equip.textContent = equipmentLine(character);
    card.appendChild(equip);
    grid.appendChild(card);
    cards.push(card);
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
  const derivedMaxes = { hpMax: derived.hpMax, chargeMax: derived.chargeMax };
  const hp = hpOf(character, combatActor, derivedMaxes);
  const charge = chargeOf(character, combatActor, derivedMaxes);
  const signature = getSignatureCapabilities(character, classData);
  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);

  area.appendChild(text('mode-indicator', `◈ ${String(classData?.name || character.classId || 'OPERATOR').toUpperCase()} DETAIL`, 'party-detail-heading'));
  const header = document.createElement('div');
  header.className = 'detail-header console-row panel-elevated';
  const sigilToken = createSigilToken(sigilOf(character), 72, { role: 'player', label: `${character.id} sigil` });
  if (context.layout === 'wide') sigilToken.classList.add('sigil-lg');
  header.appendChild(sigilToken);
  header.appendChild(text('detail-title', `${classData?.name || character.classId || 'Operator'} · Signature T${signature.tier} ${classData?.signature?.name || signature.signatureId || ''}`.trim(), 'party-class'));
  area.appendChild(header);
  area.appendChild(createHPBar(hp.current, hp.max));
  area.appendChild(createChargeBar(charge.current, charge.max));

  const combatLine = combatActor
    ? `AP ${combatActor.ap ?? 0} · ${combatActor.moveAvailable ? 'MOVE READY' : 'MOVE SPENT'} · ${combatActor.swapAvailable ? 'SWAP READY' : 'SWAP SPENT'}`
    : 'Not in combat';
  area.appendChild(row('Combat', combatLine, 'party-combat-resources'));
  area.appendChild(row('Run resources', `COR ${Number(context.runState.corruption || 0).toFixed(2)} · CRED ${context.runState.credits || 0} · SCRAP ${context.runState.scrapCounter || 0}`, 'party-resources'));
  area.appendChild(rowWithLink('Corrupt load', corruptionContribution(character).toFixed(2), 'corruption', dispatch, 'party', 'party-corrupt-load'));
  area.appendChild(rowWithLink('Calibration', `${character.calibrationCount || 0} choices · T${signature.tier}`, 'calibration', dispatch, 'party', 'party-calibration'));

  const attrs = document.createElement('div');
  attrs.className = 'party-attributes';
  attrs.dataset.testid = 'party-attributes';
  for (const key of ATTRIBUTE_KEYS) {
    const attrRow = document.createElement('div');
    attrRow.className = 'party-stat-row console-row';
    attrRow.dataset.testid = `party-attr-${key}`;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'stat-label';
    nameSpan.textContent = ATTR_LABELS[key];
    const attrLink = createManualLink(key, { variant: 'chip', source: 'party-attribute', dispatch });
    const valSpan = document.createElement('span');
    valSpan.className = 'stat-value';
    const attrMod = modifier(character.attributes?.[key] ?? 3);
    valSpan.textContent = `${character.attributes?.[key] ?? 0} (${attrMod >= 0 ? '+' : ''}${attrMod})`;
    attrRow.append(nameSpan, attrLink, valSpan);
    attrs.appendChild(attrRow);
  }
  area.appendChild(attrs);

  const stats = document.createElement('div');
  stats.className = 'party-derived';
  stats.dataset.testid = 'party-derived';
  stats.append(
    row('Defense', String(derived.defenseBase), 'party-defense', DERIVED_ICONS['Defense']),
    row('Protocol Defense', String(derived.protocolDefenseBase), null, DERIVED_ICONS['Protocol Defense']),
    row('Initiative', `${derived.initiativeMod >= 0 ? '+' : ''}${derived.initiativeMod}`, null, DERIVED_ICONS['Initiative']),
    row('Melee / Ranged / Protocol', `${derived.meleeAccuracy >= 0 ? '+' : ''}${derived.meleeAccuracy} / ${derived.rangedAccuracy >= 0 ? '+' : ''}${derived.rangedAccuracy} / ${derived.protocolAccuracy >= 0 ? '+' : ''}${derived.protocolAccuracy}`, null, DERIVED_ICONS['Melee / Ranged / Protocol']),
    row('Detection', `${derived.detectionRadius} cells`, null, DERIVED_ICONS['Detection']),
    row('CHARGE regen', String(derived.chargeRegen), null, DERIVED_ICONS['CHARGE regen'])
  );
  area.appendChild(stats);

  const conditions = document.createElement('div');
  conditions.className = 'condition-list console-row';
  conditions.dataset.testid = 'party-conditions';
  conditions.appendChild(text('section-label', 'Conditions'));
  const activeConditions = combatActor?.conditions || character.conditions || [];
  if (!activeConditions.length) conditions.appendChild(text('condition-empty', 'None'));
  for (const condition of activeConditions) {
    const conditionId = condition.id || condition.conditionId || condition;
    conditions.appendChild(createConditionTag(conditionId, condition.duration, {
      manualLink: { source: 'party-condition', dispatch }
    }));
  }
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
