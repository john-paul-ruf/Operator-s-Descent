// Audio Audition Rig — dev-only ear-test harness. Not shipped.
// Boots the real createAudioEngine and steers it via the same signals
// src/ui/screens/exploration.js dispatches to `audio:update-state`.
//
// Rule 12: nothing under src/, index.html, service-worker.js, or
// PRODUCTION_ASSETS references this file. It only exists at dev time.

import { createAudioEngine } from '../../src/audio/engine.js';

const els = {
  status: document.querySelector('[data-testid="rig-status"]'),
  startGate: document.querySelector('[data-testid="start-gate"]'),
  startButton: document.querySelector('[data-testid="start-button"]'),
  controls: document.querySelector('[data-testid="controls"]'),
  readout: document.querySelector('[data-testid="graph-readout"]'),
  demoButton: document.querySelector('[data-testid="descend-demo"]'),
  demoTimer: document.querySelector('[data-testid="demo-timer"]'),
  master: document.querySelector('#master-volume'),
  masterMute: document.querySelector('#master-mute'),
  layerSliders: Array.from(document.querySelectorAll('[data-layer]')),
  seed: document.querySelector('#seed'),
  theme: document.querySelector('#theme'),
  depth: document.querySelector('#depth'),
  hostile: document.querySelector('#hostile-dist'),
  container: document.querySelector('#container-dist'),
  combat: document.querySelector('#combat'),
};

const state = {
  seed: 7,
  audioMode: null,
  themeObject: null,
  depth: 1,
  hostile: 10,
  container: 10,
  combat: false,
};

let engine = null;
let audioContext = null;
let readoutTimer = null;
let demoTimer = null;
let themes = [];

function setStatus(text, running) {
  els.status.textContent = text;
  els.status.classList.toggle('is-running', Boolean(running));
}

function setValueDisplay(id, text) {
  const node = document.querySelector(`[data-value-for="${id}"]`);
  if (node) node.textContent = text;
}

// Mirrors src/ui/screens/exploration.js pushAudioProximity field-for-field.
// theme is the full theme object (nulls to { audioMode } if themes.json failed
// to load) — engine layers can consume either `theme.audioMode` or the flat
// `audioMode` field.
function buildPayload() {
  const audioMode = state.audioMode;
  const theme = state.themeObject
    ? { ...state.themeObject }
    : (audioMode ? { audioMode } : null);
  return {
    worldSeed: state.seed,
    depth: state.depth,
    floorId: `${state.seed}:${state.depth}:0`,
    theme,
    audioMode,
    proximity: { hostile: state.hostile, container: state.container },
    nearestHostileDistance: state.hostile,
    nearestContainerDistance: state.container,
    combatActive: state.combat,
  };
}

function pushState() {
  if (!engine) return;
  engine.updateState(buildPayload());
}

function refreshReadout() {
  if (!engine) return;
  try {
    els.readout.textContent = JSON.stringify(engine.getGraphState(), null, 1);
  } catch (err) {
    els.readout.textContent = `getGraphState() threw: ${err?.message ?? err}`;
  }
}

async function loadThemes() {
  try {
    const response = await fetch('../../data/themes.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    themes = Array.isArray(data?.themes) ? data.themes : [];
    els.theme.replaceChildren();
    for (const theme of themes) {
      const option = document.createElement('option');
      option.value = theme.audioMode || theme.id;
      option.textContent = `${theme.name} — ${theme.audioMode}`;
      els.theme.appendChild(option);
    }
    if (themes.length > 0) {
      state.themeObject = themes[0];
      state.audioMode = themes[0].audioMode;
      els.theme.value = state.audioMode;
      setValueDisplay('theme', state.audioMode);
    }
  } catch (err) {
    themes = [];
    const option = document.createElement('option');
    option.value = 'cold-ambient';
    option.textContent = '(themes.json unavailable — using cold-ambient)';
    els.theme.replaceChildren(option);
    state.audioMode = 'cold-ambient';
    state.themeObject = { audioMode: 'cold-ambient' };
    setValueDisplay('theme', state.audioMode);
    console.warn('[audition] failed to load themes.json:', err);
  }
}

function wireMixer() {
  els.master.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    setValueDisplay('master-volume', String(value));
    if (engine) engine.setMasterVolume(value);
  });
  els.masterMute.addEventListener('change', (event) => {
    const muted = event.target.checked;
    setValueDisplay('master-mute', muted ? 'on' : 'off');
    if (engine) engine.setMute(muted);
  });
  for (const slider of els.layerSliders) {
    slider.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      const layer = event.target.dataset.layer;
      setValueDisplay(event.target.id, String(value));
      if (engine) engine.setLayerVolume(layer, value);
    });
  }
}

