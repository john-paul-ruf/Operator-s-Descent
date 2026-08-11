# Balance and Release Budget Report

## Reproducible Commands

1. `node ./scripts/stress-generation.js --seeds 250 --depths 1,10,50,100`
2. `node ./scripts/stress-saves.js`
3. `node ./scripts/simulate-runs.js --runs 50`
4. `node ./scripts/report-budget.js`
5. `npm test -- ./tests/performance/release-budgets.test.js`

## Recorded SESSION-54 Evidence

The SESSION-54 scripts emit deterministic JSON and a short human summary. They use fixed seed ranges, explicit depth lists, and no timestamps, network calls, analytics, or gameplay `Math.random()`.

| Gate | Result |
|---|---|
| Floor generation | 1,000 floors across 250 seeds and depths 1/10/50/100; all 8 archetypes and all 12 themes covered; max accepted sub-seed attempts 7, p95 attempts 3; max timing 1.636ms, p95 0.270ms, average 0.092ms. |
| Portable saves | 6 legal fixtures round-tripped; max fragment 1,476 chars for the deep active-combat boundary; p95 length 1,263; max encode 2.763ms, max decode 1.054ms. |
| Transfer/hot paths | 91 production assets; 732,542 raw bytes, 201,217 gzip bytes, 176,500 brotli bytes against the 512,000-byte compressed budget. Hot-path p95s: floor generation 0.429ms, shadowcast 0.050ms, canvas-frame proxy 0.021ms, combat action 0.260ms, audio scheduling proxy 0.007ms. |
| Simulation | 50 deterministic runs across standard, caster-heavy, CORRUPT-heavy, solo, and four-member strategies; 355 hunts, 30 retreats, 0 deaths in the sampled horizon, 692 failed overclocks, 40 corrupt implants; hunt interval average 2.97 floors; 0.5 reference threshold average 2.83 floors and not pathological under the <2-floor guard. |

## Tuning Decision

No gameplay constants were tuned in SESSION-54. The save codec now compacts common operator/enemy/encounter identifiers before compression so legal boundary states with two Echoes and an active combat snapshot remain below the portable URL budget. The 0.5 danger-clock reference is treated as a distribution checkpoint; hunts still trigger at the implemented full threshold.
