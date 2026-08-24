import { createButton, createEquipmentCard, createManualLink, createRarityTag, createScrollArea, attachDoubleActivate } from '../components.js';
import { createIcon } from '../icon.js';
import { canEquip } from '../../rules/classes.js';
import { deriveStats } from '../../rules/attributes.js';

// SESSION-06 — icon helper mirrors the fail-soft pattern in tech.js so the
// existing loot tests (which use a document without createElementNS) stay
// green while the browser gets the real sprite prefix.
function safeIcon(id, opts = {}) {
  if (!id) return null;
  if (typeof document?.createElementNS !== 'function') return null;
  try { return createIcon(id, opts); } catch { return null; }
}
import { describeItem, describeItemStats, itemDisplayName, resolveLoadout } from '../../rules/equipment.js';
import { generateLoot } from '../../rules/loot.js';
import { INVENTORY_CAP, addItem, getInventoryCount, toggleJunkTag, junkAllTagged, getSalvageValue } from '../../rules/inventory.js';

const stateByRun = new WeakMap();
const SLOT_LABELS = { weapon: 'Weapon', armor: 'Armor', offhand: 'Off-hand' };

function clear(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else while (container.firstChild) container.removeChild(container.firstChild);
}

function text(className, value, testid = null) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  if (testid) element.dataset.testid = testid;
  return element;
}

function stateFor(runState) {
  // inventoryOpen defaults false: the junk-management list starts collapsed so a full
  // pack never buries the container CONTENTS / OPEN / TAKE controls. The flag lives on
  // the per-run state so an explicit expand survives the re-render that every tag/take
  // triggers.
  if (!stateByRun.has(runState)) stateByRun.set(runState, { containers: new Map(), pendingJunkAll: false, notice: '', error: '', inventoryOpen: false, pickupResult: null });
  return stateByRun.get(runState);
}

