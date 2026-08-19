import { createAttributeRow, createButton, createManualLink, createPanel, createScreenBody, createScrollArea, createSigilToken, createTextInput } from '../components.js';
import { createInputHandler } from '../input.js';
import { currentLayoutClass } from '../layout.js';
import { bus } from '../../state/bus.js';
import { gameData as compatibilityData } from '../../main.js';
import { ATTRIBUTE_KEYS, modifier } from '../../rules/attributes.js';
import { describeItemStats } from '../../rules/equipment.js';
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
import { captureScroll, restoreScroll } from '../scroll-memory.js';

const SCROLL_KEY = 'creation:editor';

const ATTR_LABELS = { mgt: 'MGT', fin: 'FIN', vit: 'VIT', res: 'RES', foc: 'FOC', sig: 'SIG' };
const ATTR_NAMES = { mgt: 'MIGHT', fin: 'FINESSE', vit: 'VITALITY', res: 'RESONANCE', foc: 'FOCUS', sig: 'SIGNAL' };
const TABS = [
  ['class', 'CLASS'], ['sigil', 'SIGIL'], ['attrs', 'ATTRS'], ['gear', 'GEAR'], ['tech', 'TECH'], ['blueprints', 'BLUEPRINTS']
];
const SAVE_NAME_MAX = 80;

const manualDispatch = (event, payload) => bus.dispatch(event, payload);
function manualLink(target, opts = {}) {
  return createManualLink(target, { source: 'creation', dispatch: manualDispatch, ...opts });
}

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

function errorText(error) {
  const code = error?.code || error?.error || error?.field || 'invalid';
  return String(code).replace(/_/g, ' ');
}

function statusText(result) {
  if (!result) return '';
  return result.success ? result.message : `${result.error || result.reason || 'failed'}`;
}

