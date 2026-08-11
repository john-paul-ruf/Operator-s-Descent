#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
SIGILS = ROOT / 'data' / 'sigils.json'
RECIPES = ROOT / 'font-src' / 'glyphs.json'
OUT = ROOT / 'assets' / 'descent-sigil.woff2'
EM = 1000
ADVANCE = 1000
ASCENT = 850
DESCENT = -150
SAFE_MIN = 120
SAFE_MAX = 880
CENTER = 500


def load_json(path):
    return json.loads(path.read_text())

def bank_codepoints(sigils):
    player = [cp for group in sigils['playerBank']['families'].values() for cp in group['codepoints']]
    bestiary = [cp for group in sigils['bestiaryBank']['archetypes'].values() for cp in group['codepoints']]
    safe = set()
    for values in sigils['safeSubstitutionPool'].values():
        safe.update(values)
    if len(player) != 48 or len(set(player)) != 48:
        raise SystemExit('expected exactly 48 unique player glyph codepoints')
    if len(bestiary) != 24 or len(set(bestiary)) != 24:
        raise SystemExit('expected exactly 24 unique bestiary glyph codepoints')
    if set(player) & set(bestiary):
        raise SystemExit('player and bestiary banks overlap')
    if safe & (set(player) | set(bestiary)):
        raise SystemExit('safe substitution pool intersects sigil banks')
    return player, bestiary

def glyph_name(cp):
    return f'uni{cp:04X}'

def contour(pen, points):
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()

def rect(pen, x0, y0, x1, y1):
    contour(pen, [(round(x0), round(y0)), (round(x1), round(y0)), (round(x1), round(y1)), (round(x0), round(y1))])

def stroke(pen, angle_deg, offset, length, width):
    a = math.radians(angle_deg)
    dx, dy = math.cos(a), math.sin(a)
    nx, ny = -dy, dx
    cx = CENTER + nx * offset
    cy = CENTER + ny * offset
    hx, hy = dx * length / 2, dy * length / 2
    wx, wy = nx * width / 2, ny * width / 2
    contour(pen, [
        (round(cx - hx - wx), round(cy - hy - wy)),
        (round(cx + hx - wx), round(cy + hy - wy)),
        (round(cx + hx + wx), round(cy + hy + wy)),
        (round(cx - hx + wx), round(cy - hy + wy)),
    ])

def arc_segment(pen, radius, width, start_deg, sweep_deg, steps=12):
    outer = []
    inner = []
    for i in range(steps + 1):
        a = math.radians(start_deg + sweep_deg * i / steps)
        outer.append((round(CENTER + math.cos(a) * (radius + width / 2)), round(CENTER + math.sin(a) * (radius + width / 2))))
    for i in range(steps, -1, -1):
        a = math.radians(start_deg + sweep_deg * i / steps)
        inner.append((round(CENTER + math.cos(a) * (radius - width / 2)), round(CENTER + math.sin(a) * (radius - width / 2))))
    contour(pen, outer + inner)

def node(pen, angle_deg, radius, size, kind):
    a = math.radians(angle_deg)
    cx = CENTER + math.cos(a) * radius
    cy = CENTER + math.sin(a) * radius
    if kind == 'diamond':
        contour(pen, [(round(cx), round(cy + size)), (round(cx + size), round(cy)), (round(cx), round(cy - size)), (round(cx - size), round(cy))])
    else:
        rect(pen, cx - size, cy - size, cx + size, cy + size)

def draw_recipe(recipe):
    pen = TTGlyphPen(None)
    for ring in recipe.get('rings', []):
        gaps = ring.get('gaps', [])
        if not gaps:
            arc_segment(pen, ring['radius'], ring['width'], 0, 360, 24)
        else:
            cursor = 0
            for start, end in sorted(gaps):
                if start > cursor:
                    arc_segment(pen, ring['radius'], ring['width'], cursor, start - cursor, max(4, int((start - cursor) / 18)))
                cursor = end
            if cursor < 360:
                arc_segment(pen, ring['radius'], ring['width'], cursor, 360 - cursor, max(4, int((360 - cursor) / 18)))
    for s in recipe.get('strokes', []):
        stroke(pen, s['angle'], s.get('offset', 0), s['length'], s['width'])
    for b in recipe.get('bars', []):
        rect(pen, CENTER + b['x'] - b['w'] / 2, CENTER + b['y'] - b['h'] / 2, CENTER + b['x'] + b['w'] / 2, CENTER + b['y'] + b['h'] / 2)
    for n in recipe.get('nodes', []):
        node(pen, n['angle'], n['radius'], n['size'], n.get('kind', 'square'))
    return pen.glyph()

def build(check=False):
    sigils = load_json(SIGILS)
    player, bestiary = bank_codepoints(sigils)
    recipes_data = load_json(RECIPES)
    recipes = recipes_data['glyphs']
    expected = player + bestiary
    actual = [g['codepoint'] for g in recipes]
    if actual != expected:
        raise SystemExit('glyph recipe order/codepoints must match data/sigils.json banks')
    if len({g['id'] for g in recipes}) != 72:
        raise SystemExit('glyph recipe IDs must be unique')

    glyph_order = ['.notdef'] + [glyph_name(cp) for cp in expected]
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap({cp: glyph_name(cp) for cp in expected})
    notdef = TTGlyphPen(None)
    rect(notdef, 180, 180, 820, 220)
    rect(notdef, 180, 780, 820, 820)
    rect(notdef, 180, 180, 220, 820)
    rect(notdef, 780, 180, 820, 820)
    glyphs = {'.notdef': notdef.glyph()}
    signatures = set()
    for recipe in recipes:
        glyph = draw_recipe(recipe['recipe'])
        if not glyph.coordinates:
            raise SystemExit(f"empty outline for {recipe['id']}")
        xs = [p[0] for p in glyph.coordinates]
        ys = [p[1] for p in glyph.coordinates]
        if min(xs) < SAFE_MIN or max(xs) > SAFE_MAX or min(ys) < SAFE_MIN or max(ys) > SAFE_MAX:
            raise SystemExit(f"outline outside safe bounds for {recipe['id']}")
        sig = tuple((p[0], p[1]) for p in glyph.coordinates)
        if sig in signatures:
            raise SystemExit(f"duplicate outline coordinates for {recipe['id']}")
        signatures.add(sig)
        glyphs[glyph_name(recipe['codepoint'])] = glyph
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({name: (ADVANCE, 0) for name in glyph_order})
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=abs(DESCENT), achVendID='GFWK')
    fb.setupNameTable({
        'familyName': 'DESCENT SIGIL',
        'styleName': 'Regular',
        'uniqueFontIdentifier': 'Glitch Forgeworks LLC DESCENT SIGIL Regular 1.0',
        'fullName': 'DESCENT SIGIL Regular',
        'psName': 'DESCENTSIGIL-Regular',
        'version': 'Version 1.000; original Glitch Forgeworks LLC outline recipes',
        'manufacturer': 'Glitch Forgeworks LLC',
        'designer': 'Glitch Forgeworks LLC',
        'description': 'Original 72-glyph Operator\'s Descent sigil typeface.',
        'licenseDescription': 'Project-owned asset for Operator\'s Descent.',
    })
    fb.setupPost()
    font = fb.font
    font.flavor = 'woff2'
    font['head'].created = 0
    font['head'].modified = 0
    if check:
        return font
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUT, reorderTables=True)
    print(f'wrote {OUT} ({OUT.stat().st_size} bytes)')

if __name__ == '__main__':
    build(check='--check' in sys.argv)
