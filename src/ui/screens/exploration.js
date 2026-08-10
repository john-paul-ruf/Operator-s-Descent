import { createStatusBar } from '../status-strip.js';
import { createPlayfield } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { bus } from '../../state/bus.js';
import { moveParty } from '../../exploration/movement.js';
import { computeLOS, updateFogOfWar } from '../../exploration/shadowcast.js';
import { createLattice } from '../../exploration/lattice.js';

export function mount(container, params) {
  const { runState, floor } = params;
  const inputHandler = createInputHandler();
  inputHandler.bindToElement(container);

  const statusBar = createStatusBar(runState);
  container.appendChild(statusBar);

  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 768;
  container.appendChild(canvas);
  const playfield = createPlayfield(canvas);

  const lattice = createLattice(floor);
  const fogState = runState.fogOfWar;

  const state = { runState, floor, inputHandler, canvas, playfield };
  const consoleController = createConsole(state);
  container.appendChild(consoleController.render());

  playfield.setAccent('#7ec8e3');

  const partyPos = lattice.getPartyPosition();
  const losRadius = runState.party?.[0]?.attributes?.sig
    ? Math.max(1, runState.party[0].attributes.sig * 2)
    : 8;
  const visibleCells = computeLOS(lattice, partyPos.x, partyPos.y, losRadius);
  updateFogOfWar(fogState, visibleCells);
  playfield.renderExploration(lattice, fogState, lattice.getPartyPosition());

  function reRender() {
    playfield.renderExploration(lattice, fogState, lattice.getPartyPosition());
  }

  const actionCb = (action) => {
    if (action.startsWith('move-')) {
      const direction = action.replace('move-', '');
      const result = moveParty(lattice, fogState, direction, null, runState);
      if (result.moved) {
        reRender();
        bus.dispatch('state:danger-clock-tick', { progress: runState.dangerClockProgress });
        if (result.interruptType === 'hostile') {
          bus.dispatch('state:combat-start', { runState, floor, lattice });
        } else if (result.interruptType === 'descent') {
          bus.dispatch('state:floor-change', { runState });
        }
      }
    }
  };
  inputHandler.onAction(actionCb);

  bus.on('state:combat-end', (data) => {
    if (data?.result === 'victory') {
      reRender();
    }
  });

  return {
    unmount() {}
  };
}