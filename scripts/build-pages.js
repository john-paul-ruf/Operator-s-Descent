// Stages the exact literal PRODUCTION_ASSETS manifest from ./service-worker.js
// into a static output directory — the GitHub Pages deployment artifact.
// This is Node-only release tooling: it never bundles, transpiles, minifies,
// rewrites source URLs, regenerates CSS/SVG, or imports a runtime package.
// The service worker is parsed as text, never executed under Node.

import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_OUTPUT_DIRNAME = 'dist';

function extractManifest(rootDir) {
  const source = readFileSync(join(rootDir, 'service-worker.js'), 'utf8');
  const match = source.match(/const\s+PRODUCTION_ASSETS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error('service-worker.js: missing PRODUCTION_ASSETS manifest');
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

// Assets deployed to the Pages artifact but intentionally not precached by the
// service worker (e.g. social share cards). Optional — absent in older shells.
function extractDeployOnly(rootDir) {
  const source = readFileSync(join(rootDir, 'service-worker.js'), 'utf8');
  const match = source.match(/const\s+DEPLOY_ONLY_ASSETS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function validateManifest(assets, rootDir) {
  if (assets.length === 0) throw new Error('PRODUCTION_ASSETS manifest is empty');
  const seen = new Set();
  for (const asset of assets) {
    if (!asset.startsWith('./')) throw new Error(`${asset}: manifest paths must start with ./`);
    const relPath = asset.slice(2);
    if (isAbsolute(relPath)) throw new Error(`${asset}: absolute paths are forbidden`);
    if (relPath.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
      throw new Error(`${asset}: parent traversal is forbidden`);
    }
    if (seen.has(asset)) throw new Error(`${asset}: duplicate manifest entry`);
    seen.add(asset);

    const fullPath = join(rootDir, relPath);
    let stats;
    try {
      stats = lstatSync(fullPath);
    } catch {
      throw new Error(`${asset}: manifest entry does not exist`);
    }
    if (stats.isSymbolicLink()) throw new Error(`${asset}: symbolic links are forbidden`);
    if (!stats.isFile()) throw new Error(`${asset}: manifest entry is not a regular file`);
  }
}

function resolveOutputDir(outputDir, rootDir, assets) {
  const resolved = resolve(outputDir ?? join(rootDir, DEFAULT_OUTPUT_DIRNAME));
  if (resolved === rootDir) throw new Error(`output directory must not be the repository root: ${resolved}`);
  if (rootDir === resolved || rootDir.startsWith(resolved + sep)) {
    throw new Error(`output directory must not be an ancestor of the repository root: ${resolved}`);
  }

  const relToRoot = relative(rootDir, resolved);
  const isInsideRoot = relToRoot !== '' && !relToRoot.startsWith('..') && !isAbsolute(relToRoot);
  if (isInsideRoot) {
    const topLevelSourcePaths = new Set(assets.map((asset) => asset.slice(2).split('/')[0]));
    const firstSegment = relToRoot.split(sep)[0];
    if (topLevelSourcePaths.has(firstSegment)) {
      throw new Error(`output directory overlaps a production source path: ${resolved}`);
    }
  }

  return resolved;
}

export async function buildPages({ rootDir = PROJECT_ROOT, outputDir } = {}) {
  const resolvedRoot = resolve(rootDir);
  const precacheAssets = extractManifest(resolvedRoot);
  const deployOnlyAssets = extractDeployOnly(resolvedRoot);
  const assets = [...precacheAssets, ...deployOnlyAssets];
  validateManifest(assets, resolvedRoot);
  const resolvedOutput = resolveOutputDir(outputDir, resolvedRoot, assets);

  const outputParent = dirname(resolvedOutput);
  mkdirSync(outputParent, { recursive: true });
  const stagingDir = mkdtempSync(join(outputParent, '.build-pages-'));

  try {
    for (const asset of assets) {
      const relPath = asset.slice(2);
      const destPath = join(stagingDir, relPath);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(join(resolvedRoot, relPath), destPath);
    }
    rmSync(resolvedOutput, { recursive: true, force: true });
    renameSync(stagingDir, resolvedOutput);
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  return { outputDir: resolvedOutput, assetCount: assets.length, precacheCount: precacheAssets.length, deployOnlyCount: deployOnlyAssets.length, assets };
}

export function parseBuildPagesArgs(argv) {
  const args = { output: undefined };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--output') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--output requires a directory argument');
      args.output = value;
      index++;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

async function runCli(argv) {
  const args = parseBuildPagesArgs(argv);
  const result = await buildPages({ outputDir: args.output ? resolve(args.output) : undefined });
  console.log(`Staged ${result.assetCount} assets (${result.precacheCount} precache + ${result.deployOnlyCount} deploy-only) to ${result.outputDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
