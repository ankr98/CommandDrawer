#!/usr/bin/env python3
"""Generate extension icons (rounded square + prompt glyph) as PNGs with no dependencies."""
import struct, zlib, math, os

def png(w, h, rows):
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

BG = (0x2f, 0x6f, 0xed)   # accent blue
FG = (0xff, 0xff, 0xff)

def render(size):
    s = size
    ss = 4  # supersample
    W = s * ss
    r = W * 0.22
    # glyph geometry in supersampled space: a ">" chevron and an underscore
    stroke = W * 0.11
    cx0, cy0 = W * 0.30, W * 0.34
    cx1, cy1 = W * 0.50, W * 0.50
    cx2, cy2 = W * 0.30, W * 0.66
    ux0, ux1, uy = W * 0.54, W * 0.76, W * 0.66

    def in_rounded(x, y):
        if x < r and y < r: return (x - r) ** 2 + (y - r) ** 2 <= r * r
        if x > W - r and y < r: return (x - (W - r)) ** 2 + (y - r) ** 2 <= r * r
        if x < r and y > W - r: return (x - r) ** 2 + (y - (W - r)) ** 2 <= r * r
        if x > W - r and y > W - r: return (x - (W - r)) ** 2 + (y - (W - r)) ** 2 <= r * r
        return True

    def dist_seg(px, py, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    def glyph(x, y):
        d = min(dist_seg(x, y, cx0, cy0, cx1, cy1), dist_seg(x, y, cx1, cy1, cx2, cy2), dist_seg(x, y, ux0, uy, ux1, uy))
        return d <= stroke / 2

    rows = []
    for py in range(s):
        row = []
        for px in range(s):
            cov = 0; g = 0
            for j in range(ss):
                for i in range(ss):
                    x = px * ss + i + 0.5; y = py * ss + j + 0.5
                    if in_rounded(x, y):
                        cov += 1
                        if glyph(x, y): g += 1
            n = ss * ss
            a = cov / n
            if cov == 0:
                row += [0, 0, 0, 0]; continue
            gf = g / cov
            col = [round(BG[k] * (1 - gf) + FG[k] * gf) for k in range(3)]
            row += col + [round(255 * a)]
        rows.append(row)
    return png(s, s, rows)

os.makedirs('public/icons', exist_ok=True)
for size in (16, 32, 48, 128):
    with open(f'public/icons/icon-{size}.png', 'wb') as f:
        f.write(render(size))
    print('wrote', size)
