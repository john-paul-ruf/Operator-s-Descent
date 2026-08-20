import { createIcon } from './icon.js';

const PLAYER_BANK_START = 0xE000;
const PLAYER_BANK_END = 0xE030;
const BESTIARY_BANK_START = 0xE030;
const BESTIARY_BANK_END = 0xE048;
const SIGIL_SIZES = new Set([34, 72, 108, 220]);
const SIGIL_ROLES = new Set(['player', 'enemy', 'echo']);
const ICON_SIZES = new Set([14, 16, 20, 24]);

const RARITY_COLORS = {
  Stock: '#7ec8e3',
  Tuned: '#2ed4c1',
  Custom: '#e8c63a',
  Prototype: '#c63ae8',
  CORRUPT: '#e83a3a'
};

// Condition-id → lucide icon glyph. Kept internal to components.js so
// createConditionTag can prefix a tone-agnostic icon without callers passing
// per-tag icons. Unknown conditions fall through with no icon.
const CONDITION_ICONS = {
  burning: 'flame',
  jammed: 'zap',
  shielded: 'shield',
  marked: 'target',
  panicked: 'circle-help',
  immobilized: 'hand-metal',
  overloaded: 'gauge',
  drained: 'battery',
  blinded: 'eye-off'
};

let nextControlId = 0;

function withCleanup(element, cleanup = () => {}) {
  element.cleanup = cleanup;
  return element;
}

function listen(element, eventName, listener, options) {
  element.addEventListener(eventName, listener, options);
  return () => element.removeEventListener(eventName, listener, options);
}

function applyControlState(element, opts) {
  if (opts.label) element.setAttribute('aria-label', opts.label);
  if (opts.description) element.setAttribute('aria-description', opts.description);
  if (opts.describedBy) element.setAttribute('aria-describedby', opts.describedBy);
  if (opts.disabled) {
    element.disabled = true;
    element.setAttribute('aria-disabled', 'true');
  }
  if (opts.busy) element.setAttribute('aria-busy', 'true');
  if (opts.selected != null) element.setAttribute('aria-selected', String(Boolean(opts.selected)));
  if (opts.error) {
    element.setAttribute('aria-invalid', 'true');
    element.classList.add('error');
  }
}

// Best-effort prefix an icon child on any control that took a label first.
// When document lacks createElementNS (some FakeDocuments in tests), or the
// sprite lookup throws, we silently skip the icon AND the has-icon class so
// the marker never lies about what actually rendered.
function prefixIcon(host, iconId, iconSize, iconTone) {
  if (!iconId) return;
  if (typeof document?.createElementNS !== 'function') return;
  let icon;
  try {
    icon = createIcon(iconId, {
      size: ICON_SIZES.has(iconSize) ? iconSize : 16,
      tone: iconTone
    });
  } catch {
    return;
  }
  host.classList.add('has-icon');
  if (typeof host.prepend === 'function') host.prepend(icon);
  else host.appendChild(icon);
}

export function createButton(label, opts = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = opts.primary ? 'btn-crt btn-primary primary' : 'btn-crt';
  button.textContent = label;
  if (opts.danger) button.classList.add('danger');
  if (opts.selected) button.classList.add('selected');
  button.classList.add('is-interactive');
  applyControlState(button, opts);
  prefixIcon(button, opts.icon, opts.iconSize, opts.iconTone);
  return withCleanup(button, opts.onClick ? listen(button, 'click', opts.onClick) : undefined);
}

export function createSlider(label, value, onChange, opts = {}) {
  const row = document.createElement('label');
  row.className = 'slider-row console-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'slider-label';
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min ?? 0);
  input.max = String(opts.max ?? 100);
  input.step = String(opts.step ?? 1);
  input.value = String(value);
  input.id = opts.id || `slider-${++nextControlId}`;
  input.classList.add('is-interactive');
  applyControlState(input, opts);
  const valueEl = document.createElement('span');
  valueEl.className = 'slider-value';
  valueEl.setAttribute('aria-live', 'polite');
  valueEl.textContent = `${value}%`;
  const cleanup = listen(input, 'input', () => {
    valueEl.textContent = `${input.value}%`;
    onChange(Number(input.value));
  });
  row.append(labelEl, input, valueEl);
  return withCleanup(row, cleanup);
}

