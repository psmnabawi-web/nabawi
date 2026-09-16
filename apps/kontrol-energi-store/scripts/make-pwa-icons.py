#!/usr/bin/env python3
"""Generator ikon PWA Kontrol Energi Store.

Tidak memerlukan dependency eksternal. Menulis PNG RGBA langsung memakai zlib
sehingga dapat dijalankan ulang di Cloud Shell maupun CI tanpa instalasi apa pun.

Jalankan dari root paket:  python3 scripts/make-pwa-icons.py
"""
import os
import struct
import zlib

NAVY = (10, 35, 66)
NAVY_DEEP = (7, 25, 48)
CYAN = (47, 166, 161)
CREAM = (245, 242, 235)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "icons")
ROOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")

SS = 4  # supersampling factor untuk tepi halus


def write_png(path, width, height, pixels):
    """pixels: bytearray RGBA, panjang width*height*4."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter type 0
        raw.extend(pixels[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def point_in_polygon(px, py, polygon):
    inside = False
    count = len(polygon)
    j = count - 1
    for i in range(count):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if (yi > py) != (yj > py):
            x_cross = (xj - xi) * (py - yi) / (yj - yi) + xi
            if px < x_cross:
                inside = not inside
        j = i
    return inside


def rounded_rect_contains(px, py, size, radius):
    if radius <= 0:
        return True
    lo, hi = radius, size - radius
    cx = lo if px < lo else (hi if px > hi else px)
    cy = lo if py < lo else (hi if py > hi else py)
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy <= radius * radius


def bolt_polygon(size, scale=1.0):
    """Petir sederhana di ruang 0..1 lalu diskalakan ke ukuran ikon."""
    unit = [
        (0.585, 0.085), (0.250, 0.545), (0.455, 0.545),
        (0.395, 0.915), (0.760, 0.430), (0.545, 0.430), (0.615, 0.085),
    ]
    offset = (1.0 - scale) / 2.0
    return [((x * scale + offset) * size, (y * scale + offset) * size) for x, y in unit]


def render_icon(size, radius_ratio, bolt_scale, bg_top, bg_bottom, bolt_color, ring=False):
    big = size * SS
    radius = big * radius_ratio
    polygon = bolt_polygon(big, bolt_scale)
    ring_outer = big * 0.435
    ring_inner = big * 0.392
    center = big / 2.0

    acc = [[0, 0, 0, 0] for _ in range(size * size)]
    for y in range(big):
        py = y + 0.5
        row_base = (y // SS) * size
        for x in range(big):
            px = x + 0.5
            if not rounded_rect_contains(px, py, big, radius):
                continue
            t = py / big
            r = int(bg_top[0] + (bg_bottom[0] - bg_top[0]) * t)
            g = int(bg_top[1] + (bg_bottom[1] - bg_top[1]) * t)
            b = int(bg_top[2] + (bg_bottom[2] - bg_top[2]) * t)
            a = 255
            if ring:
                dx, dy = px - center, py - center
                dist = (dx * dx + dy * dy) ** 0.5
                if ring_inner <= dist <= ring_outer:
                    r, g, b = CYAN
            if point_in_polygon(px, py, polygon):
                r, g, b = bolt_color
            cell = acc[row_base + (x // SS)]
            cell[0] += r
            cell[1] += g
            cell[2] += b
            cell[3] += a

    samples = SS * SS
    pixels = bytearray(size * size * 4)
    for i, cell in enumerate(acc):
        alpha = cell[3] // samples
        if alpha == 0:
            continue
        # rata-rata warna hanya atas piksel yang terisi agar tepi tidak menghitam
        filled = max(cell[3] // 255, 1)
        pixels[i * 4 + 0] = min(255, cell[0] // filled)
        pixels[i * 4 + 1] = min(255, cell[1] // filled)
        pixels[i * 4 + 2] = min(255, cell[2] // filled)
        pixels[i * 4 + 3] = alpha
    return pixels


def build(path, size, radius_ratio, bolt_scale, bolt_color=CYAN, ring=False):
    pixels = render_icon(size, radius_ratio, bolt_scale, NAVY, NAVY_DEEP, bolt_color, ring)
    write_png(path, size, size, pixels)
    print("  + %s (%dx%d)" % (os.path.relpath(path), size, size))


def write_ico(path, png_sizes):
    """ICO pembungkus PNG (didukung semua browser modern dan Windows)."""
    entries = []
    for size in png_sizes:
        with open(os.path.join(OUT_DIR, "icon-%d.png" % size), "rb") as handle:
            entries.append((size, handle.read()))
    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory = b""
    payload = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    with open(path, "wb") as handle:
        handle.write(header + directory + payload)
    print("  + %s" % os.path.relpath(path))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Membuat ikon PWA Kontrol Energi Store...")
    # Ikon biasa: sudut membulat, petir besar.
    build(os.path.join(OUT_DIR, "icon-192.png"), 192, 0.22, 1.0)
    build(os.path.join(OUT_DIR, "icon-512.png"), 512, 0.22, 1.0)
    build(os.path.join(OUT_DIR, "icon-64.png"), 64, 0.22, 1.0)
    build(os.path.join(OUT_DIR, "icon-32.png"), 32, 0.20, 1.0)
    build(os.path.join(OUT_DIR, "icon-16.png"), 16, 0.18, 1.0)
    # Maskable: penuh tanpa sudut, konten diperkecil ke safe zone 80%.
    build(os.path.join(OUT_DIR, "maskable-512.png"), 512, 0.0, 0.66)
    build(os.path.join(OUT_DIR, "maskable-192.png"), 192, 0.0, 0.66)
    # iOS tidak memakai transparansi; sudut dipotong sistem.
    build(os.path.join(OUT_DIR, "apple-touch-icon.png"), 180, 0.0, 0.86, CREAM, ring=True)
    write_ico(os.path.join(ROOT_DIR, "favicon.ico"), [16, 32, 64])
    print("Selesai.")


if __name__ == "__main__":
    main()
