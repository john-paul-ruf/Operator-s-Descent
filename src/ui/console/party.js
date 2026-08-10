import { createSigilToken, createHPBar, createChargeBar, createAttributeRow, createConditionTag, createScrollArea } from '../components.js';

const ATTR_NAMES = ['MGT', 'FIN', 'VIT', 'RES', 'FOC', 'SIG'];

export function render(container, context) {
  container.innerHTML = '';
  const runState = context?.runState;
  if (!runState?.party || runState.party.length === 0) {
    container.textContent = 'No party members.';
    return;
  }

  const memberList = document.createElement('div');
  memberList.className = 'member-list';
  let selectedIdx = 0;

  for (let i = 0; i < runState.party.length; i++) {
    const char = runState.party[i];
    const pill = document.createElement('div');
    pill.className = 'member-pill';
    pill.appendChild(createSigilToken(char.sigilCodepoint || 0xE000, 34));
    const name = document.createElement('span');
    name.textContent = char.name || char.classId || `C${i + 1}`;
    pill.appendChild(name);
    pill.addEventListener('click', () => {
      selectedIdx = i;
      renderDetail(detailArea, char, runState);
    });
    memberList.appendChild(pill);
  }
  container.appendChild(memberList);

  const detailArea = createScrollArea();
  detailArea.className = 'party-detail';
  container.appendChild(detailArea);

  renderDetail(detailArea, runState.party[0], runState);
}

function renderDetail(area, char, runState) {
  area.innerHTML = '';
  if (!char) return;

  const header = document.createElement('div');
  header.className = 'detail-header';
  header.appendChild(createSigilToken(char.sigilCodepoint || 0xE000, 72));
  area.appendChild(header);

  if (char.hp !== undefined) area.appendChild(createHPBar(char.hp, char.hpMax || char.hp));
  if (char.charge !== undefined) area.appendChild(createChargeBar(char.charge, char.chargeMax || char.charge));

  if (char.attributes) {
    for (let i = 0; i < ATTR_NAMES.length; i++) {
      const rank = char.attributes[ATTR_NAMES[i]] || char.attributes[i] || 5;
      area.appendChild(createAttributeRow(ATTR_NAMES[i], rank));
    }
  }

  if (char.conditions && char.conditions.length > 0) {
    const condArea = document.createElement('div');
    condArea.className = 'condition-list';
    for (const c of char.conditions) {
      condArea.appendChild(createConditionTag(c.id || c, c.duration));
    }
    area.appendChild(condArea);
  }

  const misc = document.createElement('div');
  misc.className = 'detail-misc';
  misc.textContent = `Corruption: ${runState.corruption || 0}  Credits: ${runState.credits || 0}  Scrap: ${runState.scrapCounter || 0}`;
  area.appendChild(misc);
}

export function handleInput(event, context) {}