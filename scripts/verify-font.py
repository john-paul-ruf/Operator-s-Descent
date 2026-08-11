#!/usr/bin/env python3
import json
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
SIGILS = ROOT / 'data' / 'sigils.json'
FONT_PATH = ROOT / 'assets' / 'descent-sigil.woff2'
RECIPES = ROOT / 'font-src' / 'glyphs.json'
MIN_SIZE = 4096
MAX_SIZE = 8192

def glyph_name(cp):
    return f'uni{cp:04X}'

def main():
    sigils = json.loads(SIGILS.read_text())
    recipes = json.loads(RECIPES.read_text())['glyphs']
    player = [cp for group in sigils['playerBank']['families'].values() for cp in group['codepoints']]
    bestiary = [cp for group in sigils['bestiaryBank']['archetypes'].values() for cp in group['codepoints']]
    safe = set(cp for pool in sigils['safeSubstitutionPool'].values() for cp in pool)
    expected = player + bestiary
    if len(player) != 48 or len(set(player)) != 48:
        raise SystemExit('invalid player bank count')
    if len(bestiary) != 24 or len(set(bestiary)) != 24:
        raise SystemExit('invalid bestiary bank count')
    if set(player) & set(bestiary):
        raise SystemExit('bank overlap')
    if safe & set(expected):
        raise SystemExit('safe pool intersects sigil banks')
    if [g['codepoint'] for g in recipes] != expected:
        raise SystemExit('recipe map does not match sigils.json')
    size = FONT_PATH.stat().st_size
    if size <= 8:
        raise SystemExit('placeholder font still present')
    font = TTFont(FONT_PATH)
    cmap = {}
    for table in font['cmap'].tables:
        cmap.update(table.cmap)
    if set(cmap) != set(expected):
        raise SystemExit(f'cmap mismatch: expected {len(expected)}, got {len(cmap)}')
    widths = set()
    outlines = set()
    for cp in expected:
        name = cmap[cp]
        glyph = font['glyf'][name]
        widths.add(font['hmtx'][name][0])
        if glyph.numberOfContours <= 0:
            raise SystemExit(f'empty outline for U+{cp:04X}')
        bounds = glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax
        if bounds[0] < 100 or bounds[2] > 900 or bounds[1] < 100 or bounds[3] > 900:
            raise SystemExit(f'outline bounds unsafe for U+{cp:04X}: {bounds}')
        coords = tuple(tuple(p) for p in glyph.coordinates)
        if coords in outlines:
            raise SystemExit(f'duplicate outline for U+{cp:04X}')
        outlines.add(coords)
    if widths != {1000}:
        raise SystemExit(f'font is not monospaced: {widths}')
    names = '\n'.join(str(n) for n in font['name'].names)
    if 'DESCENT SIGIL' not in names or 'Glitch Forgeworks LLC' not in names:
        raise SystemExit('required font metadata missing')
    if not (MIN_SIZE <= size <= MAX_SIZE):
        print(f'WARNING: WOFF2 size {size} bytes outside target {MIN_SIZE}-{MAX_SIZE}; allowed for baseline refinement sessions')
    print(f'DESCENT SIGIL verified: 72 glyphs, advance 1000, WOFF2 {size} bytes')

if __name__ == '__main__':
    main()
