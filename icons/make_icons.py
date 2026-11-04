#!/usr/bin/env python3
"""Every icon Kaivon Code ships, drawn from the Kaivon K (kaivon/brand/kaivon-mark.svg): a stem and
a chevron of light. Run from the repo root: python3 icons/make_icons.py  (macOS: uses iconutil).
Writes into src/stable, which is copied over VS Code's resources at build time."""
import pathlib, shutil, subprocess, tempfile
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = pathlib.Path('src/stable')
SS = 4  # drawn this many times larger, then scaled down, for clean edges

STEM = [(0, 0), (14, 0), (14, 100), (0, 100)]
CHEVRON = [(24, 50), (62, 0), (80, 0), (42, 50), (80, 100), (62, 100)]
STOPS = [(0.0, (0x7E, 0xE8, 0xFA)), (0.5, (0xA7, 0x8B, 0xFA)), (1.0, (0xF6, 0xB4, 0x6B))]


def ramp(t):
    """The chevron's colour at t (0-1) along cyan, violet, amber."""
    out = np.zeros(t.shape + (3,))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        m = (t >= a) & (t <= b)
        f = ((t - a) / (b - a))[..., None]
        out = np.where(m[..., None], np.array(ca) + (np.array(cb) - np.array(ca)) * f, out)
    return out


