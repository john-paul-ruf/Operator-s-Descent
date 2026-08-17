import { loadSettings, saveSettings } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createButton, createPanel, createScreenBody, createSlider, createToggle } from '../components.js';
import { currentLayoutClass } from '../layout.js';

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

const INFO_ROWS = [
  ['Version', '1.0'],
  ['Build', 'OFFLINE'],
  ['Cache', 'Service Worker'],
  ['Transfer', '< 500 KB']
];

function appendCaption(parent, text) {
  const caption = document.createElement('small');
  caption.className = 'caption';
  caption.textContent = text;
  parent.appendChild(caption);
  return caption;
}

function dispatchChange(key, value) {
  bus.dispatch('state:settings-change', { key, value });
}

export function mount(container, params = {}) {
  let settings = loadSettings();
  const cleanups = [];
  const motionButtons = new Map();
  const isWide = currentLayoutClass() === 'wide';

  const screen = document.createElement('section');
  screen.className = isWide ? 'settings-screen wide-settings-shell' : 'settings-screen screen-container';
  if (isWide) screen.dataset.wideRoot = '';
  screen.style.padding = '0';
  screen.style.gap = '0';
  screen.setAttribute('aria-label', 'Settings');

  const header = document.createElement('header');
  header.className = isWide ? 'panel-elevated wide-settings-header' : 'panel-elevated s-3';
  header.style.textAlign = 'center';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'micro';
  eyebrow.textContent = '◈ SETTINGS';
  eyebrow.setAttribute('role', 'heading');
  eyebrow.setAttribute('aria-level', '1');
  const heading = document.createElement('div');
  heading.className = 'subheading accent-text glow';
  heading.textContent = 'CONFIGURE TERMINAL';
  header.append(eyebrow, heading);

  const body = isWide
    ? Object.assign(document.createElement('div'), { className: 'wide-settings-body' })
    : createScreenBody({ className: 's-4' });

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

  const audioTitle = document.createElement('div');
  audioTitle.className = 'section-header glow';
  audioTitle.textContent = '◈ AUDIO';
  const audioPanel = createPanel();
  audioPanel.classList.add('s-3');

  const mute = createToggle('MASTER MUTE', settings.masterMute, (value) => {
    settings = { ...settings, masterMute: value };
    saveCurrent('MASTER MUTE');
    dispatchChange('mute', value);
  });
  mute.dataset.testid = 'settings-master-mute';
  cleanups.push(() => mute.cleanup?.());
  audioPanel.appendChild(mute);
  appendCaption(audioPanel, 'Silence all audio');

  const perLayerCaption = appendCaption(audioPanel, 'PER-LAYER VOLUME');
  perLayerCaption.classList.add('micro');
  perLayerCaption.dataset.testid = 'settings-per-layer-caption';

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

  const visualTitle = document.createElement('div');
  visualTitle.className = 'section-header glow';
  visualTitle.textContent = '◈ VISUAL';
  const visualPanel = createPanel();
  visualPanel.classList.add('s-3');

  const glitch = createToggle('GLITCH', settings.glitchEnabled, (value) => {
    settings = { ...settings, glitchEnabled: value };
    saveCurrent('GLITCH');
    dispatchChange('glitch', value);
  });
  glitch.dataset.testid = 'settings-glitch';
  cleanups.push(() => glitch.cleanup?.());
  visualPanel.appendChild(glitch);
  appendCaption(visualPanel, 'Char substitution, VHS, jitter, bars, flash');

  const motionGroup = document.createElement('div');
  motionGroup.className = 'motion-options';
  motionGroup.setAttribute('role', 'radiogroup');
  motionGroup.setAttribute('aria-label', 'Reduced-motion override');
  motionGroup.dataset.testid = 'settings-motion-options';

  const motionTitle = document.createElement('div');
  motionTitle.className = 'panel-title';
  motionTitle.textContent = 'REDUCED MOTION';
  motionGroup.appendChild(motionTitle);
  appendCaption(motionGroup, 'Manual override · disables glitch + transitions');

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
  appendCaption(visualPanel, 'CRT frame texture (independent of glitch)');

  const infoTitle = document.createElement('div');
  infoTitle.className = 'section-header glow';
  infoTitle.textContent = '◈ INFO';
  const infoPanel = createPanel();
  infoPanel.classList.add('s-3');
  infoPanel.dataset.testid = 'settings-info-panel';
  for (const [label, value] of INFO_ROWS) {
    const row = document.createElement('div');
    row.className = 'info-row';
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.gap = '8px';
    const labelEl = document.createElement('span');
    labelEl.className = 'micro';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'micro accent-text';
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    infoPanel.appendChild(row);
  }

  const back = createButton('BACK', {
    onClick: () => bus.dispatch('ui:navigate', { screen: params.from || 'title', params: {} })
  });
  back.dataset.testid = 'settings-back';
  cleanups.push(() => back.cleanup?.());

  const footer = document.createElement('footer');
  footer.className = isWide ? 'panel wide-settings-footer' : 'panel s-3';
  footer.appendChild(back);

  if (isWide) {
    const audioColumn = document.createElement('div');
    audioColumn.className = 'wide-settings-column';
    audioColumn.dataset.testid = 'settings-audio-column';
    audioColumn.append(status, audioTitle, audioPanel);
    const visualColumn = document.createElement('div');
    visualColumn.className = 'wide-settings-column';
    visualColumn.dataset.testid = 'settings-visual-column';
    visualColumn.append(visualTitle, visualPanel, infoTitle, infoPanel);
    body.append(audioColumn, visualColumn);
  } else {
    body.append(status, audioTitle, audioPanel, visualTitle, visualPanel, infoTitle, infoPanel);
  }

  screen.append(header, body, footer);
  container.replaceChildren(screen);
  updateMotionButtons();

  return {
    unmount() {
      while (cleanups.length) cleanups.pop()?.();
    }
  };
}
