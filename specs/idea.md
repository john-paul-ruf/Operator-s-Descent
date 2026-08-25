# Idea — Operator's Descent

**Owner:** John Ruf / Glitch Forgeworks LLC
**Sibling project:** Universal Operator's Tarot (visual language source)
**Status:** Idea approved — ready for requirements
**Date:** 2026-08-09

---

## One-Sentence Summary

Operator's Descent is a buildless, static-hosted d20 dungeon roguelike rendered as a degrading CRT/VHS terminal, where every action routes through a single bottom-pinned console and every run lives in a shareable URL.

---

## Problem

Players who want tactical depth and build-craft in a roguelike are served by two extremes. On one end, heavyweight desktop clients — Caves of Qud, Cogmind, Jupiter Hell — deliver real systems but demand installation, a learning cliff, and a sit-down session. On the other, browser roguelikes load instantly but almost universally trade away tactical combat: no positioning, no range bands, no cover, no meaningful party composition.

Nothing in the middle. A player who wants genuine d20 tactics — where a party with no ranged answer spends two rounds being shot for free — has to leave the browser to get it.

Two further gaps compound this:

- **Dungeons are not shareable.** Procedural roguelikes generate worlds nobody else can visit. "Try this seed" is a forum post, not a link. There is no verb for handing someone your exact dungeon.
- **Browser games are not portable.** Progress lives in `localStorage` on one machine, in one browser. Close the tab on your laptop, and your run does not follow you to your phone.

And the interaction model is stale. Browser roguelikes inherit desktop conventions — context menus, hover tooltips, floating inventory panels, click-the-map movement — none of which work on a phone, which is where a tall dungeon most wants to be played.

---

## Vision

You are looking down a hole.

The screen is a tall shaft — 1080×1920 portrait, a CRT terminal slowly coming apart. Portrait is not a mobile concession; it is the premise. An 8-wide, 16-deep combat field reads as a corridor rather than an arena. Floors generate with a vertical bias, descent points sitting at the far end of the shaft. The screen shape reinforces the verb.

**The run begins with one decision.** Eighty points, one pool, spent across one to four characters. Five points instantiates a chassis; the rest buys attributes, equipment, and tech protocols. Spend it all on a single operator and you get enormous per-unit power with one action per round and one point of failure. Split it four ways and you get four actions per round and four fragile specialists. That choice is the run. The buy screen shows points remaining, projected stats, and an actions-per-round readout, so the tension is legible while you are making it.

**Every floor is a neon wireframe.** Eight generation archetypes — sprawling merged chambers, cellular caves, tight orthogonal mazes, pillared cathedrals, meandering spines, fractured floors split by voids, concentric rings, scattered shards — crossed with zero to two modifiers and one of twelve environment themes. The theme is the organizing principle: it sets the accent color, weights the archetype and modifier rolls, biases the enemy mix and loot table, and selects the audio mode. Because the accent flows through a single custom property, changing it re-skins the entire screen. Cold Storage is pale blue, vast, and quiet. The Foundry is orange, cramped, and violent. You read the floor from its color before you read a number.

**Combat is not a separate space.** It is the same floor at twice the magnification. When contact is made, the view zooms to an 8×16 window anchored on the contact point, and whatever geometry happens to be there becomes the arena. There is no combat-only tileset and no hand-placed arena. This is why generation variety and tactical variety are the same problem — and why floor validation guarantees interior cover in every large room. An empty room becomes an empty arena, and an empty arena is a boring fight.

Combat itself is turn-based and range-first. Deployment puts nine to twelve cells between the bands, which gives every engagement a natural three-act shape: an approach where only long weapons and long protocols matter, a contact phase fought over mid-field cover, and a resolution that goes to whoever won that cover. Range coverage is the real party-composition constraint — more than class variety is.

