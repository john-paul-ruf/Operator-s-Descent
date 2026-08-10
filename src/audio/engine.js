import { createDrone } from './drone.js';
import { createPulse } from './pulse.js';
import { createSparkle } from './sparkle.js';
import { createLead } from './lead.js';
import { createNoiseBed } from './noise-bed.js';

export function createAudioEngine(initialAudioContext = null) {
  let audioContext = null;
  let masterGain = null;
  const layers = {};
  let started = false;
  let masterVolume = 70;
  let muted = false;

  return {
    start() {
      if (started) return;
      audioContext = initialAudioContext || new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioContext.createGain();
      masterGain.connect(audioContext.destination);
      masterGain.gain.value = muted ? 0 : masterVolume / 100;

      layers.drone = createDrone(audioContext, masterGain);
      layers.pulse = createPulse(audioContext, masterGain);
      layers.sparkle = createSparkle(audioContext, masterGain);
      layers.lead = createLead(audioContext, masterGain);
      layers.noiseBed = createNoiseBed(audioContext, masterGain);

      for (const layer of Object.values(layers)) {
        layer.start();
      }
      started = true;
    },
    stop() {
      for (const layer of Object.values(layers)) {
        layer.stop();
      }
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
      started = false;
    },
    setLayerVolume(layerName, volume) {
      layers[layerName]?.setVolume(volume / 100);
    },
    setMasterVolume(volume) {
      masterVolume = volume;
      if (masterGain && !muted) masterGain.gain.value = volume / 100;
    },
    setMute(m) {
      muted = m;
      if (masterGain) masterGain.gain.value = m ? 0 : masterVolume / 100;
    },
    updateState(gameState) {
      for (const layer of Object.values(layers)) {
        layer.updateState(gameState);
      }
    },
    isStarted() {
      return started;
    }
  };
}
