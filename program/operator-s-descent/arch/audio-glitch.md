# Architecture Detail — Audio and Visual Degradation

## Modules

| IDs | Area | Owns |
|---|---|---|
| M47–M52 | Audio | WebAudio engine and five synthesized layers |
| M53–M55 | Visual degradation | Ambient glitch, canvas grain, authored transitions |

## Audio Contract

```js
export function createAudioEngine() {}
// controller: start(), stop(), setMute(), setLayerVolume(), updateState()
```

- AudioContext creation and all layer start calls occur only in the START gesture chain.
- Theme selects mode/timbre. Depth drives a 1.2-second pitch-bias glide on drone/pulse/sparkle only.
- Hostile proximity drives pulse; container proximity drives sparkle; motifs never repeat across phrases within a floor (per-floor Set, cap 16); bars within a phrase deliberately repeat by design (`A A′ B A(half-cad) | A A″ B C(full-cad)`). [AMENDED 2026-08-20 via upbeat-melodic-score SESSION-01]
- Combat transforms intensity without replacing theme material. Noise bed tracks no game state.

## Glitch Contract

```js
export function createGlitchSystem(options = {}) {}
// registerElement(), unregisterElement(), start(), stop(), setEnabled(), setDecisionPending()
```

- Each registered element declares one author-time intensity and draws each effect cadence once at construction; the cadence is reused for its heartbeat.
- Ambient effects may use live `Math.random()` and never inspect run/game state.
- Reserved sigils never undergo codepoint substitution.
- No actionable information is obscured for more than 400ms; interactive controls are excluded while a decision is pending.
- OS reduced-motion plus manual override form a three-state policy. Transitions and ambient glitch use the same resolved policy; scanline/grain remains separately controllable.

## Baseline Audit (2026-08-10)

Current cadence is re-rolled every tick, each registered element schedules global effects, decision safety/unregistration is missing, and transitions ignore the manual setting. Audio does not fully apply theme mode, pitch glide, combat transformation, or live proximity pushes.

## Change History

| Date | Change |
|---|---|
| 2026-08-11 | SESSION-55 fixed full-motion browser timer cleanup in M53 by clearing ambient interval/timeout handles through `globalThis`, preventing `Illegal invocation` during route unmount; regression coverage was added in `./tests/glitch/glitch.test.js`. |
| 2026-08-11 | SESSION-49 made authored descent/death transitions wrappers around already-committed transactions and centralized glitch/grain/audio startup, live settings application, and destroy-time cleanup under M86 activation. |
| 2026-08-11 | SESSION-47 applied settings at activation-time audio startup and finalized live settings dispatch for mute, five layer volumes, glitch, reduced-motion policy, and scanline/grain controls. |
| 2026-08-09 | Initial M47–M55 modules. |
| 2026-08-10 | Added explicit decision safety and unified motion-policy contract. |
| 2026-08-10 | SESSION-38 fixed ambient glitch cadence ownership, protected controls, grain cleanup, and transition motion-policy fallbacks. |
| 2026-08-10 | SESSION-39 completed injected five-layer WebAudio graph, retunable theme/depth layers, proximity instruments, and deterministic lead ledger. |
| 2026-08-11 | SESSION-43 wired `audio:update-state` proximity payloads from exploration to the injected WebAudio engine so visible hostile/container distances drive pulse/sparkle without exposing hidden-map information. |
| 2026-08-20 | upbeat-melodic-score SESSION-01 rewrote M110: functional-degree progression walk, seeded motif engine + AABA phrase renderer, rule-built bass/drums, director merge + combat-key normalization, raised intensity/sparkle floors, tempo 112–180, `bass[16]` added to the tick payload. |

<!-- upbeat-melodic-score SESSION-01 -->
## M110 Conductor — behavioral contract (upbeat-melodic-score SESSION-01 delta)

- **Owns** now reads: single lookahead musical clock (25 ms poll, 120 ms horizon), functional-degree progression walk (no pattern pool), seeded motif engine + AABA phrase renderer (rendered per bar), rule-generated bass line + drum kit (no mask pool, no heartbeat), game-state director (intensity/sparkle/tempo with raised floors and combat-key normalization), bar-quantized changes, per-floor motif no-repeat ledger (cap 16). `DARK_POOL` / `BRIGHT_POOL` / `RHYTHM_MASKS` deleted.
- **New named exports:** `motifFor`, `phraseBar`, `bassBar` (in addition to the preserved `SCALES`, `ROOTS`, `chordFor`, `progressionFor`, `drumPattern`, `directorTargets`, `createConductor`). `melodyBar` remains exported as a back-compat shim (`motifFor` + `phraseBar`) so `scripts/report-budget.js` `audioSchedulingProxy` keeps loading; new callers should use the motif/phrase API directly.
- **Tick payload (frozen for S02):** `{ time, pos, tempo, secondsPerSixteenth, chord, scale, rootFreq, intensity, sparkle, combat, melody[16], bass[16], drums{kick,snare,hat} }`.
  - `melody[i]` slot shape unchanged: `{ degree, octave: 0|1, velocity, lengthSlots ≤ 8 }` (sustains capped at 8, up from 4).
  - `bass[i]` slot shape: `{ semi, octave: -1|0, velocity, lengthSlots }`.
- **Director** now accepts combat under any of `combat`, `combatActive`, `combatState`; `updateState(gs)` MERGES rather than replacing `latestGameState` (a lone `{combat:true}` from `runtime.js` no longer erases depth/proximity). Intensity floor = `0.35 + clampedDepth/30 * 0.2`; sparkle floor = 0.25; tempo band 112–180 (`116 + clampedDepth*0.8 + intensity*22 + (combat ? 22 : 0)`).
- **tierFor thresholds:** `<0.45 → 0`, `<0.6 → 1`, `<0.8 → 2`, else 3; combat pins 3.
- `src/runtime.js` and the M52 engine public API are unchanged — all wiring fixes are receiver-side in M110.

<!-- SESSION-05 — combat-and-ux-feedback-pass, 2026-08-24 -->

### M52 Audio Engine — additive public API

- `resume()` — mirrors the existing `suspend()`: calls `audioContext.resume()`
  when the underlying AudioContext exposes it, otherwise resolves. Together
  with `suspend()`, this pauses/continues the entire audio graph
  (currentTime freezes on suspend, resumes cleanly on resume) and is
  orthogonal to `setMute`/`setMasterVolume` — no gain-level state is touched.
