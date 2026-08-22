import { createButton, createEquipmentCard, createManualLink, createRarityTag, createAffixTag, createScrollArea, attachDoubleActivate } from '../components.js';
import { canEquip } from '../../rules/classes.js';
import { deriveStats } from '../../rules/attributes.js';
import { describeItem, describeItemStats, equipItem, itemDisplayName, unequipItem, resolveLoadout } from '../../rules/equipment.js';
import { INVENTORY_CAP, getInventoryCount, toggleJunkTag, junkAllTagged, getSalvageValue } from '../../rules/inventory.js';

const SLOTS = ['weapon', 'armor', 'offhand'];
const SLOT_LABELS = { weapon: 'Weapon', armor: 'Armor', offhand: 'Off-hand' };
const SLOT_ICONS = { weapon: 'sword', armor: 'shield', offhand: 'star' };
const uiByRun = new WeakMap();

function clear(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else while (container.firstChild) container.removeChild(container.firstChild);
}

function stateFor(runState) {
  if (!uiByRun.has(runState)) uiByRun.set(runState, { charIndex: 0, slot: 'weapon', pendingCorruptItemId: null, pendingJunkAll: false, notice: '', error: '' });
  return uiByRun.get(runState);
}

function text(className, value, testid = null) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  if (testid) element.dataset.testid = testid;
  return element;
}

function classDataFor(data, character) {
  return data?.classes?.classes?.find((entry) => entry.id === character?.classId) || null;
}

function itemName(item, data) {
  if (!item) return '—';
  return itemDisplayName(item, data || {}) || '—';
}

function displayItem(item, data) {
  return { ...item, name: itemName(item, data), description: describeItem(item, data || {}) };
}

function itemStats(item, data) {
  return describeItemStats(item, { equipmentData: data?.equipment, affixesData: data?.affixes });
}

// SESSION-03 — duplicated in loot.js by design (STATE.md Design Decisions §4);
// extracting to components.js would force this session to lease that file.
function classesUsableFor(item, data) {
  if (!item || !data?.classes?.classes) return [];
  if (item.category === 'consumable') return ['All classes'];
  return data.classes.classes.filter((cls) => canEquip(cls, item)).map((cls) => cls.name);
}

function classesChip(item, data, testid) {
  const chip = document.createElement('div');
  chip.className = 'card-classes';
  const names = classesUsableFor(item, data);
  chip.textContent = names.length ? `Classes: ${names.join(' · ')}` : 'Classes: none';
  chip.dataset.testid = testid;
  return chip;
}

function itemUnits(item) {
  return Number.isInteger(item?.count) ? item.count : 1;
}

function cloneEquipment(equipment = {}) {
  return { weapon: equipment.weapon || null, armor: equipment.armor || null, offhand: equipment.offhand || null };
}

function applyRunState(target, source) {
  for (const key of Object.keys(source)) target[key] = source[key];
}

// SESSION-03 — every successful equip/unequip/junk mutates runState.inventory
// (or party equipment); the runtime autosaves on the paired bus event so a
// tab close after a swap never loses the change. Optional-chain the bus so
// bus-less test contexts stay green.
function notifyInventoryChange(context) {
  context.bus?.dispatch('state:inventory-change', { runState: context.runState });
}

function combatActorFor(context, character) {
  const combatants = context?.combatState?.combatants;
  return combatants instanceof Map ? combatants.get(character?.id) || null : null;
}

// SESSION-03 — the previous `actor.hpMax = character.maxHP ?? actor.hpMax`
// pair was a no-op (characters never store maxHP/maxCHARGE). Replace with a
// derived sync when data is available so a gear swap that alters chargeMax
// (armor/offhand bonus) updates the combat actor's max in place; otherwise
// leave the actor's max untouched. runStats is the sibling preview helper —
// it derives from the current (post-transaction) equipment on the character.
function syncCombatActor(actor, character, data) {
  if (!actor || !character) return;
  actor.weapon = character.equipment?.weapon || null;
  actor.armor = character.equipment?.armor || null;
  actor.offhand = character.equipment?.offhand || null;
  actor.equipment = cloneEquipment(character.equipment);
  actor.hp = character.currentHP ?? actor.hp;
  actor.charge = character.currentCHARGE ?? actor.charge;
  if (data && classDataFor(data, character)) {
    const stats = runStats(data, character);
    actor.hpMax = stats.hpMax;
    actor.chargeMax = stats.chargeMax;
  }
}

