import { createButton, createEquipmentCard, createScrollArea } from '../components.js';

export function render(container, context) {
  container.innerHTML = '';
  const lootState = context?.lootState;
  if (!lootState) {
    container.textContent = 'No container open.';
    return;
  }

  const header = document.createElement('div');
  header.className = 'loot-container-header';
  header.textContent = lootState.containerName || 'Container';
  container.appendChild(header);

  if (!lootState.items || lootState.items.length === 0) {
    container.appendChild(document.createTextNode('Empty.'));
    return;
  }

  const itemList = createScrollArea();
  itemList.className = 'loot-items';
  for (const item of lootState.items) {
    itemList.appendChild(createEquipmentCard(item, {
      onClick: () => context?.bus?.dispatch('loot:take', { item })
    }));
  }
  container.appendChild(itemList);

  const btnRow = document.createElement('div');
  btnRow.className = 'loot-actions';
  btnRow.appendChild(createButton('TAKE ALL', {
    primary: true,
    onClick: () => context?.bus?.dispatch('loot:take-all')
  }));
  container.appendChild(btnRow);

  if (context?.runState?.isInventoryFull?.()) {
    const warning = document.createElement('div');
    warning.className = 'inventory-full-warning';
    warning.textContent = 'INVENTORY FULL';
    container.appendChild(warning);
  }
}

export function handleInput(event, context) {}