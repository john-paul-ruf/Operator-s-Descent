import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { generateFloor } from '../src/floor/generator.js';
import { validateFloor } from '../src/floor/validator.js';
import { createRNGCursorForRun } from '../src/core/rng-cursor.js';
import { createLegalParty, loadGameDataFixture, combatActorFromCharacter } from '../tests/helpers/game-fixture.js';
import { createHuntEncounter } from '../src/rules/encounters.js';
import { ARCHETYPES } from '../src/floor/archetypes.js';

const DEFAULT_DEPTHS = [1, 10, 50, 100];

function parseArgs(argv) {
  const args = { seeds: 250, depths: DEFAULT_DEPTHS };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--seeds') args.seeds = Number(argv[++index]);
    else if (argv[index] === '--depths') args.depths = argv[++index].split(',').map(Number);
  }
  return args;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function sameFloor(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertReachableEncounter(floor, runState, data, seed) {
  if (!floor.enemySpawns.length) throw new Error(`seed ${seed} depth ${runState.depth}: missing standard encounter spawn`);
  const party = runState.party.map((character) => combatActorFromCharacter(character, data));
  const openCells = [];
  for (let y = 0; y < floor.cells.length; y++) {
    for (let x = 0; x < floor.cells[y].length; x++) if (floor.cells[y][x] !== 0) openCells.push({ x, y });
  }
  const hunt = openCells.find((cell) => createHuntEncounter(floor, cell, party, runState, createRNGCursorForRun(seed), data));
  if (!hunt) throw new Error(`seed ${seed} depth ${runState.depth}: hunt encounter injection failed`);
}

export function runGenerationStress({ seeds = 250, depths = DEFAULT_DEPTHS } = {}) {
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('invalid seed count');
  const data = loadGameDataFixture();
  const party = createLegalParty(2, data).party;
  const archetypes = new Set();
  const themes = new Set();
  const timings = [];
  const attempts = [];
  let worstTiming = null;
  let worstAttempts = null;

  for (let seed = 1; seed <= seeds; seed++) {
    for (const depth of depths) {
      if (!Number.isInteger(depth) || depth < 1 || depth > 255) throw new Error(`invalid depth ${depth}`);
      const themesSeen = data.themes.themes.slice(0, Math.min(data.themes.themes.length, Math.floor(depth / 10))).map((theme) => theme.id);
      const options = { themesSeen };
      const started = performance.now();
      const floor = generateFloor(seed, depth, options, data.themes);
      const elapsed = performance.now() - started;
      const replay = generateFloor(seed, depth, options, data.themes);
      const validation = validateFloor(floor);
      const acceptedAttempts = (floor.floorSubSeed ?? 0) + 1;

      if (!validation.valid) throw new Error(`seed ${seed} depth ${depth}: invalid floor ${validation.failures.join(',')}`);
      if (!sameFloor(floor, replay)) throw new Error(`seed ${seed} depth ${depth}: nondeterministic floor`);
      if (!floor.containers.length) throw new Error(`seed ${seed} depth ${depth}: no containers after generation`);
      assertReachableEncounter(floor, { depth, party, corruption: 0, dangerClockProgress: 0 }, data, seed);
      if (floor.threshold) {
        if (!floor.containers.some((container) => container.kind === 'vault')) throw new Error(`seed ${seed} depth ${depth}: threshold vault missing`);
        if (!floor.enemySpawns.some((enemy) => enemy.elite || enemy.archetypeId === 'apex')) throw new Error(`seed ${seed} depth ${depth}: threshold elite missing`);
      }

      archetypes.add(floor.archetypeId);
      themes.add(floor.themeId);
      timings.push(elapsed);
      attempts.push(acceptedAttempts);
      const record = { seed, depth, archetypeId: floor.archetypeId, themeId: floor.themeId, attempts: acceptedAttempts, ms: Number(elapsed.toFixed(3)), metrics: validation.metrics };
      if (!worstTiming || elapsed > worstTiming.ms) worstTiming = record;
      if (!worstAttempts || acceptedAttempts > worstAttempts.attempts) worstAttempts = record;
    }
  }

  const missingArchetypes = Object.keys(ARCHETYPES).filter((id) => !archetypes.has(id));
  if (missingArchetypes.length) throw new Error(`archetype coverage missing: ${missingArchetypes.join(',')}`);

  return {
    seeds,
    depths,
    sampleCount: timings.length,
    archetypes: [...archetypes].sort(),
    themes: [...themes].sort(),
    attempts: {
      max: Math.max(...attempts),
      p95: percentile(attempts, 0.95),
      worst: worstAttempts
    },
    timingsMs: {
      max: Number(Math.max(...timings).toFixed(3)),
      p95: Number(percentile(timings, 0.95).toFixed(3)),
      average: Number((timings.reduce((sum, value) => sum + value, 0) / timings.length).toFixed(3)),
      worst: worstTiming
    }
  };
}

function printReport(report) {
  console.log(`Floor stress: ${report.sampleCount} floors across ${report.seeds} seeds and depths ${report.depths.join(',')}`);
  console.log(`Archetypes: ${report.archetypes.join(', ')}`);
  console.log(`Attempts max/p95: ${report.attempts.max}/${report.attempts.p95}`);
  console.log(`Timing ms max/p95/avg: ${report.timingsMs.max}/${report.timingsMs.p95}/${report.timingsMs.average}`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  printReport(runGenerationStress(parseArgs(process.argv.slice(2))));
}