function combatSwapGate(context, character) {
  if (!context.combatState) return { allowed: true, reason: '' };
  const activeId = context.combatState.turnOrder?.[context.combatState.currentTurn];
  const actor = combatActorFor(context, character);
  if (!actor || activeId !== character.id) return { allowed: false, reason: 'Only the active combatant can change gear.' };
  if (!actor.swapAvailable) return { allowed: false, reason: 'Free combat swap already spent.' };
  return { allowed: true, reason: '' };
}

function consumeSwap(context, character) {
  const actor = combatActorFor(context, character);
  if (actor && context.combatState) actor.swapAvailable = false;
  syncCombatActor(actor, character, context.data);
}

function itemSlotCompatible(slot, item) {
  if (slot === 'armor') return item?.category === 'armor';
  return item?.category === 'weapon';
}

function itemLegalForCharacter(data, character, item) {
  return canEquip(classDataFor(data, character), item, character?.extensions?.proficiencies || []);
}

function equipDisabledReason(context, state, character, item) {
  const swap = combatSwapGate(context, character);
  if (!swap.allowed) return swap.reason;
  if (!itemSlotCompatible(state.slot, item)) return `Cannot equip ${item.category} in ${SLOT_LABELS[state.slot]}.`;
  if (!itemLegalForCharacter(context.data || {}, character, item)) {
    const cls = classDataFor(context.data || {}, character);
    const who = cls?.name || character?.classId || 'This class';
    return `${who} can't equip ${itemName(item, context.data)} — not in class ${item.category} gates.`;
  }
  return '';
}

function runStats(data, character) {
  return deriveStats(character, classDataFor(data, character), resolveLoadout(character, data.equipment, data.affixes));
}

function projectedStats(data, character, slot, item) {
  const projected = { ...character, equipment: { ...cloneEquipment(character.equipment), [slot]: item } };
  return runStats(data, projected);
}

function statDeltaLine(before, after) {
  const delta = (key) => (after[key] ?? 0) - (before[key] ?? 0);
  const sign = (value) => value >= 0 ? `+${value}` : String(value);
  return `DEF ${before.defenseBase}→${after.defenseBase} (${sign(delta('defenseBase'))}) · CHG ${before.chargeMax}→${after.chargeMax} (${sign(delta('chargeMax'))}) · INIT ${sign(before.initiativeMod)}→${sign(after.initiativeMod)}`;
}

function transactionResult(context, result, message) {
  const state = stateFor(context.runState);
  if (!result.success) {
    state.error = result.reason || 'transaction_failed';
    state.notice = '';
    context.refresh?.();
    return false;
  }
  applyRunState(context.runState, result.runState);
  const character = context.runState.party[state.charIndex];
  consumeSwap(context, character);
  state.error = '';
  state.notice = message;
  state.pendingCorruptItemId = null;
  state.pendingJunkAll = false;
  notifyInventoryChange(context);
  context.refresh?.();
  return true;
}

function requestEquip(context, item) {
  const state = stateFor(context.runState);
  const character = context.runState.party[state.charIndex];
  const reason = equipDisabledReason(context, state, character, item);
  if (reason) {
    state.error = reason;
    state.notice = '';
    context.refresh?.();
    return false;
  }
  const newCorrupt = item.corrupt && !context.runState.appliedCorruptItemIds?.includes(item.id);
  if (newCorrupt && state.pendingCorruptItemId !== item.id) {
    state.pendingCorruptItemId = item.id;
    state.error = '';
    state.notice = `CORRUPT ${itemName(item, context.data)} permanently adds ${Number(item.corruptionValue || 0).toFixed(2)} corruption.`;
    context.refresh?.();
    return false;
  }
  return transactionResult(context, equipItem(context.runState, character.id, state.slot, item.id), `Equipped ${itemName(item, context.data)} to ${SLOT_LABELS[state.slot]}.`);
}

function requestUnequip(context, slot) {
  const state = stateFor(context.runState);
  const character = context.runState.party[state.charIndex];
  const item = character?.equipment?.[slot];
  if (!item) return false;
  const swap = combatSwapGate(context, character);
  if (!swap.allowed) {
    state.error = swap.reason;
    state.notice = '';
    context.refresh?.();
    return false;
  }
  if (getInventoryCount(context.runState.inventory) + itemUnits(item) > INVENTORY_CAP) {
    state.error = 'Inventory full; cannot unequip without dropping gear.';
    state.notice = '';
    context.refresh?.();
    return false;
  }
  return transactionResult(context, unequipItem(context.runState, character.id, slot), `Unequipped ${itemName(item, context.data)}.`);
}

