/**
 * createManualModal — blocking manual overlay controller.
 *
 * Mounts a focus-trapped dialog into `parent` (typically `#portrait-frame`)
 * as a sibling of `#app-root`. Setting `inert` on the root while the modal
 * is open bypasses every screen's per-container key/pointer handlers without
 * touching the screens themselves. The dialog sits at z-index 50 — under CRT
 * layers (55–62) so scanlines and grain visibly render on top — and above
 * the console (z 30) so the reader is fully covered while reading.
 *
 * The controller is created once and reused: DOM is built lazily on the first
 * open() and kept hidden across close/reopen cycles until destroy() rips it
 * out. This survives layout-class remounts (the modal lives outside #app-root,
 * so the runtime's route re-mount does not touch it) without needing to
 * re-establish focus or scroll state.
 *
 * The renderer is injected — see `createManualView` in `./manual-view.js`.
 *
 * @param {{
 *   bus: { dispatch: (event: string, payload: object) => void },
 *   getManualData: () => object | null,
 *   parent: HTMLElement | null,
 *   glitch?: { registerElement?: Function, unregisterElement?: Function } | null,
 *   createView?: (opts: object) => object
 * }} options
 */
import { createButton, createManualLink } from '../components.js';
import { createManualView } from './manual-view.js';

const CLOSE_REASONS = new Set(['escape', 'close-button', 'backdrop', 'programmatic']);

function safeCall(fn, ...args) {
  try {
    return fn?.(...args);
  } catch (error) {
    console.warn('manual modal:', error);
    return undefined;
  }
}

function listen(target, type, handler, options) {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener?.(type, handler, options);
}

function focusableWithin(root) {
  if (!root?.querySelectorAll) return [];
  const nodes = root.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
  const list = Array.from(nodes || []);
  return list.filter((node) => {
    if (!node) return false;
    if (node.disabled) return false;
    if (node.getAttribute?.('aria-disabled') === 'true') return false;
    const tabIndex = node.tabIndex;
    if (typeof tabIndex === 'number' && tabIndex < 0) return false;
    return true;
  });
}

