function isReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  } catch {
    return false;
  }
}

function raf(fn) {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(fn);
  } else {
    setTimeout(fn, 16);
  }
}

export function playBootSequence(container) {
  return new Promise((resolve) => {
    if (isReducedMotion()) {
      container.style.opacity = '0';
      container.style.transition = 'opacity 0.5s';
      raf(() => { container.style.opacity = '1'; });
      setTimeout(resolve, 500);
      return;
    }

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

    setTimeout(() => {
      container.style.transition = '';
      container.style.transform = '';
      container.style.transformOrigin = '';
      container.style.filter = '';
      resolve();
    }, 1200);
  });
}

export function playDescentSequence(container) {
  return new Promise((resolve) => {
    if (isReducedMotion()) {
      container.style.opacity = '0';
      container.style.transition = 'opacity 0.3s';
      raf(() => { container.style.opacity = '1'; });
      setTimeout(resolve, 300);
      return;
    }

    const original = {
      transform: container.style.transform || '',
      filter: container.style.filter || '',
      opacity: container.style.opacity || ''
    };

    container.style.transition = 'none';
    container.style.filter = 'brightness(2) blur(4px)';
    container.style.transform = `${original.transform} translateY(-20%)`;

    raf(() => {
      container.style.transition = 'transform 400ms ease-in, filter 400ms ease-in';
      container.style.transform = `${original.transform} translateY(20%)`;
      container.style.filter = 'brightness(0.5) blur(8px)';
    });

    setTimeout(() => {
      container.style.transition = 'transform 200ms ease-out, filter 200ms ease-out';
      container.style.transform = original.transform;
      container.style.filter = original.filter;
    }, 400);

    setTimeout(() => {
      container.style.transition = '';
      container.style.transform = original.transform;
      container.style.filter = original.filter;
      container.style.opacity = original.opacity;
      resolve();
    }, 800);
  });
}

export function playDeathSequence(container, character) {
  return new Promise((resolve) => {
    if (isReducedMotion()) {
      container.style.opacity = '0.3';
      container.style.transition = 'opacity 0.4s';
      setTimeout(() => {
        container.style.opacity = '1';
        resolve();
      }, 400);
      return;
    }

    const original = {
      filter: container.style.filter || '',
      transform: container.style.transform || ''
    };

    container.style.transition = 'none';
    container.style.filter = 'hue-rotate(180deg) saturate(2) brightness(0.5)';
    container.style.transform = `${original.transform} scale(1.02)`;

    raf(() => {
      container.style.transition = 'filter 200ms ease-in, transform 200ms ease-in';
      container.style.filter = 'hue-rotate(0deg) saturate(0) brightness(2)';
      container.style.transform = `${original.transform} scale(0.98)`;
    });

    setTimeout(() => {
      container.style.transition = 'filter 200ms ease-out, transform 200ms ease-out';
      container.style.filter = original.filter;
      container.style.transform = original.transform;
    }, 200);

    setTimeout(() => {
      container.style.transition = '';
      container.style.filter = original.filter;
      container.style.transform = original.transform;
      resolve();
    }, 600);
  });
}