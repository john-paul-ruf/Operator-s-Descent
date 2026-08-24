import { loadSettings, saveSettings } from '../../state/library.js';
import { bus } from '../../state/bus.js';
import { createButton, createMenuGroup, createPanel, createScreenBody, createSlider, createToggle } from '../components.js';
import { createIcon } from '../icon.js';
import { currentLayoutClass } from '../layout.js';

const LAYERS = [
  ['drone', 'DRONE'],
  ['pulse', 'PULSE'],
  ['sparkle', 'SPARKLE'],
  ['lead', 'LEAD'],
  ['noiseBed', 'NOISE BED']
];

const MOTION_OPTIONS = [
  { id: 'system', label: 'FOLLOW SYSTEM', description: 'Use the operating system reduced-motion preference.' },
  { id: 'reduce', label: 'REDUCE', description: 'Disable motion-heavy glitch and transitions.' },
  { id: 'full', label: 'ALLOW', description: 'Allow full motion even when the system asks to reduce.' }
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

// Local helper — prefix an icon onto a createToggle's leading label span
// without needing a components.js signature change (out of lease). Safe when
// document.createElementNS is unavailable (test fakes): the icon is silently
// skipped and .row-title-icon is not added, keeping the marker honest.
function prefixToggleLabelIcon(toggle, iconId, iconSize = 14, iconTone) {
  if (!iconId) return;
  if (typeof document?.createElementNS !== 'function') return;
  const labelSpan = toggle?.children?.[0];
  if (!labelSpan) return;
  let icon;
  try { icon = createIcon(iconId, { size: iconSize, tone: iconTone }); }
  catch { return; }
  if (typeof labelSpan.classList?.add === 'function') labelSpan.classList.add('row-title-icon');
  if (typeof labelSpan.prepend === 'function') labelSpan.prepend(icon);
  else if (typeof labelSpan.insertBefore === 'function') labelSpan.insertBefore(icon, labelSpan.firstChild);
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
    for (const value of motionButtons.keys()) {
      const selected = settings.reducedMotion === value;
      motionGroup.setItemState(value, {
        selected,
        ariaSelected: selected,
        ariaChecked: selected,
        ariaPressed: selected
      });
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
  prefixToggleLabelIcon(mute, 'x', 14);
  cleanups.push(() => mute.cleanup?.());
  audioPanel.appendChild(mute);
  appendCaption(audioPanel, 'Silence all audio');

  const master = createSlider('MASTER', settings.masterVolume ?? 100, (value) => {
    settings = { ...settings, masterVolume: value };
    saveCurrent(`MASTER ${value}%`);
    dispatchChange('masterVolume', value);
  });
  master.dataset.testid = 'settings-master-volume';
  master.children[1].dataset.testid = 'settings-master-volume-input';
  cleanups.push(() => master.cleanup?.());
  audioPanel.appendChild(master);
  appendCaption(audioPanel, 'Overall output level');

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
  prefixToggleLabelIcon(glitch, 'triangle-alert', 14);
  cleanups.push(() => glitch.cleanup?.());
  visualPanel.appendChild(glitch);
  appendCaption(visualPanel, 'Char substitution, VHS, jitter, bars, flash');

  const motionTitle = document.createElement('div');
  motionTitle.className = 'panel-title';
  motionTitle.textContent = 'REDUCED MOTION';
  const motionCaption = document.createElement('small');
  motionCaption.className = 'caption';
  motionCaption.textContent = 'Manual override · disables glitch + transitions';
  const motionGroup = createMenuGroup(MOTION_OPTIONS, {
    className: 'motion-options',
    role: 'radiogroup',
    ariaLabel: 'Reduced-motion override',
    testid: 'settings-motion-options',
    actionOptions: { variant: 'radio', className: 'btn-crt' },
    itemOptions: (option) => {
      const selected = settings.reducedMotion === option.id;
      return {
        selected,
        testid: `settings-motion-${option.id}`,
        ariaSelected: selected,
        ariaChecked: selected,
        ariaPressed: selected,
        onClick: () => {
          settings = { ...settings, reducedMotion: option.id };
          saveCurrent(`MOTION ${option.label}`);
          updateMotionButtons();
          dispatchChange('reducedMotion', option.id);
        }
      };
    }
  });
  motionGroup.prepend(motionTitle, motionCaption);
  for (const option of MOTION_OPTIONS) {
    motionButtons.set(option.id, motionGroup.getAction(option.id));
  }
  cleanups.push(() => motionGroup.cleanup?.());
  visualPanel.appendChild(motionGroup);

  const texture = createToggle('SCANLINES & GRAIN', settings.scanlineGrainEnabled, (value) => {
    settings = { ...settings, scanlineGrainEnabled: value };
    saveCurrent('SCANLINES & GRAIN');
    dispatchChange('scanlineGrain', value);
  });
  texture.dataset.testid = 'settings-scanline-grain';
  prefixToggleLabelIcon(texture, 'eye', 14, 'dim');
  cleanups.push(() => texture.cleanup?.());
  visualPanel.appendChild(texture);
  appendCaption(visualPanel, 'CRT frame texture (independent of glitch)');

  const haptics = createToggle('HAPTIC FEEDBACK', settings.hapticsEnabled, (value) => {
    settings = { ...settings, hapticsEnabled: value };
    saveCurrent('HAPTIC FEEDBACK');
  });
  haptics.dataset.testid = 'settings-haptics';
  prefixToggleLabelIcon(haptics, 'zap', 14);
  cleanups.push(() => haptics.cleanup?.());
  visualPanel.appendChild(haptics);
  appendCaption(visualPanel, 'Vibrate on resolved combat hits (where supported)');

  // the-manual SESSION-04 — Settings routes the reader into the settings
  // section of the manual via the fixed `settings_help` target id.
  const manualButton = createButton("OPERATOR'S MANUAL", {
    icon: 'scroll-text',
    iconSize: 16,
    onClick: () => bus.dispatch('ui:manual-open', { target: 'settings_help', source: 'settings' })
  });
  manualButton.dataset.testid = 'settings-manual';
  cleanups.push(() => manualButton.cleanup?.());

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

  const back = createButton('', {
    icon: 'arrow-left',
    iconSize: 14,
    label: 'BACK',
    onClick: () => bus.dispatch('ui:navigate', { screen: params.from || 'title', params: {} })
  });
  back.dataset.testid = 'settings-back';
  back.style.minHeight = '44px';
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
    visualColumn.append(visualTitle, visualPanel, infoTitle, infoPanel, manualButton);
    body.append(audioColumn, visualColumn);
  } else {
    body.append(status, audioTitle, audioPanel, visualTitle, visualPanel, infoTitle, infoPanel, manualButton);
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