export function createToggle(label, value, onChange, opts = {}) {
  const wrapper = document.createElement('label');
  wrapper.className = 'toggle-row console-row';
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'toggle-input';
  input.checked = Boolean(value);
  input.disabled = Boolean(opts.disabled);
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', opts.label || label);
  const visual = document.createElement('span');
  visual.className = `toggle is-interactive${value ? ' on' : ''}`;
  visual.setAttribute('aria-hidden', 'true');
  if (opts.disabled) visual.setAttribute('aria-disabled', 'true');
  const knob = document.createElement('span');
  knob.className = 'toggle-knob';
  visual.appendChild(knob);
  const cleanup = listen(input, 'change', () => {
    visual.classList.toggle('on', input.checked);
    onChange(input.checked);
  });
  wrapper.append(text, input, visual);
  return withCleanup(wrapper, cleanup);
}

export function createTextInput(label, value, onInput, opts = {}) {
  const wrapper = document.createElement('label');
  wrapper.className = 'text-input-row console-row';
  const text = document.createElement('span');
  text.className = 'input-label';
  text.textContent = label;
  const input = document.createElement(opts.multiline ? 'textarea' : 'input');
  input.className = opts.className || 'link-input';
  if (!opts.multiline) input.type = opts.type || 'text';
  input.value = value || '';
  applyControlState(input, opts);
  const cleanup = listen(input, 'input', () => onInput(input.value));
  wrapper.append(text, input);
  return withCleanup(wrapper, cleanup);
}

export function validateSigilToken(codepoint, size, role = 'player') {
  if (!SIGIL_SIZES.has(size)) return { valid: false, error: 'invalid-size' };
  if (!SIGIL_ROLES.has(role)) return { valid: false, error: 'invalid-role' };
  const isPlayerBank = codepoint >= PLAYER_BANK_START && codepoint < PLAYER_BANK_END;
  const isBestiaryBank = codepoint >= BESTIARY_BANK_START && codepoint < BESTIARY_BANK_END;
  if ((role === 'player' || role === 'echo') && !isPlayerBank) return { valid: false, error: 'invalid-player-bank' };
  if (role === 'enemy' && !isBestiaryBank) return { valid: false, error: 'invalid-enemy-bank' };
  return { valid: true };
}

export function createSigilToken(codepoint, size, opts = {}) {
  const role = opts.role || 'player';
  const validation = validateSigilToken(codepoint, size, role);
  if (!validation.valid) throw new RangeError(`invalid sigil token: ${validation.error}`);
  const el = document.createElement('span');
  el.className = `creature-sigil sigil-${size} sigil-role-${role}`;
  el.dataset.sigilRole = role;
  el.setAttribute('aria-hidden', opts.label ? 'false' : 'true');
  if (opts.label) el.setAttribute('aria-label', opts.label);
  el.textContent = String.fromCodePoint(codepoint);
  return el;
}

export function createHPBar(current, max) {
  return createMeter(`${current}/${max}`, current, max, 'hp-bar');
}

export function createChargeBar(current, max) {
  return createMeter(`${current}/${max}`, current, max, 'charge-bar');
}

function createMeter(textValue, current, max, className) {
  const container = document.createElement('div');
  container.className = className;
  container.setAttribute('role', 'meter');
  container.setAttribute('aria-valuemin', '0');
  container.setAttribute('aria-valuemax', String(max));
  container.setAttribute('aria-valuenow', String(current));
  container.setAttribute('aria-valuetext', textValue);
  const text = document.createElement('span');
  text.className = className === 'hp-bar' ? 'hp-text' : 'charge-text';
  text.textContent = textValue;
  const bar = document.createElement('div');
  bar.className = 'bar-track';
  const fill = document.createElement('div');
  fill.className = className === 'hp-bar'
    ? 'bar-fill bar-fill-hp bar-fill-danger'
    : 'bar-fill bar-fill-charge';
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  fill.style.width = `${pct}%`;
  if (className === 'hp-bar' && pct < 25) fill.classList.add('danger');
  bar.appendChild(fill);
  container.append(text, bar);
  return container;
}

