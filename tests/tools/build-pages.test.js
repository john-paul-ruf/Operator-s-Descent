import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { buildPages, parseBuildPagesArgs } from '../../scripts/build-pages.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(here, '..', '..');
const CLI_PATH = join(PROJECT_ROOT, 'scripts', 'build-pages.js');

function extractManifest() {
  const source = readFileSync(join(PROJECT_ROOT, 'service-worker.js'), 'utf8');
  const match = source.match(/const\s+PRODUCTION_ASSETS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function extractDeployOnly() {
  const source = readFileSync(join(PROJECT_ROOT, 'service-worker.js'), 'utf8');
  const match = source.match(/const\s+DEPLOY_ONLY_ASSETS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function listFiles(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listFiles(join(dir, entry.name), relPath);
    return [relPath];
  }).sort();
}

const tempDirs = [];
function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('buildPages — artifact exactness', () => {
  test('stages exactly the PRODUCTION_ASSETS + DEPLOY_ONLY_ASSETS manifests, byte-identical, into a temp output dir', async () => {
    const manifest = extractManifest();
    const deployOnly = extractDeployOnly();
    const expected = [...manifest, ...deployOnly].map((asset) => asset.slice(2)).sort();
    const outputDir = join(makeTempDir('bp-out-'), 'artifact');

    const result = await buildPages({ outputDir });

    expect(result.assetCount).toBe(manifest.length + deployOnly.length);
    expect(result.precacheCount).toBe(manifest.length);
    expect(result.deployOnlyCount).toBe(deployOnly.length);
    expect(listFiles(outputDir)).toEqual(expected);

    for (const relPath of ['index.html', 'service-worker.js', 'assets/descent-sigil.woff2', 'assets/icons.svg', ...deployOnly.map((asset) => asset.slice(2))]) {
      const source = readFileSync(join(PROJECT_ROOT, relPath));
      const staged = readFileSync(join(outputDir, relPath));
      expect(staged.equals(source)).toBe(true);
    }

    for (const forbidden of ['package.json', 'package-lock.json', 'README.MD', 'node_modules', 'tests', 'tools', 'mocks', 'docs', 'program']) {
      expect(existsSync(join(outputDir, forbidden))).toBe(false);
    }
  });

  test('replaces prior output content instead of merging — no stale file survives', async () => {
    const outputDir = join(makeTempDir('bp-out-'), 'artifact');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'stale.txt'), 'leftover from a previous build');

    await buildPages({ outputDir });

    expect(existsSync(join(outputDir, 'stale.txt'))).toBe(false);
  });

  test('ships byte-identical PWA metadata/icons and every browser asset changed by this feature', async () => {
    const outputDir = join(makeTempDir('bp-out-'), 'artifact');

    await buildPages({ outputDir });

    for (const relPath of [
      'manifest.webmanifest',
      'assets/app-icon.svg',
      'assets/app-icon-180.png',
      'assets/app-icon-192.png',
      'assets/app-icon-512.png',
      'src/runtime.js',
      'src/state/library.js',
      'src/ui/components.js',
      'src/ui/input.js',
      'src/ui/screens/scorecard.js',
      'src/ui/screens/settings.js',
      'src/ui/screens/combat.js',
      'styles/base.css',
      'styles/components.css',
      'styles/wide.css'
    ]) {
      const source = readFileSync(join(PROJECT_ROOT, relPath));
      const staged = readFileSync(join(outputDir, relPath));
      expect(staged.equals(source)).toBe(true);
    }
  });

  test('leaves source inputs unchanged and does not invoke build:assets', async () => {
    const before = readFileSync(join(PROJECT_ROOT, 'service-worker.js'));
    const outputDir = join(makeTempDir('bp-out-'), 'artifact');

    await buildPages({ outputDir });

    expect(readFileSync(join(PROJECT_ROOT, 'service-worker.js')).equals(before)).toBe(true);
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['build:pages']).not.toMatch(/build:assets/);
  });
});

