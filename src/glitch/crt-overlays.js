const SAFE_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789░▒▓█▀▄';

const LAYER_CLASSES = [
  'crt-grille',
  'crt-vignette',
  'crt-tracking',
  'crt-scanlines',
  'crt-grain',
  'crt-border',
  'crt-flash'
];

export function createCRTOverlays({ container, enabled = true } = {}) {
  if (!container) throw new Error('createCRTOverlays: container is required');

  let mounted = false;
  let active = enabled;
  const timers = new Set();
  let glitchBarsEl = null;
  let noiseLinesEl = null;
  let vhsEl = null;

  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  function scheduleGlitchBar() {
    const delay = 350 + Math.random() * 649;
    const id = setTimeout(() => {
      timers.delete(id);
      if (active && glitchBarsEl) {
        if (Math.random() < 0.40) {
          const bar = document.createElement('div');
          bar.className = 'glitch-bar';
          bar.style.cssText = `top: ${Math.random() * 100}%; height: ${1 + Math.floor(Math.random() * 4)}px; opacity: ${0.1 + Math.random() * 0.4}; transform: translateX(${-8 + Math.floor(Math.random() * 17)}px);`;
          glitchBarsEl.appendChild(bar);
          const lifeId = setTimeout(() => {
            timers.delete(lifeId);
            bar.remove();
          }, 80 + Math.random() * 169);
          timers.add(lifeId);
        }
      }
      if (active) scheduleGlitchBar();
    }, delay);
    timers.add(id);
  }

  function scheduleNoiseLine() {
    const delay = 1200 + Math.random() * 2299;
    const id = setTimeout(() => {
      timers.delete(id);
      if (active && noiseLinesEl) {
        if (Math.random() < 0.30) {
          const line = document.createElement('div');
          line.className = 'noise-line';
          let noise = '';
          const len = (8 + Math.floor(Math.random() * 21)) * 4;
          for (let i = 0; i < len; i++) noise += SAFE_POOL[Math.floor(Math.random() * SAFE_POOL.length)];
          line.style.cssText = `top: ${Math.random() * 100}%;`;
          line.textContent = noise;
          noiseLinesEl.appendChild(line);
          const lifeId = setTimeout(() => {
            timers.delete(lifeId);
            line.remove();
          }, 80 + Math.random() * 219);
          timers.add(lifeId);
        }
      }
      if (active) scheduleNoiseLine();
    }, delay);
    timers.add(id);
  }

  function scheduleVHSEvent() {
    const delay = 4000 + Math.random() * 5999;
    const id = setTimeout(() => {
      timers.delete(id);
      if (active && vhsEl) {
        vhsEl.classList.add('active');
        const lifeId = setTimeout(() => {
          timers.delete(lifeId);
          vhsEl.classList.remove('active');
        }, 80 + Math.random() * 169);
        timers.add(lifeId);
      }
      if (active) scheduleVHSEvent();
    }, delay);
    timers.add(id);
  }

  function mount() {
    if (mounted) return;
    mounted = true;

    for (const cls of LAYER_CLASSES) {
      const div = document.createElement('div');
      div.className = cls;
      container.appendChild(div);
    }

    glitchBarsEl = document.createElement('div');
    glitchBarsEl.className = 'crt-glitch-bars';
    glitchBarsEl.id = 'crt-glitch-bars';
    container.appendChild(glitchBarsEl);

    noiseLinesEl = document.createElement('div');
    noiseLinesEl.className = 'crt-noise-lines';
    noiseLinesEl.id = 'crt-noise-lines';
    container.appendChild(noiseLinesEl);

    vhsEl = document.createElement('div');
    vhsEl.className = 'crt-vhs';
    vhsEl.id = 'crt-vhs';
    container.appendChild(vhsEl);

    if (active) {
      scheduleGlitchBar();
      scheduleNoiseLine();
      scheduleVHSEvent();
    } else {
      container.style.display = 'none';
    }
  }

  function unmount() {
    clearTimers();
    container.replaceChildren();
    glitchBarsEl = null;
    noiseLinesEl = null;
    vhsEl = null;
    mounted = false;
  }

  function setEnabled(value) {
    active = Boolean(value);
    if (!mounted) return;
    if (active) {
      container.style.display = '';
      clearTimers();
      scheduleGlitchBar();
      scheduleNoiseLine();
      scheduleVHSEvent();
    } else {
      clearTimers();
      container.style.display = 'none';
    }
  }

  return { mount, unmount, setEnabled };
}