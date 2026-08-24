import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { generateFloor } from '../src/floor/generator.js';
import { validateFloor } from '../src/floor/validator.js';
import { createLattice } from '../src/exploration/lattice.js';
import { computeLOS } from '../src/exploration/shadowcast.js';
import { executeAction, resolveTurn } from '../src/rules/combat.js';
import { decodeRun } from '../src/state/save-decode.js';
import { melodyBar, progressionFor, SCALES } from '../src/audio/conductor.js';
import { createGameHarness, loadGameDataFixture, roundTripRunState, startStandardCombat } from '../tests/helpers/game-fixture.js';
import { runSaveStress } from './stress-saves.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TRANSFER_BUDGET_BYTES = 500 * 1024;
const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.svg', '.webmanifest']);
const FORBIDDEN_PREFIXES = ['./program/', './specs/', './mocks/', './tests/', './tools/', './font-src/', './node_modules/', './docs/'];
const REQUIRED_SINGLETONS = [
  './index.html',
  './service-worker.js',
  './manifest.webmanifest',
  './assets/descent-sigil.woff2',
  './assets/icons.svg',
  './assets/app-icon.svg',
  './assets/app-icon-180.png',
  './assets/app-icon-192.png',
  './assets/app-icon-512.png'
];

function workspacePath(asset) {
  return join(ROOT, asset.replace(/^\.\//, ''));
}

function toAssetPath(file) {
  return `./${relative(ROOT, file).split(sep).join('/')}`;
}

function listFiles(dir, extension) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = join(ROOT, dir, entry.name);
    if (entry.isDirectory()) return listFiles(posix.join(dir, entry.name), extension);
    return entry.name.endsWith(extension) ? [toAssetPath(file)] : [];
  }).sort();
}

