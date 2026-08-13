const PLAYER_BANK_START = 0xE000;
const PLAYER_BANK_END = 0xE030;
const BESTIARY_BANK_START = 0xE030;
const BESTIARY_BANK_END = 0xE048;
const SIGIL_SIZES = new Set([34, 72, 108, 220]);
const SIGIL_ROLES = new Set(['player', 'enemy', 'echo']);

const RARITY_COLORS = {
  Stock: '#7ec8e3',
  Tuned: '#2ed4c1',
  Custom: '#e8c63a',
  Prototype: '#c63ae8',
  CORRUPT: '#e83a3a'
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
  if (opts.disabled) element.disabled = true;
  if (opts.busy) element.setAttribute('aria-busy', 'true');
  if (opts.selected != null) element.setAttribute('aria-selected', String(Boolean(opts.selected)));
  if (opts.error) {
    element.setAttribute('aria-invalid', 'true');
    element.classList.add('error');
  }
}

export function createButton(label, opts = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = opts.primary ? 'btn-crt btn-primary primary' : 'btn-crt';
  button.textContent = label;
  if (opts.danger) button.classList.add('danger');
  if (opts.selected) button.classList.add('selected');
  applyControlState(button, opts);
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
  visual.className = `toggle${value ? ' on' : ''}`;
  visual.setAttribute('aria-hidden', 'true');
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

export function createRarityTag(rarity) {
  const tag = document.createElement('span');
  tag.className = 'rarity-tag';
  tag.textContent = rarity;
  tag.style.color = RARITY_COLORS[rarity] || RARITY_COLORS.Stock;
  return tag;
}

export function createAffixTag(affix, isMajor) {
  const tag = document.createElement('span');
  tag.className = `affix-tag${isMajor ? ' affix-major' : ''}`;
  tag.textContent = affix.name || affix.id || '';
  return tag;
}

export function createConditionTag(conditionId, duration) {
  const tag = document.createElement('span');
  tag.className = `condition-tag cond-${conditionId}`;
  tag.textContent = duration != null ? `${conditionId} (${duration})` : conditionId;
  return tag;
}

export function createEquipmentCard(item, opts = {}) {
  const card = document.createElement(opts.onClick ? 'button' : 'article');
  card.className = 'equipment-card item-card console-row';
  if (opts.onClick) card.type = 'button';
  if (item.corrupt) card.classList.add('corrupt');
  applyControlState(card, opts);
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = item.name || item.id;
  card.appendChild(name);
  if (item.rarity) card.appendChild(createRarityTag(item.rarity));
  if (item.affixes) for (const affix of item.affixes) card.appendChild(createAffixTag(affix, affix.category === 'major'));
  return withCleanup(card, opts.onClick ? listen(card, 'click', opts.onClick) : undefined);
}

export function createProtocolCard(protocol, opts = {}) {
  const card = document.createElement(opts.onClick ? 'button' : 'article');
  card.className = 'protocol-card action-btn console-row';
  if (opts.onClick) card.type = 'button';
  if (opts.insufficient) card.classList.add('insufficient');
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
  return withCleanup(card, opts.onClick ? listen(card, 'click', opts.onClick) : undefined);
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
