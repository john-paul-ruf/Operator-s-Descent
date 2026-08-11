let safePool = null;

const PLAYER_BANK_START = 0xE000;
const BESTIARY_BANK_END = 0xE048;

export const GLITCH_TIMINGS = Object.freeze({
  charSubstitution: { minCadence: 700, maxCadence: 1799, minDuration: 120, maxDuration: 349 },
  glitchBars: { minCadence: 350, maxCadence: 999, minDuration: 80, maxDuration: 249, firePercent: 40 },
  noiseLines: { minCadence: 1200, maxCadence: 3499, minDuration: 80, maxDuration: 299, firePercent: 30 },
  vhsEvents: { minCadence: 4000, maxCadence: 9999, minDuration: 80, maxDuration: 249 },
  elementJitter: { minCadence: 500, maxCadence: 1399, minDuration: 70, maxDuration: 199, firePercent: 30 },
  borderFlicker: { minCadence: 400, maxCadence: 1099, minDuration: 40, maxDuration: 159, firePercent: 35 },
  frameFlash: { minCadence: 1800, maxCadence: 4499, minDuration: 30, maxDuration: 89, firePercent: 12 }
});

const EFFECTS = Object.keys(GLITCH_TIMINGS);

export function initGlitchSafePool(sigilsData) {
  const pool = sigilsData?.safeSubstitutionPool;
  if (pool) safePool = [...pool.latin, ...pool.digits, ...pool.boxDrawing];
}

export function resolveMotionPolicy(settings = {}, media = globalThis.window?.matchMedia) {
  const manual = settings.reducedMotion;
  if (manual === 'reduce' || manual === true) return { reduced: true, source: 'manual' };
  if (manual === 'full') return { reduced: false, source: 'manual' };
  let system = false;
  try { system = Boolean(media?.('(prefers-reduced-motion: reduce)')?.matches); } catch { system = false; }
  return { reduced: system, source: 'system' };
}

function loadSafePool() {
  if (safePool) return safePool;
  safePool = [65, 66, 67, 48, 49, 50, 9472, 9473, 9474];
  return safePool;
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function hasReservedSigil(text) {
  return [...text].some((char) => {
    const codepoint = char.codePointAt(0);
    return codepoint >= PLAYER_BANK_START && codepoint < BESTIARY_BANK_END;
  });
}

function isProtected(element, decisionPending) {
  if (!decisionPending) return false;
  if (element?.dataset?.glitchProtected === 'true' || element?.dataset?.decisionPending === 'true') return true;
  if (typeof element?.matches === 'function' && element.matches('button,input,textarea,select,[role="button"],[aria-disabled],[data-decision-pending="true"]')) return true;
  return ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName);
}

function addTimer(timers, id, clear, owner = null) {
  const timer = { id, clear: () => clear.call(globalThis, id) };
  timers.add(timer);
  owner?.timers?.add(timer);
}

function clearTimers(timers) {
  for (const timer of timers) timer.clear();
  timers.clear();
}

