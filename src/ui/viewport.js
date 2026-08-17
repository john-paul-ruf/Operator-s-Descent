export const MAX_ZOOM_SCALE = 4;
export const DRAG_THRESHOLD_PX = 6;
export const WHEEL_ZOOM_SENSITIVITY = 0.002;

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

export function createViewportCamera({ worldW, worldH } = {}) {
  const state = {
    worldW: positive(worldW),
    worldH: positive(worldH),
    viewW: 0,
    viewH: 0,
    scale: 1,
    x: 0,
    y: 0
  };

  function fitScale() {
    if (!state.viewW || !state.viewH || !state.worldW || !state.worldH) return 1;
    return Math.min(state.viewW / state.worldW, state.viewH / state.worldH);
  }

  function clampScale(scale) {
    const floor = fitScale();
    const ceiling = floor * MAX_ZOOM_SCALE;
    return clamp(scale, floor, ceiling);
  }

  function clampAxis(pos, worldSize, viewSize, scale) {
    if (!scale || !viewSize) return 0;
    const viewSpan = viewSize / scale;
    if (worldSize * scale <= viewSize) return (worldSize - viewSpan) / 2;
    return clamp(pos, 0, worldSize - viewSpan);
  }

  function clampAll() {
    state.scale = clampScale(state.scale);
    state.x = clampAxis(state.x, state.worldW, state.viewW, state.scale);
    state.y = clampAxis(state.y, state.worldH, state.viewH, state.scale);
  }

  function currentCenter() {
    if (!state.scale) return { x: state.worldW / 2, y: state.worldH / 2 };
    return {
      x: state.x + state.viewW / (2 * state.scale),
      y: state.y + state.viewH / (2 * state.scale)
    };
  }

  function setWorld(w, h) {
    state.worldW = positive(w);
    state.worldH = positive(h);
    clampAll();
  }

  function setViewport(w, h) {
    const center = state.viewW && state.viewH ? currentCenter() : null;
    state.viewW = positive(w);
    state.viewH = positive(h);
    state.scale = clampScale(state.scale);
    if (center) {
      state.x = center.x - state.viewW / (2 * state.scale);
      state.y = center.y - state.viewH / (2 * state.scale);
    }
    clampAll();
  }

  function fit() {
    state.scale = fitScale();
    state.x = 0;
    state.y = 0;
    clampAll();
  }

  function getState() {
    return {
      x: state.x,
      y: state.y,
      scale: state.scale,
      viewW: state.viewW,
      viewH: state.viewH,
      worldW: state.worldW,
      worldH: state.worldH
    };
  }

  function centerOn(wx, wy) {
    if (!state.scale || !state.viewW || !state.viewH) return;
    state.x = wx - state.viewW / (2 * state.scale);
    state.y = wy - state.viewH / (2 * state.scale);
    clampAll();
  }

  function panBy(dxPx, dyPx) {
    if (!state.scale) return;
    state.x += dxPx / state.scale;
    state.y += dyPx / state.scale;
    clampAll();
  }

  function screenToWorld(sx, sy) {
    if (!state.scale) return { x: state.x, y: state.y };
    return { x: state.x + sx / state.scale, y: state.y + sy / state.scale };
  }

  function zoomAt(sx, sy, factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const before = screenToWorld(sx, sy);
    const nextScale = clampScale(state.scale * factor);
    state.scale = nextScale;
    state.x = before.x - sx / state.scale;
    state.y = before.y - sy / state.scale;
    clampAll();
  }

  function viewTransform(dpr = 1) {
    const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const s = state.scale * d;
    return { scale: s, dx: -state.x * s, dy: -state.y * s };
  }

  clampAll();

  return {
    setWorld,
    setViewport,
    fitScale,
    fit,
    getState,
    centerOn,
    panBy,
    zoomAt,
    screenToWorld,
    viewTransform
  };
}

