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

function collectLogs(context = {}) {
  return [...(context.runState?.recentEvents || []), ...(context.logEntries || [])]
    .map((entry, index) => ({ ...entry, _index: index }))
    .sort((left, right) => (left.sequence ?? left.turn ?? left.eventIndex ?? left._index) - (right.sequence ?? right.turn ?? right.eventIndex ?? right._index))
    .slice(-64);
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
  const copyBtn = createButton('◈ COPY LINK', {
    primary: true,
    disabled: !livingRun(context.runState) || context.runWiped,
    description: !livingRun(context.runState) || context.runWiped ? 'Full-state link unavailable after wipe.' : '',
    onClick: () => copyLink(container, context),
    icon: 'link', iconSize: 14
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