export function createGlitchSystem(options = {}) {
  const elements = new Map();
  const timers = new Set();
  let enabled = options.enabled !== false;
  let decisionPending = false;
  let reducedMotion = resolveMotionPolicy(options.settings || {}).reduced;

  function overlay() {
    return options.overlay || document.getElementById?.('crt-overlays');
  }

  function active() {
    return enabled && !reducedMotion;
  }

  function restoreText(element, original) {
    if (!element?.isConnected && element?.isConnected !== undefined) return;
    element.textContent = original;
    element.dataset.ghostText = original;
    element.classList?.remove('text-swapping');
    element.style.transform = element.dataset.glitchOriginalTransform || '';
  }

  function applyCharSubstitution(element, timing) {
    if (isProtected(element, decisionPending)) return;
    const original = element.textContent || '';
    if (!original || hasReservedSigil(original)) return;
    const pool = loadSafePool();
    const count = randomInt(1, Math.min(2, original.length));
    const chars = [...original];
    for (let i = 0; i < count; i++) chars[randomInt(0, chars.length - 1)] = String.fromCodePoint(pool[randomInt(0, pool.length - 1)]);
    element.dataset.glitchOriginalTransform = element.style?.transform || '';
    element.dataset.ghostText = chars.join('');
    element.textContent = chars.join('');
    element.classList?.add('text-swapping');
    if (element.style) element.style.transform = `${element.dataset.glitchOriginalTransform} translate(${randomInt(-3, 3)}px, ${randomInt(-1, 1)}px)`;
    const id = setTimeout(() => restoreText(element, original), randomInt(timing.minDuration, timing.maxDuration));
    addTimer(timers, id, clearTimeout);
  }

  function appendTimedNode(className, duration, styleText, text = '') {
    const container = overlay();
    if (!container) return;
    const node = document.createElement('div');
    node.className = className;
    node.textContent = text;
    node.style.cssText = styleText;
    container.appendChild(node);
    const id = setTimeout(() => node.remove?.(), duration);
    addTimer(timers, id, clearTimeout);
  }

  function applyGlobalEffect(type, duration) {
    if (decisionPending && (type === 'frameFlash' || type === 'glitchBars')) return;
    if (type === 'glitchBars') appendTimedNode('glitch-bar', duration, `position:absolute;left:0;width:100%;height:${randomInt(1, 4)}px;top:${randomInt(0, 100)}%;background:rgba(126,200,227,${(0.1 + Math.random() * 0.4).toFixed(2)});transform:translateX(${randomInt(-8, 8)}px);pointer-events:none;z-index:5;mix-blend-mode:screen;`);
    if (type === 'noiseLines') {
      const pool = loadSafePool();
      const text = Array.from({ length: randomInt(8, 28) }, () => String.fromCodePoint(pool[randomInt(0, pool.length - 1)])).join('');
      appendTimedNode('noise-line', duration, `position:absolute;left:${randomInt(0, 50)}%;top:${randomInt(0, 100)}%;font-family:monospace;font-size:8px;color:rgba(126,200,227,0.4);letter-spacing:1px;pointer-events:none;z-index:5;white-space:nowrap;`, text);
    }
    if (type === 'borderFlicker') appendTimedNode('border-flicker', duration, `position:absolute;inset:0;opacity:${(0.5 + Math.random() * 0.4).toFixed(2)};box-shadow:inset 0 0 8px rgba(126,200,227,0.8);pointer-events:none;z-index:6;`);
    if (type === 'frameFlash') appendTimedNode('frame-flash', duration, 'position:absolute;inset:0;background:rgba(255,0,255,0.05);pointer-events:none;z-index:7;');
  }

  function applyElementEffect(type, element, timing) {
    if (isProtected(element, decisionPending)) return;
    if (type === 'charSubstitution') return applyCharSubstitution(element, timing);
    if (type === 'vhsEvents' && element.style) {
      const originalFilter = element.style.filter || '';
      const originalTransform = element.style.transform || '';
      element.style.filter = `drop-shadow(${randomInt(-4, 4)}px 0 rgba(255,0,0,0.47)) drop-shadow(${randomInt(-4, 4)}px 0 rgba(0,0,255,0.47))`;
      element.style.transform = `${originalTransform} translate(${randomInt(-2, 2)}px, 0)`;
      element.classList?.add('vhs-event');
      const id = setTimeout(() => {
        element.style.filter = originalFilter;
        element.style.transform = originalTransform;
        element.classList?.remove('vhs-event');
      }, randomInt(timing.minDuration, timing.maxDuration));
      addTimer(timers, id, clearTimeout);
    }
    if (type === 'elementJitter' && element.style) {
      const original = element.style.transform || '';
      element.style.transform = `${original} translate(${randomInt(-3, 3)}px, ${randomInt(-2, 2)}px)`;
      const id = setTimeout(() => { element.style.transform = original; }, randomInt(timing.minDuration, timing.maxDuration));
      addTimer(timers, id, clearTimeout);
    }
  }

  function tick(record, type) {
    if (!active()) return;
    const { element, intensity, cadences } = record;
    if (!element?.isConnected && element?.isConnected !== undefined) return;
    const timing = GLITCH_TIMINGS[type];
    if (timing.firePercent && Math.random() * 100 >= timing.firePercent) return;
    if (type === 'charSubstitution' && Math.random() > intensity) return;
    const duration = randomInt(timing.minDuration, timing.maxDuration);
    if (['glitchBars', 'noiseLines', 'borderFlicker', 'frameFlash'].includes(type)) applyGlobalEffect(type, duration);
    else applyElementEffect(type, element, timing);
    record.lastCadence = cadences[type];
  }

  function schedule(record) {
    for (const type of EFFECTS) {
      const timing = GLITCH_TIMINGS[type];
      const cadence = randomInt(timing.minCadence, timing.maxCadence);
      record.cadences[type] = cadence;
      const id = setInterval(() => tick(record, type), cadence);
      addTimer(timers, id, clearInterval, record);
    }
  }

  return {
    registerElement(element, intensity = 0.1) {
      const record = { element, intensity: Math.max(0, Math.min(1, intensity)), cadences: {}, timers: new Set() };
      elements.set(element, record);
      if (active()) schedule(record);
      return () => this.unregisterElement(element);
    },
    unregisterElement(element) {
      const record = elements.get(element);
      if (record) {
        for (const timer of record.timers) {
          timer.clear();
          timers.delete(timer);
        }
        record.timers.clear();
      }
      elements.delete(element);
      if (element?.dataset) delete element.dataset.ghostText;
      element?.classList?.remove('text-swapping', 'vhs-event');
    },
    start() {
      enabled = true;
      if (!active()) return;
      clearTimers(timers);
      for (const record of elements.values()) schedule(record);
    },
    stop() {
      enabled = false;
      clearTimers(timers);
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) this.stop();
      else this.start();
    },
    setDecisionPending(value) { decisionPending = Boolean(value); },
    setMotionSettings(settings) {
      reducedMotion = resolveMotionPolicy(settings).reduced;
      if (reducedMotion) clearTimers(timers);
      else if (enabled) this.start();
    },
    getRegisteredCadences(element) { return { ...(elements.get(element)?.cadences || {}) }; },
    isEnabled() { return active(); },
    destroy() {
      clearTimers(timers);
      elements.clear();
    }
  };
}
