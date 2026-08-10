import { createStatusBar } from '../status-strip.js';
import { createPlayfield } from '../playfield.js';
import { createConsole } from '../console/console.js';
import { createInputHandler } from '../input.js';
import { bus } from '../../state/bus.js';
import { initiateCombat, resolveTurn } from '../../rules/combat.js';
import { gameData } from '../../main.js';

export function mount(container, params) {
  const { runState, floor, lattice, combatState: existingCombat } = params;
  const inputHandler = createInputHandler();
  inputHandler.bindToElement(container);

  const combatState = existingCombat || initiateCombat(
    runState.party,
    floor.enemySpawns || [],
    null
  );

  const statusBar = createStatusBar(runState, combatState);
  container.appendChild(statusBar);

  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 768;
  container.appendChild(canvas);
  const playfield = createPlayfield(canvas);
  playfield.setAccent('#7ec8e3');

  const state = { runState, combatState, inputHandler, canvas, playfield, lattice };
  const consoleController = createConsole(state);
  container.appendChild(consoleController.render());
  consoleController.setMode('combat');

  const zoomOrigin = lattice ? lattice.getPartyPosition() : { x: 10, y: 8 };
  playfield.renderCombat(combatState, lattice, zoomOrigin);

  const context = {
    protocolsData: gameData.protocols,
    conditionsData: gameData.conditions,
    consumablesData: gameData.consumables,
    lattice: lattice ? lattice.getGrid() : null,
  };

  const actionCb = (action) => {
    if (action !== 'confirm') return;

    const actorId = combatState.turnOrder[combatState.currentTurn];
    const actor = combatState.combatants.get(actorId);
    if (!actor || actor.side !== 'party') return;

    reRender();

    while (!combatState.ended) {
      const result = resolveTurn(combatState, null, context);
      reRender();
      if (result.ended) break;
    }

    if (combatState.result === 'victory') {
      bus.dispatch('state:combat-end', { runState, result: 'victory' });
    } else if (combatState.result === 'wipe') {
      bus.dispatch('state:party-wipe', { runState });
    }
  };
  inputHandler.onAction(actionCb);

  function reRender() {
    playfield.renderCombat(combatState, lattice, zoomOrigin);
  }

  return {
    unmount() {}
  };
}