def tile_background(size):
    """Deep night, lighter towards the top left, with iris light behind the mark."""
    y, x = np.mgrid[0:size, 0:size] / size
    t = np.clip((x + y) / 2, 0, 1)[..., None]
    rgb = np.array((0x1B, 0x1A, 0x47)) * (1 - t) + np.array((0x08, 0x09, 0x18)) * t
    glow = np.exp(-(((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.09))[..., None]
    rgb = rgb + np.array((0x6F, 0x62, 0xFF)) * glow * 0.34
    return Image.fromarray(np.clip(rgb, 0, 255).astype('uint8')).convert('RGBA')


def mask(size, shapes):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    for s in shapes:
        d.polygon(s, fill=255)
    return m


def place(points, size, height, cx=0.5, cy=0.5):
    """The mark's coordinates, [height] (0-1 of size) tall and centred on (cx, cy)."""
    k = size * height / 100
    ox, oy = size * cx - 40 * k, size * cy - 50 * k
    return [(ox + px * k, oy + py * k) for px, py in points]


def mark(size, height, stem=(0xF1, 0xF3, 0xF8), cx=0.5, cy=0.5, glow=True):
    """The K alone on transparent, with its chevron's glow."""
    chev = mask(size, [place(CHEVRON, size, height, cx, cy)])
    a, b = place([(24, 0)], size, height, cx, cy)[0], place([(80, 100)], size, height, cx, cy)[0]
    y, x = np.mgrid[0:size, 0:size].astype(float)
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = np.clip(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1)
    colour = Image.fromarray(ramp(t).astype('uint8')).convert('RGBA')
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if glow:
        halo = colour.copy()
        halo.putalpha(chev.filter(ImageFilter.GaussianBlur(size * 0.03)).point(lambda v: int(v * 0.75)))
        out = Image.alpha_composite(out, halo)
    sharp = colour.copy()
    sharp.putalpha(chev)
    out = Image.alpha_composite(out, sharp)
    stem_layer = Image.new('RGBA', (size, size), stem + (255,))
    stem_layer.putalpha(mask(size, [place(STEM, size, height, cx, cy)]))
    return Image.alpha_composite(out, stem_layer)


def squircle(size, inset, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((inset, inset, size - inset - 1, size - inset - 1), radius=radius, fill=255)
    return m


def app_icon(px, inset=0.098, radius=0.18, mark_height=0.44):
    """The tile: night, the K, and a hairline of light on the edge. inset 0.098 is Apple's grid."""
    size = px * SS
    i, r = int(size * inset), int(size * radius)
    tile = tile_background(size)
    tile = Image.alpha_composite(tile, mark(size, mark_height))
    shape = squircle(size, i, r)
    edge = ImageChops.subtract(shape, squircle(size, i + max(SS, size // 340), r))
    rim = Image.new('RGBA', (size, size), (255, 255, 255, 46))
    rim.putalpha(edge.point(lambda v: int(v * 0.18)))
    tile = Image.alpha_composite(tile, rim)
    tile.putalpha(shape)
    return tile.resize((px, px), Image.LANCZOS)


def save_icns(path):
    with tempfile.TemporaryDirectory() as tmp:
        d = pathlib.Path(tmp) / 'code.iconset'
        d.mkdir()
        master = app_icon(1024)
        for s in (16, 32, 128, 256, 512):
            master.resize((s, s), Image.LANCZOS).save(d / f'icon_{s}x{s}.png')
            master.resize((s * 2, s * 2), Image.LANCZOS).save(d / f'icon_{s}x{s}@2x.png')
        subprocess.run(['iconutil', '-c', 'icns', str(d), '-o', str(path)], check=True)


def flat(px):
    """Windows, Linux and the web don't need Apple's margin: the tile fills more of the square."""
    return app_icon(px, inset=0.03, radius=0.2, mark_height=0.52)


def installer_art(w, h):
    """The tall picture beside Windows' installer: night, with the K low down."""
    y, x = np.mgrid[0:h, 0:w]
    t = (y / h)[..., None]
    rgb = np.array((0x1B, 0x1A, 0x47)) * (1 - t) + np.array((0x08, 0x09, 0x18)) * t
    glow = np.exp(-(((x / w - 0.5) ** 2) / 0.2 + ((y / h - 0.42) ** 2) / 0.05))[..., None]
    rgb = rgb + np.array((0x6F, 0x62, 0xFF)) * glow * 0.3
    img = Image.fromarray(np.clip(rgb, 0, 255).astype('uint8')).convert('RGBA')
    k = mark(w * SS, 0.42).resize((w, w), Image.LANCZOS)
    img.alpha_composite(k, (0, int(h * 0.42 - w / 2)))
    return img.convert('RGB')


SVG_K = ('<path fill="{stem}" d="M0 0 L14 0 L14 100 L0 100 Z"/>'
         '<path fill="{chev}" d="M24 50 L62 0 L80 0 L42 50 L80 100 L62 100 Z"/>')
GRADIENT = ('<defs><linearGradient id="k" gradientUnits="userSpaceOnUse" x1="24" y1="0" x2="80" y2="100">'
            '<stop offset="0" stop-color="#7ee8fa"/><stop offset="0.5" stop-color="#a78bfa"/>'
            '<stop offset="1" stop-color="#f6b46b"/></linearGradient></defs>')


def main():
    r = OUT / 'resources'
    # File-type icons fall back to VS Code's own; only the app's icons are ours.
    for f in list((r / 'darwin').glob('*.icns')) + list((r / 'win32').glob('*.ico')):
        f.unlink()
    save_icns(r / 'darwin/code.icns')
    flat(256).save(r / 'win32/code.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    for s in (70, 150):
        tile = mark(s * SS, 0.56, glow=False).resize((s, s), Image.LANCZOS)
        tile.save(r / f'win32/code_{s}x{s}.png')
    for scale, big, small in ((100, (164, 314), (55, 55)), (125, (192, 386), (64, 68)), (150, (246, 459), (83, 80)),
                              (175, (273, 556), (92, 97)), (200, (328, 604), (110, 106)), (225, (355, 700), (119, 123)),
                              (250, (410, 797), (138, 140))):
        installer_art(*big).save(r / f'win32/inno-big-{scale}.bmp')
        side = min(small)
        canvas = Image.new('RGB', small, 'white')
        icon = flat(side)
        canvas.paste(icon, ((small[0] - side) // 2, (small[1] - side) // 2), icon)
        canvas.save(r / f'win32/inno-small-{scale}.bmp')
    flat(512).save(r / 'linux/code.png')
    flat(192).save(r / 'server/code-192.png')
    flat(512).save(r / 'server/code-512.png')
    flat(64).save(r / 'server/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

    tile = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">' + GRADIENT +
            '<rect width="160" height="160" rx="34" fill="#12122e"/><g transform="translate(40 30)">' +
            SVG_K.format(stem='#f1f3f8', chev='url(#k)') + '</g></svg>\n')
    (r / 'linux/code.svg').write_text(tile)
    (OUT / 'src/vs/workbench/browser/media/code-icon.svg').write_text(tile)
    press = OUT / 'src/vs/workbench/browser/parts/editor/media'
    for name, colour in (('dark', '#26273f'), ('light', '#e4e4ee'), ('hcDark', '#ffffff'), ('hcLight', '#000000')):
        (press / f'letterpress-{name}.svg').write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -20 140 140">' +
            SVG_K.format(stem=colour, chev=colour) + '</svg>\n')


if __name__ == '__main__':
    main()
