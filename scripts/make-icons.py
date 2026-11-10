# Erzeugt die App-Symbole: python3 scripts/make-icons.py src/icons/logo-hbc.png src/icons
import sys
from PIL import Image, ImageDraw
logo = Image.open(sys.argv[1]).convert('RGBA')
OUT = sys.argv[2]
GREEN = (38, 102, 75, 255)
def icon(size, maskable=False, rounded=True, S=4):
    N = size * S
    base = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    if maskable or not rounded: d.rectangle([0, 0, N, N], fill=(255, 255, 255, 255))
    else: d.rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * 0.22), fill=(255, 255, 255, 255))
    # Logo als Hintergrund, mittig
    area = N * (0.66 if maskable else 0.84)
    k = area / max(logo.size); lw, lh = int(logo.width * k), int(logo.height * k)
    lg = logo.resize((lw, lh), Image.LANCZOS)
    base.alpha_composite(lg, ((N - lw) // 2, (N - lh) // 2))
    # Terminbalken davor: dunkelgrün mit weißem Rand
    s = (0.70 if maskable else 1.0)
    c = N / 2
    bars = [(-0.31, -0.23, 0.07, -0.14), (-0.15, -0.045, 0.31, 0.045), (-0.21, 0.14, 0.10, 0.23)]
    for x0, y0, x1, y1 in bars:
        box = [c + x0 * N * s, c + y0 * N * s, c + x1 * N * s, c + y1 * N * s]
        h = box[3] - box[1]; rim = h * 0.18
        d.rounded_rectangle([box[0] - rim, box[1] - rim, box[2] + rim, box[3] + rim], radius=(h + 2 * rim) / 2, fill=(255, 255, 255, 255))
        d.rounded_rectangle(box, radius=h / 2, fill=GREEN)
    return base.resize((size, size), Image.LANCZOS)
icon(512).save(OUT + '/icon-512.png')
icon(192).save(OUT + '/icon-192.png')
icon(512, maskable=True).save(OUT + '/icon-maskable-512.png')
icon(180, rounded=False).save(OUT + '/apple-touch-icon.png')
icon(64).save(OUT + '/favicon-64.png')
icon(32).save(OUT + '/favicon-32.png')
