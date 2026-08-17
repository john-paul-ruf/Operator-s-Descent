# DESCENT SIGIL Review Notes

## SESSION-29 — Breacher and Ghost

- **Breacher motif**: sealed armored disks, doubled frames, blunt crossbars, high-mass counters, and square/diamond lock nodes. The eight marks vary by internal topology: cross core, diagonal bracing, split horizontal rails, double-ring X, broken vertical armor, skew radial plate, tri-spoke seal, and paired vertical gates.
- **Ghost motif**: sparse broken arcs, displaced axes, needle traces, small off-axis terminals, and wide negative space. The eight marks intentionally avoid closed emblems, arrows, close icons, digits, and Latin silhouettes.
- **34px proof**: `/tmp/session29-proof-34.png` reviewed locally with glow; Breacher reads as a heavy closed family while Ghost reads as a sparse broken family. Ghost 3/7 are the closest low-resolution pair because both emphasize angled needles, but their ring breaks and terminal placement remain separable.
- **220px proof**: `/tmp/session29-proof-220.png` reviewed locally; no empty glyphs, obvious contour defects, or unintended Latin/common-control silhouettes were observed.
- **Rejected collisions**: avoided triangle arrowheads for Ghost terminals and shield-like Breacher outlines; retained circular ward frames to keep the cyberpunk-mystical construction vocabulary consistent with the baseline bank.

## SESSION-30 — Compiler and Anchor

- **Compiler motif**: recursive branch traces, nested returns, small circuit nodes, and interrupted rings. The eight marks vary by fork count, nested loops, split trunks, and lateral returns while avoiding tree, network-icon, Latin, and UI-control silhouettes.
- **Anchor motif**: axial stems, bilateral bracing, grounded lower rails, and low visual centers. The eight marks avoid literal nautical anchors, arrows, houses, scales, and Latin letters by using circular ward fragments plus symmetric footing instead of pictorial hooks.
- **34px proof**: `/tmp/session30-proof-34.png` reviewed locally with Breacher/Ghost/Compiler/Anchor in monochrome rows. Breacher reads heavy/closed, Ghost sparse/broken, Compiler branching/trace-like, Anchor grounded/symmetric before labels.
- **220px proof**: `/tmp/session30-proof-220.png` reviewed locally for Compiler/Anchor. Cross-family collision resolved by moving Anchor stabilizer rails to the visual lower half; the first pass looked too top-bar/T-like at 34px.
- **Rejected collisions**: removed top-heavy Anchor bars that suggested Latin `T`; avoided Compiler arrowheads and tree silhouettes by using open circuit returns and mixed branch angles.

## SESSION-31 — Oracle and Operator

- **Oracle motif**: open radial arrays, incomplete halos, offset sight lines, and spacious apertures. The family remains observational without literal eyes, stars, targets, crosshairs, status icons, letters, or digits.
- **Operator motif**: hybrid grammar with a consistent organizing spine: each mark combines a ring fragment, trace return, branch, grounded rail, and open aperture while avoiding a miscellaneous catch-all feel.
- **Full player-bank 34px audit**: `/tmp/session31-player-bank-34.png` reviewed locally without color/family labels. Six rows classify as Breacher heavy/closed, Ghost sparse/broken, Compiler branching, Anchor grounded, Oracle open/radial, Operator hybrid/spined.
- **220px proof**: `/tmp/session31-proof-220.png` reviewed locally for Oracle/Operator large-scale contour quality before the final Operator collision changes; the WOFF2 verifier then rechecked nonempty unique outlines after those changes.
- **Resolved collisions**: Operator 2 initially read too close to a Latin `A`, and Operator 4 too close to a close/X control; both were redrawn with offset spines and lateral returns instead of triangular or crossed cores.
- **Contact-sheet risks**: Oracle and Ghost are both intentionally sparse. Oracle keeps stronger radial grouping and multiple halo fragments; Ghost keeps displaced broken arcs and needle traces. Recheck this pair in SESSION-34 at 34px contact-sheet scale.

## SESSION-32 — Drone, Warden, Stalker, Choir

