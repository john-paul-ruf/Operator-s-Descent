import { createButton, createScrollArea } from '../components.js';
import { encodeRun, initEncoder } from '../../state/save-encode.js';

const EVENT_TYPES = {
  combat: '#e83a3a',
  discovery: '#2ed4c1',
  damage: '#e8c63a',
  death: '#ff0040',
  heal: '#7ec8e3',
  loot: '#e8d23a',
  progression: '#c63ae8',
  save: '#7ec8e3',
  diagnostic: '#aaa',
  info: '#aaa',
  move: '#888'
};
const stateByRun = new WeakMap();
const copyByRun = new WeakMap();

function clear(container) {
  if (typeof container.replaceChildren === 'function') container.replaceChildren();
  else while (container.firstChild) container.removeChild(container.firstChild);
}

function stateFor(runState) {
  const key = runState || globalThis;
  if (!stateByRun.has(key)) stateByRun.set(key, { notice: '', error: '', link: '' });
  return stateByRun.get(key);
}

// Deduplicate combined persisted + live log entries. Runtime pushes every combat
// bus event to BOTH runState.recentEvents (persisted, slim: {type, message, sequence, detail?})
// AND runtimeLogEntries (live, may carry `entry` + `detail`), so the merge sees each
// event twice. Key: `${type}|${sequence ?? ''}|${message}`. When both copies land, the
// richer one wins (prefers the entry that has `detail` or a nested `entry` payload).
function richness(entry) {
  return (typeof entry?.detail === 'string' && entry.detail ? 1 : 0)
    + (entry?.entry ? 1 : 0);
}