function isOpened(runState, container) {
  try { return (BigInt(runState?.openedContainers ?? 0n) & (1n << BigInt(container.id))) !== 0n; } catch { return false; }
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function findEligibleLootContainer(lattice, runState) {
  if (!lattice) return null;
  const position = lattice.getPartyPosition();
  return lattice.getContainers()
    .filter((container) => !isOpened(runState, container) && distance(position, container) <= 1)
    .sort((a, b) => distance(position, a) - distance(position, b) || a.id - b.id)[0] ?? null;
}

function floorId(context) {
  const runState = context.runState || {};
  const floor = context.floor || {};
  return floor.id || floor.floorId || `${runState.worldSeed}:${runState.depth}:${floor.floorSubSeed ?? runState.floorSubSeed ?? 0}`;
}

function themeLootBias(context) {
  const theme = context.data?.themes?.themes?.find((entry) => entry.id === context.floor?.themeId);
  return theme?.lootBias || context.floor?.lootBias || {};
}

function containerKey(context, container) {
  return `${floorId(context)}:${container?.id}`;
}

function generatedItems(context, container) {
  const data = context.data || {};
  if (!data.equipment || !data.affixes || !data.consumables || !context.runState || !container) return [];
  return generateLoot(context.runState.worldSeed, context.runState.depth, floorId(context), container.id, themeLootBias(context), data.equipment, data.affixes, data.consumables, { kind: container.kind, containerType: container.kind });
}

function itemsFor(context, container) {
  const state = stateFor(context.runState);
  const key = containerKey(context, container);
  if (!state.containers.has(key)) {
    const supplied = Array.isArray(context.lootState?.items) && context.lootState.items.length ? context.lootState.items : generatedItems(context, container);
    state.containers.set(key, supplied.map((item) => ({ ...item, affixes: [...(item.affixes || [])], stats: { ...(item.stats || {}) } })));
  }
  const items = state.containers.get(key);
  if (context.lootState) context.lootState.items = items;
  return items;
}

function classDataFor(data, character) {
  return data?.classes?.classes?.find((entry) => entry.id === character?.classId) || null;
}

function itemName(item, data) {
  return itemDisplayName(item, data || {}) || item?.id || 'item';
}

function displayItem(item, data) {
  const affixes = (item.affixes || []).map((affix) => typeof affix === 'string' ? { id: affix, ...(data?.affixes?.affixes?.[affix] || {}) } : affix);
  return { ...item, name: itemName(item, data), description: describeItem(item, data || {}), affixes };
}

function itemStats(item, data) {
  return describeItemStats(item, { equipmentData: data?.equipment, affixesData: data?.affixes });
}

// SESSION-03 — duplicated in gear.js by design (STATE.md Design Decisions §4);
// extracting to components.js would force this session to lease that file.
function classesUsableFor(item, data) {
  if (!item || !data?.classes?.classes) return [];
  if (item.category === 'consumable') return ['All classes'];
  return data.classes.classes.filter((cls) => canEquip(cls, item)).map((cls) => cls.name);
}

function comparisonLine(item, context) {
  if (!['weapon', 'armor'].includes(item.category)) return 'Consumable — no equipment comparison.';
  const character = context.runState?.party?.find((member) => (member.currentHP ?? member.hp ?? 1) > 0) || context.runState?.party?.[0];
  if (!character) return 'No party comparison available.';
  const slot = item.category === 'armor' ? 'armor' : 'weapon';
  const before = deriveStats(character, classDataFor(context.data || {}, character), resolveLoadout(character, context.data?.equipment, context.data?.affixes));
  const afterChar = { ...character, equipment: { ...(character.equipment || {}), [slot]: item } };
  const after = deriveStats(afterChar, classDataFor(context.data || {}, character), resolveLoadout(afterChar, context.data?.equipment, context.data?.affixes));
  const delta = (key) => (after[key] ?? 0) - (before[key] ?? 0);
  const sign = (value) => value >= 0 ? `+${value}` : String(value);
  return `${SLOT_LABELS[slot]} compare · DEF ${before.defenseBase}→${after.defenseBase} (${sign(delta('defenseBase'))}) · CHARGE ${before.chargeMax}→${after.chargeMax} (${sign(delta('chargeMax'))})`;
}

function markOpened(runState, container) {
  if (runState?.markContainerOpened?.(container.id)?.marked) return true;
  if (!Number.isInteger(container?.id)) return false;
  runState.openedContainers = BigInt(runState.openedContainers ?? 0n) | (1n << BigInt(container.id));
  return true;
}

function log(context, type, message, entry = {}) {
  context.bus?.dispatch('ui:log-entry', { type, message, entry, sequence: Date.now(), timestamp: Date.now() });
}

// SESSION-02 (direct-actions-and-quick-starts) — the durable pickup result
// surfaced above CONTENTS. Distinct copy for an emptied container so the
// player can tell a full take apart from one that just closed the source.
function pickupNoticeText(result) {
  const inventory = `INVENTORY ${result.inventoryCount}/${result.inventoryCapacity}`;
  return result.containerCleared
    ? `CONTAINER CLEARED — ${result.itemName} secured · ${inventory}`
    : `LOOT ACQUIRED — ${result.itemName} · ${inventory}`;
}

function takeItem(context, container, itemId) {
  const state = stateFor(context.runState);
  const items = itemsFor(context, container);
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return false;
  const result = addItem(context.runState.inventory || [], item);
  if (!result.success) {
    state.error = result.reason === 'inventory_full' ? 'Inventory full; pickup blocked until space is freed.' : result.reason;
    state.pickupResult = null;
    context.refresh?.();
    return false;
  }
  context.runState.inventory = result.inventory;
  const remaining = items.filter((entry) => entry.id !== itemId);
  state.containers.set(containerKey(context, container), remaining);
  if (context.lootState) context.lootState.items = remaining;
  if (!remaining.length) markOpened(context.runState, container);
  state.error = '';
  // Presentation state is only set after the mutation above succeeds — a
  // failed take never reaches here, so it can never report a false
  // acquisition.
  state.pickupResult = {
    kind: 'taken',
    itemName: itemName(item, context.data || {}),
    inventoryCount: getInventoryCount(result.inventory),
    inventoryCapacity: INVENTORY_CAP,
    containerCleared: !remaining.length
  };
  log(context, 'loot', pickupNoticeText(state.pickupResult), { itemId, containerId: container.id });
  context.bus?.dispatch('state:loot-taken', { runState: context.runState, itemId, containerId: container.id, containerClosed: !remaining.length });
  context.refresh?.();
  return true;
}

function requestJunkToggle(context, itemId) {
  const state = stateFor(context.runState);
  const source = (context.runState.inventory || []).find((entry) => entry.id === itemId);
  const result = toggleJunkTag(context.runState.inventory || [], itemId);
  if (!result.success) {
    state.error = result.reason || 'missing_item';
    state.notice = '';
  } else {
    context.runState.inventory = result.inventory;
    state.error = '';
    state.notice = `${itemName(source, context.data || {})} ${result.junkTagged ? 'tagged as junk' : 'untagged'}.`;
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
    state.pendingJunkAll = true;
    state.error = '';
    state.notice = `Confirm permanent junking of ${tagged.length} item(s) for ${tagged.reduce((sum, item) => sum + getSalvageValue(item), 0)} scrap.`;
    context.refresh?.();
    return false;
  }
  const result = junkAllTagged(context.runState.inventory || []);
  context.runState.inventory = result.inventory;
  context.runState.addScrap?.(result.scrapGained) || (context.runState.scrapCounter = (context.runState.scrapCounter || 0) + result.scrapGained);
  state.pendingJunkAll = false;
  state.error = '';
  state.notice = `Junked ${result.destroyedUnits} unit(s): +${result.scrapGained} scrap.`;
  log(context, 'loot', state.notice, { destroyedIds: result.destroyedIds, scrapGained: result.scrapGained });
  context.refresh?.();
  return true;
}

function renderContainerItems(container, context, lootContainer, items) {
  const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
  const list = createScrollArea({ label: 'Container contents', focusable: true });
  list.className = 'loot-items scroll-area';
  list.dataset.testid = 'loot-items';
  if (!items.length) list.appendChild(text('loot-container empty console-static-row', isOpened(context.runState, lootContainer) ? 'Empty.' : 'Empty container.'));
  const cleanups = [];
  const inventoryFull = getInventoryCount(context.runState?.inventory || []) >= INVENTORY_CAP;
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'loot-item-row item-card console-row';
    row.dataset.testid = `loot-item-${item.id}`;
    row.appendChild(createEquipmentCard(displayItem(item, context.data || {}), { stats: itemStats(item, context.data || {}), compact: true }));
    if (item.rarity) {
      const rarityRow = document.createElement('div');
      rarityRow.className = 'card-rarity-row console-static-row';
      const rarityLink = createRarityTag(item.rarity, {
        manualLink: { source: 'loot-rarity', dispatch }
      });
      rarityLink.dataset.testid = `loot-rarity-link-${item.id}`;
      rarityRow.appendChild(rarityLink);
      row.appendChild(rarityRow);
    }
    const classesRow = document.createElement('div');
    classesRow.className = 'card-classes console-static-row';
    const classNames = classesUsableFor(item, context.data || {});
    classesRow.textContent = classNames.length
      ? `Classes: ${classNames.join(' · ')}`
      : 'Classes: none';
    classesRow.dataset.testid = `loot-classes-${item.id}`;
    row.appendChild(classesRow);
    row.appendChild(text('loot-compare console-static-row', comparisonLine(item, context), `loot-compare-${item.id}`));
    const result = addItem(context.runState?.inventory || [], item);
    const reason = inventoryFull || !result.success ? 'Inventory full; pickup blocked until space is freed.' : '';
    // SESSION-05 (icon-first-ui-density) — per GAP §3.7 the ENABLED TAKE row
    // goes icon-only with a download sprite (accent tone); disabled path keeps
    // the "TAKE BLOCKED" text so the reason chip reads clearly. aria-label
    // preserves the former visible label verbatim and names the item so the
    // affordance is not ambiguous when read out.
    const take = createButton(reason ? 'TAKE BLOCKED' : '', {
      primary: true, disabled: Boolean(reason), description: reason,
      onClick: () => takeItem(context, lootContainer, item.id),
      icon: 'download', iconSize: 14,
      iconTone: reason ? undefined : 'accent',
      label: reason ? undefined : `Take ${itemName(item, context.data || {})}`
    });
    take.dataset.testid = `loot-take-${item.id}`;
    row.appendChild(take);
    // Double-activate = TAKE (double-click / double-tap), augmenting the explicit
    // button so confirming a pickup needs no second control. Skipped when TAKE is
    // blocked (inventory full) so the inert affordance stays honest.
    if (!reason) cleanups.push(attachDoubleActivate(row, () => takeItem(context, lootContainer, item.id)));
    list.appendChild(row);
  }
  list.cleanup = () => cleanups.forEach((fn) => fn());
  container.appendChild(list);
}

