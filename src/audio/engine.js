import { createDrone } from './drone.js';
import { createPulse } from './pulse.js';
import { createSparkle } from './sparkle.js';
import { createLead } from './lead.js';
import { createNoiseBed } from './noise-bed.js';

const LAYER_FACTORIES = {
  drone: createDrone,
  pulse: createPulse,
  sparkle: createSparkle,
  lead: createLead,
  noiseBed: createNoiseBed
};

export function createAudioEngine(initialAudioContext = null) {
  let audioContext = initialAudioContext;
  let masterGain = null;
  const layerBuses = {};
  const layers = {};
  let started = false;
  let destroyed = false;
  let masterVolume = 100;
  let muted = false;
  const pendingVolumes = { drone: 75, pulse: 75, sparkle: 75, lead: 75, noiseBed: 75 };

  function setParam(param, value, time = audioContext?.currentTime || 0, glide = 0) {
    if (!param) return;
    if (glide && typeof param.linearRampToValueAtTime === 'function') {
      param.cancelScheduledValues?.(time);
      param.setValueAtTime?.(param.value ?? value, time);
      param.linearRampToValueAtTime(value, time + glide);
    } else {
      param.value = value;
    }
  }

  function applyMaster() {
    setParam(masterGain?.gain, muted ? 0 : masterVolume / 100);
  }

  function buildGraph() {
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    applyMaster();
    for (const [name, factory] of Object.entries(LAYER_FACTORIES)) {
      const bus = audioContext.createGain();
      bus.connect(masterGain);
      layerBuses[name] = bus;
      layers[name] = factory(audioContext, bus);
      layers[name].setVolume?.((pendingVolumes[name] ?? 75) / 100);
    }
  }

  return {
    start() {
      if (destroyed || started) return false;
      if (!audioContext) return false;
      buildGraph();
      for (const layer of Object.values(layers)) layer.start?.();
      started = true;
      return true;
    },
    suspend() {
      if (audioContext?.suspend) return audioContext.suspend();
      return Promise.resolve();
    },
    stop() {
      for (const layer of Object.values(layers)) layer.stop?.();
      for (const layer of Object.values(layers)) layer.destroy?.();
      for (const bus of Object.values(layerBuses)) bus.disconnect?.();
      masterGain?.disconnect?.();
      for (const key of Object.keys(layers)) delete layers[key];
      for (const key of Object.keys(layerBuses)) delete layerBuses[key];
      masterGain = null;
      started = false;
    },
    destroy() {
      if (destroyed) return;
      this.stop();
      destroyed = true;
    },
    updateContext(nextContext) {
      if (destroyed) return false;
      const wasStarted = started;
      this.stop();
      audioContext = nextContext;
      if (wasStarted) return this.start();
      return true;
    },
    applySettings(settings = {}) {
      this.setMute(Boolean(settings.masterMute));
      for (const [layer, volume] of Object.entries(settings.layerVolumes || {})) this.setLayerVolume(layer, volume);
    },
    setLayerVolume(layerName, volume) {
      if (!(layerName in pendingVolumes)) return false;
      pendingVolumes[layerName] = Math.max(0, Math.min(100, Number(volume) || 0));
      layers[layerName]?.setVolume?.(pendingVolumes[layerName] / 100);
      return true;
    },
    setMasterVolume(volume) {
      masterVolume = Math.max(0, Math.min(100, Number(volume) || 0));
      applyMaster();
    },
    setMute(value) {
      muted = Boolean(value);
      applyMaster();
    },
    updateState(gameState) {
      for (const layer of Object.values(layers)) layer.updateState?.(gameState || {});
    },
    isStarted() { return started; },
    getGraphState() { return { started, muted, masterVolume, layers: Object.keys(layers), pendingVolumes: { ...pendingVolumes } }; }
  };
}