export function createRarityTag(rarity, opts = {}) {
  const color = RARITY_COLORS[rarity] || RARITY_COLORS.Stock;
  if (opts && opts.manualLink) {
    const link = createManualLink(
      opts.manualLink.target ?? `rarity_${String(rarity).toLowerCase()}`,
      { label: String(rarity), source: opts.manualLink.source, dispatch: opts.manualLink.dispatch }
    );
    link.classList.add('rarity-tag');
    link.style.color = color;
    return link;
  }
  const tag = document.createElement('span');
  tag.className = 'rarity-tag';
  tag.textContent = rarity;
  tag.style.color = color;
  return tag;
}

export function createAffixTag(affix, isMajor, opts = {}) {
  const text = affix.name || affix.id || '';
  if (opts && opts.manualLink) {
    const link = createManualLink(
      opts.manualLink.target ?? 'affixes',
      { label: text, source: opts.manualLink.source, dispatch: opts.manualLink.dispatch }
    );
    link.classList.add('affix-tag');
    if (isMajor) link.classList.add('affix-major');
    return link;
  }
  const tag = document.createElement('span');
  tag.className = `affix-tag${isMajor ? ' affix-major' : ''}`;
  tag.textContent = text;
  return tag;
}

export function createConditionTag(conditionId, duration, opts = {}) {
  const text = duration != null ? `${conditionId} (${duration})` : String(conditionId);
  const iconId = CONDITION_ICONS[conditionId] || null;
  if (opts && opts.manualLink) {
    const link = createManualLink(
      opts.manualLink.target ?? conditionId,
      { label: text, source: opts.manualLink.source, dispatch: opts.manualLink.dispatch }
    );
    link.classList.add('condition-tag', `cond-${conditionId}`);
    prefixIcon(link, iconId, 14, null);
    return link;
  }
  const tag = document.createElement('span');
  tag.className = `condition-tag cond-${conditionId}`;
  tag.textContent = text;
  prefixIcon(tag, iconId, 14, null);
  return tag;
}

export function createEquipmentCard(item, opts = {}) {
  const card = document.createElement(opts.onClick ? 'button' : 'article');
  card.className = 'equipment-card item-card console-row';
  if (opts.onClick) card.type = 'button';
  if (item.corrupt) card.classList.add('corrupt');
  if (opts.onClick) card.classList.add('is-interactive');
  applyControlState(card, opts);
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = item.name || item.id;
  card.appendChild(name);
  const description = typeof item.description === 'string' && item.description
    ? item.description
    : (typeof opts.description === 'string' && opts.description ? opts.description : '');
  if (description) {
    const desc = document.createElement('div');
    desc.className = 'card-desc';
    desc.textContent = description;
    card.appendChild(desc);
  }
  if (Array.isArray(opts.stats) && opts.stats.length) {
    const statsRow = document.createElement('div');
    statsRow.className = 'card-stats';
    for (const chip of opts.stats) {
      const span = document.createElement('span');
      span.className = 'stat-chip';
      span.textContent = String(chip);
      statsRow.appendChild(span);
    }
    card.appendChild(statsRow);
  }
  if (item.rarity) card.appendChild(createRarityTag(item.rarity));
  if (item.affixes) for (const affix of item.affixes) card.appendChild(createAffixTag(affix, affix.category === 'major'));
  return withCleanup(card, opts.onClick ? listen(card, 'click', opts.onClick) : undefined);
}

