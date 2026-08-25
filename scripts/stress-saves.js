import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createGameHarness, loadGameDataFixture, lootFirstContainer, queueSingleDeathEcho, roundTripRunState, startStandardCombat } from '../tests/helpers/game-fixture.js';
import { decodeRun } from '../src/state/save-decode.js';
import { encodeRun, SAVE_BUDGET } from '../src/state/save-encode.js';
import { INVENTORY_CAP } from '../src/rules/inventory.js';

const EVENT_TAIL_COUNTS = [0, 4, 8, 16, 32, 64];
const EVENT_TAIL_MIN_SURVIVORS = 8; // when count >= this, at least this many must survive
const EVENT_TYPES = ['combat', 'damage', 'move', 'loot', 'heal', 'discovery'];

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function markDenseRun(runState) {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 20; x++) runState.markCellVisited(x, y);
  for (let index = 0; index < 64; index++) {
    runState.markContainerOpened(index);
    runState.markEnemyDefeated(index);
  }
}

// A single inventory slot filled to the program-wide stack cap. Uses
// INVENTORY_CAP directly so this worst-case fixture tracks the cap instead of
// drifting (it was pinned at a stale 100 after the cap was cut 100 → 40, which
// built an illegal over-cap stack that writeItem rightly rejected).
function capStack() {
  return { id: 'cap_stack', category: 'consumable', baseType: 'repair_patch', rarity: 'stock', affixes: [], corrupt: false, stats: {}, salvageValue: 1, junkTagged: false, count: INVENTORY_CAP };
}

function addPartyPressure(runState) {
  for (const [index, character] of runState.party.entries()) {
    character.currentHP = Math.max(1, character.currentHP - index - 1);
    character.currentCHARGE = Math.max(0, character.currentCHARGE - index);
    character.conditions = [
      { conditionId: 'burning', duration: 3, stacks: 2 },
      { conditionId: 'jammed', duration: 2, stacks: 1 },
      { conditionId: 'shielded', duration: 1, stacks: 1 }
    ];
  }
}

function duplicateSecondEcho(runState) {
  if (!runState.echoQueue.length) return;
  const echo = clone(runState.echoQueue[0]);
  echo.appearanceFloor = echo.deathFloor + 2 + ((echo.appearanceFloor - echo.deathFloor - 1) % 3);
  runState.echoQueue.push(echo);
}

function pointCurrentIndexAtParty(runState) {
  const partyTurn = runState.activeCombat?.initiativeOrder?.findIndex((id) => String(id).startsWith('operator_'));
  if (partyTurn >= 0) runState.activeCombat.currentIndex = partyTurn;
}

function ceilingHarness(seed, archetypes) {
  const harness = createGameHarness({ seed, partySize: 4, depth: 100 });
  harness.runState.inventory = [capStack()];
  markDenseRun(harness.runState);
  addPartyPressure(harness.runState);
  harness.runState.flags.calibrationFloorsReached = Array.from({ length: 16 }, (_, index) => (index + 1) * 3);
  queueSingleDeathEcho(harness);
  duplicateSecondEcho(harness.runState);
  startStandardCombat(harness, { archetypes, enemyCount: 20, enemyHP: 'natural' });
  pointCurrentIndexAtParty(harness.runState);
  return harness.runState;
}

function fixtures() {
  loadGameDataFixture();
  const minimum = createGameHarness({ seed: 101, partySize: 1, depth: 1 });

  const typical = createGameHarness({ seed: 202, partySize: 2, depth: 12 });
  lootFirstContainer(typical);
  typical.runState.corruption = 0.15;

  const inventoryCap = createGameHarness({ seed: 303, partySize: 2, depth: 20 });
  inventoryCap.runState.inventory = [capStack()];
  inventoryCap.runState.scrapCounter = 120;

  const deepParty = createGameHarness({ seed: 404, partySize: 4, depth: 100 });
  markDenseRun(deepParty.runState);
  addPartyPressure(deepParty.runState);
  deepParty.runState.corruption = 0.45;
  deepParty.runState.inventory = [capStack()];
  deepParty.runState.flags.calibrationFloorsReached = Array.from({ length: 16 }, (_, index) => (index + 1) * 3);

  const echoes = createGameHarness({ seed: 505, partySize: 4, depth: 100 });
  queueSingleDeathEcho(echoes);
  duplicateSecondEcho(echoes.runState);

  const activeCombat = createGameHarness({ seed: 606, partySize: 4, depth: 100 });
  activeCombat.runState.inventory = [capStack()];
  markDenseRun(activeCombat.runState);
  queueSingleDeathEcho(activeCombat);
  duplicateSecondEcho(activeCombat.runState);
  startStandardCombat(activeCombat, {
    enemyCount: 4,
    enemyHP: 24,
    partyOverrides: activeCombat.runState.party.map(() => ({ weapon: { damageDie: 'd4', rangeBand: 'short', maxRange: 16, minRange: 0, accuracyBonus: 20 } }))
  });
  pointCurrentIndexAtParty(activeCombat.runState);

  const casterCeiling = ceilingHarness(707, ['choir', 'null']);
  const apexCeiling = ceilingHarness(808, ['choir', 'null', 'construct', 'apex']);

  return [
    ['legal-minimum', minimum.runState],
    ['typical-depth-12', typical.runState],
    [`stack-aware-${INVENTORY_CAP}-item-cap`, inventoryCap.runState],
    ['four-operator-deep-dense', deepParty.runState],
    ['two-echo-queue', echoes.runState],
    ['deep-active-combat-boundary', activeCombat.runState],
    ['caster-pack-ceiling', casterCeiling],
    ['apex-pack-ceiling', apexCeiling]
  ];
}