describe('buildPages — unsafe output targets fail before touching anything', () => {
  test('rejects the repository root', async () => {
    await expect(buildPages({ outputDir: PROJECT_ROOT })).rejects.toThrow(/repository root/);
  });

  test('rejects an ancestor of the repository root', async () => {
    await expect(buildPages({ outputDir: dirname(PROJECT_ROOT) })).rejects.toThrow(/ancestor/);
  });

  test('rejects a path overlapping a production source directory', async () => {
    await expect(buildPages({ outputDir: join(PROJECT_ROOT, 'src') })).rejects.toThrow(/overlap/);
    expect(existsSync(join(PROJECT_ROOT, 'src', 'main.js'))).toBe(true);
  });

  test('rejects a path overlapping a production source file', async () => {
    await expect(buildPages({ outputDir: join(PROJECT_ROOT, 'index.html') })).rejects.toThrow(/overlap/);
    expect(existsSync(join(PROJECT_ROOT, 'index.html'))).toBe(true);
  });
});

describe('buildPages — malformed manifest fails before the source tree changes', () => {
  function writeFixture(assetsSource) {
    const rootDir = makeTempDir('bp-fixture-');
    writeFileSync(join(rootDir, 'index.html'), '<html></html>');
    writeFileSync(join(rootDir, 'service-worker.js'), `const PRODUCTION_ASSETS = Object.freeze([${assetsSource}]);\n`);
    return rootDir;
  }

  test('rejects a manifest entry that does not exist, and creates no output', async () => {
    const rootDir = writeFixture("'./index.html', './missing.js'");
    const outputDir = join(rootDir, 'out');

    await expect(buildPages({ rootDir, outputDir })).rejects.toThrow(/does not exist/);

    expect(existsSync(outputDir)).toBe(false);
    expect(readFileSync(join(rootDir, 'index.html'), 'utf8')).toBe('<html></html>');
  });

  test('rejects parent traversal in a manifest entry', async () => {
    const rootDir = writeFixture("'./index.html', './../evil.js'");
    const outputDir = join(rootDir, 'out');

    await expect(buildPages({ rootDir, outputDir })).rejects.toThrow(/traversal/);
    expect(existsSync(outputDir)).toBe(false);
  });

  test('rejects a duplicate manifest entry', async () => {
    const rootDir = writeFixture("'./index.html', './index.html'");
    const outputDir = join(rootDir, 'out');

    await expect(buildPages({ rootDir, outputDir })).rejects.toThrow(/duplicate/);
    expect(existsSync(outputDir)).toBe(false);
  });

  test('rejects an empty manifest', async () => {
    const rootDir = writeFixture('');
    const outputDir = join(rootDir, 'out');

    await expect(buildPages({ rootDir, outputDir })).rejects.toThrow(/empty/);
    expect(existsSync(outputDir)).toBe(false);
  });

  test('rejects a manifest path that does not start with ./', async () => {
    const rootDir = writeFixture("'index.html'");
    const outputDir = join(rootDir, 'out');

    await expect(buildPages({ rootDir, outputDir })).rejects.toThrow(/must start with/);
    expect(existsSync(outputDir)).toBe(false);
  });
});

describe('parseBuildPagesArgs', () => {
  test('accepts --output <directory>', () => {
    expect(parseBuildPagesArgs(['--output', '/tmp/somewhere'])).toEqual({ output: '/tmp/somewhere' });
  });

  test('defaults output to undefined with no arguments', () => {
    expect(parseBuildPagesArgs([])).toEqual({ output: undefined });
  });

  test('rejects a missing --output value', () => {
    expect(() => parseBuildPagesArgs(['--output'])).toThrow(/requires a directory argument/);
  });

  test('rejects an unknown argument', () => {
    expect(() => parseBuildPagesArgs(['--bogus'])).toThrow(/unknown argument/);
  });
});

describe('build-pages CLI', () => {
  test('stages a manifest-only artifact into a temporary --output path', () => {
    const outputDir = join(makeTempDir('bp-cli-'), 'artifact');
    const stdout = execFileSync(process.execPath, [CLI_PATH, '--output', outputDir], { cwd: PROJECT_ROOT, encoding: 'utf8' });

    expect(stdout).toMatch(/Staged \d+ assets \(\d+ precache \+ \d+ deploy-only\)/);
    expect(existsSync(join(outputDir, 'index.html'))).toBe(true);
  });

  test('exits non-zero and stages nothing for an unsafe output target', () => {
    expect(() => execFileSync(process.execPath, [CLI_PATH, '--output', PROJECT_ROOT], { cwd: PROJECT_ROOT, stdio: 'pipe' }))
      .toThrow();
  });

  test('exits non-zero for an unknown CLI argument', () => {
    expect(() => execFileSync(process.execPath, [CLI_PATH, '--bogus'], { cwd: PROJECT_ROOT, stdio: 'pipe' }))
      .toThrow();
  });
});