function requestJunkToggle(context, item) {
  const state = stateFor(context.runState);
  const result = toggleJunkTag(context.runState.inventory || [], item.id);
  if (!result.success) {
    state.error = result.reason || 'missing_item';
  } else {
    context.runState.inventory = result.inventory;
    state.error = '';
    state.notice = `${itemName(item, context.data)} ${result.junkTagged ? 'tagged as junk' : 'untagged'}.`;
    notifyInventoryChange(context);
  }
  state.pendingJunkAll = false;
  context.refresh?.();
}

function requestJunkAll(context) {
  const state = stateFor(context.runState);
  const tagged = (context.runState.inventory || []).filter((item) => item.junkTagged);
  if (!tagged.length) {
    state.error = 'No tagged junk to destroy.';
    state.notice = '';
    context.refresh?.();
    return false;
  }
  if (!state.pendingJunkAll) {
    const scrap = tagged.reduce((sum, item) => sum + getSalvageValue(item), 0);
    state.pendingJunkAll = true;
    state.error = '';
    state.notice = `Confirm permanent junking of ${tagged.length} item(s) for ${scrap} scrap.`;
    context.refresh?.();
    return false;
  }
  const result = junkAllTagged(context.runState.inventory || []);
  context.runState.inventory = result.inventory;
  context.runState.addScrap?.(result.scrapGained) || (context.runState.scrapCounter = (context.runState.scrapCounter || 0) + result.scrapGained);
  state.pendingJunkAll = false;
  state.error = '';
  state.notice = `Junked ${result.destroyedUnits} unit(s): +${result.scrapGained} scrap.`;
  notifyInventoryChange(context);
  context.refresh?.();
  return true;
}

export function render(container, context = {}) {
  clear(container);
  const runState = context.runState;
  if (!runState) {
    container.appendChild(text('console-empty', 'No data.', 'gear-empty'));
    return;
  }
  const ui = stateFor(runState);
  ui.charIndex = Math.max(0, Math.min(ui.charIndex, (runState.party?.length || 1) - 1));
  const character = runState.party?.[ui.charIndex];
  if (!character) {
    container.appendChild(text('console-empty', 'No party member.', 'gear-empty'));
    return;
  }

  const selectors = document.createElement('div');
  selectors.className = 'gear-selectors';
  selectors.dataset.testid = 'gear-selectors';
  for (let index = 0; index < runState.party.length; index++) {
    const member = runState.party[index];
    const button = createButton(member.name || member.classId || `C${index + 1}`, {
      selected: index === ui.charIndex,
      onClick: () => { ui.charIndex = index; ui.pendingCorruptItemId = null; ui.pendingJunkAll = false; context.refresh?.(); }
    });
    button.classList.add('gear-character', 'member-pill', 'console-row');
    if (index === ui.charIndex) button.classList.add('active');
    button.dataset.testid = `gear-character-${member.id}`;
    selectors.appendChild(button);
  }
  container.appendChild(selectors);

  const slotRow = document.createElement('div');
  slotRow.className = 'gear-slot-row';
  for (const slot of SLOTS) {
    const button = createButton(`${SLOT_LABELS[slot]} · ${itemName(character.equipment?.[slot], context.data)}`, {
      selected: ui.slot === slot,
      onClick: () => { ui.slot = slot; ui.pendingCorruptItemId = null; context.refresh?.(); },
      icon: SLOT_ICONS[slot], iconSize: 14
    });
    button.classList.add('gear-slot', 'console-row');
    button.dataset.testid = `gear-slot-${slot}`;
    slotRow.appendChild(button);
  }
  container.appendChild(slotRow);
  container.appendChild(text('mode-indicator', `◈ EQUIPPED — ${character.name || character.classId || `C${ui.charIndex + 1}`}`, 'gear-equipped-heading'));

  renderEquipped(container, context, character, ui);
  renderInventory(container, context, character, ui);
  if (ui.notice) container.appendChild(text('gear-notice console-row', ui.notice, 'gear-notice'));
  if (ui.error) container.appendChild(text('gear-error console-row', ui.error, 'gear-error'));
}