function localPoint(element, clientX, clientY) {
  const rect = element.getBoundingClientRect?.();
  if (!rect) return { x: clientX, y: clientY };
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function attachViewportGestures(element, camera, { onChange, onTap } = {}) {
  if (!element || !camera) return () => {};
  const pointers = new Map();
  let dragPointerId = null;
  let dragStart = null;
  let dragMoved = false;
  let pinchStartDist = 0;
  let pinchStartMid = null;
  let pinchActive = false;
  let tapCandidate = null;

  const originalTouchAction = element.style?.touchAction;
  if (element.style) element.style.touchAction = 'none';

  function notify() {
    if (typeof onChange === 'function') onChange();
  }

  function beginDrag(pointerId, point) {
    dragPointerId = pointerId;
    dragStart = { x: point.x, y: point.y };
    dragMoved = false;
  }

  function endGesture(pointerId) {
    pointers.delete(pointerId);
    if (pinchActive && pointers.size < 2) {
      pinchActive = false;
      pinchStartDist = 0;
      pinchStartMid = null;
      tapCandidate = null;
      if (pointers.size === 1) {
        const [remainingId, remaining] = pointers.entries().next().value;
        beginDrag(remainingId, remaining);
      } else {
        dragPointerId = null;
        dragStart = null;
      }
      return;
    }
    if (dragPointerId === pointerId) {
      const wasTap = !dragMoved && tapCandidate;
      dragPointerId = null;
      dragStart = null;
      if (wasTap && typeof onTap === 'function') {
        onTap({ clientX: tapCandidate.clientX, clientY: tapCandidate.clientY });
      }
      dragMoved = false;
      tapCandidate = null;
    }
  }

  function onPointerDown(event) {
    const point = localPoint(element, event.clientX ?? 0, event.clientY ?? 0);
    pointers.set(event.pointerId, { x: point.x, y: point.y });
    element.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) {
      beginDrag(event.pointerId, point);
      tapCandidate = { x: point.x, y: point.y, clientX: event.clientX ?? 0, clientY: event.clientY ?? 0 };
    } else if (pointers.size === 2) {
      const values = [...pointers.values()];
      const dx = values[0].x - values[1].x;
      const dy = values[0].y - values[1].y;
      pinchStartDist = Math.hypot(dx, dy) || 1;
      pinchStartMid = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
      pinchActive = true;
      tapCandidate = null;
      dragPointerId = null;
      dragStart = null;
      dragMoved = false;
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    const point = localPoint(element, event.clientX ?? 0, event.clientY ?? 0);
    pointers.set(event.pointerId, { x: point.x, y: point.y });
    if (pinchActive && pointers.size >= 2) {
      const values = [...pointers.values()];
      const dx = values[0].x - values[1].x;
      const dy = values[0].y - values[1].y;
      const dist = Math.hypot(dx, dy) || 1;
      const mid = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
      camera.zoomAt(mid.x, mid.y, dist / pinchStartDist);
      if (pinchStartMid) {
        camera.panBy(pinchStartMid.x - mid.x, pinchStartMid.y - mid.y);
      }
      pinchStartDist = dist;
      pinchStartMid = mid;
      notify();
      return;
    }
    if (dragPointerId !== event.pointerId || !dragStart) return;
    const dx = point.x - dragStart.x;
    const dy = point.y - dragStart.y;
    if (!dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    dragMoved = true;
    tapCandidate = null;
    camera.panBy(-dx, -dy);
    dragStart = { x: point.x, y: point.y };
    notify();
  }

  function onPointerUp(event) {
    element.releasePointerCapture?.(event.pointerId);
    endGesture(event.pointerId);
  }

  function onPointerCancel(event) {
    element.releasePointerCapture?.(event.pointerId);
    pointers.delete(event.pointerId);
    dragPointerId = null;
    dragStart = null;
    dragMoved = false;
    tapCandidate = null;
    pinchActive = false;
  }

  function onWheel(event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    const point = localPoint(element, event.clientX ?? 0, event.clientY ?? 0);
    const factor = Math.exp(-(event.deltaY || 0) * WHEEL_ZOOM_SENSITIVITY);
    camera.zoomAt(point.x, point.y, factor);
    notify();
  }

  function onTouchMove(event) {
    if (pointers.size > 0 && typeof event.preventDefault === 'function') event.preventDefault();
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('touchmove', onTouchMove, { passive: false });

  return function cleanup() {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('touchmove', onTouchMove);
    if (element.style) element.style.touchAction = originalTouchAction ?? '';
    pointers.clear();
    dragPointerId = null;
    dragStart = null;
    dragMoved = false;
    tapCandidate = null;
    pinchActive = false;
  };
}

export function sizeCanvasToContainer(canvas, container) {
  const rect = container?.getBoundingClientRect?.();
  const cssW = rect?.width || container?.clientWidth || canvas?.clientWidth || 0;
  const cssH = rect?.height || container?.clientHeight || canvas?.clientHeight || 0;
  const dpr = Number.isFinite(globalThis.devicePixelRatio) && globalThis.devicePixelRatio > 0
    ? globalThis.devicePixelRatio
    : 1;
  const width = Math.max(1, Math.round(cssW));
  const height = Math.max(1, Math.round(cssH));
  if (canvas) {
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    if (canvas.style) {
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
  }
  return { w: width, h: height, dpr };
}
