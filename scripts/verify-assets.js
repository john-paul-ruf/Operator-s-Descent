import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TRANSFER_BUDGET_BYTES = 500 * 1024;
const FORBIDDEN_PREFIXES = ['./program/', './specs/', './mocks/', './tests/', './tools/', './font-src/', './node_modules/', './docs/'];
const FORBIDDEN_BASENAMES = new Set(['./package.json', './package-lock.json', './project.json', './pipeline-state.json']);
const REQUIRED_SINGLETONS = ['./index.html', './service-worker.js', './assets/descent-sigil.woff2', './assets/icons.svg'];
const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.svg']);

function workspacePath(asset) {
  return join(ROOT, asset.replace(/^\.\//, ''));
}

function toAssetPath(file) {
  return `./${relative(ROOT, file).split(sep).join('/')}`;
}

function listFiles(dir, extension) {
  const base = join(ROOT, dir);
  const entries = readdirSync(base, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const file = join(base, entry.name);
    if (entry.isDirectory()) return listFiles(posix.join(dir, entry.name), extension);
    return entry.name.endsWith(extension) ? [toAssetPath(file)] : [];
  }).sort();
}

function extractManifest() {
  const source = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
  const match = source.match(/const\s+PRODUCTION_ASSETS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error('service-worker.js: missing PRODUCTION_ASSETS manifest');
  const assets = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
  return { source, assets };
}

function expectedAssets() {
  return [
    ...REQUIRED_SINGLETONS,
    ...listFiles('styles', '.css'),
    ...listFiles('src', '.js'),
    ...listFiles('data', '.json')
  ].sort();
}

function validateManifestShape(assets, expected, errors) {
  const seen = new Set();
  for (const asset of assets) {
    if (!asset.startsWith('./')) errors.push(`${asset}: manifest paths must start with ./`);
    if (asset.includes('..')) errors.push(`${asset}: parent traversal is forbidden`);
    if (seen.has(asset)) errors.push(`${asset}: duplicate manifest entry`);
    seen.add(asset);
    if (FORBIDDEN_BASENAMES.has(asset) || FORBIDDEN_PREFIXES.some((prefix) => asset.startsWith(prefix))) {
      errors.push(`${asset}: forbidden non-production asset in manifest`);
    }
    if (/\.map$|\.md$|\.py$|\.lock$/.test(asset)) errors.push(`${asset}: generated/dev/documentation asset is forbidden`);
  }

  const manifestSet = new Set(assets);
  for (const asset of expected) if (!manifestSet.has(asset)) errors.push(`${asset}: missing from service-worker manifest`);
  for (const asset of assets) if (!expected.includes(asset)) errors.push(`${asset}: unexpected service-worker manifest entry`);
}

function validateReferences(assets, errors) {
  for (const asset of assets) {
    try {
      statSync(workspacePath(asset));
    } catch {
      errors.push(`${asset}: manifest entry does not exist`);
    }
  }

  const index = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const href of [...index.matchAll(/<link[^>]+href="([^"]+)"/g)].map((entry) => `./${entry[1]}`)) {
    if (!assets.includes(href)) errors.push(`${href}: stylesheet reference missing from manifest`);
  }
  for (const src of [...index.matchAll(/<script[^>]+src="([^"]+)"/g)].map((entry) => `./${entry[1]}`)) {
    if (!assets.includes(src)) errors.push(`${src}: script reference missing from manifest`);
  }

  for (const cssAsset of assets.filter((asset) => asset.startsWith('./styles/') && asset.endsWith('.css'))) {
    const css = readFileSync(workspacePath(cssAsset), 'utf8');
    for (const match of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
      const url = match[1];
      if (/^(data:|https?:)/.test(url)) errors.push(`${cssAsset}: external or inline URL ${url} is forbidden`);
      const resolved = `./${posix.normalize(posix.join(posix.dirname(cssAsset.slice(2)), url))}`;
      if (!assets.includes(resolved)) errors.push(`${resolved}: CSS asset reference missing from manifest`);
    }
  }
}

function validateImportGraph(assets, errors) {
  const sourceAssets = assets.filter((asset) => asset.startsWith('./src/') && asset.endsWith('.js'));
  const sourceSet = new Set(sourceAssets);
  for (const asset of sourceAssets) {
    const source = readFileSync(workspacePath(asset), 'utf8');
    const importPattern = /(?:import|export)\s+(?:[^'"()]*?\s+from\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] || match[2];
      if (!specifier.startsWith('.')) errors.push(`${asset}: bare runtime import ${specifier} is forbidden`);
      const resolved = `./${posix.normalize(posix.join(posix.dirname(asset.slice(2)), specifier.endsWith('.js') ? specifier : `${specifier}.js`))}`;
      if (!sourceSet.has(resolved)) errors.push(`${asset}: import ${specifier} resolves to unlisted ${resolved}`);
    }
  }

  const runtime = readFileSync(join(ROOT, 'src/runtime.js'), 'utf8');
  if (!runtime.includes("import(`./ui/screens/${name}.js`)")) errors.push('./src/runtime.js: expected dynamic screen route import not found');
  for (const screen of listFiles('src/ui/screens', '.js')) if (!sourceSet.has(screen)) errors.push(`${screen}: dynamic screen import missing from manifest`);
}

function measure(assets) {
  return assets.reduce((totals, asset) => {
    const bytes = readFileSync(workspacePath(asset));
    totals.raw += bytes.length;
    const extension = asset.slice(asset.lastIndexOf('.'));
    if (TEXT_EXTENSIONS.has(extension)) {
      totals.gzip += gzipSync(bytes, { level: 9 }).length;
      totals.brotli += brotliCompressSync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    } else {
      totals.gzip += bytes.length;
      totals.brotli += bytes.length;
    }
    return totals;
  }, { raw: 0, gzip: 0, brotli: 0 });
}

function main() {
  const { source, assets } = extractManifest();
  const expected = expectedAssets();
  const errors = [];
  validateManifestShape(assets, expected, errors);
  validateReferences(assets, errors);
  validateImportGraph(assets, errors);
  if (!source.includes('key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME')) errors.push('service-worker.js: activation must delete only older Operator cache names');
  if (/navigator\.serviceWorker\.register/.test(source)) errors.push('service-worker.js: service worker script must not register itself');
  if (/importScripts\s*\(/.test(source)) errors.push('service-worker.js: external script imports are forbidden');

  const totals = measure(assets);
  if (totals.gzip > TRANSFER_BUDGET_BYTES && totals.brotli > TRANSFER_BUDGET_BYTES) {
    errors.push(`transfer budget exceeded: gzip=${totals.gzip}, brotli=${totals.brotli}, budget=${TRANSFER_BUDGET_BYTES}`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  console.log(`manifest assets: ${assets.length}`);
  console.log(`raw bytes: ${totals.raw}`);
  console.log(`gzip transfer bytes: ${totals.gzip}`);
  console.log(`brotli transfer bytes: ${totals.brotli}`);
  console.log(`transfer budget: ${TRANSFER_BUDGET_BYTES}`);
}

main();