**One input surface.** Every action in the game routes through a single console pinned to the bottom of the screen. No context menus, no floating panels, no hover UI, no tapping the map. The playfield is a readout, not a control. The console swaps between seven mutually exclusive modes — MOVE, COMBAT, PARTY, GEAR, TECH, LOOT, LOG — expands to a fixed height that never shifts under your thumb, dims the playfield behind it, and auto-pans so the active actor stays visible. Everything is reachable by keyboard, and everything is reachable by thumb.

**The machine is bad signal, always.** The CRT is not a meter. Glitch runs on fixed constants — channel split, character substitution, jitter, tracking tears, block bars — fired by free-running random timers that take no input from the game. There is no global glitch level, no ramp with depth, no spike at low HP, no discrete trigger on a natural 1. The terminal is degraded in the first second of the first floor exactly as much as it is at depth fifty.

This is a ported behavior, not a simplification, and the source app settles it twice over.

First, the call sites. The tarot's `glitchText` does take an `intensity` parameter, and it is genuinely live — it is the probability gate on every tick. But across **exactly fifty call sites, every value passed is a hardcoded literal** drawn from a set of seven: 0.06, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20. The function's own default of 0.3 is never once reached. No reading, no card, no seed, no phase, no drag position feeds any of them. The hand-tuned number per element is doing the work: a card's Hebrew letters glitch hardest at 0.18, a disclaimer barely moves at 0.06. Intensity is a *typographic weight*, chosen once by eye per element, not a status readout.

Second, and more decisively: **the tarot builds a state-driven glitch value and then refuses to use it.** Its engine computes `glitchIntensity` from the drawn archetype's shadow probability, serializes it into the saved reading, and deserializes it on load. Not one consumer reads it. The driven meter exists in the data model, fully plumbed, and every renderer ignores it in favour of its own constant. Three separate source files carry a comment naming this as a deliberate rule — *unseeded ambient glitch, live `Math.random()` and timers*. The seeded PRNG is imported by the reading engine alone; no visual effect ever touches it.

That is not an oversight to correct in the port. It is a decision the sibling project already made, tested against a shipped app, and documented in its own source. Descent inherits the conclusion rather than relitigating it.

That is the model to port. An effect that means something has to be watched. An effect that is always there can simply be inhabited. Status belongs to color and sound, which already carry it — the accent says where you are, the pulse says what is near. The glitch says what you are looking through.

**Descent inherits the per-element intensity dial.** Every glitching element declares its own constant at authoring time, the way the tarot does. A depth readout may sit at 0.20; body copy sits at 0.06. What no element may do is read that number from game state.

One distinction survives: **ambient glitch is constant, but transitions are authored.** The boot sequence, a floor descent, a death — these are scripted set-piece animations with their own fixed timelines, the way the tarot's card reveal is a three-act dissolve rather than a turn of the noise dial. They fire on an event and run a known length. They are not a meter either.

Character substitution needs one guard rail, because it swaps glyphs and the sigil banks are reserved. It draws only from an explicitly enumerated safe pool — Latin, digits, box-drawing — declared alongside the banks in `data/sigils.json`, so the lint check that bans bank glyphs elsewhere has something unambiguous to test against. And a sigil is never substituted. A Ghost's glyph must not glitch into a different valid sigil, because the player would misread which character just took the hit, and Echoes already wear dead characters' sigils. Under glitch a sigil may split, invert, or degrade to noise. It may never become a different codepoint.

Two further rules keep it honest: glitch never obscures actionable information for longer than 400ms, and never touches an interactive control while a decision is pending. Both are fully disabled by `prefers-reduced-motion` and by a settings toggle — and because glitch was never carrying information, disabling it costs the player nothing but texture. Note that the tarot has no reduced-motion handling at all; every animation runs unconditionally there. This is the one place Descent adds rather than ports.

**The timings port literally.** These are measured constants from the running sibling app, not a redesign. Full values belong in `specs/requirements.md`; the shape is fixed here so nobody re-derives it by eye:

