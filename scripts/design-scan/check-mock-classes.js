import { readText, parseClassSelectors } from './lib.js';
import { extractAllMocksAcrossLayouts } from './extract-mocks.js';

const PRODUCTION_CSS_FILES = ['styles/base.css', 'styles/components.css', 'styles/crt.css', 'styles/wide.css', 'styles/icons.css'];
const MOCK_GENERATED_MARKERS = new Set(['deploy-p', 'deploy-e']);

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
  for (const mock of extractAllMocksAcrossLayouts()) {
    const isWide = mock.layout === 'wide';
    const mockPath = isWide ? `mocks/wide/${mock.file}` : mock.file;
    const layoutPrefix = isWide ? '[wide] ' : '';
    for (const cls of mock.classes) {
      if (produced.has(cls)) continue;
      const level = MOCK_GENERATED_MARKERS.has(cls) ? 'warning' : 'error';
      findings.push({ level, category: 'mock-class-parity', layout: mock.layout, mockFile: mock.file, className: cls, message: `${layoutPrefix}.${cls} appears in ${mockPath} but is not defined in styles/base.css, styles/components.css, styles/crt.css, styles/wide.css, or styles/icons.css` });
    }
  }
  return findings;
}
