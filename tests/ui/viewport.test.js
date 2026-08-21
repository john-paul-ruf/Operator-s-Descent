import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  attachViewportGestures,
  createViewportCamera,
  DRAG_THRESHOLD_PX,
  MAX_ZOOM_SCALE,
  sizeCanvasToContainer,
  WHEEL_ZOOM_SENSITIVITY
} from '../../src/ui/viewport.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.style = { properties: {}, touchAction: '', width: '', height: '', setProperty(name, value) { this.properties[name] = value; } };
    this.listeners = new Map();
    this._pointerCapture = new Set();
    this._rect = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener, options) {
    const bucket = this.listeners.get(type) || [];
    bucket.push({ listener, options });
    this.listeners.set(type, bucket);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry.listener !== listener));
  }
  dispatch(type, event = {}) {
    for (const { listener } of this.listeners.get(type) || []) listener(event);
  }
  listenerCount() {
    let total = 0;
    for (const bucket of this.listeners.values()) total += bucket.length;
    return total;
  }
  setPointerCapture(id) { this._pointerCapture.add(id); }
  releasePointerCapture(id) { this._pointerCapture.delete(id); }
  getBoundingClientRect() { return this._rect || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
}

function makeElement(rect = { left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 }) {
  const element = new FakeElement('div');
  element._rect = rect;
  return element;
}

function pointerEvent(overrides = {}) {
  let prevented = false;
  return {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    deltaY: 0,
    preventDefault() { prevented = true; },
    get defaultPrevented() { return prevented; },
    ...overrides
  };
}