function extractManifest() {
  const source = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
  const match = source.match(/const\s+PRODUCTION_ASSETS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error('service-worker manifest missing');
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function expectedAssets() {
  return [...REQUIRED_SINGLETONS, ...listFiles('styles', '.css'), ...listFiles('src', '.js'), ...listFiles('data', '.json')].sort();
}

function measureAssets(assets) {
  const categories = {};
  const totals = assets.reduce((sum, asset) => {
    const bytes = readFileSync(workspacePath(asset));
    const extension = asset.slice(asset.lastIndexOf('.'));
    const category = asset.split('/')[1] || asset;
    const gzip = TEXT_EXTENSIONS.has(extension) ? gzipSync(bytes, { level: 9 }).length : bytes.length;
    const brotli = TEXT_EXTENSIONS.has(extension) ? brotliCompressSync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).length : bytes.length;
    categories[category] ??= { files: 0, raw: 0, gzip: 0, brotli: 0 };
    categories[category].files += 1;
    categories[category].raw += bytes.length;
    categories[category].gzip += gzip;
    categories[category].brotli += brotli;
    sum.raw += bytes.length;
    sum.gzip += gzip;
    sum.brotli += brotli;
    return sum;
  }, { raw: 0, gzip: 0, brotli: 0 });
  return { totals, categories };
}

function validateAssets(assets) {
  const expected = expectedAssets();
  const errors = [];
  const expectedSet = new Set(expected);
  const assetSet = new Set(assets);
  for (const asset of assets) {
    if (!asset.startsWith('./')) errors.push(`${asset}: manifest paths must start with ./`);
    if (FORBIDDEN_PREFIXES.some((prefix) => asset.startsWith(prefix))) errors.push(`${asset}: forbidden asset`);
    if (!expectedSet.has(asset)) errors.push(`${asset}: unexpected asset`);
    statSync(workspacePath(asset));
  }
  for (const asset of expected) if (!assetSet.has(asset)) errors.push(`${asset}: missing asset`);
  return errors;
}

function timeOperation(iterations, operation) {
  const values = [];
  for (let index = 0; index < iterations; index++) {
    const started = performance.now();
    operation(index);
    values.push(performance.now() - started);
  }
  values.sort((left, right) => left - right);
  return {
    max: Number(values.at(-1).toFixed(3)),
    p95: Number(values[Math.floor((values.length - 1) * 0.95)].toFixed(3)),
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
  };
}

function measureHotPaths(data) {
  const floor = generateFloor(4242, 50, {}, data.themes);
  const lattice = createLattice(floor);
  lattice.setPartyPosition(floor.entryPoint.x, floor.entryPoint.y);
  const saveHarness = createGameHarness({ seed: 5151, partySize: 4, depth: 25 });
  const save = roundTripRunState(saveHarness.runState).encoded.fragment;
  const combatHarness = createGameHarness({ seed: 6262, partySize: 2, depth: 12 });
  const combat = startStandardCombat(combatHarness, { enemyHP: 30, partyOverrides: combatHarness.runState.party.map(() => ({ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } })) });
  const partyActor = () => combat.combatState.combatants.get(combat.combatState.turnOrder[combat.combatState.currentTurn]);

  return {
    floorGeneration: timeOperation(25, (index) => {
      const generated = generateFloor(7_000 + index, [1, 10, 50, 100][index % 4], {}, data.themes);
      if (!validateFloor(generated).valid) throw new Error('invalid generated floor');
    }),
    shadowcast: timeOperation(50, () => computeLOS(lattice, floor.entryPoint.x, floor.entryPoint.y, 10)),
    canvasFrameProxy: timeOperation(60, () => {
      let drawCalls = 0;
      for (let y = 0; y < floor.cells.length; y++) for (let x = 0; x < floor.cells[y].length; x++) if (floor.cells[y][x] !== 0) drawCalls += 1;
      if (drawCalls < 1) throw new Error('empty frame');
    }),
    combatAction: timeOperation(20, () => {
      resolveTurn(combat.combatState, combatHarness.cursor, combat.context);
      const actor = partyActor();
      const target = [...combat.combatState.combatants.values()].find((entry) => entry.side === 'enemy' && entry.hp > 0);
      if (actor?.side === 'party' && target) executeAction(combat.combatState, { type: 'attack', actorId: actor.id, targetId: target.id }, combatHarness.cursor, combat.context);
    }),
    saveEncodeDecode: runSaveStress(),
    decodeOnly: timeOperation(25, () => {
      const decoded = decodeRun(save);
      if (!decoded.success) throw new Error(decoded.error);
    }),
    audioSchedulingProxy: timeOperation(64, (index) => {
      const phraseIndex = Math.floor(index / 8);
      const barInPhrase = index % 8;
      const progression = progressionFor({
        worldSeed: 4242, depth: 50, floorId: '4242:50:0', phraseIndex, audioMode: 'cold-ambient'
      });
      const chord = progression.chords[barInPhrase % progression.chords.length];
      return melodyBar({
        worldSeed: 4242, depth: 50, floorId: '4242:50:0',
        phraseIndex, barInPhrase, chord, scale: SCALES['cold-ambient'], intensity: 0.5
      });
    })
  };
}

export function runBudgetReport() {
  const data = loadGameDataFixture();
  const assets = extractManifest();
  const assetErrors = validateAssets(assets);
  const transfer = measureAssets(assets);
  if (assetErrors.length) throw new Error(assetErrors.join('\n'));
  if (transfer.totals.gzip > TRANSFER_BUDGET_BYTES && transfer.totals.brotli > TRANSFER_BUDGET_BYTES) throw new Error('transfer budget exceeded');
  return {
    transferBudgetBytes: TRANSFER_BUDGET_BYTES,
    assetCount: assets.length,
    transfer,
    hotPaths: measureHotPaths(data)
  };
}

function printReport(report) {
  console.log(`Runtime assets: ${report.assetCount}`);
  console.log(`Transfer raw/gzip/brotli: ${report.transfer.totals.raw}/${report.transfer.totals.gzip}/${report.transfer.totals.brotli}`);
  console.log(`Floor generation p95 ms: ${report.hotPaths.floorGeneration.p95}`);
  console.log(`Max save fragment: ${report.hotPaths.saveEncodeDecode.maxLength}`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  printReport(runBudgetReport());
}