function renderEquipped(container, context, character, ui) {
  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
  const equipped = document.createElement('div');
  equipped.className = 'equipped-section';
  equipped.dataset.testid = 'gear-equipped';
  for (const slot of SLOTS) {
    const item = character.equipment?.[slot];
    const row = document.createElement('div');
    row.className = 'equipped-row item-card equipped console-row';
    row.dataset.testid = `gear-equipped-${slot}`;
    row.appendChild(text('equipped-slot', `${SLOT_LABELS[slot]}: ${itemName(item, context.data)}`));
    if (item) {
      row.appendChild(createEquipmentCard(displayItem(item, context.data), { stats: itemStats(item, context.data) }));
      if (item.rarity) {
        const detail = document.createElement('div');
        detail.className = 'gear-item-detail console-row';
        detail.dataset.testid = `gear-item-detail-${slot}`;
        detail.appendChild(createRarityTag(item.rarity, {
          manualLink: { source: 'gear-rarity', dispatch }
        }));
        const affixList = Array.isArray(item.affixes) ? item.affixes : [];
        for (const affix of affixList) {
          const affixObj = typeof affix === 'string'
            ? { id: affix, name: context.data?.affixes?.affixes?.[affix]?.name || affix, ...(context.data?.affixes?.affixes?.[affix] || {}) }
            : affix;
          const affixLink = createAffixTag(affixObj, affixObj.category === 'major', {
            manualLink: { source: 'gear-affix', dispatch }
          });
          affixLink.dataset.testid = `gear-affix-link-${slot}-${affixObj.id || affixObj.name || 'affix'}`;
          detail.appendChild(affixLink);
        }
        row.appendChild(detail);
      }
      row.appendChild(classesChip(item, context.data || {}, `gear-classes-${slot}`));
      const disabledReason = combatSwapGate(context, character).reason || (getInventoryCount(context.runState.inventory) + itemUnits(item) > INVENTORY_CAP ? 'Inventory full.' : '');
      const button = createButton('UNEQUIP', {
        disabled: Boolean(disabledReason), description: disabledReason,
        onClick: () => requestUnequip(context, slot),
        icon: 'x', iconSize: 14
      });
      button.dataset.testid = `gear-unequip-${slot}`;
      row.appendChild(button);
      if (disabledReason) {
        const why = text('disabled-reason unequip-blocked-reason console-row', disabledReason);
        why.dataset.testid = `gear-unequip-reason-${slot}`;
        row.appendChild(why);
      }
    }
    equipped.appendChild(row);
  }
  container.appendChild(equipped);
}

function renderInventory(container, context, character, ui) {
  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
  const inventory = context.runState.inventory || [];
  container.appendChild(text('mode-indicator', '◈ INVENTORY', 'gear-inventory-heading'));
  const header = document.createElement('div');
  header.className = 'inventory-header console-row';
  header.dataset.testid = 'gear-inventory-header';
  const tagged = inventory.filter((item) => item.junkTagged);
  const taggedScrap = tagged.reduce((sum, item) => sum + getSalvageValue(item), 0);
  const headerText = document.createElement('span');
  headerText.textContent = `Inventory ${getInventoryCount(inventory)}/${INVENTORY_CAP} · Scrap ${context.runState.scrapCounter || 0} · Tagged ${tagged.length} / ${taggedScrap}`;
  header.appendChild(headerText);
  header.appendChild(createManualLink('loot_and_salvage', {
    variant: 'chip', source: 'gear-salvage', dispatch, testid: 'gear-salvage-link'
  }));
  container.appendChild(header);

  if (ui.pendingCorruptItemId) {
    const pending = inventory.find((item) => item.id === ui.pendingCorruptItemId);
    const warning = document.createElement('div');
    warning.className = 'corrupt-warning console-row';
    warning.dataset.testid = 'gear-corrupt-warning';
    const warningText = document.createElement('span');
    warningText.textContent = `CORRUPT WARNING: ${itemName(pending, context.data)} permanently raises run corruption/danger. Removing it never refunds the cost.`;
    warning.appendChild(warningText);
    warning.appendChild(createManualLink('corrupt_items', {
      variant: 'chip', source: 'gear-corrupt', dispatch, testid: 'gear-corrupt-link'
    }));
    // SESSION-05 (icon-first-ui-density) — destructive-adjacent action per
    // GAP §3.5: triangle-alert prefix, danger tone, text kept.
    const confirm = createButton('CONFIRM CORRUPT EQUIP', {
      danger: true,
      icon: 'triangle-alert', iconSize: 14, iconTone: 'danger',
      onClick: () => requestEquip(context, pending)
    });
    confirm.dataset.testid = 'gear-confirm-corrupt';
    warning.appendChild(confirm);
    container.appendChild(warning);
  }

  const list = createScrollArea({ label: 'Inventory', focusable: true });
  list.className = 'inventory-list';
  list.dataset.testid = 'gear-inventory';
  if (!inventory.length) list.appendChild(text('console-empty', 'Inventory empty.'));
  const cleanups = [];
  for (const item of inventory) renderInventoryItem(list, context, character, ui, item, cleanups);
  list.cleanup = () => cleanups.forEach((fn) => fn());
  container.appendChild(list);

  const junkButton = createButton(ui.pendingJunkAll ? 'CONFIRM JUNK ALL TAGGED' : 'JUNK ALL TAGGED', {
    danger: true,
    disabled: tagged.length === 0,
    onClick: () => requestJunkAll(context),
    icon: 'recycle', iconSize: 14
  });
  junkButton.dataset.testid = 'gear-junk-all';
  container.appendChild(junkButton);
}

