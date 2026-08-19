// Audio Audition Rig — dev-only ear-test harness. Not shipped.
// Boots the real createAudioEngine so the pre-rewrite audio layers can be
// steered by hand. Checkpoint 1 exposes the mixer only; game-state controls
// land in checkpoint 2.
//
// Rule 12: nothing under src/, index.html, service-worker.js, or
// PRODUCTION_ASSETS references this file. It only exists at dev time.

import { createAudioEngine } from '../../src/audio/engine.js';

const els = {
  status: document.querySelector('[data-testid="rig-status"]'),
  startGate: document.querySelector('[data-testid="start-gate"]'),
  startButton: document.querySelector('[data-testid="start-button"]'),
  controls: document.querySelector('[data-testid="controls"]'),
  master: document.querySelector('#master-volume'),
  masterMute: document.querySelector('#master-mute'),
  layerSliders: Array.from(document.querySelectorAll('[data-layer]')),
};

let engine = null;
let audioContext = null;

function setStatus(text, running) {
  els.status.textContent = text;
  els.status.classList.toggle('is-running', Boolean(running));
}

function setValueDisplay(id, text) {
  const node = document.querySelector(`[data-value-for="${id}"]`);
  if (node) node.textContent = text;
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
    els.startGate.hidden = true;
    els.controls.hidden = false;
    setStatus('RUNNING', true);
  } catch (err) {
    setStatus(`FAILED — ${err?.message ?? err}`, false);
    console.error('[audition] boot failed:', err);
    if (audioContext?.close) audioContext.close().catch(() => {});
    audioContext = null;
    engine = null;
  }
}

wireMixer();
els.startButton.addEventListener('click', boot);