function eventTailFixtures() {
  loadGameDataFixture();
  // Representative slice of live-play sizes. The event-tail dimension crosses
  // each with the ladder counts; every combination must save without loss of
  // the whole tail — that is the exact user-facing bug this gate defends.
  return [
    ['depth-1-freshly-started', () => createGameHarness({ seed: 909, partySize: 2, depth: 1 }).runState],
    ['depth-3-post-first-loot', () => {
      const h = createGameHarness({ seed: 910, partySize: 2, depth: 3 });
      lootFirstContainer(h);
      return h.runState;
    }],
    ['depth-12-two-op-mid-run', () => {
      const h = createGameHarness({ seed: 911, partySize: 2, depth: 12 });
      lootFirstContainer(h);
      h.runState.corruption = 0.15;
      return h.runState;
    }]
  ];
}

function pushRealisticEvents(runState, count) {
  runState.recentEvents = [];
  for (let index = 0; index < count; index++) {
    runState.recordEvent({
      type: EVENT_TYPES[index % EVENT_TYPES.length],
      message: `Event ${index}: mid-length message representative of live play activity.`,
      sequence: 1_700_000_000_000 + index
    });
  }
}

function runEventTailStress() {
  const cases = [];
  for (const [fixtureName, factory] of eventTailFixtures()) {
    for (const count of EVENT_TAIL_COUNTS) {
      const runState = factory();
      pushRealisticEvents(runState, count);
      const encodeStart = performance.now();
      const encoded = encodeRun(runState);
      const encodeMs = performance.now() - encodeStart;
      if (!encoded.success) throw new Error(`${fixtureName}@${count}events: encode failed`);
      if (encoded.fragment.length >= SAVE_BUDGET) throw new Error(`${fixtureName}@${count}events: save length ${encoded.fragment.length} exceeds budget`);
      if (count > 0 && encoded.metrics.eventsKept === 0) throw new Error(`${fixtureName}@${count}events: trim ladder dropped ALL events — resuming player would lose full history`);
      if (count >= EVENT_TAIL_MIN_SURVIVORS && encoded.metrics.eventsKept < EVENT_TAIL_MIN_SURVIVORS) {
        throw new Error(`${fixtureName}@${count}events: only ${encoded.metrics.eventsKept} events survived, below floor of ${EVENT_TAIL_MIN_SURVIVORS}`);
      }
      const decoded = decodeRun(encoded.fragment);
      if (!decoded.success) throw new Error(`${fixtureName}@${count}events: decode failed ${decoded.error}`);
      if (decoded.runState.recentEvents.length !== encoded.metrics.eventsKept) throw new Error(`${fixtureName}@${count}events: decoded tail length drift`);
      cases.push({
        name: `${fixtureName}@${count}events`,
        length: encoded.fragment.length,
        eventsKept: encoded.metrics.eventsKept,
        eventsDropped: encoded.metrics.eventsDropped,
        encodeMs: Number(encodeMs.toFixed(3))
      });
    }
  }
  return cases;
}

export function runSaveStress() {
  const cases = [];
  for (const [name, runState] of fixtures()) {
    const encodeStart = performance.now();
    const { encoded, decoded } = roundTripRunState(runState);
    const encodeMs = performance.now() - encodeStart;
    const decodeStart = performance.now();
    const secondDecode = decodeRun(encoded.fragment);
    const decodeMs = performance.now() - decodeStart;
    if (!secondDecode.success) throw new Error(`${name}: second decode failed ${secondDecode.error}`);
    if (encoded.fragment.length >= SAVE_BUDGET) throw new Error(`${name}: save length ${encoded.fragment.length} exceeds budget`);
    if (JSON.stringify(decoded.serialize()) !== JSON.stringify(secondDecode.runState.serialize())) throw new Error(`${name}: decode invariant drift`);
    cases.push({
      name,
      length: encoded.fragment.length,
      rawBytes: encoded.metrics.rawBytes,
      compressedBytes: encoded.metrics.compressedBytes,
      layers: encoded.metrics.layers,
      encodeMs: Number(encodeMs.toFixed(3)),
      decodeMs: Number(decodeMs.toFixed(3))
    });
  }
  const eventTailCases = runEventTailStress();
  const lengths = cases.map((entry) => entry.length);
  const encodeTimes = cases.map((entry) => entry.encodeMs);
  const decodeTimes = cases.map((entry) => entry.decodeMs);
  return {
    caseCount: cases.length,
    maxLength: Math.max(...lengths),
    p95Length: percentile(lengths, 0.95),
    encodeMs: { max: Math.max(...encodeTimes), p95: percentile(encodeTimes, 0.95) },
    decodeMs: { max: Math.max(...decodeTimes), p95: percentile(decodeTimes, 0.95) },
    cases,
    eventTail: {
      caseCount: eventTailCases.length,
      minSurvivors: EVENT_TAIL_MIN_SURVIVORS,
      counts: EVENT_TAIL_COUNTS,
      cases: eventTailCases
    }
  };
}

function printReport(report) {
  console.log(`Save stress: ${report.caseCount} legal fixtures, max fragment ${report.maxLength}`);
  console.log(`Encode ms max/p95: ${report.encodeMs.max}/${report.encodeMs.p95}`);
  console.log(`Decode ms max/p95: ${report.decodeMs.max}/${report.decodeMs.p95}`);
  const eventTail = report.eventTail;
  if (eventTail) {
    const minKept = Math.min(...eventTail.cases.map((entry) => entry.eventsKept));
    const maxKept = Math.max(...eventTail.cases.map((entry) => entry.eventsKept));
    console.log(`Event-tail sweep: ${eventTail.caseCount} combinations (counts ${eventTail.counts.join('/')}), eventsKept min/max ${minKept}/${maxKept}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  printReport(runSaveStress());
}