function wireGameStateControls() {
  els.seed.addEventListener('input', (event) => {
    const value = Math.max(0, Math.floor(Number(event.target.value) || 0));
    state.seed = value;
    setValueDisplay('seed', String(value));
    pushState();
  });
  els.theme.addEventListener('change', (event) => {
    const audioMode = event.target.value;
    state.audioMode = audioMode;
    state.themeObject = themes.find((t) => t.audioMode === audioMode) || { audioMode };
    setValueDisplay('theme', audioMode);
    pushState();
  });
  els.depth.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    state.depth = value;
    setValueDisplay('depth', String(value));
    pushState();
  });
  els.hostile.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    state.hostile = value;
    setValueDisplay('hostile-dist', String(value));
    pushState();
  });
  els.container.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    state.container = value;
    setValueDisplay('container-dist', String(value));
    pushState();
  });
  els.combat.addEventListener('change', (event) => {
    state.combat = event.target.checked;
    setValueDisplay('combat', state.combat ? 'on' : 'off');
    pushState();
  });
}

function syncControlsFromState() {
  els.seed.value = String(state.seed);
  setValueDisplay('seed', String(state.seed));
  els.depth.value = String(state.depth);
  setValueDisplay('depth', String(state.depth));
  els.hostile.value = String(state.hostile);
  setValueDisplay('hostile-dist', String(state.hostile));
  els.container.value = String(state.container);
  setValueDisplay('container-dist', String(state.container));
  els.combat.checked = state.combat;
  setValueDisplay('combat', state.combat ? 'on' : 'off');
  if (state.audioMode) {
    els.theme.value = state.audioMode;
    setValueDisplay('theme', state.audioMode);
  }
}

function stopDemo(reason) {
  if (demoTimer !== null) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
  els.demoButton.disabled = false;
  els.demoTimer.textContent = reason || 'idle';
}

// 60s hands-free audition: depth+1 every 8s (new floorId), hostile sweeps
// 10→1→10 across the interval, combat pulses on for 6s at the midpoint.
function startDemo() {
  if (!engine || demoTimer !== null) return;
  const durationMs = 60_000;
  const stepMs = 250;
  const combatStartMs = 27_000;
  const combatEndMs = 33_000;
  const depthStepMs = 8_000;
  const initialDepth = state.depth;
  const half = durationMs / 2;
  const startedAt = performance.now();

  els.demoButton.disabled = true;
  els.demoTimer.textContent = '0.0s / 60s';

  const tick = () => {
    const elapsed = performance.now() - startedAt;
    if (elapsed >= durationMs) {
      state.combat = false;
      syncControlsFromState();
      pushState();
      stopDemo('done');
      return;
    }
    const depthOffset = Math.floor(elapsed / depthStepMs);
    state.depth = Math.min(30, initialDepth + depthOffset);
    const t = elapsed <= half ? elapsed / half : (durationMs - elapsed) / half;
    // Sweep 10 → 1 → 10: at t=0 hostile=10, at t=1 hostile=1.
    state.hostile = Math.max(0, Math.min(10, Math.round(10 - t * 9)));
    state.combat = elapsed >= combatStartMs && elapsed < combatEndMs;
    syncControlsFromState();
    pushState();
    els.demoTimer.textContent = `${(elapsed / 1000).toFixed(1)}s / 60s`;
  };
  demoTimer = setInterval(tick, stepMs);
  tick();
}

function boot() {
  if (engine) return;
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) throw new Error('WebAudio unavailable in this browser');
    audioContext = new Ctx();
    engine = createAudioEngine(audioContext);
    const started = engine.start();
    if (!started) throw new Error('engine.start() returned false');
    engine.setMasterVolume(Number(els.master.value));
    engine.setMute(els.masterMute.checked);
    for (const slider of els.layerSliders) {
      engine.setLayerVolume(slider.dataset.layer, Number(slider.value));
    }
    pushState();
    els.startGate.hidden = true;
    els.controls.hidden = false;
    setStatus('RUNNING', true);
    refreshReadout();
    readoutTimer = setInterval(refreshReadout, 500);
  } catch (err) {
    setStatus(`FAILED — ${err?.message ?? err}`, false);
    console.error('[audition] boot failed:', err);
    if (audioContext?.close) audioContext.close().catch(() => {});
    audioContext = null;
    engine = null;
  }
}

wireMixer();
wireGameStateControls();
els.startButton.addEventListener('click', boot);
els.demoButton.addEventListener('click', startDemo);
loadThemes();
