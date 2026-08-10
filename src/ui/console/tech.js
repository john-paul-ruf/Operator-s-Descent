import { createButton, createProtocolCard, createChargeBar, createScrollArea } from '../components.js';

export function render(container, context) {
  container.innerHTML = '';
  const runState = context?.runState;
  if (!runState) {
    container.textContent = 'No data.';
    return;
  }

  const charSelector = document.createElement('div');
  charSelector.className = 'char-selector';
  let selectedIdx = 0;
  if (runState.party && runState.party.length > 0) {
    for (let i = 0; i < runState.party.length; i++) {
      const btn = createButton(runState.party[i].name || `C${i + 1}`, {
        onClick: () => { selectedIdx = i; renderTech(area, runState, i, context); }
      });
      charSelector.appendChild(btn);
    }
  }
  container.appendChild(charSelector);

  const area = createScrollArea();
  area.className = 'tech-area';
  container.appendChild(area);

  renderTech(area, runState, 0, context);
}

function renderTech(area, runState, charIdx, context) {
  area.innerHTML = '';
  const char = runState.party?.[charIdx];
  if (!char) return;

  if (char.charge !== undefined) {
    area.appendChild(createChargeBar(char.charge, char.chargeMax || char.charge));
  }

  const deckSlots = document.createElement('div');
  deckSlots.className = 'deck-slots';
  deckSlots.textContent = 'Deck Slots:';
  if (char.protocolDeck) {
    for (const proto of char.protocolDeck) {
      area.appendChild(createProtocolCard(proto, {
        onClick: () => context?.bus?.dispatch('tech:cast', { protocol: proto, charIdx })
      }));
    }
  }
  area.appendChild(deckSlots);

  if (char.availableProtocols) {
    const availArea = document.createElement('div');
    availArea.className = 'available-protocols';
    availArea.textContent = 'Available:';
    for (const proto of char.availableProtocols) {
      const card = createProtocolCard(proto, {
        onClick: () => context?.bus?.dispatch('tech:cast', { protocol: proto, charIdx })
      });
      availArea.appendChild(card);
    }
    area.appendChild(availArea);
  }

  const overclockBtn = createButton('OVERCLOCK', {
    onClick: () => context?.bus?.dispatch('tech:overclock', { charIdx })
  });
  area.appendChild(overclockBtn);
}

export function handleInput(event, context) {}