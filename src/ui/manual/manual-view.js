/**
 * createManualView — TOC + section renderer + back stack for the manual
 * (the-manual SESSION-03 CP2). Ships alongside `createManualModal` — the
 * modal owns the shell (focus trap, inert, glitch registration); the view
 * owns everything inside `.manual-body`.
 *
 * Contract with the shell:
 * - `element`      root <div> the shell appends into `.manual-body`
 * - `showSection`  render a section by id; unknown id → showTOC + warn
 * - `showTOC`      render the table of contents
 * - `back()`       pop the back stack; no-op at empty
 * - `canBack()`    boolean — is there a stack entry to pop?
 * - `setManual`    swap the data pointer between opens (data loads lazy)
 * - `destroy()`    detach listeners, clear back stack
 *
 * Internal navigation inside the modal does NOT round-trip the bus — links
 * inside the manual receive a local dispatch that calls the renderer
 * directly. External `dispatch` (from the shell) forwards to `bus.dispatch`
 * for anything the modal itself might emit.
 *
 * Back stack cap is 32; per-section scroll positions are stored via
 * `scroll-memory` under `manual:{sectionId}` keys, with the TOC keyed as
 * `manual:toc`.
 */
import { createManualLink } from '../components.js';
import { captureScroll, clearScrollMemory, restoreScroll } from '../scroll-memory.js';

const BACK_STACK_CAP = 32;
const CHAPTER_ORDER = ['interface', 'systems', 'glossary'];
const CHAPTER_LABELS = {
  interface: 'Interface',
  systems: 'Systems',
  glossary: 'Glossary'
};
const GROUP_ORDER = ['conditions', 'schools', 'classes', 'attributes', 'consumables', 'rarities', 'affixes', 'entities'];
const GROUP_LABELS = {
  conditions: 'Conditions',
  schools: 'Schools',
  classes: 'Classes',
  attributes: 'Attributes',
  consumables: 'Consumables',
  rarities: 'Rarities',
  affixes: 'Affixes',
  entities: 'Entities'
};

function scrollKey(sectionId) {
  return sectionId ? `manual:${sectionId}` : 'manual:toc';
}

function safeWarn(message) {
  try { console.warn(message); } catch { /* no-op */ }
}

