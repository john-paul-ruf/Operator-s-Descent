#!/usr/bin/env python3
import io
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
CENTER_X = 500
CENTER_Y = 401
SAFE_X_MIN = 120
SAFE_X_MAX = 880
SAFE_Y_MIN = 100
SAFE_Y_MAX = 900


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

def rotated_rect(pen, cx, cy, length, width, angle_deg):
    a = math.radians(angle_deg)
    dx, dy = math.cos(a), math.sin(a)
    nx, ny = -dy, dx
    hx, hy = dx * length / 2, dy * length / 2
    wx, wy = nx * width / 2, ny * width / 2
    contour(pen, [
        (round(cx - hx - wx), round(cy - hy - wy)),
        (round(cx + hx - wx), round(cy + hy - wy)),
        (round(cx + hx + wx), round(cy + hy + wy)),
        (round(cx - hx + wx), round(cy - hy + wy)),
    ])

def stroke(pen, angle_deg, offset, length, width):
    a = math.radians(angle_deg)
    nx, ny = -math.sin(a), math.cos(a)
    cx = CENTER_X + nx * offset
    cy = CENTER_Y + ny * offset
    rotated_rect(pen, cx, cy, length, width, angle_deg)

def bar(pen, x, y, w, h, angle_deg=0):
    cx = CENTER_X + x
    cy = CENTER_Y + y
    if angle_deg == 0:
        rect(pen, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    else:
        rotated_rect(pen, cx, cy, w, h, angle_deg)

def arc_segment(pen, cx, cy, radius, width, start_deg, sweep_deg, steps=8):
    outer = []
    inner = []
    for i in range(steps + 1):
        a = math.radians(start_deg + sweep_deg * i / steps)
        outer.append((round(cx + math.cos(a) * (radius + width / 2)), round(cy + math.sin(a) * (radius + width / 2))))
    for i in range(steps, -1, -1):
        a = math.radians(start_deg + sweep_deg * i / steps)
        inner.append((round(cx + math.cos(a) * (radius - width / 2)), round(cy + math.sin(a) * (radius - width / 2))))
    contour(pen, outer + inner)

def ring(pen, radius, width, gaps=None, cx=None, cy=None):
    if cx is None:
        cx = CENTER_X
    if cy is None:
        cy = CENTER_Y
    gaps = gaps or []
    if not gaps:
        arc_segment(pen, cx, cy, radius, width, 0, 360, 10)
        return
    cursor = 0
    for start, end in sorted(gaps):
        if start > cursor:
            arc_segment(pen, cx, cy, radius, width, cursor, start - cursor, max(3, int((start - cursor) / 36)))
        cursor = end
    if cursor < 360:
        arc_segment(pen, cx, cy, radius, width, cursor, 360 - cursor, max(3, int((360 - cursor) / 36)))

def trace(pen, points, width):
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        if length == 0:
            continue
        angle_deg = math.degrees(math.atan2(dy, dx))
        cx = CENTER_X + (x0 + x1) / 2
        cy = CENTER_Y + (y0 + y1) / 2
        rotated_rect(pen, cx, cy, length, width, angle_deg)

def node(pen, angle_deg, radius, size, kind='square'):
    a = math.radians(angle_deg)
    cx = CENTER_X + math.cos(a) * radius
    cy = CENTER_Y + math.sin(a) * radius
    if kind == 'diamond':
        contour(pen, [(round(cx), round(cy + size)), (round(cx + size), round(cy)), (round(cx), round(cy - size)), (round(cx - size), round(cy))])
    elif kind == 'circle':
        pts = []
        for i in range(8):
            t = math.radians(360 * i / 8 + 22.5)
            pts.append((round(cx + math.cos(t) * size), round(cy + math.sin(t) * size)))
        contour(pen, pts)
    elif kind == 'tick':
        thickness = max(8, int(size * 0.6))
        rotated_rect(pen, cx, cy, size * 2, thickness, angle_deg + 90)
    else:
        rect(pen, cx - size, cy - size, cx + size, cy + size)

def draw_recipe(recipe):
    pen = TTGlyphPen(None)
    for r in recipe.get('rings', []):
        ring(pen, r['radius'], r['width'], r.get('gaps'), CENTER_X + r.get('cx', 0), CENTER_Y + r.get('cy', 0))
    for a in recipe.get('arcs', []):
        arc_segment(pen, CENTER_X + a.get('cx', 0), CENTER_Y + a.get('cy', 0), a['radius'], a['width'], a['start'], a['sweep'], a.get('steps', 6))
    for s in recipe.get('strokes', []):
        stroke(pen, s['angle'], s.get('offset', 0), s['length'], s['width'])
    for b in recipe.get('bars', []):
        bar(pen, b['x'], b['y'], b['w'], b['h'], b.get('angle', 0))
    for t in recipe.get('traces', []):
        trace(pen, t['points'], t['width'])
    for n in recipe.get('nodes', []):
        node(pen, n['angle'], n['radius'], n['size'], n.get('kind', 'square'))
    return pen.glyph()

def create_font():
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
    notdef_bot = CENTER_Y - 300
    notdef_top = CENTER_Y + 300
    rect(notdef, 180, notdef_bot, 820, notdef_bot + 40)
    rect(notdef, 180, notdef_top - 40, 820, notdef_top)
    rect(notdef, 180, notdef_bot, 220, notdef_top)
    rect(notdef, 780, notdef_bot, 820, notdef_top)
    glyphs = {'.notdef': notdef.glyph()}
    signatures = set()
    for recipe in recipes:
        glyph = draw_recipe(recipe['recipe'])
        if not glyph.coordinates:
            raise SystemExit(f"empty outline for {recipe['id']}")
        xs = [p[0] for p in glyph.coordinates]
        ys = [p[1] for p in glyph.coordinates]
        if min(xs) < SAFE_X_MIN or max(xs) > SAFE_X_MAX or min(ys) < SAFE_Y_MIN or max(ys) > SAFE_Y_MAX:
            raise SystemExit(f"outline outside safe bounds for {recipe['id']}")
        sig = tuple((p[0], p[1]) for p in glyph.coordinates)
        if sig in signatures:
            raise SystemExit(f"duplicate outline coordinates for {recipe['id']}")
        signatures.add(sig)
        glyphs[glyph_name(recipe['codepoint'])] = glyph
    fb.setupGlyf(glyphs)
    metrics = {}
    for name in glyph_order:
        g = glyphs[name]
        coords = getattr(g, 'coordinates', None)
        if coords and len(coords) > 0:
            x_min = min(p[0] for p in coords)
        else:
            x_min = 0
        metrics[name] = (ADVANCE, x_min)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=abs(DESCENT), achVendID='GFWK')
    fb.setupNameTable({
        'familyName': 'DESCENT SIGIL',
        'styleName': 'Regular',
        'uniqueFontIdentifier': 'Glitch Forgeworks LLC DESCENT SIGIL Regular 1.0',
        'fullName': 'DESCENT SIGIL Regular',
        'psName': 'DESCENTSIGIL-Regular',
        'version': 'Version 1.000; original Glitch Forgeworks LLC outline recipes',
        'copyright': 'Copyright 2026 Glitch Forgeworks LLC. All rights reserved.',
        'manufacturer': 'Glitch Forgeworks LLC',
        'designer': 'Glitch Forgeworks LLC',
        'description': 'Original 72-glyph Operator\'s Descent sigil typeface.',
        'licenseDescription': 'Project-owned asset for Operator\'s Descent.',
    })
    fb.setupPost()
    font = fb.font
    font['post'].isFixedPitch = 1
    font['hhea'].lineGap = 0
    font['OS/2'].sTypoLineGap = 0
    font.flavor = 'woff2'
    font['head'].created = 0
    font['head'].modified = 0
    return font

def save_font(path=OUT):
    font = create_font()
    path.parent.mkdir(parents=True, exist_ok=True)
    font.save(path, reorderTables=True)
    print(f'wrote {path} ({path.stat().st_size} bytes)')

def font_bytes():
    buffer = io.BytesIO()
    create_font().save(buffer, reorderTables=True)
    return buffer.getvalue()

def check_deterministic():
    first = font_bytes()
    second = font_bytes()
    if first != second:
        raise SystemExit('font build is not deterministic')
    print(f'deterministic WOFF2 build verified ({len(first)} bytes)')

if __name__ == '__main__':
    if '--check-deterministic' in sys.argv:
        check_deterministic()
    elif '--check' in sys.argv:
        create_font()
    else:
        save_font()