| Effect | Cadence | Duration | Magnitude |
|---|---|---|---|
| Character substitution | 700–1799ms between attempts, gated by the per-element constant | 120–349ms swapped, then reverts | 1–2 chars; ±3px x, ±1px y displacement |
| Text chromatic ghosts | Only during a swap window | Same 120–349ms | ±2px, red and blue at 47% |
| VHS event | 4000–9999ms between events | 80–249ms | chroma ±2–4px, tear 2–6px tall offset ±5–15px, content jitter ±2px |
| Element jitter | 500–1399ms, 30% fire | 70–199ms | ±3px x, ±2px y |
| Border flicker | 400–1099ms, 35% fire | 40–159ms | opacity 0.5–0.9 |
| Frame flash | 1800–4499ms, 12% fire | 30–89ms | magenta at 5% |
| Glitch bars | 350–999ms, 40% fire | 80–249ms | 1–4px tall, ±8px offset, alpha 0.1–0.5 |
| Noise lines | 1200–3499ms, 30% fire | 80–299ms | 8–28 chars at 8px |
| Scanlines | 1px line every 2px, white at 10% | continuous | drifts 2px over 4000ms, wrapping |
| Tracking band | — | 7s linear loop | 28% of viewport height, screen blend, 5% white-blue |
| Vignette | — | 4s ease-in-out pulse | opacity 0.65 ↔ 0.92 |
| Aperture grille | static | — | 3px RGB triad, screen blend at 50% |

Two structural notes. Each timer's period is drawn **once at element construction**, not re-rolled per tick — so every element has its own fixed heartbeat and the screen never pulses in unison. And the grain is a canvas dot-scatter re-scattered once per second — a 10px cell grid, ~15% fill, 2×2px dots — not the SVG turbulence the source requirements describe. There is no SVG anywhere in the tarot. Port the canvas approach; it is cheaper and it is what actually produces the look.

**The sound is the opposite decision, and deliberately so.** Where the picture is fixed, the score is the instrument panel. Audio is fully synthesized, no files, in five layers — and three of them move.

A **drone** sets the floor's ground: the environment theme picks its timbre and modal set, depth drops its register and widens its detune. A Foundry at depth 4 and a Foundry at depth 24 are recognizably the same place under different pressure. A **pulse** tightens in tempo and density as the nearest hostile closes, and injects dissonance — tritones, minor seconds, shortened note values — scaled by that distance. A **sparkle** does the inverse for treasure: an upper-register arpeggio whose density and filter cutoff open as the nearest container nears. A **lead** carries the actual melody, generated bar by bar from `hash(worldSeed, depth, floorId, barIndex)`, in the mode the theme selected. And a **noise bed** — tape hiss, wow, flutter — sits at a fixed level and tracks nothing, because it is a property of the machine, not a readout of the run.

So the division of labour is clean: **the picture says what you are looking through, the color says where you are, and the sound says what is happening.** A player who has muted the game loses information. A player who has disabled glitch loses none. That asymmetry is intentional, and it is what earns the constant-glitch decision — status had to go somewhere, and it went to the two channels that can carry a gradient without ever obscuring a control.

Two hard rules. **No melodic bar repeats within a run** — enforced by a rolling hash ledger with perturb-and-regenerate on collision, not left to chance. And combat does not change the music, it transforms it: the same floor material at higher intensity. Continuity of theme, change of state.

**This layer is built, not ported.** The sibling app has no melody generator at all — no scale tables, no interval sets, no tempo, no bar structure. What it has is a hundred-line handshake jingle and an ambient bed of hardcoded frequency tables picked at random. The one genuinely state-driven thing in its entire audio engine is a *pitch bias*: the drawn card's position on the Tree of Life sets a global multiplier, an equal-tempered ratio clamped to a two-octave window, which every retunable voice glides to over 1.2 seconds while the mains hum and the boot sequence stay immune. That mechanism is exactly right for depth — one scalar, a slow glide, a fixed subset of voices that follow and a fixed subset that never do. Port the mechanism. The melody engine above it is new work.