function renderInventoryJunk(container, context, state) {
  const inventory = context.runState?.inventory || [];
  const tagged = inventory.filter((item) => item.junkTagged);
  // Only a non-empty pack is worth collapsing; an empty inventory stays inline so its
  // "nothing to salvage" state reads normally.
  const collapsible = inventory.length > 0;
  const open = collapsible ? Boolean(state.inventoryOpen) : true;

  container.appendChild(text('mode-indicator', '◈ INVENTORY', 'loot-inventory-heading'));
  const header = document.createElement('div');
  header.className = 'loot-inventory-header console-static-row';
  header.dataset.testid = 'loot-inventory-header';
  header.textContent = `Inventory ${getInventoryCount(inventory)}/${INVENTORY_CAP} · Scrap ${context.runState?.scrapCounter || 0} · Tagged ${tagged.length} / ${tagged.reduce((sum, item) => sum + getSalvageValue(item), 0)}`;
  container.appendChild(header);

  if (collapsible) {
    // SESSION-05 (icon-first-ui-density) — per GAP §3.7 the toggle goes
    // icon-only: chevron-down when the panel is open, chevron-right when it
    // is closed. Numeric count moves to an adjacent chip so the icon-only
    // button stays a single glyph. aria-label preserves the former visible
    // label form (`▾ MANAGE JUNK · N` / `▸ MANAGE JUNK · N`) verbatim so
    // screen readers still hear the count and the open/close intent.
    const toggleAria = `${open ? '▾' : '▸'} MANAGE JUNK · ${inventory.length}`;
    const toggle = createButton('', {
      label: toggleAria,
      icon: open ? 'chevron-down' : 'chevron-right',
      iconSize: 14, iconTone: 'dim',
      onClick: () => { state.inventoryOpen = !open; context.refresh?.(); }
    });
    // classList.add preserves createButton's .icon-only marker. Reassigning
    // className would wipe it (Issue G guard, src/ui/console/move.js:80).
    toggle.classList.add('loot-inventory-toggle', 'console-row');
    toggle.dataset.testid = 'loot-inventory-toggle';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-controls', 'loot-inventory-body');
    // The count IS content — render it as an adjacent chip.
    const count = document.createElement('span');
    count.className = 'loot-inventory-toggle-count';
    count.textContent = String(inventory.length);
    toggle.appendChild(count);
    container.appendChild(toggle);
  }

  // The junk list + JUNK ALL stay in the DOM even when collapsed (hidden via
  // .is-collapsed) so tag/junk and the canvas-confirm path keep working without an
  // expand step, and the SESSION-06 icon-coverage tests still find the buttons.
  const body = document.createElement('div');
  body.className = `loot-inventory-body${open ? '' : ' is-collapsed'}`;
  body.id = 'loot-inventory-body';
  body.dataset.testid = 'loot-inventory-body';
  const inv = document.createElement('div');
  inv.className = 'loot-junk-list';
  inv.dataset.testid = 'loot-junk-list';
  for (const item of inventory) {
    const button = createButton(`${item.junkTagged ? 'UNTAG' : 'TAG'} ${itemName(item, context.data || {})}`, {
      onClick: () => requestJunkToggle(context, item.id),
      icon: 'recycle', iconSize: 14
    });
    button.dataset.testid = `loot-junk-${item.id}`;
    inv.appendChild(button);
  }
  body.appendChild(inv);
  const junkAll = createButton(state.pendingJunkAll ? 'CONFIRM JUNK ALL TAGGED' : 'JUNK ALL TAGGED', {
    danger: true, disabled: !tagged.length,
    onClick: () => requestJunkAll(context),
    icon: 'recycle', iconSize: 14
  });
  junkAll.dataset.testid = 'loot-junk-all';
  body.appendChild(junkAll);
  container.appendChild(body);
}

