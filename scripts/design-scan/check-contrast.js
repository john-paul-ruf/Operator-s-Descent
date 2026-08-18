#!/usr/bin/env node
// WCAG 2.1 contrast gate for Operator's Descent.
//
// Parses styles/*.css to enumerate every foreground/background pair that ends
// up on the CRT — token-to-token combos declared in :root, per-rule
// color/background/border-color decls, opacity-attenuated variants, and text
// over known colored fills. Computes WCAG 2.1 relative-luminance contrast and
// flags failures at 4.5:1 (normal text), 3:1 (large text ≥ 24 px or ≥ 18.66 px
// bold, and meaningful UI boundaries per WCAG 1.4.11).
//
// Backgrounds with alpha < 1 are resolved to opaque by compositing over the
// element's ancestor surface before the contrast math runs, so the ratios
// match what the rendered pixel actually shows. As a documented assumption,
// the persistent CRT overlay stack (scanlines at 10 % white over the vignette
// pulse at 65-92 % black) is folded in as a secondary "through-CRT" warning
// tier — pairs that pass raw but fail through the worst-case overlay surface
// as warnings, never demoted to failures on top of a passing raw ratio.
//
// Runs independently of the M97 design-scan pipeline so the accessibility-pass
// audit owns the gate outright. `--json` emits a machine-readable violation
// list; the process exits non-zero on any AA failure.

import { pathToFileURL } from 'node:url';
import { readText, listFiles, parseRootTokens } from './lib.js';

const STYLE_DIR = 'styles';

// ────────────────────────────────────────────────────────────────────────────
// WCAG contrast math
// ────────────────────────────────────────────────────────────────────────────
function channelLinear(byte) {
  const v = byte / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}
function alphaBlend(fg, bg) {
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1
  };
}
export function contrastRatio(fg, bg) {
  const flatBg = (bg.a ?? 1) < 1 ? alphaBlend(bg, { r: 0, g: 0, b: 0, a: 1 }) : bg;
  const flatFg = (fg.a ?? 1) < 1 ? alphaBlend(fg, flatBg) : fg;
  const l1 = relativeLuminance(flatFg);
  const l2 = relativeLuminance(flatBg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ────────────────────────────────────────────────────────────────────────────
// Color parsing (hex, rgb/rgba, var(--token))
// ────────────────────────────────────────────────────────────────────────────
export function parseColor(text, tokens = {}, seen = new Set()) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw || raw === 'transparent' || raw === 'currentColor' || raw === 'inherit' || raw === 'none') return null;
  const varMatch = raw.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\s*\)$/i);
  if (varMatch) {
    const name = varMatch[1];
    if (seen.has(name)) return null;
    seen.add(name);
    return parseColor(tokens[name] || varMatch[2] || '', tokens, seen);
  }
  if (raw.startsWith('#')) {
    const s = raw.slice(1);
    if (/^[0-9a-f]{3}$/i.test(s)) {
      return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16), a: 1 };
    }
    if (/^[0-9a-f]{6}$/i.test(s)) {
      return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: 1 };
    }
    if (/^[0-9a-f]{8}$/i.test(s)) {
      return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: parseInt(s.slice(6, 8), 16) / 255 };
    }
    return null;
  }
  const rgba = raw.match(/^rgba?\(\s*([^)]+)\s*\)$/i);
  if (rgba) {
    const parts = rgba[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] != null ? parts[3] : 1 };
  }
  return null;
}

// Extract the first color-value substring (hex/rgb/var) from a declaration.
function extractColorValue(text) {
  if (!text) return null;
  const match = text.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|var\(--[\w-]+(?:\s*,\s*[^)]+)?\)/i);
  return match ? match[0] : null;
}