**Death is final, but it echoes.** No meta-progression, no continue, no unlocks. A party wipe ends the run. But when a single character dies, an Echo is queued: two to four floors deeper it appears wearing that character's sigil in red, carrying their equipment at the moment of death, using their class signature. Kill it and you reclaim the gear. It is the only enemy that draws from the player sigil bank, and the only reason that reservation rule needs an exception.

**A character is one glyph.** No portrait art, no composite avatars. A single symbol is the character's face at 220px in the creation picker and its combat token at 72px on the grid — the same codepoint at four fixed sizes.

These glyphs are not borrowed from a system font or salvaged from someone else's dingbats. **They are drawn for this project.** A custom typeface, cyberpunk-mystical: occult sigil geometry executed as circuit etching, where a summoning seal and a fabrication mask are the same drawing. Hard geometric construction, radial and axial symmetry, sealed rings and broken ones, glyphs that look equally like a ward and a logic gate. It ships bundled and subsetted, so a sigil looks the same on every machine and a shared run looks like the run its author saw. Because the banks are reserved, no glyph from them may render anywhere else in the application. Carets, bullets, dividers, and AP markers are drawn with CSS and SVG instead. If a symbol appears on screen, it is a creature, not a control.

**The run is a link.** Full state — party, current HP and charge, inventory, position, depth, flags, corruption, Echo queue, RNG cursor — encodes into a URL fragment under 1500 characters, short enough to survive any chat client. Paste it and the run reconstructs bit-for-bit on any machine. Share just the seed and you share the dungeon: the same seed always yields the same floors, the same loot, the same encounters, forever — however deep anyone cares to go. That is the verb the genre is missing.

**The front door is a switch you throw.** The game opens on a title screen and waits. Nothing loads, nothing plays, nothing generates until you press START — which is both a deliberate framing device and an honest one, since browsers will not let synthesized audio begin without a gesture anyway. The machine is off, and you turn it on. From there: begin a new run, resume one already in progress, or paste a link. A first-time player is offered a tutorial and can decline it in one press; declining is remembered, and it is never offered again unasked.

**The tutorial is a manual, not a level.** It teaches the interface and nothing else — the console and its seven modes, how to expand and collapse it, how to move, how a turn is structured, what the status strip reads out, where the settings and the seed live. It does not script a floor, does not place an enemy, does not gate progress behind a demonstration. It is reachable from the title screen at any time, not only on first play. This keeps the *no hand-authored floors* rule intact and keeps the teaching where the interaction actually is: the rules are conventional d20 and explain themselves; the one-console interaction model is the genuinely unfamiliar thing, and it is the only thing that needs explaining.

**Runs accumulate, they do not overwrite.** There is no single save slot and no undo. Any number of runs live side by side in a library — seed, depth, party, and accent swatch on each row — and a run persists until its party wipes. Then it is gone. You can keep a cautious depth-30 party and a reckless experiment going at once and choose which to open, but you can never step backward inside one. Every descent is a commitment; the only thing you get to choose twice is which run to be in.

**A link that will not load says why.** A truncated fragment, a version mismatch, a failed checksum, a hand-edited blob — each produces a named failure screen rather than a silent reset, because the entire sharing feature depends on a paste surviving a chat client, and a save that fails mutely is indistinguishable from a game that is broken. Where the seed is still readable, the screen offers a fresh run in that same world, which is the part of the state that could never have been corrupted.

**There is no ending.** Depth is infinite and depth is the score. A run resolves exactly one way — the party wipes — and the number it stops at is the whole result. Threshold floors every tenth level are the pacing beats: a guaranteed elite, a guaranteed vault, a theme not yet seen. The question the game asks is not whether you can finish it. It is how far down you got.

