import { createButton, createScrollArea } from '../components.js';

const EVENT_TYPES = {
  combat: '#e83a3a',
  discovery: '#2ed4c1',
  damage: '#e8c63a',
  death: '#ff0040',
  heal: '#7ec8e3',
  info: '#aaa',
  move: '#888'
};

export function render(container, context) {
  container.innerHTML = '';
  const logs = context?.logEntries || [];

  const logArea = createScrollArea();
  logArea.className = 'log-area';

  for (const entry of logs) {
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.style.color = EVENT_TYPES[entry.type] || EVENT_TYPES.info;
    const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
    el.textContent = `[${ts}] ${entry.message}`;
    logArea.appendChild(el);
  }

  if (logs.length === 0) {
    logArea.textContent = 'No events logged.';
  }

  container.appendChild(logArea);

  const copyBtn = createButton('COPY LINK', {
    onClick: async () => {
      try {
        const url = window.location.href;
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
        }
        const feedback = document.createElement('span');
        feedback.textContent = ' LINK COPIED';
        feedback.style.color = '#2ed4c1';
        feedback.style.fontWeight = 'bold';
        copyBtn.parentNode?.appendChild(feedback);
        setTimeout(() => feedback.remove(), 2000);
      } catch {}
    }
  });
  container.appendChild(copyBtn);
}

export function handleInput(event, context) {}