// ────────────────────────────────────────────────────────────────────────────
// CSS parsing — top-level and single-nested (@media) rules
// ────────────────────────────────────────────────────────────────────────────
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseRules(css) {
  const source = stripComments(css);
  const rules = [];
  let i = 0;
  const walk = (startAt, contextSelector) => {
    let selectorStart = startAt;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '{') {
        const selector = source.slice(selectorStart, i).trim();
        i++;
        if (selector.startsWith('@media') || selector.startsWith('@supports')) {
          walk(i, selector);
        } else if (!selector.startsWith('@')) {
          const bodyStart = i;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth === 0) break;
            i++;
          }
          const body = source.slice(bodyStart, i);
          rules.push({
            selector,
            body,
            decls: parseDecls(body),
            context: contextSelector || null
          });
          i++;
        } else {
          // skip other @rules (@font-face etc.)
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            i++;
          }
        }
        selectorStart = i;
      } else if (ch === '}') {
        i++;
        return;
      } else {
        i++;
      }
    }
  };
  walk(0, null);
  return rules;
}

function parseDecls(body) {
  const decls = {};
  // Naive semicolon split — good enough for these stylesheets (no nested `;` in
  // rgba()/var() function commas). Later decls in a rule win the cascade.
  for (const raw of body.split(';')) {
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const prop = raw.slice(0, colon).trim().toLowerCase();
    const value = raw.slice(colon + 1).trim();
    if (!prop || !value) continue;
    decls[prop] = value;
  }
  return decls;
}

function extractFontSizePx(decl) {
  const m = decl?.match(/(\d+(?:\.\d+)?)px/);
  return m ? Number(m[1]) : null;
}