**A wipe is a scorecard and a share link.** When the party dies, the run leaves the library and the screen shows what it was: final depth, party roster with sigils, cause of death, seed, and a link — not to the dead run, but to the world. The link carries the seed alone, stripped of state, so a player can hand someone the exact dungeon that killed them. "How far did you get?" is answered by a number; "can you do better?" is answered by a link. This is the one viral surface in the design, and it costs almost nothing because the seed is already in the save state.

---

## Target User

**Primary — the tactical roguelike player.** Knows d20 math, wants positioning and cover to matter, and wants a build to commit to. Currently chooses between installing a desktop client or settling for a shallow browser game. Plays on desktop but reaches for their phone in the gaps. Values: real systems, meaningful failure, no grind between runs.

**Secondary — the tabletop-adjacent player.** Fluent in d20 conventions from tabletop RPGs, curious about roguelikes, unwilling to learn a client or read a manual. Attracted by character creation as a puzzle. Values: legible rules, a build they authored, something they can show a friend.

**Tertiary — the seed-sharer.** Posts runs, compares builds, hunts for exceptional dungeons. Currently has no way to hand someone an exact world. The URL save is the feature they did not know to ask for.

---

## Key Features

1. **The 80-point buy** — one pool across one to four characters; chassis, attributes, equipment, protocols, and sigil all purchased from it. Live readout of points, projected stats, and action economy. Unspent points convert to credits at 10:1.
2. **Infinite procedural depth** — floor N derived from `hash(worldSeed, N)`. Eight archetypes × twelve environment themes × zero-to-two modifiers, with depth-weighted draws and no hand-authored floors.
3. **Validated generation** — every floor must pass connectivity, loop density, interior cover, descent reachability, container accessibility, and open-cell bounds before it is accepted. Failures regenerate with an incremented sub-seed.
4. **Cell-by-cell exploration** — the party is one token on a 20×32 lattice. Eight-way movement with a corner rule, per-cell fog of war in three states, shadowcast line of sight, and auto-stop interrupts on danger, discovery, or damage.
5. **Tactical d20 combat** — 8×16 grid at 2× map zoom, initiative order, one move plus 2 AP per turn, banded range with minimums and extended penalties, edge-crossing cover, flanking, opportunity attacks, and nine conditions.
6. **Six classes with always-on signatures** — Breacher, Ghost, Compiler, Anchor, Oracle, Operator. Class gates equipment, protocols, and sigils, and sets the hit die. Calibrations every third floor form the in-run build arc.
7. **Tech magic as protocols** — four schools (DISRUPT, WARD, SCRY, REWRITE) across five tiers, paid for in CHARGE, capacity-limited by a deck slot. Overclock for a tier of extra effect at double cost and a corruption risk.
8. **Loot with a risk axis** — five rarity tiers and a sixteen-entry affix pool. CORRUPT items are strictly stronger and permanently raise the run's danger clock rate. Corruption is a mechanical cost, not a visual one — it is felt in hunts arriving sooner, not seen in a noisier screen.
9. **The single console** — seven modes, fixed expanded height, complete keyboard parity, complete touch parity. No gameplay affordance exists outside it.
10. **An original sigil typeface** — 72 glyphs drawn for this project in a cyberpunk-mystical idiom, shipped as a self-hosted subsetted WOFF2. Not a licensed subset, not a system fallback. A named deliverable, not a dependency.
11. **Reserved sigil banks** — 48 player glyphs (8 per class, one family per class) and 24 bestiary glyphs, rendered at four fixed scale tiers from 34px to 220px. Enforced by a lint check that bans their use anywhere else in the application.
12. **CRT/VHS presentation** — neon-on-violet palette ported from Universal Operator's Tarot, glow on every element, the `◈` ornament as signature, scanlines, grain, chromatic aberration, and a per-floor accent that re-skins the screen. Effect timings are ported as measured constants, not re-derived by eye.
13. **A dynamic score** — five synthesized layers, zero audio files. Depth sets register, the environment theme sets mode and timbre, hostile proximity drives dissonance and tempo, treasure proximity drives consonance and brightness. Procedural melody with a no-repeat ledger. The three moving layers carry the run's status, since the picture no longer does.
14. **A library of runs** — any number of runs persist side by side in `localStorage`, each autosaving on floor transition and combat resolution, each surviving until its own party wipes. No slot limit, no overwrite, no undo.
15. **The portable save** — full run state in a URL fragment under 1500 characters, reconstructing bit-for-bit on any machine. Malformed links fail to a named diagnostic screen, not a silent reset.
16. **A deliberate front door** — a title screen that loads and sounds nothing until START is pressed, then branches to new run, run library, or link import. A skippable tutorial on first play, declined once and never re-offered.
17. **Depth as the only score** — no win condition, no ending. A run resolves on party wipe, and the depth reached is the entire result. Threshold floors every tenth level pace the descent.
18. **The run-end screen** — on wipe, the run leaves the library and a scorecard appears: final depth, party roster, cause of death, seed, and a share-the-world link (seed only, no state). The one viral surface in the design.
19. **The Echo** — a dead character returns as an enemy wearing their sigil and gear. Capped at two concurrent.
20. **Offline-first** — service worker, cache-first, full play after first load. Under 500 KB total transfer.

