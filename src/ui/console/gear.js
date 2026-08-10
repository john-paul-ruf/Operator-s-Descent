import { createButton, createEquipmentCard, createScrollArea } from '../components.js';

export function render(container, context) {
  container.innerHTML = '';
  const runState = context?.runState;
  if (!runState) {
    container.textContent = 'No data.';
    return;
  }

  const charSelector = document.createElement('div');
  charSelector.className = 'char-selector';
  if (runState.party && runState.party.length > 0) {
    for (let i = 0; i < runState.party.length; i++) {
      const btn = createButton(runState.party[i].name || `C${i + 1}`, {
        onClick: () => renderGear(area, runState, i, context)
      });
      charSelector.appendChild(btn);
    }
  }
  container.appendChild(charSelector);

  const area = createScrollArea();
  area.className = 'gear-area';
  container.appendChild(area);

  renderGear(area, runState, 0, context);
}

function renderGear(area, runState, charIdx, context) {
  area.innerHTML = '';
  const char = runState.party?.[charIdx];
  if (!char) return;

  const equipped = document.createElement('div');
  equipped.className = 'equipped-section';
  equipped.textContent = 'Equipped:';
  if (char.equipment) {
    if (char.equipment.weapon) {
      equipped.appendChild(createEquipmentCard(char.equipment.weapon, {
        onClick: () => context?.bus?.dispatch('gear:unequip', { slot: 'weapon', charIdx })
      }));
    }
    if (char.equipment.armor) {
      equipped.appendChild(createEquipmentCard(char.equipment.armor));
    }
  }
  area.appendChild(equipped);

  const invHeader = document.createElement('div');
  invHeader.className = 'inventory-header';
  const count = runState.getInventoryCount?.() || runState.inventory?.length || 0;
  invHeader.textContent = `Inventory (${count}/100)`;
  area.appendChild(invHeader);

  const invList = document.createElement('div');
  invList.className = 'inventory-list';
  if (runState.inventory) {
    for (const item of runState.inventory) {
      const card = createEquipmentCard(item, {
        onClick: () => context?.bus?.dispatch('gear:equip', { item, charIdx })
      });
      if (item.junkTagged) card.classList.add('junk-tagged');
      invList.appendChild(card);
    }
  }
  area.appendChild(invList);

  const scrapEl = document.createElement('div');
  scrapEl.className = 'scrap-counter';
  scrapEl.textContent = `Scrap: ${runState.scrapCounter || 0}`;
  area.appendChild(scrapEl);

  const junkBtn = createButton('JUNK ALL TAGGED', {
    danger: true,
    onClick: () => context?.bus?.dispatch('gear:junk-all')
  });
  area.appendChild(junkBtn);
}

export function handleInput(event, context) {}