function actionChangesDraft(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function validateChangedDraft(draft, action, data) {
  const result = applyCreationAction(draft, action, data);
  const summary = selectCreationState(result.draft, data);
  return { result, summary, changed: actionChangesDraft(draft, result.draft) };
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
  let scrollPane = null;
  const warnedEmptyLists = new Set();

  function legalGearChoices(slot, classId) {
    return gearChoices(data, slot).filter(({ item }) => item.classGates?.includes(classId));
  }

  function legalProtocolChoices(classData) {
    const gate = classData?.protocolGates;
    return flattenProtocols(data).filter((protocol) => gate?.schools?.includes(protocol.school) && protocol.tier <= (gate?.maxTier ?? 0));
  }

  function gearStatChips(slot, id) {
    return describeItemStats(
      { category: slot === 'armor' ? 'armor' : 'weapon', baseType: id, affixes: [] },
      { equipmentData: data.equipment, affixesData: data.affixes }
    );
  }

  function statChipSuffix(chips) {
    return chips.length ? ` · ${chips.slice(0, 2).join(' · ')}` : '';
  }

  function emptyListNote(key, message) {
    if (!warnedEmptyLists.has(key)) {
      warnedEmptyLists.add(key);
      console.warn(`creation-screen: no class-legal options for ${key}`);
    }
    return text('p', 'creation-warning', message);
  }

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
    captureScroll(scrollPane, SCROLL_KEY);
    const summary = selectCreationState(draft, data);
    clear(container);
    scrollPane = null;
    if (currentLayoutClass() === 'wide') renderWide(summary);
    else renderPortrait(summary);
    restoreScroll(scrollPane, SCROLL_KEY);
  }

  function renderPortrait(summary) {
    const root = document.createElement('main');
    root.className = 'creation-wrapper screen-container';
    root.style.gap = '0';
    root.style.padding = '0';
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
    scrollPane = body;
  }

  function renderWide(summary) {
    const shell = document.createElement('div');
    shell.className = 'wide-creation-shell';
    shell.dataset.wideRoot = '';
    shell.dataset.testid = 'creation-root';

    const left = document.createElement('aside');
    left.className = 'wide-creation-left';
    left.dataset.testid = 'wide-creation-left';
    left.setAttribute('aria-label', 'Party roster and saved configurations');
    left.append(
      renderWideReadout(summary),
      manualLink('character_creation', { variant: 'chip' }),
      renderWideRoster(summary),
      renderWideSavedConfigs(summary)
    );

    const right = document.createElement('section');
    right.className = 'wide-creation-right';
    right.dataset.testid = 'wide-creation-right';
    right.setAttribute('aria-label', 'Editor');
    const editor = document.createElement('div');
    editor.className = 'wide-editor scroll-area';
    editor.dataset.testid = 'wide-editor';
    if (!summary.characters.length) {
      const empty = text('p', 'creation-warning', 'ADD A CHARACTER TO BEGIN.');
      empty.dataset.testid = 'wide-editor-empty';
      editor.appendChild(empty);
    } else {
      editor.appendChild(renderWideClassSection(summary));
      editor.appendChild(renderWideSigilSection(summary));
      editor.appendChild(renderWideAttrsSection(summary));
      editor.appendChild(renderWideGearSection(summary));
      editor.appendChild(renderWideTechSection(summary));
    }
    right.appendChild(editor);

    shell.append(left, right, renderWideFooter(summary));
    container.appendChild(shell);
    scrollPane = editor;
  }

  function renderWideReadout(summary) {
    const readout = document.createElement('div');
    readout.className = 'wide-readout';
    readout.dataset.testid = 'wide-readout';
    readout.append(
      wideReadoutCell('POINTS REMAINING', String(summary.pointsRemaining), '/80', 'remaining'),
      wideReadoutCell('CREDITS', String(summary.credits), null, 'credits'),
      wideReadoutCell('AP/ROUND', String(summary.actionsPerRound), null, 'ap')
    );
    return readout;
  }

  function wideReadoutCell(labelText, valueText, denomText, id) {
    const cell = document.createElement('div');
    cell.className = 'wide-readout-cell';
    cell.dataset.testid = id;
    cell.appendChild(text('span', 'label', labelText));
    const value = document.createElement('span');
    value.className = valueText === '0' ? 'value dim' : 'value';
    value.textContent = valueText;
    if (denomText) value.appendChild(text('span', 'denom', denomText));
    cell.appendChild(value);
    return cell;
  }

  function renderWideRoster(summary) {
    const section = document.createElement('div');
    section.className = 'wide-roster';
    section.dataset.testid = 'wide-roster';
    section.appendChild(text('div', 'wide-roster-heading', '◈ ROSTER · 4 MAX'));
    const row = document.createElement('div');
    row.className = 'wide-roster-row';
    for (let index = 0; index < 4; index++) row.appendChild(renderWideRosterSlot(summary, index));
    section.appendChild(row);
    const removeReason = summary.characters.length <= 1 ? 'minimum party size' : '';
    const remove = createButton('− REMOVE', {
      danger: true,
      disabled: Boolean(removeReason),
      description: removeReason || 'Remove selected character',
      onClick: () => dispatch({ type: 'remove_character' })
    });
    remove.dataset.testid = 'remove-character';
    remove.classList.add('remove-character-btn');
    remove.style.marginTop = '8px';
    remove.style.alignSelf = 'flex-start';
    section.appendChild(remove);
    return section;
  }

  function renderWideRosterSlot(summary, index) {
    const character = summary.characters[index];
    const isSelected = Boolean(character) && index === summary.activeSlot;
    const isNextAdd = !character && index === summary.characters.length;
    const partyFull = summary.characters.length >= 4;
    const className = character?.classData?.name || (character ? 'UNASSIGNED' : (isNextAdd ? 'ADD' : 'EMPTY'));
    const slot = createButton('', {
      selected: isSelected,
      label: character ? `Select character ${index + 1}` : `Add character ${index + 1}`,
      disabled: !character && (partyFull || !isNextAdd),
      onClick: () => dispatch(character ? { type: 'select_character', slot: index } : { type: 'add_character' })
    });
    slot.className = 'char-slot' + (isSelected ? ' active' : '');
    slot.dataset.testid = character ? `character-slot-${index}` : (isNextAdd ? 'add-character' : `empty-slot-${index}`);
    const glyph = character?.sigil
      ? createSigilToken(character.sigil, 34, { role: 'player', label: `${className} sigil` })
      : text('span', 'sigil-option', isNextAdd ? '+' : '?');
    const labelSpan = text('span', character ? 'label' : 'label dim', className.toUpperCase());
    slot.append(glyph, labelSpan);
    return slot;
  }

  function renderWideSavedConfigs(summary) {
    const section = document.createElement('div');
    section.className = 'wide-saved-configs';
    section.dataset.testid = 'wide-saved-configs';
    section.appendChild(text('div', 'wide-saved-configs-heading', '◈ SAVED CONFIGURATIONS (FR-51)'));
    const list = document.createElement('div');
    list.className = 'wide-saved-configs-list';
    const configs = listConfigs().slice(0, 10);
    for (const config of configs) {
      const validation = validateConfig(config, data);
      const meta = shortBlueprintSummary(config);
      const card = createButton('', {
        description: validation.valid ? meta : 'configuration needs repair',
        error: !validation.valid,
        onClick: () => loadBlueprint(config.name)
      });
      card.className = 'config-card' + (saveName === config.name ? ' active' : '') + (validation.valid ? '' : ' invalid');
      card.dataset.testid = `wide-saved-config-${config.name}`;
      card.append(text('div', 'name', config.name), text('div', 'meta', validation.valid ? meta : `REPAIR: ${validation.invalidItems.map((item) => item.field).join(', ')}`));
      list.appendChild(card);
    }
    const nameRow = document.createElement('label');
    nameRow.className = 'wide-save-name-row';
    nameRow.dataset.testid = 'wide-save-name-row';
    nameRow.append(text('span', 'label', 'NAME'));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'wide-save-name-input';
    nameInput.value = saveName;
    nameInput.placeholder = 'CONFIG NAME';
    nameInput.dataset.testid = 'wide-save-name-input';
    nameInput.addEventListener('input', (event) => {
      saveName = String(event.target.value || '').slice(0, SAVE_NAME_MAX);
      pendingOverwriteName = null;
    });
    nameRow.appendChild(nameInput);
    list.appendChild(nameRow);
    const saveSlot = createButton('', {
      disabled: draft.characters.length === 0,
      description: pendingOverwriteName === saveName.trim() ? 'confirm overwrite' : 'save current party as a new configuration',
      onClick: saveBlueprint
    });
    saveSlot.className = 'config-card save-slot';
    saveSlot.dataset.testid = 'wide-save-slot';
    saveSlot.append(
      text('div', 'name', pendingOverwriteName === saveName.trim() && saveName.trim() ? '+ CONFIRM OVERWRITE' : '+ SAVE CURRENT'),
      text('div', 'meta', `${configs.length}/10`)
    );
    list.appendChild(saveSlot);
    section.appendChild(list);
    if (notice) section.appendChild(text('p', notice.startsWith('LOADED') || notice.startsWith('SAVED') ? 'creation-note' : 'creation-error', notice));
    return section;
  }

  function wideSection(id, headingText, subtitle) {
    const section = document.createElement('section');
    section.className = 'wide-section';
    section.dataset.testid = `wide-section-${id}`;
    const heading = document.createElement('div');
    heading.className = 'wide-section-heading';
    heading.appendChild(text('span', 'wide-section-title', `◈ ${headingText}`));
    if (subtitle) heading.appendChild(text('span', 'subtitle', subtitle));
    section.appendChild(heading);
    return section;
  }

  function renderWideClassSection(summary) {
    const selected = selectedSummary(summary);
    const section = wideSection('class', 'CLASS', '6 CHASSIS · SIGNATURE DEFINES ROLE');
    const grid = document.createElement('div');
    grid.className = 'class-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Class selection');
    for (const cls of classList(data)) {
      const isSelected = selected?.classId === cls.id;
      const card = createButton('', {
        selected: isSelected,
        label: `Choose ${cls.name}`,
        onClick: () => dispatch({ type: 'set_class', classId: cls.id })
      });
      card.classList.add('class-card');
      if (isSelected) card.classList.add('selected');
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(isSelected));
      card.dataset.testid = `wide-class-${cls.id}`;
      const row = document.createElement('div');
      row.className = 'row';
      const marker = text('span', 'sigil-option', cls.name === 'Operator' ? 'Op' : cls.name.charAt(0).toUpperCase());
      marker.style.width = '44px';
      marker.style.height = '44px';
      marker.style.fontSize = '16px';
      const nameStack = document.createElement('div');
      nameStack.append(
        text('div', 'title', cls.name.toUpperCase()),
        text('div', 'stats', `${ATTR_LABELS[cls.primaryAttribute] || ''} · Hit Die ${cls.hitDieBase || ''}`)
      );
      row.append(marker, nameStack);
      card.append(row, text('div', 'desc', (cls.signature?.tiers?.[0] || '').split('.')[0]));
      const wrapper = document.createElement('div');
      wrapper.className = 'class-card-wrap';
      wrapper.append(card, manualLink(cls.id, { variant: 'chip' }));
      grid.appendChild(wrapper);
    }
    section.appendChild(grid);
    if (selected?.projectedStats) section.appendChild(renderWideProjectedStats(selected));
    return section;
  }

  function renderWideProjectedStats(selected) {
    const stats = selected.projectedStats;
    const box = document.createElement('div');
    box.className = 'projected-stats';
    box.dataset.testid = 'wide-selected-stats';
    box.appendChild(text('div', 'heading', `◈ PROJECTED STATS — ${selected.classData.name.toUpperCase()}`));
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const [label, value, id] of [
      ['HP', stats.hpMax, 'hp'],
      ['CHARGE', stats.chargeMax, 'charge'],
      ['DEF', stats.defenseBase, 'def'],
      ['INIT', `${stats.initiativeMod >= 0 ? '+' : ''}${stats.initiativeMod}`, 'init'],
      ['MGT', selected.attributes.mgt, 'mgt'],
      ['FIN', selected.attributes.fin, 'fin']
    ]) {
      const cell = document.createElement('div');
      cell.dataset.testid = `wide-projected-${id}`;
      cell.append(text('span', 'label', label), text('span', 'val', String(value)));
      grid.appendChild(cell);
    }
    box.appendChild(grid);
    const sigName = selected.classData.signature?.name?.toUpperCase() || '';
    const sigTier = selected.classData.signature?.tiers?.[0] || '';
    box.appendChild(text('div', 'signature', `SIGNATURE: ${sigName} — ${sigTier}`));
    return box;
  }

  function renderWideSigilSection(summary) {
    const selected = selectedSummary(summary);
    const familyName = selected?.classData?.name?.toUpperCase() || 'UNASSIGNED';
    const section = wideSection('sigil', `SIGIL — ${familyName} FAMILY`, 'FREE WITH CHASSIS · NO TWO CHARACTERS MAY SHARE');
    if (!selected?.classData) {
      section.appendChild(text('p', 'creation-warning', 'ASSIGN A CLASS BEFORE SELECTING A SIGIL.'));
      return section;
    }
    const family = data?.sigils?.playerBank?.families?.[selected.classData.sigilFamily]?.codepoints ?? [];
    const used = new Set(summary.characters.map((character, index) => index === summary.activeSlot ? null : character.sigil).filter(Number.isInteger));
    const picker = document.createElement('div');
    picker.className = 'sigil-picker';
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', `${selected.classData.name} sigils`);

    const previewColumn = document.createElement('div');
    const preview = document.createElement('div');
    preview.className = 'sigil-preview';
    preview.dataset.testid = 'wide-sigil-preview';
    if (Number.isInteger(selected.sigil)) preview.textContent = String.fromCodePoint(selected.sigil);
    else preview.textContent = '?';
    previewColumn.appendChild(preview);
    const caption = text('div', 'sigil-preview-caption', Number.isInteger(selected.sigil) ? `SIGIL-220 · ${selected.sigil.toString(16)}` : 'SIGIL-220 · SELECT A GLYPH');
    caption.dataset.testid = 'wide-sigil-caption';
    previewColumn.appendChild(caption);
    picker.appendChild(previewColumn);

    const thumbs = document.createElement('div');
    thumbs.className = 'sigil-thumbs';
    for (const codepoint of family) {
      const unavailable = used.has(codepoint);
      const isSelected = selected.sigil === codepoint;
      const thumb = createButton('', {
        selected: isSelected,
        disabled: unavailable,
        description: unavailable ? 'sigil already used by another character' : 'free class-family sigil',
        onClick: () => dispatch({ type: 'set_sigil', sigil: codepoint })
      });
      thumb.classList.add('sigil-option');
      if (isSelected) thumb.classList.add('selected');
      thumb.setAttribute('role', 'radio');
      thumb.setAttribute('aria-checked', String(isSelected));
      thumb.setAttribute('aria-label', `Sigil ${codepoint.toString(16)}`);
      thumb.dataset.testid = `wide-sigil-${codepoint.toString(16)}`;
      thumb.textContent = String.fromCodePoint(codepoint);
      thumbs.appendChild(thumb);
    }
    picker.appendChild(thumbs);
    picker.appendChild(text('div', 'sigil-note', `${family.length} SIGILS PER CLASS FAMILY · 220PX PREVIEW`));
    section.appendChild(picker);
    return section;
  }

  function renderWideAttrsSection(summary) {
    const selected = selectedSummary(summary);
    const className = selected?.classData?.name?.toUpperCase() || 'UNASSIGNED';
    const section = wideSection('attrs', `ATTRIBUTES — ${className}`, 'START AT RANK 3 · 3→6: 1PT · 7→8: 2PT · 9→10: 3PT');
    const grid = document.createElement('div');
    grid.className = 'attr-grid';
    for (const key of ATTRIBUTE_KEYS) {
      const rank = selected.attributes[key];
      const isPrimary = selected.classData?.primaryAttribute === key;
      const incPreview = validateChangedDraft(draft, { type: 'buy_attribute', attribute: key }, data);
      const decPreview = validateChangedDraft(draft, { type: 'refund_attribute', attribute: key }, data);
      const increaseReason = rank >= 10 ? 'maximum rank' : incPreview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : '';
      const decreaseReason = rank <= 1 ? 'minimum rank' : !decPreview.changed ? 'minimum rank' : '';
      const row = document.createElement('div');
      row.className = 'attr-row' + (isPrimary ? ' primary' : '');
      row.dataset.testid = `wide-attribute-${key}`;
      row.setAttribute('aria-label', `${ATTR_NAMES[key]} rank ${rank}, modifier ${modifier(rank)}`);
      const head = document.createElement('div');
      head.className = 'head';
      const nameGroup = document.createElement('div');
      nameGroup.className = 'name';
      nameGroup.append(
        text('span', 'full', ATTR_NAMES[key]),
        text('span', 'abbrev', `${ATTR_LABELS[key]}${isPrimary ? ' · PRIMARY' : ''}`)
      );
      const stepperGroup = document.createElement('div');
      stepperGroup.className = 'stepper';
      const dec = createButton('−', {
        label: `Decrease ${ATTR_NAMES[key]}`,
        disabled: Boolean(decreaseReason),
        description: decreaseReason || 'refund one point',
        onClick: () => dispatch({ type: 'refund_attribute', attribute: key })
      });
      dec.classList.add('stepper-btn');
      dec.dataset.testid = `wide-attribute-${key}-dec`;
      const val = text('span', 'val', String(rank));
      const inc = createButton('+', {
        label: `Increase ${ATTR_NAMES[key]}`,
        disabled: Boolean(increaseReason),
        description: increaseReason || 'buy one rank',
        onClick: () => dispatch({ type: 'buy_attribute', attribute: key })
      });
      inc.classList.add('stepper-btn');
      inc.dataset.testid = `wide-attribute-${key}-inc`;
      stepperGroup.append(dec, val, inc);
      head.append(nameGroup, stepperGroup);
      row.appendChild(head);
      const barTrack = document.createElement('div');
      barTrack.className = 'bar-track';
      const barFill = document.createElement('div');
      barFill.className = 'bar-fill';
      barFill.style.width = `${rank * 10}%`;
      barTrack.appendChild(barFill);
      row.appendChild(barTrack);
      const mod = modifier(rank);
      row.appendChild(text('div', 'desc', `MODIFIER ${mod >= 0 ? '+' : ''}${mod}`));
      row.appendChild(manualLink(key, { variant: 'chip' }));
      grid.appendChild(row);
    }
    section.appendChild(grid);
    return section;
  }

  function wideGearRow(testid, name, stat, cost, opts = {}) {
    const row = createButton('', {
      selected: opts.selected,
      disabled: opts.disabled,
      description: opts.description,
      onClick: opts.onClick
    });
    row.classList.remove('btn-crt');
    row.classList.add('gear-row');
    if (opts.selected) row.classList.add('selected');
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(Boolean(opts.selected)));
    row.dataset.testid = testid;
    const info = document.createElement('span');
    info.className = 'info';
    info.append(text('span', 'name', name), text('span', 'stat', stat));
    row.append(info, text('span', 'cost', cost));
    if (opts.reason) row.appendChild(text('span', 'disabled-reason', opts.reason.toUpperCase()));
    return row;
  }

  function renderWideGearSection(summary) {
    const selected = selectedSummary(summary);
    const className = selected?.classData?.name?.toUpperCase() || 'UNASSIGNED';
    const section = wideSection('gear', `EQUIPMENT — ${className}`, '1 WEAPON + 1 ARMOR + 1 OFF-HAND');
    if (!selected?.classData) {
      section.appendChild(text('p', 'creation-warning', 'ASSIGN A CLASS BEFORE BUYING EQUIPMENT.'));
      return section;
    }
    const current = selected.equipment;
    for (const [slot, label] of [['weapon', 'WEAPONS'], ['armor', 'ARMOR'], ['offhand', 'OFF-HAND']]) {
      const group = document.createElement('div');
      group.className = 'gear-group';
      group.dataset.testid = `wide-gear-${slot}`;
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', label);
      group.appendChild(text('div', 'gear-group-heading', label));
      const noneRow = wideGearRow(
        `wide-${slot}-none`,
        slot === 'armor' ? '◈ NO ARMOR' : '◈ NONE',
        slot === 'armor' ? 'no armor equipped' : 'empty slot',
        '0PT',
        {
          selected: current[slot] === null,
          onClick: () => dispatch({ type: 'unequip_gear', gearSlot: slot })
        }
      );
      group.appendChild(noneRow);
      const choices = legalGearChoices(slot, selected.classId);
      if (!choices.length) group.appendChild(emptyListNote(`wide-gear:${slot}:${selected.classId}`, 'NO CLASS-LEGAL OPTIONS FOR THIS SLOT.'));
      for (const { id, item } of choices) {
        const selectedItem = current[slot] === id;
        const preview = validateChangedDraft(draft, { type: 'equip_gear', gearSlot: slot, itemId: id }, data);
        const reason = selectedItem ? '' : preview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : !preview.changed ? 'slot gate' : '';
        const chips = gearStatChips(slot, id);
        const baseStat = `${item.rangeBand ?? 'DEF'}${item.defenseBonus ? ` · DEF +${item.defenseBonus}` : ''}`;
        const stat = `${baseStat}${statChipSuffix(chips)}`;
        group.appendChild(wideGearRow(
          `wide-${slot}-${id}`,
          `◈ ${item.name || id}`,
          stat,
          `${item.creationCost ?? 0}PT`,
          {
            selected: selectedItem,
            disabled: Boolean(reason),
            description: reason || `${item.creationCost ?? 0} creation points`,
            onClick: () => dispatch({ type: 'equip_gear', gearSlot: slot, itemId: id }),
            reason
          }
        ));
      }
      section.appendChild(group);
    }
    section.appendChild(renderGearManualStrip(true));
    return section;
  }

  function renderWideTechSection(summary) {
    const selected = selectedSummary(summary);
    const className = selected?.classData?.name?.toUpperCase() || 'UNASSIGNED';
    const schools = selected?.classData?.protocolGates?.schools?.map((school) => school.toUpperCase()).join(' / ') || 'NONE';
    const maxTier = selected?.classData?.protocolGates?.maxTier ?? 0;
    const capacity = selected?.deck?.capacity ?? 0;
    const slotsUsed = selected?.deck?.slotsUsed ?? 0;
    const subtitle = `${schools} · MAX TIER ${maxTier} · DECK SLOTS ${capacity} · SLOTS USED ${slotsUsed}/${capacity} · COST TIER × 2 PT`;
    const section = wideSection('tech', `TECH PROTOCOLS — ${className}`, subtitle);
    if (!selected?.classData) {
      section.appendChild(text('p', 'creation-warning', 'ASSIGN A CLASS BEFORE BUYING PROTOCOLS.'));
      return section;
    }
    const list = document.createElement('div');
    list.className = 'tech-list';
    list.dataset.testid = 'wide-tech-list';
    const wideProtocols = legalProtocolChoices(selected.classData);
    if (!wideProtocols.length) list.appendChild(emptyListNote(`wide-tech:${selected.classId}`, 'NO CLASS-LEGAL PROTOCOLS FOR THIS CLASS.'));
    for (const protocol of wideProtocols) {
      const isSelected = selected.protocols.some((entry) => entry.school === protocol.school && entry.tier === protocol.tier);
      const action = isSelected
        ? { type: 'remove_protocol', school: protocol.school, tier: protocol.tier }
        : { type: 'add_protocol', school: protocol.school, tier: protocol.tier };
      const preview = validateChangedDraft(draft, action, data);
      const overCapacity = !isSelected && preview.summary.characters[summary.activeSlot]?.deck?.slotsUsed > selected.deck.capacity;
      const reason = overCapacity ? 'deck capacity' : preview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : '';
      const pointDelta = Math.max(0, preview.summary.pointsSpent - summary.pointsSpent);
      list.appendChild(wideGearRow(
        `wide-protocol-${protocol.school}-${protocol.tier}`,
        `${protocol.entry.name} · ${protocol.schoolName.toUpperCase()} T${protocol.tier}`,
        `${protocol.entry.chargeCost} CHG · ${deckSlotCost(protocol.tier)} DECK`,
        `${pointDelta}PT`,
        {
          selected: isSelected,
          disabled: Boolean(reason),
          description: reason || `${pointDelta} creation points, ${protocol.entry.chargeCost} charge`,
          onClick: () => dispatch(action),
          reason
        }
      ));
    }
    section.appendChild(list);
    const gateNote = text('div', 'tech-gate-note', `HIGHER TIERS NOT AVAILABLE FOR ${className} (GATE: TIER ≤ ${maxTier})`);
    gateNote.dataset.testid = 'wide-tech-gate-note';
    section.appendChild(gateNote);
    section.appendChild(renderTechManualStrip(selected, true));
    return section;
  }

  function renderWideFooter(summary) {
    const footer = document.createElement('footer');
    footer.className = 'wide-creation-footer';
    footer.dataset.testid = 'wide-creation-footer';
    const backButton = createButton('◀ BACK', {
      onClick: () => bus.dispatch('ui:navigate', { screen: 'title' })
    });
    backButton.dataset.testid = 'back';
    backButton.classList.add('footer-back-btn', 'btn-link');
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    const finalizeButton = createButton(finalizing ? 'BOOTING…' : finalized ? 'FINALIZED' : '◈ FINALIZE & DESCEND', {
      primary: true,
      busy: finalizing,
      disabled: finalizing || finalized || !summary.validation.valid,
      describedBy: 'creation-errors',
      onClick: finalize
    });
    finalizeButton.dataset.testid = 'finalize';
    finalizeButton.classList.add('finalize-btn', 'btn-link');
    const errors = summary.validation.errors;
    const errorBox = document.createElement('div');
    errorBox.className = errors.length ? 'creation-error' : 'creation-note';
    errorBox.id = 'creation-errors';
    errorBox.dataset.testid = 'validation-errors';
    errorBox.style.flex = '1';
    errorBox.style.textAlign = 'center';
    errorBox.textContent = errors.length ? errors.map(errorText).join(' · ') : 'BUILD VALID · READY TO DESCEND.';
    footer.append(backButton, errorBox, finalizeButton);
    return footer;
  }

  function renderHeader(summary) {
    const header = document.createElement('section');
    header.className = 'creation-header';
    header.classList.add('panel-elevated');
    header.style.gap = '0';
    header.style.padding = '12px 16px';
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
    header.appendChild(manualLink('character_creation', { variant: 'chip' }));
    return header;
  }

  function readout(label, value, id) {
    const item = document.createElement('div');
    item.className = 'creation-readout';
    item.style.minWidth = '0';
    item.style.minHeight = '64px';
    item.style.padding = '4px 8px';
    item.style.border = '0';
    item.style.background = 'transparent';
    item.dataset.testid = id;
    item.append(text('span', 'readout-label', label), text('strong', 'readout-value', value));
    return item;
  }

  function renderCharacterRail(summary) {
    const rail = document.createElement('section');
    rail.className = 'creation-char-bar';
    rail.classList.add('panel');
    rail.style.position = 'relative';
    rail.style.flexWrap = 'nowrap';
    rail.style.gap = '8px';
    rail.style.padding = '12px 16px';
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
      slot.style.flex = '1';
      slot.style.minWidth = '0';
      slot.style.minHeight = '72px';
      slot.style.height = '72px';
      slot.style.padding = '8px 4px';
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
    remove.style.position = 'absolute';
    remove.style.top = '4px';
    remove.style.right = '4px';
    remove.style.minHeight = '24px';
    remove.style.padding = '2px 4px';
    remove.style.fontSize = '8px';
    rail.appendChild(remove);
    return rail;
  }

  function renderTabs() {
    const tablist = document.createElement('div');
    tablist.className = 'creation-tabs';
    tablist.classList.add('panel');
    tablist.style.flexWrap = 'nowrap';
    tablist.style.gap = '0';
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
    const panel = createPanel();
    panel.classList.add('creation-detail');
    panel.id = `creation-panel-${activeTab}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-label', TABS.find(([id]) => id === activeTab)?.[1] || 'Editor');
    panel.dataset.testid = `panel-${activeTab}`;
    panel.style.padding = '12px 16px';
    panel.style.borderLeft = '0';
    panel.style.borderRight = '0';
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
    panel.appendChild(text('p', 'creation-note accent-text glow', '◈ SELECT CLASS'));
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
      card.style.minHeight = '112px';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(selected.classId === cls.id));
      card.dataset.testid = `class-${cls.id}`;
      const marker = text('span', 'sigil-placeholder small class-marker', cls.name === 'Operator' ? 'OP' : cls.name.charAt(0).toUpperCase());
      const nameSpan = text('span', 'card-name accent-text', cls.name.toUpperCase());
      const subtitle = text('span', 'card-subtitle', `${ATTR_LABELS[cls.primaryAttribute] || ''} · Hit Die ${cls.hitDieBase || ''}`);
      const desc = text('span', 'card-detail', (cls.signature?.tiers?.[0] || '').split('.')[0]);
      card.append(marker, nameSpan, subtitle, desc);
      const wrapper = document.createElement('div');
      wrapper.className = 'class-card-wrap';
      wrapper.append(card, manualLink(cls.id, { variant: 'chip' }));
      group.appendChild(wrapper);
    }
    panel.appendChild(group);
    if (selected?.projectedStats) panel.appendChild(renderProjectedStats(selected));
  }

  function renderProjectedStats(selected) {
    const stats = selected.projectedStats;
    const projected = createPanel();
    projected.classList.add('projected-stats');
    projected.dataset.testid = 'selected-stats';
    projected.appendChild(text('h3', 'section-header accent-text glow', `◈ PROJECTED STATS — ${selected.classData.name}`));
    const grid = document.createElement('div');
    grid.className = 'creation-choice-grid projected-stat-grid';
    for (const [label, value] of [
      ['HP', stats.hpMax], ['CHARGE', stats.chargeMax], ['DEF', stats.defenseBase],
      ['INIT', `${stats.initiativeMod >= 0 ? '+' : ''}${stats.initiativeMod}`],
      ['MGT', selected.attributes.mgt], ['FIN', selected.attributes.fin]
    ]) grid.appendChild(readout(label, String(value), `projected-${label.toLowerCase()}`));
    projected.append(grid, text('p', 'card-detail', `SIGNATURE: ${selected.classData.signature?.name?.toUpperCase()} — ${selected.classData.signature?.tiers?.[0] || ''}`));
    return projected;
  }

  function renderSigilPicker(panel, summary) {
    const selected = selectedSummary(summary);
    if (!selected?.classData) {
      panel.appendChild(text('p', 'creation-warning', 'ASSIGN A CLASS BEFORE SELECTING A SIGIL.'));
      return;
    }
    panel.append(
      text('p', 'creation-note accent-text glow', `◈ SELECT SIGIL — ${selected.classData.name.toUpperCase()} FAMILY`),
      text('p', 'creation-note', 'FREE WITH CHASSIS · NO TWO CHARACTERS MAY SHARE')
    );
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
    panel.appendChild(text('p', 'creation-note', `${family.length} SIGILS PER CLASS FAMILY · 220PX PREVIEW`));
  }

  function renderAttributes(panel, summary) {
    const selected = selectedSummary(summary);
    const section = document.createElement('div');
    section.className = 'creation-section';
    section.append(
      text('p', 'creation-note accent-text glow', `◈ ATTRIBUTES — ${selected.classData?.name?.toUpperCase() || 'UNASSIGNED'}`),
      text('p', 'creation-note', 'START AT RANK 3 · 3→6: 1PT · 7→8: 2PT · 9→10: 3PT')
    );
    for (const key of ATTRIBUTE_KEYS) {
      const rank = selected.attributes[key];
      const incPreview = validateChangedDraft(draft, { type: 'buy_attribute', attribute: key }, data);
      const decPreview = validateChangedDraft(draft, { type: 'refund_attribute', attribute: key }, data);
      const increaseReason = rank >= 10 ? 'maximum rank' : incPreview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : '';
      const decreaseReason = rank <= 1 ? 'minimum rank' : !decPreview.changed ? 'minimum rank' : '';
      const row = createAttributeRow(`${ATTR_NAMES[key]} · ${ATTR_LABELS[key]}${selected.classData?.primaryAttribute === key ? ' · PRIMARY' : ''}`, rank, {
        steppers: true,
        increaseDisabled: Boolean(increaseReason),
        decreaseDisabled: Boolean(decreaseReason),
        onIncrease: () => dispatch({ type: 'buy_attribute', attribute: key }),
        onDecrease: () => dispatch({ type: 'refund_attribute', attribute: key })
      });
      row.dataset.testid = `attribute-${key}`;
      row.classList.add('panel');
      row.style.minHeight = '96px';
      row.setAttribute('aria-label', `${ATTR_NAMES[key]} rank ${rank}, modifier ${modifier(rank)}`);
      const meter = document.createElement('span');
      meter.className = 'bar-track';
      const fill = document.createElement('span');
      fill.className = 'bar-fill';
      fill.style.width = `${rank * 10}%`;
      meter.appendChild(fill);
      row.append(meter, text('span', 'card-detail', `MODIFIER ${modifier(rank) >= 0 ? '+' : ''}${modifier(rank)}`));
      if (increaseReason) row.appendChild(text('span', 'disabled-reason', `+ ${increaseReason}`));
      if (decreaseReason) row.appendChild(text('span', 'disabled-reason', `− ${decreaseReason}`));
      row.appendChild(manualLink(key, { variant: 'chip' }));
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
    panel.append(
      text('p', 'creation-note accent-text glow', `◈ EQUIPMENT — ${selected.classData.name.toUpperCase()}`),
      text('p', 'creation-note', '1 WEAPON + 1 ARMOR + 1 OFF-HAND')
    );
    const current = selected.equipment;
    for (const [slot, label] of [['weapon', 'WEAPON'], ['armor', 'ARMOR'], ['offhand', 'OFFHAND']]) {
      const group = document.createElement('div');
      group.className = 'creation-section gear-slot-group';
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', label);
      group.appendChild(text('h3', 'section-header', label));
      const choices = document.createElement('div');
      choices.className = 'creation-choice-grid';
      const none = createButton(slot === 'armor' ? 'NO ARMOR' : 'NONE', {
        selected: current[slot] === null,
        onClick: () => dispatch({ type: 'unequip_gear', gearSlot: slot })
      });
      none.className = `equipment-card item-card console-row${current[slot] === null ? ' selected' : ''}`;
      none.setAttribute('role', 'radio');
      none.setAttribute('aria-checked', String(current[slot] === null));
      none.dataset.testid = `${slot}-none`;
      choices.appendChild(none);
      const options = legalGearChoices(slot, selected.classId);
      if (!options.length) choices.appendChild(emptyListNote(`gear:${slot}:${selected.classId}`, 'NO CLASS-LEGAL OPTIONS FOR THIS SLOT.'));
      for (const { id, item } of options) {
        const selectedItem = current[slot] === id;
        const preview = validateChangedDraft(draft, { type: 'equip_gear', gearSlot: slot, itemId: id }, data);
        const reason = selectedItem ? '' : preview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : !preview.changed ? 'slot gate' : '';
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
        const chips = gearStatChips(slot, id);
        const baseDetail = `${item.creationCost ?? 0} PTS · ${item.rangeBand ?? 'DEF'}${item.defenseBonus ? ` · DEF +${item.defenseBonus}` : ''}`;
        card.appendChild(text('span', 'card-detail', `${baseDetail}${statChipSuffix(chips)}`));
        if (reason) card.appendChild(text('span', 'disabled-reason', reason.toUpperCase()));
        choices.appendChild(card);
      }
      group.appendChild(choices);
      panel.appendChild(group);
    }
    panel.appendChild(renderGearManualStrip(false));
  }

  function renderGearManualStrip(wide) {
    const strip = document.createElement('div');
    strip.className = 'manual-link-strip';
    strip.dataset.testid = wide ? 'wide-gear-manual-strip' : 'gear-manual-strip';
    strip.appendChild(text('span', wide ? 'subtitle' : 'creation-note', 'SEE MANUAL:'));
    strip.appendChild(manualLink('loot_and_salvage', { variant: 'chip' }));
    return strip;
  }

  function renderProtocols(panel, summary) {
    const selected = selectedSummary(summary);
    if (!selected?.classData) {
      panel.appendChild(text('p', 'creation-warning', 'ASSIGN A CLASS BEFORE BUYING PROTOCOLS.'));
      return;
    }
    panel.appendChild(text('p', 'creation-note accent-text glow', `◈ TECH PROTOCOLS — ${selected.classData.name.toUpperCase()}`));
    const schools = selected.classData.protocolGates?.schools?.map((school) => school.toUpperCase()).join(' / ') || 'NONE';
    panel.appendChild(text('p', 'creation-note', `${schools} · MAX TIER ${selected.classData.protocolGates?.maxTier ?? 0} · DECK SLOTS ${selected.deck.capacity}`));
    const deck = text('p', 'creation-note', `SLOTS USED ${selected.deck.slotsUsed} / ${selected.deck.capacity} · COST: TIER × 2 POINTS`);
    deck.dataset.testid = 'deck-summary';
    panel.appendChild(deck);
    const grid = document.createElement('div');
    grid.className = 'creation-choice-grid';
    grid.style.gridTemplateColumns = '1fr';
    const protocols = legalProtocolChoices(selected.classData);
    if (!protocols.length) grid.appendChild(emptyListNote(`tech:${selected.classId}`, 'NO CLASS-LEGAL PROTOCOLS FOR THIS CLASS.'));
    for (const protocol of protocols) {
      const isSelected = selected.protocols.some((entry) => entry.school === protocol.school && entry.tier === protocol.tier);
      const action = isSelected
        ? { type: 'remove_protocol', school: protocol.school, tier: protocol.tier }
        : { type: 'add_protocol', school: protocol.school, tier: protocol.tier };
      const preview = validateChangedDraft(draft, action, data);
      const capacity = !isSelected && preview.summary.characters[summary.activeSlot]?.deck?.slotsUsed > selected.deck.capacity;
      const reason = capacity ? 'deck capacity' : preview.summary.validation.pointsSpent > 80 ? 'point budget exceeded' : '';
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
    panel.appendChild(renderTechManualStrip(selected, false));
  }

  function renderTechManualStrip(selected, wide) {
    const strip = document.createElement('div');
    strip.className = 'manual-link-strip';
    strip.dataset.testid = wide ? 'wide-tech-manual-strip' : 'tech-manual-strip';
    strip.appendChild(text('span', wide ? 'subtitle' : 'creation-note', 'SEE MANUAL:'));
    for (const school of selected.classData?.protocolGates?.schools ?? []) {
      strip.appendChild(manualLink(school, { label: school.toUpperCase() }));
    }
    strip.appendChild(manualLink('charge_and_overclock', { variant: 'chip' }));
    return strip;
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
    scroll.style.display = 'flex';
    scroll.style.overflowX = 'auto';
    scroll.dataset.testid = 'config-list';
    if (!configs.length) scroll.appendChild(text('p', 'creation-note', 'NO SAVED CONFIGS.'));
    for (const config of configs) {
      const validation = validateConfig(config, data);
      const row = document.createElement('article');
      row.className = `config-row console-row${validation.valid ? '' : ' invalid'}`;
      row.style.minWidth = '240px';
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
    footer.classList.add('panel');
    footer.style.display = 'block';
    footer.style.padding = '8px 16px 12px';
    footer.dataset.testid = 'creation-actions';
    footer.appendChild(renderSavedConfigStrip());
    const errors = summary.validation.errors;
    const errorBox = document.createElement('div');
    errorBox.className = errors.length ? 'creation-error' : 'creation-note';
    errorBox.id = 'creation-errors';
    errorBox.dataset.testid = 'validation-errors';
    errorBox.style.minHeight = '0';
    errorBox.style.padding = '2px 8px';
    errorBox.textContent = errors.length ? errors.map(errorText).join(' · ') : 'BUILD VALID · READY TO DESCEND.';
    footer.appendChild(errorBox);
    const actionRow = document.createElement('div');
    actionRow.className = 'creation-footer-row';
    actionRow.style.display = 'flex';
    actionRow.style.gap = '8px';
    actionRow.style.minHeight = '48px';
    const backButton = createButton('◀ BACK', {
      onClick: () => bus.dispatch('ui:navigate', { screen: 'title' })
    });
    backButton.dataset.testid = 'back';
    backButton.classList.add('footer-back-btn');
    backButton.style.minHeight = '48px';
    const finalizeButton = createButton(finalizing ? 'BOOTING…' : finalized ? 'FINALIZED' : 'FINALIZE & DESCEND', {
      primary: true,
      busy: finalizing,
      disabled: finalizing || finalized || !summary.validation.valid,
      describedBy: 'creation-errors',
      onClick: finalize
    });
    finalizeButton.dataset.testid = 'finalize';
    finalizeButton.classList.add('finalize-btn');
    finalizeButton.style.minHeight = '48px';
    finalizeButton.style.padding = '12px 20px';
    finalizeButton.style.fontSize = '12px';
    finalizeButton.style.letterSpacing = '0.1em';
    actionRow.append(backButton, finalizeButton);
    footer.appendChild(actionRow);
    if (notice && activeTab !== 'blueprints') {
      const noticeElement = text('p', notice.startsWith('LOADED') ? 'creation-note' : 'creation-error', notice);
      noticeElement.style.minHeight = '0';
      footer.appendChild(noticeElement);
    }
    return footer;
  }

  function renderSavedConfigStrip() {
    const section = document.createElement('section');
    section.className = 'saved-config-strip';
    section.style.minHeight = '0';
    section.dataset.testid = 'saved-config-strip';
    const heading = text('h3', 'section-header accent-text glow', '◈ SAVED CONFIGURATIONS (FR-51)');
    heading.style.margin = '0 0 4px';
    section.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'blueprint-list';
    list.style.display = 'flex';
    list.style.gap = '8px';
    list.style.overflowX = 'auto';
    for (const config of listConfigs().slice(0, 10)) {
      const validation = validateConfig(config, data);
      const card = createButton(config.name, {
        error: !validation.valid,
        description: validation.valid ? shortBlueprintSummary(config) : 'configuration needs repair',
        onClick: () => loadBlueprint(config.name)
      });
      card.classList.add(validation.valid ? 'panel' : 'invalid');
      card.style.flex = '0 0 auto';
      card.style.minWidth = '112px';
      card.style.minHeight = '48px';
      card.dataset.testid = `saved-strip-${config.name}`;
      list.appendChild(card);
    }
    const save = createButton('+ SAVE', {
      description: 'Open saved configuration editor',
      onClick: () => { activeTab = 'blueprints'; render(); }
    });
    save.style.flex = '0 0 auto';
    save.style.minWidth = '80px';
    save.style.minHeight = '48px';
    save.dataset.testid = 'open-blueprints';
    list.appendChild(save);
    section.appendChild(list);
    return section;
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