---

## Named Deliverable — The Sigil Typeface

The one asset the project draws from scratch. Everything else is synthesized at runtime; this is authored. Detailed acceptance criteria belong in `specs/requirements.md`; this is the brief.

**Working name:** `DESCENT SIGIL`

**Design brief — cyberpunk mystical.** Occult sigil geometry executed as circuit etching. The governing idea is that a summoning seal and a fabrication mask are the same drawing: hard geometric construction, compass-and-straightedge logic, radial and axial symmetry, sealed rings and deliberately broken ones. Forms should read simultaneously as a ward, a rune, a die trace, and a logic gate. Reference vocabulary — planetary and alchemical sigils, trigrams, seals and pentacles, PCB traces, fiducial marks, wafer masks, IC pinouts. Explicitly not: pictographs, creatures, letterforms, weapons, anything representational. A sigil is a mark, not a picture.

**Scope.** 72 glyphs total.

| Bank | Count | Structure |
|---|---|---|
| Player | 48 | Six families of eight, one per class. The family is legible as a family. |
| Bestiary | 24 | Three per enemy archetype. Distinguishable from player forms by construction, not only by color. |

**Family character.** Class identity lives in construction, not decoration: Breacher solid and armored, Ghost sharp and sparse, Compiler branching and recursive, Anchor grounded and symmetrical, Oracle radial and open, Operator hybrid. Bestiary forms are asymmetric, unclosed, or over-dense — wrong in a way the eye catches before the color does.

**Hard constraints.**
- Legible at 34px in the initiative rail; holds weight at 220px in the creation picker. A 6.5× range. Thin, busy, or near-identical forms are disqualified regardless of how good they look large.
- Monospaced, single advance width, optically centered on the em, so one glyph drops into a 108px grid cell without per-glyph nudging.
- Stroke weight tuned for neon bloom — glow closes small counters, so counters run wide and strokes stay even.
- No glyph legible as a Latin letter, digit, or common UI symbol.
- Every player family visually distinct from every bestiary form at 34px. This is the acceptance test, run as a contact sheet.

**Delivery.** Self-hosted subsetted WOFF2, 72 glyphs, target 4–8 KB, inside the 500 KB budget. Mapped to a documented Private Use Area range enumerated in `data/sigils.json` as the single source of truth. Owned by Glitch Forgeworks LLC — no upstream license, no attribution, no redistribution question. Cached by the service worker; renders offline; no CDN and no third-party request. `font-display: block`, because a substituted sigil is worse than a late one.

