import { createAudioEngine } from '../../src/audio/engine.js';
import { SCALES } from '../../src/audio/conductor.js';

const LAYER_NAMES = ['drone', 'pulse', 'sparkle', 'lead', 'noiseBed'];

const PRESETS = {
  calm:   { depth: 1,  hostile: 10, container: 10, combat: false },
  loot:   { depth: 3,  hostile: 10, container: 2,  combat: false },
  hunted: { depth: 5,  hostile: 2,  container: 10, combat: false },
  deep:   { depth: 25, hostile: 10, container: 10, combat: false },
  combat: { depth: 8,  hostile: 1,  container: 10, combat: true }
};

function createAuditionHarness(doc = document) {
  const $ = (id) => doc.getElementById(id);

  const themeSelect = $('theme');
  const depthInput = $('depth');
  const hostileInput = $('hostile');
  const containerInput = $('container');
  const combatCheckbox = $('combat');
  const seedInput = $('seed');
  const rerollButton = $('reroll');
  const muteCheckbox = $('mute');
  const masterInput = $('vol-master');
  const layerInputs = Object.fromEntries(LAYER_NAMES.map((name) => [name, $(`vol-${name}`)]));
  const startButton = $('start');
  const stopButton = $('stop');
  const statusLabel = $('engine-status');
  const telemetryPre = $('telemetry');
  const presetButtons = Array.from(doc.querySelectorAll('[data-preset]'));

  for (const mode of Object.keys(SCALES)) {
    const opt = doc.createElement('option');
    opt.value = mode;
    opt.textContent = mode;
    themeSelect.appendChild(opt);
  }
  themeSelect.value = 'flowing-cyan';

  const readValue = (input, fallback) => {
    const n = Number(input.value);
    return Number.isFinite(n) ? n : fallback;
  };

  const outputs = {
    depth: $('depth-out'),
    hostile: $('hostile-out'),
    container: $('container-out'),
    master: $('vol-master-out'),
    layers: Object.fromEntries(LAYER_NAMES.map((name) => [name, $(`vol-${name}-out`)]))
  };

  function reflectOutputs() {
    outputs.depth.textContent = String(readValue(depthInput, 1));
    outputs.hostile.textContent = String(readValue(hostileInput, 10));
    outputs.container.textContent = String(readValue(containerInput, 10));
    outputs.master.textContent = String(readValue(masterInput, 75));
    for (const name of LAYER_NAMES) {
      outputs.layers[name].textContent = String(readValue(layerInputs[name], 75));
    }
  }

  let engine = null;
  let telemetryTimer = null;
  let starting = false;

  function currentState() {
    const seed = Math.trunc(readValue(seedInput, 1337));
    const depth = Math.trunc(readValue(depthInput, 1));
    const hostile = readValue(hostileInput, 10);
    const container = readValue(containerInput, 10);
    return {
      worldSeed: seed,
      depth,
      floorId: `${seed}:${depth}:0`,
      audioMode: themeSelect.value,
      proximity: { hostile, container },
      nearestHostileDistance: hostile,
      nearestContainerDistance: container,
      combat: combatCheckbox.checked
    };
  }

  function pushState() {
    if (!engine) return;
    engine.updateState(currentState());
  }

  function applyMix() {
    if (!engine) return;
    engine.setMasterVolume(readValue(masterInput, 75));
    engine.setMute(muteCheckbox.checked);
    for (const name of LAYER_NAMES) {
      engine.setLayerVolume(name, readValue(layerInputs[name], 75));
    }
  }

  function renderTelemetry() {
    if (!telemetryPre) return;
    if (!engine) {
      telemetryPre.textContent = '(engine not started)';
      return;
    }
    try {
      telemetryPre.textContent = JSON.stringify(engine.getGraphState(), null, 2);
    } catch (err) {
      telemetryPre.textContent = `telemetry error: ${err?.message || err}`;
    }
  }

  function setStatus(text, cls) {
    statusLabel.textContent = text;
    statusLabel.className = `status ${cls}`;
  }

  async function start() {
    if (engine || starting) return;
    starting = true;
    startButton.disabled = true;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('WebAudio unavailable in this browser');
      const ctx = new Ctor();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try { await ctx.resume(); } catch { /* ignore — user gesture flow */ }
      }
      engine = createAudioEngine(ctx);
      applyMix();
      engine.start();
      engine.updateState(currentState());
      stopButton.disabled = false;
      setStatus('running', 'on');
      telemetryTimer = setInterval(renderTelemetry, 250);
      renderTelemetry();
    } catch (err) {
      console.error('[audition] start failed', err);
      setStatus(`error: ${err?.message || err}`, 'off');
      startButton.disabled = false;
      engine?.destroy?.();
      engine = null;
    } finally {
      starting = false;
    }
  }

  function stop() {
    if (!engine) return;
    if (telemetryTimer !== null) {
      clearInterval(telemetryTimer);
      telemetryTimer = null;
    }
    try { engine.destroy(); } catch (err) { console.error('[audition] destroy failed', err); }
    engine = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    setStatus('stopped', 'off');
    renderTelemetry();
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    depthInput.value = String(preset.depth);
    hostileInput.value = String(preset.hostile);
    containerInput.value = String(preset.container);
    combatCheckbox.checked = Boolean(preset.combat);
    reflectOutputs();
    pushState();
  }

  function reroll() {
    const current = Math.trunc(readValue(seedInput, 1337));
    seedInput.value = String(current + 1);
    pushState();
  }

  startButton.addEventListener('click', () => { start(); });
  stopButton.addEventListener('click', () => { stop(); });
  rerollButton.addEventListener('click', reroll);

  const stateInputs = [themeSelect, depthInput, hostileInput, containerInput, seedInput];
  for (const el of stateInputs) {
    el.addEventListener('input', () => { reflectOutputs(); pushState(); });
    el.addEventListener('change', () => { reflectOutputs(); pushState(); });
  }
  combatCheckbox.addEventListener('change', () => { pushState(); });

  masterInput.addEventListener('input', () => { reflectOutputs(); applyMix(); });
  muteCheckbox.addEventListener('change', () => { applyMix(); });
  for (const name of LAYER_NAMES) {
    layerInputs[name].addEventListener('input', () => { reflectOutputs(); applyMix(); });
  }

  for (const button of presetButtons) {
    button.addEventListener('click', () => applyPreset(button.dataset.preset));
  }

  reflectOutputs();
  renderTelemetry();

  return { start, stop, applyPreset, currentState };
}

const harness = createAuditionHarness();
if (typeof window !== 'undefined') {
  window.audition = harness;
}