- **Drone trio**: repeated incomplete swarm cells, displaced short traces, and small scattered nodes. Each mark is asymmetric and unfinished rather than a player-family seal.
- **Warden trio**: dense broken barriers, offset vertical/horizontal slabs, and heavy interrupted enclosures. The grammar is over-built and obstructive without using shield icons.
- **Stalker trio**: off-axis pursuit lines, hooked interruptions, and unbalanced trailing bars. The silhouettes avoid claws/arrows by keeping hooks as circuit breaks rather than pointed pictographs.
- **Choir trio**: clustered resonance nodes, overlaid halos, and layered short traces. The density comes from node clusters rather than musical-note or face imagery.
- **Player/bestiary comparison**: `/tmp/session32-player-bestiary-34.png` reviewed locally in monochrome with identical glow. The first twelve bestiary marks classify as more asymmetric, broken, or over-dense than the six player families.
- **Corrected ambiguity**: Warden marks were kept dense but visibly broken so they do not collapse into Anchor's stable bilateral footing at 34px.

## SESSION-33 — Null, Construct, Phantom, Apex

- **Null trio**: cancelled rings, missing cores, hostile void gaps, and short cancellation bars. The trio uses absence and interruption rather than extra decoration.
- **Construct trio**: over-dense fabrication grids, misaligned frames, and slab returns. The forms are machine-like without becoming logos, boxes, or UI icons.
- **Phantom trio**: displaced double halos, unresolved contours, and offset echo traces. The doubles are structurally shifted instead of color/shadow effects.
- **Apex trio**: aggressive compound asymmetry, heavy crossing traces, and imbalanced nodes. The marks are more forceful than other enemies without drawing weapons, creatures, arrows, or warning signs.
- **All-72 audit**: `/tmp/session33-all-72-34.png` reviewed locally in monochrome with identical glow. Bestiary forms remain more asymmetric, unclosed, displaced, or over-dense than the player bank.
- **Held for SESSION-34**: Apex and Construct are intentionally dense and should be checked for counter fill-in on the generated 34px contact sheet. Oracle/Ghost sparsity remains the main player-family comparison risk.

## SESSION-34 — Acceptance Contact Sheet

- **Metrics**: 1000 UPM, fixed 1000 advance, hhea ascent 850/descent -150/line gap 0, fixed-pitch post flag set. All 72 encoded glyphs share the same advance and remain within safe outline bounds.
- **Artifact**: final SESSION-34 WOFF2 is 7,916 bytes, inside the 4–8 KB acceptance target. The compiler now uses lower-resolution deterministic arc construction to reduce bytes while preserving 34px silhouettes.
- **Contact sheet**: `./docs/sigil-contact-sheet.html` and `./docs/sigil-contact-sheet.css` provide labeled 34px and 220px monochrome plus production-glow views. Browser inspection over `http://127.0.0.1:4173/docs/sigil-contact-sheet.html` completed; screenshot proof was saved at `/tmp/session34-contact-sheet.png`.
- **Acceptance disposition**: all 72 glyphs are nonempty, mapped from `./data/sigils.json`, visibly grouped by family/archetype, and distinguish player from bestiary construction without relying on red. No conscious limitation remains for SESSION-34.

## control-and-polish SESSION-04 — Rev 2 (owner directive: "redo all the woff sigals, they are gross")