---

## Non-Goals

**Infrastructure**
- No backend, no server, no accounts, no telemetry, no analytics.
- No build step: no bundler, no transpiler, no npm at runtime. Native ES modules only.
- No third-party runtime dependencies of any kind.

**Assets**
- No sprite art. Everything is drawn with Canvas 2D, SVG, or CSS.
- No audio files. Everything is synthesized with WebAudio.
- **No third-party fonts.** Body and interface type remain system monospace. The one font asset is `DESCENT SIGIL`, drawn for this project and self-hosted — see *Named Deliverable* above. No CDN, no font service, no licensed subset, no third-party request. An asset the project owns that happens to be stored in a font container is not an external dependency.

**Scope**
- No landscape layout. Fixed 1080×1920 portrait, letterboxed on wider displays, full-bleed on phones.
- No permanent meta-progression. No unlocks, no persistent currency, no run-to-run carryover. A run is a run.
- **No vendor nodes.** Credits exist only as the 10:1 conversion of unspent creation points. The 80-point buy is the economy; loot is the progression. Cut from v1 entirely.
- No elevation in combat. The field is flat.
- No hand-authored floors, no scripted narrative, no cutscenes.
- No multiplayer, no leaderboards, no cloud sync. Sharing happens by pasting a link.

**Settings — enumerated and final**
- Master mute.
- Per-layer volume (5 sliders: drone, pulse, sparkle, lead, noise bed).
- Glitch toggle (disables all glitch effects).
- Reduced-motion override (respects `prefers-reduced-motion` automatically; this is a manual override for either direction).
- Scanline / grain toggle (independent of the glitch toggle; some players want the CRT frame without the texture).

**Boundaries this document does not cross**
- No stack, framework, or module-loading decision beyond the buildless/ES-modules constraint the owner set. That is Architect's call.
- No screen layout beyond the structural zones already fixed by the lattice. That is Designer's call.
- No schema for the save struct or the data files. That is DB's call.

---

## Open Questions

**1. Typeface scope creep.** *(decide before the typeface work starts)*
Once the project is drawing a font, the display and title type become candidates for it too — and a matching set of caps would tie the whole screen together. Against that: the interface currently gets its texture free from system monospace, a display alphabet is 40+ more glyphs of work, and the `◈` ornament already carries the branding. Recommendation is to hold the line at 72 sigils for v1 and revisit only if the ported tarot type reads as borrowed.

**2. Where the sigils get authored.** *(blocks M5)*
The glyphs are drawn as vector outlines and compiled to WOFF2, which is a tooling decision with no runtime footprint — the shipped artifact is a static file either way. Worth naming early so the contact-sheet test has somewhere to live. Not a blocker for anything before M5.

**3. Console occlusion.** *(validate at M1 against the combat mock)*
The expanded console overlays the playfield, leaving a 1024px visible band with auto-pan. Is that enough field to make a targeting decision on a 16-deep grid without panning? The alternative is scaling the playfield down instead of overlaying it.

**4. Solo-build balance.** *(playtest gate at M5, before the item table is locked)*
Seventy-five points on one character produces enormous per-unit numbers against a hard 2-AP ceiling and single-target enemy focus. Hostile count scaling already punishes it. Likely additional lever: weight Choir and Null enemies toward solo runs.

**5. Corruption curve.** *(instrument at M7)*
0.05 per failed overclock plus implant baselines may reach the 0.5 danger-clock threshold too early on caster-heavy parties. Needs distribution data across 50 simulated runs before tuning.

**6. Retreat value.** *(balance pass at M10)*
Forfeiting all encounter loot may make retreating strictly worse than dying and restarting on a fast seed. Consider a partial salvage roll on a successful retreat.