function extractOpacity(decl) {
  if (decl == null) return 1;
  const n = Number(decl);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

// ────────────────────────────────────────────────────────────────────────────
// Assumed CRT overlay attenuation (documented)
// ────────────────────────────────────────────────────────────────────────────
//   The persistent CRT stack draws over every screen: a 10 %-white scanline
//   grid (styles/crt.css .crt-scanlines) plus a vignette pulsing 65 % → 92 %
//   black at frame edges. Worst-case at the corner ≈ black overlay at ~72 %,
//   modelled as one opaque layer applied to the surface. This is a WARNING-
//   tier signal only — passing raw contrast is never demoted to fail because
//   of the overlay, but a raw-pass / CRT-fail pair is worth flagging so the
//   fix wave knows which pairs are borderline in the actual rendered frame.
const CRT_OVERLAY = { r: 30, g: 25, b: 40, a: 0.72 };

function crtOverlayBackground(background) {
  return alphaBlend(CRT_OVERLAY, background);
}

// ────────────────────────────────────────────────────────────────────────────
// Explicit pair set — canonical token combinations shipped in styles/*
// ────────────────────────────────────────────────────────────────────────────
const SURFACE_TOKENS = ['--bg-base', '--bg-panel', '--bg-panel-elevated'];
const TEXT_TOKENS = [
  '--text-primary',
  '--text-secondary',
  '--text-dim',
  '--accent',
  '--danger',
  '--warning',
  '--heal'
];
const BORDER_TOKENS = ['--border-dim', '--accent', '--danger', '--warning', '--heal'];

const LITERAL_FOREGROUNDS = [
  ['#e8d23a', 'gold literal (rarity Custom, marked/overloaded conds)'],
  ['#b026d4', 'purple literal (rarity Prototype)'],
  ['#2ed4c1', 'teal literal (rarity Tuned)'],
  ['#5a89a0', 'interactive-border baseline (--interactive-border)']
];

const TINT_FILLS = [
  {
    name: '.selected / .btn-primary — accent tint over bg-panel-elevated',
    tint: 'rgba(126,200,227,0.10)',
    container: '--bg-panel-elevated',
    foregrounds: [['--text-primary', 4.5], ['--accent', 4.5]]
  },
  {
    name: '.alert-banner — danger tint over bg-panel',
    tint: 'rgba(232,58,58,0.15)',
    container: '--bg-panel',
    foregrounds: [['--danger', 4.5]]
  },
  {
    name: '.r-corrupt — warning tint over bg-panel-elevated',
    tint: 'rgba(232,99,42,0.10)',
    container: '--bg-panel-elevated',
    foregrounds: [['--warning', 4.5]]
  },
  {
    name: '.corrupt-warning — warning tint over bg-panel',
    tint: 'rgba(232,99,42,0.10)',
    container: '--bg-panel',
    foregrounds: [['--warning', 4.5]]
  }
];

// Opacity classes worth an explicit audit line (see components.css / base.css)
const OPACITY_ATTENUATED = [
  { name: 'button:disabled — .btn-crt at opacity 0.45 on bg-panel-elevated', fg: '--text-primary', bg: '--bg-panel-elevated', opacity: 0.45 },
  { name: '.is-interactive[disabled] — text-primary at opacity 0.45 on bg-panel', fg: '--text-primary', bg: '--bg-panel', opacity: 0.45 },
  { name: '.mode-tab.disabled — text-primary at opacity 0.35 on bg-panel', fg: '--text-primary', bg: '--bg-panel', opacity: 0.35 },
  { name: '.stepper-btn:disabled — text-primary at opacity 0.3 on bg-panel', fg: '--text-primary', bg: '--bg-panel', opacity: 0.3 },
  { name: '.loot-container.empty — text-primary at opacity 0.5 on bg-panel', fg: '--text-primary', bg: '--bg-panel', opacity: 0.5 },
  { name: '.no-limit-hint — text-dim at opacity 0.6 on bg-panel', fg: '--text-dim', bg: '--bg-panel', opacity: 0.6 },
  { name: '.wide-editor .gear-row:disabled — text-primary at opacity 0.4 on bg-panel', fg: '--text-primary', bg: '--bg-panel', opacity: 0.4 }
];

// ────────────────────────────────────────────────────────────────────────────
// Threshold policy
// ────────────────────────────────────────────────────────────────────────────
function textThreshold({ fontSizePx, fontWeight }) {
  if (fontSizePx != null && fontSizePx >= 24) return 3;
  if (fontSizePx != null && fontSizePx >= 18.66 && Number(fontWeight) >= 700) return 3;
  return 4.5;
}

// ────────────────────────────────────────────────────────────────────────────
// Rule-level pair extraction
// ────────────────────────────────────────────────────────────────────────────
// Rough ancestor-surface heuristic: infers the OPAQUE surface behind an
// element from its selector root. Good enough for these stylesheets; every
// container that actually paints an opaque bg either lives in one of the
// three surface tokens or is caught by an explicit `background-color` on the
// same rule.
function ancestorSurfaceForSelector(selector) {
  const lower = selector.toLowerCase();
  if (
    lower.includes('#portrait-frame') ||
    lower.includes('.portrait-frame') ||
    lower.includes('.playfield') ||
    lower.includes('.lattice') ||
    lower.includes('.link-input') ||
    lower.includes('.share-input') ||
    lower.includes('.share-link') ||
    lower.includes('.share-panel') ||
    lower.includes('.log-link') ||
    lower.includes('.share-link-display')
  ) {
    return '--bg-base';
  }
  if (
    lower.includes('.panel-elevated') ||
    lower.includes('elevated') ||
    lower.includes('.calibration-card') ||
    lower.includes('.wide-active-actor') ||
    lower.includes('.wide-console-content-header') ||
    lower.includes('.wide-import-header') ||
    lower.includes('.wide-tutorial-header') ||
    lower.includes('.wide-settings-header') ||
    lower.includes('.wide-scorecard-header') ||
    lower.includes('.wide-library-header') ||
    lower.includes('.wide-readout') ||
    lower.includes('.tech-preview') ||
    lower.includes('.loot-container-header')
  ) {
    return '--bg-panel-elevated';
  }
  return '--bg-panel';
}

function resolveBackground(text, ancestorToken, tokens) {
  const colorText = extractColorValue(text);
  const raw = colorText ? parseColor(colorText, tokens) : null;
  if (!raw) return { color: parseColor(`var(${ancestorToken})`, tokens), source: `ambient ${ancestorToken}` };
  if ((raw.a ?? 1) >= 1) return { color: raw, source: colorText };
  const ancestor = parseColor(`var(${ancestorToken})`, tokens);
  if (!ancestor) return { color: raw, source: colorText };
  const composed = alphaBlend(raw, ancestor);
  return { color: composed, source: `${colorText} over ${ancestorToken}` };
}

function shouldSkipSelector(selector) {
  const lower = selector.toLowerCase();
  if (lower.includes('::placeholder')) return true;
  if (lower.startsWith('@font-face')) return true;
  if (lower.startsWith('@keyframes')) return true;
  return false;
}

function collectRulePairs(rules, tokens) {
  const pairs = [];
  for (const rule of rules) {
    if (shouldSkipSelector(rule.selector)) continue;
    const decls = rule.decls;
    const colorText = decls['color'];
    const bgText = decls['background-color'] || decls['background'];
    const borderColorText = decls['border-color'] || decls['border'];
    const opacity = extractOpacity(decls['opacity']);
    const fontSize = extractFontSizePx(decls['font-size']);
    const fontWeight = decls['font-weight'];

    const ancestor = ancestorSurfaceForSelector(rule.selector);
    const bg = resolveBackground(bgText, ancestor, tokens);
    if (!bg.color) continue;

    if (colorText) {
      const fg = parseColor(extractColorValue(colorText) || colorText, tokens);
      if (fg) {
        const dimmed = opacity < 1 ? { ...fg, a: (fg.a ?? 1) * opacity } : fg;
        pairs.push({
          kind: 'text',
          fg: dimmed,
          bg: bg.color,
          fontSizePx: fontSize,
          fontWeight,
          selector: rule.selector,
          file: rule.file,
          label: `${rule.selector} color=${colorText.trim()} on ${bg.source}${opacity < 1 ? ` @ opacity ${opacity}` : ''}`
        });
      }
    }
    if (borderColorText) {
      const raw = parseColor(extractColorValue(borderColorText) || '', tokens);
      if (raw) {
        const dimmed = opacity < 1 ? { ...raw, a: (raw.a ?? 1) * opacity } : raw;
        pairs.push({
          kind: 'border',
          fg: dimmed,
          bg: bg.color,
          selector: rule.selector,
          file: rule.file,
          label: `${rule.selector} border=${borderColorText.trim()} on ${bg.source}${opacity < 1 ? ` @ opacity ${opacity}` : ''}`
        });
      }
    }
  }
  return pairs;
}

// ────────────────────────────────────────────────────────────────────────────
// Full contrast check
// ────────────────────────────────────────────────────────────────────────────
export function runContrastCheck() {
  const tokens = parseRootTokens(readText(`${STYLE_DIR}/base.css`));
  const cssBundle = listFiles(STYLE_DIR, '.css')
    .map((name) => ({ name, text: readText(`${STYLE_DIR}/${name}`) }));
  const rules = cssBundle.flatMap(({ name, text }) =>
    parseRules(text).map((rule) => ({ ...rule, file: `${STYLE_DIR}/${name}` }))
  );

  const findings = [];
  const seen = new Set();

  function record(finding) {
    const key = `${finding.category}|${finding.selector}|${finding.threshold}|${finding.ratio}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  }

  function evaluatePair(pair, threshold, sourceLabel) {
    if (!pair.fg || !pair.bg) return;
    const raw = contrastRatio(pair.fg, pair.bg);
    const throughCrt = contrastRatio(pair.fg, crtOverlayBackground(pair.bg));
    const rawRounded = Number(raw.toFixed(2));
    const crtRounded = Number(throughCrt.toFixed(2));
    const category = pair.kind === 'border' ? 'ui-boundary' : 'text-contrast';
    if (raw < threshold) {
      record({
        level: 'error',
        category,
        message: `${sourceLabel}: ${rawRounded}:1 (needs ${threshold}:1; ${crtRounded}:1 through CRT overlay)`,
        ratio: rawRounded,
        throughCrt: crtRounded,
        threshold,
        selector: pair.selector,
        file: pair.file,
        wcag: pair.kind === 'border' ? '1.4.11' : '1.4.3'
      });
      return;
    }
    if (throughCrt < threshold) {
      record({
        level: 'warning',
        category,
        message: `${sourceLabel}: ${rawRounded}:1 raw passes, but ${crtRounded}:1 through CRT overlay falls below ${threshold}:1`,
        ratio: rawRounded,
        throughCrt: crtRounded,
        threshold,
        selector: pair.selector,
        file: pair.file,
        wcag: pair.kind === 'border' ? '1.4.11' : '1.4.3'
      });
    }
  }

  // 1. Token × surface matrix — the design system's promise.
  for (const surface of SURFACE_TOKENS) {
    const bg = parseColor(`var(${surface})`, tokens);
    for (const text of TEXT_TOKENS) {
      const fg = parseColor(`var(${text})`, tokens);
      evaluatePair(
        { fg, bg, kind: 'text', selector: `${text} on ${surface}` },
        4.5,
        `token pair ${text} on ${surface}`
      );
    }
    for (const border of BORDER_TOKENS) {
      const fg = parseColor(`var(${border})`, tokens);
      evaluatePair(
        { fg, bg, kind: 'border', selector: `${border} border on ${surface}` },
        3,
        `border pair ${border} on ${surface}`
      );
    }
  }

  // 2. Literal (non-token) foregrounds.
  for (const [literal, description] of LITERAL_FOREGROUNDS) {
    for (const surface of SURFACE_TOKENS) {
      const bg = parseColor(`var(${surface})`, tokens);
      const fg = parseColor(literal, tokens);
      evaluatePair(
        { fg, bg, kind: 'text', selector: `${literal} on ${surface}` },
        4.5,
        `literal ${literal} (${description}) on ${surface}`
      );
    }
  }

  // 3. Text-on-tint (tint composited over its container first).
  for (const fill of TINT_FILLS) {
    const container = parseColor(`var(${fill.container})`, tokens);
    const tint = parseColor(fill.tint, tokens);
    if (!container || !tint) continue;
    const composed = alphaBlend(tint, container);
    for (const [textToken, threshold] of fill.foregrounds) {
      const fg = parseColor(`var(${textToken})`, tokens);
      evaluatePair(
        { fg, bg: composed, kind: 'text', selector: fill.name },
        threshold,
        `${textToken} on ${fill.name}`
      );
    }
  }

  // 4. Opacity-attenuated classes (opacity multiplies onto text alpha).
  for (const entry of OPACITY_ATTENUATED) {
    const bg = parseColor(`var(${entry.bg})`, tokens);
    const fg = parseColor(`var(${entry.fg})`, tokens);
    if (!bg || !fg) continue;
    const dimmed = entry.opacity < 1 ? { ...fg, a: (fg.a ?? 1) * entry.opacity } : fg;
    evaluatePair(
      { fg: dimmed, bg, kind: 'text', selector: entry.name },
      4.5,
      entry.name
    );
  }

  // 5. Per-rule sweep — everything the styles actually declare.
  for (const pair of collectRulePairs(rules, tokens)) {
    const threshold = pair.kind === 'border' ? 3 : textThreshold({ fontSizePx: pair.fontSizePx, fontWeight: pair.fontWeight });
    evaluatePair(pair, threshold, pair.label);
  }

  return findings;
}

// ────────────────────────────────────────────────────────────────────────────
// CLI entry
// ────────────────────────────────────────────────────────────────────────────
function summarize(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.level] = (counts[f.level] || 0) + 1;
  return { total: findings.length, ...counts, passed: counts.error === 0 };
}

function renderHuman(findings) {
  const lines = ["WCAG Contrast Scan — Operator's Descent", '='.repeat(44)];
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.category)) groups.set(f.category, []);
    groups.get(f.category).push(f);
  }
  const levelRank = { error: 0, warning: 1, info: 2 };
  for (const [category, entries] of groups) {
    const sorted = [...entries].sort((a, b) =>
      levelRank[a.level] - levelRank[b.level] ||
      a.selector.localeCompare(b.selector)
    );
    lines.push('', `${category} (${sorted.length})`);
    for (const entry of sorted) {
      lines.push(`  [${entry.level.toUpperCase()}] (${entry.wcag}) ${entry.message}`);
    }
  }
  const s = summarize(findings);
  lines.push(
    '',
    '-'.repeat(44),
    `${s.total} finding(s) — ${s.error} error(s), ${s.warning} warning(s), ${s.info} info`,
    s.passed ? 'PASS — no WCAG 2.1 AA contrast failures detected' : 'FAIL — resolve error-level findings above'
  );
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = runContrastCheck();
  const summary = summarize(findings);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ findings, summary }, null, 2));
  } else {
    console.log(renderHuman(findings));
  }
  process.exitCode = summary.passed ? 0 : 1;
}
