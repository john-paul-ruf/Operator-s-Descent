import { loadSettings, saveSettings } from '../../state/library.js';
import { createSlider, createToggle, createButton, createPanel } from '../components.js';
import { bus } from '../../state/bus.js';

const LAYER_NAMES = ['drone', 'pulse', 'sparkle', 'lead', 'noiseBed'];

export function mount(container, params) {
  const settings = loadSettings();

  const header = document.createElement('h2');
  header.className = 'display';
  header.textContent = 'SETTINGS';
  container.appendChild(header);

  const audioPanel = createPanel({ title: 'AUDIO' });
  audioPanel.appendChild(createToggle('MASTER MUTE', settings.masterMute, (v) => {
    settings.masterMute = v;
    saveSettings(settings);
    bus.dispatch('state:settings-change', { key: 'mute', value: v });
  }));
  for (const layer of LAYER_NAMES) {
    audioPanel.appendChild(createSlider(layer.toUpperCase(), settings.layerVolumes[layer] ?? 75, (v) => {
      settings.layerVolumes[layer] = v;
      saveSettings(settings);
      bus.dispatch('state:settings-change', { key: `volume:${layer}`, value: v });
    }));
  }
  container.appendChild(audioPanel);

  const visualPanel = createPanel({ title: 'VISUAL' });
  visualPanel.appendChild(createToggle('GLITCH', settings.glitchEnabled, (v) => {
    settings.glitchEnabled = v;
    saveSettings(settings);
    bus.dispatch('state:settings-change', { key: 'glitch', value: v });
  }));
  visualPanel.appendChild(createToggle('REDUCED MOTION', settings.reducedMotion === 'reduce', (v) => {
    settings.reducedMotion = v ? 'reduce' : 'full';
    saveSettings(settings);
    bus.dispatch('state:settings-change', { key: 'reducedMotion', value: settings.reducedMotion });
  }));
  visualPanel.appendChild(createToggle('SCANLINES & GRAIN', settings.scanlineGrainEnabled, (v) => {
    settings.scanlineGrainEnabled = v;
    saveSettings(settings);
    bus.dispatch('state:settings-change', { key: 'scanlineGrain', value: v });
  }));
  container.appendChild(visualPanel);

  const infoPanel = createPanel({ title: 'INFO' });
  const version = document.createElement('p');
  version.textContent = 'OPERATOR\'S DESCENT · VERSION 1.0 · BUILD 0';
  infoPanel.appendChild(version);
  container.appendChild(infoPanel);

  container.appendChild(createButton('BACK', {
    onClick: () => bus.dispatch('ui:navigate', { screen: params.from || 'title' })
  }));

  return { unmount() {} };
}
