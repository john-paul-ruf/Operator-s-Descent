export const WIDE_MEDIA_QUERY = '(min-width: 900px) and (min-aspect-ratio: 1/1)';

export function currentLayoutClass() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'portrait';
  return window.matchMedia(WIDE_MEDIA_QUERY).matches ? 'wide' : 'portrait';
}

export function initLayoutController({ bus }) {
  const applyLayoutAttribute = () => {
    const layout = currentLayoutClass();
    if (typeof document !== 'undefined') document.documentElement.dataset.layout = layout;
    return layout;
  };
  applyLayoutAttribute();

  let query = null;
  let handleChange = null;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const candidate = window.matchMedia(WIDE_MEDIA_QUERY);
    if (typeof candidate?.addEventListener === 'function') {
      query = candidate;
      handleChange = () => {
        bus.dispatch('ui:layout-change', { layout: applyLayoutAttribute() });
      };
      query.addEventListener('change', handleChange);
    }
  }

  return function cleanup() {
    if (query && handleChange) query.removeEventListener('change', handleChange);
    query = null;
    handleChange = null;
    if (typeof document !== 'undefined') delete document.documentElement.dataset.layout;
  };
}