**7. Protocol capacity versus purchase cost.** *(verify at M7)*
At `tier × 2`, a Deep Deck plus two tier-3 protocols consumes 18 of 80 points for a single character. Confirm this reads as a real choice rather than a trap.

---

## Resolved

| Question | Resolution |
|---|---|
| Grid orientation | Portrait. 8 wide × 16 deep at 108px cells. |
| Death and continuation | Party wipe ends the run. No meta-progression, no continue. Echoes are the only afterlife, and they live in the save state — deterministic given a link, not derivable from a bare seed. Capped at 2 concurrent. |
| Vendors | Cut from v1. Credits remain only as the unspent-points conversion. |
| Glyph coverage | Ship a self-hosted, subsetted WOFF2 of the 72 sigil glyphs. Guarantees identical rendering on every device, preserving the share-link contract. No runtime substitution, no coverage check, no tofu. The only permitted font asset; all other type is system monospace. |
| Sigil sourcing | **Draw them.** `DESCENT SIGIL` is an original cyberpunk-mystical typeface authored for this project — 72 glyphs, 48 player across six class families, 24 bestiary — not a licensed subset and not a system fallback. Promoted to a named deliverable with its own section and its own acceptance test. Owned outright by Glitch Forgeworks LLC. |
| Touch targets | Phones are first-class, not a consequence. 48px minimum hit height on every console row, and tap-to-select with a confirm step on the combat grid. In scope for v1, not deferrable. **[AMENDED 2026-08-25 via touch-target-density-pass — floor lowered from 96px to 48px by owner directive.]** |
| Glitch model | **Constant, not driven.** No `glitchLevel`, no inputs, no ramp with depth, no spike at low HP, no discrete triggers. Every effect is a fixed constant fired by a free-running timer. Ported from the tarot, where the computed intensity is never read and every effect is a hardcoded literal. Supersedes the driven-meter model in the source requirements §14. |
| Glitch and status | Status is carried by accent color and by the three audio layers that move (drone, pulse, sparkle). Not by the picture. Consequence: `prefers-reduced-motion` costs no information, and no status readout in the strip is needed to compensate. |
| Authored transitions | The one exception to constant glitch. Boot, descent, and death are scripted set-pieces with fixed timelines that fire on an event and run a known length. They are animations, not a meter. |
| Character substitution | Draws only from an enumerated safe pool (Latin, digits, box-drawing) declared in `data/sigils.json`. Sigils are never substituted — split, invert, and noise-degrade only, never a codepoint swap. |
| Audio noise bed | Fixed level. Tape hiss, wow, and flutter are machine properties, not readouts. Only drone, pulse, and sparkle modulate. |
| Corruption | A mechanical cost only — danger clock rate. No visual consequence, since glitch takes no inputs. |
| Title screen | The game opens on a title screen and loads, plays, and generates nothing until START is pressed. Doubles as the browser's required audio gesture. Branches to new run, run library, or link import. |
| Tutorial | A manual, not a level. Teaches the console, its seven modes, movement, turn structure, the status strip, settings, and the seed. Never scripts a floor or places an enemy, so *no hand-authored floors* holds. Skippable in one press, remembered, never re-offered unasked, always reachable from the title screen. |
| Save model | No slots, no rollback, no undo. Any number of runs persist side by side in a library; each survives until its own party wipes. |
| Malformed links | Named failure screens with a stated reason — truncated, version mismatch, checksum failure, malformed. Never a silent reset. Where the seed is still readable, offer a fresh run in that world. |
| Win condition | None. Depth is infinite and depth is the score. A run resolves exactly one way: party wipe. |
| Run-end screen | On wipe, the run leaves the library and a scorecard appears — final depth, party roster with sigils, cause of death, seed, and a share-the-world link (seed only, no state). The one viral surface in the design. |
| Settings | Master mute · per-layer volume ×5 · glitch toggle · reduced-motion override · scanline/grain toggle. Final and enumerated. |
