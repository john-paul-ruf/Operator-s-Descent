const RARITY_COLORS = {
  Stock: '#7ec8e3',
  Tuned: '#2ed4c1',
  Custom: '#e8c63a',
  Prototype: '#c63ae8',
  CORRUPT: '#e83a3a'
};

export function createButton(label, opts = {}) {
  const btn = document.createElement('button');
  btn.className = opts.primary ? 'btn-primary' : 'btn-crt';
  btn.textContent = label;
  if (opts.onClick) btn.addEventListener('click', opts.onClick);
  if (opts.disabled) btn.disabled = true;
  if (opts.danger) btn.classList.add('danger');
  return btn;
}

export function createSlider(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'slider-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'slider-label';
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0'; input.max = '100'; input.value = String(value);
  const valEl = document.createElement('span');
  valEl.className = 'slider-value';
  valEl.textContent = `${value}%`;
  input.addEventListener('input', () => {
    valEl.textContent = `${input.value}%`;
    onChange(Number(input.value));
  });
  row.appendChild(labelEl);
  row.appendChild(input);
  row.appendChild(valEl);
  return row;
}

export function createToggle(label, value, onChange) {
  const toggle = document.createElement('div');
  toggle.className = `toggle${value ? ' on' : ''}`;
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const knob = document.createElement('div');
  knob.className = 'toggle-knob';
  toggle.appendChild(labelEl);
  toggle.appendChild(knob);
  toggle.addEventListener('click', () => {
    value = !value;
    toggle.classList.toggle('on', value);
    onChange(value);
  });
  return toggle;
}

export function createSigilToken(codepoint, size) {
  const el = document.createElement('span');
  el.className = 'sigil-placeholder';
  if (size >= 108) el.classList.add('large');
  if (size <= 34) el.classList.add('small');
  el.style.fontSize = `${size}px`;
  el.style.fontFamily = "'DESCENT SIGIL', monospace";
  el.textContent = String.fromCodePoint(codepoint);
  return el;
}

export function createHPBar(current, max) {
  const container = document.createElement('div');
  container.className = 'hp-bar';
  const text = document.createElement('span');
  text.className = 'hp-text';
  text.textContent = `${current}/${max}`;
  const bar = document.createElement('div');
  bar.className = 'bar-track';
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  const pct = max > 0 ? (current / max) * 100 : 0;
  fill.style.width = `${pct}%`;
  if (pct < 25) fill.classList.add('danger');
  bar.appendChild(fill);
  container.appendChild(text);
  container.appendChild(bar);
  return container;
}

export function createChargeBar(current, max) {
  const container = document.createElement('div');
  container.className = 'charge-bar';
  const text = document.createElement('span');
  text.className = 'charge-text';
  text.textContent = `${current}/${max}`;
  const bar = document.createElement('div');
  bar.className = 'bar-track';
  const fill = document.createElement('div');
  fill.className = 'bar-fill';
  fill.style.width = `${max > 0 ? (current / max) * 100 : 0}%`;
  bar.appendChild(fill);
  container.appendChild(text);
  container.appendChild(bar);
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
  tag.className = 'condition-tag';
  tag.textContent = duration != null ? `${conditionId} (${duration})` : conditionId;
  return tag;
}

export function createEquipmentCard(item, opts = {}) {
  const card = document.createElement('div');
  card.className = 'equipment-card';
  if (item.corrupt) card.classList.add('corrupt');
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = item.name || item.id;
  card.appendChild(name);
  if (item.rarity) card.appendChild(createRarityTag(item.rarity));
  if (item.affixes) {
    for (const affix of item.affixes) {
      card.appendChild(createAffixTag(affix, affix.category === 'major'));
    }
  }
  if (opts.onClick) card.addEventListener('click', opts.onClick);
  return card;
}

export function createProtocolCard(protocol, opts = {}) {
  const card = document.createElement('div');
  card.className = 'protocol-card';
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = protocol.name || protocol.id;
  const cost = document.createElement('span');
  cost.className = 'action-cost';
  cost.textContent = `${protocol.chargeCost || 0} CHG`;
  card.appendChild(name);
  card.appendChild(cost);
  if (opts.onClick) card.addEventListener('click', opts.onClick);
  return card;
}

export function createAttributeRow(attrName, rank, opts = {}) {
  const row = document.createElement('div');
  row.className = 'attr-row';
  const name = document.createElement('span');
  name.className = 'attr-name';
  name.textContent = attrName;
  const val = document.createElement('span');
  val.className = 'attr-val';
  val.textContent = String(rank);
  row.appendChild(name);
  row.appendChild(val);
  if (opts.steppers) {
    const dec = document.createElement('button');
    dec.className = 'stepper-btn';
    dec.textContent = '-';
    dec.addEventListener('click', () => opts.onDecrease?.());
    const inc = document.createElement('button');
    inc.className = 'stepper-btn';
    inc.textContent = '+';
    inc.addEventListener('click', () => opts.onIncrease?.());
    row.appendChild(dec);
    row.appendChild(inc);
  }
  return row;
}

export function createPanel(opts = {}) {
  const panel = document.createElement('div');
  panel.className = opts.elevated ? 'panel-elevated' : 'panel';
  if (opts.title) {
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = opts.title;
    panel.appendChild(title);
  }
  return panel;
}

export function createScrollArea() {
  const area = document.createElement('div');
  area.className = 'scroll-area';
  return area;
}