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
