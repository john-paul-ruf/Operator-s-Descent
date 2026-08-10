let safePool = null;

export function initGlitchSafePool(sigilsData) {
  const pool = sigilsData?.safeSubstitutionPool;
  if (pool) {
    safePool = [...pool.latin, ...pool.digits, ...pool.boxDrawing];
  }
}

function loadSafePool() {
  if (safePool) return safePool;
  safePool = [65, 66, 67, 48, 49, 50, 9472, 9473, 9474];
  return safePool;
}

const TIMINGS = {
  charSubstitution: { minCadence: 700, maxCadence: 1799, minDuration: 120, maxDuration: 349 },
  glitchBars: { minCadence: 350, maxCadence: 999, minDuration: 80, maxDuration: 249, firePercent: 40 },
  noiseLines: { minCadence: 1200, maxCadence: 3499, minDuration: 80, maxDuration: 299, firePercent: 30 },
  vhsEvents: { minCadence: 4000, maxCadence: 9999, minDuration: 80, maxDuration: 249 },
  elementJitter: { minCadence: 500, maxCadence: 1399, minDuration: 70, maxDuration: 199, firePercent: 30 },
  borderFlicker: { minCadence: 400, maxCadence: 1099, minDuration: 40, maxDuration: 159, firePercent: 35 },
  frameFlash: { minCadence: 1800, maxCadence: 4499, minDuration: 30, maxDuration: 89, firePercent: 12 }
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

export function createGlitchSystem() {
  const elements = [];
  let enabled = true;
  const timers = [];
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  } catch { reducedMotion = false; }

  function getEffectContainer() {
    return document.getElementById('crt-overlays');
  }

  function applyCharSubstitution(element, duration) {
    const pool = loadSafePool();
    const text = element.textContent;
    if (!text || text.length === 0) return;
    const numSwaps = 1 + Math.floor(Math.random() * 2);
    const swaps = [];
    const original = [];

    for (let i = 0; i < numSwaps; i++) {
      const idx = Math.floor(Math.random() * text.length);
      const replacement = pool[Math.floor(Math.random() * pool.length)];
      original.push({ idx, char: text[idx] });
      swaps.push({ idx, char: String.fromCharCode(replacement) });
    }

    let mutated = text;
    for (const s of swaps) {
      mutated = mutated.substring(0, s.idx) + s.char + mutated.substring(s.idx + 1);
    }
    element.textContent = mutated;
    element.classList.add('text-swapping');

    setTimeout(() => {
      let restored = element.textContent;
      for (const o of original) {
        restored = restored.substring(0, o.idx) + o.char + restored.substring(o.idx + 1);
      }
      element.textContent = restored;
      element.classList.remove('text-swapping');
    }, duration);
  }

  function applyGlitchBars(duration) {
    const container = getEffectContainer();
    if (!container) return;
    const bar = document.createElement('div');
    bar.className = 'glitch-bar';
    bar.style.cssText = `position:absolute;left:0;width:100%;height:${1 + Math.floor(Math.random() * 4)}px;top:${Math.random() * 100}%;background:rgba(126,200,227,${0.1 + Math.random() * 0.4});transform:translateX(${(Math.random() - 0.5) * 16}px);pointer-events:none;z-index:5;`;
    container.appendChild(bar);
    setTimeout(() => bar.remove(), duration);
  }

  function applyNoiseLines(duration) {
    const container = getEffectContainer();
    if (!container) return;
    const pool = loadSafePool();
    const line = document.createElement('div');
    line.className = 'noise-line';
    const numChars = 8 + Math.floor(Math.random() * 21);
    let text = '';
    for (let i = 0; i < numChars; i++) {
      text += String.fromCharCode(pool[Math.floor(Math.random() * pool.length)]);
    }
    line.textContent = text;
    line.style.cssText = `position:absolute;left:${Math.random() * 50}%;top:${Math.random() * 100}%;font-family:monospace;font-size:8px;color:rgba(126,200,227,0.4);letter-spacing:1px;pointer-events:none;z-index:5;white-space:nowrap;`;
    container.appendChild(line);
    setTimeout(() => line.remove(), duration);
  }

  function applyVhsEvents(element, duration) {
    if (!element || !element.style) return;
    const original = {
      filter: element.style.filter || '',
      transform: element.style.transform || ''
    };
    const chromaOffset = 2 + Math.floor(Math.random() * 3);
    const tearOffset = (Math.random() - 0.5) * 10;
    element.style.filter = `hue-rotate(${Math.random() * 360}deg) saturate(${1 + Math.random()})`;
    element.style.transform = `${original.transform} translateX(${tearOffset}px)`;
    element.classList.add('vhs-event');
    setTimeout(() => {
      element.style.filter = original.filter;
      element.style.transform = original.transform;
      element.classList.remove('vhs-event');
    }, duration);
  }

  function applyElementJitter(element, duration) {
    if (!element || !element.style) return;
    const dx = (Math.random() - 0.5) * 6;
    const dy = (Math.random() - 0.5) * 4;
    const original = element.style.transform || '';
    element.style.transform = `${original} translate(${dx}px, ${dy}px)`;
    setTimeout(() => {
      element.style.transform = original;
    }, duration);
  }

  function applyBorderFlicker(duration) {
    const container = getEffectContainer();
    if (!container) return;
    const flicker = document.createElement('div');
    flicker.style.cssText = `position:absolute;inset:0;box-shadow:inset 0 0 8px rgba(126,200,227,${0.5 + Math.random() * 0.4});pointer-events:none;z-index:6;`;
    container.appendChild(flicker);
    setTimeout(() => flicker.remove(), duration);
  }

  function applyFrameFlash(duration) {
    const container = getEffectContainer();
    if (!container) return;
    const flash = document.createElement('div');
    flash.style.cssText = `position:absolute;inset:0;background:rgba(255,0,255,0.05);pointer-events:none;z-index:7;`;
    container.appendChild(flash);
    setTimeout(() => flash.remove(), duration);
  }

  function scheduleNext(element, effectType, intensity) {
    if (!enabled || reducedMotion) return;
    const timing = TIMINGS[effectType];
    const cadence = randomBetween(timing.minCadence, timing.maxCadence);
    const effectiveIntensity = effectType === 'charSubstitution' ? intensity : 1;

    const id = setTimeout(() => {
      if (!enabled || reducedMotion) return;
      if (!element || !element.isConnected) return;

      if (timing.firePercent && Math.random() * 100 > timing.firePercent) {
        scheduleNext(element, effectType, intensity);
        return;
      }

      if (effectType === 'charSubstitution' && Math.random() > effectiveIntensity) {
        scheduleNext(element, effectType, intensity);
        return;
      }

      const duration = randomBetween(timing.minDuration, timing.maxDuration);

      switch (effectType) {
        case 'charSubstitution': applyCharSubstitution(element, duration); break;
        case 'glitchBars': applyGlitchBars(duration); break;
        case 'noiseLines': applyNoiseLines(duration); break;
        case 'vhsEvents': applyVhsEvents(element, duration); break;
        case 'elementJitter': applyElementJitter(element, duration); break;
        case 'borderFlicker': applyBorderFlicker(duration); break;
        case 'frameFlash': applyFrameFlash(duration); break;
      }

      scheduleNext(element, effectType, intensity);
    }, cadence);

    timers.push(id);
  }

  return {
    registerElement(element, intensity = 0.1) {
      elements.push({ element, intensity });
      for (const effectType of Object.keys(TIMINGS)) {
        scheduleNext(element, effectType, intensity);
      }
    },
    start() { enabled = true; },
    stop() { enabled = false; for (const id of timers) clearTimeout(id); timers.length = 0; },
    setEnabled(value) {
      enabled = value && !reducedMotion;
      if (!enabled) {
        for (const { element } of elements) {
          if (element && element.classList) {
            element.classList.remove('text-swapping', 'vhs-event');
          }
        }
      }
    }
  };
}