export function createManualView({ manual = null, dispatch = null, onNavigate = null } = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) {
    // No DOM available — return an inert stub so callers still get a shape.
    return {
      element: null,
      showSection() {},
      showTOC() {},
      back() {},
      canBack: () => false,
      setManual() {},
      destroy() {}
    };
  }

  let manualData = manual;
  let element = doc.createElement('div');
  element.className = 'manual-view';

  // currentSectionId === null represents the TOC.
  let currentSectionId = null;
  let rendered = false; // first render must always run, even for the TOC (null → null)
  const backStack = [];
  const linkCleanups = [];

  function sectionsById() {
    const sections = Array.isArray(manualData?.sections) ? manualData.sections : [];
    const map = new Map();
    for (const section of sections) if (section?.id) map.set(section.id, section);
    return map;
  }

  function clearLinkCleanups() {
    for (const off of linkCleanups.splice(0)) {
      try { off?.(); } catch { /* no-op */ }
    }
  }

  function captureCurrentScroll() {
    captureScroll(element, scrollKey(currentSectionId));
  }

  function restoreCurrentScroll() {
    restoreScroll(element, scrollKey(currentSectionId));
  }

  function externalDispatch(event, payload) {
    if (typeof dispatch === 'function') {
      try { dispatch(event, payload); } catch (error) { safeWarn(`manual link dispatch failed: ${error}`); }
    }
  }

  // Local dispatch — intercepts internal manual navigation so it does NOT
  // round-trip through the bus. Every other event forwards externally.
  function internalDispatch(event, payload) {
    if (event === 'ui:manual-open') {
      navigate(payload?.target ?? null);
      return;
    }
    externalDispatch(event, payload);
  }

  function makeManualLink(target, label, opts = {}) {
    const link = createManualLink(target, {
      label,
      source: opts.source || 'manual-body',
      dispatch: internalDispatch,
      variant: opts.variant || 'inline',
      testid: opts.testid ?? false
    });
    if (typeof link.cleanup === 'function') linkCleanups.push(link.cleanup);
    return link;
  }

  function unavailableNotice() {
    const notice = doc.createElement('div');
    notice.className = 'manual-notice';
    notice.dataset.testid = 'manual-notice';
    notice.textContent = 'MANUAL DATA UNAVAILABLE';
    return notice;
  }

  function renderTOC() {
    clearLinkCleanups();
    if (typeof element.replaceChildren === 'function') element.replaceChildren();
    else if ('innerHTML' in element) element.innerHTML = '';

    const wrapper = doc.createElement('div');
    wrapper.className = 'manual-toc';
    wrapper.dataset.testid = 'manual-toc';

    const sections = Array.isArray(manualData?.sections) ? manualData.sections : [];
    if (sections.length === 0) {
      wrapper.appendChild(unavailableNotice());
      element.appendChild(wrapper);
      return;
    }

    const byChapter = new Map();
    for (const section of sections) {
      if (!section?.chapter) continue;
      if (!byChapter.has(section.chapter)) byChapter.set(section.chapter, []);
      byChapter.get(section.chapter).push(section);
    }

    for (const chapter of CHAPTER_ORDER) {
      const chapterSections = byChapter.get(chapter);
      if (!chapterSections || chapterSections.length === 0) continue;
      const block = doc.createElement('section');
      block.className = `manual-chapter manual-chapter-${chapter}`;
      block.dataset.testid = `manual-chapter-${chapter}`;
      const heading = doc.createElement('h2');
      heading.className = 'manual-chapter-title';
      heading.textContent = CHAPTER_LABELS[chapter] || chapter;
      block.appendChild(heading);

      if (chapter === 'glossary') {
        const byGroup = new Map();
        for (const section of chapterSections) {
          const key = section.group || 'other';
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key).push(section);
        }
        const knownFirst = [...GROUP_ORDER, ...[...byGroup.keys()].filter((key) => !GROUP_ORDER.includes(key))];
        for (const group of knownFirst) {
          const groupSections = byGroup.get(group);
          if (!groupSections || groupSections.length === 0) continue;
          const groupBlock = doc.createElement('div');
          groupBlock.className = `manual-group manual-group-${group}`;
          groupBlock.dataset.testid = `manual-group-${group}`;
          const groupHeading = doc.createElement('h3');
          groupHeading.className = 'manual-group-title';
          groupHeading.textContent = GROUP_LABELS[group] || group;
          groupBlock.appendChild(groupHeading);
          const list = doc.createElement('ul');
          list.className = 'manual-toc-list';
          for (const section of groupSections) {
            const item = doc.createElement('li');
            item.appendChild(makeManualLink(section.id, section.title || section.id, { source: 'manual-toc' }));
            list.appendChild(item);
          }
          groupBlock.appendChild(list);
          block.appendChild(groupBlock);
        }
      } else {
        const list = doc.createElement('ul');
        list.className = 'manual-toc-list';
        for (const section of chapterSections) {
          const item = doc.createElement('li');
          item.appendChild(makeManualLink(section.id, section.title || section.id, { source: 'manual-toc' }));
          list.appendChild(item);
        }
        block.appendChild(list);
      }
      wrapper.appendChild(block);
    }
    element.appendChild(wrapper);
  }

  function renderSection(section) {
    clearLinkCleanups();
    if (typeof element.replaceChildren === 'function') element.replaceChildren();
    else if ('innerHTML' in element) element.innerHTML = '';

    const wrapper = doc.createElement('article');
    wrapper.className = 'manual-section';
    wrapper.dataset.testid = 'manual-section';
    wrapper.dataset.sectionId = section.id;

    const title = doc.createElement('h2');
    title.className = 'manual-section-title';
    title.dataset.testid = 'manual-section-title';
    title.textContent = section.title || section.id;
    wrapper.appendChild(title);

    if (Array.isArray(section.body)) {
      for (const paragraph of section.body) {
        if (!Array.isArray(paragraph)) continue;
        const p = doc.createElement('p');
        p.className = 'manual-paragraph';
        for (const run of paragraph) {
          if (!Array.isArray(run) || run.length < 2) continue;
          if (run[0] === 'text') {
            const text = doc.createElement('span');
            text.textContent = String(run[1] ?? '');
            p.appendChild(text);
          } else if (run[0] === 'link' && run.length === 3) {
            p.appendChild(makeManualLink(run[1], String(run[2]), { source: 'manual-body' }));
          }
        }
        wrapper.appendChild(p);
      }
    }

    if (Array.isArray(section.seeAlso) && section.seeAlso.length > 0) {
      const sections = sectionsById();
      const footer = doc.createElement('footer');
      footer.className = 'manual-see-also';
      footer.dataset.testid = 'manual-see-also';
      const label = doc.createElement('span');
      label.className = 'manual-see-also-label';
      label.textContent = 'See also:';
      footer.appendChild(label);
      for (const target of section.seeAlso) {
        const related = sections.get(target);
        footer.appendChild(makeManualLink(target, related?.title || target, { source: 'manual-see-also', variant: 'chip' }));
      }
      wrapper.appendChild(footer);
    }

    element.appendChild(wrapper);
  }

  // Render whatever `nextSectionId` targets — null means the TOC. Does NOT
  // touch the back stack; used by both public navigate() and back().
  function renderTarget(nextSectionId) {
    if (rendered) captureCurrentScroll();
    currentSectionId = nextSectionId;
    if (nextSectionId == null) {
      renderTOC();
      onNavigate?.({ sectionId: null, title: 'Contents' });
    } else {
      const section = sectionsById().get(nextSectionId);
      if (!section) {
        // Should not happen — callers pre-check. Fall back to TOC.
        currentSectionId = null;
        renderTOC();
        onNavigate?.({ sectionId: null, title: 'Contents' });
        rendered = true;
        return;
      }
      renderSection(section);
      onNavigate?.({ sectionId: section.id, title: section.title || section.id });
    }
    rendered = true;
    restoreCurrentScroll();
  }

  // Forward navigation — pushes the CURRENT location onto the back stack
  // before rendering the new one.
  function navigate(nextSectionId) {
    if (nextSectionId != null) {
      const section = sectionsById().get(nextSectionId);
      if (!section) {
        safeWarn(`manual: unknown section id "${nextSectionId}"`);
        // Unknown target falls back to TOC WITHOUT pushing to the stack —
        // the user was going somewhere, not away from where they are.
        renderTarget(null);
        return;
      }
    }
    if (rendered && currentSectionId === nextSectionId) return; // idempotent
    if (rendered) {
      backStack.push(currentSectionId);
      while (backStack.length > BACK_STACK_CAP) backStack.shift();
    }
    renderTarget(nextSectionId);
  }

  function back() {
    if (backStack.length === 0) return;
    const previous = backStack.pop();
    renderTarget(previous ?? null);
  }

  return {
    element,
    showSection: navigate,
    showTOC() { navigate(null); },
    back,
    canBack: () => backStack.length > 0,
    setManual(next) {
      manualData = next;
      // Re-render whatever we're currently showing so the new data appears.
      renderTarget(currentSectionId);
    },
    destroy() {
      clearLinkCleanups();
      backStack.splice(0);
      clearScrollMemory('manual:');
      if (element && typeof element.replaceChildren === 'function') element.replaceChildren();
      element = null;
    }
  };
}
