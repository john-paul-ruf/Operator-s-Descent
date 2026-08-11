export const GRAIN_CELL_SIZE = 10;
export const GRAIN_DOT_SIZE = 2;
export const GRAIN_FILL = 0.15;
export const GRAIN_INTERVAL_MS = 1000;

export function createGrain(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const random = options.random || Math.random;
  let intervalId = null;
  let enabled = options.enabled !== false;

  function scatter() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const cols = Math.ceil(canvas.width / GRAIN_CELL_SIZE);
    const rows = Math.ceil(canvas.height / GRAIN_CELL_SIZE);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (random() < GRAIN_FILL) ctx.fillRect(x * GRAIN_CELL_SIZE, y * GRAIN_CELL_SIZE, GRAIN_DOT_SIZE, GRAIN_DOT_SIZE);
      }
    }
  }

  function stop() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }

  return {
    scatter,
    start() {
      if (!enabled || intervalId) return;
      scatter();
      intervalId = setInterval(scatter, GRAIN_INTERVAL_MS);
    },
    stop,
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) stop();
      else this.start();
    },
    destroy() { stop(); },
    isRunning() { return intervalId != null; }
  };
}