export function createProtocolCard(protocol, opts = {}) {
  const card = document.createElement(opts.onClick ? 'button' : 'article');
  card.className = 'protocol-card action-btn console-row';
  if (opts.onClick) card.type = 'button';
  if (opts.insufficient) card.classList.add('insufficient');
  if (opts.onClick) card.classList.add('is-interactive');
  applyControlState(card, opts);
  if (protocol.school) {
    const tag = document.createElement('span');
    tag.className = `school-tag school-${protocol.school}`;
    tag.textContent = protocol.school;
    card.appendChild(tag);
  }
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = protocol.name || protocol.id;
  const cost = document.createElement('span');
  cost.className = 'action-cost';
  cost.textContent = `${protocol.chargeCost || 0} CHG`;
  card.append(name, cost);
  if (typeof protocol.effect === 'string' && protocol.effect) {
    const effect = document.createElement('div');
    effect.className = 'card-effect';
    effect.textContent = protocol.range ? `${protocol.effect} · Range: ${protocol.range}` : protocol.effect;
    card.appendChild(effect);
  }
  return withCleanup(card, opts.onClick ? listen(card, 'click', opts.onClick) : undefined);
}

/**
 * attachDoubleActivate — install a double-activation gesture on any element.
 * Fires `handler` when the element receives a native `dblclick` OR two
 * `pointerup` events within `windowMs` (default 350ms) and `slop` pixels
 * (default 24). Both paths short-circuit while the element is disabled so
 * the ADA-inert affordance stays honest. Returns a cleanup fn that removes
 * both listeners.
 *
 * SESSION-03 depends on this API shape: attachDoubleActivate(el, fn, opts)
 * → cleanup. Options: { windowMs?: number, slop?: number }.
 *
 * @param {HTMLElement} element
 * @param {(event: Event) => void} handler
 * @param {{ windowMs?: number, slop?: number }} [opts]
 * @returns {() => void}
 */
export function attachDoubleActivate(element, handler, opts = {}) {
  const windowMs = Number(opts.windowMs ?? 350);
  const slop = Number(opts.slop ?? 24);
  let lastTime = 0;
  let lastX = 0;
  let lastY = 0;
  const isDisabled = () => Boolean(element.disabled);
  const cleanups = [
    listen(element, 'dblclick', (event) => {
      if (isDisabled()) return;
      handler(event);
    }),
    listen(element, 'pointerup', (event) => {
      if (isDisabled()) return;
      const now = Number(event.timeStamp) || 0;
      const x = Number(event.clientX) || 0;
      const y = Number(event.clientY) || 0;
      if (lastTime && (now - lastTime) <= windowMs && Math.hypot(x - lastX, y - lastY) <= slop) {
        lastTime = 0;
        handler(event);
        return;
      }
      lastTime = now;
      lastX = x;
      lastY = y;
    })
  ];
  return () => cleanups.forEach((cleanup) => cleanup());
}

export function createAttributeRow(attrName, rank, opts = {}) {
  const row = document.createElement('div');
  row.className = 'attr-row console-row';
  const name = document.createElement('span');
  name.className = 'attr-name';
  name.textContent = attrName;
  const val = document.createElement('span');
  val.className = 'attr-val';
  val.textContent = String(rank);
  row.append(name, val);
  const cleanups = [];
  if (opts.steppers) {
    const dec = createButton('−', { label: `Decrease ${attrName}`, onClick: () => opts.onDecrease?.(), disabled: opts.decreaseDisabled });
    dec.className = 'stepper-btn';
    const inc = createButton('+', { label: `Increase ${attrName}`, onClick: () => opts.onIncrease?.(), disabled: opts.increaseDisabled });
    inc.className = 'stepper-btn';
    cleanups.push(dec.cleanup, inc.cleanup);
    row.append(dec, inc);
  }
  return withCleanup(row, () => cleanups.forEach((cleanup) => cleanup?.()));
}

export function createPanel(opts = {}) {
  const panel = document.createElement('section');
  panel.className = opts.elevated ? 'panel-elevated' : 'panel';
  if (opts.title) {
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = opts.title;
    panel.setAttribute('aria-label', opts.title);
    panel.appendChild(title);
  }
  return panel;
}

/**
 * @deprecated Use createScreenBody instead — the `.scroll-area` region is
 * superseded by the `.screen-body` scroll container. Kept for current
 * call-sites; per-screen sessions migrate.
 */
export function createScrollArea(opts = {}) {
  const area = document.createElement('div');
  area.className = 'scroll-area';
  if (opts.label) area.setAttribute('aria-label', opts.label);
  area.tabIndex = opts.focusable ? 0 : -1;
  return area;
}

