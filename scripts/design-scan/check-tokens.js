import { readText, parseRootTokens } from './lib.js';
import { extractColorTokens, extractCornerRadius } from './extract-design-spec.js';

const DERIVED_SURFACE_TOKENS = new Set([
  '--screen-body-fade',
  '--scrollbar-track',
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
  '--scrollbar-width'
]);

export function checkColorTokens() {
  const specTokens = extractColorTokens();
  const srcTokens = parseRootTokens(readText('styles/base.css'));
  const findings = [];
  for (const { token, value } of specTokens) {
    const actual = srcTokens[token];
    if (actual === undefined) {
      findings.push({ level: 'error', category: 'color-token', token, message: `${token} missing from styles/base.css :root` });
    } else if (actual.toLowerCase() !== value.toLowerCase()) {
      findings.push({ level: 'error', category: 'color-token', token, message: `${token}: spec has ${value}, styles/base.css has ${actual}` });
    }
  }
  const specTokenNames = new Set(specTokens.map((t) => t.token));
  for (const token of Object.keys(srcTokens)) {
    if (specTokenNames.has(token)) continue;
    if (DERIVED_SURFACE_TOKENS.has(token)) continue;
    findings.push({ level: 'warning', category: 'color-token', token, message: `${token} declared in styles/base.css but absent from specs/design.md color palette table` });
  }
  return findings;
}

const RADIUS_UTILITY_CLASSES = {
  'Buttons': '.radius-btn',
  'Small controls (sliders, toggles)': '.radius-control'
};

export function checkCornerRadius() {
  const rules = extractCornerRadius();
  const css = readText('styles/base.css');
  const findings = [];
  for (const rule of rules) {
    const selector = RADIUS_UTILITY_CLASSES[rule.target];
    if (!selector) {
      findings.push({ level: 'info', category: 'corner-radius', target: rule.target, message: `no tracked utility class for "${rule.target}" (spec: ${rule.px}px) — verify visually` });
      continue;
    }
    const escaped = selector.replace('.', '\\.');
    const pattern = new RegExp(`${escaped}\\s*\\{[^}]*border-radius:\\s*${rule.px}px`);
    if (!pattern.test(css)) {
      findings.push({ level: 'error', category: 'corner-radius', target: rule.target, message: `${selector} in styles/base.css does not declare border-radius: ${rule.px}px` });
    }
  }
  return findings;
}