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

  function zoomToCells(worldCellPx, targetScreenPx) {
    // Scale so one world cell ≈ targetScreenPx on screen, clamped to [fit, 4×fit].
    // Preserves the current center; caller re-centers on the party after.
    if (!worldCellPx || !targetScreenPx) return;
    const center = state.viewW && state.viewH ? currentCenter() : null;
    state.scale = clampScale(targetScreenPx / worldCellPx);
    if (center) {
      state.x = center.x - state.viewW / (2 * state.scale);
      state.y = center.y - state.viewH / (2 * state.scale);
    }
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
    zoomToCells,
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
  // dragOrigin is the fixed press position for threshold classification and
  // must NEVER be reassigned until the next beginDrag. dragLast rolls forward
  // each move so incremental pan deltas stay stable.
  let dragPointerId = null;
  let dragOrigin = null;
  let dragLast = null;
  let dragMoved = false;
  let pinchStartDist = 0;
  let pinchStartMid = null;
  let pinchActive = false;
  let tapCandidate = null;
  // Latch survives pointer-count transitions inside a gesture. Once pinch,
  // cancel, lostpointercapture, or threshold-crossing occurs, no remaining
  // pointer release in this gesture may fire a tap. Reset when a fresh gesture
  // starts (pointerdown into an empty pointer set).
  let disqualified = false;

  const originalTouchAction = element.style?.touchAction;
  if (element.style) element.style.touchAction = 'none';

  function notify() {
    if (typeof onChange === 'function') onChange();
  }

  function beginDrag(pointerId, point) {
    dragPointerId = pointerId;
    dragOrigin = { x: point.x, y: point.y };
    dragLast = { x: point.x, y: point.y };
    dragMoved = false;
  }

  function clearDragState() {
    dragPointerId = null;
    dragOrigin = null;
    dragLast = null;
  }

  function crossesThreshold(dx, dy) {
    // Squared compare avoids Math.hypot and treats exactly-at-threshold as drag.
    return (dx * dx + dy * dy) >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
  }

  function classifyAndPan(point) {
    if (!dragOrigin || !dragLast) return;
    if (!dragMoved) {
      const originDx = point.x - dragOrigin.x;
      const originDy = point.y - dragOrigin.y;
      if (crossesThreshold(originDx, originDy)) {
        dragMoved = true;
        disqualified = true;
        tapCandidate = null;
      }
    }
    if (dragMoved) {
      const stepX = point.x - dragLast.x;
      const stepY = point.y - dragLast.y;
      if (stepX !== 0 || stepY !== 0) {
        camera.panBy(-stepX, -stepY);
        notify();
      }
    }
    dragLast = { x: point.x, y: point.y };
  }

  function endGesture(pointerId, releasePoint, releaseClient) {
    pointers.delete(pointerId);
    if (pinchActive && pointers.size < 2) {
      pinchActive = false;
      pinchStartDist = 0;
      pinchStartMid = null;
      tapCandidate = null;
      if (pointers.size === 1) {
        // Single-finger pan continuation; disqualified stays latched so this
        // pointer can never regain tap eligibility on release.
        const [remainingId, remaining] = pointers.entries().next().value;
        beginDrag(remainingId, remaining);
      } else {
        clearDragState();
      }
      return;
    }
    if (dragPointerId === pointerId) {
      // Release-time classification: fold the release coordinates into the
      // gesture so a threshold-crossing release with no prior pointermove still
      // pans and suppresses the tap.
      if (releasePoint) classifyAndPan(releasePoint);
      const wasTap = !dragMoved && !disqualified && tapCandidate;
      clearDragState();
      if (wasTap && typeof onTap === 'function') {
        // Fire the tap with the release client coordinates so a jitter between
        // press and release lands at the user's actual final finger position.
        const cx = releaseClient?.clientX ?? tapCandidate.clientX;
        const cy = releaseClient?.clientY ?? tapCandidate.clientY;
        onTap({ clientX: cx, clientY: cy });
      }
      dragMoved = false;
      tapCandidate = null;
    }
  }

  function onPointerDown(event) {
    const clientX = event.clientX ?? 0;
    const clientY = event.clientY ?? 0;
    const point = localPoint(element, clientX, clientY);
    const wasEmpty = pointers.size === 0;
    pointers.set(event.pointerId, { x: point.x, y: point.y });
    element.setPointerCapture?.(event.pointerId);
    if (wasEmpty) {
      // Fresh gesture — release the disqualified latch from any prior gesture.
      disqualified = false;
      beginDrag(event.pointerId, point);
      tapCandidate = { x: point.x, y: point.y, clientX, clientY };
    } else if (pointers.size === 2) {
      const values = [...pointers.values()];
      const dx = values[0].x - values[1].x;
      const dy = values[0].y - values[1].y;
      pinchStartDist = Math.hypot(dx, dy) || 1;
      pinchStartMid = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
      pinchActive = true;
      // Pinch permanently disqualifies this gesture from tapping; the latch
      // outlives the pinch and any single-finger continuation that follows.
      disqualified = true;
      tapCandidate = null;
      clearDragState();
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
    if (dragPointerId !== event.pointerId) return;
    classifyAndPan(point);
  }

  function onPointerUp(event) {
    element.releasePointerCapture?.(event.pointerId);
    const clientX = event.clientX ?? 0;
    const clientY = event.clientY ?? 0;
    const point = localPoint(element, clientX, clientY);
    endGesture(event.pointerId, point, { clientX, clientY });
  }

  function onPointerCancel(event) {
    element.releasePointerCapture?.(event.pointerId);
    pointers.delete(event.pointerId);
    if (dragPointerId === event.pointerId) clearDragState();
    dragMoved = false;
    tapCandidate = null;
    pinchActive = false;
    pinchStartDist = 0;
    pinchStartMid = null;
    disqualified = true;
  }

  function onLostPointerCapture(event) {
    // Browser-initiated capture loss (e.g. scroll takeover). Treat like a
    // cancel: drop the pointer and latch the gesture so no stray release taps.
    pointers.delete(event.pointerId);
    if (dragPointerId === event.pointerId) clearDragState();
    tapCandidate = null;
    disqualified = true;
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
  element.addEventListener('lostpointercapture', onLostPointerCapture);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('touchmove', onTouchMove, { passive: false });

  return function cleanup() {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onLostPointerCapture);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('touchmove', onTouchMove);
    if (element.style) element.style.touchAction = originalTouchAction ?? '';
    pointers.clear();
    clearDragState();
    dragMoved = false;
    tapCandidate = null;
    pinchActive = false;
    pinchStartDist = 0;
    pinchStartMid = null;
    disqualified = false;
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