function dedupeLogEntries(entries) {
  const byKey = new Map();
  const output = [];
  for (const entry of entries) {
    const key = `${entry.type ?? ''}|${entry.sequence ?? ''}|${entry.message ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { entry, index: output.length });
      output.push(entry);
      continue;
    }
    if (richness(entry) > richness(existing.entry)) {
      output[existing.index] = entry;
      byKey.set(key, { entry, index: existing.index });
    }
  }
  return output;
}

function collectLogs(context = {}) {
  const merged = [...(context.runState?.recentEvents || []), ...(context.logEntries || [])]
    .map((entry, index) => ({ ...entry, _index: index }))
    .sort((left, right) => (left.sequence ?? left.turn ?? left.eventIndex ?? left._index) - (right.sequence ?? right.turn ?? right.eventIndex ?? right._index));
  return dedupeLogEntries(merged).slice(-64);
}

// Signed modifier chunk formatter shared by describeDetailFromFields (log-renderer twin of
// src/ui/screens/combat.js:describeEntryDetail). Kept as a small local mirror so this element
// factory stays import-free — status-strip's wide feed reuses it verbatim.
function signedModifier(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function attackDetail(entry) {
  if (!Number.isFinite(entry.naturalRoll)) return '';
  const parts = [`d20 ${entry.naturalRoll}`];
  const attrLabel = entry.attribute ? String(entry.attribute).toUpperCase() : null;
  const attrMod = signedModifier(entry.attributeModifier);
  if (attrMod && attrLabel) parts.push(`${attrMod} ${attrLabel}`);
  const accMod = signedModifier(entry.weaponAccuracy);
  if (accMod) parts.push(`${accMod} ACC`);
  const markMod = signedModifier(entry.markedBonus);
  if (markMod) parts.push(`${markMod} MARK`);
  const blindMod = signedModifier(entry.blindedPenalty);
  if (blindMod) parts.push(`${blindMod} BLIND`);
  const flankMod = signedModifier(entry.flankBonus);
  if (flankMod) parts.push(`${flankMod} FLANK`);
  const total = Number.isFinite(entry.roll) ? ` = ${entry.roll}` : '';
  let defense = '';
  if (Number.isFinite(entry.targetDefense)) {
    defense = ` vs DEF ${entry.targetDefense}`;
    const coverMod = signedModifier(entry.coverBonus);
    if (coverMod) defense += ` (incl. ${coverMod} COVER)`;
  }
  let outcome;
  if (entry.hit) {
    outcome = ' → HIT';
    if (entry.crit) outcome += ' CRIT';
    if (entry.damageDie && Number.isFinite(entry.damage)) outcome += ` · ${entry.damageDie}=${entry.damage} dmg`;
    else if (Number.isFinite(entry.damage)) outcome += ` · ${entry.damage} dmg`;
  } else {
    outcome = ' → MISS';
    if (entry.fumble) outcome += ' FUMBLE';
  }
  return parts.join(' ') + total + defense + outcome;
}

function retreatDetail(entry) {
  if (!Number.isFinite(entry.roll)) return '';
  return `d20 ${entry.roll} vs 15 → ${entry.success ? 'ESCAPE' : 'FAIL'}`;
}

function conditionDetail(entry) {
  const save = entry?.save;
  if (!save || !Number.isFinite(save.natural)) return '';
  const parts = [`d20 ${save.natural}`];
  const attrLabel = save.attribute ? String(save.attribute).toUpperCase() : null;
  const modChunk = signedModifier(save.modifier);
  if (modChunk && attrLabel) parts.push(`${modChunk} ${attrLabel}`);
  const total = Number.isFinite(save.total) ? ` = ${save.total}` : '';
  const dc = Number.isFinite(entry.dc) ? ` vs DC ${entry.dc}` : '';
  const outcome = save.success ? ' → SAVE' : ' → FAIL';
  return parts.join(' ') + total + dc + outcome;
}

function protocolDetail(entry) {
  const rolls = entry?.result?.rolls;
  const chunks = [];
  const attack = rolls?.attack;
  if (attack && Number.isFinite(attack.natural)) {
    const parts = [`d20 ${attack.natural}`];
    const modChunk = signedModifier(attack.modifier);
    if (modChunk) parts.push(`${modChunk} FOC`);
    const total = Number.isFinite(attack.total) ? ` = ${attack.total}` : '';
    const def = Number.isFinite(attack.target) ? ` vs PDEF ${attack.target}` : '';
    chunks.push(parts.join(' ') + total + def + ` → ${attack.hit ? 'HIT' : 'MISS'}`);
  }
  const overclock = rolls?.overclock;
  if (overclock && Number.isFinite(overclock.natural)) {
    const parts = [`OC d20 ${overclock.natural}`];
    const modChunk = signedModifier(overclock.modifier);
    if (modChunk) parts.push(`${modChunk} FOC`);
    const total = Number.isFinite(overclock.total) ? ` = ${overclock.total}` : '';
    const target = Number.isFinite(overclock.target) ? ` vs ${overclock.target}` : '';
    chunks.push(parts.join(' ') + total + target + ` → ${overclock.success ? 'OK' : 'FAIL'}`);
  }
  return chunks.join(' · ');
}

function detailForEntry(entry) {
  if (!entry || typeof entry !== 'object') return '';
  switch (entry.type) {
    case 'attack': return attackDetail(entry);
    case 'retreat': return retreatDetail(entry);
    case 'condition': return conditionDetail(entry);
    case 'protocol': return protocolDetail(entry);
    default: return '';
  }
}

// Live bus payloads carry `detail` from the combat screen; legacy fat log entries may nest the
// raw combat log at `entry.entry` (persisted `recentEvents` today has neither — normalizePersistedEvent
// strips to {type, message, sequence} — so those rows deliberately render one line as before).
function describeDetailFromFields(entry) {
  return detailForEntry(entry) || detailForEntry(entry?.entry);
}

export function createLogEntryElement(entry, index) {
  const el = document.createElement('div');
  el.className = `log-entry log-${entry.type || 'info'} console-row`;
  el.dataset.testid = `log-entry-${index}`;
  const order = entry.sequence ?? entry.turn ?? entry.eventIndex ?? index + 1;
  const stamp = document.createElement('span');
  stamp.className = 'log-turn';
  stamp.textContent = `[${entry.turn != null ? 'T' : 'E'}:${String(order).padStart(3, '0')}]`;
  const message = document.createElement('span');
  message.className = `log-${entry.type || 'info'}`;
  message.style.color = EVENT_TYPES[entry.type] || EVENT_TYPES.info;
  message.textContent = `${String(entry.type || 'info').toUpperCase()} · ${entry.message || entry.summary || entry.reason || JSON.stringify(entry.entry || entry)}`;
  el.append(stamp, message);
  const detailText = typeof entry.detail === 'string' && entry.detail.length > 0
    ? entry.detail
    : describeDetailFromFields(entry);
  if (detailText) {
    const detail = document.createElement('div');
    detail.className = 'log-detail micro';
    detail.dataset.testid = `log-entry-${index}-detail`;
    detail.textContent = detailText;
    detail.style.paddingLeft = '34px';
    el.appendChild(detail);
  }
  return el;
}

export function collectLogEntries(context = {}) {
  return collectLogs(context);
}

function baseUrl() {
  const location = globalThis.window?.location || globalThis.location;
  if (!location) return '';
  if (location.origin && location.pathname) return `${location.origin}${location.pathname}${location.search || ''}`;
  return String(location.href || '').split('#')[0];
}

function livingRun(runState) {
  return Boolean(runState?.party?.some((member) => (member.currentHP ?? member.hp ?? 0) > 0));
}

function fallbackCopy(container, link) {
  const field = document.createElement('textarea');
  field.className = 'log-link-fallback';
  field.dataset.testid = 'log-link-fallback';
  field.value = link;
  field.textContent = link;
  field.setAttribute('readonly', 'readonly');
  container.appendChild(field);
  field.select?.();
  try { return Boolean(document.execCommand?.('copy')); } catch { return false; }
}

async function copyLink(container, context) {
  const state = stateFor(context.runState);
  if (!livingRun(context.runState) || context.runWiped) {
    state.error = 'RUN WIPED — full-state link unavailable.';
    state.notice = '';
    state.link = '';
    context.refresh?.() || render(container, context);
    return false;
  }
  try {
    if (context.data?.symbolTable) initEncoder(context.data.symbolTable);
    const result = context.encodeRun ? context.encodeRun(context.runState) : encodeRun(context.runState);
    const fragment = typeof result === 'string' ? result : result.fragment;
    const length = result.length ?? fragment.length;
    if (!fragment || length >= 1500) throw new RangeError('save_budget_exceeded');
    const link = `${baseUrl()}#r=${fragment}`;
    state.link = link;
    let copied = false;
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(link);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) copied = fallbackCopy(container, link);
    state.notice = copied ? `LINK COPIED · ${length} chars` : 'CLIPBOARD UNAVAILABLE — SELECT LINK';
    state.error = '';
  } catch (error) {
    state.error = error?.message || error?.code || 'link_encode_failed';
    state.notice = '';
    state.link = '';
  }
  context.refresh?.() || render(container, context);
  return !state.error;
}

