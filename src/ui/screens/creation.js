import { createAttributeRow, createButton, createPanel, createScreenBody, createScrollArea, createSigilToken, createTextInput } from '../components.js';
import { createInputHandler } from '../input.js';
import { bus } from '../../state/bus.js';
import { gameData as compatibilityData } from '../../main.js';
import { ATTRIBUTE_KEYS } from '../../rules/attributes.js';
import { deckSlotCost } from '../../rules/protocols.js';
import { createRNGCursorForRun } from '../../core/rng-cursor.js';
import { generateFloor } from '../../floor/generator.js';
import { validateFloor } from '../../floor/validator.js';
import { createRunState } from '../../state/run-state.js';
import { saveRun } from '../../state/library.js';
import { decodeSeed } from '../../state/save-decode.js';
import { playBootSequence } from '../../glitch/transitions.js';
import { blueprintFromDraft, deleteConfig, getLastUsed, listConfigs, loadConfig, saveConfig, setLastUsed, validateConfig } from '../../state/party-configs.js';
import { applyCreationAction, createCreationDraft, selectCreationState } from '../creation-model.js';

const ATTR_LABELS = { mgt: 'MGT', fin: 'FIN', vit: 'VIT', res: 'RES', foc: 'FOC', sig: 'SIG' };
const TABS = [
  ['class', 'CLASS'], ['sigil', 'SIGIL'], ['attrs', 'ATTRS'], ['gear', 'GEAR'], ['tech', 'TECH'], ['blueprints', 'BLUEPRINTS']
];
const SAVE_NAME_MAX = 80;

function clear(element) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else while (element.firstChild) element.removeChild(element.firstChild);
}

function text(tagName, className, value) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function getData(params) {
  return params.data || compatibilityData;
}

