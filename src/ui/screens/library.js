import { listRuns, loadRun } from '../../state/library.js';
import { createButton, createPanel } from '../components.js';
import { bus } from '../../state/bus.js';

export function mount(container, params) {
  const runs = listRuns();

  const header = document.createElement('h2');
  header.className = 'display';
  header.textContent = 'RUN LIBRARY';
  container.appendChild(header);

  if (runs.length === 0) {
    const empty = createPanel();
    const msg = document.createElement('p');
    msg.textContent = 'No saved runs.';
    empty.appendChild(msg);
    container.appendChild(empty);
  } else {
    const scroll = document.createElement('div');
    scroll.className = 'scroll-area';

    for (const run of runs) {
      const row = document.createElement('div');
      row.className = 'run-row';

      const swatch = document.createElement('div');
      swatch.className = 'accent-swatch';
      swatch.style.background = '#7ec8e3';
      row.appendChild(swatch);

      const info = document.createElement('span');
      info.className = 'run-info';
      info.textContent = `SEED ${run.worldSeed} · D${run.depth}`;
      row.appendChild(info);

      const partyCount = document.createElement('span');
      partyCount.className = 'run-party-count';
      partyCount.textContent = `${run.partyCount || 0} members`;
      row.appendChild(partyCount);

      const ts = document.createElement('span');
      ts.className = 'run-timestamp';
      ts.textContent = new Date(run.timestamp || 0).toLocaleDateString();
      row.appendChild(ts);

      row.addEventListener('click', () => {
        const result = loadRun(run.key);
        if (result.success) {
          bus.dispatch('ui:navigate', { screen: 'exploration', params: { runState: result.runState, resume: true } });
        }
      });

      scroll.appendChild(row);
    }
    container.appendChild(scroll);
  }

  const actions = document.createElement('div');
  actions.className = 'library-actions';
  actions.appendChild(createButton('NEW RUN', {
    primary: true,
    onClick: () => bus.dispatch('ui:navigate', { screen: 'creation' })
  }));
  actions.appendChild(createButton('TITLE', {
    onClick: () => bus.dispatch('ui:navigate', { screen: 'title' })
  }));
  container.appendChild(actions);

  return { unmount() {} };
}