- **Verdict on execution, not taxonomy**: family and archetype grammar established across SESSIONs 29–34 was preserved. What changed is the geometry: the four-primitive compiler (rings-with-gaps, radial strokes, axis-aligned bars, square/diamond nodes) drew everything as boxy plus-signs; the extended grammar adds vocabulary the recipes actually needed.
- **Compiler grammar additions (schema-additive)**: `arcs` (per-arc `cx`/`cy` offset — asymmetric halos), `bars.angle` (rotated/chamfered rectangles about the bar's own center), `traces` (width-stroked polylines emitted as one rotated rectangle per segment — circuit branches that aren't center-radial), `rings.cx`/`rings.cy` (off-origin full rings), and two new node kinds: `circle` (8-sided regular polygon, deterministic integer coords) and `tick` (short bar oriented tangential to the placement radius). Old recipes still parse — every new field is optional with the prior default.
- **Determinism**: preserved via low-resolution integer-friendly arc construction (`steps` default 6 for offset arcs, 10 for full rings) and rotated rectangles built from `round(cos/sin)` — `python3 tools/font/build_font.py --check-deterministic` builds twice and compares bytes.
- **Motifs per family (rev 2 craft goals)**:
  - **Breacher (8)** — thick closed outer ring (radius 258–286, width 50–74); bold cross/X strokes; chamfered rotated bar cores; heavy square/diamond corner locks. Reads sealed and armored.
  - **Ghost (8)** — one thin broken outer arc (2–3 wide gaps); polyline needle traces displaced off-axis; small ticks/diamonds; wide negative space. Reads unfinished and sparse.
  - **Compiler (8)** — sparsely broken outer ring; polyline traces forming L-branches, forks, and cascades; small circle nodes as junction dots. Reads as circuit routing, not radial.
  - **Anchor (8)** — vertical stem stroke, heavy ground beam at y ≈ −240, bilateral bracing; optional inner nested ring or secondary rail; grounded low. Reads as a footed pillar (⊥-family), never Latin T.
  - **Oracle (8)** — one to four offset arc halos around off-center points; sparse radial strokes; tick/circle sight nodes. Reads open and observational.
  - **Operator (8)** — every mark carries the same five voices: broken ring fragment, polyline return, secondary branch or halo, grounded rail, and one node accent. Reads hybrid without collapsing into "generic".
- **Motifs per bestiary archetype (rev 2 craft goals)**:
  - **Drone (3)** — clusters of 3–5 small offset arcs (swarm cells) plus a short trace between two; asymmetric distribution.
  - **Warden (3)** — thick broken outer ring plus heavy interrupted slabs (some rotated); dense but visibly fractured.
  - **Stalker (3)** — long hooked polyline traces with sharp direction changes; off-axis trailing bar; broken ring on the "watched" side.
  - **Choir (3)** — heavy central circle plus a clustered lattice of smaller circles; multiple overlapping halo arcs.
  - **Null (3)** — heavily gapped ring plus one or two long slash bars crossing the negative center; absence-based.
  - **Construct (3)** — over-dense rotated frame stacks and grids; misaligned rectangles; slab returns.
  - **Phantom (3)** — two or three displaced arc halos rendered with the same radius from slightly-offset centers; echo pattern.
  - **Apex (3)** — heavy crossing strokes/traces plus a dominant off-corner mass; compound asymmetry.
- **Collision checks performed** (bank vs. Latin/digit/box-drawing/UI icons; cross-family at 34px):
  - Anchor's stem-on-baseline motif inverts Latin T (bar on the *lower* side) — reads as ⊥, not T. Retained.
  - Compiler 7's spine + two lateral branches offsets the branches vertically (y = ±90, opposite sides) rather than the symmetric H layout.
  - Compiler 8's four-corner routes converge on a central circle rather than crossing at a bare X.
  - Null n1's cancel-cross is contained inside a broken outer ring rather than reading as a stand-alone X.
  - Bestiary and player Compiler both use circle nodes; bestiary bank keeps asymmetric arc distributions to remain classifiable at 34px.
  - Ghost and Oracle stay separable via ring topology: Ghost keeps one broken outer arc; Oracle drops the outer ring in favor of multiple *offset* halos.
- **Byte size**: WOFF2 rebuilt at 6,988 bytes (rev 1 was 7,916 bytes) — 4–8 KB acceptance range preserved with ~1.2 KB headroom for future tweaks.
- **Contact sheet**: `./docs/sigil-contact-sheet.html` and `./docs/sigil-contact-sheet.css` render all 72 rev-2 glyphs at 34px (mono + glow) and 220px (mono + glow). A rev-2 subtitle line highlights the new primitive grammar so the reviewer can eyeball each family's identity against the motif list above. Served locally via `PORT=8081 HOST=127.0.0.1 node scripts/server.js` and inspected at `http://127.0.0.1:8081/docs/sigil-contact-sheet.html` (all four sections return 200; font cmap and glyph outlines verified deterministic before browser inspection).
- **Known risk pairs held for owner sign-off at 34px**: Ghost 3 vs Ghost 7 (both use zigzag traces — differ in the ring's third gap and the trace's turn count); Compiler 3 vs Operator 4 (both use L-brackets — Compiler 3 owns the nested inner ring while Operator 4 pairs the bracket with the anchor-style ground rail); Phantom ph2 vs Oracle o1 (three overlapping arcs — Phantom stacks identical-radius arcs from three collinear centers, Oracle spreads unequal-radius halos in different angular ranges). Owner sign-off requested per the session prompt — glyph taste is the point.