function seedFromParams(params) {
  const value = params.preloadedSeed;
  if (Number.isInteger(value)) return value >>> 0;
  if (typeof value === 'string' && value.trim()) {
    const decoded = decodeSeed(value.replace(/^#?w=/, ''));
    if (decoded.success) return decoded.seed >>> 0;
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed >>> 0;
  }
  return (Math.random() * 0x100000000) >>> 0;
}

function classList(data) {
  return Array.isArray(data?.classes?.classes) ? data.classes.classes : [];
}


function selectedSummary(summary) {
  return summary.characters[summary.activeSlot] ?? summary.characters[0] ?? null;
}


function flattenProtocols(data) {
  return Object.entries(data?.protocols?.schools ?? {}).flatMap(([school, schoolData]) =>
    (schoolData.tiers ?? []).map((entry) => ({ school, schoolName: schoolData.name, tier: entry.tier, entry }))
  );
}

function gearChoices(data, slot) {
  if (slot === 'armor') return Object.entries(data?.equipment?.armor ?? {}).map(([id, item]) => ({ id, item }));
  return Object.entries(data?.equipment?.weapons ?? {})
    .filter(([id, item]) => slot === 'offhand' ? item.slot === 'offhand' || id === 'sidearm' : item.slot === 'weapon')
    .map(([id, item]) => ({ id, item }));
}

function fieldErrors(validation, fieldPrefix) {
  return validation.errors.filter((error) => error.field === fieldPrefix || error.field.startsWith(`${fieldPrefix}.`));
}

function errorText(error) {
  const code = error?.code || error?.error || error?.field || 'invalid';
  return String(code).replace(/_/g, ' ');
}

function statusText(result) {
  if (!result) return '';
  return result.success ? result.message : `${result.error || result.reason || 'failed'}`;
}

function targetError(validation, code, field) {
  return validation.errors.find((error) => error.code === code && (!field || error.field === field));
}

function actionChangesDraft(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function validateChangedDraft(draft, action, data) {
  const result = applyCreationAction(draft, action, data);
  const summary = selectCreationState(result.draft, data);
  return { result, summary, changed: actionChangesDraft(draft, result.draft) };
}

function actionReason(draft, action, data) {
  const preview = validateChangedDraft(draft, action, data);
  if (preview.result.result.success === false) return preview.result.result.reason || 'invalid';
  if (preview.summary.validation.pointsSpent > 80) return 'point budget exceeded';
  return preview.changed ? '' : 'not allowed';
}

function shortBlueprintSummary(config) {
  const classes = (config.partyClasses ?? []).join('/') || 'blank';
  return `${config.characters?.length ?? 0} OP · ${classes} · ${config.pointsSpent ?? 0} PTS · ${config.credits ?? 0} CR`;
}


export function mount(container, params = {}) {
  const data = getData(params);
  const worldSeed = seedFromParams(params);
  const inputHandler = createInputHandler({ legacyActions: false });
  inputHandler.bindToElement(container);

  let draft = createCreationDraft();
  let activeTab = 'class';
  let saveName = '';
  let pendingOverwriteName = null;
  let pendingDeleteName = null;
  let notice = '';
  let finalizing = false;
  let finalized = false;

  const loadInitial = getLastUsed();
  if (loadInitial) {
    const validation = validateConfig(loadInitial, data);
    draft = applyCreationAction(draft, { type: 'load_blueprint', blueprint: loadInitial }, data).draft;
    saveName = loadInitial.name || '';
    notice = validation.valid ? `LOADED LAST USED — ${loadInitial.name}` : `LAST USED NEEDS REPAIR — ${validation.invalidItems.map((item) => item.field).join(', ')}`;
  }

  function dispatch(action) {
    const result = applyCreationAction(draft, action, data);
    draft = result.draft;
    pendingOverwriteName = null;
    notice = result.result.success === false ? errorText(result.result) : '';
    render();
  }

  function render() {
    const summary = selectCreationState(draft, data);
    clear(container);
    const root = document.createElement('main');
    root.className = 'creation-wrapper screen-container';
    root.dataset.testid = 'creation-root';
    root.appendChild(renderHeader(summary));
    root.appendChild(renderCharacterRail(summary));
    root.appendChild(renderTabs());
    const body = createScreenBody({ className: 'creation-body' });
    body.dataset.testid = 'creation-body';
    body.appendChild(renderActiveTab(summary));
    root.appendChild(body);
    root.appendChild(renderFooter(summary));
    container.appendChild(root);
  }

  function renderHeader(summary) {
    const header = document.createElement('section');
    header.className = 'creation-header';
    header.setAttribute('aria-label', 'Party creation summary');
    header.dataset.testid = 'summary';
    const remaining = readout('POINTS REMAINING', `${summary.pointsRemaining}/80`, 'remaining');
    const spent = text('span', 'creation-note', `SPENT ${summary.pointsSpent}/80`);
    spent.dataset.testid = 'spent';
    remaining.appendChild(spent);
    const credits = readout('CREDITS', String(summary.credits), 'credits');
    const seed = text('span', 'creation-note', `SEED ${worldSeed}`);
    seed.dataset.testid = 'seed';
    credits.appendChild(seed);
    const ap = readout('AP/ROUND', String(summary.actionsPerRound), 'ap');
    const partyCount = text('span', 'creation-note', `PARTY ${summary.characters.length}/4`);
    partyCount.dataset.testid = 'party-count';
    ap.appendChild(partyCount);
    header.append(remaining, credits, ap);
    return header;
  }

  function readout(label, value, id) {
    const item = document.createElement('div');
    item.className = 'creation-readout';
    item.dataset.testid = id;
    item.append(text('span', 'readout-label', label), text('strong', 'readout-value', value));
    return item;
  }

  function renderCharacterRail(summary) {
    const rail = document.createElement('section');
    rail.className = 'creation-char-bar';
    rail.setAttribute('aria-label', 'Party members');
    rail.dataset.testid = 'character-rail';
    for (let index = 0; index < 4; index++) {
      const character = summary.characters[index];
      const isSelected = Boolean(character) && index === summary.activeSlot;
      const className = character?.classData?.name || (character ? 'UNASSIGNED' : 'ADD');
      const slot = createButton('', {
        selected: isSelected,
        label: character ? `Select character ${index + 1}` : `Add character ${index + 1}`,
        disabled: !character && summary.characters.length >= 4,
        onClick: () => dispatch(character ? { type: 'select_character', slot: index } : { type: 'add_character' })
      });
      slot.classList.add('char-slot', 'panel');
      if (isSelected) slot.classList.add('active', 'panel-elevated');
      slot.dataset.testid = character ? `character-slot-${index}` : index === summary.characters.length ? 'add-character' : `empty-slot-${index}`;
      const marker = character?.sigil
        ? createSigilToken(character.sigil, 34, { role: 'player', label: `${className} sigil` })
        : text('span', 'sigil-placeholder small', character ? className.charAt(0) : '+');
      slot.append(marker, text('span', isSelected ? 'card-name accent-text' : 'card-name', className.toUpperCase()));
      rail.appendChild(slot);
    }
    const removeReason = summary.characters.length <= 1 ? 'minimum party size' : '';
    const remove = createButton('− REMOVE', {
      danger: true,
      disabled: Boolean(removeReason),
      description: removeReason || 'Remove selected character',
      onClick: () => dispatch({ type: 'remove_character' })
    });
    remove.dataset.testid = 'remove-character';
    remove.classList.add('remove-character-btn');
    rail.appendChild(remove);
    return rail;
  }

  function renderTabs() {
    const tablist = document.createElement('div');
    tablist.className = 'creation-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Creation editor sections');
    for (const [id, label] of TABS) {
      const tab = createButton(label, {
        selected: activeTab === id,
        onClick: () => { activeTab = id; render(); }
      });
      tab.className = `tab-btn${activeTab === id ? ' active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `creation-panel-${id}`);
      tab.setAttribute('aria-selected', String(activeTab === id));
      tab.dataset.testid = `tab-${id}`;
      tablist.appendChild(tab);
    }
    return tablist;
  }

  function renderActiveTab(summary) {
    const panel = createPanel({ title: TABS.find(([id]) => id === activeTab)?.[1] || 'EDITOR' });
    panel.classList.add('creation-detail');
    panel.id = `creation-panel-${activeTab}`;
    panel.setAttribute('role', 'tabpanel');
    panel.dataset.testid = `panel-${activeTab}`;
    if (!summary.characters.length && activeTab !== 'blueprints') {
      panel.appendChild(text('p', 'creation-warning', 'ADD A CHARACTER TO BEGIN.'));
      return panel;
    }
    if (activeTab === 'class') renderClassPicker(panel, summary);
    else if (activeTab === 'sigil') renderSigilPicker(panel, summary);
    else if (activeTab === 'attrs') renderAttributes(panel, summary);
    else if (activeTab === 'gear') renderGear(panel, summary);
    else if (activeTab === 'tech') renderProtocols(panel, summary);
    else renderBlueprints(panel);
    return panel;
  }

  function renderClassPicker(panel, summary) {
    const selected = selectedSummary(summary);
    const group = document.createElement('div');
    group.className = 'class-card-row';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Class selection');
    for (const cls of classList(data)) {
      const card = createButton('', {
        selected: selected.classId === cls.id,
        label: `Choose ${cls.name}`,
        onClick: () => dispatch({ type: 'set_class', classId: cls.id })
      });
      card.classList.add('class-card', 'console-row');
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(selected.classId === cls.id));
      card.dataset.testid = `class-${cls.id}`;
      const nameSpan = text('span', 'card-name accent-text', cls.name.toUpperCase());
      const subtitle = text('span', 'card-subtitle', `${ATTR_LABELS[cls.primaryAttribute] || ''} · Hit Die ${cls.hitDieBase || ''}`);
      const desc = text('span', 'card-detail', cls.signature?.tiers?.[0] || '');
      card.append(nameSpan, subtitle, desc);
      group.appendChild(card);
    }
    panel.appendChild(group);
  }

  function renderSigilPicker(panel, summary) {
    const selected = selectedSummary(summary);
    if (!selected?.classData) {
      panel.appendChild(text('p', 'creation-warning', 'ASSIGN A CLASS BEFORE SELECTING A SIGIL.'));
      return;
    }
    const family = data?.sigils?.playerBank?.families?.[selected.classData.sigilFamily]?.codepoints ?? [];
    const used = new Set(summary.characters.map((character, index) => index === summary.activeSlot ? null : character.sigil).filter(Number.isInteger));
    const group = document.createElement('div');
    group.className = 'sigil-picker-row';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', `${selected.classData.name} sigils`);
    for (const codepoint of family) {
      const unavailable = used.has(codepoint);
      const tokenButton = createButton('', {
        selected: selected.sigil === codepoint,
        disabled: unavailable,
        description: unavailable ? 'sigil already used by another character' : 'free class-family sigil',
        onClick: () => dispatch({ type: 'set_sigil', sigil: codepoint })
      });
      tokenButton.classList.add('sigil-choice', 'console-row');
      tokenButton.setAttribute('role', 'radio');
      tokenButton.setAttribute('aria-checked', String(selected.sigil === codepoint));
      tokenButton.setAttribute('aria-label', `Sigil ${codepoint.toString(16)}`);
      tokenButton.dataset.testid = `sigil-${codepoint.toString(16)}`;
      tokenButton.appendChild(createSigilToken(codepoint, 220, { role: 'player', label: `Sigil ${codepoint.toString(16)}` }));
      if (unavailable) tokenButton.appendChild(text('span', 'disabled-reason', 'USED'));
      group.appendChild(tokenButton);
    }
    panel.appendChild(group);
  }

  function renderAttributes(panel, summary) {
    const selected = selectedSummary(summary);
    const section = document.createElement('div');
    section.className = 'creation-section';
    for (const key of ATTRIBUTE_KEYS) {
      const rank = selected.attributes[key];
      const incPreview = validateChangedDraft(draft, { type: 'buy_attribute', attribute: key }, data);
      const decPreview = validateChangedDraft(draft, { type: 'refund_attribute', attribute: key }, data);
      const increaseReason = rank >= 10 ? 'maximum rank' : incPreview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : '';
      const decreaseReason = rank <= 1 ? 'minimum rank' : !decPreview.changed ? 'minimum rank' : '';
      const row = createAttributeRow(ATTR_LABELS[key], rank, {
        steppers: true,
        increaseDisabled: Boolean(increaseReason),
        decreaseDisabled: Boolean(decreaseReason),
        onIncrease: () => dispatch({ type: 'buy_attribute', attribute: key }),
        onDecrease: () => dispatch({ type: 'refund_attribute', attribute: key })
      });
      row.dataset.testid = `attribute-${key}`;
      if (increaseReason) row.appendChild(text('span', 'disabled-reason', `+ ${increaseReason}`));
      if (decreaseReason) row.appendChild(text('span', 'disabled-reason', `− ${decreaseReason}`));
      section.appendChild(row);
    }
    panel.appendChild(section);
  }

  function renderGear(panel, summary) {
    const selected = selectedSummary(summary);
    if (!selected?.classData) {
      panel.appendChild(text('p', 'creation-warning', 'ASSIGN A CLASS BEFORE BUYING EQUIPMENT.'));
      return;
    }
    const current = selected.equipment;
    for (const [slot, label] of [['weapon', 'WEAPON'], ['armor', 'ARMOR'], ['offhand', 'OFFHAND']]) {
      const group = document.createElement('div');
      group.className = 'creation-choice-grid';
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', label);
      group.appendChild(text('h3', 'section-header', label));
      const none = createButton(slot === 'armor' ? 'NO ARMOR' : 'NONE', {
        selected: current[slot] === null,
        onClick: () => dispatch({ type: 'unequip_gear', gearSlot: slot })
      });
      none.className = `equipment-card item-card console-row${current[slot] === null ? ' selected' : ''}`;
      none.setAttribute('role', 'radio');
      none.setAttribute('aria-checked', String(current[slot] === null));
      none.dataset.testid = `${slot}-none`;
      group.appendChild(none);
      for (const { id, item } of gearChoices(data, slot)) {
        const selectedItem = current[slot] === id;
        const preview = validateChangedDraft(draft, { type: 'equip_gear', gearSlot: slot, itemId: id }, data);
        const gated = !item.classGates?.includes(selected.classId);
        const reason = selectedItem ? '' : gated ? 'class gate' : preview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : !preview.changed ? 'slot gate' : '';
        const card = createButton(item.name || id, {
          selected: selectedItem,
          disabled: Boolean(reason),
          description: reason || `${item.creationCost ?? 0} creation points`,
          onClick: () => dispatch({ type: 'equip_gear', gearSlot: slot, itemId: id })
        });
        card.className = `equipment-card item-card console-row${selectedItem ? ' selected' : ''}`;
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', String(selectedItem));
        card.dataset.testid = `${slot}-${id}`;
        card.appendChild(text('span', 'card-detail', `${item.creationCost ?? 0} PTS · ${item.rangeBand ?? 'DEF'}${item.defenseBonus ? ` · DEF +${item.defenseBonus}` : ''}`));
        if (reason) card.appendChild(text('span', 'disabled-reason', reason.toUpperCase()));
        group.appendChild(card);
      }
      panel.appendChild(group);
    }
  }

  function renderProtocols(panel, summary) {
    const selected = selectedSummary(summary);
    if (!selected?.classData) {
      panel.appendChild(text('p', 'creation-warning', 'ASSIGN A CLASS BEFORE BUYING PROTOCOLS.'));
      return;
    }
    const deck = text('p', 'creation-note', `DECK ${selected.deck.slotsUsed}/${selected.deck.capacity}`);
    deck.dataset.testid = 'deck-summary';
    panel.appendChild(deck);
    const grid = document.createElement('div');
    grid.className = 'creation-choice-grid';
    for (const protocol of flattenProtocols(data)) {
      const isSelected = selected.protocols.some((entry) => entry.school === protocol.school && entry.tier === protocol.tier);
      const action = isSelected
        ? { type: 'remove_protocol', school: protocol.school, tier: protocol.tier }
        : { type: 'add_protocol', school: protocol.school, tier: protocol.tier };
      const preview = validateChangedDraft(draft, action, data);
      const gated = !selected.classData.protocolGates?.schools?.includes(protocol.school) || protocol.tier > selected.classData.protocolGates?.maxTier;
      const capacity = !isSelected && preview.summary.characters[summary.activeSlot]?.deck?.slotsUsed > selected.deck.capacity;
      const reason = gated ? 'class gate' : capacity ? 'deck capacity' : preview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : '';
      const pointDelta = Math.max(0, preview.summary.pointsSpent - summary.pointsSpent);
      const card = createButton(`${protocol.entry.name}`, {
        selected: isSelected,
        disabled: Boolean(reason),
        description: reason || `${pointDelta} creation points, ${protocol.entry.chargeCost} charge`,
        onClick: () => dispatch(action)
      });
      card.className = `protocol-card action-btn console-row${isSelected ? ' selected' : ''}`;
      card.dataset.testid = `protocol-${protocol.school}-${protocol.tier}`;
      card.appendChild(text('span', 'action-cost', `${protocol.schoolName} T${protocol.tier} · ${pointDelta} PTS · ${protocol.entry.chargeCost} CHG · ${deckSlotCost(protocol.tier)} DECK`));
      if (reason) card.appendChild(text('span', 'disabled-reason', reason.toUpperCase()));
      grid.appendChild(card);
    }
    panel.appendChild(grid);
  }

  function renderBlueprints(panel) {
    const controls = document.createElement('div');
    controls.className = 'blueprint-controls';
    const input = createTextInput('CONFIG NAME', saveName, (value) => {
      saveName = value.slice(0, SAVE_NAME_MAX);
      pendingOverwriteName = null;
    }, { className: 'config-name-input' });
    input.dataset.testid = 'config-name-row';
    controls.appendChild(input);
    const saveButton = createButton(pendingOverwriteName === saveName.trim() ? 'CONFIRM OVERWRITE' : 'SAVE CONFIG', {
      disabled: draft.characters.length === 0,
      onClick: saveBlueprint
    });
    saveButton.dataset.testid = 'save-config';
    controls.appendChild(saveButton);
    panel.appendChild(controls);

    const configs = listConfigs().slice(0, 10);
    const scroll = createScrollArea({ label: 'Saved party configurations', focusable: true });
    scroll.classList.add('blueprint-list');
    scroll.dataset.testid = 'config-list';
    if (!configs.length) scroll.appendChild(text('p', 'creation-note', 'NO SAVED CONFIGS.'));
    for (const config of configs) {
      const validation = validateConfig(config, data);
      const row = document.createElement('article');
      row.className = `config-row console-row${validation.valid ? '' : ' invalid'}`;
      row.dataset.testid = `config-${config.name}`;
      row.append(text('strong', 'config-name', config.name), text('span', 'config-summary', shortBlueprintSummary(config)));
      if (!validation.valid) {
        const issues = text('span', 'creation-error', `REPAIR: ${validation.invalidItems.map((item) => item.field).join(', ')}`);
        issues.id = `config-${config.name}-errors`;
        row.appendChild(issues);
      }
      row.appendChild(createButton('LOAD', {
        describedBy: validation.valid ? undefined : `config-${config.name}-errors`,
        error: !validation.valid,
        onClick: () => loadBlueprint(config.name)
      }));
      row.appendChild(createButton(pendingDeleteName === config.name ? 'CONFIRM DELETE' : 'DELETE', {
        danger: true,
        onClick: () => confirmDelete(config.name)
      }));
      scroll.appendChild(row);
    }
    panel.appendChild(scroll);
    if (notice) panel.appendChild(text('p', notice.startsWith('LOADED') ? 'creation-note' : 'creation-error', notice));
  }

  function renderFooter(summary) {
    const footer = document.createElement('section');
    footer.className = 'creation-actions';
    footer.dataset.testid = 'creation-actions';
    const backButton = createButton('◀ BACK', {
      onClick: () => bus.dispatch('ui:navigate', { screen: 'title' })
    });
    backButton.dataset.testid = 'back';
    backButton.classList.add('footer-back-btn');
    footer.appendChild(backButton);
    const errors = summary.validation.errors;
    const errorBox = document.createElement('div');
    errorBox.className = errors.length ? 'creation-error' : 'creation-note';
    errorBox.id = 'creation-errors';
    errorBox.dataset.testid = 'validation-errors';
    errorBox.textContent = errors.length ? errors.map(errorText).join(' · ') : 'VALID BUILDS FINALIZE ONCE.';
    footer.appendChild(errorBox);
    const finalizeButton = createButton(finalizing ? 'BOOTING…' : finalized ? 'FINALIZED' : 'FINALIZE & DESCEND', {
      primary: true,
      busy: finalizing,
      disabled: finalizing || finalized || !summary.validation.valid,
      describedBy: 'creation-errors',
      onClick: finalize
    });
    finalizeButton.dataset.testid = 'finalize';
    finalizeButton.classList.add('finalize-btn');
    footer.appendChild(finalizeButton);
    if (notice && activeTab !== 'blueprints') footer.appendChild(text('p', notice.startsWith('LOADED') ? 'creation-note' : 'creation-error', notice));
    const selected = selectedSummary(summary);
    if (selected) {
      const selectedErrors = fieldErrors(summary.validation, `characters.${summary.activeSlot}`);
      if (selectedErrors.length) footer.appendChild(text('p', 'creation-error', `SELECTED: ${selectedErrors.map(errorText).join(' · ')}`));
      if (targetError(summary.validation, 'point_budget')) footer.appendChild(text('p', 'creation-error', 'POINT BUDGET EXCEEDED. REFUND PURCHASES BEFORE FINALIZING.'));
    }
    return footer;
  }

  function saveBlueprint() {
    const name = saveName.trim();
    if (!name) {
      notice = 'SAVE FAILED — invalid_config';
      render();
      return;
    }
    const blueprint = blueprintFromDraft(draft, data, name);
    if (!blueprint || blueprint.pointsSpent > 80) {
      notice = 'SAVE FAILED — point_budget';
      render();
      return;
    }
    const result = saveConfig(name, blueprint, { overwrite: pendingOverwriteName === name });
    if (result.requiresConfirmation) {
      pendingOverwriteName = name;
      notice = `CONFIRM OVERWRITE — ${name}`;
    } else if (result.success) {
      pendingOverwriteName = null;
      setLastUsed(name);
      notice = `SAVED CONFIG — ${name}`;
    } else {
      notice = `SAVE FAILED — ${statusText(result)}`;
    }
    render();
  }

  function loadBlueprint(name) {
    const config = loadConfig(name);
    if (!config) {
      notice = `LOAD FAILED — ${name}`;
      render();
      return;
    }
    const validation = validateConfig(config, data);
    draft = applyCreationAction(draft, { type: 'load_blueprint', blueprint: config }, data).draft;
    saveName = config.name;
    pendingOverwriteName = null;
    pendingDeleteName = null;
    setLastUsed(config.name);
    notice = validation.valid ? `LOADED CONFIG — ${config.name}` : `CONFIG NEEDS REPAIR — ${validation.invalidItems.map((item) => item.field).join(', ')}`;
    render();
  }

  function confirmDelete(name) {
    if (pendingDeleteName !== name) {
      pendingDeleteName = name;
      notice = `CONFIRM DELETE — ${name}`;
      render();
      return;
    }
    const result = deleteConfig(name);
    pendingDeleteName = null;
    notice = result.success ? `DELETED CONFIG — ${name}` : `DELETE FAILED — ${statusText(result)}`;
    render();
  }

  async function finalize() {
    if (finalizing || finalized) return;
    const summary = selectCreationState(draft, data);
    if (!summary.validation.valid) {
      notice = 'FINALIZE FAILED — invalid_draft';
      render();
      return;
    }
    finalizing = true;
    render();
    try {
      const ids = summary.characters.map((character, index) => `${character.classId}-${index + 1}`);
      const result = applyCreationAction(draft, { type: 'finalize', options: { characterIds: ids, blueprintName: saveName.trim() || summary.originalBlueprint?.name || 'last finalized' } }, data);
      if (!result.result.success) throw new Error(`RUN STATE FAILED — ${result.result.reason || 'invalid_draft'}`);
      const finalizedDraft = result.draft;
      const rngCursor = createRNGCursorForRun(worldSeed);
      const floor = generateFloor(worldSeed, 1, { themesSeen: [], echoSpawns: [] }, data.themes);
      const floorValidation = validateFloor(floor);
      if (!floorValidation.valid) throw new Error(`GENERATION FAILED — ${floorValidation.failures?.join(', ') || 'invalid_floor'}`);
      const runState = createRunState(worldSeed, result.result.party, {
        credits: result.result.credits,
        rngState: rngCursor.getState(),
        floorSubSeed: floor.floorSubSeed ?? 0,
        partyPosition: floor.entryPoint,
        themesSeen: floor.themeId ? [floor.themeId] : [],
        extensions: { floorThemeId: floor.themeId }
      });
      if (!runState) throw new Error('RUN STATE FAILED — invalid_run_state');
      const theme = data?.themes?.themes?.find((entry) => entry.id === floor.themeId);
      const saved = saveRun(runState, { themeId: floor.themeId, theme: floor.themeId, accentSwatch: theme?.accentColor });
      if (!saved.success) throw new Error(`SAVE FAILED — ${saved.error || saved.reason || 'storage_failed'}`);
      const lastUsed = setLastUsed(result.result.blueprint);
      if (!lastUsed.success) throw new Error(`BLUEPRINT FAILED — ${lastUsed.error || 'storage_failed'}`);
      await playBootSequence(container, params.settings || params.motionSettings || {});
      draft = finalizedDraft;
      finalized = true;
      bus.dispatch('ui:navigate', { screen: 'exploration', params: { runState, floor, creation: { saveKey: saved.key, pointsSpent: result.result.pointsSpent, credits: result.result.credits } } });
    } catch (error) {
      finalizing = false;
      notice = error?.message || 'FINALIZE FAILED — unknown';
      render();
    }
  }

  render();

  return {
    unmount() { inputHandler.destroy(); }
  };
}
