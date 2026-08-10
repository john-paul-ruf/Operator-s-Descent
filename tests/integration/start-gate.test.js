import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

describe('cold START boundary', () => {
  it('keeps the cold entry dependency-free and loads only the hot runtime dynamically', async () => {
    const source = await readSource('../../src/main.js');

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source.match(/import\(/g)).toHaveLength(1);
    expect(source).toContain("import('./runtime.js')");
    expect(source).not.toMatch(/data\//);
    expect(source).not.toMatch(/service-worker/);
    expect(source).not.toMatch(/createRNG|Math\.random|createGlitch|createGrain/);
  });

  it('keeps service-worker, deferred data loading, and visual services inside the hot runtime', async () => {
    const [source, loader] = await Promise.all([
      readSource('../../src/runtime.js'),
      readSource('../../src/data-loader.js')
    ]);

    expect(source).toContain("navigator.serviceWorker.register('./service-worker.js')");
    expect(source).toContain('loadGameData');
    expect(loader).toContain('DATA_FILES');
    expect(source).toContain('createGlitchSystem');
    expect(source).toContain('createGrain');
    expect(source).toContain('createRNGCursorForRun');
  });

  it('does not preload the sigil font or hot modules in the document shell', async () => {
    const source = await readSource('../../index.html');

    expect(source).not.toMatch(/rel=["'](?:modulepreload|preload)["']/);
    expect(source).toContain('@font-face');
    expect(source).toContain('data-cold-shell');
  });
});
