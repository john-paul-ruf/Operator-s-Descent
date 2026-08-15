import { extractColorTokens } from './extract-design-spec.js';
import { extractAllMocksAcrossLayouts } from './extract-mocks.js';

export function checkMockTokens() {
  const canonical = new Map(extractColorTokens().map(({ token, value }) => [token, value]));
  const findings = [];
  for (const mock of extractAllMocksAcrossLayouts()) {
    const mockPath = mock.layout === 'wide' ? `mocks/wide/${mock.file}` : mock.file;
    for (const [token, canonicalValue] of canonical) {
      const mockValue = mock.rootTokens[token];
      if (mockValue === undefined) continue;
      if (mockValue.toLowerCase() !== canonicalValue.toLowerCase()) {
        findings.push({ level: 'error', category: 'mock-token-parity', layout: mock.layout, mockFile: mock.file, token, message: `${mockPath} :root declares ${token}: ${mockValue}, canonical value is ${canonicalValue}` });
      }
    }
  }
  return findings;
}
