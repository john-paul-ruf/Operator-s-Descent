import { loadSettings, saveSettings } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel, createSlider, createToggle } from '../components.js';

const LAYERS = [
  ['drone', 'DRONE'],
  ['pulse', 'PULSE'],
  ['sparkle', 'SPARKLE'],
  ['lead', 'LEAD'],
  ['noiseBed', 'NOISE BED']
];

const MOTION_OPTIONS = [
  ['system', 'FOLLOW SYSTEM', 'Use the operating system reduced-motion preference.'],
  ['reduce', 'REDUCE', 'Disable motion-heavy glitch and transitions.'],
  ['full', 'ALLOW', 'Allow full motion even when the system asks to reduce.']
];

function dispatchChange(key, value) {
  bus.dispatch('state:settings-change', { key, value });
}

export function mount(container, params = {}) {
  let settings = loadSettings();
  const cleanups = [];
  const motionButtons = new Map();

  const screen = document.createElement('section');
  screen.className = 'settings-screen';
  screen.setAttribute('aria-label', 'Settings');

  const header = document.createElement('h2');
  header.className = 'display';
  header.textContent = 'SETTINGS';

  const status = document.createElement('p');
  status.className = 'console-note';
  status.setAttribute('aria-live', 'polite');
  status.dataset.testid = 'settings-status';

  function saveCurrent(label) {
    let result;
    try {
      result = saveSettings(settings);
    } catch (error) {
      result = { success: false, error: error?.message || 'storage_failed' };
    }
    if (result.success) {
      settings = result.settings;
      status.textContent = `SAVED — ${label}`;
    } else {
      status.textContent = `SAVE FAILED — ${result.error || 'storage_failed'}`;
    }
    return result;
  }

  function updateMotionButtons() {
    for (const [value, button] of motionButtons) {
      const selected = settings.reducedMotion === value;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-checked', String(selected));
    }
  }

  const audioPanel = createPanel({ title: 'AUDIO' });

  const mute = createToggle('MASTER MUTE', settings.masterMute, (value) => {
    settings = { ...settings, masterMute: value };
    saveCurrent('MASTER MUTE');
    dispatchChange('mute', value);
  });
  mute.dataset.testid = 'settings-master-mute';
  cleanups.push(() => mute.cleanup?.());
  audioPanel.appendChild(mute);

  for (const [layer, label] of LAYERS) {
    const slider = createSlider(label, settings.layerVolumes[layer] ?? 75, (value) => {
      settings = {
        ...settings,
        layerVolumes: { ...settings.layerVolumes, [layer]: value }
      };
      saveCurrent(`${label} ${value}%`);
      dispatchChange(`volume:${layer}`, value);
    });
    slider.dataset.testid = `settings-volume-${layer}`;
    slider.children[1].dataset.testid = `settings-volume-${layer}-input`;
    cleanups.push(() => slider.cleanup?.());
    audioPanel.appendChild(slider);
  }

  const visualPanel = createPanel({ title: 'VISUAL' });

  const glitch = createToggle('GLITCH', settings.glitchEnabled, (value) => {
    settings = { ...settings, glitchEnabled: value };
    saveCurrent('GLITCH');
    dispatchChange('glitch', value);
  });
  glitch.dataset.testid = 'settings-glitch';
  cleanups.push(() => glitch.cleanup?.());
  visualPanel.appendChild(glitch);

  const motionGroup = document.createElement('div');
  motionGroup.className = 'motion-options';
  motionGroup.setAttribute('role', 'radiogroup');
  motionGroup.setAttribute('aria-label', 'Reduced-motion override');
  motionGroup.dataset.testid = 'settings-motion-options';

  const motionTitle = document.createElement('div');
  motionTitle.className = 'panel-title';
  motionTitle.textContent = 'REDUCED MOTION';
  motionGroup.appendChild(motionTitle);

  for (const [value, label, description] of MOTION_OPTIONS) {
    const option = createButton(label, {
      selected: settings.reducedMotion === value,
      description,
      onClick: () => {
        settings = { ...settings, reducedMotion: value };
        saveCurrent(`MOTION ${label}`);
        updateMotionButtons();
        dispatchChange('reducedMotion', value);
      }
    });
    option.dataset.testid = `settings-motion-${value}`;
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(settings.reducedMotion === value));
    motionButtons.set(value, option);
    cleanups.push(() => option.cleanup?.());
    motionGroup.appendChild(option);
  }
  visualPanel.appendChild(motionGroup);

  const texture = createToggle('SCANLINES & GRAIN', settings.scanlineGrainEnabled, (value) => {
    settings = { ...settings, scanlineGrainEnabled: value };
    saveCurrent('SCANLINES & GRAIN');
    dispatchChange('scanlineGrain', value);
  });
  texture.dataset.testid = 'settings-scanline-grain';
  cleanups.push(() => texture.cleanup?.());
  visualPanel.appendChild(texture);

  const back = createButton('BACK', {
    onClick: () => bus.dispatch('ui:navigate', { screen: params.from || 'title', params: {} })
  });
  back.dataset.testid = 'settings-back';
  cleanups.push(() => back.cleanup?.());

  screen.append(header, status, audioPanel, visualPanel, back);
  container.replaceChildren(screen);
  updateMotionButtons();

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