export function createManualModal(options = {}) {
  const {
    bus,
    getManualData,
    parent,
    glitch = null,
    createView = createManualView
  } = options;

  const doc = typeof document !== 'undefined' ? document : null;

  let root = null;              // .manual-backdrop
  let panel = null;             // section.manual-modal
  let titleSlot = null;
  let backBtn = null;
  let closeBtn = null;
  let body = null;
  let view = null;
  let invoker = null;
  let open = false;
  let cleanups = [];
  let registeredGlitchEls = [];
  let appRoot = null;
  let appRootPreviousAriaHidden = null;
  let appRootHadInert = false;

  const listenerCleanups = () => {
    for (const off of cleanups) safeCall(off);
    cleanups = [];
  };

  const dispatchToBus = (event, payload) => {
    safeCall(bus?.dispatch, event, payload);
  };

  const registerGlitch = () => {
    if (!glitch?.registerElement || !root?.querySelectorAll) return;
    const nodes = root.querySelectorAll('[data-glitch]');
    for (const node of Array.from(nodes || [])) {
      const raw = Number(node.dataset?.glitchIntensity || 0.06);
      const intensity = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.06;
      safeCall(glitch.registerElement.bind(glitch), node, intensity);
      registeredGlitchEls.push(node);
    }
  };

  const unregisterGlitch = () => {
    if (glitch?.unregisterElement) {
      for (const node of registeredGlitchEls) safeCall(glitch.unregisterElement.bind(glitch), node);
    }
    registeredGlitchEls = [];
  };

  const showSection = (target) => view?.showSection?.(target);
  const showTOC = () => view?.showTOC?.();

  const updateTitleSlot = (text) => {
    if (titleSlot) titleSlot.textContent = text || '';
  };

  const syncBackButton = () => {
    if (!backBtn) return;
    const canBack = Boolean(view?.canBack?.());
    backBtn.disabled = !canBack;
    if (canBack) backBtn.removeAttribute?.('aria-disabled');
    else backBtn.setAttribute?.('aria-disabled', 'true');
  };

  const handleNavigate = ({ sectionId, title } = {}) => {
    updateTitleSlot(sectionId ? title || '' : 'Contents');
    syncBackButton();
    if (body) body.scrollTop = 0;
  };

  const buildDom = () => {
    if (!doc || root) return;
    root = doc.createElement('div');
    root.className = 'manual-backdrop';
    root.dataset.testid = 'manual-backdrop';
    root.hidden = true;
    if (root.style) root.style.display = 'none';

    panel = doc.createElement('section');
    panel.className = 'manual-modal';
    panel.dataset.testid = 'manual-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', "Operator's manual");
    panel.tabIndex = -1;

    const header = doc.createElement('header');
    header.className = 'manual-header';

    const eyebrow = doc.createElement('div');
    eyebrow.className = 'manual-eyebrow';
    eyebrow.textContent = "◈ OPERATOR'S MANUAL";
    eyebrow.dataset.glitch = '';
    eyebrow.dataset.glitchIntensity = '0.06';

    titleSlot = doc.createElement('div');
    titleSlot.className = 'manual-title-slot';
    titleSlot.dataset.testid = 'manual-title-slot';
    titleSlot.textContent = 'Contents';

    const controls = doc.createElement('div');
    controls.className = 'manual-controls';

    backBtn = createButton('BACK', {
      label: 'Back to previous manual section',
      onClick: () => {
        if (view?.canBack?.()) view.back();
      }
    });
    backBtn.dataset.testid = 'manual-back';
    backBtn.disabled = true;
    backBtn.setAttribute('aria-disabled', 'true');
    cleanups.push(backBtn.cleanup);

    // CONTENTS uses createManualLink so the affordance matches every other
    // manual button in the UI; local dispatch keeps navigation inside the
    // renderer without round-tripping the bus.
    const contentsLink = createManualLink(null, {
      label: 'CONTENTS',
      source: 'manual-header',
      variant: 'chip',
      dispatch: (event, payload) => {
        if (event === 'ui:manual-open') showSection(payload?.target ?? null);
      },
      testid: 'manual-contents'
    });
    cleanups.push(contentsLink.cleanup);

    closeBtn = createButton('✕', {
      label: 'Close manual',
      onClick: () => close('close-button')
    });
    closeBtn.dataset.testid = 'manual-close';
    cleanups.push(closeBtn.cleanup);

    controls.append(backBtn, contentsLink, closeBtn);
    header.append(eyebrow, titleSlot, controls);

    body = doc.createElement('div');
    body.className = 'manual-body';
    body.dataset.testid = 'manual-body';

    view = createView({
      manual: getManualData?.() ?? null,
      dispatch: (event, payload) => dispatchToBus(event, payload),
      onNavigate: handleNavigate,
      testid: undefined
    });
    if (view?.element) body.appendChild(view.element);

    panel.append(header, body);
    root.appendChild(panel);
    parent?.appendChild?.(root);
  };

  const setInertOnAppRoot = (value) => {
    if (!doc) return;
    appRoot = appRoot || doc.getElementById?.('app-root') || null;
    if (!appRoot) return;
    if (value) {
      appRootHadInert = 'inert' in appRoot;
      appRootPreviousAriaHidden = appRoot.getAttribute?.('aria-hidden') ?? null;
      if (appRootHadInert) {
        try { appRoot.inert = true; } catch { /* no-op */ }
      }
      appRoot.setAttribute?.('aria-hidden', 'true');
    } else {
      if (appRootHadInert) {
        try { appRoot.inert = false; } catch { /* no-op */ }
      }
      if (appRootPreviousAriaHidden == null) appRoot.removeAttribute?.('aria-hidden');
      else appRoot.setAttribute?.('aria-hidden', appRootPreviousAriaHidden);
      appRootPreviousAriaHidden = null;
    }
  };

  const trapFocus = (event) => {
    if (event?.key !== 'Tab') return;
    const focusables = focusableWithin(panel);
    if (focusables.length === 0) {
      event.preventDefault?.();
      panel?.focus?.();
      return;
    }
    const active = doc?.activeElement;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey) {
      if (active === first || !panel?.contains?.(active)) {
        event.preventDefault?.();
        last?.focus?.();
      }
    } else {
      if (active === last || !panel?.contains?.(active)) {
        event.preventDefault?.();
        first?.focus?.();
      }
    }
  };

  const handleKeydown = (event) => {
    if (!open) return;
    if (event?.key === 'Escape') {
      event.preventDefault?.();
      close('escape');
      return;
    }
    trapFocus(event);
  };

  const handleBackdropClick = (event) => {
    if (!open) return;
    if (event?.target === root) close('backdrop');
  };

  const enforceFocus = (event) => {
    if (!open || !panel || !doc) return;
    const target = event?.target;
    if (!target) return;
    if (panel === target) return;
    if (typeof panel.contains === 'function' && panel.contains(target)) return;
    // Focus escaped — bring it back to the first focusable in the modal
    const focusables = focusableWithin(panel);
    (focusables[0] || panel).focus?.();
  };

  function close(reason = 'programmatic') {
    if (!open) return;
    const closeReason = CLOSE_REASONS.has(reason) ? reason : 'programmatic';
    open = false;
    listenerCleanups();
    unregisterGlitch();
    if (root) {
      root.hidden = true;
      if (root.style) root.style.display = 'none';
    }
    setInertOnAppRoot(false);
    if (invoker && (invoker.isConnected !== false)) safeCall(invoker.focus?.bind(invoker));
    else appRoot?.focus?.();
    invoker = null;
    dispatchToBus('ui:manual-close', { reason: closeReason });
  }

  function openModal({ target = null, source = 'program' } = {}) {
    if (!doc) return;
    if (!root) buildDom();
    if (!root) return;

    invoker = doc.activeElement || null;
    root.hidden = false;
    if (root.style) root.style.display = '';
    open = true;

    // Re-render manual content on every open — data may have loaded between
    // the controller's creation (activateRuntime) and the first open.
    if (view?.setManual) view.setManual(getManualData?.() ?? null);

    if (target) showSection(target);
    else showTOC();

    setInertOnAppRoot(true);
    registerGlitch();

    cleanups.push(listen(root, 'keydown', handleKeydown));
    cleanups.push(listen(root, 'click', handleBackdropClick));
    if (doc.addEventListener) cleanups.push(listen(doc, 'focusin', enforceFocus));

    safeCall(closeBtn?.focus?.bind(closeBtn));
    if (source && typeof source !== 'string') {
      console.warn('manual modal: ignoring non-string source', source);
    }
  }

  return {
    open: openModal,
    close,
    isOpen: () => open,
    destroy() {
      if (open) close('programmatic');
      listenerCleanups();
      unregisterGlitch();
      view?.destroy?.();
      view = null;
      if (root?.parentNode?.removeChild) root.parentNode.removeChild(root);
      root = null;
      panel = null;
      titleSlot = null;
      backBtn = null;
      closeBtn = null;
      body = null;
      appRoot = null;
      appRootPreviousAriaHidden = null;
      appRootHadInert = false;
    },
    get element() { return root; }
  };
}
