#!/usr/bin/env python3
"""Crops the rendered frames to the demo box and writes an animated GIF.

Called by tools/build-demo-gif.sh; needs Pillow. The crop is found by looking for the
box's own 1px border rather than hard-coded, so the GIF survives the options page
being re-laid-out above it.
"""
import glob
import os
import sys

from PIL import Image

WORK, OUT, STEP = sys.argv[1], sys.argv[2], int(sys.argv[3])
BORDERS = ((0x33, 0x41, 0x55), (0xE2, 0xE8, 0xF0))   # --line, dark and light
EXPECTED_HEIGHT = 302                                 # 150px stage + border, at 2x
COLOURS = 48


def edges(pixels, size, colour, tol=14):
    """Rows and columns that are mostly this colour — the box's border lines."""
    width, height = size
    def near(c):
        return all(abs(a - b) <= tol for a, b in zip(c, colour))
    rows = [y for y in range(height)
            if sum(near(pixels[x, y]) for x in range(0, width, 3)) > width // 24]
    cols = [x for x in range(width)
            if sum(near(pixels[x, y]) for y in range(0, height, 3)) > 20]
    return rows, cols


def find_box(image):
    pixels = image.load()
    for colour in BORDERS:
        rows, cols = edges(pixels, image.size, colour)
        for top in rows:
            for bottom in rows:
                if abs((bottom - top) - EXPECTED_HEIGHT) <= 12 and cols:
                    return (cols[0] + 1, top + 1, cols[-1], bottom)
    raise SystemExit('could not find the demo box in the capture')


frames = [Image.open(p).convert('RGB') for p in sorted(glob.glob(os.path.join(WORK, 'f-*.png')))]
if not frames:
    raise SystemExit('no frames to assemble')

box = find_box(frames[0])
cropped = [f.crop(box) for f in frames]
# Flat UI colours, so a small palette and no dithering keeps the file well under a MB.
palette = [f.quantize(colors=COLOURS, method=Image.MEDIANCUT, dither=Image.NONE)
           for f in cropped]
palette[0].save(OUT, save_all=True, append_images=palette[1:], duration=STEP,
                loop=0, optimize=True, disposal=2)
print(f'{OUT}: {len(palette)} frames, {cropped[0].size[0]}x{cropped[0].size[1]}, '
      f'{os.path.getsize(OUT) // 1024} kB')
