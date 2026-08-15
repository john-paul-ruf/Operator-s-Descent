import { readText, parseClassSelectors } from './lib.js';
import { extractAllMocksAcrossLayouts } from './extract-mocks.js';

const PRODUCTION_CSS_FILES = ['styles/base.css', 'styles/components.css', 'styles/crt.css'];
const WIDE_ONLY_PREFIX = 'wide-';

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
    for (const cls of mock.classes) {
      if (isWide && cls.startsWith(WIDE_ONLY_PREFIX)) continue;
      if (produced.has(cls)) continue;
      const label = isWide ? '[wide — unimplemented] ' : '';
      const mockPath = isWide ? `mocks/wide/${mock.file}` : mock.file;
      findings.push({ level: 'warning', category: 'mock-class-parity', layout: mock.layout, mockFile: mock.file, className: cls, message: `${label}.${cls} appears in ${mockPath} but is not defined in styles/base.css, styles/components.css, or styles/crt.css` });
    }
  }
  return findings;
}
