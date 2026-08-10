import { createButton, createPanel, createScrollArea, createAttributeRow, createSigilToken } from '../components.js';
import { createInputHandler } from '../input.js';
import { bus } from '../../state/bus.js';
import { gameData } from '../../main.js';
import { deriveStats, attributeCost } from '../../rules/attributes.js';
import { canEquipWeapon, canEquipArmor, maxProtocolTier, primaryAttributeCostReduction } from '../../rules/classes.js';
import { createRunState } from '../../state/run-state.js';
import { createRNGCursor } from '../../core/rng-cursor.js';
import { createPRNG } from '../../core/prng.js';
import { generateFloor } from '../../floor/generator.js';
import { listConfigs, saveConfig, deleteConfig, getLastUsed, setLastUsed } from '../../state/party-configs.js';

const TOTAL_POINTS = 80;
const CHASSIS_COST = 5;
const ATTR_NAMES = ['MGT', 'FIN', 'VIT', 'RES', 'FOC', 'SIG'];
const ATTR_KEYS = ['mgt', 'fin', 'vit', 'res', 'foc', 'sig'];
const SIGIL_SIZE = 72;

export function mount(container, params = {}) {
  const inputHandler = createInputHandler();
  inputHandler.bindToElement(container);

  const preloadedSeed = params.preloadedSeed;
  const worldSeed = preloadedSeed != null
    ? (typeof preloadedSeed === 'number' ? preloadedSeed : parseInt(preloadedSeed, 10) || 0)
    : (Math.random() * 0xFFFFFFFF) >>> 0;

  const classesData = gameData.classes;
  const equipmentData = gameData.equipment;
  const protocolsData = gameData.protocols;
  const sigilsData = gameData.sigils;

  const state = {
    characters: [],
    activeSlot: 0,
    usedSigils: new Set(),
  };

  const lastUsed = getLastUsed();
  if (lastUsed?.characters) {
    state.characters = lastUsed.characters.map(c => ({
      classId: c.classId || '',
      sigil: c.sigilCodepoint ?? null,
      attributes: { ...(c.attributes || { mgt: 1, fin: 1, vit: 1, res: 1, foc: 1, sig: 1 }) },
      equipment: { weapon: c.equipment?.weapon || null, armor: c.equipment?.armor || 'none' },
      protocols: c.protocols || [],
    }));
  }

  function getPointsSpent() {
    let spent = 0;
    for (const c of state.characters) {
      spent += CHASSIS_COST;
      for (const key of ATTR_KEYS) {
        const rank = c.attributes[key] || 1;
        spent += attributeCost(1, rank);
        if (primaryAttributeCostReduction(classesData.classes.find(cls => cls.id === c.classId), key)) {
          spent -= 1;
        }
      }
      if (c.equipment?.weapon && equipmentData.weapons[c.equipment.weapon]) {
        spent += equipmentData.weapons[c.equipment.weapon].creationCost || 0;
      }
      if (c.equipment?.armor && equipmentData.armor[c.equipment.armor]) {
        spent += equipmentData.armor[c.equipment.armor].creationCost || 0;
      }
      for (const proto of (c.protocols || [])) {
        spent += proto.tier || 0;
      }
    }
    return spent;
  }

  function getPointsRemaining() {
    return TOTAL_POINTS - getPointsSpent();
  }

  function getCreditsFromRemaining() {
    return Math.max(0, getPointsRemaining()) * 10;
  }

  function getAPPerRound() {
    return state.characters.length;
  }

  function canFinalize() {
    if (state.characters.length < 1 || state.characters.length > 4) return false;
    for (const c of state.characters) {
      if (!c.classId) return false;
      if (c.sigil == null) return false;
    }
    if (getPointsSpent() > TOTAL_POINTS) return false;
    return true;
  }

  function reflow() {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'creation-wrapper';

    const header = document.createElement('div');
    header.className = 'creation-header';

    const seedEl = document.createElement('span');
    seedEl.className = 'creation-seed';
    seedEl.textContent = `SEED: ${worldSeed}`;
    header.appendChild(seedEl);

    const pointsEl = document.createElement('span');
    pointsEl.className = 'creation-points';
    pointsEl.textContent = `PTS: ${getPointsRemaining()}/${TOTAL_POINTS}`;
    header.appendChild(pointsEl);

    const creditsEl = document.createElement('span');
    creditsEl.className = 'creation-credits';
    creditsEl.textContent = `CR: ${getCreditsFromRemaining()}`;
    header.appendChild(creditsEl);

    const apEl = document.createElement('span');
    apEl.className = 'creation-ap';
    apEl.textContent = `AP/RD: ${getAPPerRound()}`;
    header.appendChild(apEl);

    wrapper.appendChild(header);

    const charBar = document.createElement('div');
    charBar.className = 'creation-char-bar';

    for (let i = 0; i < Math.max(state.characters.length, 1); i++) {
      const slot = document.createElement('button');
      slot.className = `char-slot${i === state.activeSlot ? ' active' : ''}`;
      const c = state.characters[i];
      slot.textContent = c?.classId
        ? classesData.classes.find(cls => cls.id === c.classId)?.name || `SLOT ${i + 1}`
        : `SLOT ${i + 1}`;
      slot.addEventListener('click', () => { state.activeSlot = i; reflow(); });
      charBar.appendChild(slot);
    }

    if (state.characters.length < 4) {
      const addBtn = createButton('+ ADD', {
        onClick: () => {
          if (getPointsSpent() + CHASSIS_COST > TOTAL_POINTS) return;
          state.characters.push({
            classId: '',
            sigil: null,
            attributes: { mgt: 1, fin: 1, vit: 1, res: 1, foc: 1, sig: 1 },
            equipment: { weapon: null, armor: 'none' },
            protocols: [],
          });
          state.activeSlot = state.characters.length - 1;
          reflow();
        }
      });
      charBar.appendChild(addBtn);
    }

    if (state.characters.length > 1) {
      const rmBtn = createButton('- REMOVE', {
        danger: true,
        onClick: () => {
          state.characters.splice(state.activeSlot, 1);
          if (state.activeSlot >= state.characters.length) state.activeSlot = state.characters.length - 1;
          reflow();
        }
      });
      charBar.appendChild(rmBtn);
    }

    wrapper.appendChild(charBar);

    const char = state.characters[state.activeSlot] || state.characters[0];
    if (char) {
      const detailPanel = createPanel({ title: 'CHARACTER ' + (state.activeSlot + 1) });
      detailPanel.className = 'creation-detail';

      renderClassPicker(detailPanel, char);
      renderSigilPicker(detailPanel, char);
      renderAttributeSteppers(detailPanel, char);
      renderEquipmentPicker(detailPanel, char);
      renderProtocolPicker(detailPanel, char);
      renderProjectedStats(detailPanel, char);

      wrapper.appendChild(detailPanel);
    }

    const actionRow = document.createElement('div');
    actionRow.className = 'creation-actions';

    actionRow.appendChild(createButton('FINALIZE', {
      primary: true,
      disabled: !canFinalize(),
      onClick: finalize
    }));

    const saveNameInput = document.createElement('input');
    saveNameInput.type = 'text';
    saveNameInput.placeholder = 'Config name...';
    saveNameInput.className = 'config-name-input';
    actionRow.appendChild(saveNameInput);

    actionRow.appendChild(createButton('SAVE CONFIG', {
      onClick: () => {
        const name = saveNameInput.value.trim();
        if (!name || state.characters.length === 0) return;
        const blueprint = {
          characters: state.characters.map(c => ({
            classId: c.classId,
            sigilCodepoint: c.sigil,
            attributes: c.attributes,
            equipment: c.equipment,
            protocols: c.protocols,
          })),
        };
        saveConfig(name, blueprint);
        setLastUsed(name);
        reflow();
      }
    }));

    const configsPanel = createPanel({ title: 'SAVED CONFIGS' });
    const configsScroll = createScrollArea();
    const configs = listConfigs();
    for (const cfg of configs) {
      const row = document.createElement('div');
      row.className = 'config-row';
      const label = document.createElement('span');
      label.textContent = cfg.name;
      row.appendChild(label);
      row.appendChild(createButton('LOAD', {
        onClick: () => {
          if (cfg.characters) {
            state.characters = cfg.characters.map(c => ({
              classId: c.classId || '',
              sigil: c.sigilCodepoint ?? null,
              attributes: { ...(c.attributes || { mgt: 1, fin: 1, vit: 1, res: 1, foc: 1, sig: 1 }) },
              equipment: { weapon: c.equipment?.weapon || null, armor: c.equipment?.armor || 'none' },
              protocols: c.protocols || [],
            }));
            state.activeSlot = 0;
            setLastUsed(cfg.name);
            reflow();
          }
        }
      }));
      row.appendChild(createButton('DEL', { danger: true, onClick: () => { deleteConfig(cfg.name); reflow(); } }));
      configsScroll.appendChild(row);
    }
    configsPanel.appendChild(configsScroll);
    wrapper.appendChild(configsPanel);
    wrapper.appendChild(actionRow);

    container.appendChild(wrapper);
  }

  function renderClassPicker(panel, char) {
    const section = document.createElement('div');
    section.className = 'creation-section';
    section.appendChild(Object.assign(document.createElement('h3'), { textContent: 'CLASS' }));

    const classRow = document.createElement('div');
    classRow.className = 'class-card-row';

    for (const cls of classesData.classes) {
      const card = document.createElement('div');
      card.className = `class-card${char.classId === cls.id ? ' selected' : ''}`;
      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = cls.name;
      const sig = document.createElement('div');
      sig.className = 'card-detail';
      sig.textContent = cls.signature?.tiers?.[0] || '';
      card.appendChild(name);
      card.appendChild(sig);
      card.addEventListener('click', () => {
        char.classId = cls.id;
        char.equipment.weapon = null;
        char.equipment.armor = 'none';
        char.protocols = [];
        reflow();
      });
      classRow.appendChild(card);
    }

    section.appendChild(classRow);
    panel.appendChild(section);
  }

  function renderSigilPicker(panel, char) {
    if (!char.classId) return;
    const section = document.createElement('div');
    section.className = 'creation-section';
    section.appendChild(Object.assign(document.createElement('h3'), { textContent: 'SIGIL' }));

    const sigilRow = document.createElement('div');
    sigilRow.className = 'sigil-picker-row';

    const cls = classesData.classes.find(c => c.id === char.classId);
    if (cls && sigilsData.playerBank.families[cls.sigilFamily]) {
      for (const cp of sigilsData.playerBank.families[cls.sigilFamily].codepoints) {
        const used = state.usedSigils.has(cp);
        const token = createSigilToken(cp, SIGIL_SIZE);
        token.classList.add('sigil-pick');
        if (char.sigil === cp) token.classList.add('selected');
        if (used && char.sigil !== cp) token.classList.add('disabled');
        token.addEventListener('click', () => {
          if (used && char.sigil !== cp) return;
          state.usedSigils.delete(char.sigil);
          char.sigil = cp;
          state.usedSigils.add(cp);
          reflow();
        });
        sigilRow.appendChild(token);
      }
    }

    section.appendChild(sigilRow);
    panel.appendChild(section);
  }

  function renderAttributeSteppers(panel, char) {
    if (!char.classId) return;
    const section = document.createElement('div');
    section.className = 'creation-section';
    section.appendChild(Object.assign(document.createElement('h3'), { textContent: 'ATTRIBUTES' }));

    const cls = classesData.classes.find(c => c.id === char.classId);

    for (let i = 0; i < ATTR_KEYS.length; i++) {
      const key = ATTR_KEYS[i];
      const name = ATTR_NAMES[i];
      const rank = char.attributes[key] || 1;
      const cost = primaryAttributeCostReduction(cls, key) > 0 ? 0 : 1;
      const row = createAttributeRow(name, rank, {
        steppers: true,
        onDecrease: () => {
          if (rank > 1) {
            char.attributes[key] = rank - 1;
            reflow();
          }
        },
        onIncrease: () => {
          if (rank < 10 && getPointsRemaining() >= cost) {
            char.attributes[key] = rank + 1;
            reflow();
          }
        },
      });
      section.appendChild(row);
    }

    panel.appendChild(section);
  }

  function renderEquipmentPicker(panel, char) {
    if (!char.classId) return;
    const section = document.createElement('div');
    section.className = 'creation-section';
    section.appendChild(Object.assign(document.createElement('h3'), { textContent: 'EQUIPMENT' }));

    const cls = classesData.classes.find(c => c.id === char.classId);

    const weaponRow = document.createElement('div');
    weaponRow.className = 'equip-row';
    weaponRow.appendChild(Object.assign(document.createElement('span'), { textContent: 'WEAPON: ' }));
    const weaponSelect = document.createElement('select');
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— None —';
    weaponSelect.appendChild(noneOpt);
    for (const [wid, w] of Object.entries(equipmentData.weapons)) {
      if (!canEquipWeapon(cls, wid)) continue;
      const opt = document.createElement('option');
      opt.value = wid;
      opt.textContent = `${w.name} (${w.creationCost}pt)`;
      weaponSelect.appendChild(opt);
    }
    weaponSelect.value = char.equipment?.weapon || '';
    weaponSelect.addEventListener('change', () => {
      char.equipment.weapon = weaponSelect.value || null;
      reflow();
    });
    weaponRow.appendChild(weaponSelect);
    section.appendChild(weaponRow);

    const armorRow = document.createElement('div');
    armorRow.className = 'equip-row';
    armorRow.appendChild(Object.assign(document.createElement('span'), { textContent: 'ARMOR: ' }));
    const armorSelect = document.createElement('select');
    for (const [aid, a] of Object.entries(equipmentData.armor)) {
      if (!canEquipArmor(cls, aid)) continue;
      const opt = document.createElement('option');
      opt.value = aid;
      opt.textContent = `${a.name} (${a.creationCost}pt)`;
      armorSelect.appendChild(opt);
      if (char.equipment?.armor === aid) armorSelect.value = aid;
    }
    armorSelect.addEventListener('change', () => {
      char.equipment.armor = armorSelect.value;
      reflow();
    });
    armorRow.appendChild(armorSelect);
    section.appendChild(armorRow);

    panel.appendChild(section);
  }

  function renderProtocolPicker(panel, char) {
    if (!char.classId) return;
    const cls = classesData.classes.find(c => c.id === char.classId);
    const maxTier = maxProtocolTier(cls);
    const allowedSchools = cls.protocolGates.schools;

    const section = document.createElement('div');
    section.className = 'creation-section';
    section.appendChild(Object.assign(document.createElement('h3'), { textContent: 'PROTOCOLS' }));

    for (const schoolId of allowedSchools) {
      const school = protocolsData.schools[schoolId];
      if (!school) continue;

      const schoolRow = document.createElement('div');
      schoolRow.className = 'protocol-school-row';
      schoolRow.appendChild(Object.assign(document.createElement('span'), { textContent: school.name }));

      for (let t = 1; t <= Math.min(maxTier, school.tiers.length); t++) {
        const tier = school.tiers[t - 1];
        const isSelected = (char.protocols || []).some(p => p.school === schoolId && p.tier === t);
        const btn = createButton(tier.name, {
          onClick: () => {
            if (!char.protocols) char.protocols = [];
            const idx = char.protocols.findIndex(p => p.school === schoolId && p.tier === t);
            if (idx >= 0) {
              char.protocols.splice(idx, 1);
            } else {
              if (getPointsRemaining() < t) return;
              char.protocols.push({ school: schoolId, tier: t });
            }
            reflow();
          }
        });
        if (isSelected) btn.classList.add('selected');
        schoolRow.appendChild(btn);
      }

      section.appendChild(schoolRow);
    }

    panel.appendChild(section);
  }

  function renderProjectedStats(panel, char) {
    if (!char.classId) return;
    const section = document.createElement('div');
    section.className = 'creation-section';

    const cls = classesData.classes.find(c => c.id === char.classId);
    const stats = deriveStats(char, cls);

    const statsRow = document.createElement('div');
    statsRow.className = 'projected-stats';
    statsRow.textContent = `HP ${stats.hpMax} | CHG ${stats.chargeMax} | DEF ${stats.defenseBase} | INIT ${stats.initiativeMod >= 0 ? '+' : ''}${stats.initiativeMod} | LOS ${stats.detectionRadius}`;
    section.appendChild(statsRow);
    panel.appendChild(section);
  }

  function finalize() {
    if (!canFinalize()) return;

    const party = state.characters.map(c => {
      const cls = classesData.classes.find(cl => cl.id === c.classId);
      const stats = deriveStats(c, cls);
      const id = `${c.classId}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        id,
        classId: c.classId,
        name: cls.name,
        sigilCodepoint: c.sigil,
        sigilFamily: cls.sigilFamily,
        attributes: c.attributes,
        hp: stats.hpMax,
        hpMax: stats.hpMax,
        charge: stats.chargeMax,
        chargeMax: stats.chargeMax,
        chargeRegen: stats.chargeRegen,
        defense: stats.defenseBase,
        protocolDefense: stats.protocolDefenseBase,
        initiativeMod: stats.initiativeMod,
        detectionRadius: stats.detectionRadius,
        conditions: [],
        calibrationCount: 0,
        signatureTier: 1,
        equipment: c.equipment,
        weapon: c.equipment.weapon ? equipmentData.weapons[c.equipment.weapon] : null,
        armor: c.equipment.armor ? equipmentData.armor[c.equipment.armor] : null,
        protocols: c.protocols || [],
        corruption: 0,
      };
    });

    const credits = getCreditsFromRemaining();
    const runState = createRunState(worldSeed, party);
    runState.credits = credits;

    const genPRNG = createPRNG(worldSeed);
    const combatPRNG = generateFloorCombatPRNG(worldSeed);
    const rngCursor = createRNGCursor(genPRNG, combatPRNG);
    runState.rngState = rngCursor.getState();

    const floor = generateFloor(worldSeed, 1, rngCursor, gameData.themes);

    const blueprint = {
      characters: state.characters.map(c => ({
        classId: c.classId,
        sigilCodepoint: c.sigil,
        attributes: c.attributes,
        equipment: c.equipment,
        protocols: c.protocols,
      })),
    };
    for (const cfg of listConfigs()) {
      if (JSON.stringify(cfg.characters) === JSON.stringify(blueprint.characters)) {
        setLastUsed(cfg.name);
        break;
      }
    }

    bus.dispatch('ui:navigate', { screen: 'exploration', params: { runState, floor } });
  }

  reflow();

  return {
    unmount() {}
  };
}

function generateFloorCombatPRNG(worldSeed) {
  return createPRNG((worldSeed ^ 0xC0FFEE) >>> 0);
}