export function render(container, context = {}) {
  clear(container);
  const runState = context.runState;
  const state = runState ? stateFor(runState) : { notice: '', error: '', pendingJunkAll: false };
  const lootState = context.lootState || (context.lattice ? { container: findEligibleLootContainer(context.lattice, runState), items: [] } : null);
  const lootContainer = lootState?.container;
  if (!runState || !lootContainer) {
    container.appendChild(text('loot-container empty console-static-row', 'No unopened container adjacent or underfoot.', 'loot-empty'));
    if (runState) renderInventoryJunk(container, context, state);
    return;
  }

  const opened = isOpened(runState, lootContainer);
  const items = opened ? [] : itemsFor({ ...context, lootState }, lootContainer);
  const header = document.createElement('div');
  header.className = 'loot-container-header panel-elevated console-static-row';
  header.dataset.testid = 'loot-container';
  const glyph = document.createElement('span');
  glyph.className = context.layout === 'wide' ? 'container-icon container-icon-lg' : 'container-icon';
  glyph.textContent = lootContainer.kind === 'vault' ? '◈' : '▣';
  header.appendChild(glyph);
  // Lucide icon lands AFTER the glyph so tests treating header.children[0]
  // as the glyph continue to hold. SESSION-06 spec: box for standard,
  // archive for vault.
  const kindIcon = safeIcon(lootContainer.kind === 'vault' ? 'archive' : 'box', { size: 16, tone: 'dim' });
  if (kindIcon) header.appendChild(kindIcon);
  header.appendChild(document.createTextNode(` CONTAINER ${lootContainer.id} · ${lootContainer.kind || 'standard'} · ${opened ? 'OPENED' : 'UNOPENED'} · ${items.length} item(s)`));
  container.appendChild(header);
  // SESSION-05 (icon-first-ui-density) — per GAP §3.7 OPEN CONTAINER is
  // icon-only when enabled (chevron-right, accent). Disabled → keep the
  // OPENED text since the state IS the label.
  const openButton = createButton(opened ? 'OPENED' : '', {
    primary: true,
    disabled: opened,
    onClick: () => context.bus?.dispatch('loot:open-request', { runState, floor: context.floor, container: lootContainer }),
    icon: 'chevron-right', iconSize: 14,
    iconTone: opened ? undefined : 'accent',
    label: opened ? undefined : 'Open container'
  });
  openButton.dataset.testid = 'loot-open';
  container.appendChild(openButton);
  container.appendChild(text('mode-indicator', '◈ CONTENTS', 'loot-contents-heading'));
  if (getInventoryCount(runState.inventory || []) >= INVENTORY_CAP) {
    const dispatch = (event, payload) => context.bus?.dispatch(event, payload);
    const warning = text('loot-warning console-static-row', 'Inventory full; pickup blocked until space is freed.', 'loot-cap-warning');
    warning.appendChild(createManualLink('loot_and_salvage', {
      variant: 'chip', source: 'loot-cap', dispatch, testid: 'loot-cap-link'
    }));
    container.appendChild(warning);
  }
  renderContainerItems(container, { ...context, lootState }, lootContainer, items);
  renderInventoryJunk(container, context, state);
  if (state.notice) container.appendChild(text('loot-notice console-static-row', state.notice, 'loot-notice'));
  if (state.error) container.appendChild(text('loot-error console-static-row', state.error, 'loot-error'));
}

export function handleInput(event, context = {}) {
  if (event.action !== 'confirm') return null;
  const lootContainer = context.lootState?.container || findEligibleLootContainer(context.lattice, context.runState);
  if (!lootContainer) return false;
  const items = itemsFor(context, lootContainer);
  if (!items.length) return false;
  return takeItem(context, lootContainer, items[0].id);
}
