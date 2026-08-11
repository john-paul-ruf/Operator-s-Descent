import { readText, parseClassSelectors } from './lib.js';
import { extractAllMocks } from './extract-mocks.js';

const PRODUCTION_CSS_FILES = ['styles/base.css', 'styles/components.css', 'styles/crt.css'];

function productionClassSet() {
  const classes = new Set();
  for (const file of PRODUCTION_CSS_FILES) {
    for (const cls of parseClassSelectors(readText(file))) classes.add(cls);
  }
  return classes;
}

export function checkMockClasses() {
  const produced = productionClassSet();
  const findings = [];
  for (const mock of extractAllMocks()) {
    for (const cls of mock.classes) {
      if (!produced.has(cls)) {
        findings.push({ level: 'warning', category: 'mock-class-parity', mockFile: mock.file, className: cls, message: `.${cls} appears in ${mock.file} but is not defined in styles/base.css, styles/components.css, or styles/crt.css` });
      }
    }
  }
  return findings;
}