export function render(container, context = {}) {
  clear(container);
  const state = stateFor(context.runState);
  copyByRun.set(context.runState || globalThis, () => copyLink(container, context));
  const logs = collectLogs(context);
  const isWide = context.layout === 'wide';
  const heading = document.createElement('div');
  heading.className = isWide ? 'log-history-header' : 'mode-indicator log-heading';
  heading.textContent = `◈ EVENT LOG — FLOOR ${String(context.runState?.depth || 1).padStart(2, '0')}`;
  container.appendChild(heading);
  const logArea = createScrollArea({ label: 'Recent event log', focusable: true });
  logArea.className = 'log-area scroll-area';
  logArea.dataset.testid = 'log-area';

  if (!logs.length) logArea.appendChild(Object.assign(document.createElement('div'), { className: 'log-empty console-row', textContent: 'No events logged.' }));
  for (let index = 0; index < logs.length; index++) logArea.appendChild(createLogEntryElement(logs[index], index));
  container.appendChild(logArea);

  const share = document.createElement('div');
  share.className = isWide ? 'log-share share-panel panel-elevated' : 'log-share panel-elevated';
  share.dataset.testid = 'log-share';
  share.appendChild(Object.assign(document.createElement('div'), { className: 'mode-indicator', textContent: '◈ SHARE RUN' }));
  share.appendChild(Object.assign(document.createElement('div'), { className: 'log-budget', textContent: 'URL < 1500 chars' }));
  if (state.link) {
    const fallback = document.createElement('input');
    fallback.type = 'text';
    fallback.className = isWide ? 'log-link-text share-input console-row' : 'log-link-text console-row';
    fallback.dataset.testid = 'log-link-text';
    fallback.value = state.link;
    fallback.setAttribute('readonly', 'readonly');
    share.appendChild(fallback);
  }
  // SESSION-05 (icon-first-ui-density) — per GAP §3.8 COPY LINK is icon-only
  // when enabled (link sprite, accent tone). Disabled path keeps the text
  // "◈ COPY LINK" so the reason chip reads clearly.
  const copyDisabled = !livingRun(context.runState) || context.runWiped;
  const copyBtn = createButton(copyDisabled ? '◈ COPY LINK' : '', {
    primary: true,
    disabled: copyDisabled,
    description: copyDisabled ? 'Full-state link unavailable after wipe.' : '',
    onClick: () => copyLink(container, context),
    icon: 'link', iconSize: 14,
    iconTone: copyDisabled ? undefined : 'accent',
    label: copyDisabled ? undefined : 'Copy link'
  });
  copyBtn.dataset.testid = 'log-copy-link';
  share.appendChild(copyBtn);
  container.appendChild(share);
  if (state.notice) {
    const notice = document.createElement('div');
    notice.className = 'log-notice console-row';
    notice.dataset.testid = 'log-notice';
    notice.textContent = state.notice;
    container.appendChild(notice);
  }
  if (state.error) {
    const error = document.createElement('div');
    error.className = 'log-error console-row';
    error.dataset.testid = 'log-error';
    error.textContent = state.error;
    container.appendChild(error);
  }
}

export function handleInput(event, context = {}) {
  if (event.action !== 'confirm') return null;
  return copyByRun.get(context.runState || globalThis)?.() ?? null;
}
