const KEY_MAP = {
  ArrowUp: 'move-north', ArrowDown: 'move-south',
  ArrowLeft: 'move-west', ArrowRight: 'move-east',
  Numpad7: 'move-northwest', Numpad9: 'move-northeast',
  Numpad1: 'move-southwest', Numpad3: 'move-southeast',
  Numpad8: 'move-north', Numpad2: 'move-south',
  Numpad4: 'move-west', Numpad6: 'move-east',
  KeyW: 'move-north', KeyS: 'move-south',
  KeyA: 'move-west', KeyD: 'move-east',
  KeyQ: 'move-northwest', KeyE: 'move-northeast',
  KeyZ: 'move-southwest', KeyC: 'move-southeast',
  Dig1: 'mode-1', Dig2: 'mode-2', Dig3: 'mode-3',
  Dig4: 'mode-4', Dig5: 'mode-5', Dig6: 'mode-6', Dig7: 'mode-7',
  Tab: 'tab-next', Enter: 'confirm', Escape: 'cancel',
  Space: 'confirm', Backspace: 'cancel'
};

const TOUCH_ZONES = [
  { x: 0.0, y: 0.0, w: 0.33, h: 0.33, action: 'move-northwest' },
  { x: 0.33, y: 0.0, w: 0.34, h: 0.33, action: 'move-north' },
  { x: 0.67, y: 0.0, w: 0.33, h: 0.33, action: 'move-northeast' },
  { x: 0.0, y: 0.33, w: 0.33, h: 0.34, action: 'move-west' },
  { x: 0.67, y: 0.33, w: 0.33, h: 0.34, action: 'move-east' },
  { x: 0.0, y: 0.67, w: 0.33, h: 0.33, action: 'move-southwest' },
  { x: 0.33, y: 0.67, w: 0.34, h: 0.33, action: 'move-south' },
  { x: 0.67, y: 0.67, w: 0.33, h: 0.33, action: 'move-southeast' }
];

export function createInputHandler() {
  const callbacks = [];

  function handleAction(action) {
    for (const cb of callbacks) cb(action);
  }

  return {
    onAction(callback) {
      callbacks.push(callback);
    },
    bindToElement(el) {
      el.addEventListener('keydown', (e) => {
        let action = KEY_MAP[e.code];
        if (!action && e.key) action = KEY_MAP[e.key];
        if (action) {
          e.preventDefault();
          handleAction(action);
        }
      });

      el.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        if (!touch) return;
        const rect = el.getBoundingClientRect();
        const tx = (touch.clientX - rect.left) / rect.width;
        const ty = (touch.clientY - rect.top) / rect.height;
        for (const zone of TOUCH_ZONES) {
          if (tx >= zone.x && tx < zone.x + zone.w && ty >= zone.y && ty < zone.y + zone.h) {
            handleAction(zone.action);
            return;
          }
        }
      }, { passive: false });

      el.tabIndex = 0;
    },
    triggerAction(action) {
      handleAction(action);
    }
  };
}