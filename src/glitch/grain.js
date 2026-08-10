export function createGrain(canvas) {
  const ctx = canvas.getContext('2d');
  const CELL_SIZE = 10;
  const DOT_SIZE = 2;
  const FILL_PERCENT = 0.15;
  let intervalId = null;
  let enabled = true;

  function scatter() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    const cols = Math.ceil(canvas.width / CELL_SIZE);
    const rows = Math.ceil(canvas.height / CELL_SIZE);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (Math.random() < FILL_PERCENT) {
          ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, DOT_SIZE, DOT_SIZE);
        }
      }
    }
  }

  return {
    start() {
      if (enabled && !intervalId) {
        scatter();
        intervalId = setInterval(scatter, 1000);
      }
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    setEnabled(value) {
      enabled = value;
      if (!value) this.stop();
      else this.start();
    }
  };
}