## control-and-polish REPAIR-02 — Rev 2.1 (owner sign-off feedback: "fonts are not centered")

- **Root cause, numerical**: `tools/font/build_font.py` used a single `CENTER = 500` for both x and y coordinates when mapping recipe geometry into the em-box. Correct only for x (advance 1000, geometric middle 500). Wrong for y — with ASCENT=850 and DESCENT=-150 the em-box optical center sits at (850 + -150)/2 = **350**, not 500. A per-glyph bbox audit against the em-box optical center confirmed the defect was systemic across the whole bank: **AVG dy = +152.5 units, MAX |dy| = 192, worst dy = 192 (apex_2)**. Every glyph rode ~150 units above the em-box middle (~5.1 px at the 34 px contact-sheet size). Presentation layer (`docs/sigil-contact-sheet.html`/`.css`) was correct — `place-items: center` centers the line-box, but the line-box maps ASCENT..DESCENT so the geometry offset showed through unchanged.
- **Fix, geometry layer**: split `CENTER` into `CENTER_X = 500` (unchanged) and `CENTER_Y = 401` in the compiler. Stroke/bar/ring/trace/node/arc helpers and `draw_recipe` all use the split; safe bounds split into `SAFE_X_MIN/MAX = 120/880` (unchanged) and `SAFE_Y_MIN/MAX = 100/900`; `.notdef` re-centered on the new y-center. Recipes untouched — the "y = 0 is drawing center" semantic in the recipe grammar now maps ~99 units lower into the em-box, so every glyph shifts down 99 units without any change to family craft or grammar.
- **After-fix audit**: **AVG dy = +53.5 units** (65 % reduction, ~1.8 px at 34 px), whole-bank y-range = [100, 703] — exactly at the verifier's lower bound. Anchor family bbox center is now ~349 (essentially on the em-box optical center 350); its grounded intent survives via internal composition (heavy ground beam at y ≈ 130, pillar rising to y ≈ 600) — not via a whole-glyph vertical offset.
- **Residual and remaining work (out-of-lease blocker)**: the full fix targets `CENTER_Y = 350` (em-box optical center exactly, AVG |dy| ≈ 0). That would push several glyph bboxes as low as y ≈ 49, below the hardcoded `bounds[1] < 100` guard at `scripts/verify-font.py:51` (which encodes the same "glyphs live around y = 500" assumption the compiler used before this repair). `scripts/verify-font.py` is outside this REPAIR-02 lease, so `CENTER_Y` was clamped to the largest downshift the verifier accepts (Δ = −99 → `CENTER_Y = 401`). To close the residual 53-unit / ~1.8-px offset, a follow-up must relax `scripts/verify-font.py:51` to allow Y-bounds ~[-30, 730] (or `[SAFE_Y_MIN, SAFE_Y_MAX]` derived from the compiler), then move `CENTER_Y` in `tools/font/build_font.py` from 401 to 350 and re-run `build_font.py` + `verify-font.py`. No recipe changes required.
- **Verification**: `python3 tools/font/build_font.py --check-deterministic` → 7000 bytes deterministic; `python3 scripts/verify-font.py` → 72 glyphs / advance 1000 / WOFF2 7000 bytes; `node scripts/lint-sigils.js` → pass; `node scripts/verify-assets.js` → pass; contact sheet at http://127.0.0.1:8081/docs/sigil-contact-sheet.html eyeballed at 34 px + 220 px, mono + glow. Byte size 7000 bytes (rev 2 was 6988) — headroom preserved within the 4–8 KB acceptance range.
- **Cache**: font bytes changed → `service-worker.js` `CACHE_VERSION` bumped to `2026-08-16-control-and-polish-v2`. Returning clients refetch the WOFF2.
