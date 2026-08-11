import { resolveMotionPolicy } from './glitch.js';

function reduced(options = {}) {
  return options.glitchEnabled === false || resolveMotionPolicy(options.settings || options).reduced;
}

function raf(fn) {
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(fn);
  else setTimeout(fn, 16);
}

function after(ms, fn) {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
}

function staticFade(container, duration) {
  return new Promise((resolve) => {
    container.style.opacity = '0.35';
    container.style.transition = `opacity ${duration}ms linear`;
    raf(() => { container.style.opacity = '1'; });
    after(duration, () => {
      container.style.transition = '';
      resolve();
    });
  });
}

function restore(container, original) {
  container.style.transition = original.transition;
  container.style.opacity = original.opacity;
  container.style.filter = original.filter;
  container.style.transform = original.transform;
  container.style.transformOrigin = original.transformOrigin;
}

function snapshot(container) {
  return {
    transition: container.style.transition || '',
    opacity: container.style.opacity || '',
    filter: container.style.filter || '',
    transform: container.style.transform || '',
    transformOrigin: container.style.transformOrigin || ''
  };
}

export function playBootSequence(container, options = {}) {
  if (reduced(options)) return staticFade(container, 180);
  return new Promise((resolve) => {
    const original = snapshot(container);
    container.style.opacity = '0';
    container.style.filter = 'brightness(3) contrast(2)';
    container.style.transform = 'scaleY(0.01)';
    container.style.transformOrigin = 'center';
    container.style.transition = 'none';
    raf(() => {
      container.style.transition = 'transform 200ms ease-out, filter 400ms ease-out, opacity 200ms ease-out';
      container.style.opacity = '1';
      container.style.transform = 'scaleY(1)';
      container.style.filter = 'brightness(1) contrast(1)';
    });
    after(1200, () => { restore(container, original); resolve(); });
  });
}

export function playDescentSequence(container, options = {}) {
  if (reduced(options)) return staticFade(container, 160);
  return new Promise((resolve) => {
    const original = snapshot(container);
    container.style.transition = 'none';
    container.style.filter = 'brightness(2) blur(4px)';
    container.style.transform = `${original.transform} translateY(-20%)`;
    raf(() => {
      container.style.transition = 'transform 400ms ease-in, filter 400ms ease-in';
      container.style.transform = `${original.transform} translateY(20%)`;
      container.style.filter = 'brightness(0.5) blur(8px)';
    });
    after(400, () => {
      container.style.transition = 'transform 200ms ease-out, filter 200ms ease-out';
      container.style.transform = original.transform;
      container.style.filter = original.filter;
    });
    after(800, () => { restore(container, original); resolve(); });
  });
}

export function playDeathSequence(container, character, options = {}) {
  if (reduced(options)) return staticFade(container, 200);
  return new Promise((resolve) => {
    const original = snapshot(container);
    container.style.transition = 'none';
    container.style.filter = 'hue-rotate(180deg) saturate(2) brightness(0.5)';
    container.style.transform = `${original.transform} scale(1.02)`;
    raf(() => {
      container.style.transition = 'filter 200ms ease-in, transform 200ms ease-in';
      container.style.filter = 'hue-rotate(0deg) saturate(0) brightness(2)';
      container.style.transform = `${original.transform} scale(0.98)`;
    });
    after(200, () => {
      container.style.transition = 'filter 200ms ease-out, transform 200ms ease-out';
      container.style.filter = original.filter;
      container.style.transform = original.transform;
    });
    after(600, () => { restore(container, original); resolve(); });
  });
}
