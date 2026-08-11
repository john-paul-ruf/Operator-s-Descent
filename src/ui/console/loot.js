import { createButton, createEquipmentCard, createScrollArea } from '../components.js';

function clear(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else while (container.firstChild) container.removeChild(container.firstChild);
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

export function render(container, context = {}) {
  clear(container);
  const lootState = context.lootState || (context.lattice ? { container: findEligibleLootContainer(context.lattice, context.runState), items: [] } : null);
  const lootContainer = lootState?.container;
  if (!lootContainer) {
    const empty = document.createElement('div');
    empty.className = 'loot-container empty console-row';
    empty.dataset.testid = 'loot-empty';
    empty.textContent = 'No unopened container adjacent or underfoot.';
    container.appendChild(empty);
    return;
  }

  const header = document.createElement('div');
  header.className = 'loot-container-header console-row';
  header.dataset.testid = 'loot-container';
  header.textContent = `CONTAINER ${lootContainer.id} · ${isOpened(context.runState, lootContainer) ? 'OPENED' : 'UNOPENED'}`;
  container.appendChild(header);

  const items = Array.isArray(lootState.items) ? lootState.items : [];
  if (!items.length) {
    const shell = document.createElement('div');
    shell.className = 'loot-container empty console-row';
    shell.dataset.testid = 'loot-shell';
    shell.textContent = isOpened(context.runState, lootContainer) ? 'Empty.' : 'Contents pending deterministic loot handoff.';
    container.appendChild(shell);
  } else {
    const itemList = createScrollArea({ label: 'Container contents', focusable: true });
    itemList.className = 'loot-items';
    for (const item of items) {
      itemList.appendChild(createEquipmentCard(item, { onClick: () => context.bus?.dispatch('loot:take', { item, container: lootContainer }) }));
    }
    container.appendChild(itemList);
  }

  const button = createButton(isOpened(context.runState, lootContainer) ? 'OPENED' : 'OPEN CONTAINER', {
    primary: true,
    disabled: isOpened(context.runState, lootContainer),
    onClick: () => context.bus?.dispatch('loot:open-request', { runState: context.runState, floor: context.floor, container: lootContainer })
  });
  button.dataset.testid = 'loot-open';
  container.appendChild(button);
}

export function handleInput(event, context = {}) {
  if (event.action !== 'confirm') return null;
  const container = context.lootState?.container || findEligibleLootContainer(context.lattice, context.runState);
  if (!container) return false;
  context.bus?.dispatch('loot:open-request', { runState: context.runState, floor: context.floor, container });
  return true;
}