function renderInventoryItem(list, context, character, ui, item, cleanups = []) {
  const wrapper = document.createElement('div');
  wrapper.className = `inventory-row console-row${item.junkTagged ? ' junk-tagged' : ''}`;
  wrapper.dataset.testid = `gear-item-${item.id}`;
  wrapper.appendChild(createEquipmentCard(displayItem(item, context.data), { stats: itemStats(item, context.data) }));
  const before = runStats(context.data || {}, character);
  const after = itemSlotCompatible(ui.slot, item) ? projectedStats(context.data || {}, character, ui.slot, item) : before;
  wrapper.appendChild(text('gear-comparison', statDeltaLine(before, after), `gear-compare-${item.id}`));
  wrapper.appendChild(classesChip(item, context.data || {}, `gear-classes-${item.id}`));
  const reason = equipDisabledReason(context, ui, character, item);
  // SESSION-05 (icon-first-ui-density) — per GAP §3.5 the ENABLED EQUIP row
  // goes icon-only with a check sprite; the DISABLED path keeps the reason
  // text (reason chip already renders adjacent). Per §7 Risk 4, aria-label
  // must include the slot name — `EQUIP <SLOT>` — so screen readers hear the
  // slot context even when focus moves in without seeing the selected pill.
  const equipAria = `EQUIP ${SLOT_LABELS[ui.slot].toUpperCase()}`;
  const equip = createButton(reason ? `EQUIP BLOCKED` : '', {
    disabled: Boolean(reason),
    description: reason,
    label: reason ? undefined : equipAria,
    icon: reason ? undefined : 'check',
    iconSize: 14,
    onClick: () => requestEquip(context, item)
  });
  equip.dataset.testid = `gear-equip-${item.id}`;
  wrapper.appendChild(equip);
  // Double-activate = EQUIP. The existing gates (equipDisabledReason, CORRUPT
  // two-step confirm) run unchanged inside requestEquip, so a corrupt item's
  // first double-activate surfaces the warning instead of equipping. Skipped
  // when the item is not equippable so the inert row stays honest.
  if (!reason) cleanups.push(attachDoubleActivate(wrapper, () => requestEquip(context, item)));
  if (reason) {
    const why = text('disabled-reason equip-blocked-reason console-row', reason);
    why.dataset.testid = `gear-equip-reason-${item.id}`;
    wrapper.appendChild(why);
  }
  const junk = createButton(item.junkTagged ? 'UNTAG JUNK' : 'TAG JUNK', {
    onClick: () => requestJunkToggle(context, item),
    icon: 'recycle', iconSize: 14
  });
  junk.dataset.testid = `gear-junk-${item.id}`;
  wrapper.appendChild(junk);
  if (item.corrupt) wrapper.appendChild(text('corrupt-tag', `CORRUPT +${Number(item.corruptionValue || 0).toFixed(2)}`));
  list.appendChild(wrapper);
}

export function handleInput() { return null; }