describe('createViewportCamera', () => {
  test('fit centers both axes for a wider-than-tall world by letterboxing top/bottom', () => {
    const cam = createViewportCamera({ worldW: 200, worldH: 100 });
    cam.setViewport(200, 200);
    cam.fit();
    const s = cam.getState();
    // fitScale = min(200/200, 200/100) = 1 → world 200×100 fits width, 100px letterbox / axis.
    expect(s.scale).toBe(1);
    // Y axis letterboxes: y = (worldH - viewH/scale) / 2 = (100 - 200) / 2 = -50.
    expect(s.y).toBe(-50);
    expect(s.x).toBe(0);
  });

  test('per-axis letterbox centering: when one axis fits and the other overflows, only the fitting axis centers', () => {
    const cam = createViewportCamera({ worldW: 100, worldH: 400 });
    cam.setViewport(200, 200);
    cam.fit();
    // fitScale = min(200/100, 200/400) = 0.5 → world span 100×400 → view span 400×400 world px.
    // X: worldW*scale = 50 ≤ viewW=200 → letterbox center: x = (100 - 400) / 2 = -150.
    // Y: worldH*scale = 200 ≤ viewH=200 → letterbox center: y = (400 - 400) / 2 = 0.
    const s = cam.getState();
    expect(s.scale).toBe(0.5);
    expect(s.x).toBe(-150);
    expect(s.y).toBe(0);
  });

  test('panBy clamps at world edges when the world is larger than the viewport', () => {
    const cam = createViewportCamera({ worldW: 400, worldH: 800 });
    cam.setViewport(200, 200);
    cam.fit();
    // fitScale = 0.25 → world spans 100×200 in screen px.
    // World is BIGGER than viewport when scaled up. Zoom in to make it so.
    cam.zoomAt(100, 100, 4); // scale becomes 1.0 (fitScale * MAX_ZOOM_SCALE)
    const beforeState = cam.getState();
    expect(beforeState.scale).toBe(1);
    // At scale=1, worldW*scale=400 > viewW=200 → x clamps to [0, worldW - viewW/scale] = [0, 200].
    cam.panBy(-10000, -10000); // huge screen-px pan → clamps to (0, 0)
    let s = cam.getState();
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    cam.panBy(10000, 10000); // huge positive pan → clamps to max
    s = cam.getState();
    expect(s.x).toBe(200);
    expect(s.y).toBe(600);
  });

  test('scale clamps to [fitScale, fitScale * MAX_ZOOM_SCALE]', () => {
    const cam = createViewportCamera({ worldW: 200, worldH: 200 });
    cam.setViewport(200, 200);
    cam.fit();
    const floor = cam.fitScale();
    expect(floor).toBe(1);
    cam.zoomAt(100, 100, 0.01);
    expect(cam.getState().scale).toBe(floor);
    cam.zoomAt(100, 100, 1000);
    expect(cam.getState().scale).toBe(floor * MAX_ZOOM_SCALE);
  });

  test('zoomAt keeps the world point under the anchor pinned across the zoom', () => {
    const cam = createViewportCamera({ worldW: 400, worldH: 400 });
    cam.setViewport(200, 200);
    cam.fit();
    // Anchor near the top-left where clamping won't disturb the invariant.
    const anchor = { x: 60, y: 60 };
    const before = cam.screenToWorld(anchor.x, anchor.y);
    cam.zoomAt(anchor.x, anchor.y, 2);
    const after = cam.screenToWorld(anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  test('screenToWorld and viewTransform round-trip a screen point through the current camera', () => {
    const cam = createViewportCamera({ worldW: 400, worldH: 400 });
    cam.setViewport(200, 200);
    cam.fit();
    cam.zoomAt(50, 50, 2);
    const t = cam.viewTransform();
    // World point (wx, wy) draws at (wx * scale + dx, wy * scale + dy).
    // For screen (sx, sy) the world point is (sx - dx) / scale, (sy - dy) / scale.
    const s = { x: 40, y: 60 };
    const world = cam.screenToWorld(s.x, s.y);
    const backX = world.x * t.scale + t.dx;
    const backY = world.y * t.scale + t.dy;
    expect(backX).toBeCloseTo(s.x, 6);
    expect(backY).toBeCloseTo(s.y, 6);
  });

  test('viewTransform folds devicePixelRatio into scale and offsets', () => {
    const cam = createViewportCamera({ worldW: 200, worldH: 200 });
    cam.setViewport(200, 200);
    cam.fit(); // scale = 1, x=0, y=0
    const t1 = cam.viewTransform(1);
    expect(t1).toEqual({ scale: 1, dx: -0, dy: -0 });
    const t2 = cam.viewTransform(2);
    expect(t2.scale).toBe(2);
  });

  test('zoomToCells clamps target scale to [fitScale, fitScale * MAX_ZOOM_SCALE] and preserves the view center', () => {
    // World 400×400, viewport 200×200 → fitScale = min(200/400, 200/400) = 0.5.
    // Mid case: worldCellPx=20, targetScreenPx=15 → 15/20 = 0.75, inside [0.5, 2.0].
    const camMid = createViewportCamera({ worldW: 400, worldH: 400 });
    camMid.setViewport(200, 200);
    camMid.fit();
    camMid.centerOn(150, 220);
    const midBefore = camMid.getState();
    const centerBeforeMid = {
      x: midBefore.x + midBefore.viewW / (2 * midBefore.scale),
      y: midBefore.y + midBefore.viewH / (2 * midBefore.scale)
    };
    camMid.zoomToCells(20, 15);
    const midAfter = camMid.getState();
    expect(midAfter.scale).toBeCloseTo(15 / 20, 6);
    const centerAfterMid = {
      x: midAfter.x + midAfter.viewW / (2 * midAfter.scale),
      y: midAfter.y + midAfter.viewH / (2 * midAfter.scale)
    };
    expect(centerAfterMid.x).toBeCloseTo(centerBeforeMid.x, 6);
    expect(centerAfterMid.y).toBeCloseTo(centerBeforeMid.y, 6);

    // Upper clamp: targetScreenPx / worldCellPx = 100 > fitScale * MAX_ZOOM_SCALE = 2.0 → pins to 2.0.
    const camHigh = createViewportCamera({ worldW: 400, worldH: 400 });
    camHigh.setViewport(200, 200);
    camHigh.fit();
    camHigh.centerOn(200, 200);
    const highBefore = camHigh.getState();
    const centerBeforeHigh = {
      x: highBefore.x + highBefore.viewW / (2 * highBefore.scale),
      y: highBefore.y + highBefore.viewH / (2 * highBefore.scale)
    };
    camHigh.zoomToCells(1, 100);
    const highAfter = camHigh.getState();
    expect(highAfter.scale).toBe(camHigh.fitScale() * MAX_ZOOM_SCALE);
    const centerAfterHigh = {
      x: highAfter.x + highAfter.viewW / (2 * highAfter.scale),
      y: highAfter.y + highAfter.viewH / (2 * highAfter.scale)
    };
    expect(centerAfterHigh.x).toBeCloseTo(centerBeforeHigh.x, 6);
    expect(centerAfterHigh.y).toBeCloseTo(centerBeforeHigh.y, 6);
  });

  test('setViewport preserves the view center across a viewport resize', () => {
    const cam = createViewportCamera({ worldW: 400, worldH: 400 });
    cam.setViewport(200, 200);
    cam.fit();
    cam.zoomAt(100, 100, 2);
    cam.centerOn(150, 200);
    const before = cam.getState();
    const centerXBefore = before.x + before.viewW / (2 * before.scale);
    const centerYBefore = before.y + before.viewH / (2 * before.scale);
    cam.setViewport(300, 300);
    const after = cam.getState();
    const centerXAfter = after.x + after.viewW / (2 * after.scale);
    const centerYAfter = after.y + after.viewH / (2 * after.scale);
    expect(centerXAfter).toBeCloseTo(centerXBefore, 6);
    expect(centerYAfter).toBeCloseTo(centerYBefore, 6);
  });
});

describe('attachViewportGestures', () => {
  function makeCamera() {
    const calls = [];
    return {
      calls,
      panBy(dx, dy) { calls.push(['panBy', dx, dy]); },
      zoomAt(sx, sy, factor) { calls.push(['zoomAt', sx, sy, factor]); }
    };
  }

  test('drag below threshold fires onTap with release coords; above threshold pans and suppresses tap', () => {
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    let changes = 0;
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event), onChange: () => { changes++; } });
    // Below-threshold press+release. Tap fires with RELEASE clientX/clientY so
    // a stationary press that jitters between press and release lands where
    // the finger actually lifted, not where it first pressed.
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 30, clientY: 40 }));
    element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 31, clientY: 40 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 32, clientY: 41 }));
    expect(taps).toEqual([{ clientX: 32, clientY: 41 }]);
    expect(camera.calls).toEqual([]);
    // Above threshold → drag, no tap.
    element.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 100, clientY: 100 }));
    element.dispatch('pointermove', pointerEvent({ pointerId: 2, clientX: 100 + DRAG_THRESHOLD_PX + 5, clientY: 100 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 2, clientX: 100 + DRAG_THRESHOLD_PX + 5, clientY: 100 }));
    expect(camera.calls.some((c) => c[0] === 'panBy')).toBe(true);
    expect(taps).toHaveLength(1);
    expect(changes).toBeGreaterThan(0);
    cleanup();
  });

  test('release displacement above threshold with no intermediate move still pans and suppresses tap', () => {
    // Some browsers coalesce or drop the final pointermove before pointerup.
    // The release coordinates must feed the classifier so a threshold-crossing
    // release never falls through to onTap.
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 50 + DRAG_THRESHOLD_PX + 2, clientY: 50 }));
    expect(taps).toEqual([]);
    const pan = camera.calls.find((c) => c[0] === 'panBy');
    expect(pan).toBeTruthy();
    expect(pan[1]).toBe(-(DRAG_THRESHOLD_PX + 2));
    expect(pan[2]).toBeCloseTo(0, 10);
    cleanup();
  });

  test('exactly-at-threshold displacement classifies as drag, not tap', () => {
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
    element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100 }));
    expect(taps).toEqual([]);
    expect(camera.calls.some((c) => c[0] === 'panBy')).toBe(true);
    cleanup();
  });

  test('below-threshold displacement never crosses even after multiple micro-moves back to origin', () => {
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
    // Every intermediate frame sits ≤ 4px off origin so we stay a tap.
    element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 103, clientY: 100 }));
    element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
    element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 102, clientY: 101 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 101, clientY: 100 }));
    expect(taps).toEqual([{ clientX: 101, clientY: 100 }]);
    expect(camera.calls).toEqual([]);
    cleanup();
  });

  test('cumulative sub-step micro-moves that exceed the threshold from origin pan and suppress tap', () => {
    // Each pointermove step is < DRAG_THRESHOLD_PX from the previous position,
    // so a naive last-position threshold check would never fire; classification
    // must measure displacement from the fixed press origin.
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
    for (let step = 2; step <= 10; step += 2) {
      element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 100 + step, clientY: 100 }));
    }
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 110, clientY: 100 }));
    expect(taps).toEqual([]);
    expect(camera.calls.some((c) => c[0] === 'panBy')).toBe(true);
    cleanup();
  });

  test('returning near the origin after crossing the threshold keeps the gesture disqualified from tapping', () => {
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
    // First move blows past the threshold.
    element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 130, clientY: 100 }));
    // Sub-threshold return trip; the drag latch must survive it.
    element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 101, clientY: 100 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 100, clientY: 100 }));
    expect(taps).toEqual([]);
    expect(camera.calls.filter((c) => c[0] === 'panBy').length).toBeGreaterThanOrEqual(2);
    cleanup();
  });

  test('pinch spread invokes zoomAt with dist / prevDist and adds mid-point pan', () => {
    const element = makeElement();
    const camera = makeCamera();
    const cleanup = attachViewportGestures(element, camera);
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 80, clientY: 100 }));
    element.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 120, clientY: 100 }));
    // Initial dist = 40; spread to 80 → factor 2.
    element.dispatch('pointermove', pointerEvent({ pointerId: 2, clientX: 160, clientY: 100 }));
    const zoom = camera.calls.find((c) => c[0] === 'zoomAt');
    expect(zoom).toBeTruthy();
    expect(zoom[3]).toBeCloseTo(2, 6);
    // Mid-point sits between (80,100) and (160,100) → (120, 100). Original mid was (100, 100).
    // Mid-point pan feeds (prevMid - mid) to panBy → (100 - 120, 100 - 100) = (-20, 0).
    const pan = camera.calls.find((c) => c[0] === 'panBy');
    expect(pan).toEqual(['panBy', -20, 0]);
    cleanup();
  });

  test('wheel zoom uses exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) anchored at the cursor', () => {
    const element = makeElement();
    const camera = makeCamera();
    const cleanup = attachViewportGestures(element, camera);
    const event = pointerEvent({ clientX: 42, clientY: 60, deltaY: 100 });
    element.dispatch('wheel', event);
    expect(event.defaultPrevented).toBe(true);
    const zoom = camera.calls.find((c) => c[0] === 'zoomAt');
    expect(zoom[1]).toBe(42);
    expect(zoom[2]).toBe(60);
    expect(zoom[3]).toBeCloseTo(Math.exp(-100 * WHEEL_ZOOM_SENSITIVITY), 6);
    cleanup();
  });

  test('cleanup removes every listener and restores touchAction', () => {
    const element = makeElement();
    element.style.touchAction = 'pan-y';
    const before = element.listenerCount();
    expect(before).toBe(0);
    const cleanup = attachViewportGestures(element, makeCamera());
    expect(element.style.touchAction).toBe('none');
    expect(element.listenerCount()).toBeGreaterThan(0);
    cleanup();
    expect(element.listenerCount()).toBe(0);
    expect(element.style.touchAction).toBe('pan-y');
  });

  test('pinch entering suppresses the pending single-pointer tap', () => {
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    element.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 100, clientY: 50 }));
    // Second finger lifts; first still down.
    element.dispatch('pointerup', pointerEvent({ pointerId: 2, clientX: 100, clientY: 50 }));
    // First finger lifts without moving — should NOT fire tap because a pinch happened.
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    expect(taps).toEqual([]);
    cleanup();
  });

  test('pinch → single-finger pan continuation pans but never regains tap eligibility', () => {
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 60, clientY: 60 }));
    element.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 120, clientY: 60 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 2, clientX: 120, clientY: 60 }));
    // Remaining pointer 1 continues to pan; the disqualified latch must survive
    // the pinch → single-finger transition and suppress any release-fire tap.
    element.dispatch('pointermove', pointerEvent({ pointerId: 1, clientX: 80, clientY: 60 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 80, clientY: 60 }));
    expect(taps).toEqual([]);
    // Even a fresh press+release after the disqualified gesture re-enables tap.
    element.dispatch('pointerdown', pointerEvent({ pointerId: 9, clientX: 200, clientY: 200 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 9, clientX: 200, clientY: 200 }));
    expect(taps).toEqual([{ clientX: 200, clientY: 200 }]);
    cleanup();
  });

  test('pointercancel on one pointer latches disqualified for the remaining pointer release', () => {
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    element.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 100, clientY: 50 }));
    element.dispatch('pointercancel', pointerEvent({ pointerId: 2, clientX: 100, clientY: 50 }));
    // Pointer 1 releases stationary — latched cancel must forbid the tap.
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    expect(taps).toEqual([]);
    cleanup();
  });

  test('lostpointercapture disqualifies the current gesture and unbinds cleanly', () => {
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 40, clientY: 60 }));
    element.dispatch('lostpointercapture', pointerEvent({ pointerId: 1, clientX: 40, clientY: 60 }));
    // A late-arriving stationary release must not tap after the browser reclaimed capture.
    element.dispatch('pointerup', pointerEvent({ pointerId: 1, clientX: 40, clientY: 60 }));
    expect(taps).toEqual([]);
    // Fresh gesture afterwards resets the latch.
    element.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 150, clientY: 150 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 2, clientX: 150, clientY: 150 }));
    expect(taps).toEqual([{ clientX: 150, clientY: 150 }]);
    cleanup();
  });

  test('non-primary pointer ordering: the second-down pointer releasing first still cleanly ends the pinch', () => {
    // Pointers can arrive/depart in arbitrary id order; the first-down finger
    // may release before the second on real hardware, in which case the pinch
    // must hand off drag continuation to the still-held pointer, and neither
    // subsequent release is allowed to tap.
    const element = makeElement();
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    element.dispatch('pointerdown', pointerEvent({ pointerId: 7, clientX: 60, clientY: 60 }));
    element.dispatch('pointerdown', pointerEvent({ pointerId: 3, clientX: 140, clientY: 60 }));
    // First-down (id 7) releases while id 3 remains → pinch collapses onto id 3.
    element.dispatch('pointerup', pointerEvent({ pointerId: 7, clientX: 60, clientY: 60 }));
    // Second-down (id 3) releases stationary — no tap because the pinch latched.
    element.dispatch('pointerup', pointerEvent({ pointerId: 3, clientX: 140, clientY: 60 }));
    expect(taps).toEqual([]);
    cleanup();
  });

  test('cleanup removes every listener including lostpointercapture and clears in-flight state', () => {
    const element = makeElement();
    element.style.touchAction = 'pan-y';
    const camera = makeCamera();
    const taps = [];
    const cleanup = attachViewportGestures(element, camera, { onTap: (event) => taps.push(event) });
    // Enter a pinch so every state field is populated before we tear down.
    element.dispatch('pointerdown', pointerEvent({ pointerId: 1, clientX: 50, clientY: 50 }));
    element.dispatch('pointerdown', pointerEvent({ pointerId: 2, clientX: 100, clientY: 50 }));
    expect(element.listenerCount()).toBeGreaterThan(0);
    cleanup();
    // Every listener bucket empty — pointerdown/move/up/cancel/lostpointercapture/wheel/touchmove.
    expect(element.listenerCount()).toBe(0);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'wheel', 'touchmove']) {
      expect(element.listeners.get(type) ?? []).toEqual([]);
    }
    expect(element.style.touchAction).toBe('pan-y');
    // Dispatches after cleanup must be no-ops — state fields cleared, callbacks unbound.
    element.dispatch('pointerdown', pointerEvent({ pointerId: 5, clientX: 10, clientY: 10 }));
    element.dispatch('pointerup', pointerEvent({ pointerId: 5, clientX: 10, clientY: 10 }));
    expect(taps).toEqual([]);
    expect(camera.calls).toEqual([]);
  });
});

describe('sizeCanvasToContainer', () => {
  let originalDpr;
  beforeEach(() => { originalDpr = globalThis.devicePixelRatio; });
  afterEach(() => {
    if (originalDpr === undefined) delete globalThis.devicePixelRatio;
    else globalThis.devicePixelRatio = originalDpr;
  });

  test('backs the canvas with container CSS box × devicePixelRatio', () => {
    globalThis.devicePixelRatio = 2;
    const container = new FakeElement('div');
    container._rect = { left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 };
    const canvas = new FakeElement('canvas');
    const size = sizeCanvasToContainer(canvas, container);
    expect(size).toEqual({ w: 320, h: 240, dpr: 2 });
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(canvas.style.width).toBe('320px');
    expect(canvas.style.height).toBe('240px');
  });

  test('defaults dpr to 1 when devicePixelRatio is missing', () => {
    delete globalThis.devicePixelRatio;
    const container = new FakeElement('div');
    container._rect = { left: 0, top: 0, width: 100, height: 80, right: 100, bottom: 80 };
    const canvas = new FakeElement('canvas');
    const size = sizeCanvasToContainer(canvas, container);
    expect(size.dpr).toBe(1);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(80);
  });
});