/**
 * createScreenBody — scrollable region between status strip and console.
 * visual-parity-v4 SESSION-02.
 *
 * @param {{scroll?: boolean, className?: string}} [opts]
 * @returns {HTMLDivElement}
 */
export const createScreenBody = ({ scroll = true, className = '' } = {}) => {
  const el = document.createElement('div');
  el.className = ['screen-body', scroll ? '' : 'screen-body--no-scroll', className]
    .filter(Boolean)
    .join(' ');
  return el;
};

/**
 * createUpdateToast — persistent CRT-styled "new build cached" notice with a
 * RELOAD action. Mounted in response to `runtime:update-ready` while the user
 * is on an in-run surface (creation/exploration/combat) so a fresh service
 * worker never yanks the page mid-turn.
 *
 * @param {{onReload: () => void}} opts
 * @returns {HTMLDivElement}
 */
/**
 * createManualLink — shared factory for every "term hyperlink" in the UI
 * (the-manual SESSION-02). Renders a native <button type="button"> that
 * dispatches `ui:manual-open` via an injected dispatcher.
 *
 * DI note: components.js currently imports nothing (bus stays out). Callers
 * pass `opts.dispatch = (event, payload) => bus.dispatch(event, payload)`.
 * When `opts.dispatch` is omitted the link is marked `aria-disabled="true"`
 * and clicks are inert — the modal is not yet wired.
 *
 * Event contract (fixed for the-manual — SESSION-01/03 consume this verbatim):
 *   `ui:manual-open` payload = { target: sectionId|null, source: string }
 *
 * @param {string|null} target - manual section id, or null for the TOC
 * @param {{
 *   label?: string,
 *   variant?: 'inline'|'chip',
 *   source?: string,
 *   dispatch?: (event: string, payload: object) => void,
 *   describedBy?: string,
 *   disabled?: boolean,
 *   testid?: false | string
 * }} [opts]
 * @returns {HTMLButtonElement}
 */
export function createManualLink(target, opts = {}) {
  const variant = opts.variant === 'chip' ? 'chip' : 'inline';
  const displayLabel = opts.label || (variant === 'chip' ? '?' : (target ?? 'contents'));
  const ariaAnchor = opts.label || target || 'contents';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant === 'chip'
    ? 'manual-term-link manual-term-link--chip is-interactive'
    : 'manual-term-link is-interactive';
  button.textContent = String(displayLabel);
  button.setAttribute('aria-label', `Open manual: ${ariaAnchor}`);
  button.setAttribute('data-manual-target', target == null ? '' : String(target));
  if (opts.testid !== false) {
    button.dataset.testid = typeof opts.testid === 'string'
      ? opts.testid
      : `manual-link-${target || 'toc'}`;
  }
  if (opts.describedBy) button.setAttribute('aria-describedby', opts.describedBy);
  const canDispatch = typeof opts.dispatch === 'function';
  const explicitlyDisabled = Boolean(opts.disabled);
  const inert = explicitlyDisabled || !canDispatch;
  if (inert) button.setAttribute('aria-disabled', 'true');
  if (explicitlyDisabled) button.disabled = true;
  const cleanup = (canDispatch && !explicitlyDisabled)
    ? listen(button, 'click', () => {
        opts.dispatch('ui:manual-open', {
          target: target == null ? null : target,
          source: opts.source || 'ui'
        });
      })
    : undefined;
  prefixIcon(button, opts.icon, opts.iconSize, opts.iconTone);
  return withCleanup(button, cleanup);
}

export function createUpdateToast({ onReload } = {}) {
  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.dataset.testid = 'update-toast';
  const label = document.createElement('span');
  label.className = 'update-toast-label';
  label.textContent = 'NEW BUILD CACHED';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-crt update-toast-reload is-interactive';
  button.textContent = 'RELOAD';
  button.dataset.testid = 'update-toast-reload';
  button.setAttribute('aria-label', 'Reload to apply the new build');
  const cleanup = typeof onReload === 'function' ? listen(button, 'click', onReload) : undefined;
  toast.append(label, button);
  return withCleanup(toast, cleanup);
}
