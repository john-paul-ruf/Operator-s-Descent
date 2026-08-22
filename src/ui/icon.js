// createIcon(id, opts?) — pure DOM factory that returns an <svg> element
// wrapping a <use href="assets/icons.svg#<id>"/>. The relative href matches
// the cache-first rule in service-worker.js so icons resolve offline.
//
// opts:
//   size:      14 | 16 | 20 | 24  (default 16)
//   label:     accessible label; when set, the svg exposes role="img" +
//              aria-label. When null/undefined, aria-hidden="true".
//   className: extra classes appended after the base icon classes.
//   tone:      'danger' | 'accent' | 'dim' — maps to .icon-<tone>.
//
// The factory throws if `id` is falsy — every caller passes an explicit
// constant, and silent misses are the wrong default in this codebase. It
// does NOT verify that the sprite contains a matching <symbol id>; the
// build-pipelines test enforces that guarantee at build time.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SPRITE_URL = 'assets/icons.svg';
const ALLOWED_SIZES = new Set([14, 16, 20, 24]);
const ALLOWED_TONES = new Set(['danger', 'accent', 'dim']);

export const ICON_IDS = new Set([
  'sword', 'shield', 'zap', 'target', 'circle-x', 'flame', 'hand-metal', 'clock',
  'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
  'arrow-up-left', 'arrow-up-right', 'arrow-down-left', 'arrow-down-right',
  'corner-down-right', 'footprints',
  'backpack', 'package', 'recycle', 'star', 'sparkles',
  'users', 'user', 'heart', 'battery',
  'flask-conical', 'wand-sparkles', 'gauge',
  'archive', 'box', 'gem',
  'scroll-text', 'link', 'download', 'upload',
  'menu', 'chevron-left', 'chevron-right', 'chevron-down', 'x', 'check',
  'circle-help', 'info', 'triangle-alert', 'eye', 'eye-off', 'hash'
]);

export function isIconId(id) {
  return typeof id === 'string' && ICON_IDS.has(id);
}

export function createIcon(id, opts = {}) {
  if (!id) throw new Error('unknown icon id');
  const size = ALLOWED_SIZES.has(opts.size) ? opts.size : 16;
  const label = opts.label ?? null;
  const tone = ALLOWED_TONES.has(opts.tone) ? opts.tone : null;
  const extra = typeof opts.className === 'string' ? opts.className.trim() : '';

  const classes = ['icon', `icon-${size}`];
  if (tone) classes.push(`icon-${tone}`);
  if (extra) classes.push(extra);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', classes.join(' '));
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${SPRITE_URL}#${id}`);
  svg.appendChild(use);

  return svg;
}
