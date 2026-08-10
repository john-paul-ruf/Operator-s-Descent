import { bus } from '../state/bus.js';
import { createSigilToken, createHPBar, createChargeBar } from './components.js';

export function createStatusBar(runState, combatState = null) {
  const strip = document.createElement('div');
  strip.className = 'status-strip';

  const depthEl = document.createElement('span');
  depthEl.className = 'status-depth';
  depthEl.textContent = `D${runState.depth}`;
  strip.appendChild(depthEl);

  if (combatState) {
    const roundEl = document.createElement('span');
    roundEl.className = 'status-round';
    roundEl.textContent = `R${combatState.round || 1}`;
    strip.appendChild(roundEl);

    if (combatState.combatants && combatState.activeIndex !== undefined) {
      const active = combatState.combatants[combatState.activeIndex];
      if (active) {
        const sigil = createSigilToken(active.sigilCodepoint || 0xE000, 34);
        sigil.classList.add('status-active-sigil');
        strip.appendChild(sigil);
        if (active.hp !== undefined && active.hpMax !== undefined) {
          strip.appendChild(createHPBar(active.hp, active.hpMax));
        }
        if (active.charge !== undefined && active.chargeMax !== undefined) {
          strip.appendChild(createChargeBar(active.charge, active.chargeMax));
        }
      }
    }
  } else {
    const clkEl = document.createElement('span');
    clkEl.className = 'status-clock';
    clkEl.textContent = `CLK ${runState.dangerClockProgress?.toFixed(2) || '0.00'}`;
    strip.appendChild(clkEl);

    if (runState.party && runState.party.length > 0) {
      for (const char of runState.party) {
        const sigil = createSigilToken(char.sigilCodepoint || 0xE000, 34);
        strip.appendChild(sigil);
        if (char.hp !== undefined && char.hpMax !== undefined) {
          const hpBar = createHPBar(char.hp, char.hpMax);
          hpBar.classList.add('status-mini-hp');
          strip.appendChild(hpBar);
        }
      }
    }

    const updateClock = () => {
      clkEl.textContent = `CLK ${runState.dangerClockProgress?.toFixed(2) || '0.00'}`;
    };
    bus.on('state:danger-clock-tick', updateClock);
  }

  return strip;
}