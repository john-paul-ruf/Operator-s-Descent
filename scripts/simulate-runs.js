import { fileURLToPath } from 'node:url';
import { createGameHarness, loadGameDataFixture } from '../tests/helpers/game-fixture.js';
import { tickDangerClock, resetDangerClock } from '../src/exploration/movement.js';

const STRATEGIES = ['standard', 'caster-heavy', 'corrupt-heavy', 'solo', 'four-member'];

function parseArgs(argv) {
  const args = { runs: 50 };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--runs') args.runs = Number(argv[++index]);
  }
  return args;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function summarize(values) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    average: Number(mean(values).toFixed(2))
  };
}

function strategyPartySize(strategy) {
  if (strategy === 'solo') return 1;
  if (strategy === 'four-member' || strategy === 'corrupt-heavy') return 4;
  return 2;
}

function applyStrategyPressure(harness, strategy, depth) {
  let failedOverclocks = 0;
  let implants = 0;
  if (strategy === 'caster-heavy' || strategy === 'corrupt-heavy') {
    const attempts = strategy === 'corrupt-heavy' ? 3 : 2;
    for (let index = 0; index < attempts; index++) {
      const roll = harness.cursor.nextInt('combat', 20) + 1;
      const failed = roll + 1 < 13 + (depth % 5);
      if (failed) {
        failedOverclocks += 1;
        harness.runState.addCorruption(0.05);
      }
    }
  }
  if (strategy === 'corrupt-heavy' && depth % 5 === 0) {
    implants = 1;
    harness.runState.applyCorruptImplant(`implant_${depth}`, 0.1);
  }
  return { failedOverclocks, implants };
}

function simulateOne(seed, strategy) {
  const harness = createGameHarness({ seed, partySize: strategyPartySize(strategy), depth: 1 });
  const maxDepth = strategy === 'solo' ? 18 : strategy === 'corrupt-heavy' ? 24 : 22;
  const huntDepths = [];
  const referenceDepths = [];
  let failedOverclocks = 0;
  let implants = 0;
  let referenceArmed = true;
  let death = false;
  let retreatCount = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    harness.runState.depth = depth;
    const pressure = applyStrategyPressure(harness, strategy, depth);
    failedOverclocks += pressure.failedOverclocks;
    implants += pressure.implants;
    const steps = 8 + ((seed + depth) % 10) + (strategy === 'solo' ? 2 : 0);
    const tick = tickDangerClock(harness.runState, steps, { exploring: true });
    if (referenceArmed && harness.runState.dangerClockProgress >= 0.5) {
      referenceDepths.push(depth);
      referenceArmed = false;
    }
    if (tick.huntTriggered) {
      huntDepths.push(depth);
      if (strategy === 'solo' && depth > 12 && (seed + depth) % 5 === 0) death = true;
      if (strategy === 'corrupt-heavy' && (seed + depth) % 4 === 0) retreatCount += 1;
      resetDangerClock(harness.runState);
      referenceArmed = true;
      if (death) break;
    }
  }

  return {
    seed,
    strategy,
    depthReached: death ? huntDepths.at(-1) : maxDepth,
    death,
    retreats: retreatCount,
    failedOverclocks,
    implants,
    finalCorruption: Number(harness.runState.corruption.toFixed(3)),
    hunts: huntDepths.length,
    huntDepths,
    referenceDepths
  };
}

export function runSimulation({ runs = 50 } = {}) {
  if (!Number.isInteger(runs) || runs < 1) throw new Error('invalid run count');
  loadGameDataFixture();
  const records = Array.from({ length: runs }, (_, index) => simulateOne(10_000 + index, STRATEGIES[index % STRATEGIES.length]));
  const byStrategy = Object.fromEntries(STRATEGIES.map((strategy) => {
    const strategyRecords = records.filter((record) => record.strategy === strategy);
    return [strategy, {
      runs: strategyRecords.length,
      depthReached: summarize(strategyRecords.map((record) => record.depthReached)),
      hunts: summarize(strategyRecords.map((record) => record.hunts)),
      deaths: strategyRecords.filter((record) => record.death).length,
      retreats: strategyRecords.reduce((sum, record) => sum + record.retreats, 0),
      failedOverclocks: strategyRecords.reduce((sum, record) => sum + record.failedOverclocks, 0),
      implants: strategyRecords.reduce((sum, record) => sum + record.implants, 0),
      finalCorruptionAverage: Number(mean(strategyRecords.map((record) => record.finalCorruption)).toFixed(3))
    }];
  }));
  const allHuntIntervals = records.flatMap((record) => record.huntDepths.map((depth, index) => depth - (index === 0 ? 0 : record.huntDepths[index - 1])));
  const referenceIntervals = records.flatMap((record) => record.referenceDepths.map((depth, index) => depth - (index === 0 ? 0 : record.referenceDepths[index - 1])));
  return {
    runs,
    strategies: STRATEGIES,
    totals: {
      hunts: records.reduce((sum, record) => sum + record.hunts, 0),
      deaths: records.filter((record) => record.death).length,
      retreats: records.reduce((sum, record) => sum + record.retreats, 0),
      failedOverclocks: records.reduce((sum, record) => sum + record.failedOverclocks, 0),
      implants: records.reduce((sum, record) => sum + record.implants, 0)
    },
    huntIntervalFloors: allHuntIntervals.length ? summarize(allHuntIntervals) : { min: 0, max: 0, average: 0 },
    referenceHalfThresholdFloors: referenceIntervals.length ? summarize(referenceIntervals) : { min: 0, max: 0, average: 0 },
    halfThresholdPathological: referenceIntervals.length ? mean(referenceIntervals) < 2 : false,
    byStrategy,
    sample: records.slice(0, 10)
  };
}

function printReport(report) {
  console.log(`Run simulation: ${report.runs} deterministic runs`);
  console.log(`Totals hunts/deaths/retreats: ${report.totals.hunts}/${report.totals.deaths}/${report.totals.retreats}`);
  console.log(`Half-threshold pathological: ${report.halfThresholdPathological}`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  printReport(runSimulation(parseArgs(process.argv.slice(2))));
}
