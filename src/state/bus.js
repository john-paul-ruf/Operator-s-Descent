const handlers = new Map();

const ROUTES = new Set(['title', 'creation', 'exploration', 'combat', 'library', 'scorecard', 'import', 'tutorial', 'settings']);
const SETTING_KEYS = new Set(['mute', 'masterVolume', 'glitch', 'reducedMotion', 'scanlineGrain']);
const VOLUME_KEY = /^volume:(drone|pulse|sparkle|lead|noiseBed)$/;
const MANUAL_CLOSE_REASONS = new Set(['escape', 'close-button', 'backdrop', 'programmatic']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function optionalObject(value) {
  return value === undefined || value === null || isObject(value);
}

function hasRunState(value) {
  return isObject(value?.runState) && Number.isInteger(value.runState.worldSeed) && Number.isInteger(value.runState.depth);
}

function isMode(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
}

function isRoute(value) {
  return ROUTES.has(value);
}

function validateSettingsChange(payload) {
  if (!isObject(payload) || typeof payload.key !== 'string') return false;
  return SETTING_KEYS.has(payload.key) || VOLUME_KEY.test(payload.key);
}

export const EVENT_CONTRACTS = Object.freeze({
  'ui:navigate': {
    description: 'Hot route change. Payload: { screen, params? }.',
    validate: (payload) => isObject(payload) && isRoute(payload.screen) && (payload.params === undefined || isObject(payload.params))
  },
  'ui:audio-start': {
    description: 'Fallback request to start the injected audio engine.',
    validate: optionalObject
  },
  'audio:update-state': {
    description: 'Audio retune payload with depth/theme/proximity/combat fields.',
    validate: optionalObject
  },
  'state:settings-change': {
    description: 'Live settings preview/update. Payload: { key, value }.',
    validate: validateSettingsChange
  },
  'state:floor-change': {
    description: 'Committed descent request from exploration. Payload includes runState.',
    validate: hasRunState
  },
  'state:combat-start': {
    description: 'Encounter handoff from exploration to combat. Payload includes runState.',
    validate: hasRunState
  },
  'state:combat-end': {
    description: 'Resolved combat checkpoint. Payload includes runState and result victory|retreat.',
    validate: (payload) => hasRunState(payload) && ['victory', 'retreat'].includes(payload.result)
  },
  'state:party-wipe': {
    description: 'Terminal run checkpoint. Payload includes runState.',
    validate: hasRunState
  },
  'state:character-death': {
    description: 'Single-character death. Payload includes runState and character.',
    validate: (payload) => hasRunState(payload) && isObject(payload.character)
  },
  'state:danger-clock-tick': {
    description: 'Danger clock display update. Payload: { progress }.',
    validate: (payload) => isObject(payload) && Number.isFinite(payload.progress)
  },
  'state:loot-taken': {
    description: 'Item moved from a container into party inventory. Payload: { runState, itemId, containerId, containerClosed }.',
    validate: hasRunState
  },
  'state:inventory-change': {
    description: 'Party inventory or equipment mutation checkpoint from GEAR mode. Payload: { runState }.',
    validate: hasRunState
  },
  'state:autosave-complete': {
    description: 'Runtime autosave success. Payload includes checkpoint reason and storage result.',
    validate: (payload) => isObject(payload) && typeof payload.reason === 'string'
  },
  'state:autosave-failed': {
    description: 'Runtime autosave failure. Payload includes checkpoint reason and error.',
    validate: (payload) => isObject(payload) && typeof payload.reason === 'string' && typeof payload.error === 'string'
  },
  'state:calibration-required': {
    description: 'Floor transition reached a calibration floor. Payload includes transition offers.',
    validate: (payload) => hasRunState(payload) && Array.isArray(payload.offers)
  },
  'ui:log-entry': {
    description: 'Presentation log entry to mirror into the active run event tail.',
    validate: (payload) => isObject(payload) && (payload.message === undefined || typeof payload.message === 'string')
  },
  'ui:mode-change': {
    description: 'Legacy console mode notification. Payload: { mode }.',
    validate: (payload) => isObject(payload) && isMode(payload.mode)
  },
  'ui:console-expand': {
    description: 'Legacy console expanded notification.',
    validate: optionalObject
  },
  'ui:console-collapse': {
    description: 'Legacy console collapsed notification.',
    validate: optionalObject
  },
  'ui:camera-request': {
    description: 'Playfield auto-pan request from console shell.',
    validate: (payload) => isObject(payload) && typeof payload.reason === 'string'
  },
  'console:mode-change': {
    description: 'Console mode intent. Payload: { mode, source? }.',
    validate: (payload) => isObject(payload) && isMode(payload.mode)
  },
  'console:expand': {
    description: 'Console expand intent. Payload: { mode? }.',
    validate: optionalObject
  },
  'console:collapse': {
    description: 'Console collapse intent. Payload: { mode? }.',
    validate: optionalObject
  },
  'console:unavailable': {
    description: 'Unavailable console mode/action report.',
    validate: (payload) => isObject(payload) && typeof payload.reason === 'string'
  },
  'console:intent': {
    description: 'Mode-owned semantic console action intent.',
    validate: (payload) => isObject(payload) && isMode(payload.mode) && typeof payload.action === 'string'
  },
  'loot:open-request': {
    description: 'LOOT mode container handoff from exploration.',
    validate: (payload) => isObject(payload) && isObject(payload.container)
  },
  'runtime:route': {
    description: 'Runtime mounted route notification. Payload: { screen, params? }.',
    validate: (payload) => isObject(payload) && isRoute(payload.screen)
  },
  'runtime:shutdown': {
    description: 'Runtime teardown notification.',
    validate: optionalObject
  },
  'runtime:error': {
    description: 'Runtime-owned recoverable error notification.',
    validate: (payload) => isObject(payload) && typeof payload.error === 'string'
  },
  'runtime:update-applied': {
    description: 'A new service worker took control of the page; runtime is reloading to apply it.',
    validate: optionalObject
  },
  'ui:manual-open': {
    description: 'Open the operator manual modal. Payload: { target: sectionId|null, source: string }.',
    validate: (payload) => isObject(payload)
      && (payload.target === null || (typeof payload.target === 'string' && payload.target.length > 0))
      && typeof payload.source === 'string'
      && payload.source.length > 0
  },
  'ui:manual-close': {
    description: 'Manual modal closed. Payload: { reason: escape|close-button|backdrop|programmatic }.',
    validate: (payload) => isObject(payload) && MANUAL_CLOSE_REASONS.has(payload.reason)
  }
});

export function isKnownEvent(event) {
  return Object.hasOwn(EVENT_CONTRACTS, event);
}

export function validateEventPayload(event, payload) {
  const contract = EVENT_CONTRACTS[event];
  return contract ? contract.validate(payload) : true;
}

export function describeEventContracts() {
  return Object.fromEntries(Object.entries(EVENT_CONTRACTS).map(([event, contract]) => [event, contract.description]));
}

export const bus = {
  on(event, handler) {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event).add(handler);
    return () => handlers.get(event)?.delete(handler);
  },
  dispatch(event, payload) {
    if (!validateEventPayload(event, payload)) {
      console.warn(`Invalid bus payload for ${event}`);
      return false;
    }
    const eventHandlers = handlers.get(event);
    if (eventHandlers) {
      eventHandlers.forEach((h) => {
        try { h(payload); } catch (e) { console.error(`Bus handler error for ${event}:`, e); }
      });
    }
    return true;
  }
};
